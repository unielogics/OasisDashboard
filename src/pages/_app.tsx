import type { AppProps } from 'next/app'
import '../styles/fonts.css'

// The per-screen global CSS is injected by ScreenStyle, not imported here: the three helmet sheets differ.
export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />
}
