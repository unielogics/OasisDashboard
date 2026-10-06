// Calendar-date helpers reproduced from the design logic classes. They use local-time Date arithmetic on purpose
// (the originals do): a civil date and a day offset are timezone-free, so only whole-day maths is done here.
// Where the originals read the wall clock, the business date comes from tz.ts instead.
import { parseT } from './time'

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
export const DOW_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

export interface CivilDate {
  y: number
  /** 0-based month, like Date. */
  m: number
  d: number
}

/** The design's frozen "today" (Saturday, June 13 2026). Only the fixture build and the differential tests use it. */
export const DESIGN_BASE: CivilDate = { y: 2026, m: 5, d: 13 }

/** Operations dateFor(o) / Payments dateOf(off): local midnight, `offset` days after `base`. */
export const dateFor = (offset: number, base: CivilDate = DESIGN_BASE): Date =>
  new Date(base.y, base.m, base.d + offset)

/** Operations iso(d): "2026-06-13". */
export const iso = (d: Date): string =>
  d.getFullYear() +
  '-' +
  String(d.getMonth() + 1).padStart(2, '0') +
  '-' +
  String(d.getDate()).padStart(2, '0')

/** Operations offFor(d): whole days from `base` to the local calendar day of `d`. */
export const offFor = (d: Date, base: CivilDate = DESIGN_BASE): number =>
  Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date(base.y, base.m, base.d).getTime()) /
      86400000,
  )

/** The Operations calendar day heading: "Saturday, June 13" (the year is added when it is not `currentYear`). */
export const calLabel = (d: Date, currentYear = DESIGN_BASE.y): string =>
  DOW_LONG[d.getDay()] +
  ', ' +
  MONTHS[d.getMonth()] +
  ' ' +
  d.getDate() +
  (d.getFullYear() !== currentYear ? ', ' + d.getFullYear() : '')

/** Payments fmtDate(off): "Today", "Yesterday" or "Jun 12". */
export function fmtDateOffset(off: number, base: CivilDate = DESIGN_BASE): string {
  if (off === 0) return 'Today'
  if (off === -1) return 'Yesterday'
  return dateFor(off, base).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ---- opening hours -----------------------------------------------------------------------------------------------

export interface DayHours {
  open: boolean
  from: string
  to: string
}
export interface Closure {
  date: string
  name: string
  type: 'closed' | 'reduced'
  from?: string
  to?: string
}
export type DayInfo =
  | { closed: string; h0?: undefined; h1?: undefined; from?: undefined; to?: undefined; note?: undefined }
  | { closed?: undefined; h0: number; h1: number; from: string; to: string; note: string }

/** Operations dayInfo(d): closed (with a reason) or the open window for that calendar day. */
export function dayInfo(d: Date, closures: readonly Closure[], hours: readonly DayHours[]): DayInfo {
  const cl = closures.find((c) => c.date === iso(d))
  if (cl && cl.type === 'closed') return { closed: cl.name }
  const h = hours[d.getDay()]
  if (!h || !h.open) return { closed: 'Regular day off' }
  const f = cl ? cl.from! : h.from
  const t = cl ? cl.to! : h.to
  return {
    h0: Math.floor(parseT(f) / 60),
    h1: Math.ceil(parseT(t) / 60),
    from: f,
    to: t,
    note: cl ? cl.name + ' · reduced hours' : '',
  }
}
