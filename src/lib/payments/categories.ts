// Categories in the live Payments screen (ADR 0160 plan K; DEVIATIONS DV-224, DV-225): the summary split by visit
// category (`byCategory` of GET /payments/summary: each invoice once, gross / net / outstanding, entries that add up to
// the KPIs) and the category chip of each row (`category` of the row: the visit's one word, `mixed` for two). Pure.
import { MIXED, NONE, NEUTRAL, categoryChips, swatchStyle } from '../categories'
import type { CategoryInfo } from '../categories'
import { money0 } from './cents'
import type { InvoiceListRow, PaymentsSummary } from '@/data/ports/payments'

type VM = Record<string, unknown>

/** The categories the summary names, as the rows' chip colours. */
export function categoryInfoOfSummary(s: PaymentsSummary | undefined): CategoryInfo[] {
  return (s?.byCategory ?? []).map((c) => ({ key: c.key, label: c.label, colour: c.colour }))
}

/** "By category · Today", then one entry per category: gross, invoice count and what is still open. */
export function categorySplitVMs(s: PaymentsSummary | undefined): { label: string; items: VM[] } {
  const list = s?.byCategory ?? []
  if (!list.length) return { label: '', items: [] }
  return {
    label: 'By category · ' + (s?.range.label ?? ''),
    items: list.map((c) => ({
      key: c.key,
      label: c.label,
      value: money0(c.grossCents),
      sub:
        (c.count === 1 ? '1 invoice' : c.count + ' invoices') +
        (c.outstandingCents > 0 ? ' · ' + money0(c.outstandingCents) + ' open' : ''),
      swatch: swatchStyle(c.key === MIXED || c.key === NONE ? NEUTRAL : c.colour),
      dim: c.count === 0,
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        minHeight: '34px',
        padding: '5px 12px',
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: '11px',
        opacity: c.count === 0 ? 0.55 : 1,
      },
    })),
  }
}

/** The row's chip: its one category word in the category's colour; nothing for an invoice with no category. */
export function rowCategory(
  r: Pick<InvoiceListRow, 'category' | 'categories'>,
  cats: readonly CategoryInfo[],
  dark: boolean,
): { show: boolean; label: string; style: VM } {
  const key = r.category ?? (r.categories && r.categories.length === 1 ? r.categories[0]! : null)
  if (!key || key === NONE) return { show: false, label: '', style: {} }
  const chip = categoryChips([key], cats, dark, 'row')[0]!
  return { show: true, label: chip.label, style: chip.style }
}
