import { describe, expect, it } from 'vitest'
import { DEFAULT_LANDING, isPublicPath, loginUrl, safeNext } from './url'

describe('safeNext: only same-origin paths survive', () => {
  it('keeps ordinary paths, queries and hashes', () => {
    for (const ok of [
      '/payments',
      '/settings#emergency',
      '/operations?view=calendar',
      '/a/b/c',
      '/payments?range=7d#x',
    ])
      expect(safeNext(ok), ok).toBe(ok)
  })
  it('falls back for everything else', () => {
    const bad = [
      '',
      'payments',
      'https://evil.test/',
      'http://evil.test',
      '//evil.test',
      '//evil.test/x',
      '/\\evil.test',
      '\\\\evil.test',
      'javascript:alert(1)',
      'data:text/html,x',
      '/%2F%2Fevil.test',
      '/%5Cevil.test',
      '/ok\nSet-Cookie: x=1',
      '/ok\r',
      '/x\u0000',
      ' /x',
      'mailto:a@b.c',
      '///evil.test',
      '/%0d%0aLocation:%20x',
    ]
    for (const b of bad) expect(safeNext(b), JSON.stringify(b)).toBe(DEFAULT_LANDING)
    expect(safeNext(undefined)).toBe(DEFAULT_LANDING)
    expect(safeNext(null)).toBe(DEFAULT_LANDING)
    expect(safeNext('/' + 'a'.repeat(3000))).toBe(DEFAULT_LANDING)
    expect(safeNext(['/payments', '/x'])).toBe('/payments')
    expect(safeNext('https://evil.test', '/settings')).toBe('/settings')
  })
  it('never returns an auth page (no redirect loops)', () => {
    for (const p of [
      '/login',
      '/login?next=/payments',
      '/logout',
      '/forgot',
      '/reset/abc',
      '/invite/abc',
      '/reset-password?token=x',
    ])
      expect(safeNext(p), p).toBe(DEFAULT_LANDING)
  })
})

describe('loginUrl and isPublicPath', () => {
  it('encodes the validated destination', () => {
    expect(loginUrl('/payments')).toBe('/login?next=%2Fpayments')
    expect(loginUrl('/settings#emergency')).toBe('/login?next=%2Fsettings%23emergency')
    expect(loginUrl('//evil.test')).toBe('/login')
    expect(loginUrl(DEFAULT_LANDING)).toBe('/login')
    expect(loginUrl()).toBe('/login')
  })
  it('knows the login family', () => {
    for (const p of [
      '/login',
      '/forgot',
      '/reset',
      '/reset/abc',
      '/reset-password',
      '/invite',
      '/invite/xyz',
      '/logout',
    ])
      expect(isPublicPath(p), p).toBe(true)
    for (const p of ['/', '/operations', '/payments', '/settings', '/invitees', '/login-help', '/resetting'])
      expect(isPublicPath(p), p).toBe(false)
  })
})
