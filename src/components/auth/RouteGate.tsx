import type { ReactNode } from 'react'
import { canOpen, lockedText, openableScreens, ruleFor } from '@/auth/routes'
import { useSession } from '@/auth/session'
import { AuthFrame } from './Frame'
import { Card, linkRowStyle } from './Card'

/** Renders the locked card (the Payments "No payment access" look) when the session cannot open this screen. */
export function RouteGate({ pathname, children }: { pathname: string; children?: ReactNode }) {
  const { session, viewAs } = useSession()
  const rule = ruleFor(pathname)
  if (!rule || canOpen(session, rule)) return <>{children}</>
  const others = openableScreens(session)
  return (
    <AuthFrame>
      <Card title={rule.title} text={lockedText(session.roleTitle, rule)}>
        <div style={linkRowStyle}>
          {others.map((r) => (
            <a key={r.path} href={r.path}>
              {r.nav}
            </a>
          ))}
          {session.viewAs.active && (
            <a
              href="#exit-view-as"
              onClick={(e) => {
                e.preventDefault()
                void viewAs(null)
              }}
            >
              Exit view-as
            </a>
          )}
          <a href="/logout">Sign out</a>
        </div>
      </Card>
    </AuthFrame>
  )
}
