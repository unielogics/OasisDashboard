// Providers of the live variant: Query client, the theme boot script, and (for every page that is not part of the
// login family) the session gate and the realtime stream. Loaded by _app only when NEXT_PUBLIC_VARIANT=live.
import { useState } from 'react'
import type { ReactNode } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { QueryClientProvider } from '@tanstack/react-query'
import { makeQueryClient } from '@/data/query'
import { RealtimeProvider } from '@/data/realtime/provider'
import { THEME_BOOT_SCRIPT } from '@/data/theme'
import { isPublicPath } from '@/lib/url'
import { SessionProvider } from './session'

export function LiveProviders({ children }: { children: ReactNode }) {
  const [qc] = useState(makeQueryClient)
  const router = useRouter()
  const pub = isPublicPath(router.pathname)
  return (
    <QueryClientProvider client={qc}>
      <Head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </Head>
      {pub ? (
        children
      ) : (
        <SessionProvider>
          <RealtimeProvider>{children}</RealtimeProvider>
        </SessionProvider>
      )}
    </QueryClientProvider>
  )
}
