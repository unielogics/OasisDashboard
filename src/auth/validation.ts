// Client-side checks for the login-family forms. The server validates again; these only save a round trip and
// phrase the message the way the Settings drawer does (a full sentence with a period, U+2019 apostrophes).
import type { ApiError } from '@/data/http/problem'
import { AUTH_CODES } from '@/data/http/auth-types'

export const PASSWORD_MIN = 12
export const PASSWORD_MAX = 128

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateEmail(v: string, required: 'sign-in' | 'plain' = 'plain'): string | null {
  const t = v.trim()
  if (!t) return required === 'sign-in' ? 'Email is required to sign in.' : 'Enter your email address.'
  if (t.length > 254 || !EMAIL_RE.test(t)) return 'Enter a valid email address.'
  return null
}

export function validateNewPassword(v: string): string | null {
  if (v.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`
  if (v.length > PASSWORD_MAX) return `Password must be at most ${PASSWORD_MAX} characters.`
  return null
}

export function validateConfirm(password: string, confirm: string): string | null {
  return password === confirm ? null : 'Passwords don’t match.'
}

export interface FormFailure {
  /** Field the message belongs under, or 'form' for the line above the button. */
  field: 'email' | 'password' | 'form'
  message: string
  /** A dead link (invite or reset): the page swaps the form for a card. */
  terminal?: boolean
}

const NETWORK = 'Can’t reach the server. Check your connection and try again.'

/** Maps an auth ApiError to where and how the form shows it. */
export function failureOf(err: unknown, fallbackField: FormFailure['field'] = 'form'): FormFailure {
  const e = err as Partial<ApiError> | null
  if (!e || typeof e !== 'object' || typeof e.status !== 'number')
    return { field: 'form', message: 'Something went wrong. Please try again.' }
  if (e.kind === 'network') return { field: 'form', message: NETWORK }
  switch (e.code) {
    case AUTH_CODES.invalidCredentials:
      return { field: 'form', message: e.detail || 'Email or password is incorrect.' }
    case AUTH_CODES.throttled: {
      const wait = e.retryAfterMs ? Math.max(1, Math.ceil(e.retryAfterMs / 1000)) : null
      return {
        field: 'form',
        message: wait
          ? `Too many attempts. Try again in ${wait} s.`
          : 'Too many attempts. Try again shortly.',
      }
    }
    case AUTH_CODES.accountDisabled:
      return { field: 'form', message: e.detail || 'This account has been deactivated. Ask a manager.' }
    case AUTH_CODES.emailTaken:
      return { field: 'email', message: e.detail || 'That email address is already in use.' }
    case AUTH_CODES.inviteInvalid:
      return {
        field: 'form',
        message: 'This invite link has expired or was already used. Ask a manager to send a new one.',
        terminal: true,
      }
    case AUTH_CODES.resetInvalid:
      return {
        field: 'form',
        message: 'This reset link has expired or was already used. Request a new one.',
        terminal: true,
      }
  }
  if (e.status === 422 && typeof e.fieldError === 'function') {
    const em = e.fieldError('email')
    if (em) return { field: 'email', message: em }
    const pw = e.fieldError('password')
    if (pw) return { field: 'password', message: pw }
  }
  if (e.status === 429) return { field: 'form', message: 'Too many attempts. Try again shortly.' }
  if ((e.status ?? 0) >= 500)
    return { field: 'form', message: 'The server had a problem. Please try again in a moment.' }
  return { field: fallbackField, message: e.detail || e.title || 'Something went wrong. Please try again.' }
}
