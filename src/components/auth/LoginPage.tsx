import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useRouter } from 'next/router'
import { failureOf, validateEmail } from '@/auth/validation'
import type { FormFailure } from '@/auth/validation'
import type { AuthApi } from '@/data/http/endpoints'
import { safeNext } from '@/lib/url'
import { AuthFrame } from './Frame'
import { Card, linkRowStyle } from './Card'
import { Field } from './Field'
import { Toast } from './Toast'
import { errorTextStyle, primaryButtonStyle } from './styles'
import { useAuthApi } from './useAuthApi'

interface Props {
  auth?: AuthApi
  /** Full-page navigation (replaced in tests). */
  navigate?: (url: string) => void
}

const go = (url: string): void => window.location.assign(url)

export default function LoginPage({ auth: authProp, navigate = go }: Props) {
  const auth = useAuthApi(authProp)
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [fail, setFail] = useState<FormFailure | null>(null)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (router.isReady && router.query.reset === '1')
      setToast('Password updated. Sign in with your new password.')
  }, [router.isReady, router.query.reset])
  const clearToast = useCallback(() => setToast(null), [])

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
      navigate(safeNext(router.query.next))
    } catch (err) {
      setFail(failureOf(err))
      setBusy(false)
    }
  }

  return (
    <AuthFrame>
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
          <a href="/forgot">Forgot password?</a>
        </div>
      </Card>
      <Toast text={toast} onDone={clearToast} />
    </AuthFrame>
  )
}
