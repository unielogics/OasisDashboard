// Next requires absolute redirect URLs from middleware, and behind nginx req.url is the internal https://localhost:3200/...:
// the redirect must use the host the visitor used (X-Forwarded-Host from nginx, else Host), never the server's own address.
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.stubEnv('NEXT_PUBLIC_VARIANT', 'live')
const { middleware } = await import('./middleware')
const { NextRequest } = await import('next/server')

const behindNginx = (path: string) =>
  new NextRequest(`https://localhost:3200${path}`, {
    headers: {
      host: 'app.oasisautospanj.com',
      'x-forwarded-host': 'app.oasisautospanj.com',
      'x-forwarded-proto': 'https',
    },
  })

describe('middleware redirects', () => {
  it('behind nginx: an absolute URL on the public host, never localhost', () => {
    const res = middleware(behindNginx('/settings?tab=x'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'https://app.oasisautospanj.com/login?next=%2Fsettings%3Ftab%3Dx',
    )
  })
  it('without a proxy: the Host the browser used (a live stack on a tailnet address)', () => {
    const res = middleware(
      new NextRequest('http://localhost:3223/payments', { headers: { host: '100.93.119.123:3223' } }),
    )
    expect(res.headers.get('location')).toBe('http://100.93.119.123:3223/login?next=%2Fpayments')
  })
})

describe('middleware redirect host allowlist (OASIS_PUBLIC_HOSTS)', () => {
  const allow = () => vi.stubEnv('OASIS_PUBLIC_HOSTS', 'app.oasisautospanj.com,review.example.net:3240')
  afterEach(() => vi.unstubAllEnvs())
  const loc = (headers: Record<string, string>, url = 'https://localhost:3200/payments') =>
    middleware(new NextRequest(url, { headers })).headers.get('location')

  it('a spoofed Host never produces a redirect elsewhere: it falls back to the first public host', () => {
    allow()
    expect(loc({ host: 'evil.example', 'x-forwarded-proto': 'https' })).toBe(
      'https://app.oasisautospanj.com/login?next=%2Fpayments',
    )
    expect(loc({ host: 'app.oasisautospanj.com@evil.example', 'x-forwarded-proto': 'https' })).toBe(
      'https://app.oasisautospanj.com/login?next=%2Fpayments',
    )
  })
  it('a spoofed X-Forwarded-Host falls back too, even next to a genuine Host', () => {
    allow()
    expect(
      loc({
        host: 'app.oasisautospanj.com',
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'https',
      }),
    ).toBe('https://app.oasisautospanj.com/login?next=%2Fpayments')
  })
  it('multi-value X-Forwarded-Host: only the first value counts, and only when it is listed', () => {
    allow()
    expect(
      loc({ 'x-forwarded-host': 'evil.example, review.example.net:3240', 'x-forwarded-proto': 'https' }),
    ).toBe('https://app.oasisautospanj.com/login?next=%2Fpayments')
    expect(
      loc({ 'x-forwarded-host': 'review.example.net:3240, evil.example', 'x-forwarded-proto': 'http' }),
    ).toBe('http://review.example.net:3240/login?next=%2Fpayments')
  })
  it('a listed host is kept (case-insensitive)', () => {
    allow()
    expect(loc({ host: 'APP.OasisAutoSpaNJ.com', 'x-forwarded-proto': 'https' })).toBe(
      'https://app.oasisautospanj.com/login?next=%2Fpayments',
    )
  })
  it('missing Host and X-Forwarded-Host: the first public host, never the internal localhost', () => {
    allow()
    expect(loc({})).toBe('https://app.oasisautospanj.com/login?next=%2Fpayments')
  })
  it('a junk X-Forwarded-Proto is ignored (the request scheme stays)', () => {
    allow()
    expect(loc({ host: 'app.oasisautospanj.com', 'x-forwarded-proto': 'javascript' })).toBe(
      'https://app.oasisautospanj.com/login?next=%2Fpayments',
    )
  })
})

describe('middleware redirect without an allowlist (live stacks, dev)', () => {
  const loc = (headers: Record<string, string>) =>
    middleware(new NextRequest('http://localhost:3291/payments', { headers })).headers.get('location')
  it('echoes a well-formed Host back to the person who sent it', () => {
    expect(loc({ host: '[::1]:3291' })).toBe('http://[::1]:3291/login?next=%2Fpayments')
  })
  it('a malformed Host (userinfo, path, space) falls back to the server host', () => {
    for (const host of ['a.example@evil.example', 'evil.example/x', 'evil example', 'evil.example:99999999'])
      expect(loc({ host })).toBe('http://localhost:3291/login?next=%2Fpayments')
  })
  it('missing headers: the server host', () => {
    expect(loc({})).toBe('http://localhost:3291/login?next=%2Fpayments')
  })
})
