// Providers of the live variant: Query client and (for every page that is not part of the
// login family) the session gate and the realtime stream. Loaded by _app only when NEXT_PUBLIC_VARIANT=live.
import type { ReactNode } from 'react'
import { useRouter } from 'next/router'
import { QueryClientProvider } from '@tanstack/react-query'
import { getQueryClient } from '@/data/query'
import { RealtimeProvider } from '@/data/realtime/provider'
import { isPublicPath } from '@/lib/url'
import { ErrorBoundary } from '@/components/auth/ErrorBoundary'
import { RouteGate } from '@/components/auth/RouteGate'
import { SessionProvider } from './session'

export function LiveProviders({ children }: { children: ReactNode }) {
  const qc = getQueryClient()
  const router = useRouter()
  const pub = isPublicPath(router.pathname)
  return (
    <QueryClientProvider client={qc}>
      {pub ? (
        children
      ) : (
        <SessionProvider>
          <RealtimeProvider>
            <ErrorBoundary>
              <RouteGate pathname={router.pathname}>{children}</RouteGate>
            </ErrorBoundary>
          </RealtimeProvider>
        </SessionProvider>
      )}
    </QueryClientProvider>
  )
}
