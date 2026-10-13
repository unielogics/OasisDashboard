// The email and password card of the sign-in page, extracted from LoginPage so the kiosk keypad can show it too (ADR
// 0180, DV-1001: typing 0218 on the keypad swaps it in). Same markup and behaviour as before the extraction.
import { useState } from 'react'
import type { FormEvent } from 'react'
import { nextAfterLogin } from '@/auth/next'
import { failureOf, validateEmail } from '@/auth/validation'
import type { FormFailure } from '@/auth/validation'
import type { AuthApi } from '@/data/http/endpoints'
import { Card, linkRowStyle } from './Card'
import { Field } from './Field'
import { errorTextStyle, primaryButtonStyle } from './styles'

interface Props {
  auth: AuthApi
  /** The `next` query value of the sign-in page. */
  next: string | string[] | undefined
  /** Full-page navigation after signing in. */
  navigate: (url: string) => void
  /** The kiosk keypad's "Back to keypad" link (absent on the plain sign-in page). */
  onBack?: () => void
}

export function EmailPasswordCard({ auth, next, navigate, onBack }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [fail, setFail] = useState<FormFailure | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const ee = validateEmail(email)
    setEmailError(ee)
    setFail(null)
    if (ee) return
    if (!password) return setFail({ field: 'password', message: 'Enter your password.' })
    setBusy(true)
    try {
      await auth.login({ email: email.trim(), password })
      navigate(nextAfterLogin(next, window.location.hash))
    } catch (err) {
      setFail(failureOf(err))
      setBusy(false)
    }
  }

  return (
    <Card title="Sign in" text="Use your Oasis staff email and password.">
      <form onSubmit={submit} noValidate>
        <Field
          label="Email"
          type="email"
          name="email"
          autoComplete="username"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={emailError}
        />
        <Field
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fail?.field === 'password' ? fail.message : null}
        />
        {fail?.field === 'form' && (
          <div role="alert" style={{ ...errorTextStyle, marginBottom: '10px' }}>
            {fail.message}
          </div>
        )}
        <button type="submit" disabled={busy} style={primaryButtonStyle(busy)}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <div style={linkRowStyle}>
        {onBack && (
          <a
            href="#keypad"
            onClick={(e) => {
              e.preventDefault()
              onBack()
            }}
          >
            Back to keypad
          </a>
        )}
        <a href="/forgot">Forgot password?</a>
      </div>
    </Card>
  )
}
