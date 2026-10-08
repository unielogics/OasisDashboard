// The cheap session check of middleware.ts, as a pure function so it is unit-testable without Next. It only asks
// "is there a session cookie"; the session itself is validated by GET /api/v1/me in SessionProvider.
import { isPublicPath, loginUrl } from '@/lib/url'

/** Names the backend may set: `__Host-` prefixed in production behind TLS (api-spec 14.1), plain otherwise. */
export const SESSION_COOKIE_NAMES = ['__Host-oasis_sid', 'oasis_sid'] as const

export interface MiddlewareInput {
  pathname: string
  search: string
  /** Cookie names present on the request. */
  cookieNames: readonly string[]
  /** Extra accepted cookie names (OASIS_SESSION_COOKIE_NAME). */
  extraCookieNames?: readonly string[]
}

export type MiddlewareDecision = { action: 'next' } | { action: 'redirect'; location: string }

/**
 * The pages that need a session. Any other path is either public (the login family) or no page at all: those reach the
 * 404 page, which works signed out too, instead of the sign-in page. src/auth/middleware-logic.test.ts keeps this list
 * equal to src/pages.
 */
export const SESSION_PAGES = ['/', '/operations', '/payments', '/settings'] as const

const needsSession = (pathname: string): boolean =>
  SESSION_PAGES.some((p) => pathname === p || (p !== '/' && pathname.startsWith(p + '/')))

/** Paths that bypass the check entirely (also excluded in the matcher; kept here as a second guard). */
const BYPASS = [/^\/_next\//, /^\/fonts\//, /^\/api\//, /^\/favicon/, /^\/robots\.txt$/]

export function decide(i: MiddlewareInput): MiddlewareDecision {
  if (BYPASS.some((r) => r.test(i.pathname)) || isPublicPath(i.pathname) || !needsSession(i.pathname))
    return { action: 'next' }
  const names = new Set<string>([...SESSION_COOKIE_NAMES, ...(i.extraCookieNames ?? [])])
  if (i.cookieNames.some((n) => names.has(n))) return { action: 'next' }
  return { action: 'redirect', location: loginUrl(i.pathname + i.search) }
}
