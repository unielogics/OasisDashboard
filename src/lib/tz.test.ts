import { describe, expect, it } from 'vitest'
import {
  addDays,
  businessClock,
  businessMinutes,
  businessStamp,
  businessToday,
  dateHeading,
  diffDays,
  parseIso,
  zonedInstant,
  zonedParts,
} from './tz'

const T = Date.parse('2026-06-13T10:36:00-04:00')

describe('business timezone (America/New_York)', () => {
  it('reads parts, date and clock in the business zone whatever the device zone is', () => {
    expect(zonedParts(T)).toMatchObject({ year: 2026, month: 6, day: 13, hour: 10, minute: 36, weekday: 6 })
    expect(businessToday(T)).toBe('2026-06-13')
    expect(businessClock(T)).toBe('10:36 AM')
    expect(businessStamp(T)).toBe('Today 10:36 AM')
    expect(businessMinutes(T)).toBe(10 * 60 + 36)
  })
  it('the date rolls over at business midnight, not UTC midnight', () => {
    expect(businessToday(Date.parse('2026-06-14T03:59:00Z'))).toBe('2026-06-13') // 11:59 PM EDT
    expect(businessToday(Date.parse('2026-06-14T04:00:00Z'))).toBe('2026-06-14') // 12:00 AM EDT
    expect(businessClock(Date.parse('2026-06-14T04:00:00Z'))).toBe('12:00 AM')
    expect(businessClock(Date.parse('2026-06-13T16:00:00Z'))).toBe('12:00 PM')
  })
  it('handles both sides of the DST changes', () => {
    expect(businessClock(Date.parse('2026-03-08T06:59:00Z'))).toBe('1:59 AM') // EST, just before the jump
    expect(businessClock(Date.parse('2026-03-08T07:00:00Z'))).toBe('3:00 AM') // EDT
    expect(businessClock(Date.parse('2026-11-01T05:59:00Z'))).toBe('1:59 AM') // EDT
    expect(businessClock(Date.parse('2026-11-01T06:00:00Z'))).toBe('1:00 AM') // EST, the repeated hour
  })
  it('supports another zone when the location says so', () => {
    expect(businessClock(T, 'America/Los_Angeles')).toBe('7:36 AM')
    expect(businessToday(Date.parse('2026-06-14T03:00:00Z'), 'America/Los_Angeles')).toBe('2026-06-13')
  })
  it('date arithmetic is calendar-exact', () => {
    expect(addDays('2026-06-13', 1)).toBe('2026-06-14')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(diffDays('2026-06-13', '2026-06-20')).toBe(7)
    expect(diffDays('2026-06-13', '2026-03-08')).toBe(-97)
    expect(() => parseIso('2026-6-3')).toThrow(RangeError)
  })
  it('names the day like the designs', () => {
    expect(dateHeading('2026-06-13')).toBe('Saturday, June 13')
    expect(dateHeading('2027-01-01')).toBe('Friday, January 1')
  })
  it('zonedInstant inverts the parts, across DST', () => {
    for (const [d, m] of [
      ['2026-06-13', 636],
      ['2026-03-08', 30],
      ['2026-03-08', 180],
      ['2026-11-01', 90],
      ['2026-11-01', 1000],
      ['2026-01-05', 0],
    ] as const) {
      const t = zonedInstant(d, m)
      expect(businessToday(t), `${d} ${m}`).toBe(d)
      if (!(d === '2026-11-01' && m === 90)) expect(businessMinutes(t), `${d} ${m}`).toBe(m)
    }
    expect(zonedInstant('2026-06-13', 636)).toBe(T)
  })
})
