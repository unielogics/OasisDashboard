// Shapes of the Operations (Command Center) screen model. They describe what the original class keeps in
// `this.state` and what its helpers consume; nothing here is a new contract.

export type ApptStatus =
  | 'booked'
  | 'confirmed'
  | 'arrived'
  | 'cleaning'
  | 'completed'
  | 'canceled'
  | 'noshow'
  // the original's collect() compares against these two but nothing ever sets them
  | 'ready'
  | 'paid'

export type PayState = 'paid' | 'deposit' | 'unpaid'
export type PickupState = 'pending' | 'collected'
export type Style = Record<string, string | number>

export interface Customer {
  name: string
  phone: string
}

export interface Vehicle {
  year: number
  make: string
  model: string
  color: string
  plate: string
}

export interface AddonLine {
  name: string
  price: number
}

export interface Message {
  from: string
  text: string
  time: string
  channel: string
}

export interface LogLine {
  time: string
  text: string
  channel: string
}

export interface HistoryRow {
  day: string
  mon: string
  service: string
  note: string
  amount: string
  fav: boolean
}

export interface Photos {
  arrival: number
  before: number
  after: number
  issue: number
}

export interface ServiceDef {
  price: number
  dur: number
  list: string[]
}

export type Services = Record<string, ServiceDef>
export type AddonCatalog = ReadonlyArray<readonly [name: string, price: number]>
export type AddonTasks = Record<string, string[]>

/** A seed appointment as written in the design, before hydration. */
export interface BaseAppt {
  id: string
  day: number
  time: string
  status: ApptStatus
  staff: string
  cust: Customer
  veh: Vehicle
  svc: string
  bay: number | null
  member: string | null
  pay: PayState
  addons: string[]
  deposit?: number
  tip?: number
  pickup?: PickupState | null
  notified?: boolean
  notes?: string
  special?: string
  vip?: boolean
  late?: boolean
  eta?: number
  geoIn?: string
  startedAgo?: number
}

/** A hydrated appointment, the unit of `state.appts`, `state.calAppts` and the generated calendar days. */
export interface Appt {
  id: string
  day: number
  time: string
  status: ApptStatus
  staff: string
  cust: Customer
  veh: Vehicle
  svc: string
  bay: number | null
  member: string | null
  pay: PayState
  addons: AddonLine[]
  deposit?: number
  tip: number
  pickup: PickupState | null
  notified: boolean
  notes: string
  special: string | null
  vip?: boolean
  late?: boolean
  eta?: number | null
  geoIn?: string
  startedAgo?: number
  prepped?: boolean
  whatsapp: boolean
  price: number
  dur: number
  baseList: string[]
  checks: Record<string, boolean>
  startedAt: number | null
  photos: Photos
  visits: number
  history: HistoryRow[]
  messages: Message[] | null
  log: LogLine[] | null
}

export interface DayHours {
  open: boolean
  from: string
  to: string
}

export interface Closure {
  date: string
  name: string
  type: 'closed' | 'reduced'
  from?: string
  to?: string
}

/** The Settings emergency record the banner reads; only `active` and `summary` matter here. */
export interface Emergency {
  active?: boolean
  summary?: string
  [key: string]: unknown
}

/** [service, note, amount in dollars, favourite] as the design lists the history pool. */
export type HistoryDef = readonly [service: string, note: string, amount: number, fav: boolean]

/** [year, make, model, colour] as the design lists the generated-day vehicle pool. */
export type VehicleDef = readonly [year: number, make: string, model: string, color: string]

export type CalMode = 'day' | 'week' | 'month'
export type ViewName = 'timeline' | 'bay' | 'staff' | 'calendar'
export type RangeName = 'next24' | 'today' | 'tomorrow' | 'week'
export type Theme = 'light' | 'dark'
