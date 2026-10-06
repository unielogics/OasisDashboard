// Session: GET /api/v1/me once per page load (plus refetches on rbac.changed and focus), gating the screens.
//   loading -> boot splash; 401 -> /login?next=<current path>; other failure -> error card with Retry.
// It also adopts the server theme, syncs the server clock, feeds the live chrome and owns sign-out and view-as.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { BootSplash, FailureCard } from '@/components/auth/Boot'
import { api } from '@/data/http/client'
import type { ApiClient } from '@/data/http/client'
import { createAuthApi, createMeApi } from '@/data/http/endpoints'
import type { MeApi } from '@/data/http/endpoints'
import { ApiError } from '@/data/http/problem'
import { qk } from '@/data/query'
import { toasts } from '@/data/toast'
import { adoptServerTheme, applyDocumentTheme, clearThemeCache, persistTheme } from '@/data/theme'
import { serverClock } from '@/lib/clock'
import { DEFAULT_TZ } from '@/lib/tz'
import { isPublicPath, loginUrl } from '@/lib/url'
import { installLiveChrome, liveChrome } from './chrome'
import { can as canFn, limit as limitFn, toSession } from './session-model'
import type { Session } from './session-model'
import type { MoneyKind } from '@/data/http/auth-types'
import type { PermissionKey } from './permissions'

/** GET /me and the server clock (from /me when it carries one, else GET /meta/now), as one Session. */
export async function loadSession(me: MeApi, signal?: AbortSignal): Promise<Session> {
  const sent = serverClock.rawNow()
  const [m, now] = await Promise.all([me.get(signal), me.now(signal).catch(() => null)])
  const received = serverClock.rawNow()
  const serverTime = m.serverTime ?? now?.now ?? new Date(serverClock.now()).toISOString()
  if (m.serverTime || now) serverClock.sync(serverTime, sent, received)
  return toSession(m, { serverTime, businessTz: m.businessTz ?? now?.tz ?? DEFAULT_TZ })
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
): void {
  if (isPublicPath(loc.pathname)) return
  loc.replace(loginUrl(loc.pathname + loc.search + loc.hash))
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
  const redirecting = useRef(false)

  useEffect(() => {
    client.configure({
      onUnauthorized: () => {
        if (redirecting.current) return
        redirecting.current = true
        redirectToLogin(nav)
      },
    })
  }, [client])

  const q = useQuery({
    queryKey: qk.me,
    queryFn: ({ signal }) => loadSession(meApi, signal),
    staleTime: 60_000,
  })
  const session = q.data ?? null

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
    await signOutAndLeave(authApi, qc, nav)
  }, [authApi, qc, nav])

  // Server theme wins over the localStorage cache; the verbatim classes read the cache when they construct, which is
  // why the screens are only rendered once this has run.
  const adopted = useRef(false)
  if (session && !adopted.current && typeof window !== 'undefined') {
    adopted.current = true
    adoptServerTheme(session.prefs.theme)
  }

  useLayoutEffect(() => {
    liveChrome.bind({
      signOut: () => void signOut(),
      viewAs,
      themeChanged: (theme, previous) =>
        void persistTheme(theme, previous, {
          put: (t) => meApi.setPreferences(t),
          onRollback: () =>
            toasts.emit({ title: 'Couldn’t save your theme', desc: 'It will reset on reload.' }),
        }),
    })
  }, [signOut, viewAs, meApi])

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
