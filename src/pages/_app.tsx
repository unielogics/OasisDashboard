import type { ComponentType, ReactNode } from 'react'
import type { AppProps } from 'next/app'
import dynamic from 'next/dynamic'
import Head from 'next/head'
import { THEME_BOOT_SCRIPT } from '@/data/theme'
import '../styles/fonts.css'

// The live variant (NEXT_PUBLIC_VARIANT=live) wraps every page in the session gate and the realtime stream. In the
// default and parity builds the literal below is '' and the branch, with its imports, is removed at build time.
// Client-only like the screens: the providers pull in react-query, which Next loads as an async ESM external on the
// server, so a plain require() of them would hand back a Promise there.
const LiveProviders: ComponentType<{ children: ReactNode }> | null =
  process.env.NEXT_PUBLIC_VARIANT === 'live'
    ? dynamic(() => import('@/auth/live-providers').then((m) => m.LiveProviders), { ssr: false })
    : null

// The per-screen global CSS is injected by ScreenStyle, not imported here: the three helmet sheets differ.
export default function App({ Component, pageProps }: AppProps) {
  if (!LiveProviders) return <Component {...pageProps} />
  return (
    <>
      <Head>
        {/* sets <html data-theme> from the localStorage cache before first paint */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </Head>
      <LiveProviders>
        <Component {...pageProps} />
      </LiveProviders>
    </>
  )
}
