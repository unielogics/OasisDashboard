import Head from 'next/head'
import dynamic from 'next/dynamic'

// Client-only like the screens: the page needs the screen CSS injected before it paints. The gate shows today's sign-in
// form, or the kiosk keypad while kiosk mode is on (ADR 0180).
const LoginGate = dynamic(() => import('@/components/auth/LoginGate'), { ssr: false })

export default function Login() {
  return (
    <>
      <Head>
        <title>Oasis Sign in</title>
        <meta name="referrer" content="no-referrer" />
      </Head>
      <LoginGate />
    </>
  )
}
