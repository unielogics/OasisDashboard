// Checklist keys and progress. A key is `pkg|<task>` for the package list and `ad|<add-on>|<task>` for an add-on
// task; a key stays stable when the list is edited, which is what the pre-ticked fractions and toggles rely on.
import type { AddonLine, AddonTasks, Services } from './types'

export interface ChecklistItem {
  key: string
  label: string
}

export interface ChecklistSection {
  title: string
  kind: 'Package' | 'Add-on'
  items: ChecklistItem[]
}

/** checklistFor(a): the package section followed by one section per add-on (an add-on without tasks lists itself). */
export function checklistFor(
  a: { svc: string; addons?: ReadonlyArray<AddonLine | string> },
  services: Services,
  addonTasks: AddonTasks,
): ChecklistSection[] {
  const sv = services[a.svc]
  const out: ChecklistSection[] = [
    { title: a.svc, kind: 'Package', items: (sv ? sv.list : []).map((l) => ({ key: 'pkg|' + l, label: l })) },
  ]
  ;(a.addons || []).forEach((ad) => {
    const n = (typeof ad === 'string' ? ad : ad.name) || (ad as unknown as string)
    const t = addonTasks[n] || [n]
    out.push({ title: n, kind: 'Add-on', items: t.map((x) => ({ key: 'ad|' + n + '|' + x, label: x })) })
  })
  return out
}

export const sectionKeys = (sections: ChecklistSection[]): string[] =>
  sections.flatMap((s) => s.items.map((i) => i.key))

/** initChecks(svc, addons, fr): the first round(n * fr) keys are ticked. */
export function initChecks(
  svc: string,
  addons: ReadonlyArray<AddonLine | string>,
  fr: number,
  services: Services,
  addonTasks: AddonTasks,
): Record<string, boolean> {
  const keys = sectionKeys(checklistFor({ svc, addons }, services, addonTasks))
  const n = Math.round(keys.length * fr)
  const o: Record<string, boolean> = {}
  keys.slice(0, n).forEach((k) => (o[k] = true))
  return o
}

export interface ChecklistProgress {
  done: number
  total: number
  allDone: boolean
  pct: number
}

/** Counts of ticked tasks over the whole checklist (`pct` is rounded to a whole number). */
export function checklistProgress(
  sections: ChecklistSection[],
  checks: Record<string, boolean>,
): ChecklistProgress {
  const all = sectionKeys(sections)
  const done = all.filter((k) => checks[k]).length
  const total = all.length
  return {
    done,
    total,
    allDone: total > 0 && done === total,
    pct: total ? Math.round((done / total) * 100) : 0,
  }
}

/** checkAll(keys, val): tick every key, or untick (delete) every key. Returns a new map. */
export function setChecks(
  checks: Record<string, boolean>,
  keys: readonly string[],
  val: boolean,
): Record<string, boolean> {
  const c = { ...checks }
  keys.forEach((k) => {
    if (val) c[k] = true
    else delete c[k]
  })
  return c
}
