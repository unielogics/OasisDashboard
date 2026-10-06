import Head from 'next/head'
import dynamic from 'next/dynamic'

// /reset/<token> and /reset-password?token=<token> are rewritten to /reset?token=<token> (next.config.mjs).
const ResetPage = dynamic(() => import('@/components/auth/ResetPage'), { ssr: false })

export default function Reset() {
  return (
    <>
      <Head>
        <title>Oasis Choose password</title>
        <meta name="referrer" content="no-referrer" />
      </Head>
      <ResetPage />
    </>
  )
}
