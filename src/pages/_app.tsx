import type { ComponentType, ReactNode } from 'react'
import type { AppProps } from 'next/app'
import '../styles/fonts.css'

// The live variant (NEXT_PUBLIC_VARIANT=live) wraps every page in the session gate and the realtime stream. In the
// default and parity builds the literal below is '' and the branch, with its imports, is removed at build time.
const LiveProviders: ComponentType<{ children: ReactNode }> | null =
  process.env.NEXT_PUBLIC_VARIANT === 'live'
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('@/auth/live-providers') as typeof import('@/auth/live-providers')).LiveProviders
    : null

// The per-screen global CSS is injected by ScreenStyle, not imported here: the three helmet sheets differ.
export default function App({ Component, pageProps }: AppProps) {
  if (!LiveProviders) return <Component {...pageProps} />
  return (
    <LiveProviders>
      <Component {...pageProps} />
    </LiveProviders>
  )
}
