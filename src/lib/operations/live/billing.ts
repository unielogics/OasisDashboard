// Cards on file, no-show and late-cancel fees and memberships billed by Square on the live appointment file (ADR 0171 wave
// Q3; DEVIATIONS DV-903, DV-904, DV-907): the client's saved cards with their consent, the visit's cancel / no-show controls
// and the fee the server proposed after them, and the Membership tab's billing block with its actions. Pure: every state,
// date and amount is the server's (GET /customers/:id/cards, GET /appointments/:id/fee-charges, the membership view's
// `billing`); these builders only word them and say which controls fit the state. The server has the last word on every
// action and its refusals are shown as it words them.
import type {
  AppointmentFile,
  CustomerCards,
  FeeCharge,
  MembershipBilling,
  MembershipView,
  SavedCard,
  TierOption,
} from '@/data/ports/operations'
import { businessToday, parseIso } from '@/lib/tz'
import type { Style } from '../types'
import { opsMoney } from './fmt'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Nov 13" for a shop-local date (YYYY-MM-DD); the year is added when it is not this year's. */
export function dayText(ymd: string | null | undefined, today: string): string {
  if (!ymd) return ''
  const [y, m, d] = parseIso(ymd.slice(0, 10))
  const base = MONTHS[m - 1] + ' ' + d
  return y === parseIso(today)[0] ? base : base + ', ' + y
}

/** "Nov 13" for an instant, in the shop's time zone. */
export const instantDay = (iso: string | null | undefined, tz: string, today: string): string =>
  iso && Number.isFinite(Date.parse(iso)) ? dayText(businessToday(Date.parse(iso), tz), today) : ''

/** "$129/month" (whole dollars without cents, as the tier grid shows them). */
export const monthly = (cents: number | null | undefined): string =>
  cents === null || cents === undefined ? '' : opsMoney(cents) + '/month'

// ---- cards on file (DV-903) ---------------------------------------------------------------------------------------------

const PURPOSE_WORDS: Record<string, string> = {
  membership_billing: 'membership',
  no_show_fee: 'no-show fee',
  late_cancel_fee: 'late-cancel fee',
  balance: 'balances',
}

/** "membership, no-show fee and balances" in the server's fixed order. */
export function purposesText(purposes: readonly string[]): string {
  const w = purposes.map((p) => PURPOSE_WORDS[p] ?? p)
  if (w.length <= 1) return w.join('')
  return w.slice(0, -1).join(', ') + ' and ' + w[w.length - 1]
}

const STATE_WORDS: Record<SavedCard['state'], string> = {
  active: 'On file',
  disabled: 'Removed',
  forgotten: 'Removed at Square',
  expired: 'Expired',
}

export interface CardRowVM {
  id: string
  label: string
  /** "Expires 12/28 · On file" */
  sub: string
  /** "Consent v1 · Oct 12 · membership and balances · on the client’s link" */
  consent: string
  active: boolean
  canRemove: boolean
}

export function cardRows(r: CustomerCards | undefined, tz: string, today: string): CardRowVM[] {
  return (r?.cards ?? []).map((c) => {
    const exp = c.expMonth && c.expYear ? 'Expires ' + String(c.expMonth).padStart(2, '0') + '/' + String(c.expYear).slice(-2) : ''
    const state =
      c.state === 'active'
        ? STATE_WORDS.active
        : STATE_WORDS[c.state] + (c.disabledAt ? ' ' + instantDay(c.disabledAt, tz, today) : '')
    // the newest consent still in force, else the newest one given
    const k = c.consents.find((x) => !x.revokedAt) ?? c.consents[0]
    const consent = k
      ? 'Consent ' +
        k.version +
        ' · ' +
        instantDay(k.acceptedAt, tz, today) +
        ' · ' +
        (purposesText(k.purposes) || 'nothing') +
        (k.via === 'link' ? ' · on the client’s link' : ' · recorded by staff') +
        (k.revokedAt ? ' · withdrawn ' + instantDay(k.revokedAt, tz, today) : '')
      : 'No consent on file: it can’t be charged'
    return {
      id: c.id,
      label: c.label,
      sub: [exp, state].filter(Boolean).join(' · '),
      consent,
      active: c.state === 'active',
      canRemove: c.state === 'active',
    }
  })
}

/**
 * The Overview's "Cards on file" block shows when the client has a card, or when saved cards are on at all (`charge`:
 * Square takes card money), so "Text card link" can start one. With today's defaults it shows nothing.
 */
export const cardsShown = (r: CustomerCards | undefined): boolean => !!r && (r.cards.length > 0 || r.charge)

export const removeCardText = (first: string, label: string): string =>
  'Remove ' + label + '? Square disables it and ' + first + '’s permission to charge it ends. It can’t be undone.'

/** What "Text card link" says after the server answered (`sent: false` names why). */
export function cardLinkToast(first: string, r: { sent: boolean; reason: string | null }): { title: string; desc: string } {
  if (r.sent) return { title: 'Card link texted', desc: first + ' can save a card on a secure page for 24 hours' }
  return {
    title: 'Card link not texted',
    desc:
      r.reason === 'opted_out'
        ? first + ' opted out of SMS'
        : r.reason === 'no_phone'
          ? first + ' has no phone on file'
          : 'The text could not go (' + (r.reason ?? 'unknown') + ')',
  }
}

// ---- the visit: cancel, no-show and the fee (DV-904) -----------------------------------------------------------------------

/** Booked or confirmed: the server cancels these (a no-show only after the start plus the grace period: its refusal says so). */
export const canCloseVisit = (f: Pick<AppointmentFile, 'status'>): boolean => f.status === 'booked' || f.status === 'confirmed'
export const isClosedVisit = (f: Pick<AppointmentFile, 'status'>): boolean => f.status === 'canceled' || f.status === 'no_show'

export const cancelText = (first: string): string =>
  'Cancel ' + first + '’s visit? ' + first + ' gets a text, and the deposit follows your cancellation rules.'
export const noShowText = (first: string): string =>
  'Mark ' + first + ' as a no-show? No text is sent, and the deposit follows your no-show rules.'

/** "Canceled", "No-show": the line of a closed visit's block. */
export const closedText = (f: Pick<AppointmentFile, 'status'>): string =>
  f.status === 'no_show' ? 'Marked as a no-show' : f.status === 'canceled' ? 'Canceled' : ''

const PURPOSE_TITLE: Record<FeeCharge['purpose'], string> = {
  no_show_fee: 'No-show fee',
  late_cancel_fee: 'Late-cancel fee',
  balance: 'Balance',
}

export interface FeeRowVM {
  id: string
  title: string
  state: FeeCharge['state']
  line: string
  /** proposed, or declined (a new attempt): Charge and Waive. */
  canDecide: boolean
  chargeLabel: string
  tone: 'amber' | 'red' | 'green' | 'ink'
}

/** A fee as both the Operations and the Payments ports type it (api-spec 30.11 ChargeDto). */
export type FeeLike = Pick<
  FeeCharge,
  'id' | 'purpose' | 'state' | 'amountCents' | 'card' | 'decidedBy' | 'decidedAt' | 'chargedAt' | 'error' | 'waiveReason'
>

export function feeRows(items: readonly FeeLike[] | undefined, tz: string, today: string): FeeRowVM[] {
  return (items ?? [])
    .filter((c) => c.purpose !== 'balance')
    .map((c) => {
      const card = c.card?.label ?? 'the saved card'
      const title = PURPOSE_TITLE[c.purpose] + ' · ' + opsMoney(c.amountCents) + ' on ' + card
      const by = c.decidedBy ? ' by ' + c.decidedBy : ''
      let line = ''
      let tone: FeeRowVM['tone'] = 'ink'
      switch (c.state) {
        case 'proposed':
          line = 'Proposed by the cancellation rules. Charge it or waive it.'
          tone = 'amber'
          break
        case 'charging':
        case 'unknown':
          line = 'Waiting for Square: it is recorded as soon as Square answers, never twice.'
          tone = 'amber'
          break
        case 'declined':
          line = 'Declined: ' + (c.error?.trim() || 'the bank said no.') + ' Charge it again or waive it.'
          tone = 'red'
          break
        case 'charged':
          line = 'Charged ' + instantDay(c.chargedAt ?? c.decidedAt, tz, today) + by
          tone = 'green'
          break
        case 'waived':
          line = 'Waived' + by + (c.waiveReason ? ': ' + c.waiveReason : '')
          break
      }
      return {
        id: c.id,
        title,
        state: c.state,
        line,
        canDecide: c.state === 'proposed' || c.state === 'declined',
        chargeLabel: 'Charge ' + opsMoney(c.amountCents),
        tone,
      }
    })
}

export const chargeFeeText = (row: Pick<FeeRowVM, 'title'>): string => 'Charge the ' + row.title.replace(/ · /, ' of ') + ' now?'

/** The toast after a fee charge the server answered (201 charged, 202 waiting for Square). */
export function feeChargeToast(c: Pick<FeeCharge, 'state' | 'amountCents' | 'card' | 'purpose'>): { title: string; desc: string } {
  const card = c.card?.label ?? 'the saved card'
  if (c.state === 'charged')
    return { title: PURPOSE_TITLE[c.purpose] + ' charged', desc: opsMoney(c.amountCents) + ' on ' + card }
  return { title: 'Waiting for Square', desc: opsMoney(c.amountCents) + ' on ' + card + ' · recorded when Square answers' }
}

export const feeLineStyle = (tone: FeeRowVM['tone']): Style => ({
  fontSize: '12.5px',
  fontWeight: 700,
  marginTop: '3px',
  lineHeight: '1.45',
  color: tone === 'red' ? '#C2410C' : tone === 'amber' ? '#8A5A06' : tone === 'green' ? '#0E9E6E' : 'var(--ink2)',
})

// ---- the Membership tab's billing block (DV-907) --------------------------------------------------------------------------

export interface BillingLine {
  label: string
  value: string
  tone: 'ink' | 'red' | 'amber' | 'green'
}

export type BillingActionKey =
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'cancel/undo'
  | 'change'
  | 'change/undo'
  | 'card-link'
  | 'refund-last'

export interface BillingButton {
  key: BillingActionKey
  label: string
  /** The action needs a second click (a confirmation box with these words). */
  confirm: string | null
  danger: boolean
}

export interface BillingBlock {
  show: boolean
  title: string
  status: BillingLine
  lines: BillingLine[]
  notes: string[]
  buttons: BillingButton[]
}

const NONE: BillingBlock = {
  show: false,
  title: '',
  status: { label: '', value: '', tone: 'ink' },
  lines: [],
  notes: [],
  buttons: [],
}

type Member = NonNullable<MembershipView['membership']>

/** The membership's status in plain words, from what Square and the failure policy say. */
export function billingStatus(m: Member, b: MembershipBilling, today: string): BillingLine {
  if (m.status === 'canceled') return { label: 'Status', value: 'Canceled', tone: 'ink' }
  if (m.status === 'pending')
    return {
      label: 'Status',
      value: b.enrollment?.failure
        ? 'Not started: ' + (b.enrollment.failure === 'first_payment_failed' ? 'the first payment failed' : 'joining did not finish')
        : 'Joining · waiting for the first payment',
      tone: 'amber',
    }
  if (m.status === 'past_due' || (b.status === 'failed' && b.pastDueOn && b.pastDueOn <= today))
    return {
      label: 'Status',
      value: 'Past due · perks paused' + (b.cancelOn ? ' · canceled ' + dayText(b.cancelOn, today) + ' unless paid' : ''),
      tone: 'red',
    }
  if (b.status === 'failed')
    return {
      label: 'Status',
      value: 'Payment failed · perks stay on' + (b.pastDueOn ? ' until ' + dayText(b.pastDueOn, today) : ''),
      tone: 'red',
    }
  if (m.status === 'paused' || b.squareStatus === 'PAUSED') return { label: 'Status', value: 'Paused', tone: 'amber' }
  return { label: 'Status', value: 'Active · billed by Square', tone: 'green' }
}

export function billingBlock(
  mem: MembershipView | undefined,
  ui: { tz: string; today: string },
): BillingBlock {
  const m = mem?.membership
  const b = m?.billing
  if (!m || !b) return NONE
  const today = ui.today
  const lines: BillingLine[] = []
  const notes: string[] = []
  lines.push({
    label: 'Plan',
    value: [m.plan.name, b.planClassLabel ?? m.planClassLabel, monthly(b.monthlyCents)].filter(Boolean).join(' · '),
    tone: 'ink',
  })
  lines.push({
    label: 'Next charge',
    value: b.nextChargeOn ? dayText(b.nextChargeOn, today) + (b.monthlyCents !== null ? ' · ' + opsMoney(b.monthlyCents) : '') : 'None scheduled',
    tone: 'ink',
  })
  lines.push({
    label: 'Card',
    value: b.card
      ? b.card.label +
        (b.card.expMonth && b.card.expYear
          ? ' · expires ' + String(b.card.expMonth).padStart(2, '0') + '/' + String(b.card.expYear).slice(-2)
          : '') +
        (b.card.state !== 'active' ? ' · ' + (STATE_WORDS[b.card.state as SavedCard['state']] ?? b.card.state).toLowerCase() : '')
      : 'No card on file',
    tone: b.card && b.card.state === 'active' ? 'ink' : 'red',
  })
  if (b.lastPaid)
    lines.push({
      label: 'Last payment',
      value:
        opsMoney(b.lastPaid.amountCents) +
        ' on ' +
        instantDay(b.lastPaid.paidAt, ui.tz, today) +
        (b.lastPaid.refundedCents ? ' · ' + opsMoney(b.lastPaid.refundedCents) + ' refunded' : ''),
      tone: 'ink',
    })
  if (b.lastFailed)
    lines.push({
      label: 'Failed payment',
      value:
        opsMoney(b.lastFailed.amountCents) +
        ' on ' +
        instantDay(b.lastFailed.failedAt, ui.tz, today) +
        (b.lastFailed.paid ? ' · paid since' : ' · not paid yet'),
      tone: b.lastFailed.paid ? 'ink' : 'red',
    })
  // what Square has scheduled at the next billing date
  if (b.cancelAt) notes.push('Ends on ' + dayText(b.cancelAt, today) + ': canceled at the end of the paid month. Perks stay on until then.')
  if (b.pauseAt) notes.push('Pauses on ' + dayText(b.pauseAt, today) + ', the next billing date.')
  if (b.change) {
    const what = [b.change.planName ?? b.change.planKey, b.change.planClassLabel ?? b.change.planClass, monthly(b.change.monthlyCents)].join(' · ')
    const when = b.change.effectiveDate
      ? dayText(b.change.effectiveDate, today)
      : b.change.swapAfter
        ? 'the first bill after ' + instantDay(b.change.swapAfter, ui.tz, today)
        : 'the next billing date'
    notes.push(
      b.change.kind === 'move'
        ? 'New price after the notice: ' + what + ' from ' + when + '.'
        : 'Changes to ' + what + ' from ' + when + '.',
    )
  }

  const live = m.status === 'active' || m.status === 'past_due' || m.status === 'paused'
  const paused = m.status === 'paused' || b.squareStatus === 'PAUSED'
  const buttons: BillingButton[] = []
  if (live) {
    if (paused) buttons.push({ key: 'resume', label: 'Resume', confirm: null, danger: false })
    else if (b.pauseAt) buttons.push({ key: 'resume', label: 'Undo pause', confirm: null, danger: false })
    else if (!b.cancelAt)
      buttons.push({
        key: 'pause',
        label: 'Pause',
        confirm: 'Pause from the next billing date? No charge while paused; perks stop then.',
        danger: false,
      })
    if (b.cancelAt) buttons.push({ key: 'cancel/undo', label: 'Undo cancel', confirm: null, danger: false })
    else
      buttons.push({
        key: 'cancel',
        label: 'Cancel at period end',
        confirm: 'Cancel at the end of the paid month? Perks stay on until then and no more charges are made.',
        danger: true,
      })
    if (b.change?.kind === 'change') buttons.push({ key: 'change/undo', label: 'Undo change', confirm: null, danger: false })
    else if (!b.change) buttons.push({ key: 'change', label: 'Change tier or size', confirm: null, danger: false })
    buttons.push({ key: 'card-link', label: 'Text card link', confirm: null, danger: false })
  }
  const refundable = b.lastPaid && b.lastPaid.refundedCents < b.lastPaid.amountCents
  if (refundable && b.lastPaid)
    buttons.push({
      key: 'refund-last',
      label: 'Refund last payment',
      confirm:
        'Refund ' +
        opsMoney(b.lastPaid.amountCents - b.lastPaid.refundedCents) +
        ' of ' +
        instantDay(b.lastPaid.paidAt, ui.tz, today) +
        ' to the card through Square? The membership itself does not change.',
      danger: true,
    })
  return { show: true, title: 'Billed by Square', status: billingStatus(m, b, today), lines, notes, buttons }
}

/** The toast of a billing action the server answered. */
export function billingToast(
  key: BillingActionKey,
  first: string,
  r: { sms?: 'queued' | 'skipped'; refund?: { amountCents: number; status: string } },
): { title: string; desc: string } {
  switch (key) {
    case 'pause':
      return { title: 'Membership will pause', desc: 'From the next billing date' }
    case 'resume':
      return { title: 'Membership resumed', desc: 'Square bills it again' }
    case 'cancel':
      return { title: 'Membership will end', desc: 'At the end of the paid month' }
    case 'cancel/undo':
      return { title: 'Cancel undone', desc: 'The membership goes on' }
    case 'change':
      return { title: 'Change scheduled', desc: 'From the next billing date' }
    case 'change/undo':
      return { title: 'Change undone', desc: 'The plan stays as it is' }
    case 'card-link':
      return r.sms === 'queued'
        ? { title: 'Card link texted', desc: first + ' can put a new card on the membership' }
        : { title: 'Card link not texted', desc: first + ' can’t be texted (opted out or no phone)' }
    case 'refund-last':
      return {
        title: 'Refund sent to Square',
        desc: r.refund ? opsMoney(r.refund.amountCents) + ' back to the card' : 'Back to the card',
      }
  }
}

// ---- change tier or size ---------------------------------------------------------------------------------------------------

export interface ChangeChoice {
  tiers: Array<{ key: string; label: string; on: boolean }>
  sizes: Array<{ key: string; label: string; price: string; on: boolean }>
  /** "Change to VIP · Large SUV · $219/month from the next billing date?" ('' until a priced tier and size are picked). */
  summary: string
  ready: boolean
}

/**
 * The tiers that are on and priced, then the sizes the picked tier has a price at (the membership's size first picked);
 * picking the plan it already has at the same size is no change.
 */
export function changeChoice(
  tiers: readonly TierOption[] | undefined,
  sizes: ReadonlyArray<{ key: string; label: string }>,
  current: { planKey: string; planClass: string },
  picked: { tier: string | null; size: string | null },
): ChangeChoice {
  const sold = (tiers ?? []).filter((t) => t.active && t.prices.length > 0)
  const tierKey = picked.tier ?? current.planKey
  const tier = sold.find((t) => t.key === tierKey) ?? null
  const sizeKey = picked.size ?? current.planClass
  const labelOf = (k: string) => sizes.find((s) => s.key === k)?.label ?? k
  const priced = tier ? tier.prices : []
  const price = priced.find((p) => p.class === sizeKey)
  const same = !!tier && tier.key === current.planKey && sizeKey === current.planClass
  const ready = !!tier && !!price && !same
  return {
    tiers: sold.map((t) => ({ key: t.key, label: t.name, on: t.key === tierKey })),
    sizes: priced.map((p) => ({ key: p.class, label: labelOf(p.class), price: monthly(p.monthlyCents), on: p.class === sizeKey })),
    summary: ready
      ? 'Change to ' + tier!.name + ' · ' + labelOf(sizeKey) + ' · ' + monthly(price!.monthlyCents) + ' from the next billing date?'
      : same
        ? 'That is the plan it has now. Pick another tier or size.'
        : tier && !price
          ? tier.name + ' has no price at ' + labelOf(sizeKey) + '. Pick a size with a price.'
          : '',
    ready,
  }
}

// ---- styles (the file's own literals: the facts' buttons, the Clear PIN confirmation box, the size chips) -----------------

export const plainButtonStyle = (busy = false): Style => ({
  flex: 'none',
  height: '36px',
  padding: '0 12px',
  borderRadius: '9px',
  background: 'var(--panel2)',
  border: '1px solid var(--line)',
  fontWeight: 700,
  fontSize: '12px',
  color: 'var(--ink2)',
  opacity: busy ? 0.5 : 1,
})

export const actionButtonStyle = (kind: 'primary' | 'danger', busy = false): Style => ({
  flex: 'none',
  height: '38px',
  padding: '0 14px',
  borderRadius: '10px',
  background: kind === 'danger' ? '#C2410C' : 'var(--accent)',
  color: '#fff',
  fontWeight: 700,
  fontSize: '12.5px',
  opacity: busy ? 0.5 : 1,
})

export const confirmBoxStyle = (dark: boolean, tone: 'red' | 'accent'): Style =>
  tone === 'red'
    ? {
        padding: '12px 14px',
        background: dark ? 'rgba(194,65,12,.14)' : '#FBEAE0',
        border: '1px solid rgba(194,65,12,.25)',
        borderRadius: '12px',
        marginTop: '8px',
      }
    : {
        padding: '12px 14px',
        background: 'var(--accentSoft)',
        border: '1px solid var(--accentBrd)',
        borderRadius: '12px',
        marginTop: '8px',
      }

export const toneStyle = (tone: BillingLine['tone']): Style => ({
  fontSize: '14px',
  fontWeight: 700,
  marginTop: '2px',
  color: tone === 'red' ? '#C2410C' : tone === 'amber' ? '#8A5A06' : tone === 'green' ? '#0E9E6E' : 'var(--ink)',
})
