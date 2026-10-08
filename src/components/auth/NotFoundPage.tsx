// The 404 page, in the locked-card style of the other D4 surfaces: "Page not found", the screens the visitor can open and,
// signed out, "Sign in". It sits outside the session gate (a stale or missing session must not bounce a wrong address to
// the sign-in page), so it asks GET /me itself and treats a 401 as signed out.
import { useEffect, useState } from 'react'
import { loadSession } from '@/auth/session'
import { ROUTE_ACCESS, openableScreens } from '@/auth/routes'
import type { RouteAccess } from '@/auth/routes'
import { api } from '@/data/http/client'
import { createMeApi } from '@/data/http/endpoints'
import { AuthFrame } from './Frame'
import { Card, linkRowStyle } from './Card'

export const NOT_FOUND_TEXT = 'Nothing lives at this address. Check the link, or go to a screen below.'

/** What the visitor can do next: `screens` they may open, or `signedOut`. `null` while that is not known yet. */
export type NotFoundState = { signedOut: false; screens: readonly RouteAccess[] } | { signedOut: true } | null

/** The live variant asks the server who is there; the fixture builds have no session and open every screen. */
export async function whoCanGo(live: boolean): Promise<NotFoundState> {
  if (!live) return { signedOut: false, screens: ROUTE_ACCESS }
  try {
    const session = await loadSession(createMeApi(api))
    return { signedOut: false, screens: openableScreens(session) }
  } catch {
    // a 401, or a server that cannot answer: the sign-in page is the way on (it says what is wrong)
    return { signedOut: true }
  }
}

export default function NotFoundPage({
  load = () => whoCanGo(process.env.NEXT_PUBLIC_VARIANT === 'live'),
}: {
  load?: () => Promise<NotFoundState>
}) {
  const [state, setState] = useState<NotFoundState>(null)
  useEffect(() => {
    let alive = true
    void load().then((s) => alive && setState(s))
    return () => {
      alive = false
    }
  }, [load])
  return (
    <AuthFrame>
      <Card title="Page not found" text={NOT_FOUND_TEXT} icon="missing">
        <div style={linkRowStyle}>
          {state?.signedOut === false &&
            state.screens.map((r) => (
              <a key={r.path} href={r.path}>
                {r.nav}
              </a>
            ))}
          {state?.signedOut === false && state.screens.length === 0 && <a href="/logout">Sign out</a>}
          {state?.signedOut && <a href="/login">Sign in</a>}
        </div>
      </Card>
    </AuthFrame>
  )
}
