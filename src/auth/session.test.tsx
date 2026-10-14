// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, createElement, useEffect } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClient, createCsrfStore } from '@/data/http/client'
import { ApiError } from '@/data/http/problem'
import { toasts } from '@/data/toast'
import type { ToastSpec } from '@/data/toast'
import { THEME_KEY } from '@/data/theme'
import { serverClock, serverNow } from '@/lib/clock'
import { liveChrome } from './chrome'
import {
  SessionProvider,
  loadSession,
  lockAndLeave,
  lockedUrl,
  msUntil,
  redirectToLogin,
  signOutAndLeave,
  useCan,
  useLimit,
  useSession,
} from './session'
import { createKioskApi, createMeApi } from '@/data/http/endpoints'
import { SUPER_OPTIONS, makeKioskMe, makeMe } from './test-fixtures'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const problem = (status: number, code: string, title: string, detail = '') =>
  new Response(JSON.stringify({ title, status, code, detail }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  })
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
const NOW = {
  now: '2026-06-13T14:36:00.000Z',
  tz: 'America/New_York',
  bizDate: '2026-06-13',
  weekday: 6,
  minutes: 636,
  dateLabel: 'Saturday, June 13',
}

type Route = (req: {
  method: string
  path: string
  body: any
  headers: Record<string, string>
}) => Response | undefined
function makeFetch(routes: Route[]) {
  const log: Array<{ method: string; path: string; body: any; headers: Record<string, string> }> = []
  const fn = vi.fn(async (url: string, init: any) => {
    const req = {
      method: init.method as string,
      path: String(url).replace('/api/v1', ''),
      body: init.body ? JSON.parse(init.body) : undefined,
      headers: init.headers as Record<string, string>,
    }
    log.push(req)
    for (const r of routes) {
      const res = r(req)
      if (res) return res.clone()
    }
    return problem(404, 'NOT_FOUND', 'Not found')
  })
  return { fn, log }
}
const on =
  (method: string, path: string, make: (req: any) => Response): Route =>
  (req) =>
    req.method === method && req.path === path ? make(req) : undefined

let container: HTMLElement
let root: Root
let qc: QueryClient
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  localStorage.clear()
  serverClock.reset()
  liveChrome.setSession(null)
  liveChrome.bind({ signOut: () => {}, viewAs: () => {} })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

const nav = () => ({
  pathname: '/payments',
  search: '?range=7d',
  hash: '#x',
  replace: vi.fn(),
  assign: vi.fn(),
})
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}
const mount = async (el: ReactNode) => {
  await act(async () => root.render(createElement(QueryClientProvider, { client: qc }, el)))
  await flush()
}
function client(fetchFn: any) {
  return new ApiClient({ fetch: fetchFn, csrf: createCsrfStore(), sleep: async () => {}, retryBaseMs: 1 })
}

const Probe = ({ out }: { out: (v: ReturnType<typeof useSession>) => void }) => {
  const s = useSession()
  useEffect(() => {
    out(s)
  })
  return createElement('div', { id: 'app' }, `hello ${s.session.user.name}`)
}

describe('loadSession', () => {
  it('reads /me and the server clock from /meta/now when /me carries none, and syncs serverNow()', async () => {
    const { fn } = makeFetch([
      on('GET', '/me', () => json(makeMe())),
      on('GET', '/meta/now', () => json(NOW)),
    ])
    const s = await loadSession(createMeApi(client(fn)))
    expect(s.serverTime).toBe(NOW.now)
    expect(s.businessTz).toBe('America/New_York')
    expect(serverClock.isSynced).toBe(true)
    expect(Math.abs(serverNow() - Date.parse(NOW.now))).toBeLessThan(50)
  })
  it('prefers serverTime/businessTz from /me when the backend sends them', async () => {
    const { fn } = makeFetch([
      on('GET', '/me', () =>
        json({ ...makeMe(), serverTime: '2026-06-13T15:00:00.000Z', businessTz: 'America/Chicago' }),
      ),
      on('GET', '/meta/now', () => json(NOW)),
    ])
    const s = await loadSession(createMeApi(client(fn)))
    expect(s.serverTime).toBe('2026-06-13T15:00:00.000Z')
    expect(s.businessTz).toBe('America/Chicago')
    expect(Math.abs(serverNow() - Date.parse('2026-06-13T15:00:00.000Z'))).toBeLessThan(50)
  })
  it('survives /meta/now failing', async () => {
    const { fn } = makeFetch([on('GET', '/me', () => json(makeMe()))])
    const s = await loadSession(createMeApi(client(fn)))
    expect(s.businessTz).toBe('America/New_York')
  })
  it('a 401 from /me rejects with an ApiError', async () => {
    const { fn } = makeFetch([
      on('GET', '/me', () => problem(401, 'UNAUTHENTICATED', 'Sign in required')),
      on('GET', '/meta/now', () => json(NOW)),
    ])
    await expect(loadSession(createMeApi(client(fn)))).rejects.toMatchObject({ status: 401 })
  })
})

describe('<SessionProvider>', () => {
  it('shows the boot splash while loading, then the screen; feeds the chrome store and the helpers', async () => {
    const gate: { release: () => void } = { release: () => {} }
    const wait = new Promise<void>((r) => (gate.release = r))
    const f = vi.fn(async (url: string) => {
      if (url.endsWith('/me')) {
        await wait
        return json(makeMe({ role: 'super', preferences: { theme: 'dark' } }))
      }
      return json(NOW)
    })
    let seen: ReturnType<typeof useSession> | undefined
    const Helpers = () => {
      const refund = useLimit('refund')
      const can = useCan('pay.reports')
      return createElement('span', { id: 'h' }, `${can}:${refund.maxCents}`)
    }
    await mount(
      createElement(
        SessionProvider,
        { client: client(f), nav: nav() },
        createElement(Probe, { out: (v) => (seen = v) }),
        createElement(Helpers),
      ),
    )
    expect(container.querySelector('[role=status]')).not.toBeNull()
    expect(container.querySelector('#app')).toBeNull()
    await act(async () => gate.release())
    await flush()
    expect(container.querySelector('#app')!.textContent).toBe('hello Rafael Mendes')
    expect(container.querySelector('#h')!.textContent).toBe('true:Infinity')
    expect(seen!.session.isSuperAdmin).toBe(true)
    expect(liveChrome.vals().user.short).toBe('Rafael M.')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
  })

  it('the server theme is in localStorage BEFORE the screen mounts (the classes read it in their constructor)', async () => {
    localStorage.setItem(THEME_KEY, 'light')
    const { fn } = makeFetch([
      on('GET', '/me', () => json(makeMe({ preferences: { theme: 'dark' } }))),
      on('GET', '/meta/now', () => json(NOW)),
    ])
    let atConstruct: string | null = 'unset'
    const Screen = () => {
      if (atConstruct === 'unset') atConstruct = localStorage.getItem(THEME_KEY)
      return createElement('i')
    }
    await mount(createElement(SessionProvider, { client: client(fn), nav: nav() }, createElement(Screen)))
    expect(atConstruct).toBe('dark')
  })

  it('a 401 goes to /login?next=<current path> once, never mounts the screen', async () => {
    const n = nav()
    const { fn } = makeFetch([
      on('GET', '/me', () => problem(401, 'UNAUTHENTICATED', 'Sign in required')),
      on('GET', '/meta/now', () => json(NOW)),
    ])
    await mount(
      createElement(SessionProvider, { client: client(fn), nav: n }, createElement('div', { id: 'app' })),
    )
    await flush()
    expect(n.replace).toHaveBeenCalledTimes(1)
    expect(n.replace).toHaveBeenCalledWith('/login?next=%2Fpayments%3Frange%3D7d%23x&expired=1')
    expect(container.querySelector('#app')).toBeNull()
  })

  it('a server failure shows a failure card with Try again, which retries', async () => {
    let fail = true
    const { fn } = makeFetch([
      on('GET', '/me', () => (fail ? problem(500, 'INTERNAL', 'Something went wrong') : json(makeMe()))),
      on('GET', '/meta/now', () => json(NOW)),
    ])
    await mount(
      createElement(SessionProvider, { client: client(fn), nav: nav() }, createElement('div', { id: 'app' })),
    )
    await vi.waitFor(() => expect(container.querySelector('[role=alert]')).not.toBeNull(), { timeout: 4000 })
    expect(container.textContent).toContain('Couldn’t load your session')
    expect(container.querySelector('#app')).toBeNull()
    fail = false
    await act(async () => {
      ;(container.querySelector('button') as HTMLButtonElement).click()
    })
    await vi.waitFor(() => expect(container.querySelector('#app')).not.toBeNull())
  })

  it('a network failure says the server cannot be reached', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    await mount(
      createElement(SessionProvider, { client: client(f), nav: nav() }, createElement('div', { id: 'app' })),
    )
    await vi.waitFor(() => expect(container.textContent).toContain('Can’t reach Oasis'), { timeout: 4000 })
  })

  it('a mid-session 401 from any request sends the person to /login', async () => {
    const n = nav()
    let signedIn = true
    const { fn } = makeFetch([
      on('GET', '/me', () =>
        signedIn ? json(makeMe()) : problem(401, 'UNAUTHENTICATED', 'Sign in required'),
      ),
      on('GET', '/meta/now', () => json(NOW)),
      on('GET', '/ops/snapshot', () => problem(401, 'UNAUTHENTICATED', 'Sign in required')),
    ])
    const c = client(fn)
    await mount(createElement(SessionProvider, { client: c, nav: n }, createElement('div', { id: 'app' })))
    expect(container.querySelector('#app')).not.toBeNull()
    signedIn = false
    await c.get('/ops/snapshot').catch(() => undefined)
    expect(n.replace).toHaveBeenCalledWith('/login?next=%2Fpayments%3Frange%3D7d%23x&expired=1')
  })

  it('view-as posts the role with an Idempotency-Key, then refetches /me and the other families', async () => {
    let viewing: string | null = null
    const me = () =>
      makeMe({
        role: 'super',
        displayRole: viewing ? 'Crew' : 'Super Admin',
        viewAs: {
          active: !!viewing,
          canViewAs: true,
          roleId: viewing,
          roleName: viewing ? 'Crew' : null,
          options: SUPER_OPTIONS,
        },
      })
    const { fn, log } = makeFetch([
      on('GET', '/me', () => json(me())),
      on('GET', '/meta/now', () => json(NOW)),
      on('POST', '/me/view-as', (req) => ((viewing = req.body.roleId), json(me()))),
    ])
    let api: ReturnType<typeof useSession> | undefined
    qc.setQueryData(['ops', 'board'], 1)
    qc.setQueryData(['payments', 'x'], 2)
    await mount(
      createElement(
        SessionProvider,
        { client: client(fn), nav: nav() },
        createElement(Probe, { out: (v) => (api = v) }),
      ),
    )
    expect(liveChrome.vals().viewAs.active).toBe(false)
    await act(async () => api!.viewAs('role-crew'))
    await flush()
    const post = log.find((r) => r.method === 'POST')!
    expect(post.path).toBe('/me/view-as')
    expect(post.body).toEqual({ roleId: 'role-crew' })
    expect(post.headers['Idempotency-Key']).toBeTruthy()
    expect(post.headers['X-CSRF-Token']).toBe('csrf-token-1')
    expect(liveChrome.vals().viewAs.active).toBe(true)
    expect(liveChrome.vals().viewAs.label).toBe('Crew')
    expect(qc.getQueryState(['ops', 'board'])!.isInvalidated).toBe(true)
    expect(qc.getQueryState(['payments', 'x'])!.isInvalidated).toBe(true)
    await act(async () => api!.viewAs(null))
    await flush()
    expect(liveChrome.vals().viewAs.active).toBe(false)
  })

  it('a refused view-as shows the server message as a toast and changes nothing', async () => {
    const { fn } = makeFetch([
      on('GET', '/me', () => json(makeMe({ role: 'super' }))),
      on('GET', '/meta/now', () => json(NOW)),
      on('POST', '/me/view-as', () =>
        problem(403, 'VIEW_AS_FORBIDDEN', 'Not allowed', 'Only a Super Admin can view as another role'),
      ),
    ])
    const got: ToastSpec[] = []
    const off = toasts.subscribe((t) => got.push(t))
    let api: ReturnType<typeof useSession> | undefined
    await mount(
      createElement(
        SessionProvider,
        { client: client(fn), nav: nav() },
        createElement(Probe, { out: (v) => (api = v) }),
      ),
    )
    await act(async () => api!.viewAs('role-crew'))
    off()
    expect(got).toEqual([{ title: 'Not allowed', desc: 'Only a Super Admin can view as another role' }])
    expect(liveChrome.vals().viewAs.active).toBe(false)
  })

  it('sign-out (the header menu) posts /auth/logout, clears the theme cache and client state, lands on /login', async () => {
    const n = nav()
    const { fn, log } = makeFetch([
      on('GET', '/me', () => json(makeMe({ preferences: { theme: 'dark' } }))),
      on('GET', '/meta/now', () => json(NOW)),
      on('POST', '/auth/logout', () => new Response(null, { status: 204 })),
    ])
    await mount(
      createElement(SessionProvider, { client: client(fn), nav: n }, createElement(Probe, { out: () => {} })),
    )
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
    qc.setQueryData(['ops', 'board'], 1)
    await act(async () => {
      liveChrome.vals().menu.signOut()
    })
    await flush()
    expect(log.some((r) => r.method === 'POST' && r.path === '/auth/logout')).toBe(true)
    expect(localStorage.getItem(THEME_KEY)).toBeNull()
    expect(qc.getQueryData(['ops', 'board'])).toBeUndefined()
    expect(n.assign).toHaveBeenCalledWith('/login')
    expect(liveChrome.hasSession).toBe(false)
    expect(serverClock.isSynced).toBe(false)
  })

  it('a theme toggle inside a screen is saved with PUT /me/preferences; a failed save restores the cache and toasts', async () => {
    let putOk = true
    const { fn, log } = makeFetch([
      on('GET', '/me', () => json(makeMe({ preferences: { theme: 'light' } }))),
      on('GET', '/meta/now', () => json(NOW)),
      on('PUT', '/me/preferences', () =>
        putOk ? json({ theme: 'dark' }) : problem(500, 'INTERNAL', 'Something went wrong'),
      ),
    ])
    const got: ToastSpec[] = []
    const off = toasts.subscribe((t) => got.push(t))
    await mount(
      createElement(
        SessionProvider,
        { client: client(fn), nav: nav() },
        createElement(Probe, { out: () => {} }),
      ),
    )
    liveChrome.themeChanged('dark', 'light')
    await flush()
    expect(log.find((r) => r.method === 'PUT')!.body).toEqual({ theme: 'dark' })
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
    putOk = false
    liveChrome.themeChanged('light', 'dark')
    await vi.waitFor(() => expect(got.length).toBe(1), { timeout: 4000 })
    expect(got[0]!.title).toBe('Couldn’t save your theme')
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
    off()
  })

  it('a click outside the header menus closes them; a click inside does not', async () => {
    const { fn } = makeFetch([
      on('GET', '/me', () => json(makeMe())),
      on('GET', '/meta/now', () => json(NOW)),
    ])
    await mount(
      createElement(
        SessionProvider,
        { client: client(fn), nav: nav() },
        createElement(Probe, { out: () => {} }),
        createElement('div', { 'data-live-menu': 'user', id: 'menu' }, createElement('b', { id: 'in' })),
      ),
    )
    act(() => liveChrome.toggleUserMenu())
    expect(liveChrome.vals().menu.open).toBe(true)
    act(
      () => void document.getElementById('in')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })),
    )
    expect(liveChrome.vals().menu.open).toBe(true)
    act(() => void document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(liveChrome.vals().menu.open).toBe(false)
  })
})

describe('redirectToLogin and signOutAndLeave', () => {
  it('redirectToLogin keeps path, query and hash, and does nothing on a login-family page', () => {
    const loc = { pathname: '/settings', search: '', hash: '#emergency', replace: vi.fn() }
    redirectToLogin(loc)
    expect(loc.replace).toHaveBeenCalledWith('/login?next=%2Fsettings%23emergency')
    const expired = { pathname: '/operations', search: '', hash: '', replace: vi.fn() }
    redirectToLogin(expired, { expired: true })
    expect(expired.replace).toHaveBeenCalledWith('/login?expired=1')
    const onLogin = { pathname: '/login', search: '?next=/x', hash: '', replace: vi.fn() }
    redirectToLogin(onLogin)
    expect(onLogin.replace).not.toHaveBeenCalled()
  })
  it('signOutAndLeave still leaves when the logout call fails', async () => {
    const assign = vi.fn()
    await signOutAndLeave(
      {
        logout: async () => {
          throw new ApiError({ status: 0, kind: 'network' })
        },
      },
      undefined,
      { assign },
    )
    expect(assign).toHaveBeenCalledWith('/login')
  })
})

describe('kiosk sessions (ADR 0180, DV-1002, DV-1014)', () => {
  const kioskRoutes = (over: Route[] = []) =>
    makeFetch([
      ...over,
      on('GET', '/me', () => problem(403, 'KIOSK_SESSION', 'This is the shop’s kiosk')),
      on('GET', '/meta/now', () => json(NOW)),
      on('GET', '/kiosk/me', () => json(makeKioskMe())),
      on('GET', '/kiosk/staff', () => json({ items: makeKioskMe().staff })),
      on('POST', '/kiosk/lock', () => new Response(null, { status: 204 })),
    ])

  it('loadSession: /me says KIOSK_SESSION, the session is GET /kiosk/me (and its server clock)', async () => {
    const { fn, log } = kioskRoutes()
    const c = client(fn)
    const s = await loadSession(createMeApi(c), undefined, createKioskApi(c))
    expect(s.kind).toBe('kiosk')
    expect(s.kiosk).toMatchObject({ deviceName: 'Front desk tablet', locksAtLabel: '9:00 PM', rule: 'closing' })
    expect(s.kiosk!.staff.map((p) => p.name)).toEqual(['Marco R.', 'Lena K.', 'Sofia P.'])
    expect(s.user).toMatchObject({ initials: 'K', name: 'Front desk tablet' })
    expect(s.roleTitle).toBe('Kiosk')
    expect(s.permissions['sched.view']).toEqual({ on: true })
    expect(s.permissions['pay.refund']).toEqual({ on: false })
    expect(s.permissions['set.hours']).toEqual({ on: false })
    expect(s.viewAs.canViewAs).toBe(false)
    expect(c.csrf.get()).toBe('kiosk-csrf-1')
    expect(serverClock.isSynced).toBe(true)
    expect(log.map((r) => r.method + ' ' + r.path)).toContain('GET /kiosk/me')
  })

  it('a refetch while the client is in kiosk mode re-reads GET /kiosk/me (the client refuses /me locally) (F2)', async () => {
    const { fn, log } = kioskRoutes()
    const c = client(fn)
    c.configure({ kiosk: { resolveActor: async () => null } })
    const s = await loadSession(createMeApi(c), undefined, createKioskApi(c))
    expect(s.kind).toBe('kiosk')
    expect(log.map((r) => r.method + ' ' + r.path)).toContain('GET /kiosk/me')
    expect(log.some((r) => r.path === '/me')).toBe(false)
  })

  it('the provider: refresh() of a kiosk session re-reads /kiosk/me; an ended session there goes to the keypad (F2)', async () => {
    let ended = false
    const { fn, log } = kioskRoutes([
      on('GET', '/kiosk/me', () => (ended ? problem(401, 'UNAUTHENTICATED', 'Sign in') : json(makeKioskMe()))),
    ])
    const c = client(fn)
    const n = nav()
    let seen: ReturnType<typeof useSession> | undefined
    await mount(createElement(SessionProvider, { client: c, nav: n }, createElement(Probe, { out: (v) => (seen = v) })))
    expect(seen!.session.kind).toBe('kiosk')
    const reads = () => log.filter((r) => r.method === 'GET' && r.path === '/kiosk/me').length
    const before = reads()
    await act(async () => {
      await seen!.refresh()
    })
    await flush()
    expect(reads()).toBe(before + 1)
    expect(seen!.session.kind).toBe('kiosk')
    ended = true
    await act(async () => {
      await seen!.refresh().catch(() => {})
    })
    await flush()
    expect(reads()).toBe(before + 2)
    expect(n.replace).toHaveBeenCalledWith('/login?locked=1')
  })

  it('loadSession without the kiosk endpoints keeps today’s behaviour: KIOSK_SESSION rejects', async () => {
    const { fn } = kioskRoutes()
    await expect(loadSession(createMeApi(client(fn)))).rejects.toMatchObject({ code: 'KIOSK_SESSION' })
  })

  it('a person’s /me still wins; kioskDevice comes through for the bar', async () => {
    const { fn } = makeFetch([
      on('GET', '/me', () => json(makeMe({ kioskDevice: { id: 'dev-1', name: 'Front desk tablet' } }))),
      on('GET', '/meta/now', () => json(NOW)),
    ])
    const c = client(fn)
    const s = await loadSession(createMeApi(c), undefined, createKioskApi(c))
    expect(s.kind).toBe('user')
    expect(s.kioskDevice).toEqual({ id: 'dev-1', name: 'Front desk tablet' })
  })

  it('the provider: kiosk chrome, the client refuses Settings writes locally, Lock kiosk posts /kiosk/lock', async () => {
    const { fn, log } = kioskRoutes()
    const c = client(fn)
    const n = nav()
    let seen: ReturnType<typeof useSession> | undefined
    await mount(createElement(SessionProvider, { client: c, nav: n }, createElement(Probe, { out: (v) => (seen = v) })))
    expect(container.querySelector('#app')!.textContent).toBe('hello Front desk tablet')
    expect(seen!.session.kind).toBe('kiosk')
    expect(liveChrome.vals().menu.signOutLabel).toBe('Lock kiosk')
    expect(liveChrome.picker.people()).toHaveLength(3)
    const before = log.length
    await expect(c.put('/settings/hours', {})).rejects.toMatchObject({ code: 'KIOSK_FORBIDDEN' })
    expect(log.length).toBe(before)
    // the theme stays on the tablet: no PUT /me/preferences
    liveChrome.themeChanged('dark', 'light')
    await flush()
    expect(log.some((r) => r.path === '/me/preferences')).toBe(false)
    await act(async () => {
      await seen!.signOut()
    })
    expect(log.some((r) => r.method === 'POST' && r.path === '/kiosk/lock')).toBe(true)
    expect(n.assign).toHaveBeenCalledWith('/login?locked=1')
  })

  it('locks by itself at the lock time (server clock): the keypad with the time it locked', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const me = makeKioskMe({
        serverTime: '2026-06-13T14:36:00.000Z',
        lock: { unlockedAt: '2026-06-13T11:58:00.000Z', locksAt: '2026-06-13T14:46:00.000Z', locksAtLabel: '10:46 AM', rule: 'two_hours' },
      })
      const { fn } = makeFetch([
        on('GET', '/me', () => problem(403, 'KIOSK_SESSION', 'x')),
        on('GET', '/meta/now', () => json(NOW)),
        on('GET', '/kiosk/me', () => json(me)),
        on('GET', '/kiosk/staff', () => json({ items: me.staff })),
      ])
      const n = nav()
      await act(async () =>
        root.render(
          createElement(
            QueryClientProvider,
            { client: qc },
            createElement(SessionProvider, { client: client(fn), nav: n }, createElement('div', { id: 'x' })),
          ),
        ),
      )
      for (let i = 0; i < 10; i++) await act(async () => void (await vi.advanceTimersByTimeAsync(1)))
      expect(n.replace).not.toHaveBeenCalled()
      await act(async () => void (await vi.advanceTimersByTimeAsync(10 * 60_000)))
      expect(n.replace).toHaveBeenCalledWith('/login?locked=1&at=10%3A46%20AM')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a kiosk whose session ended elsewhere (401) goes to the keypad, not to “session expired”', async () => {
    let locked = false
    const { fn } = kioskRoutes([
      (req) => (locked && req.path === '/ops/snapshot' ? problem(401, 'UNAUTHENTICATED', 'Sign in') : undefined),
      on('GET', '/ops/snapshot', () => json({})),
    ])
    const c = client(fn)
    const n = nav()
    await mount(createElement(SessionProvider, { client: c, nav: n }, createElement('div', { id: 'x' })))
    locked = true
    await c.get('/ops/snapshot').catch(() => undefined)
    expect(n.replace).toHaveBeenCalledWith('/login?locked=1')
  })

  // ADR 0180 A13 (K-PIN review O1, K-PIN-DASH D3): an unlocked kiosk works only on the shop's network
  describe('away from the shop (403 KIOSK_NOT_AT_SHOP)', () => {
    const notAtShop = (networkSet = true) =>
      new Response(
        JSON.stringify({
          title: 'Only at the shop',
          status: 403,
          code: 'KIOSK_NOT_AT_SHOP',
          detail: 'The kiosk works only at the shop, on the shop’s Wi-Fi. It works again once this device is back on it.',
          meta: { networkSet },
        }),
        { status: 403, headers: { 'content-type': 'application/problem+json' } },
      )
    const status = (o: { atShop: boolean; networkSet?: boolean; unlocked?: boolean; enabled?: boolean }) =>
      json({
        enabled: o.enabled ?? true,
        networkSet: o.networkSet ?? true,
        atShop: o.atShop,
        unlocked: o.unlocked === false ? null : { locksAt: '2026-06-14T01:00:00.000Z', locksAtLabel: '9:00 PM' },
        lockedOut: false,
        retryAfterSec: 0,
      })
    const wait = async (ms: number) => {
      await act(async () => {
        await new Promise((r) => setTimeout(r, ms))
      })
      await flush()
    }
    const cover = () => container.querySelector('[data-kiosk-away]')
    const sent = (log: Array<{ method: string; path: string }>, from: number) =>
      log.slice(from).map((r) => r.method + ' ' + r.path.split('?')[0])

    it('covers the board, holds every call, reads the status again; back at the shop the cover goes and the board reads again (session kept)', async () => {
      const where = { away: false }
      const { fn, log } = kioskRoutes([
        (req) => (where.away && req.path !== '/kiosk/status' ? notAtShop() : undefined),
        on('GET', '/kiosk/status', () => status({ atShop: !where.away })),
        on('GET', '/ops/snapshot', () => json({ ok: true })),
      ])
      const c = client(fn)
      const n = nav()
      let seen: ReturnType<typeof useSession> | undefined
      await mount(
        createElement(
          SessionProvider,
          { client: c, nav: n, awayRecheckMs: 40 },
          createElement(Probe, { out: (v) => (seen = v) }),
        ),
      )
      expect(seen!.session.kind).toBe('kiosk')
      expect(cover()).toBeNull()
      expect(seen!.kioskAway).toBe(false)
      // the tablet leaves the shop's Wi-Fi: the next call answers 403 KIOSK_NOT_AT_SHOP
      where.away = true
      await expect(c.get('/ops/snapshot')).rejects.toMatchObject({ code: 'KIOSK_NOT_AT_SHOP' })
      await flush()
      expect(cover()).not.toBeNull()
      expect(cover()!.textContent).toContain('This tablet works only on the shop’s Wi-Fi')
      expect(cover()!.textContent).toContain('Connect it to the shop Wi-Fi. The board comes back by itself — no PIN needed.')
      expect([...cover()!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Manager sign-in'])
      expect(cover()!.querySelectorAll('a')).toHaveLength(0)
      // the board stays under it, the session is kept
      expect(container.querySelector('#app')!.textContent).toBe('hello Front desk tablet')
      expect(seen!.kioskAway).toBe(true)
      // nothing more is sent but the public status, read again every 40 ms here (30 s in the app), one at a time
      const mark = log.length
      let held = false
      const pending = c.get('/ops/snapshot').then(() => (held = true))
      await wait(150)
      const out = sent(log, mark)
      expect(out.length).toBeGreaterThanOrEqual(2)
      expect(out.every((x) => x === 'GET /kiosk/status')).toBe(true)
      expect(held).toBe(false)
      expect(n.replace).not.toHaveBeenCalled()
      expect(n.assign).not.toHaveBeenCalled()
      expect(log.some((r) => r.method === 'POST' && r.path === '/kiosk/lock')).toBe(false)
      // back on the shop's Wi-Fi: the cover goes by itself, what waited is sent, the board reads again
      where.away = false
      const back = log.length
      await wait(120)
      await pending
      expect(held).toBe(true)
      expect(cover()).toBeNull()
      expect(seen!.kioskAway).toBe(false)
      expect(c.kioskHeld).toBe(false)
      expect(sent(log, back)).toContain('GET /ops/snapshot')
      expect(sent(log, back)).toContain('GET /kiosk/me')
      const reads = log.length
      await wait(120)
      expect(sent(log, reads).filter((x) => x === 'GET /kiosk/status')).toHaveLength(0) // no more status reads
      expect(n.replace).not.toHaveBeenCalled()
    })

    it('opened away from the shop: only the cover (no board yet); the no-network words; back: the board loads', async () => {
      const where = { away: true, networkSet: false }
      const { fn } = kioskRoutes([
        (req) => (where.away && req.path !== '/kiosk/status' ? notAtShop(where.networkSet) : undefined),
        on('GET', '/kiosk/status', () => status({ atShop: !where.away, networkSet: where.networkSet })),
      ])
      const c = client(fn)
      const n = nav()
      await mount(createElement(SessionProvider, { client: c, nav: n, awayRecheckMs: 40 }, createElement(Probe, { out: () => {} })))
      await flush()
      expect(container.querySelector('#app')).toBeNull()
      expect(cover()!.textContent).toContain('A Super Admin must set the shop network first — Settings → Kiosk')
      expect(cover()!.textContent).toContain('The board comes back by itself once it’s set.')
      expect(container.textContent).not.toContain('Couldn’t load your session')
      // the Super Admin adds a network that is not this one: the words change, the cover stays
      where.networkSet = true
      await wait(100)
      expect(cover()!.textContent).toContain('This tablet works only on the shop’s Wi-Fi')
      where.away = false
      await wait(150)
      expect(cover()).toBeNull()
      expect(container.querySelector('#app')!.textContent).toBe('hello Front desk tablet')
      expect(n.replace).not.toHaveBeenCalled()
    })

    it('the kiosk locked meanwhile (status: not unlocked) goes to the keypad; Manager sign-in is the sign-in page', async () => {
      const where = { unlocked: true }
      const { fn } = kioskRoutes([
        on('GET', '/kiosk/status', () => status({ atShop: false, unlocked: where.unlocked })),
        on('GET', '/ops/snapshot', () => notAtShop()),
      ])
      const c = client(fn)
      const n = nav()
      await mount(createElement(SessionProvider, { client: c, nav: n, awayRecheckMs: 60_000 }, createElement('div', { id: 'x' })))
      await c.get('/ops/snapshot').catch(() => undefined)
      await flush()
      const btn = [...cover()!.querySelectorAll('button')].find((b) => b.textContent === 'Manager sign-in')!
      await act(async () => btn.click())
      expect(n.assign).toHaveBeenCalledWith('/login?admin=1')
      // focus reads the status at once
      where.unlocked = false
      await act(async () => void window.dispatchEvent(new Event('focus')))
      await flush()
      expect(n.replace).toHaveBeenCalledWith('/login?locked=1')
    })

    it('a status that cannot be read keeps the cover (and sends nothing else)', async () => {
      const { fn, log } = kioskRoutes([
        on('GET', '/kiosk/status', () => {
          throw new TypeError('offline')
        }),
        on('GET', '/ops/snapshot', () => notAtShop()),
      ])
      const c = new ApiClient({ fetch: fn as any, csrf: createCsrfStore(), sleep: async () => {}, retryBaseMs: 1 })
      const n = nav()
      await mount(createElement(SessionProvider, { client: c, nav: n, awayRecheckMs: 30 }, createElement('div', { id: 'x' })))
      await c.get('/ops/snapshot').catch(() => undefined)
      const mark = log.length
      await wait(120)
      expect(cover()).not.toBeNull()
      expect(sent(log, mark).every((x) => x === 'GET /kiosk/status')).toBe(true)
      expect(n.replace).not.toHaveBeenCalled()
    })
  })

  it('helpers: lockedUrl and msUntil', () => {
    expect(lockedUrl()).toBe('/login?locked=1')
    expect(lockedUrl('9:00 PM')).toBe('/login?locked=1&at=9%3A00%20PM')
    expect(msUntil('2026-06-13T14:46:00.000Z', Date.parse('2026-06-13T14:36:00.000Z'))).toBe(600_000)
    expect(msUntil('2026-06-13T14:00:00.000Z', Date.parse('2026-06-13T14:36:00.000Z'))).toBe(0)
    expect(msUntil('nonsense', 0)).toBe(0)
  })

  it('lockAndLeave: a failed lock call still leaves for the keypad', async () => {
    const assign = vi.fn()
    await lockAndLeave({ lock: async () => Promise.reject(new ApiError({ status: 0, kind: 'network' })) }, undefined, { assign })
    expect(assign).toHaveBeenCalledWith('/login?locked=1')
  })
})
