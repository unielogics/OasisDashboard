import Head from 'next/head'
import dynamic from 'next/dynamic'

// The backend's links are /invite?token=<token>; invite/[token].tsx serves /invite/<token> with the same page.
const InvitePage = dynamic(() => import('@/components/auth/InvitePage'), { ssr: false })

export default function Invite() {
  return (
    <>
      <Head>
        <title>Oasis Set up login</title>
        <meta name="referrer" content="no-referrer" />
      </Head>
      <InvitePage />
    </>
  )
}
