// Categories on the live Operations board (ADR 0160 plan K; DEVIATIONS DV-422..DV-424): the per-category counts under the
// KPI tiles (today's jobs, from the server's `categoryCounts`, never from the board, which follows the window and the
// search), the board's category filter and the colours the chips take. Pure: values in, template values out.
import { MIXED, NONE, NEUTRAL, swatchStyle } from '@/lib/categories'
import type { CategoryInfo } from '@/lib/categories'
import type { OpsSnapshot } from '@/data/ports/operations'
import type { Style } from '../types'

type VM = Record<string, unknown>
type Counts = NonNullable<OpsSnapshot['categoryCounts']>

/** The categories the snapshot names (every active one, then mixed), as chip colour and label sources. */
export function categoryInfoOf(snap: Pick<OpsSnapshot, 'categoryCounts'> | undefined | null): CategoryInfo[] {
  const items = snap?.categoryCounts?.items ?? []
  return items.map((i) => ({ key: i.key, label: i.label, colour: i.colour }))
}

/**
 * "Today by category · 7 jobs", then one count per category (zeros included, as the server lists them), preceded by All.
 * Each count is also the board's category filter (DV-423): a click shows only the visits holding that category on the
 * Timeline and Staff views, a second click (or All) shows everything again.
 */
export function categoryCountVMs(
  counts: Counts | undefined | null,
  current = 'all',
  pick: (key: string) => void = () => {},
): { label: string; items: VM[] } {
  const items = (counts?.items ?? []).filter((i) => i.key !== NONE || i.count > 0)
  if (!counts || !items.length) return { label: '', items: [] }
  const known = current === 'all' || items.some((i) => i.key === current)
  const cur = known ? current : 'all'
  const style = (on: boolean): Style => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '7px',
    height: '30px',
    padding: '0 11px',
    background: on ? 'var(--accentSoft)' : 'var(--panel)',
    border: '1px solid ' + (on ? 'var(--accentBrd)' : 'var(--line)'),
    borderRadius: '9px',
    fontSize: '12px',
    fontWeight: 700,
    color: on ? 'var(--accentInk)' : 'var(--ink2)',
    whiteSpace: 'nowrap',
  })
  return {
    label: 'Today by category · ' + (counts.total === 1 ? '1 job' : counts.total + ' jobs'),
    items: [
      {
        key: 'all',
        label: 'All',
        count: '',
        swatch: { display: 'none' },
        style: style(cur === 'all'),
        title: 'Show every visit on the board',
        onClick: () => pick('all'),
      },
      ...items.map((i) => ({
        key: i.key,
        label: i.label,
        count: String(i.count),
        swatch: swatchStyle(i.key === MIXED || i.key === NONE ? NEUTRAL : i.colour),
        style: style(cur === i.key),
        title: 'Show only ' + i.label + ' on the board',
        onClick: () => pick(cur === i.key || i.key === NONE ? 'all' : i.key),
      })),
    ],
  }
}
