// The kiosk keypad's pure rules (ADR 0180, design 6.1; DEVIATIONS DV-1001): eight digits, auto-submit at the eighth, the
// physical keyboard, the hidden way to the email/password form (0218), and what each answer of POST /kiosk/unlock says.
// The code itself is never stored or logged: it lives in component state until it is sent, then it is cleared.
import { ApiError } from '@/data/http/problem'
import { AUTH_CODES } from '@/data/http/auth-types'

export const CODE_LENGTH = 8
/** Typed as the first four digits since the last Clear, it swaps in the email/password card. No shop code starts so. */
export const REVEAL_DIGITS = '0218'

export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'clear' | 'back'

export interface KeypadState {
  /** What the dots show (at most 8 digits). */
  digits: string
  /** Every digit pressed since the last Clear (Backspace does not take one back): the 0218 rule reads this. */
  typed: string
}

export const EMPTY_KEYPAD: KeypadState = { digits: '', typed: '' }

/** The keypad after one key. A full code takes no more digits (it is being sent). */
export function press(s: KeypadState, key: KeypadKey): KeypadState {
  if (key === 'clear') return EMPTY_KEYPAD
  if (key === 'back') return { digits: s.digits.slice(0, -1), typed: s.typed }
  if (s.digits.length >= CODE_LENGTH) return s
  return { digits: s.digits + key, typed: s.typed + key }
}

/** The pure 0218 rule: the first four digits typed since the last Clear are 0218 (not 0218 anywhere else). */
export const revealsForm = (s: Pick<KeypadState, 'typed'>): boolean => s.typed.slice(0, 4) === REVEAL_DIGITS

export const isComplete = (s: Pick<KeypadState, 'digits'>): boolean => s.digits.length === CODE_LENGTH

/** The physical keyboard: digits (main row and number pad), Backspace, and Escape or Delete for Clear. */
export function keyOf(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): KeypadKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  if (/^[0-9]$/.test(e.key)) return e.key as KeypadKey
  if (e.key === 'Backspace') return 'back'
  if (e.key === 'Escape' || e.key === 'Delete') return 'clear'
  return null
}

/** What the keypad shows after a refused code. */
export interface UnlockProblem {
  text: string
  /** Seconds before the next code is looked at (a countdown: "Try again in 8 s"). */
  waitSec: number
  /** 20 wrong codes: only a manager can clear it (the keypad still takes 0218). */
  lockedOut: boolean
  /** Kiosk mode was turned off meanwhile: the email/password card instead. */
  showForm: boolean
}

export const KEYPAD_TEXT = {
  wrong: 'That code didn’t work.',
  lockedOut: 'Too many wrong codes. A manager needs to sign in on this tablet.',
  unknownDevice: 'Codes work only on the shop’s kiosk tablet.',
  notSet: 'A manager needs to set the shop code first.',
  off: 'Kiosk mode is off. Sign in with your email and password.',
  throttled: 'Too many tries. Wait a moment.',
  network: 'Can’t reach Oasis. Check the connection and try again.',
  failed: 'Something went wrong. Try again.',
} as const

const secondsOf = (e: ApiError): number => {
  const meta = e.meta.retryAfterSec
  if (typeof meta === 'number' && meta > 0) return Math.ceil(meta)
  if (e.retryAfterMs !== null && e.retryAfterMs > 0) return Math.ceil(e.retryAfterMs / 1000)
  return 0
}

export function unlockProblem(err: unknown): UnlockProblem {
  const base = { waitSec: 0, lockedOut: false, showForm: false }
  if (!(err instanceof ApiError)) return { ...base, text: KEYPAD_TEXT.failed }
  if (err.isNetwork) return { ...base, text: KEYPAD_TEXT.network }
  switch (err.code) {
    case AUTH_CODES.kioskCodeWrong:
      return { ...base, text: KEYPAD_TEXT.wrong, waitSec: secondsOf(err) }
    case AUTH_CODES.kioskThrottled:
      return { ...base, text: KEYPAD_TEXT.throttled, waitSec: Math.max(1, secondsOf(err)) }
    case AUTH_CODES.kioskLockedOut:
      return { ...base, text: KEYPAD_TEXT.lockedOut, lockedOut: true }
    case AUTH_CODES.kioskDeviceUnknown:
      return { ...base, text: KEYPAD_TEXT.unknownDevice }
    case AUTH_CODES.kioskCodeNotSet:
      return { ...base, text: KEYPAD_TEXT.notSet }
    case AUTH_CODES.kioskOff:
      return { ...base, text: KEYPAD_TEXT.off, showForm: true }
    default:
      return { ...base, text: err.status === 429 ? KEYPAD_TEXT.throttled : KEYPAD_TEXT.failed, waitSec: err.status === 429 ? Math.max(1, secondsOf(err)) : 0 }
  }
}

/** "Try again in 8 s" (whole seconds, never 0 while waiting). */
export const waitText = (sec: number): string => (sec > 0 ? 'Try again in ' + sec + ' s' : '')

/** The toast of the sign-in page after the kiosk locked: `?locked=1[&at=9:00 PM]` or `?expired=1`. */
export function lockedToast(q: { locked?: unknown; at?: unknown; expired?: unknown }): string | null {
  const at = typeof q.at === 'string' && /^\d{1,2}:\d{2}\s?[AP]M$/.test(q.at) ? q.at : null
  if (q.locked === '1')
    return at ? 'The kiosk locked at ' + at + '. Enter the code to open it.' : 'The kiosk is locked. Enter the code to open it.'
  if (q.expired === '1') return 'The kiosk locked. Enter the code to open it.'
  return null
}
