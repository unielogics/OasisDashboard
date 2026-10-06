import { moneyWhole0 } from '../money'
import type { LimitKind, RolesConfig } from './types'

export interface RoleLimit {
  has: boolean
  max: number
}

/**
 * What a role may do for one money action (design lim()): `has` is the pay.<kind> permission; `max` is the per-action
 * limit in dollars. A null limit, and a missing limit on the super role, mean no limit; any other missing limit is $25.
 */
export function limitFor(rc: RolesConfig, role: string, kind: LimitKind): RoleLimit {
  const has = !!(rc.perms[role] || {})['pay.' + kind]
  if (!has) return { has: false, max: 0 }
  const v = (rc.limits[role] || {})[kind]
  return {
    has: true,
    max: v === null || (v === undefined && role === 'super') ? Infinity : v === undefined ? 25 : v,
  }
}

export const hasPermission = (rc: RolesConfig, role: string, key: string): boolean =>
  !!(rc.perms[role] || {})[key]

export const canViewReports = (rc: RolesConfig, role: string): boolean =>
  hasPermission(rc, role, 'pay.reports')
export const canCollectPayments = (rc: RolesConfig, role: string): boolean =>
  hasPermission(rc, role, 'pay.collect')

export function roleName(rc: RolesConfig, id: string): string {
  const r = rc.roles.find((x) => x.id === id)
  return r ? r.name : id
}

/** "no limit" or "$500 limit" (the sheets' permission text). */
export const limitText = (l: RoleLimit): string =>
  l.max === Infinity ? 'no limit' : moneyWhole0(l.max) + ' limit'

/** Second line of a role in the Preview-as menu. */
export function roleMenuLimit(rc: RolesConfig, roleId: string): string {
  const l = limitFor(rc, roleId, 'refund')
  return !canViewReports(rc, roleId) && !l.has
    ? 'no access'
    : l.has
      ? 'refunds ' + (l.max === Infinity ? 'no limit' : '≤ $' + l.max)
      : 'no refunds'
}
