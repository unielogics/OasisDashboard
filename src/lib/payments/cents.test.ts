// The cents twin of the invoice arithmetic: equal to the design's float calc() on the 105 fixtures and on seeded random
// invoices (amounts whose tax never lands on a half cent, where float and half-up cents must agree), golden vectors from
// the backend (test/golden/pay/DEVIATIONS.md) and the text parsers.
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
  percentOfCents,
  taxHalfUp,
  taxLabel,
} from './cents'
import type { CentsCalc, CentsEvent } from './cents'

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
    taxBp: 700,
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
    expect(itemsRefundValue([4000], 700, 100000)).toBe(4280)
    expect(itemsRefundValue([54000], 700, 100000)).toBe(57780)
    expect(itemsRefundValue([54000], 700, 10000)).toBe(10000)
    expect(itemsRefundValue([], 700, 10000)).toBe(0)
  })
  it('adjust preview: discount on a paid invoice leaves an overpayment to settle', () => {
    const c = calcCents({
      itemPrices: [26000],
      events: [{ type: 'pay', amountCents: 27820 }],
      taxBp: 700,
      tipCents: 0,
      canceled: false,
    })
    expect(adjustPreview(c, 700, { kind: 'discount', unit: '%', value: 1000 })).toEqual({
      pre: 2600,
      signed: -2600,
      newSub: 23400,
      newTotal: 25038,
      diff: 2782,
    })
    expect(adjustPreview(c, 700, { kind: 'surcharge', unit: '$', value: 1500 })).toMatchObject({
      newTotal: 29425,
      diff: -1605,
    })
    // a discount larger than the invoice floors the tax base at zero
    expect(adjustPreview(c, 700, { kind: 'discount', unit: '$', value: 30000 }).newTotal).toBe(-4000)
  })
  it('a void takes a payment back out of paid, and a canceled invoice has no balance', () => {
    const c = calcCents({
      itemPrices: [10000],
      events: [
        { type: 'pay', amountCents: 10700 },
        { type: 'void', amountCents: 10700 },
      ],
      taxBp: 700,
      tipCents: 0,
      canceled: false,
    })
    expect([c.paid, c.balance, c.status]).toEqual([0, 10700, 'unpaid'])
    const k = calcCents({ itemPrices: [10000], events: [], taxBp: 700, tipCents: 0, canceled: true })
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
  it('tax label follows the invoice rate', () => {
    expect(taxLabel(700)).toBe('7%')
    expect(taxLabel(625)).toBe('6.25%')
  })
})
