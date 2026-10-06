import type { LocalDay } from './types'

/** The local calendar date `off` days from the anchor day (the design's dateOf()). */
export const dateOf = (anchor: LocalDay, off: number): Date => new Date(anchor.y, anchor.m, anchor.d + off)

/** "Today", "Yesterday", else "Jun 7". */
export function fmtDate(anchor: LocalDay, off: number): string {
  if (off === 0) return 'Today'
  if (off === -1) return 'Yesterday'
  return dateOf(anchor, off).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
