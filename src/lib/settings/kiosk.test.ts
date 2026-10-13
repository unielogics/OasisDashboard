import { describe, expect, it } from 'vitest'
import {
  browserOf,
  codeFormProblem,
  codeLine,
  customRangeProblem,
  dayLabel,
  deviceNameProblem,
  deviceState,
  groupCode,
  lastSeenLine,
  minutesText,
  paymentsText,
  rangeLabel,
  rangeOf,
  recentLine,
  totalsRow,
} from './kiosk'

const TZ = 'America/New_York'
const TODAY = '2026-10-13' // a Tuesday

describe('Settings → Kiosk helpers (DV-1010)', () => {
  it('the shop code line', () => {
    expect(codeLine({ set: true, setAt: '2026-10-01T14:00:00Z', setBy: 'Rafael M.', ageDays: 12 }, TZ, TODAY)).toBe(
      'Set Oct 1 by Rafael M. · 12 days ago',
    )
    expect(codeLine({ set: true, setAt: '2026-10-13T14:00:00Z', setBy: null, ageDays: 0 }, TZ, TODAY)).toBe(
      'Set Oct 13 · today',
    )
    expect(codeLine({ set: true, setAt: '2025-10-13T14:00:00Z', setBy: 'Amara O.', ageDays: 365 }, TZ, TODAY)).toBe(
      'Set Oct 13, 2025 by Amara O. · 365 days ago',
    )
    expect(codeLine({ set: false, setAt: null, setBy: null, ageDays: null }, TZ, TODAY)).toMatch(/^No shop code yet/)
  })
  it('the code form checks 8 digits, the 0218 start and the second entry; the server checks the rest', () => {
    expect(codeFormProblem('1234', '1234')).toBe('Enter exactly 8 digits.')
    expect(codeFormProblem('12a45678', '12a45678')).toBe('Enter exactly 8 digits.')
    expect(codeFormProblem('02184567', '02184567')).toBe('A code can’t start with 0218.')
    expect(codeFormProblem('24681357', '24681358')).toBe('The two codes don’t match.')
    expect(codeFormProblem('24681357', '24681357')).toBeNull()
    expect(groupCode('24681357')).toBe('2468 1357')
  })
  it('device states and names', () => {
    expect(deviceState({ state: 'unlocked', locksAt: '2026-10-14T01:00:00Z', failedAttempts: 0 }, TZ)).toEqual({
      label: 'Unlocked · locks 9:00 PM',
      tone: 'green',
    })
    expect(deviceState({ state: 'locked', locksAt: null, failedAttempts: 0 }, TZ)).toEqual({ label: 'Locked', tone: 'grey' })
    expect(deviceState({ state: 'locked', locksAt: null, failedAttempts: 4 }, TZ)).toEqual({
      label: 'Locked · 4 wrong codes',
      tone: 'amber',
    })
    expect(deviceState({ state: 'locked_out', locksAt: null, failedAttempts: 20 }, TZ).tone).toBe('red')
    expect(deviceState({ state: 'revoked', locksAt: null, failedAttempts: 0 }, TZ).label).toBe('Removed')
    expect(deviceNameProblem('  ')).toMatch(/Give this tablet a name/)
    expect(deviceNameProblem('x'.repeat(41))).toBe('Use at most 40 characters.')
    expect(deviceNameProblem('Front desk tablet')).toBeNull()
  })
  it('last seen, browser and the recent events', () => {
    const android =
      'Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
    const ipad = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    expect(browserOf(android)).toBe('Chrome on Android')
    expect(browserOf(ipad)).toBe('Safari on iPad')
    expect(browserOf(null)).toBe('')
    expect(lastSeenLine({ lastSeenAt: '2026-10-13T18:14:00Z', lastIp: '100.64.1.7', lastUa: android }, TZ, TODAY)).toBe(
      'Last seen Oct 13, 2:14 PM · 100.64.1.7 · Chrome on Android',
    )
    expect(lastSeenLine({ lastSeenAt: null, lastIp: null, lastUa: null }, TZ, TODAY)).toBe('Not used yet')
    expect(
      recentLine({ at: '2026-10-13T12:00:00Z', action: 'kiosk.unlock', label: 'Unlocked', by: null, deviceName: 'Front desk' }, TZ, TODAY),
    ).toBe('Oct 13, 8:00 AM · Unlocked · Front desk')
  })
})

describe('Team activity helpers (DV-1011)', () => {
  it('the range chips (weeks Sunday to Saturday, like the Operations calendar)', () => {
    expect(rangeOf('today', TODAY)).toEqual({ from: TODAY, to: TODAY })
    expect(rangeOf('yesterday', TODAY)).toEqual({ from: '2026-10-12', to: '2026-10-12' })
    expect(rangeOf('week', TODAY)).toEqual({ from: '2026-10-11', to: TODAY })
    expect(rangeOf('lastWeek', TODAY)).toEqual({ from: '2026-10-04', to: '2026-10-10' })
    expect(rangeOf('week', '2026-10-11')).toEqual({ from: '2026-10-11', to: '2026-10-11' })
  })
  it('a custom range: two dates, in order, at most 31 days', () => {
    expect(customRangeProblem('', TODAY)).toBe('Pick a start and an end date.')
    expect(customRangeProblem('2026-10-13', '2026-10-01')).toBe('The end date is before the start.')
    expect(customRangeProblem('2026-09-01', '2026-10-13')).toBe('Pick at most 31 days.')
    expect(customRangeProblem('2026-09-13', '2026-10-13')).toBeNull()
    expect(customRangeProblem('2026-09-12', '2026-10-13')).toBe('Pick at most 31 days.')
  })
  it('labels and figures', () => {
    expect(rangeLabel(TODAY, TODAY, TODAY)).toBe('Oct 13')
    expect(rangeLabel('2026-10-04', '2026-10-10', TODAY)).toBe('Oct 4 – Oct 10')
    expect(dayLabel(TODAY, TODAY)).toBe('Tue, Oct 13')
    expect(minutesText(38.4)).toBe('38 min')
    expect(minutesText(72)).toBe('1 h 12 min')
    expect(minutesText(120)).toBe('2 h')
    expect(minutesText(null)).toBe('—')
    expect(paymentsText({ count: 3, amountCents: 14250 })).toBe('3 · $142.50')
    expect(paymentsText({ count: 3, amountCents: null })).toBe('3')
    expect(paymentsText({ count: 0, amountCents: 0 })).toBe('—')
    const zero = {
      addons: 0,
      bayMinutes: { avg: null, cars: 0, total: 0 },
      baysStarted: 0,
      bookings: 0,
      checkIns: 0,
      checklistTasks: 0,
      completed: 0,
      payments: { amountCents: null, count: 0 },
      photos: 0,
      pickedUp: 0,
      readyTexts: 0,
      sizeChanges: 0,
      textsSent: 0,
      walkIns: 0,
    }
    expect(totalsRow(zero)).toEqual(['—', '—', '—', '—', '—', '—', '—', '—'])
    expect(
      totalsRow({ ...zero, checkIns: 5, baysStarted: 4, completed: 4, pickedUp: 3, bayMinutes: { avg: 41, cars: 4, total: 164 }, payments: { count: 2, amountCents: 9000 }, textsSent: 6, bookings: 1, walkIns: 2 }),
    ).toEqual(['5', '4', '4', '3', '41 min', '2 · $90.00', '6', '3'])
  })
})
