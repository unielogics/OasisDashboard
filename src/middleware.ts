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
 * the address the browser used. The redirect only ever goes back to the person who asked, to the host they asked for.
 */
export function publicOrigin(req: NextRequest): string {
  const host =
    req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || req.headers.get('host') || req.nextUrl.host
  const forwarded = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const proto =
    forwarded === 'https' || forwarded === 'http' ? forwarded : req.nextUrl.protocol.replace(/:$/, '')
  return `${proto}://${host}`
}

export const config = {
  matcher: ['/((?!_next/|fonts/|api/|favicon|robots\\.txt).*)'],
}
