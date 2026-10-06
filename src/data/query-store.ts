// QueryStore: synchronous reads of the TanStack cache for code that is not a React component. The logic classes
// build their view values in renderVals(), which is synchronous, so it cannot await a query. read() returns what is
// cached right now and starts the fetch when nothing is cached or the data is stale; when the cache changes, the
// subscribers (the screen's forceUpdate) are told once per frame instead of once per query event.
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { serverClock } from '@/lib/clock'

export type QueryStatus = 'pending' | 'success' | 'error'

export interface QueryStoreOptions {
  /** Runs fn on the next frame (requestAnimationFrame in the browser). Parity builds pass a synchronous scheduler. */
  schedule?: (fn: () => void) => void
  /** How long cached data counts as fresh before read() refetches it. */
  staleTimeMs?: number
  /** After a failed fetch, read() retries at most this often (default 10 s). */
  errorRetryMs?: number
  /** Client clock in ms; TanStack stamps errorUpdatedAt with the client clock too. */
  now?: () => number
}

const defaultSchedule = (fn: () => void): void => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fn())
  else setTimeout(fn, 0)
}

export class QueryStore {
  private listeners = new Set<() => void>()
  private unsubscribe: (() => void) | null = null
  private scheduled = false
  private disposed = false
  private readonly schedule: (fn: () => void) => void

  constructor(
    private qc: QueryClient,
    private opts: QueryStoreOptions = {},
  ) {
    this.schedule = opts.schedule ?? defaultSchedule
  }

  /**
   * The cached value (undefined until the first response). Never throws. It starts a fetch when nothing is cached or
   * the data is older than staleTime (TanStack does the freshness check and shares an in-flight request). After a
   * failure it does not retry on every render (renderVals runs every second): it retries once errorRetryMs have
   * passed, or at once through refetch(). Errors are visible through status() and error().
   */
  read<T>(key: QueryKey, fetcher: () => Promise<T>, opts: { staleTimeMs?: number } = {}): T | undefined {
    const state = this.qc.getQueryState<T>(key)
    const now = (this.opts.now ?? (() => serverClock.rawNow()))()
    const backingOff =
      state?.status === 'error' && now - state.errorUpdatedAt < (this.opts.errorRetryMs ?? 10_000)
    if (!backingOff) {
      void this.qc.prefetchQuery({
        queryKey: key,
        queryFn: fetcher,
        staleTime: opts.staleTimeMs ?? this.opts.staleTimeMs ?? 5_000,
      })
    }
    return this.qc.getQueryData<T>(key)
  }

  /** Fetch again now (a Retry button), whatever the freshness. */
  refetch<T>(key: QueryKey, fetcher: () => Promise<T>): Promise<void> {
    return this.qc.prefetchQuery({ queryKey: key, queryFn: fetcher, staleTime: 0 })
  }

  status(key: QueryKey): QueryStatus {
    const s = this.qc.getQueryState(key)
    return !s || s.status === 'pending' ? 'pending' : s.status === 'error' ? 'error' : 'success'
  }

  error(key: QueryKey): unknown {
    return this.qc.getQueryState(key)?.error ?? null
  }

  /** Cache changes reach the listener at most once per scheduled frame. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    if (!this.unsubscribe) {
      this.unsubscribe = this.qc.getQueryCache().subscribe(() => this.notifyLater())
    }
    return () => {
      this.listeners.delete(fn)
      if (this.listeners.size === 0) {
        this.unsubscribe?.()
        this.unsubscribe = null
      }
    }
  }

  dispose(): void {
    this.disposed = true
    this.listeners.clear()
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  private notifyLater(): void {
    if (this.scheduled || this.disposed) return
    this.scheduled = true
    this.schedule(() => {
      this.scheduled = false
      if (this.disposed) return
      for (const l of [...this.listeners]) l()
    })
  }
}
