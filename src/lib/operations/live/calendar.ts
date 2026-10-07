// The Calendar view of the live Operations screen: day rows, the week strip and the month grid from the server's
// /calendar/day and /calendar/summary (real counts, closed days including today, reduced hours, outside-hours bookings).
// Dates are business dates ("2026-06-13") and the offset is days from the business today; the design's local-Date maths
// is replaced by UTC calendar arithmetic so the browser's own timezone never matters.
import type { CalendarDay, CalendarSummary, CalendarSummaryDay, OpsCard } from '@/data/ports/operations'
import { addDays, diffDays, parseIso } from '@/lib/tz'
import { DOW, DOW_LONG, MONTHS } from '@/lib/dates'
import { calendarSwipe } from '../gesture'
import type { GestureCtx } from '../gesture'
import type { CalMode } from '../types'
import { cardVM } from './board'
import { plural } from './fmt'
import type { BoardHandlers, BoardUi, GestureEvent } from './board'

type VM = Record<string, unknown>

/** Sunday = 0, for a business date. */
export const weekdayOf = (isoDate: string): number => {
  const [y, m, d] = parseIso(isoDate)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** The date `offset` days from `today`. */
export const dateAt = (today: string, offset: number): string => addDays(today, offset)
export const offsetOf = (today: string, isoDate: string): number => diffDays(today, isoDate)

const daysIn = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate()

export function dayHeading(isoDate: string, todayYear: number): string {
  const [y, m, d] = parseIso(isoDate)
  return `${DOW_LONG[weekdayOf(isoDate)]}, ${MONTHS[m - 1]} ${d}${y !== todayYear ? ', ' + y : ''}`
}

export function weekHeading(first: string, last: string): string {
  const [, m0, d0] = parseIso(first)
  const [y1, m1, d1] = parseIso(last)
  return `${MONTHS[m0 - 1]!.slice(0, 3)} ${d0} – ${m0 !== m1 ? MONTHS[m1 - 1]!.slice(0, 3) + ' ' : ''}${d1}, ${y1}`
}

/** First and last date a view needs from /calendar/summary. */
export function summaryRange(mode: CalMode, date: string): { from: string; to: string } {
  if (mode === 'day') return { from: date, to: date }
  if (mode === 'week') {
    const from = addDays(date, -weekdayOf(date))
    return { from, to: addDays(from, 6) }
  }
  const g = monthGrid(date)
  return { from: g.first, to: addDays(g.first, g.cells - 1) }
}

export function monthGrid(date: string): {
  y: number
  m: number
  first: string
  lead: number
  cells: number
} {
  const [y, m] = parseIso(date)
  const first = `${y}-${String(m).padStart(2, '0')}-01`
  const lead = weekdayOf(first)
  return { y, m, first: addDays(first, -lead), lead, cells: Math.ceil((lead + daysIn(y, m)) / 7) * 7 }
}

/** calNav(dir): the new date after a step; month mode lands on the first of the neighbouring month. */
export function navigate(mode: CalMode, date: string, dir: number): string {
  if (mode === 'day') return addDays(date, dir)
  if (mode === 'week') return addDays(date, 7 * dir)
  const [y, m] = parseIso(date)
  const t = new Date(Date.UTC(y, m - 1 + dir, 1))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-01`
}

export interface CalHandlers extends BoardHandlers {
  setMode(mode: CalMode): void
  /** Opens a date in the day view. */
  goTo(isoDate: string): void
  nav(dir: number): void
  goToday(): void
  swipeStart(e: GestureEvent): void
  swipeEnd(e: GestureEvent): void
}

export interface CalInputs {
  mode: CalMode
  /** The date being looked at. */
  date: string
  today: string
  day: CalendarDay | undefined
  summary: CalendarSummary | undefined
  ui: BoardUi
}

const modeBtn = (mode: CalMode, k: CalMode, label: string, h: CalHandlers): VM => ({
  label,
  onClick: () => h.setMode(k),
  style: {
    height: '36px',
    padding: '0 16px',
    borderRadius: '9px',
    fontSize: '13px',
    fontWeight: 700,
    background: mode === k ? 'var(--panel)' : 'transparent',
    color: mode === k ? 'var(--ink)' : 'var(--ink2)',
    boxShadow: mode === k ? 'var(--shadow)' : 'none',
    border: mode === k ? '1px solid var(--line)' : '1px solid transparent',
  },
})

const rowStyle = (hover: boolean): Record<string, string> => ({
  display: 'flex',
  gap: '16px',
  borderTop: '1px solid var(--line2)',
  padding: '11px 8px',
  minHeight: '66px',
  borderRadius: hover ? '12px' : '0',
  background: hover ? 'var(--accentSoft)' : 'transparent',
  outline: hover ? '2px dashed var(--accent)' : 'none',
  transition: 'background .12s ease',
})

export function calVM(i: CalInputs, h: CalHandlers): VM {
  const { mode, date, today, ui } = i
  const todayYear = parseIso(today)[0]
  const byDate = new Map<string, CalendarSummaryDay>((i.summary?.days ?? []).map((d) => [d.date, d]))
  const cell = (iso: string) => {
    const d = byDate.get(iso)
    return { iso, closed: d?.closed ?? null, n: d?.closed ? 0 : (d?.count ?? 0) }
  }
  let calLabel = ''
  let calSub = ''
  const calRows: VM[] = []
  const calWeek: VM[] = []
  const calMonth: VM[] = []
  let calClosed = false
  let calClosedReason = ''

  if (mode === 'day') {
    calLabel = dayHeading(date, todayYear)
    const day = i.day
    if (day?.dayInfo.closed) {
      calClosed = true
      calClosedReason = day.dayInfo.closed
      calSub = 'Closed'
    } else if (day) {
      calSub = day.sub
      for (const r of day.rows) {
        const hover = !!ui.dragId && ui.dropTarget === 'hr:' + r.hour
        const items = r.items.map((c) => cardVM(c, ui, h))
        calRows.push({
          time: r.time,
          ampm: r.ampm,
          items,
          empty: items.length === 0,
          drop: 'hr:' + r.hour,
          rowStyle: rowStyle(hover),
        })
      }
      if (day.outsideHours.length) {
        const items = day.outsideHours.map((c: OpsCard) => cardVM(c, ui, h))
        calRows.push({
          time: 'Outside',
          ampm: 'hours',
          items,
          empty: false,
          drop: '',
          rowStyle: rowStyle(false),
        })
      }
    }
  } else if (mode === 'week') {
    const { from } = summaryRange('week', date)
    const last = addDays(from, 6)
    calLabel = weekHeading(from, last)
    let tot = 0
    for (let k = 0; k < 7; k++) {
      const c = cell(addDays(from, k))
      tot += c.n
      const isT = c.iso === today
      calWeek.push({
        dow: DOW[k],
        num: String(parseIso(c.iso)[2]),
        count: String(c.n),
        countLabel: c.n === 1 ? 'appointment' : 'appointments',
        open: !c.closed,
        closed: !!c.closed,
        reason: c.closed || '',
        isToday: isT,
        onClick: () => h.goTo(c.iso),
        style: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          textAlign: 'left',
          padding: '16px',
          borderRadius: '16px',
          minHeight: '190px',
          background: c.closed ? 'var(--panel3)' : isT ? 'var(--accentSoft)' : 'var(--panel2)',
          border: '1px solid ' + (isT ? 'var(--accentBrd)' : 'var(--line)'),
          touchAction: 'manipulation',
        },
      })
    }
    calSub = plural(tot, 'appointment') + ' this week · tap a day to open it'
  } else {
    const g = monthGrid(date)
    calLabel = MONTHS[g.m - 1] + ' ' + g.y
    let tot = 0
    for (let k = 0; k < g.cells; k++) {
      const c = cell(addDays(g.first, k))
      const [, cm, cd] = parseIso(c.iso)
      const inM = cm === g.m
      if (inM) tot += c.n
      const isT = c.iso === today
      calMonth.push({
        num: String(cd),
        showCount: !c.closed && c.n > 0,
        countLabel: c.n + (c.n === 1 ? ' appt' : ' appts'),
        closed: !!c.closed && inM,
        reason: c.closed || '',
        onClick: () => h.goTo(c.iso),
        numStyle: {
          width: '28px',
          height: '28px',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 800,
          fontSize: '13px',
          background: isT ? 'var(--accent)' : 'transparent',
          color: isT ? '#fff' : inM ? 'var(--ink)' : 'var(--ink3)',
        },
        pillStyle: {
          fontSize: '12px',
          fontWeight: 800,
          padding: '4px 9px',
          borderRadius: '8px',
          background: inM ? 'var(--accentSoft)' : 'var(--panel3)',
          color: inM ? 'var(--accentInk)' : 'var(--ink3)',
        },
        style: {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          padding: '8px 9px 10px',
          borderRadius: '12px',
          textAlign: 'left',
          minHeight: '72px',
          background: c.closed && inM ? 'var(--panel3)' : inM ? 'var(--panel2)' : 'transparent',
          border: '1px solid ' + (isT ? 'var(--accentBrd)' : inM ? 'var(--line)' : 'var(--line2)'),
          opacity: inM ? 1 : 0.55,
          touchAction: 'manipulation',
        },
      })
    }
    calSub = plural(tot, 'appointment') + ' in ' + MONTHS[g.m - 1] + ' · tap a date to open it'
  }

  return {
    calLabel,
    calSub,
    calRows,
    calWeek,
    calMonth,
    calClosed,
    calClosedReason,
    calHint:
      mode === 'day' ? 'Drag or long-press to reschedule · swipe for next day' : 'Swipe or use ← → to move',
    calModes: [
      modeBtn(mode, 'day', 'Day', h),
      modeBtn(mode, 'week', 'Week', h),
      modeBtn(mode, 'month', 'Month', h),
    ],
    calDow: DOW,
    calIsDay: mode === 'day',
    calIsWeek: mode === 'week',
    calIsMonth: mode === 'month',
    calPrev: () => h.nav(-1),
    calNext: () => h.nav(1),
    calToday: () => h.goToday(),
    calSwipeStart: (e: GestureEvent) => h.swipeStart(e),
    calSwipeEnd: (e: GestureEvent) => h.swipeEnd(e),
  }
}

/** The swipe decision the class applies on pointer-up (re-exported so the class has one import). */
export { calendarSwipe }
export type { GestureCtx }
