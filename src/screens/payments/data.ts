// What the Payments view model reads. The fixture implementation (fixtures.ts) serves the design's own data; the live
// wave replaces it with one backed by the payments port, the session and the server clock, and nothing in Logic.ts or
// src/lib/payments changes.
import type { Invoice, LocalDay, RangeKey, RolesConfig, Theme } from '@/lib/payments'

/** Everything the screen starts from. */
export interface PaymentsSeed {
  theme: Theme
  roles: RolesConfig
  /** The role the screen is previewed as (the design's role menu); the live wave takes it from the session. */
  role: string
  invoices: Invoice[]
  /** The invoice shown in the detail panel until one is picked. */
  selectedId: string
}

export interface PaymentsData {
  /** The calendar day "today" means for the day offsets in the invoices (the fixture freezes 2026-06-13). */
  readonly today: LocalDay
  /** The toolbar label of each range ("Jun 7 – Jun 13"). */
  readonly rangeLabels: Readonly<Record<RangeKey, string>>
  seed(): PaymentsSeed
  /** The stamp new ledger events carry: "Today 10:36 AM". */
  stampNow(): string
  /** Remembers the chosen theme (the fixture keeps it in the browser, under the design's key). */
  saveTheme(theme: Theme): void
}
