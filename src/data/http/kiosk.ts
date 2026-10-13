// Kiosk mode in the API client (ADR 0180, design section 6.3): which routes a kiosk may call, as generated from the
// backend's `x-oasis-kiosk` marks (kiosk-routes.ts), the acting employee's header and the two errors the client raises
// itself: a refused route (never sent) and a cancelled employee picker (silent, like an aborted request).
import { ApiError } from './problem'
import { KIOSK_ROUTES } from './kiosk-routes'
import type { KioskRouteMode } from './kiosk-routes'

export type { KioskRouteMode }

/** The header that names the employee a kiosk acts for (api-spec 31.1). */
export const ACTOR_HEADER = 'X-Oasis-Employee'

const API = '/api/v1'

interface Matcher {
  method: string
  re: RegExp
  mode: KioskRouteMode
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** `/api/v1/appointments/{id}/arrive` -> a regexp matching one path segment per parameter. */
export function templateRegExp(template: string): RegExp {
  const parts = template.split(/(\{[^}]+\})/).map((p) => (p.startsWith('{') ? '[^/?#]+' : escape(p)))
  return new RegExp('^' + parts.join('') + '$')
}

export function buildKioskMatcher(
  routes: ReadonlyArray<readonly [string, string, KioskRouteMode]> = KIOSK_ROUTES,
): (method: string, path: string) => KioskRouteMode | null {
  // literal segments win over parameters (/appointments/quote before /appointments/{id})
  const list: Matcher[] = routes
    .map(([method, p, mode]) => ({ method, re: templateRegExp(p), mode, literal: !p.includes('{') }))
    .sort((a, b) => Number(b.literal) - Number(a.literal))
  return (method, path) => {
    const m = method === 'HEAD' ? 'GET' : method.toUpperCase()
    let p = path.split(/[?#]/, 1)[0]!
    if (!p.startsWith('/api/')) p = API + (p.startsWith('/') ? p : '/' + p)
    for (const r of list) if (r.method === m && r.re.test(p)) return r.mode
    return null
  }
}

/** The mode of a request path (relative to /api/v1 or absolute), or null when a kiosk may not call it. */
export const kioskRouteMode = buildKioskMatcher()

/** A route a kiosk may not call: refused before it is sent (the server would answer 403 KIOSK_FORBIDDEN). */
export class KioskRefused extends ApiError {
  constructor(method: string, path: string) {
    super({
      status: 403,
      kind: 'http',
      code: 'KIOSK_FORBIDDEN',
      title: 'Not on the kiosk',
      detail: 'Ask a manager',
      meta: { method, path, local: true },
    })
    this.name = 'KioskRefused'
  }
}

/** Nobody was picked: the action stops without a request and without a toast (command() treats it as aborted). */
export class KioskCancelled extends ApiError {
  constructor() {
    super({ status: 0, kind: 'aborted', code: 'KIOSK_CANCELLED', title: 'Cancelled' })
    this.name = 'KioskCancelled'
  }
}

export interface KioskClientConfig {
  /** The route's mode, or null when the kiosk may not call it (the generated list by default). */
  modeOf?: (method: string, path: string) => KioskRouteMode | null
  /**
   * The fallback picker: an `actor` write sent without `actor` asks who is doing it (null = cancelled). The Operations
   * commands always pass the employee themselves; this only catches a path that forgot to.
   */
  resolveActor?: (req: { method: string; path: string }) => Promise<string | null>
}
