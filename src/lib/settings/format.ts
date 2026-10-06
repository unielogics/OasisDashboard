// Small formatters and steppers of the Settings design.
import { fmtTRaw, parseT } from '../time'

/** One 30-minute stepper click on a time label, clamped to 5:00 AM .. 11:30 PM. */
export const step = (t: string, d: number): string =>
  fmtTRaw(Math.max(300, Math.min(1410, parseT(t) + d * 30)))

/** "pay.refund" -> "refund". */
export const limKey = (p: string): string => p.split('.')[1]!

/** null is "No limit"; otherwise "≤ $1,000". */
export const limLabel = (v: number | null): string =>
  v === null ? 'No limit' : '≤ $' + v.toLocaleString('en-US')

/** The design's `(len/60)+' hrs'` for a number of minutes ("10 hrs", "10.5 hrs"). */
export const hoursText = (minutes: number): string => minutes / 60 + ' hrs'

/** Minutes a day is open: 0 when closed, never negative. */
export const dayLength = (h: { open: boolean; from: string; to: string }): number =>
  h.open ? Math.max(0, parseT(h.to) - parseT(h.from)) : 0

export const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many)
