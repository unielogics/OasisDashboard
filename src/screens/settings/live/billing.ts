// Settings → Billing & integrations (live variant only; ADR 0171, backend api-spec 30.13; DEVIATIONS DV-908): the fourth tab
// of the "Prices & memberships" nav button (the nav has no room for another button at 1000 px, DV-322). One read, GET
// /settings/billing (set.billing), and one form per block, each saved with its own version: link tipping, the saved-card
// fees, the renewal policy and the price-change notice (set.billing), the booking fee's collect mode (PUT
// /catalog/guest-fee, set.services); Test connection and Sync to Square. The server's switches (processor, writes, the
// simulator) are read only. Drafts rebase on a newer copy from the event stream (lib/settings/drafts.ts).
// Wave K3 (ADR 0172, ADR 0173): the "Sales tax" form (PUT /settings/billing/sales-tax with the rate's version; DV-914) and
// the "Square item library" block (GET /integrations/square/items: state, tax check, counts, last runs, failures, the
// preview; Sync now, the tax Oasis items carry, archive all; DV-911).
import type { QueryKey } from '@tanstack/react-query'
import type {
  BillingRes,
  SettingsApi,
  SquareItemsRes,
  SquareItemsSyncRes,
  SquareTestRes,
} from '@/data/ports/settings-api'
import { DraftSet, STALE_ACTION_MESSAGE } from '@/lib/settings/drafts'
import {
  archiveToast,
  candidateRows,
  countsText,
  itemsHeadline,
  itemsSyncToast,
  previewText,
  roundingLine,
  showCounts,
  syncNote,
  taxLine,
  taxModeText,
} from '@/lib/settings/square-items'
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
  roundingText,
  salesTaxBody,
  sameFees,
  samePolicy,
  sameSalesTax,
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
  /** GET /integrations/square/items (set.billing), read while the section is open; undefined until it is here. */
  items(): SquareItemsRes | undefined
  /** The item library read failed (the block says so and offers to read it again). */
  itemsFailed(): boolean
  retryItems(): void
  /** The query keys a Square item write refetches: the item library and the catalog (Prices by size dots). */
  itemsKeys: QueryKey[]
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
  private readonly salesTax = new DraftSet<{ percent: string }>(sameSalesTax)
  private errors: Record<string, string> = {}
  private test: SquareTestRes | null = null
  /** The last Sync now answer of this page (what Square changed, what failed), until the next one. */
  private itemsRun: SquareItemsSyncRes | null = null
  /** "Archive Oasis items in Square" asks first. */
  private archiveAsk = false

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

    // the sales tax rate (DV-914): the rate as typed, saved with the rate's version; the rounding is read only
    const tBase = { percent: b.salesTax.percent }
    const tEntry = this.salesTax.get('tax', tBase, b.salesTax.version)
    const t = tEntry?.value ?? tBase

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
      // the sales tax rate (DV-914)
      tax: {
        percent: t.percent,
        setPercent: (e: InputEvent) => {
          if (!this.ctx.allowed()) return
          this.salesTax.set('tax', tBase, b.salesTax.version, { percent: e.target.value })
          delete this.errors.tax
          this.ctx.changed()
        },
        sub: 'New invoices are made at this rate. Each invoice keeps the rate it was made with. Prices are before tax.',
        rounding: roundingText(b.salesTax.rounding),
        dirty: !!tEntry,
        hasError: !!err('tax', tEntry),
        error: err('tax', tEntry),
        saveStyle: saveButtonStyle(!!tEntry && !this.ctx.busy('billing:tax')),
        saveLabel: this.ctx.busy('billing:tax') ? 'Saving…' : 'Save',
        save: () => void this.saveSalesTax(b),
        discard: () => {
          this.salesTax.drop('tax')
          delete this.errors.tax
          this.ctx.changed()
        },
      },
      // the Square item library (DV-911)
      items: this.itemsVals(),
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

  private async saveSalesTax(b: BillingRes): Promise<void> {
    if (!this.ctx.allowed()) return
    const e = this.salesTax.get('tax', { percent: b.salesTax.percent }, b.salesTax.version)
    if (!e) return
    const body = salesTaxBody(e.value.percent)
    if (!body.ok) {
      this.errors.tax = body.message
      return this.ctx.changed()
    }
    const r = await this.ctx.run('billing:tax', (idem) =>
      this.ctx.api.saveSalesTax({ percent: body.value, rounding: 'half_even', version: e.version }, { idempotencyKey: idem }),
    )
    if (!r.ok) {
      this.errors.tax = r.message
      return this.ctx.changed()
    }
    this.salesTax.drop('tax')
    delete this.errors.tax
    this.ctx.flash('Sales tax saved · ' + r.data.label + ', rounded like Square')
  }

  // ---- the Square item library (DV-911) -----------------------------------------------------------------------------

  private itemsVals(): Vals {
    const v = this.ctx.items()
    const failed = !v && this.ctx.itemsFailed()
    if (!v)
      return {
        has: false,
        loading: !failed,
        failed,
        retry: () => this.ctx.retryItems(),
      }
    const head = itemsHeadline(v)
    const tax = taxLine(v.taxCheck)
    const round = roundingLine(v.taxCheck)
    const picked = v.taxMode === 'adopt' ? v.taxObjectId : null
    const cands = candidateRows(v.taxCheck, picked)
    const stamp = (iso: string | null) => (iso ? this.ctx.stamp(iso) : '')
    const runs = [
      v.lastSyncAt ? 'Last sync ' + stamp(v.lastSyncAt) : 'Not synced yet',
      v.lastDriftAt ? 'full check ' + stamp(v.lastDriftAt) : null,
      v.taxCheckedAt ? 'tax checked ' + stamp(v.taxCheckedAt) : null,
    ].filter(Boolean)
    const run = this.itemsRun
    const busy = this.ctx.busy('billing:items-sync')
    const canArchive =
      v.mode === 'off' && v.writesEnabled && v.counts.onSquare + v.counts.waiting + v.counts.failed > 0
    const modeOpt = (mode: 'auto' | 'create', label: string) => ({
      label,
      style: seg(v.taxMode === mode),
      onClick: () => void this.setTaxMode(v, mode),
    })
    return {
      has: true,
      loading: false,
      failed: false,
      retry: () => this.ctx.retryItems(),
      headline: head.text,
      headStyle: { fontSize: '13.5px', fontWeight: 800, color: toneColour(head.tone), marginTop: '4px' },
      tax: tax.text,
      taxStyle: { fontSize: '13px', fontWeight: 700, color: toneColour(tax.tone), lineHeight: 1.45 },
      hasRounding: !!round,
      rounding: round?.text ?? '',
      roundingStyle: { fontSize: '12.5px', fontWeight: 600, color: toneColour(round?.tone ?? 'ink') },
      warnings: (v.taxCheck?.warnings ?? []).map((text) => ({ text })),
      hasWarnings: (v.taxCheck?.warnings.length ?? 0) > 0,
      // which Square tax Oasis items carry
      taxMode: taxModeText(v, v.taxCheck),
      taxModes: [modeOpt('auto', 'Automatic'), modeOpt('create', 'Oasis’s own tax')],
      candidates: cands.map((c) => ({
        text: c.text,
        style: { fontSize: '12.5px', fontWeight: 600, color: toneColour(c.tone), lineHeight: 1.45, flex: 1, minWidth: 0 },
        canUse: c.canUse,
        use: () => void this.setTaxMode(v, 'adopt', c.id),
      })),
      hasCandidates: cands.length > 0,
      taxError: this.errors.itemsTax ?? '',
      hasTaxError: !!this.errors.itemsTax,
      // counts and runs
      hasCounts: showCounts(v),
      counts: countsText(v.counts),
      runs: runs.join(' · '),
      hasPreview: !!v.preview,
      preview: v.preview ? 'Preview ' + stamp(v.preview.at) + ': ' + previewText(v.preview) : '',
      failures: v.failures.map((f) => ({ text: f.service + (f.error ? ': ' + f.error : '') })),
      hasFailures: v.failures.length > 0,
      hasLastError: !!v.lastError,
      lastError: v.lastError ? 'Last problem ' + stamp(v.lastErrorAt) + ': ' + v.lastError : '',
      // the last Sync now answer of this page
      changed: (run?.changedInSquare ?? []).map((text) => ({ text: 'Changed in Square: ' + text })),
      hasChanged: (run?.changedInSquare.length ?? 0) > 0,
      runFailures: (run?.failures ?? []).map((text) => ({ text })),
      hasRunFailures: (run?.failures.length ?? 0) > 0,
      syncLabel: busy ? (v.mode === 'on' ? 'Syncing…' : 'Reading Square…') : 'Sync now',
      sync: () => void this.syncItems(),
      note: syncNote(v),
      // rollback: archive every Oasis item (writes on, the item sync off: the server allows it only then)
      canArchive,
      archiveAsk: canArchive && this.archiveAsk,
      archiveStart: () => {
        if (!this.ctx.allowed()) return
        this.archiveAsk = true
        this.ctx.changed()
      },
      archiveCancel: () => {
        this.archiveAsk = false
        this.ctx.changed()
      },
      archiveLabel: this.ctx.busy('billing:items-archive') ? 'Archiving…' : 'Archive them',
      archive: () => void this.archiveItems(),
    }
  }

  private async syncItems(): Promise<void> {
    if (!this.ctx.allowed()) return
    const r = await this.ctx.run(
      'billing:items-sync',
      (idem) => this.ctx.api.syncSquareItems({ idempotencyKey: idem }),
      { invalidate: this.ctx.itemsKeys },
    )
    if (!r.ok) {
      if (r.message) this.ctx.flash(r.message)
      return
    }
    this.itemsRun = r.data
    this.ctx.flash(itemsSyncToast(r.data))
  }

  private async setTaxMode(v: SquareItemsRes, mode: 'auto' | 'adopt' | 'create', squareTaxId?: string): Promise<void> {
    if (!this.ctx.allowed()) return
    if (mode !== 'adopt' && v.taxMode === mode) return
    const r = await this.ctx.run(
      'billing:items-tax',
      (idem) =>
        this.ctx.api.setSquareItemsTax(
          { mode, ...(squareTaxId ? { squareTaxId } : {}), version: v.version },
          { idempotencyKey: idem },
        ),
      { invalidate: this.ctx.itemsKeys, staleMessage: STALE_ACTION_MESSAGE },
    )
    if (!r.ok) {
      this.errors.itemsTax = r.message
      return this.ctx.changed()
    }
    delete this.errors.itemsTax
    this.ctx.flash(
      mode === 'auto'
        ? 'Square tax: automatic · applies at the next sync'
        : mode === 'create'
          ? 'Square tax: Oasis’s own · applies at the next sync'
          : 'Square tax picked · applies at the next sync',
    )
  }

  private async archiveItems(): Promise<void> {
    if (!this.ctx.allowed()) return
    const r = await this.ctx.run(
      'billing:items-archive',
      (idem) => this.ctx.api.archiveSquareItems({ idempotencyKey: idem }),
      { invalidate: this.ctx.itemsKeys },
    )
    this.archiveAsk = false
    if (!r.ok) {
      if (r.message) this.ctx.flash(r.message)
      return this.ctx.changed()
    }
    this.ctx.flash(archiveToast(r.data))
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
