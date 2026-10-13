// The cents twin of the invoice arithmetic: equal to the design's float calc() on the 105 fixtures and on seeded random
// invoices (amounts whose tax never lands on a half cent, where float and half-up cents must agree), golden vectors from
// the backend (test/golden/pay/DEVIATIONS.md; ADR 0173 "Dashboard twin" for 6.625% and Square's rounding) and the text
// parsers.
import { describe, expect, it } from 'vitest'
import { buildInvoices } from '@/screens/payments/fixtures'
import { seeded } from '@/screens/payments/testkit'
import { calcInvoice } from './calc'
import type { Invoice, InvoiceCalc, LedgerEvent } from './types'
import {
  adjustPreview,
  calcCents,
  divHalfUp,
  itemsRefundValue,
  money,
  money0,
  parseCents,
  parsePercentBp,
  parseTaxPercent,
  percentOfCents,
  salesTaxCents,
  taxPercentLabel,
  taxRateOf,
} from './cents'
import type { CentsCalc, CentsEvent, TaxRate } from './cents'

const SEVEN: TaxRate = { dbp: 7000, rounding: 'half_up' }
const taxHalfUp = (sub: number, bp: number): number => salesTaxCents(sub, { dbp: bp * 10, rounding: 'half_up' })

const toCents = (n: number): number => Math.round(n * 100)

const STATUS: Record<InvoiceCalc['status'], CentsCalc['status']> = {
  Paid: 'paid',
  Unpaid: 'unpaid',
  'Partially paid': 'partially_paid',
  Refunded: 'refunded',
  'Canceled · refunded': 'canceled_refunded',
  'Partially refunded': 'partially_refunded',
}

function twin(tx: Invoice): CentsCalc {
  return calcCents({
    itemPrices: tx.items.map((i) => toCents(i.price)),
    events: tx.events.map((e): CentsEvent => ({
      type: e.type,
      amountCents: toCents(e.amt),
      status: e.type === 'refund' ? e.status : undefined,
      dest: e.dest,
    })),
    taxDbp: 7000,
    taxRounding: 'half_up',
    tipCents: toCents(tx.tip),
    canceled: tx.canceled,
  })
}

function sameAsFloat(tx: Invoice): void {
  const f = calcInvoice(tx)
  const c = twin(tx)
  const dollars: Array<[keyof CentsCalc, number]> = [
    ['items', f.items],
    ['adj', f.adj],
    ['sub', f.sub],
    ['tax', f.tax],
    ['total', f.total],
    ['paid', f.paid],
    ['paidOrig', f.paidOrig],
    ['creditApplied', f.creditApplied],
    ['refunded', f.refunded],
    ['balance', f.balance],
    ['refundable', f.refundable],
    ['toOrigMax', f.toOrigMax],
    ['issued', f.issued],
  ]
  for (const [k, v] of dollars) expect(c[k], `${tx.id} ${k}`).toBe(toCents(v))
  expect(c.pendingN, `${tx.id} pendingN`).toBe(f.pending.length)
  expect(c.pendingAmt, `${tx.id} pendingAmt`).toBe(toCents(f.pending.reduce((a, e) => a + e.amt, 0)))
  // net removes the tax portion of the refunds: float rounds the dollar figure, cents round half up once
  expect(Math.abs(c.net - toCents(f.net)), `${tx.id} net`).toBeLessThanOrEqual(1)
  // canceled invoices read differently on purpose (backend DEVIATIONS 6: nothing paid is `canceled`, a kept deposit is
  // `canceled_kept`); the one canceled fixture, with its deposit refunded, reads `canceled_refunded` in both
  if (!tx.canceled) expect(c.status, `${tx.id} status`).toBe(STATUS[f.status])
  else if (f.status === 'Canceled · refunded' && c.paid > 0) expect(c.status).toBe('canceled_refunded')
}

describe('calcCents equals the design calc on the 105 invoices', () => {
  const all = buildInvoices()
  it('has the 105 fixtures', () => expect(all).toHaveLength(105))
  it('every field matches (in cents), every status the fixtures reach included', () => {
    const seen = new Set<string>()
    for (const tx of all) {
      sameAsFloat(tx)
      seen.add(twin(tx).status)
    }
    expect([...seen].sort()).toEqual(
      ['canceled_refunded', 'paid', 'partially_paid', 'partially_refunded', 'unpaid'].sort(),
    )
  })
})

describe('calcCents on seeded random invoices', () => {
  it('matches the float calc for 3000 invoices with whole-dollar amounts (the server floors a negative subtotal at 0; the UI never allows one)', () => {
    const r = seeded(20261006)
    const types = ['pay', 'adjust', 'refund', 'credit_issue', 'credit_apply'] as const
    for (let n = 0; n < 3000; n++) {
      const items = Array.from({ length: 1 + Math.floor(r() * 4) }, (_, i) => ({
        name: 'Item ' + i,
        price: 5 * (5 + Math.floor(r() * 130)),
      }))
      const events: LedgerEvent[] = Array.from({ length: Math.floor(r() * 7) }, () => {
        const type = types[Math.floor(r() * types.length)]!
        const e: LedgerEvent = {
          type,
          amt: type === 'adjust' && r() < 0.6 ? -(1 + Math.floor(r() * 3)) : 1 + Math.floor(r() * 400),
        }
        if (type === 'refund') {
          e.status = (['done', 'pending', 'denied'] as const)[Math.floor(r() * 3)]
          e.dest = (['card', 'credit', 'cash'] as const)[Math.floor(r() * 3)]
        }
        return e
      })
      sameAsFloat({
        id: 'R' + n,
        off: 0,
        time: '9:00 AM',
        client: 'X',
        vehicle: 'Y',
        staff: 'Z',
        items,
        tip: 5 * Math.floor(r() * 4),
        canceled: r() < 0.1,
        events,
      })
    }
  })
})

describe('half-up cents (backend golden vectors)', () => {
  it('tax lands half up on the cent', () => {
    expect(taxHalfUp(50, 700)).toBe(4) // 3.5
    expect(taxHalfUp(150, 700)).toBe(11) // 10.5
    expect(taxHalfUp(250, 700)).toBe(18) // 17.5
    expect(taxHalfUp(26000, 700)).toBe(1820)
    expect(taxHalfUp(0, 700)).toBe(0)
    expect(divHalfUp(1, 2)).toBe(1)
    expect(divHalfUp(0, 7)).toBe(0)
  })
  it('percent of items: 10% of $154.00 is $15.40', () => {
    expect(percentOfCents(15400, 1000)).toBe(1540)
    expect(percentOfCents(10000, 1250)).toBe(1250)
  })
  it('by-item refund adds the invoice tax and never exceeds what is refundable', () => {
    expect(itemsRefundValue([4000], SEVEN, 100000)).toBe(4280)
    expect(itemsRefundValue([54000], SEVEN, 100000)).toBe(57780)
    expect(itemsRefundValue([54000], SEVEN, 10000)).toBe(10000)
    expect(itemsRefundValue([], SEVEN, 10000)).toBe(0)
  })
  it('adjust preview: discount on a paid invoice leaves an overpayment to settle', () => {
    const c = calcCents({
      itemPrices: [26000],
      events: [{ type: 'pay', amountCents: 27820 }],
      taxDbp: 7000,
      taxRounding: 'half_up',
      tipCents: 0,
      canceled: false,
    })
    expect(adjustPreview(c, SEVEN, { kind: 'discount', unit: '%', value: 1000 })).toEqual({
      pre: 2600,
      signed: -2600,
      newSub: 23400,
      newTotal: 25038,
      diff: 2782,
    })
    expect(adjustPreview(c, SEVEN, { kind: 'surcharge', unit: '$', value: 1500 })).toMatchObject({
      newTotal: 29425,
      diff: -1605,
    })
    // a discount larger than the invoice floors the tax base at zero
    expect(adjustPreview(c, SEVEN, { kind: 'discount', unit: '$', value: 30000 }).newTotal).toBe(-4000)
  })
  it('a void takes a payment back out of paid, and a canceled invoice has no balance', () => {
    const c = calcCents({
      itemPrices: [10000],
      events: [
        { type: 'pay', amountCents: 10700 },
        { type: 'void', amountCents: 10700 },
      ],
      taxDbp: 7000,
      taxRounding: 'half_up',
      tipCents: 0,
      canceled: false,
    })
    expect([c.paid, c.balance, c.status]).toEqual([0, 10700, 'unpaid'])
    const k = calcCents({
      itemPrices: [10000],
      events: [],
      taxDbp: 7000,
      taxRounding: 'half_up',
      tipCents: 0,
      canceled: true,
    })
    expect([k.balance, k.status]).toEqual([0, 'canceled'])
  })
  it('rejects non-integer cents', () => {
    expect(() => divHalfUp(1.5, 2)).toThrow(RangeError)
    expect(() => money0(1.5)).toThrow(RangeError)
  })
})

describe('display and parsing', () => {
  it('money and money0 render cents like the design (U+2212 minus, whole dollars half away from zero)', () => {
    expect(money(123456)).toBe('$1,234.56')
    expect(money(-1500)).toBe('−$15.00')
    expect(money(0)).toBe('$0.00')
    expect(money0(123456)).toBe('$1,235')
    expect(money0(123449)).toBe('$1,234')
    expect(money0(-1450)).toBe('−$15')
    expect(money0(-49)).toBe('$0')
    expect(money0(706927)).toBe('$7,069')
  })
  it('parses the amount and percent fields', () => {
    expect(parseCents('12.5')).toBe(1250)
    expect(parseCents('$1,234.567')).toBe(123457)
    expect(parseCents('abc')).toBe(0)
    expect(parseCents('')).toBe(0)
    expect(parsePercentBp('10')).toBe(1000)
    expect(parsePercentBp('12.5%')).toBe(1250)
  })
  it('tax label follows the invoice rate, up to three decimals (DV-213, ADR 0173)', () => {
    expect([7000, 6625, 6250, 1, 6600, 0, 100_000, 10].map(taxPercentLabel)).toEqual([
      '7%',
      '6.625%',
      '6.25%',
      '0.001%',
      '6.6%',
      '0%',
      '100%',
      '0.01%',
    ])
  })
})

// ADR 0171 D4: a card refund Square reported FAILED or REJECTED gave nothing back, so it no longer counts as refunded. The
// same golden vectors as the backend's test/square/core-pure.test.ts ("calc with a failed card refund"), so the twins agree.
describe('a failed card refund is not refunded (ADR 0171 D4; backend golden)', () => {
  const base = {
    itemPrices: [10_000],
    taxDbp: 7000,
    taxRounding: 'half_up' as const,
    tipCents: 0,
    canceled: false,
  }
  const payE: CentsEvent = { type: 'pay', amountCents: 10_700 }
  const refundE = (amountCents: number, processorState: CentsEvent['processorState']): CentsEvent => ({
    type: 'refund',
    amountCents,
    status: 'done',
    dest: 'card',
    processorState,
  })
  it('refundable, net, status and the original-tender cap come back', () => {
    const done = calcCents({ ...base, events: [payE, refundE(4000, 'confirmed')] })
    const waiting = calcCents({ ...base, events: [payE, refundE(4000, 'awaiting_processor')] })
    const failed = calcCents({ ...base, events: [payE, refundE(4000, 'failed')] })
    const none = calcCents({ ...base, events: [payE] })
    expect(done).toMatchObject({ refunded: 4000, refOrig: 4000, refundable: 6700, status: 'partially_refunded' })
    expect(waiting).toEqual(done)
    expect(failed).toEqual(none)
    expect(failed).toMatchObject({
      refunded: 0,
      refOrig: 0,
      refundable: 10_700,
      toOrigMax: 10_700,
      net: 10_000,
      status: 'paid',
    })
  })
  it('canceled and fully refunded, but the refund failed: the deposit is kept, not refunded', () => {
    const canceled = calcCents({ ...base, canceled: true, events: [payE, refundE(10_700, 'failed')] })
    expect(canceled.status).toBe('canceled_kept')
  })
  it('an event without a processor state (cash, store credit, older data) counts as before', () => {
    const r = calcCents({ ...base, events: [payE, { type: 'refund', amountCents: 500, status: 'done', dest: 'cash' }] })
    expect(r.refunded).toBe(500)
  })
})

// ADR 0173 "Dashboard twin": the rate in thousandths of a percent and each invoice's own rounding. The vectors are the
// backend's (test/unit/tax-precision.test.ts); the 6.625% half-even ones are Square's own CalculateOrder answers (SQR-18).
describe('sales tax at a precise rate with the invoice’s rounding (ADR 0173; backend golden)', () => {
  const NJ: TaxRate = { dbp: 6625, rounding: 'half_even' }
  const vec = (rate: TaxRate, pairs: Array<[number, number]>) => {
    for (const [sub, tax] of pairs) expect(salesTaxCents(sub, rate), `${rate.dbp} ${rate.rounding} ${sub}`).toBe(tax)
  }
  it('6.625% half to even (Square’s answers)', () => {
    vec(NJ, [
      [400, 26],
      [1200, 80],
      [2000, 132],
      [3600, 238],
      [5200, 344],
      [10_000, 662],
      [50_000, 3312],
      [800, 53],
      [2400, 159],
      [6000, 398],
      [14_000, 928],
      [5500, 364],
      [12_900, 855],
      [150, 10],
      [100, 7],
      [500, 33],
      [4000, 265],
      [5000, 331],
      [25_000, 1656],
      [1600, 106],
      [10_400, 689],
      [5600, 371],
      [250, 17],
      [650, 43],
    ])
  })
  it('6.625% half up', () => vec({ dbp: 6625, rounding: 'half_up' }, [[400, 27], [10_000, 663], [5200, 345]]))
  it('7% half to even differs from half up only on $x.50 with x odd; every whole-dollar subtotal is the same', () => {
    vec({ dbp: 7000, rounding: 'half_even' }, [[150, 10], [250, 18], [18_400, 1288]])
    for (let d = 0; d <= 5000; d++)
      expect(salesTaxCents(d * 100, { dbp: 7000, rounding: 'half_even' })).toBe(salesTaxCents(d * 100, SEVEN))
  })
  it('7% half up: the design’s vectors are unchanged', () =>
    vec(SEVEN, [
      [50, 4],
      [150, 11],
      [250, 18],
      [1000, 70],
      [18_400, 1288],
      [54_000, 3780],
      [15_400, 1078],
      [35_000, 2450],
    ]))
  it('half up in dbp is exactly the old basis-point formula for every whole-bp rate', () => {
    for (let bp = 0; bp <= 10_000; bp += 7)
      for (const sub of [0, 1, 49, 50, 150, 999, 4321, 123_457])
        expect(salesTaxCents(sub, { dbp: bp * 10, rounding: 'half_up' })).toBe(Math.floor((sub * bp * 2 + 10_000) / 20_000))
  })
  it('half to even equals an exact BigInt reference', () => {
    for (let sub = 0; sub <= 20_000; sub += 3)
      for (const dbp of [6625, 7000, 8875, 1, 99_999]) {
        const n = BigInt(sub) * BigInt(dbp)
        const q = n / 100_000n
        const r2 = 2n * (n % 100_000n)
        const ref = r2 > 100_000n ? q + 1n : r2 < 100_000n ? q : q % 2n === 0n ? q : q + 1n
        expect(salesTaxCents(sub, { dbp, rounding: 'half_even' })).toBe(Number(ref))
      }
  })
  it('the invoice calc rounds once on the adjusted subtotal; tips are untaxed', () => {
    const inv = (rounding: TaxRate['rounding']) =>
      calcCents({
        itemPrices: [2000, 3600],
        events: [{ type: 'adjust', amountCents: -400 }],
        taxDbp: 6625,
        taxRounding: rounding,
        tipCents: 500,
        canceled: false,
      })
    expect([inv('half_even').sub, inv('half_even').tax, inv('half_even').total]).toEqual([5200, 344, 6044])
    expect(inv('half_up').tax).toBe(345)
    // $4 + $4 at 6.625% is 53 cents (once on the order), never 52 or 54 (per line)
    const two = calcCents({ itemPrices: [400, 400], events: [], taxDbp: 6625, taxRounding: 'half_even', tipCents: 0, canceled: false })
    expect(two.tax).toBe(53)
  })
  it('net takes the tax part of refunds out half up at the invoice’s rate', () => {
    const c = calcCents({
      itemPrices: [10_000],
      events: [
        { type: 'pay', amountCents: 10_662 },
        { type: 'refund', amountCents: 5331, status: 'done', dest: 'card' },
      ],
      taxDbp: 6625,
      taxRounding: 'half_even',
      tipCents: 0,
      canceled: false,
    })
    // 5331 × 100000 / 106625 = 4999.76 -> 5000
    expect(c.net).toBe(10_000 - 5000)
  })
  it('by-item refunds and adjustment previews use the invoice’s rule (backend vectors)', () => {
    expect(itemsRefundValue([400], NJ, 100_000)).toBe(426)
    expect(itemsRefundValue([400], { dbp: 6625, rounding: 'half_up' }, 100_000)).toBe(427)
    const c = calcCents({ itemPrices: [4000], events: [], taxDbp: 6625, taxRounding: 'half_even', tipCents: 0, canceled: false })
    expect(adjustPreview(c, NJ, { kind: 'discount', unit: '$', value: 400 }).newTotal).toBe(3600 + 238)
  })
  it('reads the rate an invoice carries; a server before ADR 0173 sends only taxBp (half up)', () => {
    expect(taxRateOf({ taxDbp: 6625, taxRounding: 'half_even', taxBp: 663 })).toEqual(NJ)
    expect(taxRateOf({ taxDbp: 7000, taxRounding: 'half_up', taxBp: 700 })).toEqual(SEVEN)
    expect(taxRateOf({ taxBp: 700 })).toEqual(SEVEN)
    expect(taxRateOf({ taxDbp: 6625 })).toEqual({ dbp: 6625, rounding: 'half_up' })
  })
  it('parses a percentage exactly like the server (up to three decimals, 0 to 100) and round-trips the label', () => {
    expect(['6.625', '7', '7.0', '6.625%', ' 6.625 ', '0', '100', '0.001', '8.25'].map(parseTaxPercent)).toEqual([
      6625, 7000, 7000, 6625, 6625, 0, 100_000, 1, 8250,
    ])
    for (const bad of ['6.6255', '-1', '100.001', '101', 'abc', '', '6,625', '1e2', '.5', '6.62.5'])
      expect(parseTaxPercent(bad), bad).toBeNull()
    for (let dbp = 0; dbp <= 100_000; dbp += 37) expect(parseTaxPercent(taxPercentLabel(dbp))).toBe(dbp)
  })
})
