import { Html, Head, Main, NextScript } from 'next/document'
import type { DocumentProps } from 'next/document'

/**
 * The three screens preload the two fonts their first render sets text in. The login family and the 404 page do not: they
 * render on the client after their script arrives, and on a slow link that is later than the few seconds after the load
 * event that Chrome allows a preload, so it logs "preloaded but not used" (their fonts load from the stylesheet when the
 * card renders). `/` redirects and `/logout` leaves at once.
 */
export const FONT_PAGES: readonly string[] = ['/operations', '/payments', '/settings']

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
