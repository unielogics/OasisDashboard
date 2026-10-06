// Calendar maths of the Operations screen: day offsets from the design's "today", the procedural day generator
// (seeded, so a day always looks the same), per-day counts and the day/week/month layouts. Date arithmetic is local
// civil-date arithmetic on purpose (see lib/dates.ts); nothing here reads the clock.
import { dayCount, rng } from '../calendar'
import { DOW, DOW_LONG, MONTHS, dateFor, dayInfo, iso, offFor } from '../dates'
import type { CivilDate, DayInfo } from '../dates'
import { fmtT } from '../time'
import { hydrateGenerated } from './hydrate'
import type { Catalog } from './hydrate'
import type { Appt, BaseAppt, CalMode, Closure, DayHours, HistoryDef, VehicleDef } from './types'

export { DOW, DOW_LONG, MONTHS, dateFor, dayInfo, iso, offFor, dayCount, rng }
export type { CivilDate, DayInfo }

export const STAFF_ROTATION = ['Marco R.', 'Lena K.', 'Sofia D.'] as const

export interface Pools {
  names: readonly string[]
  vehicles: readonly VehicleDef[]
}

export interface Schedule {
  hours: readonly DayHours[]
  closures: readonly Closure[]
}

/** dayInfo for a date with the screen's own settings, falling back to the defaults the design ships. */
export const infoFor = (d: Date, sch: Schedule): DayInfo => dayInfo(d, sch.closures, sch.hours)

/** A generated day's raw appointments in generation order. The random draws happen in the design's order. */
export function generateDayBase(
  o: number,
  base: CivilDate,
  sch: Schedule,
  cat: Catalog,
  pools: Pools,
): BaseAppt[] {
  const inf = infoFor(dateFor(o, base), sch)
  if (inf.closed) return []
  const { n, rnd } = dayCount(o, !!inf.note, base)
  const start = Math.max(inf.h0! * 60, o === 1 ? 11 * 60 : 0)
  const end = Math.max(start, inf.h1! * 60 - 60)
  const slots: number[] = []
  for (let m = start; m <= end; m += 30) slots.push(m)
  const svcs = Object.keys(cat.services)
  const past = o < 0
  const picks = Array.from({ length: n }, () => slots[Math.floor(rnd() * slots.length)]!).sort(
    (x, y) => x - y,
  )
  return picks.map((m, i) => {
    const nm = pools.names[Math.floor(rnd() * pools.names.length)]!
    const v = pools.vehicles[Math.floor(rnd() * pools.vehicles.length)]!
    return {
      id: 'g' + o + '_' + i,
      day: o,
      time: fmtT(m),
      status: past ? 'completed' : rnd() < 0.7 ? 'confirmed' : 'booked',
      staff: STAFF_ROTATION[i % 3]!,
      cust: {
        name: nm,
        phone: '(305) ' + (200 + Math.floor(rnd() * 700)) + '-' + (1000 + Math.floor(rnd() * 8999)),
      },
      veh: {
        year: v[0],
        make: v[1],
        model: v[2],
        color: v[3],
        plate: v[1].slice(0, 3).toUpperCase() + '-' + (1000 + Math.floor(rnd() * 8999)),
      },
      svc: svcs[Math.floor(rnd() * svcs.length)]!,
      bay: (i % 2) + 1,
      member: rnd() < 0.35 ? ['Essential', 'Premium', 'Executive'][Math.floor(rnd() * 3)]! : null,
      pay: past ? 'paid' : rnd() < 0.45 ? 'paid' : rnd() < 0.5 ? 'deposit' : 'unpaid',
      deposit: 25,
      addons: rnd() < 0.4 ? [cat.addons[Math.floor(rnd() * cat.addons.length)]![0]] : [],
      tip: past ? 5 * Math.floor(rnd() * 4) : 0,
      pickup: past ? 'collected' : null,
    } satisfies BaseAppt
  })
}

/** genDay(o) before overlays: the hydrated appointments of a generated day. */
export function generateDay(
  o: number,
  base: CivilDate,
  sch: Schedule,
  cat: Catalog,
  pools: Pools,
  hist: readonly HistoryDef[],
): Appt[] {
  return generateDayBase(o, base, sch, cat, pools).map((a, i) => hydrateGenerated(a, i, cat, hist))
}

/** countFor(o): appointments the calendar shows for a day (today's real ones, tomorrow's real plus generated). */
export function countFor(o: number, appts: readonly Appt[], base: CivilDate, sch: Schedule): number {
  if (o === 0) return appts.filter((a) => a.day === 0).length
  const inf = infoFor(dateFor(o, base), sch)
  if (inf.closed) return 0
  return dayCount(o, !!inf.note, base).n + (o === 1 ? appts.filter((a) => a.day === 1).length : 0)
}

/** calNav(dir): the new offset after a step; month mode lands on the first of the neighbouring month. */
export function navOffset(mode: CalMode, offset: number, dir: number, base: CivilDate): number {
  if (mode === 'day') return offset + dir
  if (mode === 'week') return offset + 7 * dir
  const d = dateFor(offset, base)
  return offFor(new Date(d.getFullYear(), d.getMonth() + dir, 1), base)
}

/** The hour label of a day row: 12 -> "12", 13 -> "1" with PM/AM beside it. */
export function hourLabel(h: number): { time: string; ampm: string } {
  const ap = h >= 12 ? 'PM' : 'AM'
  let hh = h % 12
  if (hh === 0) hh = 12
  return { time: String(hh), ampm: ap }
}

/** Day heading: "Saturday, June 13", with the year when it is not the design year. */
export function dayHeading(cd: Date, currentYear: number): string {
  return (
    DOW_LONG[cd.getDay()] +
    ', ' +
    MONTHS[cd.getMonth()] +
    ' ' +
    cd.getDate() +
    (cd.getFullYear() !== currentYear ? ', ' + cd.getFullYear() : '')
  )
}

/** Week heading: "Jun 7 – 13, 2026" (the second month is named only when the week crosses a month). */
export function weekHeading(e0: Date, e1: Date): string {
  return (
    MONTHS[e0.getMonth()]!.slice(0, 3) +
    ' ' +
    e0.getDate() +
    ' – ' +
    (e0.getMonth() !== e1.getMonth() ? MONTHS[e1.getMonth()]!.slice(0, 3) + ' ' : '') +
    e1.getDate() +
    ', ' +
    e1.getFullYear()
  )
}

/** Month grid: the offset of its first cell, the cell count (whole weeks) and the leading blanks. */
export function monthGrid(
  cd: Date,
  base: CivilDate,
): { y: number; m: number; firstOffset: number; lead: number; cells: number } {
  const y = cd.getFullYear()
  const m = cd.getMonth()
  const first = new Date(y, m, 1)
  const fo = offFor(first, base)
  const lead = first.getDay()
  const dim = new Date(y, m + 1, 0).getDate()
  return { y, m, firstOffset: fo, lead, cells: Math.ceil((lead + dim) / 7) * 7 }
}

/** The design's hour window for a day row range when the day has no info (it always has one when open). */
export const rowRange = (inf: DayInfo): [number, number] => [inf.h0 || 8, inf.h1 || 17]
