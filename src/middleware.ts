// Next only looks for middleware in src/ when the project uses a src directory. The logic is in src/auth.
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { decide } from '@/auth/middleware-logic'

const LIVE = process.env.NEXT_PUBLIC_VARIANT === 'live'

export function middleware(req: NextRequest) {
  // Fixture builds (default and parity) have no session: never redirect there.
  if (!LIVE) return NextResponse.next()
  const extra = process.env.OASIS_SESSION_COOKIE_NAME ? [process.env.OASIS_SESSION_COOKIE_NAME] : []
  const d = decide({
    pathname: req.nextUrl.pathname,
    search: req.nextUrl.search,
    cookieNames: req.cookies.getAll().map((c) => c.name),
    extraCookieNames: extra,
  })
  if (d.action === 'next') return NextResponse.next()
  return NextResponse.redirect(new URL(d.location, publicOrigin(req)))
}

/**
 * The origin the visitor used. Next requires an absolute redirect URL, but behind nginx `req.url` carries the server's own
 * address (https://localhost:3200/...), which sent the first real visitors to localhost. nginx sets X-Forwarded-Host and
 * X-Forwarded-Proto from the request it accepted (deploy/nginx/oasis-proxy.conf.template); without a proxy the Host header is
 * the address the browser used.
 *
 * The host is never trusted as is. With OASIS_PUBLIC_HOSTS (build time, validated and inlined by next.config.mjs) the redirect
 * goes only to one of those hosts: the one asked for when it is listed, else the first, so a spoofed Host or X-Forwarded-Host
 * can never produce a redirect elsewhere. Without it (live stacks, dev) any well-formed host[:port] is echoed back to the
 * person who sent it, and anything else (userinfo, paths, spaces) falls back to the server's own host.
 */
export function publicOrigin(req: NextRequest): string {
  const asked = (
    req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    req.headers.get('host')?.trim() ||
    req.nextUrl.host
  ).toLowerCase()
  const allowed = publicHosts()
  const host =
    allowed.length > 0
      ? allowed.includes(asked)
        ? asked
        : allowed[0]!
      : WELL_FORMED_HOST.test(asked)
        ? asked
        : req.nextUrl.host
  const forwarded = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const proto =
    forwarded === 'https' || forwarded === 'http' ? forwarded : req.nextUrl.protocol.replace(/:$/, '')
  return `${proto}://${host}`
}

// host or [ipv6], optional port: nothing that could add userinfo, a path or a second authority to the URL
const WELL_FORMED_HOST = /^(?:[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?|\[[0-9a-f:.]+\])(?::\d{1,5})?$/

function publicHosts(): string[] {
  return (process.env.OASIS_PUBLIC_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
}

export const config = {
  matcher: ['/((?!_next/|fonts/|api/|favicon|robots\\.txt).*)'],
}
