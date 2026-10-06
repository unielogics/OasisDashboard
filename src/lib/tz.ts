// Business-timezone helpers on Intl. The business runs in one timezone (America/New_York by default); the
// browser's own zone is irrelevant. Nothing here reads the wall clock: callers pass the instant, normally
// serverNow() from clock.ts.

export const DEFAULT_TZ = 'America/New_York'

export interface ZonedParts {
  year: number
  /** 1-12 */
  month: number
  day: number
  /** 0-23 */
  hour: number
  minute: number
  second: number
  /** 0 = Sunday */
  weekday: number
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    })
    formatters.set(tz, f)
  }
  return f
}

export function zonedParts(instantMs: number, tz: string = DEFAULT_TZ): ZonedParts {
  const parts: Record<string, string> = {}
  for (const p of formatter(tz).formatToParts(new Date(instantMs))) parts[p.type] = p.value
  return {
    year: +parts.year!,
    month: +parts.month!,
    day: +parts.day!,
    hour: +parts.hour! % 24,
    minute: +parts.minute!,
    second: +parts.second!,
    weekday: WEEKDAYS[parts.weekday!] ?? 0,
  }
}

const p2 = (n: number): string => String(n).padStart(2, '0')

/** The business date, "2026-06-13". */
export function businessToday(instantMs: number, tz: string = DEFAULT_TZ): string {
  const z = zonedParts(instantMs, tz)
  return `${z.year}-${p2(z.month)}-${p2(z.day)}`
}

/** Minutes since business midnight. */
export function businessMinutes(instantMs: number, tz: string = DEFAULT_TZ): number {
  const z = zonedParts(instantMs, tz)
  return z.hour * 60 + z.minute
}

/** "10:36 AM" in the business timezone (replaces the designs' nowClock()). */
export function businessClock(instantMs: number, tz: string = DEFAULT_TZ): string {
  const z = zonedParts(instantMs, tz)
  const ap = z.hour >= 12 ? 'PM' : 'AM'
  return `${z.hour % 12 || 12}:${p2(z.minute)} ${ap}`
}

/** "Today 10:36 AM" in the business timezone (replaces the designs' nowT()). */
export const businessStamp = (instantMs: number, tz: string = DEFAULT_TZ): string =>
  'Today ' + businessClock(instantMs, tz)

/** "Saturday, June 13" for a business date. */
export function dateHeading(isoDate: string): string {
  const [y, m, d] = parseIso(isoDate)
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

export function parseIso(isoDate: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!m) throw new RangeError(`not a YYYY-MM-DD date: ${isoDate}`)
  return [+m[1]!, +m[2]!, +m[3]!]
}

/** Adds whole days to a business date string. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = parseIso(isoDate)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`
}

/** Whole days from business date `a` to `b`. */
export function diffDays(a: string, b: string): number {
  const [ay, am, ad] = parseIso(a)
  const [by, bm, bd] = parseIso(b)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
}

/** The instant of `minutes` after business midnight on `isoDate` (handles the DST offset of that day). */
export function zonedInstant(isoDate: string, minutes: number, tz: string = DEFAULT_TZ): number {
  const [y, m, d] = parseIso(isoDate)
  const wall = Date.UTC(y, m - 1, d, 0, minutes)
  // Two passes: the offset at the guess instant, then at the corrected instant (covers DST edges).
  let guess = wall
  for (let i = 0; i < 2; i++) {
    const z = zonedParts(guess, tz)
    const asUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second)
    guess += wall - asUtc
  }
  return guess
}
