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
  return redirectTo(d.location)
}

/**
 * A redirect with a relative Location (`/login?next=...`). Behind nginx, `req.url` carries the server's own address
 * (https://localhost:3200/...), not the public host, so an absolute URL built from it sent signed-out visitors to localhost.
 */
export function redirectTo(location: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { Location: location } })
}

export const config = {
  matcher: ['/((?!_next/|fonts/|api/|favicon|robots\\.txt).*)'],
}
