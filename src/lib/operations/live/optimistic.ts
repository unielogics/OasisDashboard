// Cache patches for the toggles that show at once (checklist ticks). Pure: the file in, the next file out; the server's
// answer replaces them when the family refetches, and command() restores the old file if the request is refused.
import type { AppointmentFile } from '@/data/ports/operations'

/** The file with the given tasks ticked (or cleared), and every count the checklist shows recomputed. */
export function applyChecklist(
  file: AppointmentFile,
  itemIds: readonly string[],
  done: boolean,
): AppointmentFile {
  const ids = new Set(itemIds)
  let total = 0
  let ticked = 0
  const sections = file.checklist.sections.map((s) => {
    const items = s.items.map((i) => (ids.has(i.id) ? { ...i, done } : i))
    const d = items.filter((i) => i.done).length
    total += items.length
    ticked += d
    return { ...s, items, done: d, total: items.length, allDone: items.length > 0 && d === items.length }
  })
  return {
    ...file,
    checklist: {
      ...file.checklist,
      sections,
      done: ticked,
      total,
      pct: total === 0 ? 0 : Math.round((ticked / total) * 100),
      allDone: total > 0 && ticked === total,
    },
  }
}
