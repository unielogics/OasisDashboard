// Which permission opens which screen. The designs gate only Payments (locked card without pay.reports); the rest is
// the plan's rule: a person who can do nothing on a screen gets the same locked card instead of an empty board. The
// server enforces every read and write regardless.
import { can } from './session-model'
import type { Session } from './session-model'
import { PERMISSION_LABELS } from './permissions'
import type { PermissionKey } from './permissions'

export interface RouteAccess {
  path: string
  /** Any one of these opens the screen. */
  any: readonly PermissionKey[]
  title: string
  /** The one named in the card text: The Crew role doesn't include "<label>". */
  named: PermissionKey
  nav: string
}

export const ROUTE_ACCESS: readonly RouteAccess[] = [
  {
    path: '/operations',
    any: ['sched.view'],
    title: 'No schedule access',
    named: 'sched.view',
    nav: 'Operations',
  },
  {
    path: '/payments',
    any: ['pay.reports'],
    title: 'No payment access',
    named: 'pay.reports',
    nav: 'Payments',
  },
  {
    path: '/settings',
    any: [
      'set.hours',
      'set.emergency',
      'set.services',
      'team.view',
      'team.edit',
      'team.roles',
      'cli.member',
      'set.billing',
    ],
    title: 'No settings access',
    named: 'team.view',
    nav: 'Settings',
  },
]

export const ruleFor = (pathname: string): RouteAccess | undefined =>
  ROUTE_ACCESS.find((r) => pathname === r.path || pathname.startsWith(r.path + '/'))

export const canOpen = (s: Pick<Session, 'permissions'> | null | undefined, rule: RouteAccess): boolean =>
  rule.any.some((k) => can(s, k))

/** The card text, as in the Payments design: The <role> role doesn't include "<permission label>". */
export const lockedText = (roleTitle: string, rule: RouteAccess): string =>
  `The ${roleTitle} role doesn't include "${PERMISSION_LABELS[rule.named]}". A Super Admin can grant it in Settings.`

/** Screens this session can open, for the links under the locked card. */
export const openableScreens = (s: Pick<Session, 'permissions'> | null | undefined): RouteAccess[] =>
  ROUTE_ACCESS.filter((r) => canOpen(s, r))
