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
  // the address the browser used: Next rewrites a loopback host (127.0.0.1) to localhost in req.url, and a redirect to
  // another host than the one that holds the session cookie signs the person out
  const host = req.headers.get('host')
  return NextResponse.redirect(new URL(d.location, host ? `${req.nextUrl.protocol}//${host}` : req.url))
}

export const config = {
  matcher: ['/((?!_next/|fonts/|api/|favicon|robots\\.txt).*)'],
}
