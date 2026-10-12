// Settings → Billing & integrations (live variant only; ADR 0171, backend api-spec 30.13; DEVIATIONS DV-908): the fourth tab
// of the "Prices & memberships" nav button (the nav has no room for another button at 1000 px, DV-322). One read, GET
// /settings/billing (set.billing), and one form per block, each saved with its own version: link tipping, the saved-card
// fees, the renewal policy and the price-change notice (set.billing), the booking fee's collect mode (PUT
// /catalog/guest-fee, set.services); Test connection and Sync to Square. The server's switches (processor, writes, the
// simulator) are read only. Drafts rebase on a newer copy from the event stream (lib/settings/drafts.ts).
import type { BillingRes, SettingsApi, SquareTestRes } from '@/data/ports/settings-api'
import { DraftSet, STALE_ACTION_MESSAGE } from '@/lib/settings/drafts'
import {
  checkLines,
  consentPurposes,
  feesBody,
  feesDraft,
  lastTestText,
  noticeBody,
  policyBody,
  policyDraft,
  policyText,
  processingLines,
  sameFees,
  samePolicy,
  squareStatus,
  syncToast,
  testToast,
} from '@/lib/settings/billing'
import type { FeesDraft, Line, PolicyDraft } from '@/lib/settings/billing'
import { seg, sw } from '@/lib/settings/styles'
import { formError, saveButtonStyle } from './ui'
import type { InputEvent, RunOptions, RunResult, Vals } from './ui'

/** What the section needs from SettingsExtras: two write wrappers (set.billing, and set.services for the booking fee). */
export interface BillingCtx {
  api: SettingsApi
  /** A write needing set.billing; refetches GET /settings/billing afterwards. */
  run<T>(name: string, request: (idem: string) => Promise<T>, o?: RunOptions): Promise<RunResult<T>>
  /** A write needing set.services (the booking fee); refetches the catalog and the billing read. */
  runServices<T>(name: string, request: (idem: string) => Promise<T>, o?: RunOptions): Promise<RunResult<T>>
  allowed(): boolean
  allowedServices(): boolean
  busy(name: string): boolean
  changed(): void
  flash(text: string): void
  /** "Thu, Oct 12, 3:04 PM" in the shop's time zone. */
  stamp(iso: string): string
}

const toneColour = (t: Line['tone']): string =>
  t === 'red' ? '#C2410C' : t === 'amber' ? '#8A5A06' : t === 'green' ? '#0E9E6E' : 'var(--ink)'
const lineVals = (l: Line) => ({
  label: l.label,
  value: l.value,
  style: { fontSize: '13.5px', fontWeight: 700, color: toneColour(l.tone) },
})

const COLLECT: ReadonlyArray<readonly ['counter' | 'link', string]> = [
  ['counter', 'At the counter'],
  ['link', 'By payment link'],
]

export class BillingSection {
  private readonly fees = new DraftSet<FeesDraft>(sameFees)
  private readonly policy = new DraftSet<PolicyDraft>(samePolicy)
  private readonly notice = new DraftSet<{ days: string }>((a, b) => a.days.trim() === b.days.trim())
  private readonly collect = new DraftSet<{ mode: string }>()
  private errors: Record<string, string> = {}
  private test: SquareTestRes | null = null

  constructor(private readonly ctx: BillingCtx) {}

  vals(b: BillingRes | undefined, dark: boolean): Vals {
    if (!b) return { has: false }
    void dark
    const sq = squareStatus(b.square)
    const lastTest = this.test
      ? { ok: this.test.ok, at: this.test.testedAt, checks: this.test.checks }
      : (b.square.lastTest ?? null)
    const checks = lastTest ? checkLines(lastTest.checks) : []
    const err = (k: string, entry?: { conflict: boolean }) => formError(this.errors[k] ?? '', entry as never)

    // link tipping: a switch, saved at once with its version
    const tip = sw(b.linkTipping.enabled)

    // saved-card fees
    const fBase = feesDraft(b.cardFees.fees)
    const fEntry = this.fees.get('fees', fBase, b.cardFees.version)
    const f = fEntry?.value ?? fBase
    const fSw = sw(f.enabled)
    const editFees = (patch: Partial<FeesDraft>) => {
      if (!this.ctx.allowed()) return
      this.fees.set('fees', fBase, b.cardFees.version, {
        ...this.fees.value('fees', fBase, b.cardFees.version),
        ...patch,
      })
      delete this.errors.fees
      this.ctx.changed()
    }

    // renewal policy
    const pBase = policyDraft(b.renewalPolicy)
    const pEntry = this.policy.get('policy', pBase, b.renewalPolicy.version)
    const p = pEntry?.value ?? pBase
    const editPolicy = (patch: Partial<PolicyDraft>) => {
      if (!this.ctx.allowed()) return
      this.policy.set('policy', pBase, b.renewalPolicy.version, {
        ...this.policy.value('policy', pBase, b.renewalPolicy.version),
        ...patch,
      })
      delete this.errors.policy
      this.ctx.changed()
    }

    // price-change notice
    const nBase = { days: String(b.priceChangeNotice.days) }
    const nEntry = this.notice.get('notice', nBase, b.priceChangeNotice.version)
    const n = nEntry?.value ?? nBase

    // the booking fee's collect mode (the amount is edited in Prices by size)
    const cBase = { mode: b.guestFee.collect }
    const cEntry = this.collect.get('collect', cBase, b.guestFee.version)
    const mode = (cEntry?.value ?? cBase).mode

    return {
      has: true,
      note: 'How Oasis takes card money through Square. The switches at the top are the server’s and change only when the app is deployed; everything below them is yours to set.',
      // Square
      sqHeadline: sq.headline,
      sqHeadStyle: { fontSize: '15px', fontWeight: 800, color: toneColour(sq.tone) },
      sqMissing: sq.missing.map((text) => ({ text })),
      sqHasMissing: sq.missing.length > 0,
      sqWarnings: sq.warnings.map((text) => ({ text })),
      sqHasWarnings: sq.warnings.length > 0,
      sqLastTest: lastTestText(lastTest, lastTest ? this.ctx.stamp(lastTest.at) : ''),
      sqChecks: checks.map(lineVals),
      sqHasChecks: checks.length > 0,
      testLabel: this.ctx.busy('billing:test') ? 'Testing…' : 'Test connection',
      test: () => void this.runTest(),
      syncLabel: this.ctx.busy('billing:sync') ? 'Syncing…' : 'Sync to Square',
      sync: () => void this.runSync(),
      syncNote:
        'Puts every membership price on Square now (it also happens by itself every few minutes once memberships on Square are on).',
      // the server's switches
      switches: processingLines(b.processing).map(lineVals),
      // link tipping
      tipTrack: tip.track,
      tipKnob: tip.knob,
      tipToggle: () => void this.saveTipping(b),
      tipSub: 'Square’s checkout asks the client for a tip on payment links. Off by default.',
      tipHasError: !!this.errors.tipping,
      tipError: this.errors.tipping ?? '',
      // saved-card fees
      feeTrack: fSw.track,
      feeKnob: fSw.knob,
      feeToggle: () => editFees({ enabled: !f.enabled }),
      feeNoShow: f.noShow,
      setNoShow: (e: InputEvent) => editFees({ noShow: e.target.value }),
      feeLate: f.lateCancel,
      setLate: (e: InputEvent) => editFees({ lateCancel: e.target.value }),
      feeSub: b.cardFees.active
        ? 'On: a no-show or a late cancel proposes the fee on the client’s saved card. Staff charge or waive each one.'
        : 'Proposed only when this is on and Square takes card payments. Nothing is ever charged without a staff member confirming.',
      feeDirty: !!fEntry,
      feeHasError: !!err('fees', fEntry),
      feeError: err('fees', fEntry),
      feeSaveStyle: saveButtonStyle(!!fEntry && !this.ctx.busy('billing:fees')),
      feeSaveLabel: this.ctx.busy('billing:fees') ? 'Saving…' : 'Save fees',
      feeSave: () => void this.saveFees(b),
      feeDiscard: () => {
        this.fees.drop('fees')
        delete this.errors.fees
        this.ctx.changed()
      },
      // renewal policy
      grace: p.grace,
      setGrace: (e: InputEvent) => editPolicy({ grace: e.target.value }),
      cancel: p.cancel,
      setCancel: (e: InputEvent) => editPolicy({ cancel: e.target.value }),
      policyText: policyText(p),
      policyDirty: !!pEntry,
      policyHasError: !!err('policy', pEntry),
      policyError: err('policy', pEntry),
      policySaveStyle: saveButtonStyle(!!pEntry && !this.ctx.busy('billing:policy')),
      policySaveLabel: this.ctx.busy('billing:policy') ? 'Saving…' : 'Save',
      policySave: () => void this.savePolicy(b),
      policyDiscard: () => {
        this.policy.drop('policy')
        delete this.errors.policy
        this.ctx.changed()
      },
      // price-change notice
      noticeDays: n.days,
      setNotice: (e: InputEvent) => {
        if (!this.ctx.allowed()) return
        this.notice.set('notice', nBase, b.priceChangeNotice.version, { days: e.target.value })
        delete this.errors.notice
        this.ctx.changed()
      },
      noticeSub:
        '“Move members” (Memberships) tells members on an older price this many days before their price moves.',
      noticeDirty: !!nEntry,
      noticeHasError: !!err('notice', nEntry),
      noticeError: err('notice', nEntry),
      noticeSaveStyle: saveButtonStyle(!!nEntry && !this.ctx.busy('billing:notice')),
      noticeSaveLabel: this.ctx.busy('billing:notice') ? 'Saving…' : 'Save',
      noticeSave: () => void this.saveNotice(b),
      noticeDiscard: () => {
        this.notice.drop('notice')
        delete this.errors.notice
        this.ctx.changed()
      },
      // booking fee collect mode
      bookingFee:
        b.guestFee.cents > 0
          ? '$' +
            Math.round(b.guestFee.cents / 100) +
            ' per online booking by a guest, toward the visit (set in Prices by size).'
          : 'No booking fee (set in Prices by size).',
      collectOpts: COLLECT.map(([k, label]) => ({
        label,
        style: seg(mode === k),
        onClick: () => {
          if (!this.ctx.allowedServices()) return
          this.collect.set('collect', cBase, b.guestFee.version, { mode: k })
          delete this.errors.collect
          this.ctx.changed()
        },
      })),
      collectHold: mode === 'card_hold',
      collectDirty: !!cEntry,
      collectHasError: !!err('collect', cEntry),
      collectError: err('collect', cEntry),
      collectSaveStyle: saveButtonStyle(!!cEntry && !this.ctx.busy('billing:collect')),
      collectSaveLabel: this.ctx.busy('billing:collect') ? 'Saving…' : 'Save',
      collectSave: () => void this.saveCollect(b),
      collectDiscard: () => {
        this.collect.drop('collect')
        delete this.errors.collect
        this.ctx.changed()
      },
      // consent (read only)
      consentVersion: 'Version ' + b.consent.version + ' · the box starts unticked',
      consentText: b.consent.text,
      consentPurposes: 'Used for: ' + consentPurposes(b.consent.purposes),
    }
  }

  // ---- writes ------------------------------------------------------------------------------------------------------

  private async runTest(): Promise<void> {
    if (!this.ctx.allowed()) return
    const r = await this.ctx.run('billing:test', (idem) => this.ctx.api.testSquare({ idempotencyKey: idem }))
    if (!r.ok) return this.ctx.changed()
    this.test = r.data
    this.ctx.flash(testToast(r.data))
  }

  private async runSync(): Promise<void> {
    if (!this.ctx.allowed()) return
    const r = await this.ctx.run(
      'billing:sync',
      (idem) => this.ctx.api.syncSquareCatalog({ idempotencyKey: idem }),
      {
        invalidate: [['settings', 'catalog']],
      },
    )
    if (!r.ok) {
      if (r.message) this.ctx.flash(r.message)
      return
    }
    this.ctx.flash(syncToast(r.data))
  }

  private async saveTipping(b: BillingRes): Promise<void> {
    if (!this.ctx.allowed()) return
    const r = await this.ctx.run(
      'billing:tipping',
      (idem) =>
        this.ctx.api.saveLinkTipping(
          { enabled: !b.linkTipping.enabled, version: b.linkTipping.version },
          { idempotencyKey: idem },
        ),
      { staleMessage: STALE_ACTION_MESSAGE },
    )
    if (!r.ok) {
      this.errors.tipping = r.message
      return this.ctx.changed()
    }
    delete this.errors.tipping
    this.ctx.flash(r.data.enabled ? 'Tips on payment links: on' : 'Tips on payment links: off')
  }

  private async saveFees(b: BillingRes): Promise<void> {
    if (!this.ctx.allowed()) return
    const e = this.fees.get('fees', feesDraft(b.cardFees.fees), b.cardFees.version)
    if (!e) return
    const body = feesBody(e.value)
    if (!body.ok) {
      this.errors.fees = body.message
      return this.ctx.changed()
    }
    const r = await this.ctx.run('billing:fees', (idem) =>
      this.ctx.api.saveCardFees({ ...body.value, version: e.version }, { idempotencyKey: idem }),
    )
    if (!r.ok) {
      this.errors.fees = r.message
      return this.ctx.changed()
    }
    this.fees.drop('fees')
    delete this.errors.fees
    this.ctx.flash(r.data.fees.enabled ? 'Saved-card fees saved · on' : 'Saved-card fees saved · off')
  }

  private async savePolicy(b: BillingRes): Promise<void> {
    if (!this.ctx.allowed()) return
    const e = this.policy.get('policy', policyDraft(b.renewalPolicy), b.renewalPolicy.version)
    if (!e) return
    const body = policyBody(e.value)
    if (!body.ok) {
      this.errors.policy = body.message
      return this.ctx.changed()
    }
    const r = await this.ctx.run('billing:policy', (idem) =>
      this.ctx.api.saveRenewalPolicy({ ...body.value, version: e.version }, { idempotencyKey: idem }),
    )
    if (!r.ok) {
      this.errors.policy = r.message
      return this.ctx.changed()
    }
    this.policy.drop('policy')
    delete this.errors.policy
    this.ctx.flash('Renewal policy saved')
  }

  private async saveNotice(b: BillingRes): Promise<void> {
    if (!this.ctx.allowed()) return
    const e = this.notice.get(
      'notice',
      { days: String(b.priceChangeNotice.days) },
      b.priceChangeNotice.version,
    )
    if (!e) return
    const body = noticeBody(e.value.days)
    if (!body.ok) {
      this.errors.notice = body.message
      return this.ctx.changed()
    }
    const r = await this.ctx.run('billing:notice', (idem) =>
      this.ctx.api.savePriceNotice({ days: body.value, version: e.version }, { idempotencyKey: idem }),
    )
    if (!r.ok) {
      this.errors.notice = r.message
      return this.ctx.changed()
    }
    this.notice.drop('notice')
    delete this.errors.notice
    this.ctx.flash('Price-change notice saved · ' + r.data.days + ' days')
  }

  private async saveCollect(b: BillingRes): Promise<void> {
    if (!this.ctx.allowedServices()) return
    const e = this.collect.get('collect', { mode: b.guestFee.collect }, b.guestFee.version)
    if (!e) return
    const r = await this.ctx.runServices('billing:collect', (idem) =>
      this.ctx.api.saveGuestFee(
        { cents: b.guestFee.cents, collect: e.value.mode as 'counter' | 'link', version: e.version },
        { idempotencyKey: idem },
      ),
    )
    if (!r.ok) {
      this.errors.collect = r.message
      return this.ctx.changed()
    }
    this.collect.drop('collect')
    delete this.errors.collect
    this.ctx.flash(
      'Booking fee: collected ' + (e.value.mode === 'link' ? 'by payment link' : 'at the counter'),
    )
  }
}
