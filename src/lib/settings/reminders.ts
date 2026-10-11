// Settings → Reminders (live variant only; ADR 0160 plan I, backend api-spec 15.6a): the pure half of the form. The
// server stores the settings, validates them (422 per field) and renders the previews through the template registry;
// this file shapes the draft, the PUT body and the labels the screen shows. No state, no clock.

export interface RemindersView {
  reminders: {
    offsetsMin: number[]
    confirmRequest: boolean
    categoryPrep: Record<string, string>
    reviewRequest: boolean
  }
  statusTexts: {
    checkedIn: boolean
    checkedInDelayMin: number
    runningLate: boolean
    lateGraceMin: number
    lateMax: number
    ready: boolean
    pickedUp: boolean
    bookAgainLink: boolean
  }
  leads: {
    followUpEnabled: boolean
    followUpDelayMin: number
    businessHoursOnly: boolean
    withinHours: number
  }
  categories: { key: string; label: string; colour: string; active: boolean }[]
  quietHours: { enabled: boolean; start: string; end: string }
  version: number
}

/** What the person edits: the three groups of the PUT. */
export type RemindersDraft = Pick<RemindersView, 'reminders' | 'statusTexts' | 'leads'>

export function remindersDraft(v: RemindersView): RemindersDraft {
  return {
    reminders: {
      offsetsMin: [...v.reminders.offsetsMin],
      confirmRequest: v.reminders.confirmRequest,
      categoryPrep: { ...v.reminders.categoryPrep },
      reviewRequest: v.reminders.reviewRequest,
    },
    statusTexts: { ...v.statusTexts },
    leads: { ...v.leads },
  }
}

/** Prep lines compared as the server keeps them: trimmed, empty ones dropped. */
const cleanPrep = (p: Record<string, string>): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const k of Object.keys(p).sort()) {
    const t = (p[k] ?? '').trim()
    if (t) out[k] = t
  }
  return out
}

const canonical = (d: RemindersDraft): string =>
  JSON.stringify({
    reminders: {
      offsetsMin: [...d.reminders.offsetsMin].sort((a, b) => b - a),
      confirmRequest: d.reminders.confirmRequest,
      categoryPrep: cleanPrep(d.reminders.categoryPrep),
      reviewRequest: d.reminders.reviewRequest,
    },
    statusTexts: d.statusTexts,
    leads: d.leads,
  })

export const remindersDirty = (d: RemindersDraft, v: RemindersView): boolean =>
  canonical(d) !== canonical(remindersDraft(v))

/** The PUT body: every group, offsets longest first, prep lines trimmed (an emptied line removes it). */
export function remindersBody(d: RemindersDraft, version: number): RemindersDraft & { version: number } {
  return {
    reminders: {
      offsetsMin: [...new Set(d.reminders.offsetsMin)].sort((a, b) => b - a),
      confirmRequest: d.reminders.confirmRequest,
      categoryPrep: cleanPrep(d.reminders.categoryPrep),
      reviewRequest: d.reminders.reviewRequest,
    },
    statusTexts: { ...d.statusTexts },
    leads: { ...d.leads },
    version,
  }
}

/** The draft as the preview call takes it (no version). */
export function previewDraft(d: RemindersDraft): RemindersDraft {
  const b = remindersBody(d, 0)
  return { reminders: b.reminders, statusTexts: b.statusTexts, leads: b.leads }
}

/** The offsets a person can add (minutes before the visit); the server takes 1..10080 and at most five. */
export const OFFSET_CHOICES = [10080, 4320, 2880, 1440, 720, 240, 120, 60, 30] as const
export const MAX_OFFSETS = 5
export const PREP_MAX = 160

/** 1440 -> "24 hours before", 2880 -> "2 days before", 90 -> "1 h 30 min before". */
export function offsetLabel(min: number): string {
  if (min === 10080) return '1 week before'
  if (min >= 2880 && min % 1440 === 0) return min / 1440 + ' days before'
  if (min % 60 === 0) return min === 60 ? '1 hour before' : min / 60 + ' hours before'
  if (min > 60) return Math.floor(min / 60) + ' h ' + (min % 60) + ' min before'
  return min + ' min before'
}

/** The short form for a chip: "24 h", "2 days", "30 min". */
export function offsetShort(min: number): string {
  if (min === 10080) return '1 week'
  if (min >= 2880 && min % 1440 === 0) return min / 1440 + ' days'
  if (min % 60 === 0) return min / 60 + ' h'
  return min + ' min'
}

export const minutesText = (n: number): string => (n === 1 ? '1 min' : n + ' min')

/** 180 -> "3 h", 90 -> "1 h 30 min", 45 -> "45 min". */
export function delayText(min: number): string {
  if (min < 60) return minutesText(min)
  const h = Math.floor(min / 60)
  const m = min % 60
  return h + ' h' + (m ? ' ' + m + ' min' : '')
}

/** The bounds and steps of each number (the server's registry limits). */
export const STEPPERS = {
  checkedInDelayMin: { min: 0, max: 30, step: 1 },
  lateGraceMin: { min: 0, max: 120, step: 5 },
  lateMax: { min: 0, max: 2, step: 1 },
  followUpDelayMin: { min: 15, max: 1440, step: 15 },
  withinHours: { min: 1, max: 24, step: 1 },
} as const

export type StepperKey = keyof typeof STEPPERS

export function stepValue(key: StepperKey, value: number, dir: 1 | -1): number {
  const s = STEPPERS[key]
  // the follow-up delay moves by 15 min under 2 hours and by 30 min above (3 h is two clicks from 2 h, not four)
  const step = key === 'followUpDelayMin' && (value > 120 || (value === 120 && dir > 0)) ? 30 : s.step
  return Math.min(s.max, Math.max(s.min, value + dir * step))
}

/** "9:00 PM – 8:00 AM" from the server's "21:00" / "08:00". */
export function quietHoursText(q: { enabled: boolean; start: string; end: string }): string {
  const fmt = (hhmm: string): string => {
    const [h, m] = hhmm.split(':').map(Number) as [number, number]
    const ap = h >= 12 ? 'PM' : 'AM'
    const h12 = h % 12 === 0 ? 12 : h % 12
    return `${h12}:${String(m).padStart(2, '0')} ${ap}`
  }
  return q.enabled
    ? `Quiet hours are on: texts wait from ${fmt(q.start)} to ${fmt(q.end)}.`
    : 'Quiet hours are off: texts go out at any time.'
}

/**
 * What the form says before saving a prep line; null when it is fine. Only the length: the server normalises quotes,
 * dashes and accents to plain SMS characters and refuses (422) a line that would still need UCS-2, and the preview
 * shows each text's encoding and segments as it will be sent.
 */
export function prepProblem(text: string): string | null {
  const t = text.trim()
  if (t.length > PREP_MAX) return `At most ${PREP_MAX} characters (${t.length} now).`
  return null
}
