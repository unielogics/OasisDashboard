import { useEffect } from 'react'
import { signOutAndLeave } from '@/auth/session'
import type { AuthApi } from '@/data/http/endpoints'
import { BootSplash } from './Boot'
import { useAuthApi } from './useAuthApi'

/** /logout: revoke the session, clear the theme cache and client state, then go to /login (a full page load). */
export default function LogoutPage({
  auth: authProp,
  navigate,
}: {
  auth?: AuthApi
  navigate?: (url: string) => void
}) {
  const auth = useAuthApi(authProp)
  useEffect(() => {
    void signOutAndLeave(auth, undefined, navigate ? { assign: navigate } : undefined)
  }, [auth, navigate])
  return <BootSplash label="Signing out" />
}
