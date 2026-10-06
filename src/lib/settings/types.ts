// Domain types of the Settings screen (the shapes of the design's `state`). The fixture build and the live build
// both work on these; the live data layer maps the API's DTOs onto them (src/screens/settings/live/mapping.ts).
import type { StyleObject } from '../color'

export type { StyleObject }

export type Theme = 'light' | 'dark'

export type SectionKey =
  'hours' | 'closures' | 'emergency' | 'employees' | 'roles' | 'vip' | 'arrival' | 'services'

/** One weekday of the opening hours (the state array is indexed by weekday, 0 = Sunday). */
export interface HoursDay {
  open: boolean
  from: string
  to: string
}

export interface Rules {
  slot: number
  buffer: number
  cutoff: number
}

export type RuleKey = keyof Rules

export type ClosureType = 'closed' | 'reduced'

export interface Closure {
  notify: boolean
  from: string
  to: string
  date: string
  name: string
  type: ClosureType
  emergency?: boolean
  id: string
  /** Live only: the server's sub-line ("Online booking blocked · 2 existing bookings to move"). */
  sub?: string
  /** Live only: the row cannot be edited (an emergency closure). */
  locked?: boolean
}

export interface NewClosure {
  date: string
  name: string
  type: ClosureType
  from: string
  to: string
}

export type EmergencyReason =
  'Severe weather' | 'Power outage' | 'Equipment failure' | 'Staff shortage' | 'Other'
export type EmergencyDuration = 'today' | 'until' | 'days'

export interface Emergency {
  active: boolean
  summary: string
  reason: string
  dur: EmergencyDuration
  until: string
  through: string
  notify: boolean
  link: boolean
  credits: boolean
  pause: boolean
  crew: boolean
  msg: string
}

export type EmergencyOptionKey = 'notify' | 'link' | 'credits' | 'pause' | 'crew'

export interface EmergencyHistoryItem {
  date: string
  reason: string
  detail: string
}

export interface AffectedRow {
  time: string
  name: string
  veh: string
}

/** The design's "remaining today" fixture: [time, client, vehicle]. */
export type RemainingRow = readonly [string, string, string]

export type Override = 'allow' | 'deny'
export type EmployeeStatus = 'active' | 'invited' | 'inactive'
export type EmploymentType = 'Full-time' | 'Part-time' | 'Contractor'
export type PayType = 'Hourly' | 'Commission' | 'Salary'

export interface SchedDay {
  on: boolean
  from: string
  to: string
}

export interface Employee {
  id: string
  first: string
  last: string
  title: string
  phone: string
  email: string
  roles: string[]
  status: EmployeeStatus
  type: EmploymentType
  payType: PayType
  rate: string
  skills: string[]
  sched: SchedDay[]
  overrides: Record<string, Override>
  /** Live only (list rows carry no schedule or exceptions; the drawer loads the detail). */
  daysPerWeek?: number
  exceptionCount?: number
  avatarColor?: string | null
  version?: number
  /** Live only: pay type and rate were withheld (the caller lacks team.edit). */
  payHidden?: boolean
}

/** The employee being edited in the drawer; `id` is null for a new one. */
export type Draft = Omit<Employee, 'id'> & { id: string | null }

export interface Role {
  id: string
  name: string
  desc: string
  locked?: boolean
  custom?: boolean
}

export type LimitKind = 'refund' | 'adjust' | 'credit'
/** Whole dollars; null is "No limit". A role without an entry counts as $25. */
export type LimitValue = number | null

export interface RolesConfig {
  roles: Role[]
  perms: Record<string, Record<string, boolean>>
  limits: Record<string, Partial<Record<LimitKind, LimitValue>>>
}

export interface Hold {
  d: number
  t: string
}

export interface Vip {
  holds: Hold[]
  release: number
  windowVip: number
  windowStd: number
  sameDay: number
  waitlist: boolean
  offerMin: number
  standing: boolean
  autoConfirm: boolean
  cadences: string[]
  clients: string[]
}

export type VipKey = 'vip' | 'arrival'

export interface Arrival {
  on: boolean
  radius: number
  prepAt: number
  autoArrive: boolean
  welcome: boolean
  crew: boolean
  vipFirst: boolean
}

export interface Package {
  price: number
  dur: number
  tasks: string[]
}

export interface Addon {
  price: number
  tasks: string[]
}

export type SvcKind = 'pkg' | 'addon'

export type DrawerTab = 'profile' | 'access' | 'sched'

/** The whole `state` of the Settings class, key order as in the design. */
export interface SettingsState {
  theme: Theme
  section: SectionKey
  hours: HoursDay[]
  savedHours: string
  rules: Rules
  closures: Closure[]
  adding: boolean
  nc: NewClosure
  ncError: string
  federal: boolean
  em: Emergency
  emHistory: EmergencyHistoryItem[]
  confirm: boolean
  employees: Employee[]
  empQuery: string
  roleFilter: string
  drawer: string | null
  draft: Draft | null
  drTab: DrawerTab
  drError: string
  vip: Vip
  arrival: Arrival
  holdDay: number
  holdTime: string
  vipNew: string
  rc: RolesConfig
  svcKind: SvcKind
  svcSel: string
  packages: Record<string, Package>
  addons: Record<string, Addon>
  newTask: string
  toast: string | null
}

/** The persisted pieces of `state.vip` and `state.arrival` (localStorage 'oasis-vip'). */
export interface VipStore {
  vip: Vip
  arrival: Arrival
}
