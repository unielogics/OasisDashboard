import Head from 'next/head'
import dynamic from 'next/dynamic'

// The designs read localStorage and the clock while initialising state, so the screen is client-only.
const Screen = dynamic(() => import('@/screens/settings/Screen'), { ssr: false })

export default function SettingsPage() {
  return (
    <>
      <Head>
        <title>Oasis Settings</title>
      </Head>
      <Screen />
    </>
  )
}
