// Settings → Billing & integrations (live variant only; ADR 0171, backend api-spec 30.13; DEVIATIONS DV-908) and the
// Memberships tab's Square words (DV-909), pure: the Square status and Test connection in plain words, the server's
// switches read only, the drafts of the editable blocks (link tipping, the saved-card fees, the renewal policy, the
// price-change notice, the booking fee's collect mode) with their checks, "Sync to Square", and "Move members"'s notice
// preview. The server keeps every value and its version; these helpers only word and check what is typed.
import type { BillingRes, CatalogSyncRes, SquareTestRes } from '@/data/ports/settings-api'
import { MONTHS } from '@/lib/dates'
import { addDays, parseIso } from '@/lib/tz'

export type Line = { label: string; value: string; tone: 'ink' | 'green' | 'amber' | 'red' }

const onOff = (b: boolean): string => (b ? 'On' : 'Off')

/** The Square row in plain words: where it points, whether it is set up, what is missing, and the warnings. */
export function squareStatus(v: BillingRes['square']): {
  headline: string
  tone: Line['tone']
  missing: string[]
  warnings: string[]
} {
  const st = v.status
  const env = typeof st.details.environment === 'string' ? st.details.environment : null
  const where = st.live
    ? 'Connected to Square' + (env ? ' (' + env + ')' : '')
    : 'Square simulator (nothing reaches Square)'
  if (st.live && st.configured)
    return { headline: where + ' · set up', tone: 'green', missing: [], warnings: st.warnings }
  if (st.live)
    return { headline: where + ' · not set up yet', tone: 'red', missing: st.missing, warnings: st.warnings }
  return { headline: where, tone: 'ink', missing: [], warnings: st.warnings }
}

const CHECK_LABEL: Record<string, string> = {
  token: 'Access token',
  location: 'Location',
  events: 'Events',
  webhook: 'Webhook',
}

/** The checks of a connection test: one line each, with the server's plain reason. */
export function checkLines(checks: ReadonlyArray<{ key: string; ok: boolean; detail: string }>): Line[] {
  return checks.map((c) => ({
    label: CHECK_LABEL[c.key] ?? c.key,
    value: (c.ok ? 'OK' : 'Not OK') + (c.detail ? ' · ' + c.detail : ''),
    tone: c.ok ? 'green' : 'red',
  }))
}

/** "Last test: OK · Oct 12, 3:04 PM" (the time already in the shop's words, from the caller). */
export function lastTestText(t: BillingRes['square']['lastTest'], when: string): string {
  if (!t) return 'Never tested'
  return 'Last test: ' + (t.ok ? 'all checks passed' : 'something failed') + (when ? ' · ' + when : '')
}

/** The toast after Test connection. */
export const testToast = (r: Pick<SquareTestRes, 'ok' | 'checks'>): string =>
  r.ok
    ? 'Square connection OK'
    : 'Square connection: ' + r.checks.filter((c) => !c.ok).length + ' check(s) failed'

/** The server's switches, read only (they are changed at deploy time, never here). */
export function processingLines(p: BillingRes['processing']): Line[] {
  return [
    {
      label: 'Card payments go through',
      value: p.processor === 'square' ? 'Square' : 'Squarespace (Square not switched on yet)',
      tone: 'ink',
    },
    {
      label: 'Square',
      value:
        p.squareProvider === 'sim'
          ? 'Simulator'
          : p.squareEnvironment === 'production'
            ? 'Production'
            : 'Sandbox (test)',
      tone: 'ink',
    },
    {
      label: 'Square writes',
      value: p.writesEnabled
        ? 'On'
        : 'Off · watch only: payments are seen and matched, nothing is made at Square',
      tone: p.writesEnabled ? 'green' : 'amber',
    },
    { label: 'Memberships on Square', value: onOff(p.membershipsEnabled), tone: 'ink' },
    {
      label: 'Saved cards and fees',
      value: p.cardsOn ? 'On' : 'Off until Square takes card payments',
      tone: 'ink',
    },
    { label: 'Personal pay, card and membership pages', value: onOff(p.publicLinksEnabled), tone: 'ink' },
    {
      label: 'Counter payments recorded',
      value:
        p.posAutomatch === 'amount' ? 'On strong evidence, or on an amount alone' : 'Only on strong evidence',
      tone: 'ink',
    },
    { label: '“Open Square POS” button', value: onOff(p.posAppSwitch), tone: 'ink' },
  ]
}

const PURPOSE_WORDS: Record<string, string> = {
  membership_billing: 'membership payments',
  no_show_fee: 'no-show fees',
  late_cancel_fee: 'late-cancel fees',
  balance: 'balances',
}
export const consentPurposes = (p: readonly string[]): string =>
  p.map((x) => PURPOSE_WORDS[x] ?? x).join(', ')

// ---- drafts -----------------------------------------------------------------------------------------------------------

/** Whole dollars as typed ("15", "$15", "15.00"); null for anything else. */
export function parseDollars(raw: string): number | null {
  const t = raw.trim().replace(/^\$/, '')
  if (t === '') return 0
  if (!/^\d{1,4}(\.00?)?$/.test(t)) return null
  return Number(t.split('.')[0]) * 100
}
export const dollars = (cents: number): string => String(Math.round(cents / 100))

export interface FeesDraft {
  enabled: boolean
  noShow: string
  lateCancel: string
}
export const feesDraft = (f: BillingRes['cardFees']['fees']): FeesDraft => ({
  enabled: f.enabled,
  noShow: dollars(f.noShowCents),
  lateCancel: dollars(f.lateCancelCents),
})
export function feesBody(
  d: FeesDraft,
):
  | { ok: true; value: { enabled: boolean; noShowCents: number; lateCancelCents: number } }
  | { ok: false; message: string } {
  const ns = parseDollars(d.noShow)
  const lc = parseDollars(d.lateCancel)
  if (ns === null || ns > 100_000)
    return { ok: false, message: 'The no-show fee is whole dollars, $0 to $1,000.' }
  if (lc === null || lc > 100_000)
    return { ok: false, message: 'The late-cancel fee is whole dollars, $0 to $1,000.' }
  if (d.enabled && ns === 0 && lc === 0)
    return { ok: false, message: 'Set at least one fee before turning fees on.' }
  return { ok: true, value: { enabled: d.enabled, noShowCents: ns, lateCancelCents: lc } }
}
export const sameFees = (a: FeesDraft, b: FeesDraft): boolean =>
  a.enabled === b.enabled &&
  a.noShow.trim() === b.noShow.trim() &&
  a.lateCancel.trim() === b.lateCancel.trim()

export interface PolicyDraft {
  grace: string
  cancel: string
}
export const policyDraft = (p: BillingRes['renewalPolicy']): PolicyDraft => ({
  grace: String(p.graceDays),
  cancel: String(p.cancelDays),
})
const wholeDays = (raw: string): number | null => (/^\d{1,3}$/.test(raw.trim()) ? Number(raw.trim()) : null)
export function policyBody(
  d: PolicyDraft,
): { ok: true; value: { graceDays: number; cancelDays: number } } | { ok: false; message: string } {
  const g = wholeDays(d.grace)
  const c = wholeDays(d.cancel)
  if (g === null || g > 60) return { ok: false, message: 'Perks stay on for 0 to 60 days.' }
  if (c === null || c < 1 || c > 90)
    return { ok: false, message: 'The membership is canceled after 1 to 90 days.' }
  if (c <= g) return { ok: false, message: 'The cancel day must come after the last day of perks.' }
  return { ok: true, value: { graceDays: g, cancelDays: c } }
}
export const samePolicy = (a: PolicyDraft, b: PolicyDraft): boolean =>
  a.grace.trim() === b.grace.trim() && a.cancel.trim() === b.cancel.trim()

/** What the renewal policy means for the client, in the order it happens. */
export function policyText(d: PolicyDraft): string {
  const b = policyBody(d)
  if (!b.ok) return ''
  const { graceDays: g, cancelDays: c } = b.value
  return (
    'A renewal Square can’t charge: the client gets a text with a card link at once and keeps the perks ' +
    (g === 0 ? 'until it is paid' : g + (g === 1 ? ' day' : ' days')) +
    '; then the perks pause; ' +
    c +
    ' days after the failed payment the membership is canceled. A payment at any point puts it back.'
  )
}

export function noticeBody(raw: string): { ok: true; value: number } | { ok: false; message: string } {
  const n = wholeDays(raw)
  if (n === null || n > 90) return { ok: false, message: 'The notice is 0 to 90 days.' }
  return { ok: true, value: n }
}

/** The toast of "Sync to Square". */
export function syncToast(r: CatalogSyncRes): string {
  if (r.status === 'skipped')
    return 'Not synced: ' + (r.reason ?? 'Square writes or memberships on Square are off')
  const made = r.plansCreated + r.variationsCreated
  const parts = [
    made ? made + ' made' : null,
    r.plansRenamed ? r.plansRenamed + ' renamed' : null,
    r.retired ? r.retired + ' retired' : null,
    r.failed ? r.failed + ' failed' : null,
  ].filter(Boolean)
  return 'Synced to Square' + (parts.length ? ' · ' + parts.join(' · ') : ' · nothing to change')
}

// ---- Move members (DV-909) ---------------------------------------------------------------------------------------------

const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "Wed, Nov 11": the date the backend names in the notice (luxon "ccc, LLL d"), `days` after the shop's today. */
export function noticeDate(today: string, days: number): string {
  const d = addDays(today, days)
  const [y, m, day] = parseIso(d)
  return DOW3[new Date(Date.UTC(y, m - 1, day)).getUTCDay()] + ', ' + MONTHS[m - 1]!.slice(0, 3) + ' ' + day
}

/**
 * What "Move members" tells the members (the backend's `membership_price_change` text, with a sample name and the tier's
 * lowest current price; each member gets the price at their own size) and when the move happens.
 */
export function moveMembersPreview(o: {
  tierName: string
  fromCents: number | null
  days: number
  today: string
}): {
  when: string
  text: string
  explain: string
} {
  const when = noticeDate(o.today, o.days)
  const price = o.fromCents === null ? '$—' : '$' + dollars(o.fromCents)
  return {
    when,
    text:
      'Hi Maria, your Oasis Auto Spa ' +
      o.tierName +
      ' membership will be ' +
      price +
      '/month from your first bill after ' +
      when +
      '. Questions? Just reply here.',
    explain:
      'Members billed at an older ' +
      o.tierName +
      ' price get this text (and an email) today. Square moves each one to today’s price at their size at their first bill after ' +
      when +
      ' (' +
      o.days +
      (o.days === 1 ? ' day’s' : ' days’') +
      ' notice). Members who joined at today’s price are not touched.',
  }
}

export function moveToast(r: { moving: number; skipped: number }, when: string): string {
  if (r.moving === 0)
    return (
      'No member is on an older price' +
      (r.skipped ? ' · ' + r.skipped + ' left alone (a change is already scheduled)' : '')
    )
  return (
    'Moving ' +
    r.moving +
    (r.moving === 1 ? ' member' : ' members') +
    ' · new price from their first bill after ' +
    when +
    (r.skipped ? ' · ' + r.skipped + ' left alone (a change is already scheduled)' : '')
  )
}

/** A tier price's Square state, with the last sync problem when there is one (DV-909). */
export function priceSquareText(
  state: string | undefined,
  error: string | null | undefined,
): { text: string; tone: Line['tone'] } {
  if (state === 'synced') return { text: 'On Square', tone: 'green' }
  if (state === 'failed') return { text: 'Square sync failed', tone: 'red' }
  if (state === 'pending' && error) return { text: 'Square lost it · making it again', tone: 'amber' }
  return { text: 'Not synced yet', tone: 'ink' }
}
