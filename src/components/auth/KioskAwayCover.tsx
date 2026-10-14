// The cover over an unlocked kiosk away from the shop (ADR 0180 A13, K-PIN-DASH D3; DEVIATIONS DV-1016): the sign-in
// frame and the Payments locked card on top of the board, "This tablet works only on the shop's Wi-Fi" (or, when no shop
// network is left, "A Super Admin must set the shop network first — Settings → Kiosk") and one button, "Manager sign-in".
// While it shows, the API client holds every call (src/auth/session.tsx) and this cover reads the public GET /kiosk/status
// every 30 s and whenever the page comes back into view or online, one read at a time; `back` removes it (the session
// was kept), `ended` goes to the keypad.
import { useCallback, useEffect, useRef } from 'react'
import { AWAY_RECHECK_MS, AWAY_TEXT, awayCopy, awayStep } from '@/auth/kiosk-away'
import type { KioskAway } from '@/auth/kiosk-away'
import type { KioskApi } from '@/data/http/endpoints'
import { AuthFrame } from './Frame'
import { Card } from './Card'
import { secondaryButtonStyle } from './styles'

interface Props {
  away: KioskAway
  kiosk: Pick<KioskApi, 'status'>
  /** On a shop network again: remove the cover and read everything again. */
  onBack(): void
  /** The kiosk session is gone meanwhile: the keypad. */
  onEnded(): void
  /** Still away (the networkSet text may have changed). */
  onStay(a: KioskAway): void
  /** The only way out: the sign-in page (`/login?admin=1`, 0218 reveals the email card). */
  managerSignIn(): void
  /** How often GET /kiosk/status is read again (replaced in tests). */
  recheckMs?: number
}

export function KioskAwayCover({ away, kiosk, onBack, onEnded, onStay, managerSignIn, recheckMs = AWAY_RECHECK_MS }: Props) {
  const reading = useRef(false)
  const alive = useRef(true)
  const handlers = useRef({ onBack, onEnded, onStay })
  handlers.current = { onBack, onEnded, onStay }

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const recheck = useCallback(async () => {
    if (reading.current) return
    reading.current = true
    try {
      const s = await kiosk.status()
      if (!alive.current) return
      const step = awayStep(s)
      if (step.kind === 'back') handlers.current.onBack()
      else if (step.kind === 'ended') handlers.current.onEnded()
      else handlers.current.onStay(step.away)
    } catch {
      // unreadable (offline): the cover stays; the next tick, focus or `online` reads it again
    } finally {
      reading.current = false
    }
  }, [kiosk])

  useEffect(() => {
    const again = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void recheck()
    }
    const t = setInterval(again, recheckMs)
    window.addEventListener('focus', again)
    window.addEventListener('online', again)
    document.addEventListener('visibilitychange', again)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', again)
      window.removeEventListener('online', again)
      document.removeEventListener('visibilitychange', again)
    }
  }, [recheck, recheckMs])

  const copy = awayCopy(away)
  return (
    <div
      data-kiosk-away="1"
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
      style={{ position: 'fixed', inset: 0, zIndex: 2000 }}
    >
      <AuthFrame>
        <Card title={copy.title} text={copy.text} icon="lock">
          <button type="button" onClick={managerSignIn} style={{ ...secondaryButtonStyle, width: '100%' }}>
            {AWAY_TEXT.managerSignIn}
          </button>
        </Card>
      </AuthFrame>
    </div>
  )
}
