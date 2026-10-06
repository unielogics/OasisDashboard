// The Operations design's fixtures, verbatim from design/extracted/operations/logic.original.js (the class fields and the
// state initialiser). `FixtureData` (fixtures.ts) serves them behind the OperationsData interface; the differential
// tests in Logic.diff.test.ts fail when any of them drifts from the original class.
import { DESIGN_BASE } from '@/lib/dates'
import { DESIGN_KPI_PLACEHOLDERS } from '@/lib/operations/kpis'
import type {
  BaseAppt,
  Closure,
  DayHours,
  Emergency,
  HistoryDef,
  ServiceDef,
  Theme,
  VehicleDef,
} from '@/lib/operations/types'
import type {
  AvailabilityData,
  CatalogData,
  DisplayData,
  OperationsClock,
  OperationsData,
  PoolsData,
  TodayData,
} from './data'

export const SERVICES: Record<string, ServiceDef> = {
  'Express Hand Wash': {
    price: 45,
    dur: 35,
    list: ['Exterior rinse', 'Hand wash', 'Wheel cleaning', 'Hand dry & towel', 'Glass & windows'],
  },
  'Premium Hand Wash + Interior': {
    price: 129,
    dur: 75,
    list: [
      'Exterior pre-rinse',
      'Two-bucket hand wash',
      'Wheel & tire cleaning',
      'Tire shine',
      'Interior vacuum',
      'Dashboard & console wipe',
      'Streak-free windows',
      'Final inspection',
    ],
  },
  'Premium Hand Wash + Interior Refresh': {
    price: 139,
    dur: 75,
    list: [
      'Exterior pre-rinse',
      'Two-bucket hand wash',
      'Wheel & tire cleaning',
      'Tire shine',
      'Interior vacuum',
      'Dashboard & vents wipe',
      'Leather seat refresh',
      'Streak-free windows',
      'Final inspection',
    ],
  },
  'Executive Detail': {
    price: 260,
    dur: 90,
    list: [
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
      'Final inspection',
    ],
  },
  'Executive Detail + Ceramic': {
    price: 420,
    dur: 120,
    list: [
      'Foam pre-soak',
      'Two-bucket hand wash',
      'Iron decontamination',
      'Clay bar treatment',
      'Ceramic spray coat',
      'Wheel & caliper detail',
      'Full interior detail',
      'Leather conditioning',
      'Streak-free glass',
      'Final inspection',
    ],
  },
  'Full Detail': {
    price: 320,
    dur: 120,
    list: [
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
      'Final inspection',
    ],
  },
  'Ceramic Maintenance + Wax': {
    price: 180,
    dur: 60,
    list: [
      'Pre-rinse',
      'pH-neutral hand wash',
      'Ceramic boost spray',
      'Hand-applied wax',
      'Wheel cleaning',
      'Tire dressing',
      'Glass treatment',
      'Final inspection',
    ],
  },
  'Exotic Detail Package': {
    price: 650,
    dur: 150,
    list: [
      'Hand-dry pre-inspection',
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
  },
  'Family Wash + Pet Hair': {
    price: 95,
    dur: 50,
    list: [
      'Exterior rinse',
      'Hand wash',
      'Pet hair removal',
      'Interior vacuum',
      'Dashboard wipe',
      'Windows',
      'Odor neutralize',
      'Final inspection',
    ],
  },
}

export const ADDONS: ReadonlyArray<readonly [string, number]> = [
  ['Interior deep clean', 60],
  ['Pet hair removal', 35],
  ['Leather conditioning', 45],
  ['Wax', 40],
  ['Clay bar', 50],
  ['Odor removal', 30],
  ['Engine bay cleaning', 55],
  ['Ceramic maintenance', 120],
  ['Rain repellent', 25],
  ['Wheel deep clean', 40],
]

export const ADDON_TASKS: Record<string, string[]> = {
  'Interior deep clean': [
    'Deep vacuum seats & carpets',
    'Steam clean vents & cupholders',
    'Wipe door jambs & panels',
  ],
  'Pet hair removal': ['Rubber-brush pet hair', 'Lint-roll upholstery', 'Vacuum seat seams'],
  'Leather conditioning': ['Clean leather surfaces', 'Apply conditioner', 'Buff to matte finish'],
  Wax: ['Apply carnauba wax', 'Buff off haze'],
  'Clay bar': ['Lubricate panels', 'Clay bar paint', 'Wipe residue'],
  'Odor removal': ['Enzyme treatment on fabrics', 'Odor neutralizer cycle'],
  'Engine bay cleaning': ['Cover electricals', 'Degrease engine bay', 'Dress plastics'],
  'Ceramic maintenance': ['Ceramic boost spray', 'Buff & level coating'],
  'Rain repellent': ['Clean glass', 'Apply rain repellent to windshield'],
  'Wheel deep clean': ['Remove wheel fallout', 'Clean barrels & calipers', 'Seal wheel faces'],
}

export const HIST: HistoryDef[] = [
  ['Premium Hand Wash + Interior', 'Bi-weekly regular', 129, true],
  ['Express Hand Wash', 'Quick turnaround', 45, false],
  ['Executive Detail', 'Pre-trip deep clean', 260, false],
]

export const DEF_HOURS: DayHours[] = [
  { open: true, from: '9:00 AM', to: '3:00 PM' },
  { open: true, from: '8:00 AM', to: '6:00 PM' },
  { open: true, from: '8:00 AM', to: '6:00 PM' },
  { open: true, from: '8:00 AM', to: '6:00 PM' },
  { open: true, from: '8:00 AM', to: '6:00 PM' },
  { open: true, from: '8:00 AM', to: '6:00 PM' },
  { open: true, from: '8:00 AM', to: '5:00 PM' },
]

export const DEF_CLOSURES: Closure[] = [
  { date: '2026-05-25', name: 'Memorial Day', type: 'closed' },
  { date: '2026-06-03', name: 'Weather closure', type: 'closed' },
  { date: '2026-07-04', name: 'Independence Day', type: 'closed' },
  { date: '2026-09-07', name: 'Labor Day', type: 'reduced', from: '10:00 AM', to: '2:00 PM' },
  { date: '2026-11-26', name: 'Thanksgiving', type: 'closed' },
  { date: '2026-12-24', name: 'Christmas Eve', type: 'reduced', from: '8:00 AM', to: '1:00 PM' },
  { date: '2026-12-25', name: 'Christmas Day', type: 'closed' },
]

export const POOL_NAMES: string[] = [
  'Olivia Hart',
  'Ethan Morales',
  'Chloe Bennett',
  'Mateo Silva',
  'Hannah Kim',
  'Isaac Patel',
  'Zoe Laurent',
  'Andre Thompson',
  'Camila Reyes',
  'Noah Fischer',
  'Leah Goldberg',
  'Omar Haddad',
  'Ruby Castillo',
  'Victor Nguyen',
  'Ava Sinclair',
  'Diego Ramos',
  'Nina Petrova',
  'Caleb Owens',
  'Mia Torres',
  'Julian Brooks',
]

export const POOL_VEH: VehicleDef[] = [
  [2022, 'BMW', 'X5', 'Carbon Black'],
  [2021, 'Toyota', '4Runner', 'Lunar Rock'],
  [2023, 'Audi', 'e-tron GT', 'Tactical Green'],
  [2020, 'Honda', 'Accord', 'Platinum White'],
  [2024, 'Rivian', 'R1S', 'Glacier White'],
  [2019, 'Mercedes-Benz', 'C300', 'Selenite Grey'],
  [2022, 'Ford', 'Bronco', 'Cactus Gray'],
  [2023, 'Porsche', '911 Carrera', 'GT Silver'],
  [2021, 'Kia', 'Telluride', 'Gravity Gray'],
  [2022, 'Tesla', 'Model 3', 'Deep Blue'],
  [2024, 'Lexus', 'GX 550', 'Wind Chill Pearl'],
  [2023, 'Genesis', 'GV80', 'Uyuni White'],
]

export const SEED_APPOINTMENTS: BaseAppt[] = [
  {
    id: 'a1',
    day: 0,
    time: '8:30 AM',
    status: 'completed',
    staff: 'Lena K.',
    cust: { name: 'Maria Delgado', phone: '(305) 412-8890' },
    veh: { year: 2021, make: 'Audi', model: 'Q5', color: 'Pearl White', plate: 'KLP-8842' },
    svc: 'Express Hand Wash',
    bay: 2,
    member: 'Essential',
    pay: 'paid',
    addons: ['Wax'],
    tip: 8,
    pickup: 'collected',
  },
  {
    id: 'a2',
    day: 0,
    time: '9:15 AM',
    status: 'completed',
    staff: 'Marco R.',
    cust: { name: 'David Okafor', phone: '(786) 220-1144' },
    veh: { year: 2019, make: 'Ford', model: 'F-150', color: 'Magnetic Gray', plate: 'FRD-1190' },
    svc: 'Full Detail',
    bay: 1,
    member: null,
    pay: 'paid',
    addons: ['Engine bay cleaning'],
    tip: 20,
    pickup: 'collected',
  },
  {
    id: 'a3',
    day: 0,
    time: '9:45 AM',
    status: 'completed',
    staff: 'Lena K.',
    notified: true,
    pickup: 'pending',
    cust: { name: 'Priya Nair', phone: '(305) 778-3321' },
    veh: { year: 2022, make: 'Tesla', model: 'Model Y', color: 'Midnight Silver', plate: 'TES-2210' },
    svc: 'Premium Hand Wash + Interior',
    bay: 2,
    member: 'Premium',
    pay: 'unpaid',
    addons: ['Rain repellent'],
    notes: 'Customer prefers no fragrance products. Parked in the south lot.',
  },
  {
    id: 'a4',
    day: 0,
    time: '10:00 AM',
    status: 'cleaning',
    staff: 'Marco R.',
    startedAgo: 27,
    vip: true,
    cust: { name: 'Jonathan Franco', phone: '(305) 904-7781' },
    veh: { year: 2023, make: 'Mercedes-Benz', model: 'GLE', color: 'Obsidian Black', plate: 'ABC-1234' },
    svc: 'Premium Hand Wash + Interior Refresh',
    bay: 1,
    member: 'Premium Care',
    pay: 'paid',
    addons: ['Leather conditioning'],
    notes: 'Regular — every other Saturday. Likes a text when 10 min out.',
  },
  {
    id: 'a5',
    day: 0,
    time: '10:30 AM',
    status: 'arrived',
    staff: 'Sofia D.',
    geoIn: '10:27 AM',
    cust: { name: 'Sofia Marchetti', phone: '(786) 551-9080' },
    veh: { year: 2024, make: 'Porsche', model: 'Macan', color: 'Carmine Red', plate: 'POR-9911' },
    svc: 'Executive Detail',
    bay: 2,
    member: 'Executive',
    pay: 'deposit',
    deposit: 50,
    addons: [],
    notes: 'New ceramic coating — pH-neutral products only.',
  },
  {
    id: 'a6',
    day: 0,
    time: '10:45 AM',
    status: 'confirmed',
    staff: 'Marco R.',
    vip: true,
    eta: 12,
    cust: { name: 'Liam Chen', phone: '(305) 233-7765' },
    veh: { year: 2020, make: 'BMW', model: 'M340i', color: 'Alpine White', plate: 'BMW-3401' },
    svc: 'Ceramic Maintenance + Wax',
    bay: 1,
    member: null,
    pay: 'paid',
    addons: [],
  },
  {
    id: 'a7',
    day: 0,
    time: '10:15 AM',
    status: 'confirmed',
    staff: 'Unassigned',
    late: true,
    cust: { name: 'Marcus Webb', phone: '(786) 119-4420' },
    veh: { year: 2017, make: 'Jeep', model: 'Wrangler', color: 'Sarge Green', plate: 'JEP-7720' },
    svc: 'Family Wash + Pet Hair',
    bay: null,
    member: null,
    pay: 'deposit',
    deposit: 20,
    addons: ['Odor removal'],
  },
  {
    id: 'a8',
    day: 0,
    time: '11:00 AM',
    status: 'booked',
    staff: 'Sofia D.',
    eta: 22,
    cust: { name: 'Grace Adeyemi', phone: '(305) 660-2231' },
    veh: { year: 2018, make: 'Lexus', model: 'RX 350', color: 'Silver Lining', plate: 'LEX-0455' },
    svc: 'Express Hand Wash',
    bay: 2,
    member: null,
    pay: 'unpaid',
    addons: [],
  },
  {
    id: 'a9',
    day: 0,
    time: '12:00 PM',
    status: 'confirmed',
    staff: 'Marco R.',
    cust: { name: 'Aisha Rahman', phone: '(786) 442-1209' },
    veh: { year: 2023, make: 'Range Rover', model: 'Sport', color: 'Santorini Black', plate: 'RR-5567' },
    svc: 'Executive Detail + Ceramic',
    bay: 1,
    member: 'Exotic',
    pay: 'paid',
    addons: ['Ceramic maintenance'],
  },
  {
    id: 'a10',
    day: 0,
    time: '1:30 PM',
    status: 'confirmed',
    staff: 'Sofia D.',
    cust: { name: 'Tom Bradley', phone: '(305) 887-0042' },
    veh: { year: 2016, make: 'Honda', model: 'Civic', color: 'Aegean Blue', plate: 'HND-2218' },
    svc: 'Express Hand Wash',
    bay: 2,
    member: null,
    pay: 'unpaid',
    addons: [],
  },
  {
    id: 'a11',
    day: 0,
    time: '3:00 PM',
    status: 'booked',
    staff: 'Marco R.',
    vip: true,
    cust: { name: 'Elena Volkov', phone: '(786) 998-0001' },
    veh: { year: 2022, make: 'Lamborghini', model: 'Urus', color: 'Giallo Inti', plate: 'URS-0001' },
    svc: 'Exotic Detail Package',
    bay: 1,
    member: 'Exotic',
    pay: 'unpaid',
    addons: [],
    special: 'Hand-dry only — no automated equipment near paint. Owner inspects before release.',
  },
  {
    id: 'a12',
    day: 1,
    time: '9:00 AM',
    status: 'confirmed',
    staff: 'Lena K.',
    cust: { name: 'Nathan Brooks', phone: '(305) 320-7788' },
    veh: { year: 2021, make: 'Chevrolet', model: 'Tahoe', color: 'Summit White', plate: 'CHV-6610' },
    svc: 'Family Wash + Pet Hair',
    bay: 2,
    member: 'Essential',
    pay: 'paid',
    addons: ['Pet hair removal'],
  },
]

export const HISTORY_POOL: HistoryDef[] = [
  ['Premium Hand Wash + Interior', 'Bi-weekly regular', 129, true],
  ['Express Hand Wash', 'Quick turnaround', 45, false],
  ['Executive Detail', 'Pre-trip deep clean', 260, false],
  ['Ceramic Maintenance + Wax', 'Coating top-up', 180, false],
]

export const NEW_APPOINTMENT_SLOTS = {
  slotTimes: ['10:30 AM', '11:00 AM', '11:30 AM', '12:30 PM', '1:00 PM', '2:30 PM', '4:00 PM', '4:30 PM'],
  blocked: ['11:00 AM', '1:00 PM'],
  vipHeld: ['11:30 AM', '12:30 PM'],
}

export const PERKS_BY_PLAN: Record<string, string[]> = {
  Essential: ['2 express washes / month', 'Priority booking', '10% off add-ons', 'Free vacuum anytime'],
  Premium: [
    '2 premium washes / month',
    'Skip-the-line priority',
    '15% off all add-ons',
    'Monthly interior refresh',
    'Free rain repellent',
  ],
  Executive: [
    'Unlimited express washes',
    '2 executive details / month',
    '20% off add-ons',
    'Dedicated detailer',
    'Loaner coordination',
  ],
  Exotic: [
    'Unlimited hand washes',
    'Concierge pickup & delivery',
    'Paint protection reviews',
    '25% off all services',
    'Private appointment windows',
  ],
}

/** The design's "now": 10:36 AM on Saturday, June 13 2026. */
export const DESIGN_NOW_MINUTES = 10 * 60 + 36
export const DESIGN_DATE_LABEL = 'Saturday, June 13'

export const FIXTURE_DISPLAY: DisplayData = {
  kpi: DESIGN_KPI_PLACEHOLDERS,
  renewDate: 'Jul 12, 2026',
  payMethodOnFile: 'Visa ···· 4421',
  payMethodNone: 'No payment on file',
  avgFreq: '18 days',
  lifetimePerVisit: 148,
  perksByPlan: PERKS_BY_PLAN,
}

type Store = Pick<Storage, 'getItem' | 'setItem'>

export interface FixtureDataOptions {
  /** Where the Settings screen's `oasis-*` keys live; defaults to window.localStorage when it is readable. */
  storage?: Store | null
  clock?: OperationsClock
}

const defaultStorage = (): Store | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

const systemClock: OperationsClock = {
  nowMs: () => Date.now(),
  wall: () => {
    const d = new Date()
    return { hours: d.getHours(), minutes: d.getMinutes() }
  },
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/**
 * The design's data. Every read that the original class did on construction happens here, in the same order:
 * `oasis-checklists` overrides package lists and add-on tasks, then `/inspection/i` steps are dropped from every
 * package list (add-on tasks keep theirs, as the original does); hours, closures and emergency come from the
 * Settings keys; the theme from `oasis-theme`. Each call hands out fresh copies, so a screen can mutate them.
 */
export class FixtureData implements OperationsData {
  private readonly storage: Store | null
  private readonly clk: OperationsClock
  private cat: CatalogData | null = null
  private ls: { hours: unknown; closures: unknown; emergency: unknown } | null = null

  constructor(opts: FixtureDataOptions = {}) {
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage
    this.clk = opts.clock ?? systemClock
  }

  private read(key: string): unknown {
    try {
      return JSON.parse(this.storage!.getItem(key) || 'null')
    } catch {
      return null
    }
  }

  catalog(): CatalogData {
    if (!this.cat) {
      const services = clone(SERVICES)
      const addonTasks = clone(ADDON_TASKS)
      const ov = this.read('oasis-checklists') as {
        packages?: Record<string, string[]>
        addons?: Record<string, string[]>
      } | null
      if (ov) {
        Object.keys(ov.packages || {}).forEach((n) => {
          if (services[n]) services[n].list = ov.packages![n]!
        })
        Object.assign(addonTasks, ov.addons || {})
      }
      Object.values(services).forEach((s) => {
        s.list = s.list.filter((x) => !/inspection/i.test(x))
      })
      this.cat = { services, addons: ADDONS, addonTasks }
    }
    return this.cat
  }

  private persisted() {
    return (this.ls ??= {
      hours: this.read('oasis-hours'),
      closures: this.read('oasis-closures'),
      emergency: this.read('oasis-emergency'),
    })
  }

  hours(): DayHours[] | null {
    return this.persisted().hours as DayHours[] | null
  }
  defaultHours(): DayHours[] {
    return DEF_HOURS
  }
  closures(): Closure[] | null {
    return this.persisted().closures as Closure[] | null
  }
  defaultClosures(): Closure[] {
    return DEF_CLOSURES
  }
  emergency(): Emergency | null {
    return this.persisted().emergency as Emergency | null
  }
  today(): TodayData {
    return { base: DESIGN_BASE, nowMinutes: DESIGN_NOW_MINUTES, dateLabel: DESIGN_DATE_LABEL }
  }
  clock(): OperationsClock {
    return this.clk
  }
  seedAppointments(): BaseAppt[] {
    return SEED_APPOINTMENTS
  }
  historyPool(): HistoryDef[] {
    return HISTORY_POOL
  }
  generatedHistory(): HistoryDef[] {
    return HIST
  }
  pools(): PoolsData {
    return { names: POOL_NAMES, vehicles: POOL_VEH }
  }
  availability(): AvailabilityData {
    return NEW_APPOINTMENT_SLOTS
  }
  display(): DisplayData {
    return FIXTURE_DISPLAY
  }
  theme(): Theme {
    try {
      return (this.storage!.getItem('oasis-theme') || 'light') as Theme
    } catch {
      return 'light'
    }
  }
  saveTheme(theme: Theme): void {
    try {
      this.storage!.setItem('oasis-theme', theme)
    } catch {
      /* private mode or blocked storage: the theme just does not persist */
    }
  }
}
