// Turning a seed or generated appointment into the hydrated record the board works on.
import { initChecks } from './checklist'
import { FRAC } from './status'
import type { Appt, AddonCatalog, AddonTasks, BaseAppt, HistoryDef, HistoryRow, Services } from './types'

export interface Catalog {
  services: Services
  addons: AddonCatalog
  addonTasks: AddonTasks
}

const addonLines = (names: readonly string[] | undefined, addons: AddonCatalog) =>
  (names || []).map((n) => {
    const f = addons.find((x) => x[0] === n)
    return { name: n, price: f ? f[1] : 0 }
  })

const historyRows = (pool: readonly HistoryDef[], count: number, months: readonly string[]): HistoryRow[] =>
  pool.slice(0, count).map((h, i) => ({
    day: String(2 + i * 5).padStart(2, '0'),
    mon: months[i]!,
    service: h[0],
    note: h[1],
    amount: '$' + h[2],
    fav: h[3],
  }))

/**
 * The seed hydration of the board (state initialiser): checklist pre-ticked by status, `startedAt` from `startedAgo`,
 * photo counts by status, `visits = 3 + idx % 9` and three or four history rows.
 */
export function hydrateSeed(
  a: BaseAppt,
  idx: number,
  cat: Catalog,
  histPool: readonly HistoryDef[],
  nowMs: number,
): Appt {
  const sv = cat.services[a.svc]!
  const visitN = 3 + (idx % 9)
  return {
    ...a,
    whatsapp: true,
    price: sv.price,
    dur: sv.dur,
    baseList: sv.list,
    addons: addonLines(a.addons, cat.addons),
    checks: initChecks(a.svc, a.addons || [], FRAC[a.status] ?? 0, cat.services, cat.addonTasks),
    notes: a.notes || 'No special instructions on file.',
    special: a.special || null,
    notified: a.notified !== undefined ? a.notified : true,
    pickup: a.pickup || (a.status === 'completed' ? 'pending' : null),
    tip: a.tip || 0,
    startedAt: a.startedAgo ? nowMs - a.startedAgo * 60000 : null,
    photos: {
      arrival: a.status === 'booked' ? 0 : 2,
      before: ['cleaning', 'completed'].includes(a.status) ? 3 : 0,
      after: ['completed'].includes(a.status) ? 2 : 0,
      issue: idx % 4 === 0 ? 1 : 0,
    },
    visits: visitN,
    history: historyRows(histPool, 3 + (idx % 2), ['MAY', 'APR', 'MAR', 'FEB']),
    messages: null,
    log: null,
  }
}

/** The hydration of a generated calendar day (a plain default record; nothing started, one fixed history). */
export function hydrateGenerated(a: BaseAppt, idx: number, cat: Catalog, hist: readonly HistoryDef[]): Appt {
  const sv = cat.services[a.svc]!
  const addons = addonLines(a.addons, cat.addons)
  return {
    ...a,
    whatsapp: true,
    price: sv.price,
    dur: sv.dur,
    baseList: sv.list,
    addons,
    checks: initChecks(a.svc, addons, a.status === 'completed' ? 1 : 0, cat.services, cat.addonTasks),
    notes: 'No special instructions on file.',
    special: null,
    notified: true,
    startedAt: null,
    photos: {
      arrival: a.status === 'booked' ? 0 : 2,
      before: a.status === 'completed' ? 3 : 0,
      after: a.status === 'completed' ? 2 : 0,
      issue: 0,
    },
    visits: 3 + (idx % 9),
    history: historyRows(hist, hist.length, ['MAY', 'APR', 'MAR']),
    messages: null,
    log: null,
  } as Appt
}
