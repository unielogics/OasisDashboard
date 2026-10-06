// The design's own data for the Settings screen, copied from design/extracted/settings/logic.original.js, and
// FixtureData: the SettingsData the screen uses in the default and parity builds. It keeps the design's localStorage
// behaviour (keys oasis-hours, oasis-roles, oasis-closures, oasis-checklists, oasis-emergency, oasis-vip, oasis-theme)
// so the pages of the design still share state in the browser.
import {
  DEFAULT_EMERGENCY_MESSAGE,
  PREVIEW_SAMPLE,
  closeSummary,
  closuresForStorage,
  fabricatedAffected,
  fabricatedClosureSub,
  fixtureAffected,
  newRoleParts,
  renderPreview,
  withRole,
  ALL_PERMS,
} from '@/lib/settings'
import type {
  Addon,
  Closure,
  Draft,
  Emergency,
  EmergencyHistoryItem,
  Employee,
  HoursDay,
  NewClosure,
  Package,
  RemainingRow,
  RolesConfig,
  SchedDay,
  SettingsState,
  Theme,
  Vip,
  Arrival,
} from '@/lib/settings'
import { serverClock } from '@/lib/clock'
import type {
  ClosedResult,
  EmergencyAccess,
  EmergencyCounters,
  EmergencyPreview,
  EmployeeSaved,
  NewRole,
  Outcome,
  ServerSync,
  SettingsAccess,
  SettingsData,
  SettingsSeed,
  VipClientResult,
} from './data'
import type { LimitKind, LimitValue, RuleKey, SectionKey, SvcKind, VipKey } from '@/lib/settings'

/** The design freezes "today" at Saturday 2026-06-13. */
export const FIXTURE_TODAY = '2026-06-13'

export const REMAINING: readonly RemainingRow[] = [
  ['10:15 AM', 'Marcus Webb', 'Jeep Wrangler'],
  ['10:45 AM', 'Liam Chen', 'BMW M340i'],
  ['11:00 AM', 'Grace Adeyemi', 'Lexus RX 350'],
  ['12:00 PM', 'Aisha Rahman', 'Range Rover Sport'],
  ['1:30 PM', 'Tom Bradley', 'Honda Civic'],
  ['3:00 PM', 'Elena Volkov', 'Lamborghini Urus'],
]

/** Package name -> [price, minutes, tasks]. */
export const SV: Record<string, [number, number, string[]]> = {
  'Express Hand Wash': [
    45,
    35,
    ['Exterior rinse', 'Hand wash', 'Wheel cleaning', 'Hand dry & towel', 'Glass & windows'],
  ],
  'Premium Hand Wash + Interior': [
    129,
    75,
    [
      'Exterior pre-rinse',
      'Two-bucket hand wash',
      'Wheel & tire cleaning',
      'Tire shine',
      'Interior vacuum',
      'Dashboard & console wipe',
      'Streak-free windows',
    ],
  ],
  'Premium Hand Wash + Interior Refresh': [
    139,
    75,
    [
      'Exterior pre-rinse',
      'Two-bucket hand wash',
      'Wheel & tire cleaning',
      'Tire shine',
      'Interior vacuum',
      'Dashboard & vents wipe',
      'Leather seat refresh',
      'Streak-free windows',
    ],
  ],
  'Executive Detail': [
    260,
    90,
    [
      'Foam pre-soak',
      'Two-bucket hand wash',
      'Clay bar treatment',
      'Wheel & caliper detail',
      'Tire dressing',
      'Full interior vacuum',
      'Leather conditioning',
      'Dashboard & vents detail',
      'Streak-free glass',
      'Spray sealant',
    ],
  ],
  'Executive Detail + Ceramic': [
    420,
    120,
    [
      'Foam pre-soak',
      'Two-bucket hand wash',
      'Iron decontamination',
      'Clay bar treatment',
      'Ceramic spray coat',
      'Wheel & caliper detail',
      'Full interior detail',
      'Leather conditioning',
      'Streak-free glass',
    ],
  ],
  'Full Detail': [
    320,
    120,
    [
      'Engine bay degrease',
      'Foam pre-soak',
      'Hand wash',
      'Clay bar',
      'Wheel deep clean',
      'Carpet shampoo',
      'Full interior vacuum',
      'Leather treatment',
      'Glass polish',
      'Wax & seal',
    ],
  ],
  'Ceramic Maintenance + Wax': [
    180,
    60,
    [
      'Pre-rinse',
      'pH-neutral hand wash',
      'Ceramic boost spray',
      'Hand-applied wax',
      'Wheel cleaning',
      'Tire dressing',
      'Glass treatment',
    ],
  ],
  'Exotic Detail Package': [
    650,
    150,
    [
      'Waterless decon',
      'Two-bucket hand wash',
      'Paint correction pass',
      'Ceramic seal',
      'Wheel & caliper detail',
      'Full interior detail',
      'Leather conditioning',
      'Glass & trim restore',
      'Photographic handover',
    ],
  ],
  'Family Wash + Pet Hair': [
    95,
    50,
    [
      'Exterior rinse',
      'Hand wash',
      'Pet hair removal',
      'Interior vacuum',
      'Dashboard wipe',
      'Windows',
      'Odor neutralize',
    ],
  ],
}

/** Add-on name -> [price, tasks]. */
export const AD: Record<string, [number, string[]]> = {
  'Interior deep clean': [
    60,
    ['Deep vacuum seats & carpets', 'Steam clean vents & cupholders', 'Wipe door jambs & panels'],
  ],
  'Pet hair removal': [35, ['Rubber-brush pet hair', 'Lint-roll upholstery', 'Vacuum seat seams']],
  'Leather conditioning': [45, ['Clean leather surfaces', 'Apply conditioner', 'Buff to matte finish']],
  Wax: [40, ['Apply carnauba wax', 'Buff off haze']],
  'Clay bar': [50, ['Lubricate panels', 'Clay bar paint', 'Wipe residue']],
  'Odor removal': [30, ['Enzyme treatment on fabrics', 'Odor neutralizer cycle']],
  'Engine bay cleaning': [55, ['Cover electricals', 'Degrease engine bay', 'Dress plastics']],
  'Ceramic maintenance': [120, ['Ceramic boost spray', 'Buff & level coating']],
  'Rain repellent': [25, ['Clean glass', 'Apply rain repellent to windshield']],
  'Wheel deep clean': [40, ['Remove wheel fallout', 'Clean barrels & calipers', 'Seal wheel faces']],
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export const DEF_EMERGENCY_HISTORY: EmergencyHistoryItem[] = [
  { date: 'Jun 3, 2026', reason: 'Severe weather', detail: 'Full day · 7 customers notified · 6 rebooked' },
  { date: 'Feb 18, 2026', reason: 'Power outage', detail: '11:20 AM – 3:00 PM · 4 notified' },
]

export const DEF_VIP: Vip = {
  holds: [
    { d: 6, t: '8:00 AM' },
    { d: 6, t: '9:00 AM' },
    { d: 6, t: '10:00 AM' },
    { d: 5, t: '4:00 PM' },
    { d: 0, t: '9:00 AM' },
  ],
  release: 48,
  windowVip: 30,
  windowStd: 14,
  sameDay: 2,
  waitlist: true,
  offerMin: 15,
  standing: true,
  autoConfirm: true,
  cadences: ['Weekly', 'Every 2 weeks', 'Monthly'],
  clients: ['Jonathan Franco', 'Liam Chen', 'Aisha Rahman', 'Elena Volkov'],
}

export const DEF_ARRIVAL: Arrival = {
  on: true,
  radius: 300,
  prepAt: 15,
  autoArrive: true,
  welcome: true,
  crew: true,
  vipFirst: true,
}

/** The five roles, their grants and limits as the design seeds them (whole dollars). */
export function defaultRoles(): RolesConfig {
  const set = (list: string[]): Record<string, boolean> =>
    Object.fromEntries(ALL_PERMS.map((p) => [p, list.includes(p)]))
  return {
    roles: [
      { id: 'super', name: 'Super Admin', desc: 'Owner level. Everything, including billing.', locked: true },
      { id: 'mgmt', name: 'Management', desc: 'Runs the shop day to day.' },
      { id: 'acct', name: 'Accounting', desc: 'Payments, refunds, credits and reports.' },
      { id: 'support', name: 'Customer Support', desc: 'Front desk, bookings and messaging.' },
      { id: 'crew', name: 'Crew', desc: 'Bay work: jobs, checklists, photos.' },
    ],
    perms: {
      super: set([...ALL_PERMS]),
      mgmt: set(ALL_PERMS.filter((p) => p !== 'set.billing')),
      acct: set([
        'sched.view',
        'cli.view',
        'cli.contact',
        'cli.export',
        'cli.member',
        'pay.collect',
        'pay.refund',
        'pay.adjust',
        'pay.credit',
        'pay.void',
        'pay.reports',
        'team.view',
        'set.billing',
      ]),
      support: set([
        'sched.view',
        'sched.edit',
        'sched.cancel',
        'cli.view',
        'cli.contact',
        'cli.edit',
        'cli.member',
        'pay.collect',
        'pay.refund',
        'pay.adjust',
        'pay.credit',
        'msg.send',
        'team.view',
      ]),
      crew: set(['sched.view', 'jobs.status', 'jobs.checklist', 'cli.view']),
    },
    limits: {
      super: { refund: null, adjust: null, credit: null },
      mgmt: { refund: 1000, adjust: 500, credit: 500 },
      acct: { refund: 500, adjust: 250, credit: 250 },
      support: { refund: 50, adjust: 25, credit: 50 },
      crew: { refund: 25, adjust: 25, credit: 25 },
    },
  }
}

const CLOSURE_DEFAULTS: Partial<Closure> = { notify: true, from: '10:00 AM', to: '2:00 PM' }

export function defaultHours(): HoursDay[] {
  const W = (f: string, t: string): HoursDay => ({ open: true, from: f, to: t })
  return [
    W('9:00 AM', '3:00 PM'),
    W('8:00 AM', '6:00 PM'),
    W('8:00 AM', '6:00 PM'),
    W('8:00 AM', '6:00 PM'),
    W('8:00 AM', '6:00 PM'),
    W('8:00 AM', '6:00 PM'),
    W('8:00 AM', '5:00 PM'),
  ]
}

export function defaultClosures(): Omit<Closure, 'id'>[] {
  return [
    { date: '2026-05-25', name: 'Memorial Day', type: 'closed' },
    { date: '2026-06-03', name: 'Weather closure', type: 'closed', emergency: true },
    { date: '2026-07-04', name: 'Independence Day', type: 'closed' },
    { date: '2026-09-07', name: 'Labor Day', type: 'reduced', from: '10:00 AM', to: '2:00 PM' },
    { date: '2026-11-26', name: 'Thanksgiving', type: 'closed' },
    { date: '2026-12-24', name: 'Christmas Eve', type: 'reduced', from: '8:00 AM', to: '1:00 PM' },
    { date: '2026-12-25', name: 'Christmas Day', type: 'closed' },
  ] as Omit<Closure, 'id'>[]
}

export function defaultEmployees(): Employee[] {
  const sch = (days: number[]): SchedDay[] =>
    [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      on: days.includes(d),
      from: d === 0 ? '9:00 AM' : '8:00 AM',
      to: d === 0 ? '3:00 PM' : d === 6 ? '5:00 PM' : '6:00 PM',
    }))
  const E = (
    id: string,
    first: string,
    last: string,
    title: string,
    phone: string,
    roles: string[],
    o: Partial<Employee>,
  ): Employee => ({
    id,
    first,
    last,
    title,
    phone,
    email: first.toLowerCase() + '@oasisautospa.com',
    roles,
    status: 'active',
    type: 'Full-time',
    payType: 'Hourly',
    rate: '',
    skills: [],
    sched: sch([1, 2, 3, 4, 5, 6]),
    overrides: {},
    ...o,
  })
  return [
    E('e1', 'Amara', 'Okoye', 'Owner', '(305) 555-0101', ['super'], {
      payType: 'Salary',
      skills: ['Exotic vehicles'],
    }),
    E('e2', 'Rafael', 'Mendes', 'General Manager', '(305) 555-0140', ['mgmt', 'acct'], { payType: 'Salary' }),
    E('e3', 'Marco', 'Ruiz', 'Lead Detailer', '(786) 555-0172', ['crew'], {
      payType: 'Commission',
      rate: '30',
      skills: ['Paint correction', 'Ceramic coating', 'Exotic vehicles'],
    }),
    E('e4', 'Lena', 'Kim', 'Detailer', '(305) 555-0119', ['crew'], {
      rate: '22',
      skills: ['Interior detailing'],
      sched: sch([0, 2, 3, 4, 5, 6]),
    }),
    E('e5', 'Sofia', 'Duarte', 'Front Desk', '(786) 555-0133', ['support', 'crew'], {
      rate: '21',
      skills: ['Front desk'],
      overrides: { 'sched.override': 'allow' },
    }),
    E('e6', 'Daniel', 'Price', 'Bookkeeper', '(305) 555-0188', ['acct'], {
      type: 'Part-time',
      rate: '34',
      sched: sch([1, 3, 5]),
    }),
    E('e7', 'Kevin', 'Tran', 'Detailer', '(786) 555-0151', ['crew'], {
      status: 'invited',
      rate: '19',
      sched: sch([1, 2, 3, 4, 5]),
    }),
  ]
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface FixtureDataOptions {
  /** Where the design's `oasis-*` keys live (default window.localStorage; `null` for none). */
  storage?: StorageLike | null
  /** The clock behind the ids of rows created on the screen (default the system clock, as the design). */
  nowMs?: () => number
}

const defaultStorage = (): StorageLike | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export class FixtureData implements SettingsData {
  readonly live = false
  private readonly storage: StorageLike | null
  private readonly nowMs: () => number
  private getState: () => SettingsState = () => {
    throw new Error('FixtureData is not attached to a view model')
  }

  constructor(opts: FixtureDataOptions = {}) {
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage
    this.nowMs = opts.nowMs ?? (() => serverClock.rawNow())
  }

  attach(getState: () => SettingsState): void {
    this.getState = getState
  }

  private ls(k: string): unknown {
    try {
      return JSON.parse(this.storage!.getItem(k) || 'null')
    } catch {
      return null
    }
  }

  private save(k: string, v: unknown): void {
    try {
      this.storage!.setItem(k, JSON.stringify(v))
    } catch {
      /* storage unavailable or full: the design ignores it */
    }
  }

  // clock and identity ---------------------------------------------------------------------------------------------
  today(): string {
    return FIXTURE_TODAY
  }
  newId(prefix: string): string {
    return prefix + this.nowMs()
  }
  stampDate(): string {
    return 'Jun 13, 2026'
  }
  access(): SettingsAccess {
    return { userShort: 'Rafael M.', can: () => true, isSuper: true }
  }

  // initial state --------------------------------------------------------------------------------------------------
  seed(): SettingsSeed {
    const hours = (this.ls('oasis-hours') as HoursDay[] | null) || defaultHours()
    const rc = (this.ls('oasis-roles') as RolesConfig | null) || defaultRoles()
    const employees = defaultEmployees()
    const closures = ((this.ls('oasis-closures') as Omit<Closure, 'id'>[] | null) || defaultClosures()).map(
      (c, i) => ({ ...CLOSURE_DEFAULTS, ...c, id: 'c' + i }),
    ) as Closure[]
    const ov = (this.ls('oasis-checklists') || {}) as {
      packages?: Record<string, string[]>
      addons?: Record<string, string[]>
    }
    const packages: Record<string, Package> = Object.fromEntries(
      Object.entries(SV).map(([k, v]) => [
        k,
        { price: v[0], dur: v[1], tasks: (ov.packages && ov.packages[k]) || [...v[2]] },
      ]),
    )
    const addons: Record<string, Addon> = Object.fromEntries(
      Object.entries(AD).map(([k, v]) => [
        k,
        { price: v[0], tasks: (ov.addons && ov.addons[k]) || [...v[1]] },
      ]),
    )
    const em = this.ls('oasis-emergency') as { active?: boolean; summary?: string } | null
    const store = (this.ls('oasis-vip') || {}) as Partial<{ vip: Vip; arrival: Arrival }>
    let theme: string
    try {
      theme = localStorage.getItem('oasis-theme') || 'light'
    } catch {
      theme = 'light'
    }
    return {
      theme: theme as Theme,
      hours,
      savedHours: JSON.stringify(hours),
      rules: { slot: 30, buffer: 10, cutoff: 60 },
      closures,
      federal: true,
      em: {
        active: !!(em && em.active),
        summary: (em && em.summary) || '',
        reason: 'Severe weather',
        dur: 'today',
        until: '2:00 PM',
        through: '2026-06-15',
        notify: true,
        link: true,
        credits: true,
        pause: true,
        crew: true,
        msg: DEFAULT_EMERGENCY_MESSAGE,
      },
      emHistory: clone(DEF_EMERGENCY_HISTORY),
      employees,
      vip: store.vip || clone(DEF_VIP),
      arrival: store.arrival || clone(DEF_ARRIVAL),
      rc,
      packages,
      addons,
    }
  }

  sync(): ServerSync | null {
    return null
  }
  status(): 'ready' {
    return 'ready'
  }
  reload(): void {}
  subscribe(): () => void {
    return () => {}
  }
  locked(_section: SectionKey): boolean {
    return false
  }

  // theme ----------------------------------------------------------------------------------------------------------
  saveTheme(theme: Theme): void {
    try {
      localStorage.setItem('oasis-theme', theme)
    } catch {
      /* ignored, as in the design */
    }
  }

  // working hours and rules ----------------------------------------------------------------------------------------
  saveHours(hours: HoursDay[]): Outcome<{ note?: string }> {
    this.save('oasis-hours', hours)
    return { ok: true, value: {} }
  }
  saveRule(_key: RuleKey, _value: number): boolean {
    return true
  }

  // closures -------------------------------------------------------------------------------------------------------
  closureSub(c: Closure): string {
    return fabricatedClosureSub(c)
  }
  closureAffected(nc: NewClosure): string {
    return fabricatedAffected(nc, this.today())
  }
  createClosure(nc: NewClosure): Outcome<Closure> {
    const closure = { ...nc, name: nc.name.trim(), notify: true, id: this.newId('c') } as Closure
    this.save('oasis-closures', closuresForStorage([...this.getState().closures, closure]))
    return { ok: true, value: closure }
  }
  private persistClosures(): boolean {
    this.save('oasis-closures', closuresForStorage(this.getState().closures))
    return true
  }
  setClosureNotify(_id: string, _notify: boolean): boolean {
    return this.persistClosures()
  }
  removeClosure(_id: string): boolean {
    return this.persistClosures()
  }
  setFederal(_enabled: boolean): boolean {
    return true
  }

  // emergency ------------------------------------------------------------------------------------------------------
  emergencyAccess(): EmergencyAccess {
    return { canClose: true, requirement: 'Requires Management or Super Admin' }
  }
  emergencyStrip(): string {
    return 'Open now · Saturday 8:00 AM – 5:00 PM · 6 appointments left today, 3 vehicles on site'
  }
  emergencyCounters(em: Emergency): EmergencyCounters {
    return {
      notified: em.notify ? String(REMAINING.length) : '0',
      rebooked: '2',
      booking: em.pause ? 'Paused' : 'Open',
    }
  }
  emergencyPreview(em: Emergency): EmergencyPreview {
    const affected = fixtureAffected(REMAINING, em)
    return {
      affected,
      count: affected.length,
      message: renderPreview(em, PREVIEW_SAMPLE),
      first: PREVIEW_SAMPLE.first,
    }
  }
  close(em: Emergency, _idempotencyKey: string): Outcome<ClosedResult> {
    const summary = closeSummary(em)
    this.save('oasis-emergency', { active: true, summary })
    return { ok: true, value: { summary, notified: fixtureAffected(REMAINING, em).length } }
  }
  reopen(em: Emergency): Outcome<EmergencyHistoryItem> {
    this.save('oasis-emergency', { active: false })
    return {
      ok: true,
      value: {
        date: this.stampDate(),
        reason: em.reason,
        detail: 'Reopened by ' + this.access().userShort + ' · ' + REMAINING.length + ' notified',
      },
    }
  }

  // employees ------------------------------------------------------------------------------------------------------
  employee(id: string): Employee | null {
    return this.getState().employees.find((e) => e.id === id) ?? null
  }
  defaultRole(): string {
    return 'crew'
  }
  saveEmployee(draft: Draft, _stored: Employee | null): EmployeeSaved {
    const employee = (draft.id ? draft : { ...draft, id: this.newId('e'), status: 'invited' }) as Employee
    return { ok: true, employee }
  }

  // roles ----------------------------------------------------------------------------------------------------------
  private persistRoles(): boolean {
    this.save('oasis-roles', this.getState().rc)
    return true
  }
  setPermission(_roleId: string, _key: string, _granted: boolean): boolean {
    return this.persistRoles()
  }
  setLimit(_roleId: string, _kind: LimitKind, _value: LimitValue): boolean {
    return this.persistRoles()
  }
  addRole(): Outcome<NewRole> {
    const rc = this.getState().rc
    const parts = newRoleParts(rc, this.newId('custom'), this.defaultRole())
    this.save('oasis-roles', withRole(rc, parts))
    return { ok: true, value: parts }
  }
  removeRole(_roleId: string): boolean {
    return this.persistRoles()
  }

  // VIP and arrival ------------------------------------------------------------------------------------------------
  private persistVip(): boolean {
    const s = this.getState()
    this.save('oasis-vip', { vip: s.vip, arrival: s.arrival })
    return true
  }
  saveVip(_key: VipKey, _patch: Partial<Vip> & Partial<Arrival>): boolean {
    return this.persistVip()
  }
  addHold(_hold: { d: number; t: string }): boolean {
    return this.persistVip()
  }
  removeHold(_hold: { d: number; t: string }): boolean {
    return this.persistVip()
  }
  addVipClient(name: string): VipClientResult {
    const s = this.getState()
    this.save('oasis-vip', { vip: { ...s.vip, clients: [...s.vip.clients, name] }, arrival: s.arrival })
    return { status: 'added', name, toast: name + ' is now VIP' }
  }
  addVipClientById(_id: string): VipClientResult {
    return { status: 'failed' }
  }
  removeVipClient(_name: string): boolean {
    return this.persistVip()
  }

  // services -------------------------------------------------------------------------------------------------------
  saveChecklist(_kind: SvcKind, _name: string, _tasks: string[]): boolean {
    const { packages: p, addons: a } = this.getState()
    this.save('oasis-checklists', {
      packages: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.tasks])),
      addons: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v.tasks])),
    })
    return true
  }
}
