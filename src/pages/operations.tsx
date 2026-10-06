import Head from 'next/head'
import dynamic from 'next/dynamic'

// The designs read localStorage and the clock while initialising state, so the screen is client-only.
const Screen = dynamic(() => import('@/screens/operations/Screen'), { ssr: false })

export default function OperationsPage() {
  return (
    <>
      <Head>
        <title>Oasis Command Center</title>
      </Head>
      <Screen />
    </>
  )
}
