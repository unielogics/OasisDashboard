// The Payments arithmetic in integer cents: what the live screen uses for sheet PREVIEWS (by-item refund value, adjust
// preview, the amount checks before submit). The server is the single source of truth for every figure on screen; this
// is its twin (backend src/modules/payments/calc.ts), asserted equal to the server's `calc` for every seeded invoice
// (scripts/e2e-payments.ts) and to the design's float formulas on the 105 fixtures (cents.test.ts). No clock, no state.
import { formatCents } from '../money'

export type CentsStatus =
  | 'paid'
  | 'unpaid'
  | 'partially_paid'
  | 'partially_refunded'
  | 'refunded'
  | 'canceled'
  | 'canceled_kept'
  | 'canceled_refunded'

export interface CentsEvent {
  type: 'pay' | 'adjust' | 'refund' | 'credit_issue' | 'credit_apply' | 'void'
  /** adjust is signed (negative = discount); every other type is positive. */
  amountCents: number
  status?: 'pending' | 'done' | 'denied'
  dest?: 'card' | 'credit' | 'cash' | null
}

export interface CentsInvoice {
  itemPrices: readonly number[]
  events: readonly CentsEvent[]
  taxBp: number
  tipCents: number
  canceled: boolean
}

export interface CentsCalc {
  items: number
  adj: number
  sub: number
  tax: number
  tip: number
  total: number
  paidOrig: number
  creditApplied: number
  paid: number
  refunded: number
  refOrig: number
  pendingAmt: number
  pendingN: number
  issued: number
  balance: number
  refundable: number
  toOrigMax: number
  net: number
  overpaid: number
  status: CentsStatus
}

const assertCents = (n: number): void => {
  if (!Number.isSafeInteger(n)) throw new RangeError(`expected an integer number of cents, got ${n}`)
}

/** Integer division rounding half up (the server's divHalfUp). */
export function divHalfUp(n: number, d: number): number {
  assertCents(n)
  if (!Number.isSafeInteger(d) || d <= 0) throw new RangeError('divisor must be a positive integer')
  const q = Math.floor((n * 2 + d) / (2 * d))
  return q === 0 ? 0 : q
}

/** Tax on a non-negative subtotal at a rate in basis points (700 = 7%), half up. */
export const taxHalfUp = (subCents: number, taxBp: number): number => divHalfUp(subCents * taxBp, 10_000)

/** `pctBp` of an amount, half up (1000 = 10%). */
export const percentOfCents = (cents: number, pctBp: number): number => divHalfUp(cents * pctBp, 10_000)

const sum = (xs: Iterable<number>): number => {
  let t = 0
  for (const x of xs) t += x
  return t
}

export function deriveStatus(v: {
  canceled: boolean
  paid: number
  refunded: number
  balance: number
}): CentsStatus {
  if (v.canceled && v.paid === 0 && v.refunded === 0) return 'canceled'
  if (v.canceled && v.refunded >= v.paid) return 'canceled_refunded'
  if (v.canceled) return 'canceled_kept'
  if (v.refunded > 0 && v.refunded >= v.paid - 1) return 'refunded'
  if (v.paid === 0) return 'unpaid'
  if (v.balance > 0) return 'partially_paid'
  if (v.refunded > 0) return 'partially_refunded'
  return 'paid'
}

/** The invoice calc in cents with the same fields and rules as the server's `calc`. */
export function calcCents(input: CentsInvoice): CentsCalc {
  const ev = input.events
  const of = (t: CentsEvent['type'], pred: (e: CentsEvent) => boolean = () => true): number =>
    sum(ev.filter((e) => e.type === t && pred(e)).map((e) => e.amountCents))
  const items = sum(input.itemPrices)
  const adj = of('adjust')
  const sub = Math.max(items + adj, 0)
  const tax = taxHalfUp(sub, input.taxBp)
  const total = sub + tax + input.tipCents
  const paidOrig = of('pay') - of('void')
  const creditApplied = of('credit_apply')
  const paid = paidOrig + creditApplied
  const refunded = of('refund', (e) => e.status === 'done')
  const refOrig = of('refund', (e) => e.status === 'done' && e.dest !== 'credit')
  const pending = ev.filter((e) => e.type === 'refund' && e.status === 'pending')
  const pendingAmt = sum(pending.map((e) => e.amountCents))
  const balance = input.canceled ? 0 : Math.max(0, total - paid)
  return {
    items,
    adj,
    sub,
    tax,
    tip: input.tipCents,
    total,
    paidOrig,
    creditApplied,
    paid,
    refunded,
    refOrig,
    pendingAmt,
    pendingN: pending.length,
    issued: of('credit_issue'),
    balance,
    refundable: Math.max(0, paid - refunded - pendingAmt),
    toOrigMax: Math.max(0, paidOrig - refOrig),
    net: items + adj - divHalfUp(refunded * 10_000, 10_000 + input.taxBp),
    overpaid: Math.max(0, paid - refunded - total),
    status: deriveStatus({ canceled: input.canceled, paid, refunded, balance }),
  }
}

/** By-item refund value: the selected lines with the invoice's tax rate, never more than what is refundable. */
export function itemsRefundValue(
  selectedPrices: readonly number[],
  taxBp: number,
  refundable: number,
): number {
  return Math.min(refundable, divHalfUp(sum(selectedPrices) * (10_000 + taxBp), 10_000))
}

export interface AdjustSpec {
  kind: 'discount' | 'surcharge'
  unit: '$' | '%'
  /** Cents for `$`; basis points of the items subtotal for `%`. */
  value: number
}

export interface AdjustPreview {
  /** Pre-tax amount (never negative). */
  pre: number
  signed: number
  newSub: number
  newTotal: number
  /** paid - refunded - newTotal: positive means the invoice would be overpaid. */
  diff: number
}

export function adjustPreview(
  c: Pick<CentsCalc, 'items' | 'sub' | 'tip' | 'paid' | 'refunded'>,
  taxBp: number,
  a: AdjustSpec,
): AdjustPreview {
  const pre = a.unit === '%' ? percentOfCents(c.items, a.value) : a.value
  const signed = a.kind === 'discount' ? -pre : pre
  const newSub = c.sub + signed
  const newTotal = newSub + taxHalfUp(Math.max(newSub, 0), taxBp) + c.tip
  return { pre, signed, newSub, newTotal, diff: c.paid - c.refunded - newTotal }
}

/** The amount field's text as cents: digits and dots only, rounded to the cent; unparseable text is 0. */
export function parseCents(raw: unknown): number {
  const n = parseFloat(String(raw).replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

/** The percent field's text as basis points (12.5 -> 1250); unparseable text is 0. */
export function parsePercentBp(raw: unknown): number {
  const n = parseFloat(String(raw).replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

/** Payments money(): dollars and cents, U+2212 minus. */
export const money = formatCents

/** Payments money0(): whole dollars (half away from zero on the absolute value), U+2212 minus. */
export function money0(cents: number): string {
  assertCents(cents)
  const dollars = Math.floor((Math.abs(cents) + 50) / 100)
  return (cents < 0 && dollars !== 0 ? '−' : '') + '$' + dollars.toLocaleString('en-US')
}

/** "7%" or "6.25%" for the tax label. */
export const taxLabel = (taxBp: number): string => `${Number((taxBp / 100).toFixed(2))}%`
