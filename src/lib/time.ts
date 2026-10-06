// Time-of-day helpers reproduced from the design logic classes (12-hour strings, minutes since midnight).

/** "8:30 AM" -> 510. Throws a TypeError on text that is not h:mm AM|PM, exactly like the originals. */
export function parseT(s: string): number {
  const m = s.match(/(\d+):(\d+)\s*(AM|PM)/i)!
  let h = +m[1]! % 12
  if (/pm/i.test(m[3]!)) h += 12
  return h * 60 + +m[2]!
}

/** Minutes since midnight -> "8:30 AM", wrapping around midnight (Operations fmtT). */
export function fmtT(mins: number): string {
  mins = ((mins % 1440) + 1440) % 1440
  let h = Math.floor(mins / 60)
  const m = mins % 60
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return h + ':' + String(m).padStart(2, '0') + ' ' + ap
}

/** Settings fmtT: the same text for 0..1439 but no wrapping (out-of-range input is formatted as is). */
export function fmtTRaw(n: number): string {
  let h = Math.floor(n / 60)
  const m = n % 60
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return h + ':' + String(m).padStart(2, '0') + ' ' + ap
}

/** Operations nowClock() for an explicit hour (0-23) and minute: "10:36 AM". */
export function clockLabel(hours: number, minutes: number): string {
  let h = hours
  const ap = h >= 12 ? 'PM' : 'AM'
  h = h % 12
  if (h === 0) h = 12
  return h + ':' + String(minutes).padStart(2, '0') + ' ' + ap
}

/** Payments nowT() for an explicit hour and minute: "Today 10:36 AM". */
export function todayStamp(hours: number, minutes: number): string {
  const ap = hours >= 12 ? 'PM' : 'AM'
  const h = hours % 12 || 12
  return 'Today ' + h + ':' + String(minutes).padStart(2, '0') + ' ' + ap
}
