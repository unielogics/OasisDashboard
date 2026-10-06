// Fixture constants copied from the design (Operations class fields). fixtures.diff.test.ts runs the original class
// and fails when these drift, so they can be trusted as "what the verbatim screens show". Checklist tasks matching
// /inspection/i are left out: the class filters them in its constructor and the seed drops them too (plan.md).
import type { ClosureItem, HoursDay, ServiceItem } from './types'

export const DESIGN_PACKAGES: ReadonlyArray<
  readonly [name: string, priceDollars: number, durMin: number, tasks: readonly string[]]
> = [
  [
    'Express Hand Wash',
    45,
    35,
    ['Exterior rinse', 'Hand wash', 'Wheel cleaning', 'Hand dry & towel', 'Glass & windows'],
  ],
  [
    'Premium Hand Wash + Interior',
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
  [
    'Premium Hand Wash + Interior Refresh',
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
  [
    'Executive Detail',
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
  [
    'Executive Detail + Ceramic',
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
  [
    'Full Detail',
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
  [
    'Ceramic Maintenance + Wax',
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
  [
    'Exotic Detail Package',
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
  [
    'Family Wash + Pet Hair',
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
]

export const DESIGN_ADDONS: ReadonlyArray<
  readonly [name: string, priceDollars: number, tasks: readonly string[]]
> = [
  [
    'Interior deep clean',
    60,
    ['Deep vacuum seats & carpets', 'Steam clean vents & cupholders', 'Wipe door jambs & panels'],
  ],
  ['Pet hair removal', 35, ['Rubber-brush pet hair', 'Lint-roll upholstery', 'Vacuum seat seams']],
  ['Leather conditioning', 45, ['Clean leather surfaces', 'Apply conditioner', 'Buff to matte finish']],
  ['Wax', 40, ['Apply carnauba wax', 'Buff off haze']],
  ['Clay bar', 50, ['Lubricate panels', 'Clay bar paint', 'Wipe residue']],
  ['Odor removal', 30, ['Enzyme treatment on fabrics', 'Odor neutralizer cycle']],
  ['Engine bay cleaning', 55, ['Cover electricals', 'Degrease engine bay', 'Dress plastics']],
  ['Ceramic maintenance', 120, ['Ceramic boost spray', 'Buff & level coating']],
  ['Rain repellent', 25, ['Clean glass', 'Apply rain repellent to windshield']],
  ['Wheel deep clean', 40, ['Remove wheel fallout', 'Clean barrels & calipers', 'Seal wheel faces']],
]

/** Index = weekday, 0 = Sunday. */
export const DESIGN_HOURS: ReadonlyArray<{ open: boolean; from: string; to: string }> = [
  { open: true, from: '9:00 AM', to: '3:00 PM' },
  { open: true, from: '8:00 AM', to: '6:00 PM' },
  { open: true, from: '8:00 AM', to: '6:00 PM' },
  { open: true, from: '8:00 AM', to: '6:00 PM' },
  { open: true, from: '8:00 AM', to: '6:00 PM' },
  { open: true, from: '8:00 AM', to: '6:00 PM' },
  { open: true, from: '8:00 AM', to: '5:00 PM' },
]

export const DESIGN_CLOSURES: ReadonlyArray<{
  date: string
  name: string
  type: 'closed' | 'reduced'
  from?: string
  to?: string
}> = [
  { date: '2026-05-25', name: 'Memorial Day', type: 'closed' },
  { date: '2026-06-03', name: 'Weather closure', type: 'closed' },
  { date: '2026-07-04', name: 'Independence Day', type: 'closed' },
  { date: '2026-09-07', name: 'Labor Day', type: 'reduced', from: '10:00 AM', to: '2:00 PM' },
  { date: '2026-11-26', name: 'Thanksgiving', type: 'closed' },
  { date: '2026-12-24', name: 'Christmas Eve', type: 'reduced', from: '8:00 AM', to: '1:00 PM' },
  { date: '2026-12-25', name: 'Christmas Day', type: 'closed' },
]

/** The New Appointment panel's eight slots; blocked and VIP-held as in the design. */
export const DESIGN_SLOTS = {
  times: ['10:30 AM', '11:00 AM', '11:30 AM', '12:30 PM', '1:00 PM', '2:30 PM', '4:00 PM', '4:30 PM'],
  blocked: ['11:00 AM', '1:00 PM'],
  vipHeld: ['11:30 AM', '12:30 PM'],
} as const

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export function fixtureServices(): { packages: ServiceItem[]; addons: ServiceItem[] } {
  const item = (
    kind: 'package' | 'addon',
    name: string,
    dollars: number,
    dur: number,
    tasks: readonly string[],
  ): ServiceItem => ({
    id: `fx-${kind}-${slug(name)}`,
    name,
    kind,
    priceCents: dollars * 100,
    durationMin: dur,
    active: true,
    bookableDesk: true,
    tasks: tasks.map((label, i) => ({ id: `fx-task-${kind}-${slug(name)}-${i + 1}`, label })),
    version: 1,
  })
  return {
    packages: DESIGN_PACKAGES.map(([n, p, d, t]) => item('package', n, p, d, t)),
    addons: DESIGN_ADDONS.map(([n, p, t]) => item('addon', n, p, 0, t)),
  }
}

export const fixtureHoursDays = (): HoursDay[] => DESIGN_HOURS.map((h, weekday) => ({ weekday, ...h }))

export const fixtureClosures = (): ClosureItem[] =>
  DESIGN_CLOSURES.map((c) => ({
    id: `fx-closure-${c.date}`,
    source: 'fixture',
    notify: false,
    affectedCount: 0,
    ...c,
  }))
