// The sign-in page's gate (ADR 0180, design 6.1; DEVIATIONS DV-1001): GET /kiosk/status decides what /login shows.
//   kiosk mode off (or the status cannot be read, or a fixture build)  today's LoginPage, unchanged
//   kiosk mode on                                                      the keypad (KeypadPage); 0218 reveals the form
//   this tablet is already unlocked                                    straight to /operations (unless ?admin=1, the
//                                                                      kiosk menu's "Manager sign-in")
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { LIVE } from '@/data/env'
import { api } from '@/data/http/client'
import { createKioskApi } from '@/data/http/endpoints'
import type { AuthApi, KioskApi } from '@/data/http/endpoints'
import type { KioskStatus } from '@/data/http/auth-types'
import { BootSplash } from './Boot'
import { AuthFrame } from './Frame'
import { KeypadPage } from './KeypadPage'
import LoginPage from './LoginPage'
import { useAuthApi } from './useAuthApi'

interface Props {
  auth?: AuthApi
  kiosk?: KioskApi
  /** Builds without the API (default and parity) never ask. */
  live?: boolean
  navigate?: (url: string) => void
  replace?: (url: string) => void
}

const go = (url: string): void => window.location.assign(url)
const swap = (url: string): void => window.location.replace(url)

type Phase = { kind: 'loading' } | { kind: 'login' } | { kind: 'keypad'; status: KioskStatus } | { kind: 'away' }

export default function LoginGate({ auth: authProp, kiosk: kioskProp, live = LIVE, navigate = go, replace = swap }: Props) {
  const auth = useAuthApi(authProp)
  const kiosk = useMemo(() => kioskProp ?? createKioskApi(api), [kioskProp])
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>(live ? { kind: 'loading' } : { kind: 'login' })

  useEffect(() => {
    if (!live || !router.isReady) return
    const ctl = new AbortController()
    kiosk
      .status(ctl.signal)
      .then((s) => {
        if (!s.enabled) return setPhase({ kind: 'login' })
        if (s.unlocked && router.query.admin !== '1') {
          setPhase({ kind: 'away' })
          replace('/operations')
          return
        }
        setPhase({ kind: 'keypad', status: s })
      })
      // an older server or no answer: the plain sign-in page (it still needs a real email and password)
      .catch(() => {
        if (!ctl.signal.aborted) setPhase({ kind: 'login' })
      })
    return () => ctl.abort()
  }, [live, kiosk, router.isReady, router.query.admin, replace])

  if (phase.kind === 'login') return <LoginPage auth={auth} navigate={navigate} />
  if (phase.kind === 'away') return <BootSplash label="Opening the board" />
  if (phase.kind === 'keypad')
    return <KeypadPage status={phase.status} kiosk={kiosk} auth={auth} query={router.query} navigate={navigate} />
  // the status takes a moment: the frame without a card, so neither the form nor the keypad flashes
  return (
    <AuthFrame>
      <div role="status" aria-label="Loading" />
    </AuthFrame>
  )
}
