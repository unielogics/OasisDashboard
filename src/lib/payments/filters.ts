import { fmtDate } from './dates'
import { invoicePill } from '../color'
import { moneyCents } from '../money'
import type { FilterKey, Invoice, InvoiceCalcRow, LocalDay, RangeKey, StyleObject } from './types'

export interface FilterDef {
  key: FilterKey
  label: string
  test: (x: InvoiceCalcRow) => boolean
}

export const FILTERS: readonly FilterDef[] = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'unpaid', label: 'Open balance', test: (x) => x.c.balance > 0 },
  { key: 'refunds', label: 'Refunds', test: (x) => x.c.refunded > 0 || x.c.pending.length > 0 },
  { key: 'adjusted', label: 'Adjusted', test: (x) => x.c.adj !== 0 },
  { key: 'credits', label: 'Credits', test: (x) => x.c.issued > 0 || x.c.creditApplied > 0 },
]

export function filterDef(key: FilterKey): FilterDef {
  const f = FILTERS.find((x) => x.key === key)
  if (!f) throw new TypeError(`unknown payments filter: ${String(key)}`)
  return f
}

export const filterCount = (inR: readonly InvoiceCalcRow[], key: FilterKey): number =>
  inR.filter(filterDef(key).test).length

/** Invoices matching the filter chip and the search text (id, client, vehicle, item names), newest first. */
export function visibleInvoices(
  inR: readonly InvoiceCalcRow[],
  filter: FilterKey,
  query: string,
): InvoiceCalcRow[] {
  const q = query.trim().toLowerCase()
  return inR
    .filter(filterDef(filter).test)
    .filter(
      (x) =>
        !q ||
        [x.t.id, x.t.client, x.t.vehicle, ...x.t.items.map((i) => i.name)]
          .join(' ')
          .toLowerCase()
          .includes(q),
    )
    .sort((a, b) => b.t.off - a.t.off || (b.t.id > a.t.id ? 1 : -1))
}

export interface InvoiceRowView {
  id: string
  date: string
  client: string
  vehicle: string
  items: string
  total: string
  status: string
  adjusted: boolean
  statusStyle: StyleObject
}

/** Status shown for an invoice: a pending refund overrides the calculated status. */
export const displayStatus = (c: InvoiceCalcRow['c']): string =>
  c.pending.length ? 'Refund pending' : c.status

/** Pill style for the displayed status (a pending refund borrows the "Partially paid" amber). */
export const displayPill = (c: InvoiceCalcRow['c']): StyleObject =>
  c.pending.length ? invoicePill('Partially paid') : invoicePill(c.status)

export function invoiceRowView({ t, c }: InvoiceCalcRow, anchor: LocalDay): InvoiceRowView {
  return {
    id: t.id,
    date: fmtDate(anchor, t.off) + ' · ' + t.time,
    client: t.client,
    vehicle: t.vehicle,
    items: t.items[0]!.name + (t.items.length > 1 ? ' +' + (t.items.length - 1) : ''),
    total: moneyCents(c.total),
    status: displayStatus(c),
    adjusted: c.adj !== 0,
    statusStyle: displayPill(c),
  }
}

/** Refunds waiting for approval, across all invoices, in invoice order. */
export function pendingApprovals(txs: readonly Invoice[]) {
  return txs.flatMap((t) =>
    t.events.filter((e) => e.type === 'refund' && e.status === 'pending').map((e) => ({ t, e })),
  )
}

/** Range to switch to so a pending refund's invoice is visible (Today and 7 days cover only the last week). */
export function rangeForPending(range: RangeKey, off: number): RangeKey {
  return off >= -6 ? (range === 'today' && off < 0 ? '7d' : range) : '30d'
}
