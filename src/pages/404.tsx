import Head from 'next/head'
import dynamic from 'next/dynamic'

// Client-only like the other pages of the login family: the screen CSS is injected before it paints.
const NotFoundPage = dynamic(() => import('@/components/auth/NotFoundPage'), { ssr: false })

export default function NotFound() {
  return (
    <>
      <Head>
        <title>Oasis Page not found</title>
      </Head>
      <NotFoundPage />
    </>
  )
}
