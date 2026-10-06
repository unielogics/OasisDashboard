// Holidays and closures: row labels and the fixture's stand-ins for the numbers the server computes.
import { DOW, MON } from './constants'
import type { Closure, NewClosure, StyleObject } from './types'

export interface ClosureLabels {
  mon: string
  day: string
  dow: string
  typeLabel: string
  past: boolean
  /** The design's fabricated hash (day of month) the fixture sub-lines use. */
  hash: number
}

export function closureLabels(c: Closure, today: string): ClosureLabels {
  const d = new Date(c.date + 'T12:00:00')
  return {
    mon: MON[d.getMonth()]!,
    day: String(d.getDate()),
    dow: DOW[d.getDay()]!,
    typeLabel: c.emergency
      ? 'Emergency'
      : c.type === 'closed'
        ? 'Closed all day'
        : 'Reduced · ' + c.from + ' – ' + c.to,
    past: c.date < today,
    hash: +c.date.slice(-2),
  }
}

/** The design's sub-line with its made-up counts (`hash % 4`, `hash % 3`). Fixture only. */
export const fabricatedClosureSub = (c: Pick<Closure, 'type' | 'date'>): string => {
  const hash = +c.date.slice(-2)
  return c.type === 'closed'
    ? 'Online booking blocked · ' + (hash % 4) + ' existing bookings to move'
    : 'Slots outside reduced hours hidden · ' + (hash % 3) + ' bookings affected'
}

/** The add form's "N customers are booked" line with the design's made-up count. Fixture only. */
export function fabricatedAffected(nc: Pick<NewClosure, 'date'>, today: string): string {
  const ncDay = nc.date ? +nc.date.slice(-2) : 0
  return nc.date && nc.date >= today
    ? (ncDay % 5) + 2 + ' customers are booked that day — they’ll get a reschedule link when you add this.'
    : ''
}

export const sortClosures = (list: Closure[]): Closure[] =>
  [...list].sort((a, b) => (a.date < b.date ? -1 : 1))

export type ClosureTagStyle = StyleObject

/** What `persistClosures` stores: the list without ids. */
export const closuresForStorage = (list: Closure[]): Omit<Closure, 'id'>[] =>
  list.map(({ id: _id, ...c }) => c)
