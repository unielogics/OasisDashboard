// Realtime event -> query invalidation, coalesced. Events are "refetch this" hints (payloads are ids plus a version),
// so a burst of events (a status change publishes several) turns into ONE invalidation per query family per window.
import type { Query, QueryClient, QueryKey } from '@tanstack/react-query'
import { serverClock } from '@/lib/clock'
import type { RealtimeEvent, Timers } from './sse'
import { realTimers } from './sse'

/**
 * Where categories show outside Settings (ADR 0160 plan K): the board's snapshot (counts and chip colours), an open file,
 * the calendar, the booking catalog, and Payments' summary split and row chips. Only these, not the whole ops and
 * payments families: a category or price change has nothing to do with a client's identity, membership or thread.
 */
const CATEGORY_VIEWS: QueryKey[] = [
  ['ops', 'snapshot'],
  ['ops', 'file'],
  ['ops', 'calendar'],
  ['ops', 'catalog'],
  ['payments', 'summary'],
  ['payments', 'invoices'],
  ['payments', 'invoice'],
]

/**
 * Settings sections whose change shows elsewhere too (ADR 0160 plan A, I, K; ADR 0170): a service's website fields and the
 * catalog (categories, sizes, prices by size, tiers, tier prices) are read whole by Settings → Catalog (['settings', 'catalog']); categories
 * colour the board and Payments chips; a service's duration changes the open times; the Reminders section reads five
 * settings sections and the category list.
 */
const SETTINGS_ALSO: Record<string, QueryKey[]> = {
  services: [['settings', 'catalog'], ...CATEGORY_VIEWS, ['ops', 'availability']],
  catalog: [['settings', 'reminders'], ...CATEGORY_VIEWS],
  reviews: [['settings', 'reminders']],
  status_texts: [['settings', 'reminders']],
  leads: [['settings', 'reminders']],
  // the booking fee (`booking.guest_fee`, ADR 0170) is read with the catalog (Settings → Prices by size) and by Settings →
  // Billing & integrations, which also shows link tipping (`payments.*`), the renewal policy and the price-change notice
  // (`memberships.*`) and the saved-card fees (`fees.*`) (ADR 0171, DV-908)
  booking: [['settings', 'catalog'], ['settings', 'billing']],
  payments: [['settings', 'billing']],
  memberships: [['settings', 'billing']],
  fees: [['settings', 'billing']],
  // kiosk mode (ADR 0180): who shows on the kiosk follows the team (Settings → Kiosk and the tablet's picker list,
  // ['settings', 'kiosk', 'staff'])
  employees: [['settings', 'kiosk']],
}

/** Query families an event touches. The key vocabulary is data/query.ts (first element = channel or 'me'). */
export function keysForEvent(e: RealtimeEvent): QueryKey[] {
  // Roles and who holds them changed: the session (whose change of the person's own authority makes Settings read its
  // sections again, see LiveData) and the two lists that show roles. Not every Settings section: hours, closures, VIP
  // and the rest do not change with a role.
  if (e.type === 'rbac.changed') return [['me'], ['settings', 'roles'], ['settings', 'employees']]
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

/**
 * Coalesces event invalidations, and skips the queries a fetch already covers: a query whose latest fetch STARTED after
 * the event reached this page (the change was committed before the server published it) is fetching, or has fetched,
 * data that holds the change. That is the usual case for the page's own save: command() refetches what it touched as
 * the response arrives, and the event of that same save, a moment later, would cancel that fetch and send it again.
 * A fetch that started before the event, or failed, is invalidated as before.
 */
export class InvalidationCoalescer {
  /** key -> when its latest event arrived (client clock) */
  private pending = new Map<string, { key: QueryKey; at: number }>()
  private timer: unknown = null
  /** queryHash -> when its latest fetch started */
  private started = new Map<string, number>()
  private readonly offCache: () => void

  constructor(
    private qc: QueryClient,
    private windowMs = 250,
    private timers: Timers = realTimers,
    // the client clock, as TanStack stamps dataUpdatedAt with it
    private now: () => number = () => serverClock.rawNow(),
  ) {
    this.offCache = qc.getQueryCache().subscribe((e) => {
      if (e.type === 'updated' && e.action.type === 'fetch') this.started.set(e.query.queryHash, this.now())
      else if (e.type === 'removed') this.started.delete(e.query.queryHash)
    })
  }

  push(keys: QueryKey[]): void {
    const at = this.now()
    for (const k of keys) this.pending.set(JSON.stringify(k), { key: k, at })
    if (this.pending.size && this.timer === null) {
      this.timer = this.timers.setTimeout(() => this.flush(), this.windowMs)
    }
  }

  flush(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer)
    this.timer = null
    const entries = [...this.pending.values()]
    this.pending.clear()
    for (const { key, at } of entries)
      void this.qc.invalidateQueries({ queryKey: key, predicate: (q) => !this.covers(q, at) })
  }

  /** Does the query's latest fetch hold everything committed before `at`? */
  private covers(q: Query, at: number): boolean {
    const started = this.started.get(q.queryHash)
    if (started === undefined || started < at) return false
    const st = q.state
    if (st.fetchStatus === 'fetching') return true
    return st.status === 'success' && st.dataUpdatedAt >= started && !st.isInvalidated
  }

  dispose(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer)
    this.timer = null
    this.pending.clear()
    this.started.clear()
    this.offCache()
  }
}

/** Everything is stale: resync frames and reconnects. */
export const invalidateEverything = (qc: QueryClient): Promise<void> => qc.invalidateQueries()

/** The poll fallback while the stream is down: refetch what is on screen. */
export const refreshActive = (qc: QueryClient): Promise<void> =>
  qc.invalidateQueries({ refetchType: 'active' })
