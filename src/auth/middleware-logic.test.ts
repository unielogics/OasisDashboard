import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { isPublicPath } from '@/lib/url'
import { SESSION_COOKIE_NAMES, SESSION_PAGES, decide } from './middleware-logic'

const d = (pathname: string, cookies: string[] = [], search = '', extra?: string[]) =>
  decide({ pathname, search, cookieNames: cookies, extraCookieNames: extra })

describe('middleware decision', () => {
  it('lets a request with a session cookie through', () => {
    for (const name of SESSION_COOKIE_NAMES) expect(d('/payments', [name])).toEqual({ action: 'next' })
    expect(d('/operations', ['other', 'oasis_sid'])).toEqual({ action: 'next' })
  })
  it('redirects to /login?next=<path+query> without one, hash is not sent to the server', () => {
    expect(d('/payments')).toEqual({ action: 'redirect', location: '/login?next=%2Fpayments' })
    expect(d('/settings', [], '?x=1')).toEqual({
      action: 'redirect',
      location: '/login?next=%2Fsettings%3Fx%3D1',
    })
    expect(d('/', [])).toEqual({ action: 'redirect', location: '/login?next=%2F' })
    expect(d('/operations', ['theme', 'something'])).toMatchObject({ action: 'redirect' })
  })
  it('an operations visit with no cookie goes to a bare /login (the default landing needs no next)', () => {
    expect(d('/operations')).toEqual({ action: 'redirect', location: '/login' })
  })
  it('the cookie name from OASIS_SESSION_COOKIE_NAME is honoured; look-alike names are not', () => {
    expect(d('/payments', ['custom_sid'], '', ['custom_sid'])).toEqual({ action: 'next' })
    expect(d('/payments', ['custom_sid'])).toMatchObject({ action: 'redirect' })
    expect(d('/payments', ['xoasis_sid', 'oasis_sid2', '__Host-oasis_sid_x'])).toMatchObject({
      action: 'redirect',
    })
  })
  it('never redirects the login family, assets or the API', () => {
    for (const p of [
      '/login',
      '/forgot',
      '/reset',
      '/reset/abc',
      '/reset-password',
      '/invite',
      '/invite/xyz',
      '/logout',
      '/_next/static/x.js',
      '/fonts/a.woff2',
      '/api/v1/me',
      '/favicon.ico',
      '/robots.txt',
    ])
      expect(d(p), p).toEqual({ action: 'next' })
  })
  it('a hostile path cannot smuggle an off-site next', () => {
    expect(d('//evil.test/x')).toEqual({ action: 'next' })
    expect(d('/payments//evil.test')).toEqual({
      action: 'redirect',
      location: '/login?next=%2Fpayments%2F%2Fevil.test',
    })
  })
  it('an address that is no page reaches the 404 page signed out (it offers Sign in) instead of the sign-in page', () => {
    for (const p of ['/nope', '/settingsx', '/operation', '/404', '/payments-old'])
      expect(d(p), p).toEqual({ action: 'next' })
    expect(d('/settings/emergency')).toMatchObject({ action: 'redirect' })
  })
  it('SESSION_PAGES is exactly the pages under src/pages outside the login family and the special pages', () => {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'pages')
    const pages = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
      .map((e) => '/' + e.name.replace(/\.tsx?$/, '').replace(/^index$/, ''))
      .filter((p) => !isPublicPath(p) && !['/_app', '/_document', '/_error', '/404', '/500'].includes(p))
    expect(pages.sort()).toEqual([...SESSION_PAGES].sort())
  })
})

describe('src/middleware.ts (the Next entry)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })
  const load = async (variant: string) => {
    vi.stubEnv('NEXT_PUBLIC_VARIANT', variant)
    vi.resetModules()
    return (await import('../middleware')).middleware
  }
  const req = (path: string, cookie?: string) =>
    new NextRequest(`http://localhost:3200${path}`, { headers: cookie ? { cookie } : {} })

  it('fixture builds (default and parity) never redirect', async () => {
    const mw = await load('')
    const res = mw(req('/payments'))
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })
  it('the live build redirects without a cookie and passes with one', async () => {
    const mw = await load('live')
    const redirect = mw(req('/payments?range=7d'))
    expect(redirect.status).toBe(307)
    expect(
      new URL(redirect.headers.get('location')!).pathname + new URL(redirect.headers.get('location')!).search,
    ).toBe('/login?next=%2Fpayments%3Frange%3D7d')
    expect(mw(req('/payments', 'oasis_sid=abc')).headers.get('x-middleware-next')).toBe('1')
    expect(mw(req('/payments', '__Host-oasis_sid=abc')).headers.get('x-middleware-next')).toBe('1')
    expect(mw(req('/login')).headers.get('x-middleware-next')).toBe('1')
    vi.stubEnv('OASIS_SESSION_COOKIE_NAME', 'my_sid')
    expect(mw(req('/payments', 'my_sid=1')).headers.get('x-middleware-next')).toBe('1')
  })
  it('the redirect keeps the host the browser used (Next turns 127.0.0.1 into localhost in req.url)', async () => {
    const mw = await load('live')
    const res = mw(new NextRequest('http://127.0.0.1:3266/settings', { headers: { host: '127.0.0.1:3266' } }))
    expect(res.headers.get('location')).toBe('http://127.0.0.1:3266/login?next=%2Fsettings')
    const pub = mw(
      new NextRequest('http://localhost:3200/payments', { headers: { host: 'oasis.example.com' } }),
    )
    expect(pub.headers.get('location')).toBe('http://oasis.example.com/login?next=%2Fpayments')
  })
  it('the matcher excludes assets, fonts, api and favicon', async () => {
    const { config } = await import('../middleware')
    const re = new RegExp('^' + config.matcher[0]!.replace('/((?!', '/((?!').replace(/\\\\/g, '\\') + '$')
    expect(re.test('/payments')).toBe(true)
    for (const p of ['/_next/static/a.js', '/fonts/x.woff2', '/api/v1/me', '/favicon.ico', '/robots.txt'])
      expect(re.test(p), p).toBe(false)
  })
})
