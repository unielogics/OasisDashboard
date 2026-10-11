import { describe, expect, it } from 'vitest'
import {
  delayText,
  offsetLabel,
  offsetShort,
  prepProblem,
  previewDraft,
  quietHoursText,
  remindersBody,
  remindersDirty,
  remindersDraft,
  stepValue,
} from './reminders'
import type { RemindersView } from './reminders'

const VIEW: RemindersView = {
  reminders: { offsetsMin: [1440, 120], confirmRequest: true, categoryPrep: {}, reviewRequest: false },
  statusTexts: {
    checkedIn: true,
    checkedInDelayMin: 3,
    runningLate: true,
    lateGraceMin: 10,
    lateMax: 2,
    ready: true,
    pickedUp: true,
    bookAgainLink: false,
  },
  leads: { followUpEnabled: true, followUpDelayMin: 180, businessHoursOnly: true, withinHours: 24 },
  categories: [
    { key: 'wash', label: 'Wash', colour: '#1FB6FF', active: true },
    { key: 'tint', label: 'Tint', colour: '#2EE59D', active: true },
  ],
  quietHours: { enabled: true, start: '21:00', end: '08:00' },
  version: 16,
}

describe('reminders draft', () => {
  it('a fresh draft is clean; order of offsets and blank prep lines do not make it dirty', () => {
    const d = remindersDraft(VIEW)
    expect(remindersDirty(d, VIEW)).toBe(false)
    d.reminders.offsetsMin = [120, 1440]
    d.reminders.categoryPrep = { tint: '   ' }
    expect(remindersDirty(d, VIEW)).toBe(false)
    d.reminders.categoryPrep = { tint: 'Plan for 2–3 hours.' }
    expect(remindersDirty(d, VIEW)).toBe(true)
  })

  it('the draft never shares arrays or objects with the view', () => {
    const d = remindersDraft(VIEW)
    d.reminders.offsetsMin.push(60)
    d.statusTexts.ready = false
    expect(VIEW.reminders.offsetsMin).toEqual([1440, 120])
    expect(VIEW.statusTexts.ready).toBe(true)
  })

  it('the PUT body: offsets once and longest first, prep lines trimmed and emptied ones removed, the version', () => {
    const d = remindersDraft(VIEW)
    d.reminders.offsetsMin = [60, 1440, 60, 2880]
    d.reminders.categoryPrep = { tint: '  Plan for 2–3 hours. ', wash: '' }
    const b = remindersBody(d, 16)
    expect(b.reminders.offsetsMin).toEqual([2880, 1440, 60])
    expect(b.reminders.categoryPrep).toEqual({ tint: 'Plan for 2–3 hours.' })
    expect(b.version).toBe(16)
    expect('version' in previewDraft(d)).toBe(false)
  })
})

describe('reminders labels and steppers', () => {
  it('offsets read as people say them', () => {
    expect(offsetLabel(10080)).toBe('1 week before')
    expect(offsetLabel(2880)).toBe('2 days before')
    expect(offsetLabel(1440)).toBe('24 hours before')
    expect(offsetLabel(60)).toBe('1 hour before')
    expect(offsetLabel(90)).toBe('1 h 30 min before')
    expect(offsetLabel(30)).toBe('30 min before')
    expect(offsetShort(1440)).toBe('24 h')
    expect(offsetShort(4320)).toBe('3 days')
    expect(delayText(180)).toBe('3 h')
    expect(delayText(90)).toBe('1 h 30 min')
    expect(delayText(1)).toBe('1 min')
  })

  it('steppers keep to the server limits; the follow-up delay moves by 30 min above 2 hours', () => {
    expect(stepValue('lateMax', 2, 1)).toBe(2)
    expect(stepValue('lateMax', 0, -1)).toBe(0)
    expect(stepValue('checkedInDelayMin', 3, 1)).toBe(4)
    expect(stepValue('lateGraceMin', 10, -1)).toBe(5)
    expect(stepValue('followUpDelayMin', 15, -1)).toBe(15)
    expect(stepValue('followUpDelayMin', 105, 1)).toBe(120)
    expect(stepValue('followUpDelayMin', 120, 1)).toBe(150)
    expect(stepValue('followUpDelayMin', 150, -1)).toBe(120)
    expect(stepValue('followUpDelayMin', 120, -1)).toBe(105)
    expect(stepValue('followUpDelayMin', 1440, 1)).toBe(1440)
    expect(stepValue('withinHours', 24, 1)).toBe(24)
  })

  it('quiet hours and prep lines', () => {
    expect(quietHoursText(VIEW.quietHours)).toBe('Quiet hours are on: texts wait from 9:00 PM to 8:00 AM.')
    expect(quietHoursText({ enabled: false, start: '21:00', end: '08:00' })).toMatch(/off/)
    expect(prepProblem('Plan for 2–3 hours.')).toBeNull()
    expect(prepProblem('x'.repeat(161))).toBe('At most 160 characters (161 now).')
  })
})
