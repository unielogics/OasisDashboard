// Where sign-in goes: the `next` path, plus the fragment the browser kept. A signed-out request for /settings#emergency is
// redirected by the middleware to /login?next=%2Fsettings; the fragment never reaches the server, and the browser carries it
// over to the redirect target (RFC 9110 10.2.2), so it arrives on the login page's own URL. It is put back on the path.
import { safeNext } from '@/lib/url'

/** Characters RFC 3986 allows in a fragment; anything else (a raw space, a quote, an angle bracket) drops it. */
const FRAGMENT = /^#[A-Za-z0-9\-._~!$&'()*+,;=:@/?%]+$/

export function nextAfterLogin(
  next: string | string[] | null | undefined,
  hash: string | null | undefined,
): string {
  const target = safeNext(next)
  if (target.includes('#') || !hash || !FRAGMENT.test(hash)) return target
  return target + hash
}
