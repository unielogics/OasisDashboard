// What the Settings view model reads and writes. The fixture implementation (fixtures.ts) serves the design's own data
// and keeps the design's localStorage behaviour; the live implementation (live/LiveData.ts) is backed by the API.
// Nothing in Logic.ts or src/lib/settings knows which one it has.
//
// Three kinds of members:
//   - reads: sync values, the initial `seed()` and, live only, the server's current model through `sync()`;
//   - persist calls (`persist*`, `set*`, `save*`): the view model has already changed its own state, the data stores
//     the change. `false` (or a promise of `false`) means it failed and the screen reloads the server's truth;
//   - confirm calls (`create*`, `close`, `saveEmployee`, ...): changes whose result the server decides (ids, validation,
//     counts). The view model applies the change to its state only when the answer is `ok`.
// Calls that may be slow return `MaybeAsync`: the fixture answers synchronously (so the screen behaves exactly like
// the design, step by step), the live data answers with a promise. The view model applies the answer through `settle`.
import type { PermissionKey } from '@/auth/permissions'
import type {
  AffectedRow,
  Addon,
  Arrival,
  Closure,
  Draft,
  Emergency,
  EmergencyHistoryItem,
  Employee,
  HoursDay,
  LimitKind,
  LimitValue,
  NewClosure,
  Package,
  Role,
  RolesConfig,
  RuleKey,
  Rules,
  SectionKey,
  SettingsState,
  SvcKind,
  TaskOp,
  Theme,
  Vip,
  VipKey,
} from '@/lib/settings'

export type MaybeAsync<T> = T | Promise<T>

/** Runs `then` with the value now when it is plain, or when the promise resolves. */
export function settle<T>(v: MaybeAsync<T>, then: (value: T) => void, fail?: (e: unknown) => void): void {
  if (v instanceof Promise) void v.then(then, fail)
  else then(v)
}

/** Everything the screen's `state` starts from (the data-bearing keys; the UI keys have fixed starting values). */
export interface SettingsSeed {
  theme: Theme
  hours: HoursDay[]
  savedHours: string
  rules: Rules
  closures: Closure[]
  federal: boolean
  em: Emergency
  emHistory: EmergencyHistoryItem[]
  employees: Employee[]
  vip: Vip
  arrival: Arrival
  rc: RolesConfig
  packages: Record<string, Package>
  addons: Record<string, Addon>
}

/** One part of the server's model; `rev` changes whenever the part was reloaded. */
export interface SyncPart<T> {
  rev: number
  data: T
}

export interface ServerSync {
  hours?: SyncPart<{ hours: HoursDay[]; rules: Rules }>
  closures?: SyncPart<{ closures: Closure[]; federal: boolean }>
  emergency?: SyncPart<{
    em: Partial<Emergency> & Pick<Emergency, 'active' | 'summary'>
    history: EmergencyHistoryItem[]
  }>
  vip?: SyncPart<{ vip: Vip; clients: string[] | null }>
  arrival?: SyncPart<Arrival>
  services?: SyncPart<{ packages: Record<string, Package>; addons: Record<string, Addon> }>
  roles?: SyncPart<RolesConfig>
  employees?: SyncPart<Employee[]>
}

export type SyncPartName = keyof ServerSync

export type LoadStatus = 'loading' | 'ready' | 'failed'

/** The answer to a confirm call: the change happened (with what the server decided) or it did not. */
export type Outcome<T = undefined> = { ok: true; value: T } | { ok: false; message?: string }

export interface EmergencyPreview {
  affected: AffectedRow[]
  count: number
  message: string
  /** The first name the preview message is addressed to. */
  first: string
}

export interface EmergencyCounters {
  notified: string
  rebooked: string
  booking: string
}

export interface EmergencyAccess {
  canClose: boolean
  /** "Requires Management or Super Admin" */
  requirement: string
}

export interface ClosedResult {
  summary: string
  notified: number
}

export type EmployeeSaved =
  { ok: true; employee: Employee } | { ok: false; message: string; tab?: 'profile' | 'access' | 'sched' }

export interface VipCandidate {
  id: string
  name: string
  detail: string
}

export type VipClientResult =
  | { status: 'added'; name: string; toast: string }
  | { status: 'already'; name: string; toast: string }
  | { status: 'candidates'; candidates: VipCandidate[] }
  | { status: 'failed' }

/** What the design's "Custom role" button creates: the role and its starting grants and limits. */
export interface NewRole {
  role: Role
  perms: Record<string, boolean>
  limits: Partial<Record<LimitKind, LimitValue>>
}

/** The signed-in person, as far as the screen needs them (the design gates nothing). */
export interface SettingsAccess {
  /** The name on the reopen history line ("Rafael M."). */
  userShort: string
  can(key: PermissionKey): boolean
  /** The real Super Admin, acting as one (money limits and Super-only grants are closed otherwise). */
  isSuper: boolean
}

export interface SettingsData {
  /** True when the server owns the data: the view model hydrates from `sync()` and waits for the server's answers. */
  readonly live: boolean
  /** The view model hands over a reader of its current state (the fixture persists from it). */
  attach(getState: () => SettingsState): void

  // clock and identity -------------------------------------------------------------------------------------------
  /** The business date ("2026-06-13"). */
  today(): string
  /** A fresh id for a locally created row ("c" + clock). */
  newId(prefix: string): string
  /** "Jun 13, 2026": the date on a reopen history line. */
  stampDate(): string
  access(): SettingsAccess

  // initial state and server model -------------------------------------------------------------------------------
  seed(): SettingsSeed
  /** Live: the latest server model, by part (a part that has not loaded or is not readable is absent). Fixture: null. */
  sync(): ServerSync | null
  status(): LoadStatus
  /** Re-reads the model from the server (the Retry button, and after a failed change). */
  reload(parts?: SyncPartName[]): void
  /** Tells the screen when the server model changed. Returns the unsubscribe. */
  subscribe(fn: () => void): () => void
  /** Sections the caller cannot read; the screen shows the locked card instead. */
  locked(section: SectionKey): boolean

  // theme ----------------------------------------------------------------------------------------------------------
  saveTheme(theme: Theme): void

  // working hours and rules ----------------------------------------------------------------------------------------
  saveHours(hours: HoursDay[]): MaybeAsync<Outcome<{ note?: string }>>
  saveRule(key: RuleKey, value: number): MaybeAsync<boolean>

  // closures -------------------------------------------------------------------------------------------------------
  /** The sub-line of a closure row ("Online booking blocked · 2 existing bookings to move"). */
  closureSub(c: Closure): string
  /** The add form's "N customers are booked" line (empty while a live count is on its way). */
  closureAffected(nc: NewClosure): string
  createClosure(nc: NewClosure): MaybeAsync<Outcome<Closure>>
  setClosureNotify(id: string, notify: boolean): MaybeAsync<boolean>
  removeClosure(id: string): MaybeAsync<boolean>
  setFederal(enabled: boolean): MaybeAsync<boolean>

  // emergency ------------------------------------------------------------------------------------------------------
  emergencyAccess(): EmergencyAccess
  /** The idle strip ("Open now · Saturday 8:00 AM – 5:00 PM · 6 appointments left today, 3 vehicles on site"). */
  emergencyStrip(): string
  emergencyCounters(em: Emergency): EmergencyCounters
  /** Who would be affected and the message as it would read (the previous answer while a new one is on its way). */
  emergencyPreview(em: Emergency, visible: boolean): EmergencyPreview
  close(em: Emergency, idempotencyKey: string): MaybeAsync<Outcome<ClosedResult>>
  reopen(em: Emergency): MaybeAsync<Outcome<EmergencyHistoryItem>>

  // employees ------------------------------------------------------------------------------------------------------
  /** The full record for the drawer (schedule, exceptions); list rows carry only a summary. */
  employee(id: string): MaybeAsync<Employee | null>
  /** The default role of a new employee (Crew). */
  defaultRole(): string
  saveEmployee(draft: Draft, stored: Employee | null): MaybeAsync<EmployeeSaved>

  // roles ----------------------------------------------------------------------------------------------------------
  setPermission(roleId: string, key: string, granted: boolean): MaybeAsync<boolean>
  setLimit(roleId: string, kind: LimitKind, value: LimitValue): MaybeAsync<boolean>
  addRole(): MaybeAsync<Outcome<NewRole>>
  removeRole(roleId: string): MaybeAsync<boolean>

  // VIP and arrival ------------------------------------------------------------------------------------------------
  /** Toggles, steppers and segments of the VIP program and of arrival (`patch` is the changed keys). */
  saveVip(key: VipKey, patch: Partial<Vip> & Partial<Arrival>): MaybeAsync<boolean>
  addHold(hold: { d: number; t: string }): MaybeAsync<boolean>
  removeHold(hold: { d: number; t: string }): MaybeAsync<boolean>
  addVipClient(name: string): MaybeAsync<VipClientResult>
  addVipClientById(id: string): MaybeAsync<VipClientResult>
  removeVipClient(name: string): MaybeAsync<boolean>

  /** Sends what is still waiting to be saved (the screen is going away). */
  flush(): void

  // services -------------------------------------------------------------------------------------------------------
  /** Stores the whole ordered checklist of one package or add-on; `op` is the edit that produced `tasks`. */
  saveChecklist(kind: SvcKind, name: string, tasks: string[], op: TaskOp): MaybeAsync<boolean>
}
