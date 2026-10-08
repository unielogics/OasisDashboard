import { Html, Head, Main, NextScript } from 'next/document'
import type { DocumentProps } from 'next/document'

/**
 * Pages whose first screen is set in Manrope and Bricolage Grotesque: the three screens and the login family (their card
 * and header use both). Everything else (`/` redirects, `/logout` leaves at once, `/_error`) would download the fonts for
 * nothing and log "preloaded but not used".
 */
export const FONT_PAGES: readonly string[] = [
  '/operations',
  '/payments',
  '/settings',
  '/login',
  '/forgot',
  '/reset',
  '/invite',
  '/invite/[token]',
  '/404',
]

export const FONT_PRELOADS = ['/fonts/manrope-latin.woff2', '/fonts/bricolage-grotesque-latin.woff2'] as const

export const preloadsFonts = (page: string | undefined): boolean => !!page && FONT_PAGES.includes(page)

export default function Document({ __NEXT_DATA__ }: DocumentProps) {
  return (
    <Html>
      <Head>
        {preloadsFonts(__NEXT_DATA__?.page) &&
          FONT_PRELOADS.map((href) => (
            <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="anonymous" />
          ))}
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
