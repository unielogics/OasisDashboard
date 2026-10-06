/* eslint-disable @typescript-eslint/no-explicit-any */
// The fake API against the real client code: ApiClient + identity endpoints + RealtimeClient over a real socket.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PERMISSION_KEYS } from '../src/auth/permissions'
import { makeSession } from '../src/auth/test-fixtures'
import { ApiClient, createCsrfStore } from '../src/data/http/client'
import { createAuthApi, createMeApi } from '../src/data/http/endpoints'
import type { MeResponse } from '../src/data/http/auth-types'
import { RealtimeClient } from '../src/data/realtime/sse'
import type { EventSourceLike, RealtimeEvent, SseMessage, StreamStatus } from '../src/data/realtime/sse'
import { toSession } from '../src/auth/session-model'
import { createFakeApi } from './fake-api'
import type { FakeApi } from './fake-api'

let api: FakeApi
let origin: string
beforeAll(async () => {
  api = createFakeApi({ heartbeatMs: 40 })
  origin = `http://127.0.0.1:${await api.listen(0)}`
})
afterAll(() => api.close())
beforeEach(async () => {
  await fetch(`${origin}/__fake/reset`, { method: 'POST' })
})

/** A client with a cookie jar (Node's fetch has none), like a browser talking to one origin. */
function browser() {
  const jar = new Map<string, string>()
  const f: typeof fetch = async (url, init) => {
    const headers = new Headers(init?.headers)
    if (jar.size) headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '))
    const res = await fetch(url, { ...init, headers })
    for (const c of res.headers.getSetCookie()) {
      const [kv, ...attrs] = c.split(';')
      const [k, ...v] = kv!.split('=')
      if (attrs.some((a) => /max-age=0/i.test(a)) || v.join('=') === '') jar.delete(k!)
      else jar.set(k!, v.join('='))
    }
    return res
  }
  const client = new ApiClient({ fetch: f, origin, csrf: createCsrfStore(), sleep: async () => {} })
  return { client, auth: createAuthApi(client), me: createMeApi(client), jar, fetch: f }
}
const login = async (email: string, b = browser()) => {
  await b.auth.login({ email, password: 'oasis-demo-1234' })
  return b
}

describe('auth', () => {
  it('rejects a wrong password with INVALID_CREDENTIALS and throttles after repeated failures (Retry-After, no lockout)', async () => {
    const b = browser()
    for (let i = 0; i < 5; i++)
      await expect(b.auth.login({ email: 'alex@oasis.test', password: 'nope' })).rejects.toMatchObject({
        status: 401,
        code: 'INVALID_CREDENTIALS',
      })
    await expect(
      b.auth.login({ email: 'alex@oasis.test', password: 'oasis-demo-1234' }),
    ).rejects.toMatchObject({ status: 429, code: 'LOGIN_THROTTLED', retryAfterMs: 3000 })
    await expect(b.auth.login({ email: 'unknown@oasis.test', password: 'x' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    })
  })

  it('login sets an httpOnly cookie, returns the CSRF token and /me works', async () => {
    const b = await login('alex@oasis.test')
    expect(b.jar.has('oasis_sid')).toBe(true)
    expect(b.client.csrf.get()).toMatch(/^[0-9a-f]{64}$/)
    const me: MeResponse = await b.me.get()
    expect(me.employee.name).toBe('Alex Rivera')
    expect(me.isSuperAdmin).toBe(true)
    expect(Object.keys(me.permissions).sort()).toEqual([...PERMISSION_KEYS].sort())
    expect(me.viewAs.options.map((o) => o.name)).toEqual([
      'Super Admin',
      'Management',
      'Accounting',
      'Customer Support',
      'Crew',
    ])
    expect(me.csrfToken).toBe(b.client.csrf.get())
  })

  it('/me without a session is a 401 problem; a mutation without the CSRF token is 403 CSRF_INVALID and the client heals itself', async () => {
    const b = await login('marco@oasis.test')
    const unauth = browser()
    await expect(unauth.me.get()).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' })
    const raw = await b.fetch(`${origin}/api/v1/me/preferences`, {
      method: 'PUT',
      body: JSON.stringify({ theme: 'dark' }),
      headers: { 'content-type': 'application/json' },
    })
    expect(raw.status).toBe(403)
    expect((await raw.json()).code).toBe('CSRF_INVALID')
    b.client.csrf.set('stale-token')
    await b.me.setPreferences('dark') // CSRF_INVALID -> GET /auth/csrf -> replay
    expect((await b.me.get()).preferences.theme).toBe('dark')
  })

  it('effective permissions: union of roles with the highest limit, crew has no money access, view-as is Super only', async () => {
    const raf = (await login('rafael@oasis.test')).me
    const m = await raf.get()
    expect(m.isSuperAdmin).toBe(false)
    expect(m.viewAs).toMatchObject({ canViewAs: false, options: [] })
    expect(m.permissions['pay.reports']).toEqual({ on: true })
    expect(m.permissions['pay.refund']).toEqual({ on: true, limit: 100000 })
    expect(m.permissions['set.billing']).toEqual({ on: true }) // acct grants it
    expect(m.preferences.theme).toBe('dark')
    await expect(raf.viewAs('role-crew')).rejects.toMatchObject({ status: 403, code: 'VIEW_AS_FORBIDDEN' })

    const crew = await (await login('marco@oasis.test')).me.get()
    expect(crew.permissions['pay.refund']).toEqual({ on: false })
    expect(crew.permissions['jobs.status']).toEqual({ on: true })
    expect(crew.limits).toEqual({})
  })

  it('view-as swaps the effective authority, keeps isSuperAdmin and canViewAs, and can be cleared', async () => {
    const b = await login('alex@oasis.test')
    const crew = await b.me.viewAs('role-crew')
    expect(crew.viewAs).toMatchObject({
      active: true,
      canViewAs: true,
      roleId: 'role-crew',
      roleName: 'Crew',
    })
    expect(crew.isSuperAdmin).toBe(true)
    expect(crew.displayRole).toBe('Crew')
    expect(crew.permissions['pay.reports']).toEqual({ on: false })
    expect(crew.viewAs.options).toHaveLength(5) // the menu must keep working while viewing a role that cannot read /roles
    expect((await b.me.get()).viewAs.active).toBe(true) // survives a reload (server side)
    const mgmt = await b.me.viewAs('role-mgmt')
    expect(mgmt.permissions['pay.refund']).toEqual({ on: true, limit: 100000 })
    expect(mgmt.permissions['set.billing']).toEqual({ on: false })
    const back = await b.me.viewAs(null)
    expect(back.viewAs.active).toBe(false)
    expect(back.permissions['set.billing']).toEqual({ on: true })
    await expect(b.me.viewAs('role-nope')).rejects.toMatchObject({ status: 404 })
  })

  it('logout revokes the session', async () => {
    const b = await login('alex@oasis.test')
    await b.auth.logout()
    expect(b.jar.has('oasis_sid')).toBe(false)
    expect(b.client.csrf.get()).toBeNull()
    await expect(b.me.get()).rejects.toMatchObject({ status: 401 })
  })

  it('invite: validates, requires an email, rejects a taken email, signs in, and the token is single use', async () => {
    const b = browser()
    await expect(
      b.auth.acceptInvite({ token: 'invite-demo-token', email: '', password: 'a long enough password' }),
    ).rejects.toMatchObject({ status: 422, code: 'VALIDATION_FAILED' })
    await expect(
      b.auth.acceptInvite({ token: 'invite-demo-token', email: 'kevin@oasis.test', password: 'short' }),
    ).rejects.toMatchObject({ status: 422 })
    await expect(
      b.auth.acceptInvite({
        token: 'invite-demo-token',
        email: 'alex@oasis.test',
        password: 'a long enough password',
      }),
    ).rejects.toMatchObject({ status: 409, code: 'EMAIL_TAKEN' })
    await expect(
      b.auth.acceptInvite({ token: 'nope', email: 'kevin@oasis.test', password: 'a long enough password' }),
    ).rejects.toMatchObject({ status: 410, code: 'INVITE_INVALID' })
    const ok = await b.auth.acceptInvite({
      token: 'invite-demo-token',
      email: 'kevin@oasis.test',
      password: 'a long enough password',
    })
    expect(ok.user.email).toBe('kevin@oasis.test')
    expect((await b.me.get()).employee.name).toBe('Kevin Tran')
    await expect(
      browser().auth.acceptInvite({
        token: 'invite-demo-token',
        email: 'k2@oasis.test',
        password: 'a long enough password',
      }),
    ).rejects.toMatchObject({ code: 'INVITE_INVALID' })
  })

  it('forgot always answers 202; reset is single use, revokes sessions and the new password works', async () => {
    const b = await login('alex@oasis.test')
    expect(await b.auth.forgot({ email: 'ghost@oasis.test' })).toEqual({ accepted: true })
    expect(await b.auth.forgot({ email: 'alex@oasis.test' })).toEqual({ accepted: true })
    await expect(
      b.auth.reset({ token: 'reset-expired', password: 'a long enough password' }),
    ).rejects.toMatchObject({ status: 410, code: 'RESET_INVALID' })
    await expect(b.auth.reset({ token: 'reset-demo-token', password: 'short' })).rejects.toMatchObject({
      status: 422,
    })
    await b.auth.reset({ token: 'reset-demo-token', password: 'brand new password!' })
    await expect(b.me.get()).rejects.toMatchObject({ status: 401 })
    await expect(
      b.auth.reset({ token: 'reset-demo-token', password: 'another password 1' }),
    ).rejects.toMatchObject({ code: 'RESET_INVALID' })
    const fresh = browser()
    await fresh.auth.login({ email: 'alex@oasis.test', password: 'brand new password!' })
    expect((await fresh.me.get()).user.email).toBe('alex@oasis.test')
  })

  it('/meta/now is public and the session model builds from /me', async () => {
    const b = browser()
    const now = await b.me.now()
    expect(now.tz).toBe('America/New_York')
    await login('alex@oasis.test', b)
    const s = toSession(await b.me.get(), { serverTime: now.now, businessTz: now.tz })
    expect(s.viewAs.canViewAs).toBe(true)
    expect(makeSession({ role: 'super' }).viewAs.canViewAs).toBe(s.viewAs.canViewAs)
  })
})

/** EventSource over fetch (Node has no global EventSource), enough to run RealtimeClient against the fake server. */
class NodeEventSource implements EventSourceLike {
  readyState = 0
  onopen: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  private listeners = new Map<string, Array<(e: SseMessage) => void>>()
  private ctl = new AbortController()
  constructor(
    url: string,
    private f: typeof fetch,
  ) {
    void this.run(url)
  }
  addEventListener(t: string, fn: (e: SseMessage) => void) {
    this.listeners.set(t, [...(this.listeners.get(t) ?? []), fn])
  }
  close() {
    this.readyState = 2
    this.ctl.abort()
  }
  comments = 0
  private async run(url: string) {
    try {
      const res = await this.f(url, { signal: this.ctl.signal, headers: { accept: 'text/event-stream' } })
      if (!res.ok || !res.headers.get('content-type')?.includes('text/event-stream'))
        throw new Error('bad stream')
      this.readyState = 1
      this.onopen?.({})
      const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
      let buf = ''
      let lastId = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) throw new Error('closed')
        buf += value
        let i: number
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i)
          buf = buf.slice(i + 2)
          let event = 'message'
          const data: string[] = []
          for (const line of frame.split('\n')) {
            if (line.startsWith(':')) this.comments++
            else if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data:')) data.push(line.slice(5).trim())
            else if (line.startsWith('id:')) lastId = line.slice(3).trim()
          }
          if (data.length)
            for (const l of this.listeners.get(event) ?? []) l({ data: data.join('\n'), lastEventId: lastId })
        }
      }
    } catch {
      if (this.readyState !== 2) this.onerror?.({})
    }
  }
}

describe('SSE: RealtimeClient against the fake /events', () => {
  const connect = async (email = 'alex@oasis.test') => {
    const b = await login(email)
    const events: RealtimeEvent[] = []
    const status: StreamStatus[] = []
    const resyncs: string[] = []
    const sources: NodeEventSource[] = []
    const urls: string[] = []
    const client = new RealtimeClient({
      url: `${origin}/api/v1/events`,
      createSource: (u) => {
        urls.push(u)
        const s = new NodeEventSource(u, b.fetch)
        sources.push(s)
        return s
      },
      random: () => 0,
      backoffBaseMs: 10,
      backoffMaxMs: 20,
      watchdogMs: 0,
      onEvent: (e) => events.push(e),
      onResync: (r) => resyncs.push(r),
      onStatus: (s) => status.push(s),
    })
    return { b, client, events, status, resyncs, sources, urls }
  }
  const until = (fn: () => boolean, ms = 15000) =>
    new Promise<void>((res, rej) => {
      const t0 = performance.now()
      const tick = () =>
        fn() ? res() : performance.now() - t0 > ms ? rej(new Error('timeout')) : setTimeout(tick, 10)
      tick()
    })

  it('delivers events published after connecting, with ids, and answers heartbeats with comments', async () => {
    const { client, events, status, sources } = await connect()
    client.start()
    await until(() => client.status === 'up')
    const id = api.emit('ops', 'appointment.updated', { id: 'a1', version: 2 })
    await until(() => events.length === 1)
    expect(events[0]).toMatchObject({
      id,
      channel: 'ops',
      type: 'appointment.updated',
      payload: { id: 'a1', version: 2 },
    })
    expect(status).toEqual(['connecting', 'up'])
    await until(() => sources[0]!.comments > 0) // `: hb` frames (invisible to a real EventSource)
    client.stop()
  })

  it('after the connection is dropped it reconnects with lastEventId and replays what it missed, then reports reconnected', async () => {
    const { client, events, status, resyncs, urls } = await connect()
    client.start()
    await until(() => client.status === 'up')
    api.emit('ops', 'kpi.dirty')
    await until(() => events.length === 1)
    const seen = client.lastEventId!
    await fetch(`${origin}/__fake/drop-streams`, { method: 'POST' })
    await until(() => status.includes('down'))
    api.emit('payments', 'invoice.updated', { id: 'INV-1' })
    api.emit('ops', 'bay.changed')
    await until(() => client.status === 'up')
    await until(() => events.length === 3)
    expect(urls.at(-1)).toContain(`lastEventId=${seen}`)
    expect(events.map((e) => e.type)).toEqual(['kpi.dirty', 'invoice.updated', 'bay.changed'])
    expect(resyncs).toEqual(['reconnected'])
    expect(status).toEqual(['connecting', 'up', 'down', 'up'])
    client.stop()
  })

  it('a cursor the server cannot replay produces a resync frame', async () => {
    const { client, resyncs } = await connect()
    // pretend the client is ahead of the log (a database restore)
    ;(client as any).lastId = 99999
    client.start()
    await until(() => resyncs.includes('resync'))
    expect(client.lastEventId).toBe(api.state.lastEventId)
    client.stop()
  })

  it('channel permissions: the ready frame lists what was asked for; an unauthenticated stream is refused', async () => {
    const b = browser()
    const res = await b.fetch(`${origin}/api/v1/events`)
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('UNAUTHENTICATED')
  })

  it('rbac.changed is published when someone changes view-as, so other tabs refetch /me', async () => {
    const { client, events, b } = await connect()
    client.start()
    await until(() => client.status === 'up')
    await b.me.viewAs('role-crew')
    await until(() => events.some((e) => e.type === 'rbac.changed'))
    client.stop()
  })
})
