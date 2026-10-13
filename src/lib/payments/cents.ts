// The Payments arithmetic in integer cents: what the live screen uses for sheet PREVIEWS (by-item refund value, adjust
// preview, the amount checks before submit). The server is the single source of truth for every figure on screen; this
// is its twin (backend src/modules/payments/calc.ts and src/platform/money.ts), asserted equal to the server's `calc` for
// every seeded invoice (scripts/e2e-payments.ts), to the backend's golden vectors (ADR 0173 "Dashboard twin": 7% and
// 6.625%, half up and half to even) and to the design's float formulas on the 105 fixtures (cents.test.ts). No clock, no
// state.
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
  /** A card refund the processor reported failed ('failed') no longer counts as refunded (ADR 0171 D4). */
  processorState?: 'na' | 'awaiting_processor' | 'confirmed' | 'failed'
}

/**
 * How an invoice rounds its tax, once on its adjusted subtotal (ADR 0173): `half_up` (the design's rule; every invoice
 * made before the rollout) or `half_even` (Square's rule, "bankers' rounding", sandbox check SQR-18).
 */
export type TaxRounding = 'half_up' | 'half_even'

/** An invoice's own tax rate: thousandths of a percent ("dbp": 7000 = 7%, 6625 = 6.625%) and its rounding. */
export interface TaxRate {
  dbp: number
  rounding: TaxRounding
}

/** 100% in dbp: a rate is 0 to 100000. */
export const TAX_DBP_PER_100_PERCENT = 100_000

export interface CentsInvoice {
  itemPrices: readonly number[]
  events: readonly CentsEvent[]
  /** The invoice's rate in thousandths of a percent (`taxDbp`: 7000 = 7%, 6625 = 6.625%). */
  taxDbp: number
  /** The invoice's rounding (`taxRounding`). */
  taxRounding: TaxRounding
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

/** Integer division rounding half to even ("bankers' rounding", Square's rule; the server's divHalfEven). */
export function divHalfEven(n: number, d: number): number {
  assertCents(n)
  if (!Number.isSafeInteger(d) || d <= 0) throw new RangeError('divisor must be a positive integer')
  const q = Math.floor(n / d)
  const r2 = 2 * (n - q * d)
  const out = r2 < d ? q : r2 > d ? q + 1 : q % 2 === 0 ? q : q + 1
  return out === 0 ? 0 : out
}

/**
 * Sales tax on a (non-negative) subtotal, rounded ONCE to the cent by the invoice's rule (the server's salesTaxCents and
 * SQL sales_tax_cents): `n = sub × dbp`, then n / 100000 half up or half to even. Integer math only.
 */
export function salesTaxCents(subCents: number, rate: TaxRate): number {
  assertCents(subCents)
  if (!Number.isSafeInteger(rate.dbp) || rate.dbp < 0) throw new RangeError(`bad tax rate ${rate.dbp}`)
  const n = subCents * rate.dbp
  return rate.rounding === 'half_even'
    ? divHalfEven(n, TAX_DBP_PER_100_PERCENT)
    : divHalfUp(n, TAX_DBP_PER_100_PERCENT)
}

/**
 * An invoice's rate as the server sends it (`taxDbp`, `taxRounding`; ADR 0173). A response without them (a server before
 * ADR 0173) has only `taxBp`, rounded half up: its rate is taxBp × 10.
 */
export function taxRateOf(d: {
  taxDbp?: number | null
  taxRounding?: TaxRounding | null
  taxBp?: number | null
}): TaxRate {
  if (typeof d.taxDbp === 'number') return { dbp: d.taxDbp, rounding: d.taxRounding ?? 'half_up' }
  return { dbp: (d.taxBp ?? 700) * 10, rounding: 'half_up' }
}

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
  const rate: TaxRate = { dbp: input.taxDbp, rounding: input.taxRounding }
  const tax = salesTaxCents(sub, rate)
  const total = sub + tax + input.tipCents
  const paidOrig = of('pay') - of('void')
  const creditApplied = of('credit_apply')
  const paid = paidOrig + creditApplied
  // a refund the processor reported failed gave nothing back (ADR 0171 D4; the backend's calc.ts and invoice_calc_of)
  const counts = (e: CentsEvent): boolean => e.status === 'done' && e.processorState !== 'failed'
  const refunded = of('refund', counts)
  const refOrig = of('refund', (e) => counts(e) && e.dest !== 'credit')
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
    // the tax part of the refunds comes out of net revenue half up, per rate (the server's netCents)
    net: items + adj - divHalfUp(refunded * TAX_DBP_PER_100_PERCENT, TAX_DBP_PER_100_PERCENT + input.taxDbp),
    overpaid: Math.max(0, paid - refunded - total),
    status: deriveStatus({ canceled: input.canceled, paid, refunded, balance }),
  }
}

/**
 * By-item refund value: the selected lines plus their tax at the invoice's rate and rounding, never more than what is
 * refundable (half up this is the lines times (1 + rate) rounded half up, the rule before ADR 0173).
 */
export function itemsRefundValue(selectedPrices: readonly number[], rate: TaxRate, refundable: number): number {
  const lines = sum(selectedPrices)
  return Math.min(refundable, lines + salesTaxCents(lines, rate))
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
  rate: TaxRate,
  a: AdjustSpec,
): AdjustPreview {
  const pre = a.unit === '%' ? percentOfCents(c.items, a.value) : a.value
  const signed = a.kind === 'discount' ? -pre : pre
  const newSub = c.sub + signed
  const newTotal = newSub + salesTaxCents(Math.max(newSub, 0), rate) + c.tip
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

/** "7%", "6.625%", "6.25%": the rate as staff read it, up to three decimals without trailing zeros (DV-213). */
export function taxPercentLabel(dbp: number): string {
  if (!Number.isSafeInteger(dbp) || dbp < 0) throw new RangeError(`bad tax rate ${dbp}`)
  const whole = Math.floor(dbp / 1000)
  const frac = String(dbp % 1000)
    .padStart(3, '0')
    .replace(/0+$/, '')
  return whole + (frac ? '.' + frac : '') + '%'
}

/**
 * A percentage as staff type it ("6.625", "7", "6.625%") in dbp, exactly (no floats): up to three decimals, 0 to 100;
 * null for anything else (the server's parseTaxPercent: it answers 422 on the same inputs).
 */
export function parseTaxPercent(raw: string): number | null {
  const m = /^\s*(\d{1,3})(?:\.(\d{0,3}))?\s*%?\s*$/.exec(String(raw ?? ''))
  if (!m) return null
  const dbp = Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0') || '0')
  return dbp <= TAX_DBP_PER_100_PERCENT ? dbp : null
}
