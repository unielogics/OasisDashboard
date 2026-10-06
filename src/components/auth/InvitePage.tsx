import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useRouter } from 'next/router'
import {
  PASSWORD_MIN,
  failureOf,
  validateConfirm,
  validateEmail,
  validateNewPassword,
} from '@/auth/validation'
import type { FormFailure } from '@/auth/validation'
import type { AuthApi } from '@/data/http/endpoints'
import { DEFAULT_LANDING } from '@/lib/url'
import { AuthFrame } from './Frame'
import { Card, linkRowStyle } from './Card'
import { Field } from './Field'
import { Toast } from './Toast'
import { errorTextStyle, primaryButtonStyle } from './styles'
import { useAuthApi } from './useAuthApi'

interface Props {
  auth?: AuthApi
  token?: string
  navigate?: (url: string) => void
  /** Milliseconds the welcome toast stays up before leaving for the app. */
  landingDelayMs?: number
}

const go = (url: string): void => window.location.assign(url)

/** /invite/[token] (and /invite?token=): the employee adds an email (required) and a password to activate the login. */
export default function InvitePage({
  auth: authProp,
  token: tokenProp,
  navigate = go,
  landingDelayMs = 1200,
}: Props) {
  const auth = useAuthApi(authProp)
  const router = useRouter()
  const rawToken = tokenProp ?? router.query.token
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ email?: string; password?: string; confirm?: string }>({})
  const [fail, setFail] = useState<FormFailure | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
  const clearToast = useCallback(() => setToast(null), [])

  if (tokenProp === undefined && !router.isReady) return <AuthFrame>{null}</AuthFrame>
  if (!token || fail?.terminal) {
    return (
      <AuthFrame>
        <Card
          title="Invite not valid"
          text={
            fail?.message ??
            'This invite link is missing or no longer valid. Ask a manager to send a new one.'
          }
        >
          <div style={linkRowStyle}>
            <a href="/login">Back to sign in</a>
          </div>
        </Card>
      </AuthFrame>
    )
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const next = {
      email: validateEmail(email, 'sign-in') ?? undefined,
      password: validateNewPassword(password) ?? undefined,
      confirm: validateConfirm(password, confirm) ?? undefined,
    }
    setErrors(next)
    setFail(null)
    if (next.email || next.password || next.confirm) return
    setBusy(true)
    try {
      await auth.acceptInvite({ token, email: email.trim(), password })
      setToast('Welcome to Oasis · you’re signed in')
      timer.current = setTimeout(() => navigate(DEFAULT_LANDING), landingDelayMs)
    } catch (err) {
      setFail(failureOf(err))
      setBusy(false)
    }
  }

  return (
    <AuthFrame>
      <Card
        title="Set up your login"
        text="Add your email and choose a password to finish setting up your Oasis account."
      >
        <form onSubmit={submit} noValidate>
          <Field
            label="Email"
            type="email"
            name="email"
            autoComplete="username"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email ?? (fail?.field === 'email' ? fail.message : null)}
          />
          <Field
            label="Password"
            type="password"
            name="password"
            autoComplete="new-password"
            placeholder={`At least ${PASSWORD_MIN} characters`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password ?? (fail?.field === 'password' ? fail.message : null)}
          />
          <Field
            label="Confirm password"
            type="password"
            name="confirm"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            error={errors.confirm}
          />
          {fail?.field === 'form' && (
            <div role="alert" style={{ ...errorTextStyle, marginBottom: '10px' }}>
              {fail.message}
            </div>
          )}
          <button type="submit" disabled={busy} style={primaryButtonStyle(busy)}>
            {busy ? 'Creating…' : 'Create login'}
          </button>
        </form>
      </Card>
      <Toast text={toast} onDone={clearToast} />
    </AuthFrame>
  )
}
