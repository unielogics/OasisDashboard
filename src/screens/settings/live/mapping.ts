// Pure mapping between the API's DTOs (data/ports/settings-api.ts) and the shapes the Settings view model works on
// (lib/settings/types.ts). No clock, no network, no state: everything here is covered by mapping.test.ts against
// responses captured from the real API.
import type {
  ArrivalRes,
  Bundle,
  ClosureView,
  EmployeeDetail,
  EmployeeReq,
  EmployeeSummary,
  EmergencyPreviewRes,
  EmergencyRes,
  HoursRes,
  RolesRes,
  ServicesRes,
  VipClientsRes,
  VipRes,
} from '@/data/ports/settings-api'
import { ApiError } from '@/data/http/problem'
import { CADENCES, ORDER } from '@/lib/settings'
import { fmtTRaw, parseT } from '@/lib/time'
import type {
  Addon,
  AffectedRow,
  Arrival,
  Closure,
  Draft,
  Emergency,
  EmergencyHistoryItem,
  Employee,
  EmploymentType,
  HoursDay,
  LimitKind,
  Package,
  PayType,
  RolesConfig,
  Rules,
  SchedDay,
  Vip,
} from '@/lib/settings'

// Normalised parts ------------------------------------------------------------------------------------------------------
// The bundle and the per-section endpoints answer in slightly different shapes; a part is the common one.

export interface HoursPart {
  days: HoursRes['days']
  rules: HoursRes['rules']
  federalAuto: boolean
  version: number
}
export interface ClosuresPart {
  federalAuto: boolean
  upcoming: ClosureView[]
  past: ClosureView[]
}
export type EmergencyPart = EmergencyRes
export interface VipPart {
  view: VipRes
  /** null when the caller may not read the client list (cli.member). */
  clients: VipClientsRes['items'] | null
}
export type ArrivalPart = ArrivalRes
export type ServicesPart = ServicesRes

export function partsFromBundle(b: Bundle): {
  hours: HoursPart
  closures: ClosuresPart
  emergency: EmergencyPart
  vip: VipPart
  arrival: ArrivalPart
  services: ServicesPart
} {
  const { clients, ...vip } = b.vip
  return {
    hours: { days: b.hours.days, rules: b.rules, federalAuto: b.federalAuto, version: b.hours.version },
    closures: { federalAuto: b.federalAuto, upcoming: b.closures.upcoming, past: b.closures.past },
    emergency: b.emergency,
    vip: { view: vip, clients: clients ?? null },
    arrival: b.arrival,
    services: b.services,
  }
}

// Hours and rules -------------------------------------------------------------------------------------------------------

/** The design's `hours` array: indexed by weekday (0 = Sunday), `{open, from, to}`. */
export function mapHours(p: HoursPart): { hours: HoursDay[]; rules: Rules } {
  const hours: HoursDay[] = []
  for (const d of p.days) hours[d.weekday] = { open: d.open, from: d.from, to: d.to }
  return { hours, rules: { slot: p.rules.slot, buffer: p.rules.buffer, cutoff: p.rules.cutoff } }
}

/** The PUT body of the whole week: all seven days, times as the design's "8:00 AM" text. */
export const hoursBody = (hours: HoursDay[], version: number) => ({
  days: hours.map((h, weekday) => ({ weekday, open: h.open, from: h.from, to: h.to })),
  version,
})

/** What the server found when the new hours did not fit: appended to the "Working hours saved" toast. */
export function warningsNote(w: {
  employeeScheduleConflicts: unknown[]
  appointmentsOutsideHours: unknown[]
}): string {
  const parts: string[] = []
  const e = w.employeeScheduleConflicts.length
  const a = w.appointmentsOutsideHours.length
  if (e) parts.push(e + (e === 1 ? ' employee schedule no longer fits' : ' employee schedules no longer fit'))
  if (a)
    parts.push(
      a + (a === 1 ? ' appointment is outside the new hours' : ' appointments are outside the new hours'),
    )
  return parts.join(' · ')
}

// Closures --------------------------------------------------------------------------------------------------------------

export function mapClosure(c: ClosureView): Closure {
  return {
    id: c.id,
    date: c.date,
    name: c.name,
    type: c.type,
    from: c.from ?? '10:00 AM',
    to: c.to ?? '2:00 PM',
    notify: c.notify,
    ...(c.emergency ? { emergency: true as const, locked: true } : {}),
    ...(c.subLine ? { sub: c.subLine } : {}),
  }
}

export function mapClosures(p: ClosuresPart): { closures: Closure[]; federal: boolean } {
  return { closures: [...p.upcoming, ...p.past].map(mapClosure), federal: p.federalAuto }
}

export const closureBody = (nc: {
  date: string
  name: string
  type: 'closed' | 'reduced'
  from: string
  to: string
}) => ({
  date: nc.date,
  name: nc.name.trim(),
  type: nc.type,
  ...(nc.type === 'reduced' ? { from: nc.from, to: nc.to } : {}),
  notify: true,
})

/** The add form's line under the date, from the real count the server returned. */
export function affectedText(n: number): string {
  if (n === 0) return 'No customers are booked that day.'
  return (
    (n === 1 ? '1 customer is' : n + ' customers are') +
    ' booked that day — they’ll get a reschedule link when you add this.'
  )
}

/** The design's wording for the two closure errors (the server's uses a straight apostrophe). */
export function closureMessage(e: ApiError): string {
  if (e.code === 'CLOSURE_DATE_TAKEN') return 'There’s already a closure on that date.'
  if (e.code === 'CLOSURE_INCOMPLETE') return 'Add a date and a name.'
  return e.detail || e.title
}

// Emergency -------------------------------------------------------------------------------------------------------------

export function mapEmergency(e: EmergencyRes): {
  em: Partial<Emergency> & Pick<Emergency, 'active' | 'summary'>
  history: EmergencyHistoryItem[]
} {
  const c = e.current
  const em: Partial<Emergency> & Pick<Emergency, 'active' | 'summary'> =
    e.active && c
      ? {
          active: true,
          summary: c.summary,
          reason: c.reasonLabel,
          dur: c.durationKind,
          ...(c.untilMin !== null ? { until: fmtTRaw(c.untilMin) } : {}),
          ...(c.throughDate ? { through: c.throughDate } : {}),
          notify: c.notify,
          link: c.link,
          credits: c.credits,
          pause: c.pause,
          crew: c.crew,
          msg: c.message,
        }
      : { active: false, summary: '' }
  return { em, history: (e.history ?? []).map((h) => ({ date: h.date, reason: h.reason, detail: h.detail })) }
}

/** The query of GET /emergency/preview for the form as it stands. */
export function previewQuery(em: Emergency) {
  return {
    reason: em.reason,
    dur: em.dur,
    ...(em.dur === 'until' ? { until: em.until } : {}),
    ...(em.dur === 'days' ? { through: em.through } : {}),
    message: em.msg,
    notify: em.notify,
    link: em.link,
    pause: em.pause,
  }
}

/** A multi-day list needs the date in each row (review B50): "Mon, Jun 15 · 10:15 AM". */
export function mapAffected(p: EmergencyPreviewRes, multiDay: boolean): AffectedRow[] {
  return p.affected.map((a) => ({
    time: multiDay ? a.dateLabel.replace(/^(\w{3})\w*,/, '$1,') + ' · ' + a.time : a.time,
    name: a.customerName,
    veh: a.vehicle ?? '',
  }))
}

export function closeBody(em: Emergency) {
  return {
    reason: em.reason,
    dur: em.dur,
    ...(em.dur === 'until' ? { until: em.until } : {}),
    ...(em.dur === 'days' ? { through: em.through } : {}),
    message: em.msg,
    notify: em.notify,
    link: em.link,
    credits: em.credits,
    pause: em.pause,
    crew: em.crew,
  }
}

// Roles -----------------------------------------------------------------------------------------------------------------

/** Money limits are cents on the wire and whole dollars in the design ("≤ $1,000"); null is "No limit". */
export const centsToDollars = (v: number | null | undefined): number | null | undefined =>
  v === null || v === undefined ? v : v / 100

export function mapRoles(r: RolesRes): RolesConfig {
  const rc: RolesConfig = { roles: [], perms: {}, limits: {} }
  for (const role of r.roles) {
    rc.roles.push({
      id: role.id,
      name: role.name,
      desc: role.description,
      ...(role.locked ? { locked: true } : {}),
      ...(role.custom ? { custom: true } : {}),
    })
    rc.perms[role.id] = { ...(r.matrix[role.id] ?? {}) }
    const lim = r.limits[role.id] ?? {}
    const out: Partial<Record<LimitKind, number | null>> = {}
    for (const kind of ['refund', 'adjust', 'credit'] as const) {
      const v = centsToDollars((lim as Record<string, number | null | undefined>)[kind])
      if (v !== undefined) out[kind] = v
    }
    rc.limits[role.id] = out
  }
  return rc
}

// Employees -------------------------------------------------------------------------------------------------------------

const EMPLOYMENT: Record<'full_time' | 'part_time' | 'contractor', EmploymentType> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contractor: 'Contractor',
}
const EMPLOYMENT_API = {
  'Full-time': 'full_time',
  'Part-time': 'part_time',
  Contractor: 'contractor',
} as const
const PAY: Record<'hourly' | 'commission' | 'salary', PayType> = {
  hourly: 'Hourly',
  commission: 'Commission',
  salary: 'Salary',
}
const PAY_API = { Hourly: 'hourly', Commission: 'commission', Salary: 'salary' } as const

const BLANK_SCHED = (): SchedDay[] =>
  [0, 1, 2, 3, 4, 5, 6].map(() => ({ on: false, from: '8:00 AM', to: '6:00 PM' }))

export function mapEmployeeSummary(e: EmployeeSummary): Employee {
  return {
    id: e.id,
    first: e.first,
    last: e.last,
    title: e.title,
    phone: e.phone,
    email: e.email ?? '',
    roles: e.roles.map((r) => r.id),
    status: e.status,
    type: EMPLOYMENT[e.employmentType],
    payType: e.payType ? PAY[e.payType] : 'Hourly',
    rate: e.rateText ?? '',
    skills: e.skills,
    sched: BLANK_SCHED(),
    overrides: {},
    daysPerWeek: e.daysPerWeek,
    exceptionCount: e.exceptionCount,
    avatarColor: e.avatarColor,
    version: e.version,
    ...(e.payType === null ? { payHidden: true } : {}),
  }
}

export function mapEmployeeDetail(e: EmployeeDetail): Employee {
  const sched = BLANK_SCHED()
  for (const d of e.schedule) sched[d.weekday] = { on: d.on, from: d.from, to: d.to }
  return { ...mapEmployeeSummary(e), sched, overrides: { ...e.overrides } }
}

/** The body of POST /employees and PUT /employees/:id from the drawer's draft. */
export function employeeBody(d: Draft, includePay: boolean): EmployeeReq {
  return {
    first: d.first.trim(),
    last: d.last.trim(),
    title: d.title.trim(),
    phone: d.phone.trim(),
    email: d.email.trim(),
    roles: d.roles,
    employmentType: EMPLOYMENT_API[d.type],
    ...(includePay ? { payType: PAY_API[d.payType], rateText: d.rate.trim() } : {}),
    skills: d.skills,
    schedule: ORDER.map((weekday) => {
      const s = d.sched[weekday]!
      return { weekday, on: s.on, fromMin: parseT(s.from), toMin: parseT(s.to) }
    }),
    overrides: d.overrides,
  }
}

/** Which tab of the drawer an API validation error belongs to. */
export function errorTab(e: ApiError): 'profile' | 'access' | 'sched' {
  const path = e.errors[0]?.path ?? ''
  if (/roles|overrides/.test(path)) return 'access'
  if (/schedule/.test(path) || /availability must sit inside business hours/.test(e.detail)) return 'sched'
  if (/^Assign at least one role/.test(e.detail)) return 'access'
  return 'profile'
}

// VIP and arrival -------------------------------------------------------------------------------------------------------

const CADENCE_LABEL: Record<string, string> = {
  weekly: CADENCES[0],
  biweekly: CADENCES[1],
  triweekly: CADENCES[2],
  monthly: CADENCES[3],
}
const CADENCE_KEY = Object.fromEntries(Object.entries(CADENCE_LABEL).map(([k, v]) => [v, k])) as Record<
  string,
  string
>

export const cadenceLabel = (key: string): string => CADENCE_LABEL[key] ?? key
export const cadenceKey = (label: string): string => CADENCE_KEY[label] ?? label

export function mapVip(p: VipPart): { vip: Vip; clients: string[] | null } {
  const v = p.view
  return {
    vip: {
      holds: v.holds.map((h) => ({ d: h.weekday, t: h.time })),
      release: v.release,
      windowVip: v.windowVip,
      windowStd: v.windowStd,
      sameDay: v.sameDay,
      waitlist: v.waitlist,
      offerMin: v.offerMin,
      standing: v.standing,
      autoConfirm: v.autoConfirm,
      cadences: v.cadences.map(cadenceLabel),
      clients: [],
    },
    clients: p.clients ? p.clients.map((c) => c.fullName) : null,
  }
}

/** The PUT /vip body for the keys the view model changed (the design's cadence labels become keys). */
export function vipBody(patch: Partial<Vip>) {
  const out: Record<string, unknown> = { ...patch }
  delete out.holds
  delete out.clients
  if (patch.cadences) out.cadences = patch.cadences.map(cadenceKey)
  return out
}

export function mapArrival(a: ArrivalRes): Arrival {
  return {
    on: a.on,
    radius: a.radius,
    prepAt: a.prepAt,
    autoArrive: a.autoArrive,
    welcome: a.welcome,
    crew: a.crew,
    vipFirst: a.vipFirst,
  }
}

/** "Several customers match": what the chip shows under the name. */
export function candidateDetail(c: {
  vehicles?: unknown
  phoneHint?: string | null
  alreadyVip?: boolean
}): string {
  const vehicles = Array.isArray(c.vehicles)
    ? c.vehicles.filter((v): v is string => typeof v === 'string')
    : []
  return [
    vehicles.join(', '),
    c.phoneHint ? '…' + c.phoneHint.replace(/\D/g, '').slice(-4) : '',
    c.alreadyVip ? 'already VIP' : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

// Services --------------------------------------------------------------------------------------------------------------

export const priceNumber = (cents: number): number => cents / 100

export function mapServices(s: ServicesRes): {
  packages: Record<string, Package>
  addons: Record<string, Addon>
} {
  const packages: Record<string, Package> = {}
  for (const p of s.packages)
    packages[p.name] = {
      price: priceNumber(p.priceCents),
      dur: p.durationMin,
      tasks: p.tasks.map((t) => t.label),
    }
  const addons: Record<string, Addon> = {}
  for (const a of s.addons)
    addons[a.name] = { price: priceNumber(a.priceCents), tasks: a.tasks.map((t) => t.label) }
  return { packages, addons }
}
