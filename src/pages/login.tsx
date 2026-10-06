import Head from 'next/head'
import dynamic from 'next/dynamic'

// Client-only like the screens: the page needs the screen CSS injected before it paints.
const LoginPage = dynamic(() => import('@/components/auth/LoginPage'), { ssr: false })

export default function Login() {
  return (
    <>
      <Head>
        <title>Oasis Sign in</title>
        <meta name="referrer" content="no-referrer" />
      </Head>
      <LoginPage />
    </>
  )
}
