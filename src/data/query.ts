// TanStack Query setup and the query-key vocabulary shared with the realtime layer.
import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './http/problem'

/**
 * Query keys. The first element is the realtime channel (ops, payments, messages, settings, notifications) or 'me',
 * so an SSE event for a channel invalidates exactly that family (see realtime/invalidation.ts).
 */
export const qk = {
  me: ['me'] as const,
  now: ['meta', 'now'] as const,
  ops: (...rest: unknown[]) => ['ops', ...rest] as const,
  payments: (...rest: unknown[]) => ['payments', ...rest] as const,
  messages: (...rest: unknown[]) => ['messages', ...rest] as const,
  settings: (...rest: unknown[]) => ['settings', ...rest] as const,
  notifications: ['notifications'] as const,
}

const NEVER_RETRY = new Set([400, 401, 403, 404, 409, 412, 422, 429])

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: (count, err) => {
          if (err instanceof ApiError && (NEVER_RETRY.has(err.status) || err.kind === 'aborted')) return false
          return count < 2
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
      mutations: { retry: false },
    },
  })
}

let shared: QueryClient | null = null

/**
 * The one QueryClient of the page. React code gets it from the provider; the logic classes (not React) pass it to
 * command(), so both must be the same instance.
 */
export function getQueryClient(): QueryClient {
  return (shared ??= makeQueryClient())
}
