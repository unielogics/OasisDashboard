// Constants of the Settings design (labels, option lists, section copy) in the order the design lists them.
import type { SectionKey } from './types'

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
/** Monday first, Sunday last: the display order of the hours and schedule lists. */
export const ORDER = [1, 2, 3, 4, 5, 6, 0] as const
export const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
export const LIMITS: readonly (number | null)[] = [25, 50, 100, 250, 500, 1000, null]
export const SKILLS = [
  'Interior detailing',
  'Paint correction',
  'Ceramic coating',
  'Exotic vehicles',
  'Front desk',
  'Mobile service',
] as const

/** [key, label, limited?]: `1` marks a money permission that carries a limit chip. */
export type PermItem = readonly [key: string, label: string, limited?: 1]
export interface PermGroup {
  mod: string
  items: readonly PermItem[]
}

export const PERMS: readonly PermGroup[] = [
  {
    mod: 'Schedule & jobs',
    items: [
      ['sched.view', 'View schedule & calendar'],
      ['sched.edit', 'Create & edit appointments'],
      ['sched.cancel', 'Cancel & mark no-shows'],
      ['sched.override', 'Override bay capacity'],
      ['jobs.status', 'Move jobs between stages'],
      ['jobs.checklist', 'Complete checklists & photos'],
    ],
  },
  {
    mod: 'Clients',
    items: [
      ['cli.view', 'View client files'],
      ['cli.contact', 'See phone & email'],
      ['cli.edit', 'Edit client & vehicle details'],
      ['cli.export', 'Export client data'],
      ['cli.member', 'Manage memberships & VIP'],
    ],
  },
  {
    mod: 'Payments',
    items: [
      ['pay.collect', 'Collect payments'],
      ['pay.refund', 'Issue refunds', 1],
      ['pay.adjust', 'Apply adjustments & discounts', 1],
      ['pay.credit', 'Issue account credits', 1],
      ['pay.void', 'Void transactions'],
      ['pay.reports', 'View payment reports'],
    ],
  },
  {
    mod: 'Messaging',
    items: [
      ['msg.send', 'Message customers'],
      ['msg.auto', 'Edit automations & templates'],
      ['msg.broadcast', 'Send offers & broadcasts'],
    ],
  },
  {
    mod: 'Team',
    items: [
      ['team.view', 'View team'],
      ['team.edit', 'Add & edit employees'],
      ['team.roles', 'Assign roles & permissions'],
    ],
  },
  {
    mod: 'Settings',
    items: [
      ['set.hours', 'Working hours & holidays'],
      ['set.emergency', 'Emergency closing'],
      ['set.services', 'Services, pricing & checklists'],
      ['set.billing', 'Billing & integrations'],
    ],
  },
]

export const ALL_PERMS: readonly string[] = PERMS.flatMap((g) => g.items.map((i) => i[0]))
export const ALL_PERM_ITEMS: readonly PermItem[] = PERMS.flatMap((g) => g.items)

export const SECTION_META: Record<SectionKey, readonly [title: string, description: string]> = {
  vip: ['VIP program', 'Booking priority for VIP clients. Built around saving them time.'],
  arrival: ['Arrival & check-in', 'Geofence check-in and bay prep for every client.'],
  hours: ['Working hours', 'Weekly opening hours and booking rules.'],
  closures: [
    'Holidays & closures',
    'Planned closed days and reduced hours. Booked customers are notified automatically.',
  ],
  emergency: ['Emergency closing', 'Close immediately, notify affected customers and pause booking.'],
  employees: ['Employees', 'Create team members, assign roles and set schedules.'],
  roles: ['Roles & permissions', 'What each role can see and do, including money limits.'],
  services: [
    'Packages & checklists',
    'Checklist tasks for each package and add-on. Jobs combine both automatically.',
  ],
}

export const MON = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const
export const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const

/** Avatar colours by list index (mod 7). */
export const AVATAR_COLORS = [
  '#0E7A63',
  '#2563EB',
  '#7A3B8A',
  '#C2740B',
  '#0D9488',
  '#B45309',
  '#6B7280',
] as const

export const EMERGENCY_REASONS = [
  'Severe weather',
  'Power outage',
  'Equipment failure',
  'Staff shortage',
  'Other',
] as const

/** The `{reason}` wording of each reason chip. */
export const REASON_TEXT: Record<string, string> = {
  'Severe weather': 'severe weather',
  'Power outage': 'a power outage',
  'Equipment failure': 'an equipment failure',
  'Staff shortage': 'a staffing issue',
  Other: 'unforeseen circumstances',
}

export const EMERGENCY_DURATIONS = [
  ['today', 'Rest of today'],
  ['until', 'Until a time'],
  ['days', 'Multiple days'],
] as const

export const DEFAULT_EMERGENCY_MESSAGE =
  'Hi {first}, due to {reason} Oasis Auto Spa is closed {until}. We’re sorry for the inconvenience. Pick a new time here: {link}'

/** The preview sample the design renders (first name and short link). */
export const PREVIEW_SAMPLE = { first: 'Liam', link: 'oasis.spa/r/8KQ2' } as const

export const CADENCES = ['Weekly', 'Every 2 weeks', 'Every 3 weeks', 'Monthly'] as const

/** The permission a section needs before the live screen shows it at all; the others are readable by anyone signed in. */
export const SECTION_READ_PERMISSION: Partial<Record<SectionKey, string>> = {
  emergency: 'set.emergency',
  employees: 'team.view',
  roles: 'team.view',
  vip: 'cli.member',
}
