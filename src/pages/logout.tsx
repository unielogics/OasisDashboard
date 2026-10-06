import Head from 'next/head'
import dynamic from 'next/dynamic'

const LogoutPage = dynamic(() => import('@/components/auth/LogoutPage'), { ssr: false })

export default function Logout() {
  return (
    <>
      <Head>
        <title>Oasis Signing out</title>
      </Head>
      <LogoutPage />
    </>
  )
}
