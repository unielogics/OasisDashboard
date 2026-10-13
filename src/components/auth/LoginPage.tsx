import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import type { AuthApi } from '@/data/http/endpoints'
import { AuthFrame } from './Frame'
import { EmailPasswordCard } from './EmailPasswordCard'
import { Toast } from './Toast'
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
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!router.isReady) return
    if (router.query.reset === '1') setToast('Password updated. Sign in with your new password.')
    else if (router.query.expired === '1') setToast('Your session ended. Sign in again.')
  }, [router.isReady, router.query.reset, router.query.expired])
  const clearToast = useCallback(() => setToast(null), [])

  return (
    <AuthFrame>
      <EmailPasswordCard auth={auth} next={router.query.next} navigate={navigate} />
      <Toast text={toast} onDone={clearToast} />
    </AuthFrame>
  )
}
