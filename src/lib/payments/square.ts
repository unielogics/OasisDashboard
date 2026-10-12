// The Payments screen with Square (ADR 0171, design "Dashboard changes"): which processor takes new card money, the
// Collect tenders it offers, the processor and refund states on ledger entries, and the "Square payments to match" sheet
// (GET /payments/square/unmatched, apply / set aside / move). Pure: the server decides every match and every figure;
// these builders only word and style what it answered. The Squarespace screen (DV-212..DV-217) stays exactly as it was
// while the server reports `processing.processor = squarespace` (or says nothing: an older server).
import type {
  CardCharge,
  InvoiceDetail,
  InvoiceProcessing,
  LedgerEvent,
  Processor,
  Reconciliation,
  SquareFailedRefund,
  SquareIgnoreReason,
  SquarePaymentToMatch,
} from '../../data/ports/payments'
import { coverageText, lineLabel } from '../sizes'
import { money } from './cents'
import type { StyleObject } from './types'

/** Who takes new card money on this invoice (the server's PAYMENT_PROCESSOR); an older server means Squarespace. */
export const processorOf = (d: Pick<InvoiceDetail, 'processing'> | undefined): Processor =>
  d?.processing?.processor ?? 'squarespace'

export const processorName = (p: Processor | null | undefined): string =>
  p === 'square' ? 'Square' : p === 'squarespace' ? 'Squarespace' : 'the card processor'

/**
 * The processor of one entry: its own; a staff card payment without one (the "Square reader" / "Card" tender records none)
 * belongs to the invoice's processor; a card refund without one is finished by hand, where the money came in (Squarespace).
 */
export const entryProcessor = (
  e: Pick<LedgerEvent, 'processor' | 'type'>,
  d: Pick<InvoiceDetail, 'processing'>,
): Processor => e.processor ?? (e.type === 'pay' ? processorOf(d) : 'squarespace')

// ---- Collect --------------------------------------------------------------------------------------------------------

export const TENDER_SQUARE_READER = 'Square reader'

/** The Collect sheet's tenders: the design's three with Squarespace; Square reader / Cash / Payment link with Square. */
export const collectTenders = (p: Processor): string[] =>
  p === 'square' ? [TENDER_SQUARE_READER, 'Cash', 'Payment link'] : ['Card on file', 'Cash', 'Payment link']

/** The saved card the server says may be charged for this balance (api-spec 30.13 `squareTenders.savedCard`), or null. */
export const savedCardOf = (d: { processing?: InvoiceProcessing } | undefined): SavedCard | null =>
  d?.processing?.processor === 'square' ? (d.processing.squareTenders?.savedCard ?? null) : null

type SavedCard = NonNullable<NonNullable<InvoiceProcessing['squareTenders']>['savedCard']>

/** The tender's label: "Saved card ••4242" (the card's own label when Square gave no last 4). */
export const savedCardTender = (c: SavedCard): string =>
  c.last4 ? 'Saved card ••' + c.last4 : 'Saved card · ' + c.label

/**
 * The tenders the server allows on this invoice (DV-802, DV-901): with Square, `Square reader` while Square is the processor,
 * `Saved card ••4242` only when the server names a usable card (Square writes on, an active card whose consent covers
 * balances), `Cash`, and `Payment link` only while Square writes are on. A server before wave Q3 says nothing about the
 * tenders: the Square three.
 */
export function collectTenderList(proc: InvoiceProcessing | undefined): string[] {
  if (proc?.processor !== 'square') return collectTenders('squarespace')
  const t = proc.squareTenders
  if (!t) return collectTenders('square')
  return [
    ...(t.reader ? [TENDER_SQUARE_READER] : []),
    ...(t.savedCard ? [savedCardTender(t.savedCard)] : []),
    'Cash',
    ...(t.link ? ['Payment link'] : []),
  ]
}

/** The tick box of the saved-card step: the client's OK, with the amount and the card. */
export const savedCardOkText = (first: string, cents: number, card: string): string =>
  first + ' said OK to charge ' + money(cents) + ' to ' + card

/** What the permission box says on the saved-card step. */
export const savedCardPermText = (first: string, ok: boolean): string =>
  ok
    ? 'Square charges the card as soon as you press the button. The receipt goes out by SMS and email.'
    : 'Ask ' + first + ' first. The card is charged only after they say yes and you confirm here.'

/** A declined card, in the sheet: Square's reason in plain words, and what to do. */
export const declinedText = (first: string, detail: string | null | undefined): string =>
  'Card declined: ' + (detail?.trim() || 'the bank said no.') + ' Ask ' + first + ' for another way to pay.'

/** Square did not answer the charge (202): the job finishes it with the same request, so it is never charged twice. */
export const WAITING_FOR_SQUARE_TEXT =
  'Waiting for Square: the charge was sent and Square has not answered yet. It shows on the invoice as soon as Square answers, and it is never charged twice.'

/** The toast after a saved-card charge the server answered. */
export function cardChargeToast(c: Pick<CardCharge, 'state' | 'amountCents' | 'card'>): string {
  const card = c.card?.label ?? 'the saved card'
  if (c.state === 'charged') return 'Charged ' + money(c.amountCents) + ' to ' + card
  return 'Waiting for Square · ' + money(c.amountCents) + ' on ' + card
}

// ---- receipts on ledger entries (DV-902) -------------------------------------------------------------------------------

/** Square's receipt page, only an https page on squareup.com or squareupsandbox.com (the server checks too); else null. */
export function safeReceiptUrl(url: string | null | undefined): string | null {
  if (!url) return null
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null
  const h = u.hostname.toLowerCase()
  const ok = ['squareup.com', 'squareupsandbox.com'].some((d) => h === d || h.endsWith('.' + d))
  return ok ? u.toString() : null
}

/** "Receipt #Xy7Q" for a Square payment's ledger meta ('' for any other entry). */
export const receiptMeta = (e: Pick<LedgerEvent, 'type' | 'receiptNumber'>): string =>
  e.type === 'pay' && e.receiptNumber ? 'Receipt #' + e.receiptNumber : ''

/** What the permission box of the Collect sheet says for a tender when Square is the processor. */
export function squareCollectText(method: 'card' | 'cash' | 'payment_link', first: string): string {
  if (method === 'card')
    return 'Take the card on the Square reader. It shows as Awaiting Square until Square confirms the payment.'
  if (method === 'payment_link')
    return 'We text ' + first + ' a secure link to pay this balance. The payment is recorded as soon as they pay.'
  return 'Receipt goes out by SMS and email.'
}

/**
 * The note under a Square link the server made and left on screen (DV-802): texted, or why not, so staff send it another
 * way. `sms` is the server's delivery state of the link's text; `cents` the exact amount the link asks for.
 */
export function sentLinkText(sms: string, client: string, cents: number): string {
  const amount = 'It is for exactly ' + money(cents) + '.'
  if (sms === 'queued') return 'Link texted. ' + amount
  const first = client.split(' ')[0]!
  return (
    'Not texted: ' +
    first +
    (sms === 'skipped_opt_out' ? ' opted out of SMS' : ' has no phone on file') +
    '. Copy the link and send it another way. ' +
    amount
  )
}

// ---- invoice lines ----------------------------------------------------------------------------------------------------

/** An item's label with its size and member % off (ADR 0170): "Signature Hand Wash · Large SUV · 10% member price". */
export const itemLabel = (i: InvoiceDetail['items'][number]): string =>
  lineLabel(i.name, i.classLabel, i.discountBp)

/**
 * An adjustment's label: a membership's coverage reads "Covered $40 · $20 size difference due" (whole dollars without
 * cents, short enough for the breakdown's one line; the value column carries the exact cents).
 */
export function adjustmentLabel(a: InvoiceDetail['adjustments'][number]): string {
  if (a.coverage) return coverageText(a.coverage)
  return (a.amountCents < 0 ? 'Discount · ' : 'Surcharge · ') + (a.reason ?? '')
}

// ---- ledger entries ---------------------------------------------------------------------------------------------------

/**
 * The Square state of an entry: a staff "Square reader" payment waiting (`awaiting`), a card refund on its way to Square
 * (`sent`), refunded by Square (`refunded`), a refund Square refused (`failed`, no longer counted as refunded), or null.
 */
export type SquareEntryState = 'awaiting' | 'sent' | 'refunded' | 'failed' | 'paid' | null

export function squareState(e: LedgerEvent, d: Pick<InvoiceDetail, 'processing'>): SquareEntryState {
  if (e.type === 'refund' && e.processorState === 'failed') return 'failed'
  if (entryProcessor(e, d) !== 'square') return null
  if (e.type === 'pay') {
    if (e.awaitingProcessor) return 'awaiting'
    return e.processor === 'square' && e.processorState === 'confirmed' ? 'paid' : null
  }
  if (e.type === 'refund' && e.status === 'done' && e.dest === 'card') {
    if (e.awaitingProcessor) return 'sent'
    if (e.processorState === 'confirmed' && e.processor === 'square') return 'refunded'
  }
  return null
}

/** The words a ledger entry's meta line ends with for its processor state ('' when it says nothing). */
export function processorMeta(e: LedgerEvent, d: Pick<InvoiceDetail, 'processing'>): string {
  const st = squareState(e, d)
  switch (st) {
    case 'awaiting':
      return 'Awaiting Square'
    case 'sent':
      return 'Refund sent to Square'
    case 'refunded':
      return 'Refunded by Square'
    case 'failed':
      return 'Refund failed · not refunded'
    case 'paid':
      return 'Square'
    default:
      return e.awaitingProcessor ? 'Awaiting ' + processorName(entryProcessor(e, d)) : ''
  }
}

/** A Square payment recorded on this invoice that a person may move to the right one (pay.void). */
export const canMoveSquarePay = (e: LedgerEvent): boolean =>
  e.type === 'pay' &&
  e.processor === 'square' &&
  e.processorState === 'confirmed' &&
  !!e.processorRef &&
  !e.voided &&
  e.status !== 'denied' &&
  e.reason !== 'Tip'

/** "INV-20640", "inv 20640", "20640" -> 20640; anything else null. */
export function parseInvoiceNo(raw: string): number | null {
  const m = /^\s*(?:inv[-\s#]*)?0*(\d{1,9})\s*$/i.exec(raw)
  return m ? Number(m[1]) : null
}

// ---- the "Square payments to match" banner and sheet ------------------------------------------------------------------

export const IGNORE_REASONS: ReadonlyArray<readonly [SquareIgnoreReason, string]> = [
  ['not_oasis_sale', 'Not an Oasis sale'],
  ['duplicate', 'Duplicate'],
  ['test', 'Test'],
  ['other', 'Other'],
]

/** "12 min ago", "2 h 5 min ago", "just now". */
export function ageText(minutes: number): string {
  if (minutes < 1) return 'just now'
  if (minutes < 60) return minutes + ' min ago'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h >= 48) return Math.floor(h / 24) + ' days ago'
  return h + ' h' + (m ? ' ' + m + ' min' : '') + ' ago'
}

/** The banner over the table: "2 Square payments to match · $82.00 · oldest 35 min ago"; '' when nothing waits. */
export function toMatchBanner(items: readonly SquarePaymentToMatch[] | undefined): string {
  if (!items || items.length === 0) return ''
  const n = items.length
  const total = items.reduce((t, p) => t + p.totalCents, 0)
  const oldest = Math.max(...items.map((p) => p.ageMinutes))
  return (
    n +
    ' Square payment' +
    (n === 1 ? '' : 's') +
    ' to match · ' +
    money(total) +
    ' · oldest ' +
    ageText(oldest)
  )
}

/** The money line of a payment: "$40.00 · Visa ••4242" with " + $6.00 tip" when it carries one. */
export function paymentLine(p: SquarePaymentToMatch): string {
  return (
    money(p.amountCents) +
    (p.tipCents ? ' + ' + money(p.tipCents) + ' tip' : '') +
    ' · ' +
    p.method +
    (p.refundedCents ? ' · ' + money(p.refundedCents) + ' refunded' : '')
  )
}

/** The second line: when, the note and the receipt number Square gave it. */
export function paymentMeta(p: SquarePaymentToMatch): string {
  return [
    ageText(p.ageMinutes),
    p.note ? 'Note: ' + p.note : null,
    p.receiptNumber ? 'Receipt #' + p.receiptNumber : null,
    p.matchState === 'pending' ? 'still being matched' : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

export interface ApplyTarget {
  invoiceId: string
  confirmEventId: string | null
  label: string
  sub: string
}

/**
 * Where a payment may be applied, best first: the server's candidates, then the invoice open on screen when it is not one of
 * them (a person may know better than the matcher). A candidate's staff card entry of the same amount is confirmed with it.
 */
export function applyTargets(
  p: SquarePaymentToMatch,
  open: Pick<InvoiceDetail, 'id' | 'label' | 'client' | 'calc' | 'ledger'> | undefined,
): ApplyTarget[] {
  const out: ApplyTarget[] = p.candidates.map((c) => ({
    invoiceId: c.invoiceId,
    confirmEventId: c.awaitingEventId,
    label: 'INV-' + String(c.invoiceNo).padStart(5, '0') + ' · ' + c.client,
    sub:
      money(c.balanceCents) +
      ' due' +
      (c.awaitingEventId ? ' · confirms the Square reader entry' : '') +
      (c.why.length ? ' · ' + c.why.join(', ') : ''),
  }))
  if (open && !out.some((t) => t.invoiceId === open.id)) {
    const entry = open.ledger.find(
      (e) => e.type === 'pay' && e.awaitingProcessor && !e.voided && e.amountCents === p.amountCents,
    )
    out.push({
      invoiceId: open.id,
      confirmEventId: entry?.id ?? null,
      label: open.label + ' · ' + open.client + ' (open on screen)',
      sub:
        money(open.calc.balance) +
        ' due' +
        (entry ? ' · confirms the Square reader entry' : ''),
    })
  }
  return out
}

/** A refused card refund in the sheet: what did not go back and what to do. */
export function failedRefundLine(r: SquareFailedRefund): { title: string; sub: string } {
  return {
    title: r.label + ' · ' + r.client + ' · ' + money(r.amountCents),
    sub:
      (r.refundedCents ? money(r.refundedCents) + ' went back · ' : '') +
      money(r.uncoveredCents) +
      ' did not go back to the card. Give it back another way.' +
      (r.errors.length ? ' (' + r.errors.join('; ') + ')' : ''),
  }
}

export const inFlightText = (recon: Reconciliation | undefined): string => {
  const n = recon?.square?.refundsInFlight ?? 0
  return n ? n + ' card refund' + (n === 1 ? '' : 's') + ' on the way to Square' : ''
}

// ---- styles (the screen's own literals: the banner is the approvals banner in the accent colour, the sheet the action sheet) --

export const bannerStyle: StyleObject = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '12px 14px 12px 16px',
  background: 'var(--accentSoft)',
  border: '1px solid var(--accentBrd)',
  borderRadius: '14px',
}

export const chipStyle = (on: boolean): StyleObject => ({
  height: '32px',
  padding: '0 12px',
  borderRadius: '9px',
  fontSize: '12px',
  fontWeight: 700,
  background: on ? 'var(--ink)' : 'var(--panel)',
  color: on ? 'var(--bg)' : 'var(--ink2)',
  border: '1px solid ' + (on ? 'var(--ink)' : 'var(--line)'),
})

export const applyButtonStyle = (ok: boolean): StyleObject => ({
  flex: 'none',
  height: '34px',
  padding: '0 13px',
  borderRadius: '9px',
  background: ok ? 'var(--accent)' : 'var(--panel3)',
  color: ok ? '#fff' : 'var(--ink3)',
  fontWeight: 800,
  fontSize: '12px',
  cursor: ok ? 'pointer' : 'not-allowed',
})
