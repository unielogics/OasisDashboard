// URL helpers for the auth redirects.

export const DEFAULT_LANDING = '/operations'

/** Paths that never need a session; they also never make a sensible post-login destination. */
export const PUBLIC_PREFIXES = [
  '/login',
  '/forgot',
  '/reset',
  '/reset-password',
  '/invite',
  '/logout',
] as const

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

/**
 * Validates a `next` parameter: same-origin absolute paths only. Anything else (absolute URLs, protocol-relative
 * `//host`, backslash tricks, control characters, javascript: and friends, auth pages themselves) yields the fallback.
 */
export function safeNext(
  raw: string | string[] | null | undefined,
  fallback: string = DEFAULT_LANDING,
): string {
  const v = Array.isArray(raw) ? raw[0] : raw
  if (typeof v !== 'string' || v === '' || v.length > 2048) return fallback
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(v)) return fallback
  if (!v.startsWith('/') || v.startsWith('//')) return fallback
  let decoded = v
  try {
    decoded = decodeURIComponent(v)
  } catch {
    return fallback
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(decoded) || decoded.startsWith('//')) return fallback
  const path = v.split(/[?#]/, 1)[0]!
  if (isPublicPath(path)) return fallback
  try {
    const u = new URL(v, 'http://oasis.invalid')
    if (u.origin !== 'http://oasis.invalid') return fallback
  } catch {
    return fallback
  }
  return v
}

/** `/login?next=<path>`; the next value is validated first and omitted when it is the default landing page. */
export function loginUrl(next?: string | null): string {
  const n = safeNext(next ?? undefined)
  return n === DEFAULT_LANDING ? '/login' : `/login?next=${encodeURIComponent(n)}`
}
