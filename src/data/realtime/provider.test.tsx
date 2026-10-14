// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/auth/session'
import { makeKioskMe, makeMe } from '@/auth/test-fixtures'
import { ApiClient, createCsrfStore } from '../http/client'
import { toasts } from '../toast'
import type { ToastSpec } from '../toast'
import { RealtimeProvider } from './provider'
import type { EventSourceLike, SseMessage, Timers } from './sse'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

class ManualTimers implements Timers {
  now = 0
  private seq = 0
  private jobs = new Map<number, { at: number; fn: () => void; every?: number }>()
  setTimeout(fn: () => void, ms: number) {
    this.jobs.set(++this.seq, { at: this.now + ms, fn })
    return this.seq
  }
  clearTimeout(h: unknown) {
    this.jobs.delete(h as number)
  }
  setInterval(fn: () => void, ms: number) {
    this.jobs.set(++this.seq, { at: this.now + ms, fn, every: ms })
    return this.seq
  }
  clearInterval(h: unknown) {
    this.jobs.delete(h as number)
  }
  advance(ms: number) {
    const end = this.now + ms
    for (;;) {
      const next = [...this.jobs.entries()]
        .filter(([, j]) => j.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      const [id, job] = next
      this.now = job.at
      if (job.every) job.at += job.every
      else this.jobs.delete(id)
      job.fn()
    }
    this.now = end
  }
  get pending() {
    return this.jobs.size
  }
}

class FakeSource implements EventSourceLike {
  static all: FakeSource[] = []
  readyState = 0
  onopen: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  closed = false
  private listeners = new Map<string, Array<(e: SseMessage) => void>>()
  constructor(readonly url: string) {
    FakeSource.all.push(this)
  }
  addEventListener(type: string, fn: (e: SseMessage) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  close() {
    this.closed = true
    this.readyState = 2
  }
  emit(type: string, data: unknown, id = '') {
    for (const l of this.listeners.get(type) ?? []) l({ data: JSON.stringify(data), lastEventId: id })
  }
  static get last() {
    return FakeSource.all.at(-1)!
  }
}

let container: HTMLElement
let root: Root
let qc: QueryClient
let timers: ManualTimers
let meCalls = 0
const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })

beforeEach(() => {
  FakeSource.all = []
  meCalls = 0
  timers = new ManualTimers()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

async function mount() {
  const f = vi.fn(async (url: string) => {
    if (url.endsWith('/me')) {
      meCalls++
      return new Response(JSON.stringify(makeMe()), { status: 200 })
    }
    return new Response(JSON.stringify({ now: '2026-06-13T14:36:00.000Z', tz: 'America/New_York' }), {
      status: 200,
    })
  })
  const client = new ApiClient({ fetch: f as any, csrf: createCsrfStore() })
  const nav = { pathname: '/operations', search: '', hash: '', replace: vi.fn(), assign: vi.fn() }
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(
          SessionProvider,
          { client, nav },
          createElement(
            RealtimeProvider,
            { createSource: (u) => new FakeSource(u), timers },
            createElement('div', { id: 'app' }),
          ),
        ),
      ),
    ),
  )
  await flush()
}

describe('<RealtimeProvider>', () => {
  it('opens the stream once the session is ready and closes it on unmount', async () => {
    await mount()
    expect(container.querySelector('#app')).not.toBeNull()
    expect(FakeSource.all).toHaveLength(1)
    expect(FakeSource.last.url).toBe('/api/v1/events')
    act(() => root.unmount())
    expect(FakeSource.last.closed).toBe(true)
    root = createRoot(container)
  })

  it('rbac.changed refetches /me (after the 250 ms coalescing window), other events only mark their family stale', async () => {
    await mount()
    qc.setQueryData(['ops', 'board'], 1)
    qc.setQueryData(['payments', 'x'], 2)
    expect(meCalls).toBe(1)
    FakeSource.last.emit('message', { channel: 'settings', type: 'rbac.changed', payload: {}, at: '' }, '7')
    FakeSource.last.emit(
      'message',
      { channel: 'settings', type: 'settings.changed', payload: { section: 'hours' }, at: '' },
      '8',
    )
    act(() => timers.advance(249))
    await flush()
    expect(meCalls).toBe(1)
    act(() => timers.advance(1))
    await flush()
    expect(meCalls).toBe(2)
    expect(qc.getQueryState(['payments', 'x'])!.isInvalidated).toBe(false)
    FakeSource.last.emit(
      'message',
      { channel: 'payments', type: 'invoice.updated', payload: { id: 'INV-1', version: 4 }, at: '' },
      '9',
    )
    act(() => timers.advance(250))
    expect(qc.getQueryState(['payments', 'x'])!.isInvalidated).toBe(true)
    expect(qc.getQueryState(['ops', 'board'])!.isInvalidated).toBe(false)
  })

  it('a dropped stream toasts "Connection lost · retrying" once, refreshes on the poll fallback and refetches everything when it is back', async () => {
    const got: ToastSpec[] = []
    const off = toasts.subscribe((t) => got.push(t))
    await mount()
    qc.setQueryData(['ops', 'board'], 1)
    FakeSource.last.onopen?.({})
    FakeSource.last.onerror?.({})
    expect(got).toEqual([{ title: 'Connection lost', desc: 'retrying' }])
    FakeSource.last.onerror?.({}) // a second failure while down does not toast again
    expect(got).toHaveLength(1)
    const spy = vi.spyOn(qc, 'invalidateQueries')
    act(() => timers.advance(20_000))
    expect(spy).toHaveBeenCalledWith({ refetchType: 'active' })
    act(() => timers.advance(1000))
    expect(FakeSource.all.length).toBeGreaterThanOrEqual(2)
    FakeSource.last.onopen?.({})
    expect(spy).toHaveBeenCalledWith()
    expect(qc.getQueryState(['ops', 'board'])!.isInvalidated).toBe(true)
    off()
  })

  it('a resync frame invalidates every query', async () => {
    await mount()
    qc.setQueryData(['ops', 'board'], 1)
    qc.setQueryData(['payments', 'x'], 2)
    FakeSource.last.onopen?.({})
    FakeSource.last.emit('resync', { reason: 'cursor_unavailable', latestId: 100 }, '100')
    await flush()
    expect(qc.getQueryState(['ops', 'board'])!.isInvalidated).toBe(true)
    expect(qc.getQueryState(['payments', 'x'])!.isInvalidated).toBe(true)
  })

  it('a stream that keeps failing before it opens makes the app re-check the session', async () => {
    await mount()
    expect(meCalls).toBe(1)
    FakeSource.last.onerror?.({})
    act(() => timers.advance(1000))
    FakeSource.last.onerror?.({})
    await flush()
    expect(meCalls).toBe(2)
  })

  it('coming back to the tab reconnects at once while the stream is down', async () => {
    await mount()
    FakeSource.last.onerror?.({})
    const before = FakeSource.all.length
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    expect(FakeSource.all.length).toBe(before + 1)
  })
})

// ADR 0180 A13 (K-PIN-DASH D3): a kiosk away from the shop has no stream until it is back on the shop's Wi-Fi
describe('<RealtimeProvider> on a kiosk away from the shop', () => {
  async function mountKiosk(where: { away: boolean }) {
    const res = (b: unknown, status = 200) =>
      new Response(JSON.stringify(b), {
        status,
        headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
      })
    const f = vi.fn(async (url: string) => {
      const p = url.replace('/api/v1', '').split('?')[0]
      if (p === '/kiosk/status')
        return res({
          enabled: true,
          networkSet: true,
          atShop: !where.away,
          unlocked: { locksAt: '2026-06-14T01:00:00.000Z', locksAtLabel: '9:00 PM' },
          lockedOut: false,
          retryAfterSec: 0,
        })
      if (where.away) return res({ title: 'x', status: 403, code: 'KIOSK_NOT_AT_SHOP', meta: { networkSet: true } }, 403)
      if (p === '/me') return res({ title: 'x', status: 403, code: 'KIOSK_SESSION' }, 403)
      if (p === '/kiosk/me') return res(makeKioskMe())
      if (p === '/kiosk/staff') return res({ items: [] })
      return res({ now: '2026-06-13T14:36:00.000Z', tz: 'America/New_York' })
    })
    const client = new ApiClient({ fetch: f as any, csrf: createCsrfStore(), sleep: async () => {} })
    const nav = { pathname: '/operations', search: '', hash: '', replace: vi.fn(), assign: vi.fn() }
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: qc },
          createElement(
            SessionProvider,
            { client, nav, awayRecheckMs: 60_000 },
            createElement(RealtimeProvider, { createSource: (u) => new FakeSource(u), timers }, createElement('div', { id: 'app' })),
          ),
        ),
      ),
    )
    await flush()
    return { client, nav }
  }

  it('the stream closes and is not reopened while the board is covered; back at the shop it opens again', async () => {
    const where = { away: false }
    const { client, nav } = await mountKiosk(where)
    expect(FakeSource.all).toHaveLength(1)
    where.away = true
    await client.get('/ops/snapshot').catch(() => undefined)
    await flush()
    expect(container.querySelector('[data-kiosk-away]')).not.toBeNull()
    expect(FakeSource.last.closed).toBe(true)
    // no reconnects, no poll fallback, while covered
    act(() => timers.advance(5 * 60_000))
    await flush()
    expect(FakeSource.all).toHaveLength(1)
    expect(timers.pending).toBe(0)
    // back on the shop's Wi-Fi (focus reads the status at once)
    where.away = false
    await act(async () => void window.dispatchEvent(new Event('focus')))
    await flush()
    await flush()
    expect(container.querySelector('[data-kiosk-away]')).toBeNull()
    expect(FakeSource.all).toHaveLength(2)
    expect(FakeSource.last.closed).toBe(false)
    expect(nav.replace).not.toHaveBeenCalled()
  })

  it('a stream refused at connect (no other call made) brings the cover up: the stream errors, the session is read again (K-PIN-DASH recheck V2)', async () => {
    const where = { away: false }
    await mountKiosk(where)
    expect(FakeSource.all).toHaveLength(1)
    // the tablet leaves the shop's Wi-Fi while the board is idle: only the stream notices (the server answers its connect 403)
    where.away = true
    FakeSource.last.onerror?.({})
    act(() => timers.advance(1000))
    FakeSource.last.onerror?.({})
    await flush()
    await flush()
    expect(container.querySelector('[data-kiosk-away]')).not.toBeNull()
    expect(FakeSource.last.closed).toBe(true)
    const opened = FakeSource.all.length
    act(() => timers.advance(5 * 60_000))
    await flush()
    expect(FakeSource.all).toHaveLength(opened) // no reconnect loop under the cover
    where.away = false
    await act(async () => void window.dispatchEvent(new Event('focus')))
    await flush()
    await flush()
    expect(container.querySelector('[data-kiosk-away]')).toBeNull()
    expect(FakeSource.all).toHaveLength(opened + 1)
    expect(FakeSource.last.closed).toBe(false)
  })
})
