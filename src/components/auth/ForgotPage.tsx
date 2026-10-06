import { useState } from 'react'
import type { FormEvent } from 'react'
import { failureOf, validateEmail } from '@/auth/validation'
import type { FormFailure } from '@/auth/validation'
import type { AuthApi } from '@/data/http/endpoints'
import { AuthFrame } from './Frame'
import { Card, linkRowStyle } from './Card'
import { Field } from './Field'
import { Toast } from './Toast'
import { errorTextStyle, primaryButtonStyle } from './styles'
import { useAuthApi } from './useAuthApi'

export default function ForgotPage({ auth: authProp }: { auth?: AuthApi }) {
  const auth = useAuthApi(authProp)
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [fail, setFail] = useState<FormFailure | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const ee = validateEmail(email)
    setEmailError(ee)
    setFail(null)
    if (ee) return
    setBusy(true)
    try {
      await auth.forgot({ email: email.trim() })
      setSent(true)
      setToast('Reset link sent')
    } catch (err) {
      setFail(failureOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthFrame>
      {sent ? (
        <Card
          icon="mail"
          title="Check your email"
          text="If that address matches an account, a reset link is on its way. It works for one hour."
        >
          <div style={linkRowStyle}>
            <a href="/login">Back to sign in</a>
          </div>
        </Card>
      ) : (
        <Card
          title="Reset your password"
          text="Enter the email on your account and we’ll send you a link to choose a new password."
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
              error={emailError}
            />
            {fail && (
              <div role="alert" style={{ ...errorTextStyle, marginBottom: '10px' }}>
                {fail.message}
              </div>
            )}
            <button type="submit" disabled={busy} style={primaryButtonStyle(busy)}>
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
          <div style={linkRowStyle}>
            <a href="/login">Back to sign in</a>
          </div>
        </Card>
      )}
      <Toast text={toast} onDone={() => setToast(null)} />
    </AuthFrame>
  )
}
