import { describe, expect, it } from 'vitest'
import {
  REFUSED_WARNING,
  STEP_WORDS,
  browserOf,
  customRangeProblem,
  dayLabel,
  deviceNameProblem,
  deviceState,
  groupPin,
  lastSeenLine,
  minutesText,
  networkLine,
  networkState,
  networkTitle,
  paymentsText,
  pinFormProblem,
  pinLine,
  rangeLabel,
  rangeOf,
  recentLine,
  refusedConfirm,
  refusedKind,
  refusedLine,
  refusedTitle,
  totalsRow,
} from './kiosk'

const TZ = 'America/New_York'
const TODAY = '2026-10-13' // a Tuesday

describe('Settings → Kiosk helpers (DV-1010)', () => {
  it('a staff PIN’s line never shows the PIN: when and by whom it was set, or that there is none', () => {
    expect(pinLine({ setAt: '2026-10-01T14:00:00Z', setBy: 'Rafael M.' }, TZ, TODAY)).toBe('PIN set Oct 1 by Rafael M.')
    expect(pinLine({ setAt: '2025-10-13T14:00:00Z', setBy: null }, TZ, TODAY)).toBe('PIN set Oct 13, 2025')
    expect(pinLine(null, TZ, TODAY)).toBe('No PIN yet')
  })
  it('the PIN form checks 8 digits, the 0218 start and the second entry; the server checks the rest', () => {
    expect(pinFormProblem('1234', '1234')).toBe('Enter exactly 8 digits.')
    expect(pinFormProblem('12a45678', '12a45678')).toBe('Enter exactly 8 digits.')
    expect(pinFormProblem('02184567', '02184567')).toBe('A PIN can’t start with 0218.')
    expect(pinFormProblem('24681357', '24681358')).toBe('The two PINs don’t match.')
    expect(pinFormProblem('24681357', '24681357')).toBeNull()
    expect(groupPin('24681357')).toBe('2468 1357')
  })
  it('shop networks: name, address, who added it and when it was last used; lockout states', () => {
    const n = {
      id: 'net-1',
      address: '73.12.4.9',
      label: 'Shop Wi-Fi',
      addedAt: '2026-10-13T13:00:00Z',
      addedBy: 'Amara O.',
      lastSeenAt: '2026-10-13T18:14:00Z',
      failedAttempts: 0,
      lockedOut: false,
    }
    expect(networkTitle(n)).toBe('Shop Wi-Fi')
    expect(networkTitle({ ...n, label: null })).toBe('Shop network')
    expect(networkLine(n, TZ, TODAY)).toBe('73.12.4.9 · added Oct 13 by Amara O. · last used Oct 13, 2:14 PM')
    expect(networkLine({ ...n, addedBy: null, lastSeenAt: null }, TZ, TODAY)).toBe('73.12.4.9 · added Oct 13 · not used yet')
    expect(networkState(n)).toBeNull()
    expect(networkState({ ...n, failedAttempts: 1 })).toEqual({ label: '1 wrong PIN', tone: 'amber' })
    expect(networkState({ ...n, failedAttempts: 6 })).toEqual({ label: '6 wrong PINs', tone: 'amber' })
    expect(networkState({ ...n, failedAttempts: 30, lockedOut: true })).toEqual({
      label: 'Locked out · too many wrong PINs',
      tone: 'red',
    })
  })
  it('PIN tried from a new network: the wording follows fromKnownBrowser and shopActiveSince (review N1)', () => {
    const r = {
      id: 'ref-1',
      address: '98.4.2.1',
      attempts: 3,
      browserName: 'Front desk tablet',
      firstSeenAt: '2026-10-13T12:00:00Z',
      lastSeenAt: '2026-10-13T12:05:00Z',
      fromKnownBrowser: true,
      shopActiveSince: false,
    }
    // a known shop browser and the shop's network quiet since: the provider probably changed the address
    expect(refusedTitle(r)).toBe(
      'Front desk tablet tried from a new network, and the shop’s usual network has been quiet since — your internet provider probably changed the shop’s address.',
    )
    expect(refusedTitle({ ...r, browserName: null })).toBe(
      'A shop browser tried from a new network, and the shop’s usual network has been quiet since — your internet provider probably changed the shop’s address.',
    )
    // a known shop browser while the shop's network was still in use: a phone away from the shop
    expect(refusedTitle({ ...r, shopActiveSince: true })).toBe(
      'Front desk tablet tried from another network while the shop’s network was still in use — probably a phone away from the shop. Don’t add it unless you’re sure.',
    )
    // an unknown browser: the warning
    expect(refusedTitle({ ...r, fromKnownBrowser: false, browserName: null })).toBe('A PIN was tried from a new network')
    expect(refusedTitle({ ...r, fromKnownBrowser: false, browserName: null, shopActiveSince: true })).toBe(
      'A PIN was tried from a new network',
    )
    expect(refusedKind(r)).toBe('providerChanged')
    expect(refusedKind({ ...r, shopActiveSince: true })).toBe('awayFromShop')
    expect(refusedKind({ ...r, fromKnownBrowser: false })).toBe('unknownBrowser')
    expect(refusedConfirm('98.4.2.1')).toBe('Add 98.4.2.1 as a shop network? Anyone on that network can then use a PIN.')
    expect(refusedLine(r, TZ, TODAY)).toBe('98.4.2.1 · 3 tries · last Oct 13, 8:05 AM')
    expect(refusedLine({ ...r, attempts: 1 }, TZ, TODAY)).toBe('98.4.2.1 · 1 try · last Oct 13, 8:05 AM')
    expect(REFUSED_WARNING).toBe('Not from a shop browser — only add it if you know this address is the shop’s')
  })
  it('device states and names', () => {
    expect(deviceState({ state: 'unlocked', locksAt: '2026-10-14T01:00:00Z', failedAttempts: 0 }, TZ)).toEqual({
      label: 'Unlocked · locks 9:00 PM',
      tone: 'green',
    })
    expect(deviceState({ state: 'locked', locksAt: null, failedAttempts: 0 }, TZ)).toEqual({ label: 'Locked', tone: 'grey' })
    expect(deviceState({ state: 'locked', locksAt: null, failedAttempts: 4 }, TZ)).toEqual({
      label: 'Locked · 4 wrong PINs',
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
    // whose PIN opened it (ADR 0180 amendment)
    expect(
      recentLine({ at: '2026-10-13T12:00:00Z', action: 'kiosk.unlock', label: 'Unlocked', by: 'Marco R.', deviceName: 'Front desk' }, TZ, TODAY),
    ).toBe('Oct 13, 8:00 AM · Unlocked · Front desk · Opened by Marco R.')
    expect(
      recentLine({ at: '2026-10-13T12:00:00Z', action: 'kiosk.pin.set', label: 'PIN set', by: 'Rafael M.', deviceName: null }, TZ, TODAY),
    ).toBe('Oct 13, 8:00 AM · PIN set · by Rafael M.')
    expect(STEP_WORDS.kiosk_unlock).toBe('Opened the kiosk')
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
