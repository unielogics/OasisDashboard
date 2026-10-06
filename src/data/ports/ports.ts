// The data-port interfaces. A screen's view model reads through these and never builds URLs; the fixture port
// serves the parity build, the live port serves the real API. Reads are plain promises (wrapped by TanStack Query in
// the screens); every mutation takes the action's Idempotency-Key and is wrapped by command() for optimistic
// patches, rollback and toasts.
import type {
  AdvanceInput,
  AppointmentFile,
  AvailabilityQuery,
  CalendarDay,
  CalendarDayDetail,
  Catalog,
  ClosureInput,
  ClosureItem,
  CommandOptions,
  EmergencyCloseInput,
  EmergencyPreview,
  EmergencyState,
  EmployeeQuery,
  EmployeeRow,
  HoursSettings,
  JsonObject,
  MessageInput,
  OpsSnapshot,
  OpsWindow,
  RolesBundle,
  ServiceItem,
  Slot,
} from './types'
import type { PaymentsPort } from './payments'

export interface CatalogPort {
  services(): Promise<Catalog>
  saveChecklist(
    serviceId: string,
    tasks: { id?: string; label: string }[],
    o?: CommandOptions,
  ): Promise<ServiceItem>
}

export interface HoursPort {
  hours(): Promise<HoursSettings>
  saveHours(next: HoursSettings, o?: CommandOptions): Promise<HoursSettings>
  closures(range?: { from?: string; to?: string }): Promise<ClosureItem[]>
  previewClosure(input: ClosureInput): Promise<{ affected: number }>
  createClosure(input: ClosureInput, o?: CommandOptions): Promise<ClosureItem>
  deleteClosure(id: string, o?: CommandOptions): Promise<void>
}

export interface EmergencyPort {
  current(): Promise<EmergencyState>
  preview(q: { reason: string; dur: string; until?: string; through?: string }): Promise<EmergencyPreview>
  close(input: EmergencyCloseInput, o?: CommandOptions): Promise<EmergencyState>
  reopen(o?: CommandOptions): Promise<EmergencyState>
}

export interface CalendarPort {
  summary(from: string, to: string): Promise<CalendarDay[]>
  day(date: string): Promise<CalendarDayDetail>
}

export interface AvailabilityPort {
  slots(q: AvailabilityQuery): Promise<Slot[]>
}

export interface OpsPort {
  snapshot(q: { window: OpsWindow; q?: string }): Promise<OpsSnapshot>
  appointment(id: string): Promise<AppointmentFile>
  advance(id: string, input: AdvanceInput, o?: CommandOptions): Promise<AppointmentFile>
  assignBay(id: string, bayId: string, o?: CommandOptions): Promise<AppointmentFile>
  toggleChecklistItem(id: string, itemId: string, done: boolean, o?: CommandOptions): Promise<void>
  toggleAddon(id: string, serviceId: string, on: boolean, o?: CommandOptions): Promise<AppointmentFile>
  reschedule(
    id: string,
    input: { start: string; override?: { reason: string } },
    o?: CommandOptions,
  ): Promise<AppointmentFile>
}

export interface MessagesPort {
  thread(appointmentId: string): Promise<JsonObject[]>
  send(appointmentId: string, input: MessageInput, o?: CommandOptions): Promise<JsonObject>
}

export interface PeoplePort {
  employees(q?: EmployeeQuery): Promise<EmployeeRow[]>
  roles(): Promise<RolesBundle>
  setRolePermission(roleId: string, key: string, granted: boolean, o?: CommandOptions): Promise<RolesBundle>
  setRoleLimit(
    roleId: string,
    kind: string,
    valueCents: number | null,
    o?: CommandOptions,
  ): Promise<RolesBundle>
}

/** Everything a screen can read or write, region by region. */
export interface DataPort {
  readonly kind: 'fixture' | 'live'
  catalog: CatalogPort
  hours: HoursPort
  emergency: EmergencyPort
  calendar: CalendarPort
  availability: AvailabilityPort
  ops: OpsPort
  messages: MessagesPort
  payments: PaymentsPort
  people: PeoplePort
}

/** Thrown by a port region that has no implementation in this mode (the verbatim class still owns that data). */
export class PortUnavailableError extends Error {
  constructor(
    readonly region: string,
    readonly mode: 'fixture' | 'live',
  ) {
    super(`${region} is not available from the ${mode} data port yet`)
    this.name = 'PortUnavailableError'
  }
}
