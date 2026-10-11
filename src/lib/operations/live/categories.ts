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

/** "Today by category · 7 jobs", then one count per category (zeros included, as the server lists them). */
export function categoryCountVMs(counts: Counts | undefined | null): { label: string; items: VM[] } {
  if (!counts || !counts.items.length) return { label: '', items: [] }
  return {
    label: 'Today by category · ' + (counts.total === 1 ? '1 job' : counts.total + ' jobs'),
    items: counts.items.map((i) => ({
      key: i.key,
      label: i.label,
      count: String(i.count),
      swatch: swatchStyle(i.key === MIXED || i.key === NONE ? NEUTRAL : i.colour),
    })),
  }
}

/** The filter's buttons: All, then each category the snapshot lists (not "no category"); the chosen one is filled. */
export function categoryFilterVMs(
  counts: Counts | undefined | null,
  current: string,
  pick: (key: string) => void,
): VM[] {
  const items = (counts?.items ?? []).filter((i) => i.key !== NONE)
  if (!items.length) return []
  const style = (on: boolean): Style => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '7px',
    height: '36px',
    padding: '0 12px',
    borderRadius: '10px',
    fontSize: '13px',
    fontWeight: 700,
    background: on ? 'var(--accent)' : 'transparent',
    color: on ? '#fff' : 'var(--ink2)',
    whiteSpace: 'nowrap',
  })
  const known = current === 'all' || items.some((i) => i.key === current)
  const cur = known ? current : 'all'
  return [
    { key: 'all', label: 'All', swatch: { display: 'none' }, style: style(cur === 'all'), onClick: () => pick('all') },
    ...items.map((i) => ({
      key: i.key,
      label: i.label,
      swatch: swatchStyle(i.key === MIXED ? NEUTRAL : i.colour, 8),
      style: style(cur === i.key),
      onClick: () => pick(cur === i.key ? 'all' : i.key),
    })),
  ]
}
