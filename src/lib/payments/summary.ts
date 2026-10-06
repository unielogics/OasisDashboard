import { moneyWhole0 } from '../money'
import { TAX, calcInvoice } from './calc'
import { dateOf } from './dates'
import { lossBarStyle, methodBarStyle, netBarStyle } from './styles'
import type { Invoice, InvoiceCalcRow, LocalDay, RangeKey, StyleObject } from './types'

export const RANGE_BUTTONS: ReadonlyArray<readonly [RangeKey, string]> = [
  ['today', 'Today'],
  ['7d', '7 days'],
  ['30d', '30 days'],
  ['mtd', 'Month to date'],
]

/** Day-offset window [from, to] each range covers (offsets from the anchor day). */
export const RANGE_WINDOWS: Record<RangeKey, readonly [number, number]> = {
  today: [0, 0],
  '7d': [-6, 0],
  '30d': [-29, 0],
  mtd: [-12, 0],
}

export function invoicesInRange(txs: readonly Invoice[], win: readonly [number, number]): InvoiceCalcRow[] {
  return txs.filter((t) => t.off >= win[0] && t.off <= win[1]).map((t) => ({ t, c: calcInvoice(t) }))
}

export interface Kpi {
  label: string
  value: string
  sub: string
  color: string
}

export function kpiCards(inR: readonly InvoiceCalcRow[]): Kpi[] {
  const sum = (f: (x: InvoiceCalcRow) => number) => inR.reduce((a, x) => a + f(x), 0)
  const gross = sum((x) => x.c.items)
  const adj = sum((x) => x.c.adj)
  const refunds = sum((x) => x.c.refunded)
  const credits = sum((x) => x.c.issued)
  const outstanding = sum((x) => x.c.balance)
  const net = gross + adj - refunds / (1 + TAX)
  const cnt = (f: (x: InvoiceCalcRow) => boolean) => inR.filter(f).length
  return [
    { label: 'Gross sales', value: moneyWhole0(gross), sub: inR.length + ' invoices', color: 'var(--ink)' },
    {
      label: 'Net revenue',
      value: moneyWhole0(net),
      sub: 'after refunds & discounts',
      color: 'var(--accentInk)',
    },
    {
      label: 'Refunds',
      value: moneyWhole0(refunds),
      sub: cnt((x) => x.c.refunded > 0) + ' refunded',
      color: refunds ? 'var(--red)' : 'var(--ink)',
    },
    {
      label: 'Adjustments',
      value: moneyWhole0(adj),
      sub: cnt((x) => x.c.adj !== 0) + ' invoices',
      color: 'var(--ink)',
    },
    {
      label: 'Credits issued',
      value: moneyWhole0(credits),
      sub: cnt((x) => x.c.issued > 0) + ' clients',
      color: 'var(--ink)',
    },
    {
      label: 'Outstanding',
      value: moneyWhole0(outstanding),
      sub: cnt((x) => x.c.balance > 0) + ' open balances',
      color: outstanding ? 'var(--amber)' : 'var(--ink)',
    },
  ]
}

export interface ChartBucket {
  label: string
  title?: string
  test: (x: InvoiceCalcRow) => boolean
}

/** Chart x-axis buckets: ten hours (8a to 5p) for Today, else one per day of the window. */
export function chartBuckets(range: RangeKey, anchor: LocalDay): ChartBucket[] {
  const R = RANGE_WINDOWS[range]
  const buckets: ChartBucket[] = []
  if (range === 'today') {
    for (let h = 8; h <= 17; h++)
      buckets.push({
        label: (h % 12 || 12) + (h >= 12 ? 'p' : 'a'),
        test: (x) => {
          const m = x.t.time.match(/(\d+):\d+\s*(AM|PM)/)!
          let hh = +m[1]! % 12
          if (m[2] === 'PM') hh += 12
          return hh === h
        },
      })
  } else {
    for (let o = R[0]; o <= R[1]; o++) {
      const d = dateOf(anchor, o)
      buckets.push({
        label:
          R[1] - R[0] > 14
            ? d.getDate() % 3 === 1
              ? String(d.getDate())
              : ''
            : ['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getDay()] + ' ' + d.getDate(),
        test: (x) => x.t.off === o,
        title: d.toDateString(),
      })
    }
  }
  return buckets
}

export interface Bar {
  label: string
  title: string
  netStyle: StyleObject
  lossStyle: StyleObject
}

export function chartBars(inR: readonly InvoiceCalcRow[], range: RangeKey, anchor: LocalDay): Bar[] {
  const buckets = chartBuckets(range, anchor)
  const vals = buckets.map((b) => {
    const L = inR.filter(b.test)
    return {
      net: L.reduce((a, x) => a + x.c.net, 0),
      loss: L.reduce((a, x) => a + x.c.refunded + Math.max(0, -x.c.adj), 0),
    }
  })
  const mx = Math.max(1, ...vals.map((v) => v.net + v.loss))
  return buckets.map((b, i) => ({
    label: b.label,
    title: (b.title || b.label) + ' · net ' + moneyWhole0(vals[i]!.net),
    netStyle: netBarStyle(vals[i]!.net, mx),
    lossStyle: lossBarStyle(vals[i]!.loss, mx),
  }))
}

export type MethodFamily = 'Card' | 'Apple Pay' | 'Cash' | 'Store credit'

export const methodFamily = (m: string): MethodFamily =>
  /visa|master|amex/i.test(m)
    ? 'Card'
    : m === 'Apple Pay'
      ? 'Apple Pay'
      : m === 'Cash'
        ? 'Cash'
        : 'Store credit'

export interface MethodBar {
  label: string
  value: string
  barStyle: StyleObject
}

export function methodBars(inR: readonly InvoiceCalcRow[]): MethodBar[] {
  const mt: Record<MethodFamily, number> = { Card: 0, 'Apple Pay': 0, Cash: 0, 'Store credit': 0 }
  inR.forEach((x) =>
    x.t.events.forEach((e) => {
      if (e.type === 'pay') mt[methodFamily(e.method!)] += e.amt
      if (e.type === 'credit_apply') mt['Store credit'] += e.amt
    }),
  )
  const mmx = Math.max(1, ...Object.values(mt))
  return Object.entries(mt).map(([k, v]) => ({
    label: k,
    value: moneyWhole0(v),
    barStyle: methodBarStyle(k, v, mmx),
  }))
}
