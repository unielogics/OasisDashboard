// Working hours: the weekly total and the dirty check of the Save bar.
import { ORDER } from './constants'
import { dayLength, hoursText } from './format'
import type { HoursDay } from './types'

export interface HourRowView {
  day: string
  open: boolean
  closed: boolean
  from: string
  to: string
  len: string
}

/** Rows in display order (Monday first) and the week total in minutes. */
export function hourRows(
  hours: HoursDay[],
  dayNames: readonly string[],
): { rows: HourRowView[]; total: number } {
  let total = 0
  const rows = ORDER.map((d) => {
    const h = hours[d]!
    const len = dayLength(h)
    total += len
    return {
      day: dayNames[d]!,
      open: h.open,
      closed: !h.open,
      from: h.from,
      to: h.to,
      len: hoursText(len),
    }
  })
  return { rows, total }
}

export const hoursDirty = (hours: HoursDay[], savedHours: string): boolean =>
  JSON.stringify(hours) !== savedHours

/** "Copy Monday to weekdays": Monday's {open, from, to} onto Tuesday to Friday only. */
export function copyMondayToWeekdays(hours: HoursDay[]): HoursDay[] {
  const out = hours.map((h) => ({ ...h }))
  ;[2, 3, 4, 5].forEach((d) => {
    out[d] = { ...out[1]! }
  })
  return out
}
