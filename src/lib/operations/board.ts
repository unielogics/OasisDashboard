// Selecting, ordering and grouping appointments for the timeline, bay board, staff and pickup columns.
import { parseT } from '../time'
import { absMin, inFacility } from './status'
import type { Appt, RangeName } from './types'

/** The search box: case-insensitive substring over name, phone, vehicle, plate and service. Empty matches all. */
export function searchMatcher(search: string): (a: Appt) => boolean {
  const q = search.trim().toLowerCase()
  return (a) =>
    !q ||
    [a.cust.name, a.cust.phone, a.veh.make, a.veh.model, a.veh.color, a.veh.plate, a.svc]
      .join(' ')
      .toLowerCase()
      .includes(q)
}

/** Search plus range. Only `today` and `tomorrow` filter; `next24` and `week` show everything, as in the design. */
export function selectPool(appts: readonly Appt[], search: string, range: RangeName | string): Appt[] {
  let pool = appts.filter(searchMatcher(search))
  if (range === 'today') pool = pool.filter((a) => a.day === 0)
  if (range === 'tomorrow') pool = pool.filter((a) => a.day === 1)
  return pool
}

/** Chronological, VIP first within the same minute. */
export function sortPool(pool: readonly Appt[]): Appt[] {
  return [...pool].sort((x, y) => absMin(x, parseT) - absMin(y, parseT) || (y.vip ? 1 : 0) - (x.vip ? 1 : 0))
}

export interface TimelineGroup<T = Appt> {
  key: string
  day: number
  time: string
  ampm: string
  items: T[]
  dividerLabel: string
  /** True when the divider text is shown (the first group, or the first group of tomorrow). */
  showDivider: boolean
}

/** Upcoming jobs only: in-bay cars live in the Bays column and finished ones in Completed. */
export const upcoming = (sorted: readonly Appt[]): Appt[] =>
  sorted.filter((a) => a.status !== 'completed' && !inFacility(a))

/**
 * Groups consecutive appointments with the same day and time. The divider reads "Tomorrow" at the first day-1 group and
 * "Today" on the very first group, which also labels a day-1 first group "Today" when nothing is left for today
 * (kept: the design's quirk, fixed in the live stage).
 */
export function groupTimeline<T extends Pick<Appt, 'day' | 'time'>>(list: readonly T[]): TimelineGroup<T>[] {
  const groups: TimelineGroup<T>[] = []
  let lastKey: string | null = null
  let lastDay: number | null = null
  list.forEach((a) => {
    const key = a.day + '|' + a.time
    if (key !== lastKey) {
      const [hr, ap] = a.time.split(' ')
      const tomorrowStart = a.day === 1 && lastDay !== 1
      groups.push({
        key,
        day: a.day,
        time: hr!,
        ampm: ap!,
        items: [],
        dividerLabel: tomorrowStart ? 'Tomorrow' : groups.length === 0 ? 'Today' : '',
        showDivider: tomorrowStart || groups.length === 0,
      })
      lastKey = key
      lastDay = a.day
    }
    groups[groups.length - 1]!.items.push(a)
  })
  return groups
}

export const occupantOf = (appts: readonly Appt[], bay: number): Appt | undefined =>
  appts.find((a) => a.bay === bay && inFacility(a))

export const nextForBay = (sorted: readonly Appt[], bay: number): Appt | undefined =>
  sorted.find((a) => a.bay === bay && !inFacility(a) && a.status !== 'completed')

/** Up Next: the first six not in a bay and not finished, VIP first (stable). */
export const queueOf = (sorted: readonly Appt[]): Appt[] =>
  sorted
    .filter((a) => !inFacility(a) && a.status !== 'completed' && a.status !== 'paid')
    .sort((x, y) => (y.vip ? 1 : 0) - (x.vip ? 1 : 0))
    .slice(0, 6)

/** Appointments with a geofence ETA still to arrive, VIP first then soonest. */
export const arrivalsOf = (appts: readonly Appt[]): Appt[] =>
  appts
    .filter((a) => a.eta && ['confirmed', 'booked'].includes(a.status))
    .sort((x, y) => (y.vip ? 1 : 0) - (x.vip ? 1 : 0) || x.eta! - y.eta!)

export interface BayProgress {
  elapMin: number
  elapSec: number
  /** Percent of the estimated duration used, capped at 100. */
  pct: number
  /** Planned finish, in minutes since midnight (start time + duration). */
  etaMin: number
}

export function bayProgress(occ: Pick<Appt, 'startedAt' | 'dur' | 'time'>, nowMs: number): BayProgress {
  const elapsedMs = occ.startedAt ? nowMs - occ.startedAt : 0
  const elapMin = Math.floor(elapsedMs / 60000)
  const elapSec = Math.floor(elapsedMs / 1000) % 60
  const pct = Math.min(100, occ.startedAt ? (elapsedMs / 60000 / occ.dur) * 100 : 0)
  return { elapMin, elapSec, pct, etaMin: parseT(occ.time) + occ.dur }
}
