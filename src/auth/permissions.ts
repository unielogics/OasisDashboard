// The 27 permission keys (Settings "Roles & permissions"), the default role grants and the wording of the
// "Your role can’t …" toast. Keys match the backend catalog (backend design 6.1).

export const PERMISSION_KEYS = [
  'sched.view',
  'sched.edit',
  'sched.cancel',
  'sched.override',
  'jobs.status',
  'jobs.checklist',
  'cli.view',
  'cli.contact',
  'cli.edit',
  'cli.export',
  'cli.member',
  'pay.collect',
  'pay.refund',
  'pay.adjust',
  'pay.credit',
  'pay.void',
  'pay.reports',
  'msg.send',
  'msg.auto',
  'msg.broadcast',
  'team.view',
  'team.edit',
  'team.roles',
  'set.hours',
  'set.emergency',
  'set.services',
  'set.billing',
] as const

export type PermissionKey = (typeof PERMISSION_KEYS)[number]

/** Money permissions carry a per-transaction limit (cents). */
export const LIMITED_PERMISSIONS = {
  'pay.refund': 'refund',
  'pay.adjust': 'adjust',
  'pay.credit': 'credit',
} as const
export type LimitedPermission = keyof typeof LIMITED_PERMISSIONS

export const isPermissionKey = (k: string): k is PermissionKey =>
  (PERMISSION_KEYS as readonly string[]).includes(k)

/** Completes "Your role can’t …" for each key; the wording follows the Payments disabled-action titles. */
export const PERMISSION_VERBS: Record<PermissionKey, string> = {
  'sched.view': 'view the schedule',
  'sched.edit': 'edit appointments',
  'sched.cancel': 'cancel appointments',
  'sched.override': 'override a blocked slot',
  'jobs.status': 'change job status',
  'jobs.checklist': 'update checklists',
  'cli.view': 'view client files',
  'cli.contact': 'see contact details',
  'cli.edit': 'edit clients',
  'cli.export': 'export clients',
  'cli.member': 'manage memberships',
  'pay.collect': 'collect payments',
  'pay.refund': 'issue refunds',
  'pay.adjust': 'adjust invoices',
  'pay.credit': 'issue credits',
  'pay.void': 'mark payments unpaid',
  'pay.reports': 'view payment reports',
  'msg.send': 'send messages',
  'msg.auto': 'edit automations',
  'msg.broadcast': 'send broadcasts',
  'team.view': 'view the team',
  'team.edit': 'edit employees',
  'team.roles': 'change roles',
  'set.hours': 'change hours and closures',
  'set.emergency': 'use emergency closing',
  'set.services': 'edit packages and checklists',
  'set.billing': 'manage integrations',
}

/** The toast title for a permission the role lacks: "Your role can’t issue refunds" (U+2019 apostrophe). */
export const deniedTitle = (key: string): string =>
  `Your role can’t ${isPermissionKey(key) ? PERMISSION_VERBS[key] : 'do that'}`

/** Default role grants (backend design 6.1), used by the fake API; the real grants come from /me. */
export const DEFAULT_ROLE_GRANTS: Record<
  'super' | 'mgmt' | 'acct' | 'support' | 'crew',
  readonly PermissionKey[]
> = {
  super: PERMISSION_KEYS,
  mgmt: PERMISSION_KEYS.filter((k) => k !== 'set.billing'),
  acct: [
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
  ],
  support: [
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
  ],
  crew: ['sched.view', 'jobs.status', 'jobs.checklist', 'cli.view'],
}

/** The labels of the Settings "Roles & permissions" matrix (quoted by the locked-screen card). */
export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  'sched.view': 'View schedule & calendar',
  'sched.edit': 'Create & edit appointments',
  'sched.cancel': 'Cancel & mark no-shows',
  'sched.override': 'Override bay capacity',
  'jobs.status': 'Move jobs between stages',
  'jobs.checklist': 'Complete checklists & photos',
  'cli.view': 'View client files',
  'cli.contact': 'See phone & email',
  'cli.edit': 'Edit client & vehicle details',
  'cli.export': 'Export client data',
  'cli.member': 'Manage memberships & VIP',
  'pay.collect': 'Collect payments',
  'pay.refund': 'Issue refunds',
  'pay.adjust': 'Apply adjustments & discounts',
  'pay.credit': 'Issue account credits',
  'pay.void': 'Void transactions',
  'pay.reports': 'View payment reports',
  'msg.send': 'Message customers',
  'msg.auto': 'Edit automations & templates',
  'msg.broadcast': 'Send offers & broadcasts',
  'team.view': 'View team',
  'team.edit': 'Add & edit employees',
  'team.roles': 'Assign roles & permissions',
  'set.hours': 'Working hours & holidays',
  'set.emergency': 'Emergency closing',
  'set.services': 'Services, pricing & checklists',
  'set.billing': 'Billing & integrations',
}
