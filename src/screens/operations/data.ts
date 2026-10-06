// The data the Operations screen reads. The view model asks this interface for everything the design keeps in class
// fields, localStorage or the clock; `FixtureData` (fixtures.ts) answers with the design's own fixtures, and the live
// wiring stage supplies an implementation backed by the API ports (src/data/ports) and the server clock.
import type { CivilDate } from '@/lib/dates'
import type { KpiPlaceholders } from '@/lib/operations/kpis'
import type {
  AddonCatalog,
  AddonTasks,
  BaseAppt,
  Closure,
  DayHours,
  Emergency,
  HistoryDef,
  Services,
  Theme,
  VehicleDef,
} from '@/lib/operations/types'

export interface CatalogData {
  services: Services
  addons: AddonCatalog
  addonTasks: AddonTasks
}

/** The frozen "today" of the design: the civil date offsets count from, the clock minute alerts compare with. */
export interface TodayData {
  base: CivilDate
  /** Minutes since midnight that alert and "arriving soon" maths treat as now (the design freezes 10:36 AM). */
  nowMinutes: number
  /** The date shown beside the live clock. */
  dateLabel: string
}

/** Wall-clock reads (the original's `Date.now()` and `new Date()`), behind one seam. */
export interface OperationsClock {
  nowMs(): number
  /** Local hours (0-23) and minutes of the wall clock, for the "10:36 AM" strings. */
  wall(): { hours: number; minutes: number }
}

/** The 8 New Appointment slots and which of them are unavailable or held for VIPs. */
export interface AvailabilityData {
  slotTimes: string[]
  blocked: string[]
  vipHeld: string[]
}

export interface PoolsData {
  names: string[]
  vehicles: VehicleDef[]
}

/** Texts and numbers the design fabricates in the client; the live stage replaces each with server values. */
export interface DisplayData {
  kpi: KpiPlaceholders
  renewDate: string
  payMethodOnFile: string
  payMethodNone: string
  avgFreq: string
  /** `lifetimeSpend = visits * lifetimePerVisit` */
  lifetimePerVisit: number
  perksByPlan: Record<string, string[]>
}

export interface OperationsData {
  /** Services (checklist tasks already without inspection steps), add-ons and the add-on task lists. */
  catalog(): CatalogData
  /** Settings' persisted weekly hours (7 entries from Sunday) or null when none was saved. */
  hours(): DayHours[] | null
  defaultHours(): DayHours[]
  closures(): Closure[] | null
  defaultClosures(): Closure[]
  emergency(): Emergency | null
  today(): TodayData
  clock(): OperationsClock
  /** The seed board (days 0 and 1), before hydration. */
  seedAppointments(): BaseAppt[]
  /** Past visits drawn on seeded appointments (first three or four). */
  historyPool(): HistoryDef[]
  /** The shorter list the generated calendar days use. */
  generatedHistory(): HistoryDef[]
  pools(): PoolsData
  availability(): AvailabilityData
  display(): DisplayData
  theme(): Theme
  saveTheme(theme: Theme): void
}
