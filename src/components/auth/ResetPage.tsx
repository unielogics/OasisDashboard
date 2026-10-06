import { useState } from 'react'
import type { FormEvent } from 'react'
import { useRouter } from 'next/router'
import { PASSWORD_MIN, failureOf, validateConfirm, validateNewPassword } from '@/auth/validation'
import type { FormFailure } from '@/auth/validation'
import type { AuthApi } from '@/data/http/endpoints'
import { AuthFrame } from './Frame'
import { Card, linkRowStyle } from './Card'
import { Field } from './Field'
import { errorTextStyle, primaryButtonStyle } from './styles'
import { useAuthApi } from './useAuthApi'

interface Props {
  auth?: AuthApi
  /** Overrides router.query.token (tests). */
  token?: string
  navigate?: (url: string) => void
}

const go = (url: string): void => window.location.assign(url)

export default function ResetPage({ auth: authProp, token: tokenProp, navigate = go }: Props) {
  const auth = useAuthApi(authProp)
  const router = useRouter()
  const rawToken = tokenProp ?? router.query.token
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({})
  const [fail, setFail] = useState<FormFailure | null>(null)
  const [busy, setBusy] = useState(false)

  if (tokenProp === undefined && !router.isReady) return <AuthFrame>{null}</AuthFrame>
  if (!token || fail?.terminal) {
    return (
      <AuthFrame>
        <Card
          title="Link expired"
          text={fail?.message ?? 'This reset link is missing or no longer valid. Request a new one.'}
        >
          <div style={linkRowStyle}>
            <a href="/forgot">Request a new link</a>
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
      password: validateNewPassword(password) ?? undefined,
      confirm: validateConfirm(password, confirm) ?? undefined,
    }
    setErrors(next)
    setFail(null)
    if (next.password || next.confirm) return
    setBusy(true)
    try {
      await auth.reset({ token, password })
      navigate('/login?reset=1')
    } catch (err) {
      const f = failureOf(err, 'password')
      setFail(f)
      setBusy(false)
    }
  }

  return (
    <AuthFrame>
      <Card
        title="Choose a new password"
        text={`Use at least ${PASSWORD_MIN} characters. You’ll be signed out everywhere else.`}
      >
        <form onSubmit={submit} noValidate>
          <Field
            label="New password"
            type="password"
            name="password"
            autoComplete="new-password"
            autoFocus
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
            {busy ? 'Saving…' : 'Set password'}
          </button>
        </form>
        <div style={linkRowStyle}>
          <a href="/login">Back to sign in</a>
        </div>
      </Card>
    </AuthFrame>
  )
}
