// Session: GET /api/v1/me once per page load (plus refetches on rbac.changed and focus), gating the screens.
//   loading -> boot splash; 401 -> /login?next=<current path>; other failure -> error card with Retry.
// It also adopts the server theme, syncs the server clock, feeds the live chrome and owns sign-out and view-as.
//
// Kiosk mode (ADR 0180, DV-1002, DV-1014): on the shop's unlocked tablet GET /me answers 403 KIOSK_SESSION and the session
// is GET /kiosk/me instead. Then the API client refuses the routes the kiosk may not call and asks the employee picker for
// a write that forgot its employee; "Lock kiosk" is POST /kiosk/lock; the page goes to the keypad by itself at the lock
// time (/login?locked=1) or when the kiosk was locked elsewhere (a 401); the theme is kept on the tablet only; the picker
// list follows Settings (GET /kiosk/staff on `settings.changed` kiosk or employees).
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { BootSplash, FailureCard } from '@/components/auth/Boot'
import { api } from '@/data/http/client'
import type { ApiClient } from '@/data/http/client'
import { createAuthApi, createKioskApi, createMeApi } from '@/data/http/endpoints'
import type { KioskApi, MeApi } from '@/data/http/endpoints'
import { AUTH_CODES } from '@/data/http/auth-types'
import { ApiError } from '@/data/http/problem'
import { KioskRefused } from '@/data/http/kiosk'
import { qk } from '@/data/query'
import { toasts } from '@/data/toast'
import { adoptServerTheme, applyDocumentTheme, clearThemeCache, persistTheme } from '@/data/theme'
import { serverClock } from '@/lib/clock'
import { DEFAULT_TZ } from '@/lib/tz'
import { isPublicPath, loginUrl } from '@/lib/url'
import { installLiveChrome, liveChrome } from './chrome'
import { can as canFn, limit as limitFn, toKioskSession, toSession } from './session-model'
import type { Session } from './session-model'
import type { MoneyKind } from '@/data/http/auth-types'
import type { PermissionKey } from './permissions'

/**
 * GET /me and the server clock (from /me when it carries one, else GET /meta/now), as one Session. On the shop's unlocked
 * kiosk /me answers 403 KIOSK_SESSION: the session is then GET /kiosk/me (which carries the server clock). On a refetch
 * the client is already in kiosk mode and refuses /me itself (KioskRefused): that also means GET /kiosk/me.
 */
export async function loadSession(me: MeApi, signal?: AbortSignal, kiosk?: KioskApi): Promise<Session> {
  const sent = serverClock.rawNow()
  const [m, now] = await Promise.all([
    me.get(signal).catch((e: unknown) => {
      // KIOSK_SESSION from the server, or the client (already in kiosk mode on a refetch) refusing /me locally (F2)
      if (kiosk && (e instanceof KioskRefused || (e instanceof ApiError && e.code === AUTH_CODES.kioskSession)))
        return null
      throw e
    }),
    me.now(signal).catch(() => null),
  ])
  if (!m) {
    const k = await kiosk!.me(signal)
    serverClock.sync(k.serverTime, sent, serverClock.rawNow())
    return toKioskSession(k)
  }
  const received = serverClock.rawNow()
  const serverTime = m.serverTime ?? now?.now ?? new Date(serverClock.now()).toISOString()
  if (m.serverTime || now) serverClock.sync(serverTime, sent, received)
  return toSession(m, { serverTime, businessTz: m.businessTz ?? now?.tz ?? DEFAULT_TZ })
}

/** The keypad after the kiosk locked; `at` is the lock time the page knew ("9:00 PM"). */
export const lockedUrl = (at?: string): string =>
  at ? `/login?locked=1&at=${encodeURIComponent(at)}` : '/login?locked=1'

/** Milliseconds from now (server clock) until the kiosk locks; never negative. */
export const msUntil = (iso: string, now: number): number => {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? Math.max(0, t - now) : 0
}

export interface SessionApi {
  session: Session
  /** Refetch /me (permissions changed, view-as changed). */
  refresh(): Promise<void>
  viewAs(roleId: string | null): Promise<void>
  signOut(): Promise<void>
}

// The bridge appended to the live logic sources finds the store through window.__oasisLive.
installLiveChrome()

const Ctx = createContext<SessionApi | null>(null)

export const useSession = (): SessionApi => {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSession() outside <SessionProvider>')
  return v
}
export const useCan = (key: PermissionKey): boolean => canFn(useSession().session, key)
export const useLimit = (kind: MoneyKind) => limitFn(useSession().session, kind)

/** Full-page redirect to the sign-in page, remembering where the person was. */
export function redirectToLogin(
  loc: Pick<Location, 'pathname' | 'search' | 'hash' | 'replace'> = window.location,
  opts: { expired?: boolean } = {},
): void {
  if (isPublicPath(loc.pathname)) return
  const url = loginUrl(loc.pathname + loc.search + loc.hash)
  loc.replace(opts.expired ? `${url}${url.includes('?') ? '&' : '?'}expired=1` : url)
}

interface ProviderProps {
  children?: ReactNode
  client?: ApiClient
  /** Full-page navigation (window.location by default; replaced in tests). */
  nav?: Pick<Location, 'pathname' | 'search' | 'hash' | 'replace' | 'assign'>
}

export function SessionProvider({ children, client = api, nav }: ProviderProps) {
  const qc = useQueryClient()
  const meApi = useMemo(() => createMeApi(client), [client])
  const authApi = useMemo(() => createAuthApi(client), [client])
  const kioskApi = useMemo(() => createKioskApi(client), [client])
  const redirecting = useRef(false)
  const kioskRef = useRef<Session['kiosk']>(null)

  useEffect(() => {
    client.configure({
      onUnauthorized: () => {
        if (redirecting.current) return
        redirecting.current = true
        // a kiosk whose session ended (locked here or elsewhere, revoked, kiosk mode off) goes back to the keypad
        if (kioskRef.current) (nav ?? window.location).replace(lockedUrl())
        else redirectToLogin(nav, { expired: true })
      },
    })
  }, [client, nav])

  const q = useQuery({
    queryKey: qk.me,
    queryFn: ({ signal }) => loadSession(meApi, signal, kioskApi),
    staleTime: 60_000,
  })
  const session = q.data ?? null
  const kiosk = session?.kiosk ?? null
  kioskRef.current = kiosk

  // Kiosk mode in the API client: the route list, and the fallback picker for a write that forgot its employee.
  useLayoutEffect(() => {
    if (!kiosk) {
      client.configure({ kiosk: null })
      return
    }
    client.configure({
      kiosk: { resolveActor: () => liveChrome.picker.pick({ title: 'Who’s doing this?' }) },
    })
    return () => client.configure({ kiosk: null })
  }, [client, kiosk])

  // The lock time: the page goes to the keypad by itself (DV-1014). Re-armed whenever the session changes.
  const locksAt = kiosk?.locksAt ?? null
  const locksAtLabel = kiosk?.locksAtLabel ?? ''
  useEffect(() => {
    if (!locksAt) return
    const t = setTimeout(
      () => {
        redirecting.current = true
        ;(nav ?? window.location).replace(lockedUrl(locksAtLabel))
      },
      msUntil(locksAt, serverClock.now()),
    )
    return () => clearTimeout(t)
  }, [locksAt, locksAtLabel, nav])

  // Who shows in the picker: GET /kiosk/staff whenever Settings changes it (settings.changed kiosk or employees).
  const staffQ = useQuery({
    queryKey: qk.settings('kiosk', 'staff'),
    queryFn: ({ signal }) => kioskApi.staff(signal),
    enabled: !!kiosk,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
  useEffect(() => {
    if (kiosk && staffQ.data) liveChrome.picker.setStaff(staffQ.data.items)
  }, [kiosk, staffQ.data])

  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: qk.me })
  }, [qc])

  const viewAs = useCallback(
    async (roleId: string | null) => {
      try {
        await meApi.viewAs(roleId)
      } catch (e) {
        if (e instanceof ApiError) toasts.emit({ title: e.title, desc: e.detail || undefined })
        return
      }
      // Authority changed for everything: reload the session, then every other family.
      await qc.invalidateQueries({ queryKey: qk.me })
      await qc.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'me' })
    },
    [meApi, qc],
  )

  const signOut = useCallback(async () => {
    if (kioskRef.current) {
      redirecting.current = true
      await lockAndLeave(kioskApi, qc, nav)
      return
    }
    await signOutAndLeave(authApi, qc, nav)
  }, [authApi, kioskApi, qc, nav])

  // Server theme wins over the localStorage cache; the verbatim classes read the cache when they construct, which is
  // why the screens are only rendered once this has run.
  const adopted = useRef(false)
  if (session && !adopted.current && typeof window !== 'undefined') {
    adopted.current = true
    adoptServerTheme(session.prefs.theme)
  }

  const isKioskSession = !!kiosk
  useLayoutEffect(() => {
    liveChrome.bind({
      signOut: () => void signOut(),
      navigate: nav ? (url) => nav.assign(url) : undefined,
      viewAs,
      themeChanged: (theme, previous) =>
        void persistTheme(theme, previous, {
          // a kiosk has no person to keep a preference for: the theme stays on the tablet
          put: (t) => (isKioskSession ? Promise.resolve() : meApi.setPreferences(t)),
          onRollback: () =>
            toasts.emit({ title: 'Couldn’t save your theme', desc: 'It will reset on reload.' }),
        }),
    })
  }, [signOut, viewAs, meApi, nav, isKioskSession])

  // Layout effect: the screens (children) have mounted and subscribed by now, and the chip must not paint empty.
  useLayoutEffect(() => {
    liveChrome.setSession(session)
  }, [session])

  // A click outside the header menus closes them (the new sign-out menu; the role menu shares the behaviour).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('[data-live-menu]')) liveChrome.closeMenus()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const value = useMemo<SessionApi | null>(
    () => (session ? { session, refresh, viewAs, signOut } : null),
    [session, refresh, viewAs, signOut],
  )

  if (q.isPending) return <BootSplash />
  if (!session || !value) {
    const err = q.error
    if (err instanceof ApiError && err.status === 401) return <BootSplash label="Redirecting to sign in" />
    return (
      <FailureCard
        title={err instanceof ApiError && err.isNetwork ? 'Can’t reach Oasis' : 'Couldn’t load your session'}
        text={err instanceof ApiError ? err.detail || err.title : 'Something went wrong.'}
        onRetry={() => void q.refetch()}
      />
    )
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** "Lock kiosk": POST /kiosk/lock, drop client state, then the keypad. A failed call still leaves for the keypad. */
export async function lockAndLeave(
  kiosk: { lock(): Promise<void> },
  qc?: QueryClient,
  nav: { assign(url: string): void } = window.location,
): Promise<void> {
  try {
    await kiosk.lock()
  } catch {
    // the session ends at its lock time anyway; the keypad is where the tablet belongs now
  }
  qc?.clear()
  liveChrome.picker.forgetAll()
  liveChrome.setSession(null)
  serverClock.reset()
  nav.assign(lockedUrl())
}

/** POST /auth/logout, drop client state, then land on the sign-in page. */
export async function signOutAndLeave(
  auth: { logout(): Promise<void> },
  qc?: QueryClient,
  nav: { assign(url: string): void } = window.location,
): Promise<void> {
  try {
    await auth.logout()
  } catch {
    // a failed logout call must not trap the person in the app: the cookie is cleared server side on success only,
    // but the session also expires by itself; continue to the sign-in page
  }
  clearThemeCache()
  applyDocumentTheme('light')
  qc?.clear()
  liveChrome.setSession(null)
  serverClock.reset()
  nav.assign('/login')
}
