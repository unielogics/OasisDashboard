// Pure helpers of Settings → Shop floor (ADR 0180, design 6.6; DEVIATIONS DV-1009..DV-1011): the shop code's line, the
// code form's checks, device states and "last seen" lines, the recent kiosk events, and the Team activity report's date
// ranges, figures and step words. Times are in the shop's time zone; money is integer cents.
import type {
  ActivityTotals,
  KioskDevice,
  KioskOverview,
  KioskRecent,
  StaffEventKind,
} from '@/data/ports/kiosk-api'
import { formatCents } from '@/lib/money'
import { addDays, businessClock, businessToday, diffDays, parseIso } from '@/lib/tz'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "Oct 13" (and the year when it is not this year's). */
export function shortDate(isoDate: string, today?: string): string {
  const [y, m, d] = parseIso(isoDate)
  const ty = today ? parseIso(today)[0] : y
  return MONTHS[m - 1] + ' ' + d + (y !== ty ? ', ' + y : '')
}

/** "Oct 13, 2:14 PM" in the shop's time zone. */
export function stamp(iso: string | null | undefined, tz: string, today?: string): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  return shortDate(businessToday(ms, tz), today) + ', ' + businessClock(ms, tz)
}

// ---- the shop code -----------------------------------------------------------------------------------------------------

/** "Set Oct 13 by Rafael M. · 12 days ago", or that there is none yet. */
export function codeLine(code: KioskOverview['code'], tz: string, today: string): string {
  if (!code.set || !code.setAt) return 'No shop code yet. Set one before turning kiosk mode on.'
  const ms = Date.parse(code.setAt)
  const day = Number.isFinite(ms) ? shortDate(businessToday(ms, tz), today) : ''
  const age = code.ageDays === null ? '' : code.ageDays === 0 ? 'today' : code.ageDays === 1 ? '1 day ago' : code.ageDays + ' days ago'
  return ['Set ' + day + (code.setBy ? ' by ' + code.setBy : ''), age].filter(Boolean).join(' · ')
}

/** A code older than this gets a nudge to change it (people who left may know it). */
export const CODE_NUDGE_DAYS = 90

/** The form's own checks before it asks the server (which has the full rules). */
export function codeFormProblem(code: string, again: string): string | null {
  const c = code.trim()
  if (!/^\d{8}$/.test(c)) return 'Enter exactly 8 digits.'
  if (c.startsWith('0218')) return 'A code can’t start with 0218.'
  if (again.trim() !== c) return 'The two codes don’t match.'
  return null
}

/** "1234 5678": a generated code, shown once, easier to read aloud in two halves. */
export const groupCode = (code: string): string => (code.length === 8 ? code.slice(0, 4) + ' ' + code.slice(4) : code)

// ---- devices -------------------------------------------------------------------------------------------------------

export type Tone = 'green' | 'amber' | 'red' | 'grey'

export function deviceState(d: Pick<KioskDevice, 'state' | 'locksAt' | 'failedAttempts'>, tz: string): {
  label: string
  tone: Tone
} {
  switch (d.state) {
    case 'unlocked': {
      const ms = d.locksAt ? Date.parse(d.locksAt) : NaN
      return {
        label: Number.isFinite(ms) ? 'Unlocked · locks ' + businessClock(ms, tz) : 'Unlocked',
        tone: 'green',
      }
    }
    case 'locked_out':
      return { label: 'Locked out · too many wrong codes', tone: 'red' }
    case 'revoked':
      return { label: 'Removed', tone: 'grey' }
    default:
      return {
        label: d.failedAttempts > 0 ? 'Locked · ' + d.failedAttempts + ' wrong ' + (d.failedAttempts === 1 ? 'code' : 'codes') : 'Locked',
        tone: d.failedAttempts > 0 ? 'amber' : 'grey',
      }
  }
}

/** "Chrome on Android" from a user agent (a hint for the manager, never a security decision). */
export function browserOf(ua: string | null | undefined): string {
  if (!ua) return ''
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /(Chrome|CriOS)\//.test(ua)
      ? 'Chrome'
      : /(Firefox|FxiOS)\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser'
  const os = /iPad/.test(ua)
    ? 'iPad'
    : /iPhone/.test(ua)
      ? 'iPhone'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /CrOS/.test(ua)
              ? 'Chromebook'
              : /Linux/.test(ua)
                ? 'Linux'
                : ''
  return os ? browser + ' on ' + os : browser
}

/** "Last seen Oct 13, 2:14 PM · 100.64.1.7 · Chrome on Android". */
export function lastSeenLine(d: Pick<KioskDevice, 'lastSeenAt' | 'lastIp' | 'lastUa'>, tz: string, today: string): string {
  const parts = [
    d.lastSeenAt ? 'Last seen ' + stamp(d.lastSeenAt, tz, today) : 'Not used yet',
    d.lastIp ?? '',
    browserOf(d.lastUa),
  ]
  return parts.filter(Boolean).join(' · ')
}

export function recentLine(r: KioskRecent, tz: string, today: string): string {
  return [stamp(r.at, tz, today), r.label, r.deviceName ?? '', r.by ? 'by ' + r.by : ''].filter(Boolean).join(' · ')
}

/** A device name: what the form keeps (trimmed, at most 40 characters, the server's rule). */
export function deviceNameProblem(name: string): string | null {
  const n = name.trim()
  if (!n) return 'Give this tablet a name, like “Front desk tablet”.'
  if (n.length > 40) return 'Use at most 40 characters.'
  return null
}

// ---- Team activity ------------------------------------------------------------------------------------------------------

export type RangeKey = 'today' | 'yesterday' | 'week' | 'lastWeek' | 'custom'
export const RANGE_CHIPS: ReadonlyArray<readonly [RangeKey, string]> = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['week', 'This week'],
  ['lastWeek', 'Last week'],
  ['custom', 'Custom'],
]
/** The report covers at most 31 days (the server's limit). */
export const MAX_RANGE_DAYS = 31

const weekday = (iso: string): number => {
  const [y, m, d] = parseIso(iso)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** The dates of a chip (weeks run Sunday to Saturday, like the Operations calendar). */
export function rangeOf(key: Exclude<RangeKey, 'custom'>, today: string): { from: string; to: string } {
  switch (key) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday': {
      const y = addDays(today, -1)
      return { from: y, to: y }
    }
    case 'week':
      return { from: addDays(today, -weekday(today)), to: today }
    case 'lastWeek': {
      const sun = addDays(today, -weekday(today) - 7)
      return { from: sun, to: addDays(sun, 6) }
    }
  }
}

/** A custom range the server will take: two dates, in order, at most 31 days. */
export function customRangeProblem(from: string, to: string): string | null {
  const ok = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)
  if (!ok(from) || !ok(to)) return 'Pick a start and an end date.'
  if (to < from) return 'The end date is before the start.'
  if (diffDays(from, to) + 1 > MAX_RANGE_DAYS) return 'Pick at most 31 days.'
  return null
}

/** "Oct 13" or "Oct 6 – Oct 12". */
export function rangeLabel(from: string, to: string, today: string): string {
  return from === to ? shortDate(from, today) : shortDate(from, today) + ' – ' + shortDate(to, today)
}

/** "Mon, Oct 13". */
export function dayLabel(iso: string, today: string): string {
  return DOW[weekday(iso)] + ', ' + shortDate(iso, today)
}

/** "38 min", "1 h 12 min", "—" when nothing was timed. */
export function minutesText(min: number | null | undefined): string {
  if (min === null || min === undefined || !Number.isFinite(min)) return '—'
  const m = Math.round(min)
  if (m < 60) return m + ' min'
  const h = Math.floor(m / 60)
  return h + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '')
}

/** "3 · $142.50", "3" without the amounts (no pay.reports), "—" for none. */
export function paymentsText(p: ActivityTotals['payments']): string {
  if (!p.count) return '—'
  return p.amountCents === null ? String(p.count) : p.count + ' · ' + formatCents(p.amountCents)
}

/** The columns of the per-employee table, in the design's order. */
export function totalsRow(t: ActivityTotals): string[] {
  const n = (v: number) => (v ? String(v) : '—')
  return [
    n(t.checkIns),
    n(t.baysStarted),
    n(t.completed),
    n(t.pickedUp),
    minutesText(t.bayMinutes.avg),
    paymentsText(t.payments),
    n(t.textsSent),
    n(t.bookings + t.walkIns),
  ]
}

export const TOTALS_HEADINGS = [
  'Checked in',
  'In bay',
  'Finished',
  'Picked up',
  'Avg bay time',
  'Payments',
  'Texts',
  'Bookings',
] as const

/** What a step of the timeline says ("Put in a bay", "Took a payment"). */
export const STEP_WORDS: Record<StaffEventKind, string> = {
  confirm: 'Confirmed the booking',
  arrive: 'Checked in',
  assign_bay: 'Put in a bay',
  start: 'Started the wash',
  complete: 'Finished',
  notify_ready: 'Texted “ready for pickup”',
  pickup: 'Handed over',
  pickup_reopen: 'Undid the pickup',
  prep_bay: 'Prepared the bay',
  reschedule: 'Moved the booking',
  update: 'Edited the booking',
  book: 'Booked',
  walk_in: 'Checked in a walk-in',
  customer_create: 'Added a client',
  addon_add: 'Added an add-on',
  addon_remove: 'Removed an add-on',
  size_change: 'Changed the size',
  checklist: 'Checklist',
  photo: 'Added a photo',
  payment: 'Took a payment',
  tip: 'Added a tip',
  receipt: 'Sent a receipt',
  payment_link: 'Sent a payment link',
  text: 'Texted the client',
  arrival_link: 'Sent the arrival link',
  worker_set: 'Became the worker',
}

export const viaLabel = (via: 'kiosk' | 'signed_in'): string => (via === 'kiosk' ? 'Kiosk' : 'Signed in')
