// DTOs of the data ports (region by region, backend design section 5). Money is integer cents, instants are ISO
// strings, business dates are YYYY-MM-DD, wall-clock times are "h:mm AM" strings or minutes from midnight exactly as
// the designs consume them. These are PROVISIONAL: once `pnpm gen:api` carries the vertical's paths, replace the
// interface with `paths[...]['responses'][200]['content']['application/json']` (keep the name; screens import it).

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }
export type JsonObject = { [k: string]: JsonValue }

export interface CommandOptions {
  /** The Idempotency-Key generated when the user action started (see command()). */
  idempotencyKey?: string
}

export interface Cursor<T> {
  items: T[]
  nextCursor: string | null
}

// ---- catalog (GET /services) -------------------------------------------------------------------------------------
export interface ChecklistTask {
  id: string
  label: string
}
export interface ServiceItem {
  id: string
  name: string
  kind: 'package' | 'addon'
  priceCents: number
  durationMin: number
  active: boolean
  bookableDesk: boolean
  tasks: ChecklistTask[]
  version: number
}
export interface Catalog {
  packages: ServiceItem[]
  addons: ServiceItem[]
}

// ---- hours and closures (GET /settings/hours, /closures) ---------------------------------------------------------
export interface HoursDay {
  /** 0 = Sunday. */
  weekday: number
  open: boolean
  from: string
  to: string
}
export interface BookingRules {
  slot: number
  buffer: number
  cutoff: number
}
export interface HoursSettings {
  days: HoursDay[]
  rules: BookingRules
  weekHours?: number
  version: number
}
export interface ClosureItem {
  id: string
  date: string
  name: string
  type: 'closed' | 'reduced'
  from?: string
  to?: string
  source?: string
  notify?: boolean
  affectedCount?: number
}
export interface ClosureInput {
  date: string
  name?: string
  type: 'closed' | 'reduced'
  from?: string
  to?: string
  notify?: boolean
}

// ---- emergency (GET /emergency) ----------------------------------------------------------------------------------
export interface EmergencyState {
  active: boolean
  reason?: string
  dur?: 'today' | 'until' | 'through'
  until?: string
  through?: string
  startedAt?: string
  notified?: { queued: number; sent: number; failed: number }
}
export interface EmergencyCloseInput {
  reason: string
  dur: 'today' | 'until' | 'through'
  until?: string
  through?: string
  notify: boolean
}
export interface EmergencyPreview {
  count: number
  affected: JsonObject[]
  renderedMessage: string
}

// ---- calendar and availability -----------------------------------------------------------------------------------
export interface CalendarDay {
  date: string
  count: number
  closed?: string
  reduced?: boolean
  open?: { from: string; to: string }
}
export interface CalendarDayDetail {
  date: string
  dayInfo: { closed?: string; from?: string; to?: string; note?: string }
  appointments: JsonObject[]
  outsideHours: JsonObject[]
}
export interface AvailabilityQuery {
  date: string
  serviceId: string
  addonIds?: string[]
}
export type SlotState = 'available' | 'blocked' | 'vip_held'
export interface Slot {
  /** "9:30 AM" */
  time: string
  state: SlotState
  reason?: string
}

// ---- operations --------------------------------------------------------------------------------------------------
export type OpsWindow = 'next24' | 'today' | 'tomorrow' | 'week'
export interface OpsSnapshot extends JsonObject {
  now: string
}
export type AppointmentStatus =
  'booked' | 'confirmed' | 'arrived' | 'cleaning' | 'completed' | 'canceled' | 'noshow'
export interface AppointmentFile extends JsonObject {
  id: string
  version: number
}
export interface AdvanceInput {
  /** The status the user saw; the server answers 409 STALE_STATE when it moved on. */
  expectedStatus: AppointmentStatus
}
export interface MessageInput {
  text?: string
  templateKey?: string
}

// ---- payments ----------------------------------------------------------------------------------------------------
export type PaymentRange = 'today' | '7d' | '30d' | 'mtd'
export type InvoiceFilter = 'all' | 'unpaid' | 'refunds' | 'adjusted' | 'credits'
export interface InvoiceQuery {
  range: PaymentRange
  filter?: InvoiceFilter
  q?: string
}
export interface PaymentsSummary extends JsonObject {
  rangeLabel: string
}
export interface InvoiceRow extends JsonObject {
  id: string
}
export interface InvoiceDetail extends JsonObject {
  id: string
  version: number
}
export interface CollectInput {
  method: string
  amountCents: number
}
export interface RefundInput {
  amountCents: number
  reason: string
  dest: 'original' | 'credit'
  itemIds?: string[]
}
export interface AdjustInput {
  amountCents: number
  reason: string
}
export interface CreditInput {
  amountCents: number
  reason: string
  expiry: string
}

// ---- people and settings -----------------------------------------------------------------------------------------
export interface EmployeeQuery {
  q?: string
  role?: string
}
export interface EmployeeRow extends JsonObject {
  id: string
}
export interface RolesBundle extends JsonObject {
  version: number
}
