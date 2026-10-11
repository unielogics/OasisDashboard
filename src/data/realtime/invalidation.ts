// Realtime event -> query invalidation, coalesced. Events are "refetch this" hints (payloads are ids plus a version),
// so a burst of events (a status change publishes several) turns into ONE invalidation per query family per window.
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type { RealtimeEvent, Timers } from './sse'
import { realTimers } from './sse'

/**
 * Settings sections whose change shows elsewhere too (ADR 0160 plan A, I, K): a service's website fields and the
 * catalog (categories, plans, tint, markup) are read whole by Settings → Catalog (['settings', 'catalog']); categories
 * colour the board and Payments chips; the Reminders section reads five settings sections and the category list.
 */
const SETTINGS_ALSO: Record<string, QueryKey[]> = {
  services: [['settings', 'catalog'], ['ops'], ['payments']],
  catalog: [['settings', 'reminders'], ['ops'], ['payments']],
  reviews: [['settings', 'reminders']],
  status_texts: [['settings', 'reminders']],
  leads: [['settings', 'reminders']],
}

/** Query families an event touches. The key vocabulary is data/query.ts (first element = channel or 'me'). */
export function keysForEvent(e: RealtimeEvent): QueryKey[] {
  if (e.type === 'rbac.changed') return [['me'], ['settings']]
  // The server ended the session: /me answers 401 and the app goes to the sign-in page.
  if (e.type === 'auth.expired') return [['me']]
  if (e.channel === 'settings') {
    const section = typeof e.payload.section === 'string' ? e.payload.section : null
    if (!section) return [['settings']]
    return [['settings', section], ...(Object.hasOwn(SETTINGS_ALSO, section) ? SETTINGS_ALSO[section]! : [])]
  }
  if (
    e.channel === 'ops' ||
    e.channel === 'payments' ||
    e.channel === 'messages' ||
    e.channel === 'notifications'
  )
    return [[e.channel]]
  return []
}

export class InvalidationCoalescer {
  private pending = new Map<string, QueryKey>()
  private timer: unknown = null

  constructor(
    private qc: QueryClient,
    private windowMs = 250,
    private timers: Timers = realTimers,
  ) {}

  push(keys: QueryKey[]): void {
    for (const k of keys) this.pending.set(JSON.stringify(k), k)
    if (this.pending.size && this.timer === null) {
      this.timer = this.timers.setTimeout(() => this.flush(), this.windowMs)
    }
  }

  flush(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer)
    this.timer = null
    const keys = [...this.pending.values()]
    this.pending.clear()
    for (const queryKey of keys) void this.qc.invalidateQueries({ queryKey })
  }

  dispose(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer)
    this.timer = null
    this.pending.clear()
  }
}

/** Everything is stale: resync frames and reconnects. */
export const invalidateEverything = (qc: QueryClient): Promise<void> => qc.invalidateQueries()

/** The poll fallback while the stream is down: refetch what is on screen. */
export const refreshActive = (qc: QueryClient): Promise<void> =>
  qc.invalidateQueries({ refetchType: 'active' })
