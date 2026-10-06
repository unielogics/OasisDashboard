/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest'
import { ApiClient, createCsrfStore } from './client'
import { createAuthApi, createMeApi } from './endpoints'
import { ApiError } from './problem'
import { makeMe } from '@/auth/test-fixtures'

interface Call {
  url: string
  init: RequestInit & { headers: Record<string, string> }
}

const problem = (
  status: number,
  code: string,
  title: string,
  detail = '',
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) =>
  new Response(
    JSON.stringify({
      type: `urn:oasis:problem:${code.toLowerCase()}`,
      title,
      status,
      code,
      detail,
      requestId: 'r-1',
      ...extra,
    }),
    {
      status,
      headers: { 'content-type': 'application/problem+json', ...headers },
    },
  )
/** The ApiError a call rejects with (fails the test when it resolves). */
const rejection = (p: Promise<unknown>): Promise<ApiError> =>
  p.then(
    () => {
      throw new Error('expected a rejection')
    },
    (e: unknown) => e as ApiError,
  )
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function harness(
  responses: Array<Response | Error | (() => Response | Error)>,
  cfg: Partial<ConstructorParameters<typeof ApiClient>[0]> = {},
) {
  const calls: Call[] = []
  let i = 0
  const fetch = vi.fn(async (url: string, init: any) => {
    calls.push({ url, init })
    const r = responses[Math.min(i++, responses.length - 1)]!
    const v = typeof r === 'function' ? r() : r
    if (v instanceof Error) throw v
    return v.clone()
  })
  const sleeps: number[] = []
  const client = new ApiClient({
    fetch: fetch as any,
    sleep: async (ms) => void sleeps.push(ms),
    now: () => 0,
    ...cfg,
  })
  return { client, calls, fetch, sleeps }
}

describe('request building', () => {
  it('GET: /api/v1 prefix, query string without undefined/null, credentials, no CSRF and no Idempotency-Key', async () => {
    const { client, calls } = harness([json({ ok: 1 })])
    client.csrf.set('tok')
    await client.get('/appointments', {
      query: { from: '2026-06-13', q: undefined, status: null, limit: 5, flag: false },
    })
    expect(calls[0]!.url).toBe('/api/v1/appointments?from=2026-06-13&limit=5&flag=false')
    expect(calls[0]!.init.method).toBe('GET')
    expect(calls[0]!.init.credentials).toBe('same-origin')
    expect(calls[0]!.init.headers['X-CSRF-Token']).toBeUndefined()
    expect(calls[0]!.init.headers['Idempotency-Key']).toBeUndefined()
    expect(calls[0]!.init.headers.Accept).toBe('application/json')
    expect(calls[0]!.init.body).toBeUndefined()
  })

  it('mutations send X-CSRF-Token and a generated Idempotency-Key, JSON body and content type', async () => {
    const { client, calls } = harness([json({ id: 'x' })], { newKey: () => 'key-1' })
    client.csrf.set('csrf-abc')
    for (const [m, fn] of [
      ['POST', 'post'],
      ['PUT', 'put'],
      ['PATCH', 'patch'],
    ] as const) {
      await (client as any)[fn]('/things/1', { a: 1 })
      const c = calls.at(-1)!
      expect(c.init.method).toBe(m)
      expect(c.init.headers['X-CSRF-Token']).toBe('csrf-abc')
      expect(c.init.headers['Idempotency-Key']).toBe('key-1')
      expect(c.init.headers['Content-Type']).toBe('application/json')
      expect(c.init.body).toBe('{"a":1}')
    }
    await client.delete('/things/1')
    expect(calls.at(-1)!.init.method).toBe('DELETE')
    expect(calls.at(-1)!.init.headers['Idempotency-Key']).toBe('key-1')
  })

  it('every call without a key gets a fresh one; a supplied key is used as is; If-Match is quoted', async () => {
    let n = 0
    const { client, calls } = harness([json({})], { newKey: () => `gen-${++n}` })
    await client.post('/a')
    await client.post('/a')
    await client.post('/a', undefined, { idempotencyKey: 'mine', ifMatch: 7 })
    expect(calls.map((c) => c.init.headers['Idempotency-Key'])).toEqual(['gen-1', 'gen-2', 'mine'])
    expect(calls[2]!.init.headers['If-Match']).toBe('"7"')
  })

  it('public endpoints send neither CSRF nor Idempotency-Key', async () => {
    const { client, calls } = harness([json({ csrfToken: 't' })])
    client.csrf.set('stale')
    await client.post('/auth/login', { email: 'a', password: 'b' }, { public: true })
    expect(calls[0]!.init.headers['X-CSRF-Token']).toBeUndefined()
    expect(calls[0]!.init.headers['Idempotency-Key']).toBeUndefined()
  })

  it('absolute /api paths and an origin prefix are honoured; 204 and responseType none return undefined; text is text', async () => {
    const { client, calls } = harness(
      [new Response(null, { status: 204 }), new Response('a,b\n1,2', { status: 200 })],
      { origin: 'http://x.test' },
    )
    expect(await client.post('/auth/logout')).toBeUndefined()
    expect(calls[0]!.url).toBe('http://x.test/api/v1/auth/logout')
    expect(await client.get('/api/v1/payments/export.csv', { responseType: 'text' })).toBe('a,b\n1,2')
    expect(calls[1]!.url).toBe('http://x.test/api/v1/payments/export.csv')
  })
})

describe('idempotency key reuse across retries of one action', () => {
  it('a network failure is retried with the SAME key and succeeds', async () => {
    const { client, calls, sleeps } = harness(
      [new TypeError('fetch failed'), new TypeError('fetch failed'), json({ ok: true })],
      { newKey: () => 'k-once' },
    )
    const r = await client.post('/invoices/1/refunds', { amountCents: 100 })
    expect(r).toEqual({ ok: true })
    expect(calls.map((c) => c.init.headers['Idempotency-Key'])).toEqual(['k-once', 'k-once', 'k-once'])
    expect(sleeps).toEqual([250, 500])
  })
  it('503 and 504 retry; 502 retries; 422 and 409 (state conflict) do not', async () => {
    for (const status of [502, 503, 504]) {
      const { client, calls } = harness([problem(status, 'SERVICE_UNAVAILABLE', 'Down'), json({ ok: 1 })])
      await client.put('/x', {})
      expect(calls.length, String(status)).toBe(2)
    }
    for (const [status, code] of [
      [422, 'VALIDATION_FAILED'],
      [409, 'STALE_STATE'],
      [403, 'FORBIDDEN'],
      [404, 'NOT_FOUND'],
      [412, 'VERSION_CONFLICT'],
    ] as const) {
      const { client, calls } = harness([problem(status, code, 'No')])
      await expect(client.post('/x', {})).rejects.toBeInstanceOf(ApiError)
      expect(calls.length, String(status)).toBe(1)
    }
  })
  it('IDEMPOTENCY_IN_FLIGHT (409) is retried with the same key', async () => {
    const { client, calls } = harness([problem(409, 'IDEMPOTENCY_IN_FLIGHT', 'Busy'), json({ ok: 1 })], {
      newKey: () => 'same',
    })
    await client.post('/invoices/1/payments', {})
    expect(calls.map((c) => c.init.headers['Idempotency-Key'])).toEqual(['same', 'same'])
  })
  it('gives up after the retry budget and surfaces a network ApiError', async () => {
    const { client, calls } = harness([new TypeError('fetch failed')])
    const e = await rejection(client.post('/x', {}))
    expect(e).toBeInstanceOf(ApiError)
    expect(e.kind).toBe('network')
    expect(e.title).toBe('Can’t reach the server')
    expect(calls.length).toBe(3)
    const z = harness([new TypeError('x')])
    await z.client.post('/x', {}, { retries: 0 }).catch(() => undefined)
    expect(z.calls.length).toBe(1)
  })
  it('GET retries on network errors too; a public mutation does not retry', async () => {
    const g = harness([new TypeError('x'), json({ ok: 1 })])
    expect(await g.client.get('/me')).toEqual({ ok: 1 })
    const p = harness([new TypeError('x'), json({ ok: 1 })])
    await expect(p.client.post('/auth/login', {}, { public: true })).rejects.toBeInstanceOf(ApiError)
    expect(p.calls.length).toBe(1)
  })
  it('Retry-After shortens or lengthens the wait (capped at 10 s)', async () => {
    const a = harness([problem(503, 'SERVICE_UNAVAILABLE', 'Down', '', {}, { 'retry-after': '2' }), json({})])
    await a.client.get('/x')
    expect(a.sleeps).toEqual([2000])
    const b = harness([
      problem(503, 'SERVICE_UNAVAILABLE', 'Down', '', {}, { 'retry-after': '120' }),
      json({}),
    ])
    await b.client.get('/x')
    expect(b.sleeps).toEqual([10000])
  })
  it('an aborted request is not retried and is reported as aborted', async () => {
    const ctl = new AbortController()
    ctl.abort()
    const { client, calls } = harness([new DOMException('aborted', 'AbortError')])
    const e = await rejection(client.get('/x', { signal: ctl.signal }))
    expect(e.kind).toBe('aborted')
    expect(calls.length).toBe(1)
  })
})

describe('problem+json -> ApiError', () => {
  it('keeps title, detail, code, status, errors, requestId and meta', async () => {
    const { client } = harness([
      problem(422, 'VALIDATION_FAILED', 'Check the form', 'Some fields need attention', {
        errors: [
          { path: 'body.email', message: 'Enter a valid email address' },
          { path: 'body.items[0].qty', message: 'Must be 1 or more' },
        ],
        meta: { currentVersion: 4 },
      }),
    ])
    const e: ApiError = await rejection(client.post('/x', {}))
    expect(e).toBeInstanceOf(ApiError)
    expect(e.status).toBe(422)
    expect(e.code).toBe('VALIDATION_FAILED')
    expect(e.title).toBe('Check the form')
    expect(e.detail).toBe('Some fields need attention')
    expect(e.requestId).toBe('r-1')
    expect(e.meta).toEqual({ currentVersion: 4 })
    expect(e.fieldError('email')).toBe('Enter a valid email address')
    expect(e.fieldError('body.items[0].qty')).toBe('Must be 1 or more')
    expect(e.fieldError('nope')).toBeUndefined()
    expect(e.isValidation).toBe(true)
    expect(e.message).toBe('Check the form: Some fields need attention')
  })
  it('survives HTML, empty and malformed bodies with a status-based title and the request id header', async () => {
    for (const body of ['<html>502</html>', '', '{not json', '[1,2]', '"x"']) {
      const { client } = harness(
        [new Response(body, { status: 500, headers: { 'x-request-id': 'hdr-9' } })],
        { sleep: async () => {} },
      )
      const e: ApiError = await rejection(client.get('/x', { retries: 0 }))
      expect(e).toBeInstanceOf(ApiError)
      expect(e.status).toBe(500)
      expect(e.title).toBe('Something went wrong')
      expect(e.code).toBe('INTERNAL')
      expect(e.requestId).toBe('hdr-9')
    }
  })
  it('ignores non-string and malformed fields instead of trusting them', async () => {
    const { client } = harness([
      new Response(
        JSON.stringify({ title: 5, code: {}, detail: ['x'], errors: 'no', requestId: 3, meta: 'm' }),
        { status: 400 },
      ),
    ])
    const e: ApiError = await rejection(client.get('/x'))
    expect(e.title).toBe('Request failed')
    expect(e.code).toBe('HTTP_ERROR')
    expect(e.detail).toBe('')
    expect(e.errors).toEqual([])
    expect(e.meta).toEqual({})
  })
  it('Retry-After on a 429 is exposed in milliseconds', async () => {
    const { client } = harness([
      problem(429, 'LOGIN_THROTTLED', 'Too many attempts', 'Try later', {}, { 'retry-after': '7' }),
    ])
    const e: ApiError = await rejection(client.post('/auth/login', {}, { public: true }))
    expect(e.retryAfterMs).toBe(7000)
    expect(e.code).toBe('LOGIN_THROTTLED')
  })
  it('a 200 with an unreadable body is a parse error', async () => {
    const { client } = harness([new Response('{broken', { status: 200 })])
    const e: ApiError = await rejection(client.get('/x', { retries: 0 }))
    expect(e.kind).toBe('parse')
  })
})

describe('401 and CSRF handling', () => {
  it('calls onUnauthorized for a 401 on a normal request, and still rejects', async () => {
    const onUnauthorized = vi.fn()
    const { client } = harness([problem(401, 'UNAUTHENTICATED', 'Sign in required')], { onUnauthorized })
    await expect(client.get('/me')).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })
  it('does NOT redirect on a public 401 (wrong password is an answer, not a sign-out)', async () => {
    const onUnauthorized = vi.fn()
    const { client } = harness([problem(401, 'INVALID_CREDENTIALS', 'Sign-in failed')], { onUnauthorized })
    await expect(client.post('/auth/login', {}, { public: true })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
  it('CSRF_INVALID: fetches a fresh token once and replays the mutation with the same key', async () => {
    const { client, calls } = harness(
      [problem(403, 'CSRF_INVALID', 'Request blocked'), json({ csrfToken: 'fresh' }), json({ done: true })],
      { newKey: () => 'k-csrf' },
    )
    client.csrf.set('stale')
    expect(await client.post('/invoices/1/refunds', {})).toEqual({ done: true })
    expect(calls.map((c) => c.url)).toEqual([
      '/api/v1/invoices/1/refunds',
      '/api/v1/auth/csrf',
      '/api/v1/invoices/1/refunds',
    ])
    expect(calls[0]!.init.headers['X-CSRF-Token']).toBe('stale')
    expect(calls[2]!.init.headers['X-CSRF-Token']).toBe('fresh')
    expect(calls[2]!.init.headers['Idempotency-Key']).toBe('k-csrf')
    expect(client.csrf.get()).toBe('fresh')
  })
  it('a second CSRF_INVALID is surfaced, not looped', async () => {
    const { client, calls } = harness([
      problem(403, 'CSRF_INVALID', 'Request blocked'),
      json({ csrfToken: 'f' }),
      problem(403, 'CSRF_INVALID', 'Request blocked'),
    ])
    await expect(client.post('/x', {})).rejects.toMatchObject({ code: 'CSRF_INVALID' })
    expect(calls.length).toBe(3)
  })
  it('a plain 403 FORBIDDEN is not retried and not treated as a sign-out', async () => {
    const onUnauthorized = vi.fn()
    const { client, calls } = harness(
      [problem(403, 'FORBIDDEN', 'Not allowed', 'No', { meta: { required: 'pay.refund' } })],
      { onUnauthorized },
    )
    const e: ApiError = await rejection(client.post('/x', {}))
    expect(e.isForbidden).toBe(true)
    expect(e.meta.required).toBe('pay.refund')
    expect(calls.length).toBe(1)
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})

describe('identity endpoints', () => {
  it('login and invite-accept store the CSRF token from the response; logout clears it', async () => {
    const csrf = createCsrfStore()
    const { client, calls } = harness(
      [
        json({ user: { id: 'u' }, csrfToken: 'c1' }),
        json({ user: { id: 'u' }, csrfToken: 'c2' }),
        new Response(null, { status: 204 }),
      ],
      { csrf },
    )
    const auth = createAuthApi(client)
    await auth.login({ email: 'a@b.c', password: 'pw' })
    expect(csrf.get()).toBe('c1')
    await auth.acceptInvite({ token: 't', email: 'a@b.c', password: 'long enough password' })
    expect(csrf.get()).toBe('c2')
    await auth.logout()
    expect(csrf.get()).toBeNull()
    expect(calls.map((c) => c.url)).toEqual([
      '/api/v1/auth/login',
      '/api/v1/auth/invite/accept',
      '/api/v1/auth/logout',
    ])
    expect(calls[0]!.init.body).toBe('{"email":"a@b.c","password":"pw"}')
  })
  it('GET /me seeds the CSRF store; view-as posts {roleId} with a key and updates the token', async () => {
    const { client, calls } = harness([
      json(makeMe({ role: 'super' })),
      json({ ...makeMe({ role: 'super' }), csrfToken: 'after-view-as' }),
    ])
    const me = createMeApi(client)
    await me.get()
    expect(client.csrf.get()).toBe('csrf-token-1')
    await me.viewAs('role-crew')
    expect(calls[1]!.init.body).toBe('{"roleId":"role-crew"}')
    expect(calls[1]!.init.headers['Idempotency-Key']).toBeTruthy()
    expect(client.csrf.get()).toBe('after-view-as')
    await me.viewAs(null)
    expect(calls[2]!.init.body).toBe('{"roleId":null}')
  })
  it('theme preference is a PUT /me/preferences with the theme', async () => {
    const { client, calls } = harness([json({ theme: 'dark' })])
    await createMeApi(client).setPreferences('dark')
    expect(calls[0]!.url).toBe('/api/v1/me/preferences')
    expect(calls[0]!.init.method).toBe('PUT')
    expect(calls[0]!.init.body).toBe('{"theme":"dark"}')
  })
})
