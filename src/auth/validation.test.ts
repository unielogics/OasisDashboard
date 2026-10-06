import { describe, expect, it } from 'vitest'
import { ApiError } from '@/data/http/problem'
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  failureOf,
  validateConfirm,
  validateEmail,
  validateNewPassword,
} from './validation'

describe('field validation', () => {
  it('email: required (worded for sign-in at invite time), shape, length', () => {
    expect(validateEmail('')).toBe('Enter your email address.')
    expect(validateEmail('   ', 'sign-in')).toBe('Email is required to sign in.')
    for (const bad of ['a', 'a@b', 'a b@c.d', '@c.d', 'a@.d', 'a@@b.c'])
      expect(validateEmail(bad), bad).toBe('Enter a valid email address.')
    expect(validateEmail('a@' + 'b'.repeat(250) + '.com')).toBe('Enter a valid email address.')
    for (const ok of ['rafael@oasis.test', ' Rafael+x@Oasis.Test ', 'a.b@c-d.co'])
      expect(validateEmail(ok), ok).toBeNull()
  })
  it('password: 12 to 128 characters, counted as typed', () => {
    expect(PASSWORD_MIN).toBe(12)
    expect(PASSWORD_MAX).toBe(128)
    expect(validateNewPassword('x'.repeat(11))).toBe('Password must be at least 12 characters.')
    expect(validateNewPassword('x'.repeat(12))).toBeNull()
    expect(validateNewPassword('x'.repeat(128))).toBeNull()
    expect(validateNewPassword('x'.repeat(129))).toBe('Password must be at most 128 characters.')
    expect(validateNewPassword('                ')).toBeNull() // whitespace is allowed; the server decides policy
  })
  it('confirmation', () => {
    expect(validateConfirm('abc', 'abc')).toBeNull()
    expect(validateConfirm('abc', 'abd')).toBe('Passwords don’t match.')
  })
})

const e = (
  status: number,
  code: string,
  detail = '',
  extra: Partial<ConstructorParameters<typeof ApiError>[0]> = {},
) => new ApiError({ status, code, title: 'T', detail, ...extra })

describe('failureOf maps auth problems to where the form shows them', () => {
  it('wrong credentials use the server sentence on the form line', () => {
    expect(failureOf(e(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect'))).toEqual({
      field: 'form',
      message: 'Email or password is incorrect',
    })
  })
  it('throttle shows the wait; deactivated accounts show the server text', () => {
    expect(failureOf(e(429, 'LOGIN_THROTTLED', '', { retryAfterMs: 3000 })).message).toBe(
      'Too many attempts. Try again in 3 s.',
    )
    expect(failureOf(e(429, 'LOGIN_THROTTLED', '', { retryAfterMs: 400 })).message).toBe(
      'Too many attempts. Try again in 1 s.',
    )
    expect(failureOf(e(429, 'LOGIN_THROTTLED')).message).toBe('Too many attempts. Try again shortly.')
    expect(failureOf(e(403, 'ACCOUNT_DISABLED', 'This account is deactivated')).message).toBe(
      'This account is deactivated',
    )
  })
  it('email taken lands under the email field; dead invite and reset links are terminal', () => {
    expect(failureOf(e(409, 'EMAIL_TAKEN', 'That email address is already in use'))).toEqual({
      field: 'email',
      message: 'That email address is already in use',
    })
    expect(failureOf(e(410, 'INVITE_INVALID'))).toMatchObject({ field: 'form', terminal: true })
    expect(failureOf(e(410, 'RESET_INVALID'))).toMatchObject({ field: 'form', terminal: true })
    expect(failureOf(e(410, 'RESET_INVALID')).message).toMatch(/Request a new one/)
  })
  it('422 field errors go under the right field', () => {
    const err = e(422, 'VALIDATION_FAILED', '', {
      errors: [{ path: 'body.email', message: 'Enter a valid email address' }],
    })
    expect(failureOf(err)).toEqual({ field: 'email', message: 'Enter a valid email address' })
    const pw = e(422, 'VALIDATION_FAILED', '', { errors: [{ path: 'body.password', message: 'Too short' }] })
    expect(failureOf(pw)).toEqual({ field: 'password', message: 'Too short' })
  })
  it('network, 5xx, rate limit and unknown shapes never leak internals', () => {
    expect(failureOf(new ApiError({ status: 0, kind: 'network' })).message).toBe(
      'Can’t reach the server. Check your connection and try again.',
    )
    expect(failureOf(e(500, 'INTERNAL', 'pg: boom')).message).toBe(
      'The server had a problem. Please try again in a moment.',
    )
    expect(failureOf(e(429, 'RATE_LIMITED')).message).toBe('Too many attempts. Try again shortly.')
    expect(failureOf(new Error('x')).message).toBe('Something went wrong. Please try again.')
    expect(failureOf(null).message).toBe('Something went wrong. Please try again.')
    expect(failureOf(e(400, 'MALFORMED_REQUEST', 'Bad request'), 'password')).toEqual({
      field: 'password',
      message: 'Bad request',
    })
  })
})
