/* eslint-disable @typescript-eslint/no-explicit-any */
// Kiosk mode in the API client (ADR 0180, design 6.3): the route list generated from the backend's x-oasis-kiosk marks,
// the acting employee's header, the local refusal of an unlisted route and the fallback picker.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { kioskRoutes, generateKioskRoutes } from '../gen-api'
import { ApiClient } from './client'
import { createKioskApi } from './endpoints'
import { KIOSK_ROUTES } from './kiosk-routes'
import { ACTOR_HEADER, KioskCancelled, KioskRefused, buildKioskMatcher, kioskRouteMode, templateRegExp } from './kiosk'
import type { KioskClientConfig } from './kiosk'
import { ApiError } from './problem'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function harness(kiosk: KioskClientConfig = {}) {
  const calls: Array<{ url: string; init: any }> = []
  const fetch = vi.fn(async (url: string, init: any) => {
    calls.push({ url, init })
    return url.endsWith('/receipt') ? json({ sms: 'queued' }) : json({ ok: true })
  })
  const c = new ApiClient({ fetch: fetch as any, kiosk, newKey: () => 'idem-1', sleep: async () => {} })
  c.csrf.set('csrf-k')
  return { c, calls, fetch }
}

describe('the generated kiosk route list', () => {
  it('is generated from the x-oasis-kiosk marks and the public operations, nothing else', () => {
    const spec = {
      paths: {
        '/api/v1/a': { get: { 'x-oasis-kiosk': 'none' }, post: { 'x-oasis-kiosk': 'actor' } },
        '/api/v1/b/{id}': { delete: {} },
        '/api/v1/kiosk/status': { get: { security: [] } },
        '/api/v1/me': { get: { security: [{ cookie: [] }] } },
      },
    }
    expect(kioskRoutes(spec)).toEqual([
      ['GET', '/api/v1/a', 'none'],
      ['POST', '/api/v1/a', 'actor'],
      ['GET', '/api/v1/kiosk/status', 'public'],
    ])
    expect(() => kioskRoutes({ paths: { '/x': { get: { 'x-oasis-kiosk': 'maybe' } } } })).toThrow(/unknown x-oasis-kiosk/)
    expect(generateKioskRoutes(JSON.stringify(spec))).toContain("['POST', '/api/v1/a', 'actor'],")
  })

  it('the committed list matches the backend contract the dashboard was generated from', () => {
    const file = fs.readFileSync(path.join(__dirname, 'kiosk-routes.ts'), 'utf8')
    const sha = /sha256:([0-9a-f]{16})/.exec(file)?.[1]
    const schemaSha = /sha256:([0-9a-f]{16})/.exec(fs.readFileSync(path.join(__dirname, 'schema.d.ts'), 'utf8'))?.[1]
    expect(sha).toBeDefined()
    // generated together by `pnpm gen:api`, from the same openapi.json
    expect(sha).toBe(schemaSha)
  })

  it('holds the routes the Operations screen uses on a kiosk (design 3.4), and none of Settings or Payments', () => {
    const has = (m: string, p: string) => KIOSK_ROUTES.some(([mm, pp]) => mm === m && pp === p)
    for (const [m, p] of [
      ['GET', '/api/v1/kiosk/me'],
      ['POST', '/api/v1/kiosk/lock'],
      ['GET', '/api/v1/ops/snapshot'],
      ['POST', '/api/v1/appointments/{id}/assign-bay'],
      ['POST', '/api/v1/invoices/{id}/payments'],
      ['POST', '/api/v1/invoices/{id}/receipt'],
      ['GET', '/api/v1/kiosk/status'],
      ['POST', '/api/v1/kiosk/unlock'],
    ])
      expect(has(m!, p!), `${m} ${p}`).toBe(true)
    for (const [m, p] of [
      ['PUT', '/api/v1/settings/hours'],
      ['GET', '/api/v1/settings/hours'],
      ['GET', '/api/v1/kiosk'],
      ['GET', '/api/v1/payments/summary'],
      ['POST', '/api/v1/invoices/{id}/refunds'],
      ['GET', '/api/v1/me'],
      ['DELETE', '/api/v1/appointments/{id}/photos/{photoId}'],
    ])
      expect(has(m!, p!), `${m} ${p}`).toBe(false)
  })
})

describe('kioskRouteMode', () => {
  it('matches relative and absolute paths, path parameters, query strings; literals before parameters', () => {
    expect(kioskRouteMode('GET', '/ops/snapshot?window=next24')).toBe('none')
    expect(kioskRouteMode('POST', '/appointments/a-1/assign-bay')).toBe('actor')
    expect(kioskRouteMode('POST', '/api/v1/appointments/a-1/arrive')).toBe('actor')
    expect(kioskRouteMode('POST', '/appointments/quote')).toBe('none')
    expect(kioskRouteMode('PUT', '/appointments/a-1/addons/svc-2')).toBe('actor')
    expect(kioskRouteMode('PUT', '/settings/hours')).toBeNull()
    expect(kioskRouteMode('GET', '/appointments/a-1/extra/deep')).toBeNull()
    expect(kioskRouteMode('HEAD', '/ops/snapshot')).toBe('none')
  })
  it('a parameter is one path segment', () => {
    expect(templateRegExp('/api/v1/x/{id}').test('/api/v1/x/a/b')).toBe(false)
    expect(templateRegExp('/api/v1/x/{id}').test('/api/v1/x/a.b')).toBe(true)
    const m = buildKioskMatcher([
      ['GET', '/api/v1/x/{id}', 'none'],
      ['GET', '/api/v1/x/special', 'actor'],
    ])
    expect(m('GET', '/x/special')).toBe('actor')
    expect(m('GET', '/x/other')).toBe('none')
  })
})

describe('ApiClient in kiosk mode', () => {
  it('a signed-in person: no gate, no header (the config is absent)', async () => {
    const calls: any[] = []
    const c = new ApiClient({
      fetch: (async (url: string, init: any) => (calls.push({ url, init }), json({}))) as any,
      newKey: () => 'k',
    })
    await c.put('/settings/hours', {})
    expect(calls).toHaveLength(1)
    expect(calls[0].init.headers[ACTOR_HEADER]).toBeUndefined()
  })

  it('refuses a route the kiosk may not call, before it is sent', async () => {
    const h = harness({ resolveActor: vi.fn(async () => 'emp-1') })
    const e = await h.c.put('/settings/hours', {}).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(KioskRefused)
    expect((e as ApiError).status).toBe(403)
    expect((e as ApiError).code).toBe('KIOSK_FORBIDDEN')
    expect((e as ApiError).title).toBe('Not on the kiosk')
    const g = await h.c.get('/payments/summary').catch((x: unknown) => x)
    expect(g).toBeInstanceOf(KioskRefused)
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('sends the acting employee on a write; reads and public calls pass', async () => {
    const h = harness()
    await h.c.post('/appointments/a-1/assign-bay', { bayId: 'b' }, { actor: 'emp-marco' })
    expect(h.calls[0]!.init.headers[ACTOR_HEADER]).toBe('emp-marco')
    expect(h.calls[0]!.init.headers['X-CSRF-Token']).toBe('csrf-k')
    await h.c.get('/ops/snapshot', { actor: 'emp-marco' } as any)
    expect(h.calls[1]!.init.headers[ACTOR_HEADER]).toBeUndefined()
    await createKioskApi(h.c).status()
    expect(h.calls[2]!.url).toBe('/api/v1/kiosk/status')
  })

  it('an actor write without its employee asks the fallback picker; cancelling throws KioskCancelled (silent)', async () => {
    const resolveActor = vi.fn(async () => 'emp-lena' as string | null)
    const h = harness({ resolveActor })
    await h.c.post('/appointments/a-1/arrive', { source: 'manual' })
    expect(resolveActor).toHaveBeenCalledWith({ method: 'POST', path: '/appointments/a-1/arrive' })
    expect(h.calls[0]!.init.headers[ACTOR_HEADER]).toBe('emp-lena')
    resolveActor.mockResolvedValueOnce(null)
    const e = await h.c.post('/appointments/a-1/arrive', {}).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(KioskCancelled)
    expect((e as ApiError).kind).toBe('aborted')
    expect(h.calls).toHaveLength(1)
    // a `none` write never asks
    await h.c.post('/customers/c-1/messages/read', {})
    expect(resolveActor).toHaveBeenCalledTimes(2)
  })

  it('without a fallback picker an actor write without its employee is cancelled, never sent bare', async () => {
    const h = harness({})
    const e = await h.c.post('/appointments/a-1/arrive', {}).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(KioskCancelled)
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('the kiosk endpoints: unlock is public and keeps the CSRF token of the answer; lock clears it', async () => {
    const calls: any[] = []
    const c = new ApiClient({
      fetch: (async (url: string, init: any) => {
        calls.push({ url, init })
        if (url.endsWith('/kiosk/unlock')) return json({ csrfToken: 'k-csrf', kind: 'kiosk' })
        return new Response(null, { status: 204 })
      }) as any,
      newKey: () => 'k',
    })
    const k = createKioskApi(c)
    await k.unlock('12345679')
    expect(calls[0].init.headers['X-CSRF-Token']).toBeUndefined()
    expect(calls[0].init.headers['Idempotency-Key']).toBeUndefined()
    expect(JSON.parse(calls[0].init.body)).toEqual({ pin: '12345679' })
    expect(c.csrf.get()).toBe('k-csrf')
    await k.lock()
    expect(calls[1].url).toBe('/api/v1/kiosk/lock')
    expect(calls[1].init.headers['X-CSRF-Token']).toBe('k-csrf')
    expect(c.csrf.get()).toBeNull()
  })
})

// ADR 0180 A13 (K-PIN review O1, K-PIN-DASH D3): an unlocked kiosk works only on the shop's network
describe('ApiClient: a kiosk away from the shop', () => {
  const away = () =>
    new Response(
      JSON.stringify({
        title: 'Only at the shop',
        status: 403,
        code: 'KIOSK_NOT_AT_SHOP',
        detail: 'The kiosk works only at the shop, on the shop’s Wi-Fi. It works again once this device is back on it.',
        meta: { networkSet: true },
      }),
      { status: 403, headers: { 'content-type': 'application/problem+json' } },
    )

  it('a 403 KIOSK_NOT_AT_SHOP calls onKioskAway once, is not retried, and the error reaches the caller', async () => {
    const fetch = vi.fn(async () => away())
    const seen: ApiError[] = []
    const c = new ApiClient({ fetch: fetch as any, sleep: async () => {}, onKioskAway: (e) => void seen.push(e) })
    const e = await c.get('/ops/snapshot').catch((x: unknown) => x as ApiError)
    expect(e).toMatchObject({ status: 403, code: 'KIOSK_NOT_AT_SHOP' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.meta.networkSet).toBe(true)
    // a public call (the keypad's own unlock) is an answer, not a kiosk away from the shop
    await c.post('/kiosk/unlock', { pin: '1' }, { public: true }).catch(() => undefined)
    expect(seen).toHaveLength(1)
  })

  it('while held nothing is sent; release sends what waited; a public call (GET /kiosk/status) still goes out', async () => {
    const calls: string[] = []
    const fetch = vi.fn(async (url: string) => {
      calls.push(url)
      return json({ ok: true })
    })
    const c = new ApiClient({ fetch: fetch as any, sleep: async () => {} })
    c.holdKiosk()
    expect(c.kioskHeld).toBe(true)
    let done = false
    const waiting = c.get('/ops/snapshot').then(() => (done = true))
    await c.get('/kiosk/status', { public: true })
    await new Promise((r) => setTimeout(r, 5))
    expect(calls).toEqual(['/api/v1/kiosk/status'])
    expect(done).toBe(false)
    c.holdKiosk() // twice is once
    c.releaseKiosk()
    await waiting
    expect(done).toBe(true)
    expect(calls).toEqual(['/api/v1/kiosk/status', '/api/v1/ops/snapshot'])
    expect(c.kioskHeld).toBe(false)
    c.releaseKiosk() // nothing to release
  })

  it('a held call that is aborted rejects as aborted and is never sent', async () => {
    const fetch = vi.fn(async () => json({ ok: true }))
    const c = new ApiClient({ fetch: fetch as any, sleep: async () => {} })
    c.holdKiosk()
    const ctl = new AbortController()
    const p = c.get('/ops/snapshot', { signal: ctl.signal }).catch((x: unknown) => x as ApiError)
    ctl.abort()
    expect(await p).toMatchObject({ kind: 'aborted' })
    c.releaseKiosk()
    await new Promise((r) => setTimeout(r, 5))
    expect(fetch).not.toHaveBeenCalled()
    // already aborted before it was asked
    c.holdKiosk()
    await expect(c.get('/ops/snapshot', { signal: ctl.signal })).rejects.toMatchObject({ kind: 'aborted' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
