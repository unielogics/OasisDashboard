import Head from 'next/head'
import dynamic from 'next/dynamic'

const ForgotPage = dynamic(() => import('@/components/auth/ForgotPage'), { ssr: false })

export default function Forgot() {
  return (
    <>
      <Head>
        <title>Oasis Reset password</title>
        <meta name="referrer" content="no-referrer" />
      </Head>
      <ForgotPage />
    </>
  )
}
