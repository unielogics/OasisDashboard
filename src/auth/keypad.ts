// The kiosk keypad's pure rules (ADR 0180 and its 2026-10-14 amendment, design 6.1; DEVIATIONS DV-1001): eight digits,
// auto-submit at the eighth, the physical keyboard, the hidden way to the email/password form (0218), whether a PIN may be
// sent from here at all (PINs work only on the shop's network), and what each answer of POST /kiosk/unlock says.
// The PIN itself is never stored or logged: it lives in component state until it is sent, then it is cleared.
import { ApiError } from '@/data/http/problem'
import { AUTH_CODES } from '@/data/http/auth-types'
import type { KioskStatus } from '@/data/http/auth-types'

export const PIN_LENGTH = 8
/** Typed as the first four digits since the last Clear, it swaps in the email/password card. No PIN starts so. */
export const REVEAL_DIGITS = '0218'

export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'clear' | 'back'

export interface KeypadState {
  /** What the dots show (at most 8 digits). */
  digits: string
  /** Every digit pressed since the last Clear (Backspace does not take one back): the 0218 rule reads this. */
  typed: string
}

export const EMPTY_KEYPAD: KeypadState = { digits: '', typed: '' }

/** The keypad after one key. A full PIN takes no more digits (it is being sent). */
export function press(s: KeypadState, key: KeypadKey): KeypadState {
  if (key === 'clear') return EMPTY_KEYPAD
  if (key === 'back') return { digits: s.digits.slice(0, -1), typed: s.typed }
  if (s.digits.length >= PIN_LENGTH) return s
  return { digits: s.digits + key, typed: s.typed + key }
}

/** The pure 0218 rule: the first four digits typed since the last Clear are 0218 (not 0218 anywhere else). */
export const revealsForm = (s: Pick<KeypadState, 'typed'>): boolean => s.typed.slice(0, 4) === REVEAL_DIGITS

export const isComplete = (s: Pick<KeypadState, 'digits'>): boolean => s.digits.length === PIN_LENGTH

/** The physical keyboard: digits (main row and number pad), Backspace, and Escape or Delete for Clear. */
export function keyOf(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): KeypadKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  if (/^[0-9]$/.test(e.key)) return e.key as KeypadKey
  if (e.key === 'Backspace') return 'back'
  if (e.key === 'Escape' || e.key === 'Delete') return 'clear'
  return null
}

/**
 * Why this connection may not send a PIN at all: no shop network exists yet, or this connection is not one. The keypad
 * still shows (0218 still works), says why, and sends no PIN (but see `mayTryFromHere`).
 */
export type KeypadBlock = 'noNetwork' | 'notAtShop'

export function keypadBlock(s: Pick<KioskStatus, 'networkSet' | 'atShop'>): KeypadBlock | null {
  if (!s.networkSet) return 'noNetwork'
  if (!s.atShop) return 'notAtShop'
  return null
}

/** What the keypad shows after a refused PIN. */
export interface UnlockProblem {
  text: string
  /** Seconds before the next PIN is looked at (a countdown: "Try again in 8 s"). */
  waitSec: number
  /** Too many wrong PINs from this address or this browser: only a manager can clear it (the keypad still takes 0218). */
  lockedOut: boolean
  /** Kiosk mode was turned off meanwhile: the email/password card instead. */
  showForm: boolean
  /** The server says this connection is not the shop's (the PIN was never checked): no PIN is sent from here again. */
  block: KeypadBlock | null
}

export const KEYPAD_TEXT = {
  title: 'Enter your PIN',
  subtitle: 'Your 8-digit PIN opens the board for the whole shop.',
  wrong: 'That PIN didn’t work.',
  lockedOut: 'Too many wrong PINs. A manager needs to clear it in Settings → Kiosk.',
  notAtShop: 'PINs work only at the shop.',
  noNetwork: 'A Super Admin must set the shop network first — Settings → Kiosk',
  ready: 'Ready — PINs work here now.',
  off: 'Kiosk mode is off. Sign in with your email and password.',
  throttled: 'Too many tries. Wait a moment.',
  network: 'Can’t reach Oasis. Check the connection and try again.',
  failed: 'Something went wrong. Try again.',
} as const

export const blockText = (b: KeypadBlock): string => (b === 'noNetwork' ? KEYPAD_TEXT.noNetwork : KEYPAD_TEXT.notAtShop)

/** While blocked the keypad reads GET /kiosk/status again this often (and when the page comes back into view), so a
 *  network the Super Admin adds from a phone opens the tablet's keypad without a reload (K-PIN-DASH review F1). */
export const RECHECK_MS = 30_000

/**
 * A browser that once opened the kiosk (a successful unlock) remembers it in one localStorage flag: no PIN, no name.
 * The server knows such a browser by its device cookie; the page cannot read that cookie (HttpOnly), so it keeps its own.
 */
export const OPENED_HERE_KEY = 'oasis-kiosk-opened-here'

type FlagStore = Pick<Storage, 'getItem' | 'setItem'> | null | undefined

const browserStore = (): FlagStore => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function openedHere(store: FlagStore = browserStore()): boolean {
  try {
    return store?.getItem(OPENED_HERE_KEY) === '1'
  } catch {
    return false
  }
}

export function rememberOpenedHere(store: FlagStore = browserStore()): void {
  try {
    store?.setItem(OPENED_HERE_KEY, '1')
  } catch {
    // private mode or blocked site data: the one try from a new network just isn't made
  }
}

/**
 * The one exception to "never send a PIN away from the shop" (K-PIN-DASH review F2): a browser that opened the kiosk before
 * sends one PIN per page from a connection that is not a shop network, so the server lists it under "PIN tried from a new
 * network" with the browser's name (the internet provider changed the shop's address) and the Super Admin can add it from
 * anywhere. The server never checks that PIN (403 KIOSK_NOT_AT_SHOP). Never before any shop network exists.
 */
export const mayTryFromHere = (b: KeypadBlock, o: { openedHere: boolean; triedHere: boolean }): boolean =>
  b === 'notAtShop' && o.openedHere && !o.triedHere

const secondsOf = (e: ApiError): number => {
  const meta = e.meta.retryAfterSec
  if (typeof meta === 'number' && meta > 0) return Math.ceil(meta)
  if (e.retryAfterMs !== null && e.retryAfterMs > 0) return Math.ceil(e.retryAfterMs / 1000)
  return 0
}

export function unlockProblem(err: unknown): UnlockProblem {
  const base = { waitSec: 0, lockedOut: false, showForm: false, block: null }
  if (!(err instanceof ApiError)) return { ...base, text: KEYPAD_TEXT.failed }
  if (err.isNetwork) return { ...base, text: KEYPAD_TEXT.network }
  switch (err.code) {
    case AUTH_CODES.kioskPinWrong:
      return { ...base, text: KEYPAD_TEXT.wrong, waitSec: secondsOf(err) }
    case AUTH_CODES.kioskThrottled:
      return { ...base, text: KEYPAD_TEXT.throttled, waitSec: Math.max(1, secondsOf(err)) }
    case AUTH_CODES.kioskLockedOut:
      return { ...base, text: KEYPAD_TEXT.lockedOut, lockedOut: true }
    case AUTH_CODES.kioskNotAtShop: {
      const block: KeypadBlock = err.meta.networkSet === false ? 'noNetwork' : 'notAtShop'
      return { ...base, text: blockText(block), block }
    }
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
    return at ? 'The kiosk locked at ' + at + '. Enter your PIN to open it.' : 'The kiosk is locked. Enter your PIN to open it.'
  if (q.expired === '1') return 'The kiosk locked. Enter your PIN to open it.'
  return null
}
