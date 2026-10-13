import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { canOpen, lockedText, openableScreens, ruleFor } from '@/auth/routes'
import { useSession } from '@/auth/session'
import { BootSplash } from './Boot'
import { AuthFrame } from './Frame'
import { Card, linkRowStyle } from './Card'

/** The only screen the shop's kiosk opens (ADR 0180, DV-1002). */
export const KIOSK_LANDING = '/operations'

const replaceLocation = (url: string): void => window.location.replace(url)

/**
 * Renders the locked card (the Payments "No payment access" look) when the session cannot open this screen. An unlocked
 * kiosk is sent to Operations instead: it opens nothing else, even by typing the address.
 */
export function RouteGate({
  pathname,
  children,
  replace = replaceLocation,
}: {
  pathname: string
  children?: ReactNode
  /** Full-page navigation (replaced in tests). */
  replace?: (url: string) => void
}) {
  const { session, viewAs } = useSession()
  const kioskElsewhere = session.kind === 'kiosk' && pathname !== KIOSK_LANDING
  useEffect(() => {
    if (kioskElsewhere) replace(KIOSK_LANDING)
  }, [kioskElsewhere, pathname, replace])
  if (kioskElsewhere) return <BootSplash label="Opening the board" />
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
