// Effective permissions of one person (the design's `eff()`): the union of the roles' grants, the highest money limit
// among the roles that grant the permission, and the per-person Allow or Deny on top.
import { ALL_PERMS, ALL_PERM_ITEMS } from './constants'
import { limKey, limLabel } from './format'
import type { Draft, Employee, LimitKind, Override, RolesConfig } from './types'

export interface Effective {
  on: boolean
  ov?: Override
  src: string
}

export const roleNameOf = (rc: RolesConfig, id: string): string => {
  const r = rc.roles.find((x) => x.id === id)
  return r ? r.name : id
}

export function effective(rc: RolesConfig, e: Pick<Employee, 'roles' | 'overrides'>, pid: string): Effective {
  const ov = e.overrides[pid]
  const from = e.roles.filter((r) => rc.perms[r] && rc.perms[r]![pid])
  const item = ALL_PERM_ITEMS.find((i) => i[0] === pid)
  const lk = item && item[2] ? limKey(pid) : null
  const lims = lk ? from.map((r) => (rc.limits[r] || {})[lk as LimitKind]) : []
  const lim = lims.length
    ? lims.includes(null)
      ? null
      : Math.max(...(lims as number[]))
    : lk
      ? 25
      : undefined
  const tail = lk ? ' · ' + limLabel(lim as number | null) : ''
  if (ov === 'deny') return { on: false, ov, src: 'Exception · denied' }
  if (ov === 'allow') return { on: true, ov, src: 'Exception · allowed' + tail }
  if (from.length) return { on: true, src: 'via ' + from.map((r) => roleNameOf(rc, r)).join(' + ') + tail }
  return { on: false, src: 'Not included in assigned roles' }
}

/** How many of the 27 permissions a person effectively has. */
export const effectiveCount = (rc: RolesConfig, e: Pick<Draft, 'roles' | 'overrides'>): number =>
  ALL_PERMS.filter((p) => effective(rc, e, p).on).length
