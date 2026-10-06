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
  redirectToLogin,
  signOutAndLeave,
  useCan,
  useLimit,
  useSession,
} from './session'
import { createMeApi } from '@/data/http/endpoints'
import { SUPER_OPTIONS, makeMe } from './test-fixtures'

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
