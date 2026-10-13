import { describe, expect, it } from 'vitest'
import { ApiError } from '@/data/http/problem'
import {
  EMPTY_KEYPAD,
  KEYPAD_TEXT,
  isComplete,
  keyOf,
  lockedToast,
  press,
  revealsForm,
  unlockProblem,
  waitText,
} from './keypad'
import type { KeypadKey, KeypadState } from './keypad'

const typeAll = (keys: string, s: KeypadState = EMPTY_KEYPAD): KeypadState =>
  [...keys].reduce((st, k) => press(st, (k === 'C' ? 'clear' : k === '<' ? 'back' : k) as KeypadKey), s)

describe('keypad: the 0218 rule (DV-1001)', () => {
  it('0218 as the first four digits reveals the email form at once, before anything is sent', () => {
    expect(revealsForm(typeAll('021'))).toBe(false)
    expect(revealsForm(typeAll('0218'))).toBe(true)
    expect(revealsForm(typeAll('02185'))).toBe(true)
  })
  it('only at the start: 10218, 30218xyz and a run of other digits never reveal it', () => {
    for (const k of ['10218', '30218777', '1234', '0219', '00218', '20180218']) expect(revealsForm(typeAll(k)), k).toBe(false)
  })
  it('counts from the last Clear: 1 Clear 0218 reveals; Backspace does not take a digit back', () => {
    expect(revealsForm(typeAll('1C0218'))).toBe(true)
    expect(revealsForm(typeAll('99C0218'))).toBe(true)
    // 0 2 1 7 ⌫ 8: the dots read 0218 but the digits typed were 02178
    const s = typeAll('0217<8')
    expect(s.digits).toBe('0218')
    expect(revealsForm(s)).toBe(false)
    // 0 2 ⌫ 2 1 8: typed 02218
    expect(revealsForm(typeAll('02<218'))).toBe(false)
  })
})

describe('keypad: digits, Clear, Backspace, eight digits', () => {
  it('takes at most eight digits; complete at the eighth', () => {
    const s = typeAll('123456789')
    expect(s.digits).toBe('12345678')
    expect(isComplete(s)).toBe(true)
    expect(isComplete(typeAll('1234567'))).toBe(false)
  })
  it('Backspace removes the last dot; Clear empties everything', () => {
    expect(typeAll('123<').digits).toBe('12')
    expect(typeAll('123C')).toEqual(EMPTY_KEYPAD)
    expect(typeAll('<<').digits).toBe('')
  })
  it('the physical keyboard: digits, Backspace, Escape and Delete; never with a modifier', () => {
    expect(keyOf({ key: '7' })).toBe('7')
    expect(keyOf({ key: '0' })).toBe('0')
    expect(keyOf({ key: 'Backspace' })).toBe('back')
    expect(keyOf({ key: 'Escape' })).toBe('clear')
    expect(keyOf({ key: 'Delete' })).toBe('clear')
    expect(keyOf({ key: 'a' })).toBeNull()
    expect(keyOf({ key: 'Enter' })).toBeNull()
    expect(keyOf({ key: '1', ctrlKey: true })).toBeNull()
    expect(keyOf({ key: '1', metaKey: true })).toBeNull()
  })
})

const problem = (status: number, code: string, extra: Partial<ConstructorParameters<typeof ApiError>[0]> = {}) =>
  new ApiError({ status, code, title: 't', ...extra })

describe('keypad: what each refused unlock says (design 6.1)', () => {
  it('a wrong code, with the countdown the server asks for', () => {
    expect(unlockProblem(problem(401, 'KIOSK_CODE_WRONG', { meta: { retryAfterSec: 8 } }))).toEqual({
      text: 'That code didn’t work.',
      waitSec: 8,
      lockedOut: false,
      showForm: false,
    })
    expect(unlockProblem(problem(401, 'KIOSK_CODE_WRONG')).waitSec).toBe(0)
    expect(waitText(8)).toBe('Try again in 8 s')
    expect(waitText(0)).toBe('')
  })
  it('throttled: Retry-After drives the countdown (at least one second)', () => {
    expect(unlockProblem(problem(429, 'KIOSK_THROTTLED', { retryAfterMs: 4000 })).waitSec).toBe(4)
    expect(unlockProblem(problem(429, 'KIOSK_THROTTLED')).waitSec).toBe(1)
  })
  it('locked out, unregistered device, no code yet, kiosk mode off, network', () => {
    expect(unlockProblem(problem(423, 'KIOSK_LOCKED_OUT'))).toMatchObject({
      text: 'Too many wrong codes. A manager needs to sign in on this tablet.',
      lockedOut: true,
    })
    expect(unlockProblem(problem(403, 'KIOSK_DEVICE_UNKNOWN')).text).toBe(
      'Codes work only on the shop’s kiosk tablet.',
    )
    expect(unlockProblem(problem(409, 'KIOSK_CODE_NOT_SET')).text).toBe(KEYPAD_TEXT.notSet)
    expect(unlockProblem(problem(409, 'KIOSK_OFF'))).toMatchObject({ showForm: true })
    expect(unlockProblem(new ApiError({ status: 0, kind: 'network' })).text).toBe(KEYPAD_TEXT.network)
    expect(unlockProblem(new Error('x')).text).toBe(KEYPAD_TEXT.failed)
  })
})

describe('keypad: the toast after the kiosk locked', () => {
  it('names the lock time when the page knew it; a forged time is not shown', () => {
    expect(lockedToast({ locked: '1', at: '9:00 PM' })).toBe('The kiosk locked at 9:00 PM. Enter the code to open it.')
    expect(lockedToast({ locked: '1' })).toBe('The kiosk is locked. Enter the code to open it.')
    expect(lockedToast({ locked: '1', at: '<b>evil</b>' })).toBe('The kiosk is locked. Enter the code to open it.')
    expect(lockedToast({ expired: '1' })).toBe('The kiosk locked. Enter the code to open it.')
    expect(lockedToast({})).toBeNull()
  })
})
