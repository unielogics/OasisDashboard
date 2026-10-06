// Roles and permissions: the edits of the matrix, on a copy of the config (as the design's setRC does).
import { LIMITS } from './constants'
import type { Employee, LimitKind, LimitValue, Role, RolesConfig } from './types'

export const cloneRoles = (rc: RolesConfig): RolesConfig => JSON.parse(JSON.stringify(rc)) as RolesConfig

export function withPermission(rc: RolesConfig, roleId: string, key: string, granted: boolean): RolesConfig {
  const next = cloneRoles(rc)
  next.perms[roleId]![key] = granted
  return next
}

/** The next value of a limit chip: the following choice, wrapping; a missing limit counts as 25. */
export function nextLimit(current: LimitValue | undefined): LimitValue {
  const i = LIMITS.indexOf(current === undefined ? 25 : current)
  return LIMITS[(i + 1) % LIMITS.length]!
}

export function withLimit(rc: RolesConfig, roleId: string, kind: LimitKind, value: LimitValue): RolesConfig {
  const next = cloneRoles(rc)
  next.limits[roleId] = next.limits[roleId] || {}
  next.limits[roleId]![kind] = value
  return next
}

/** What "Custom role" creates: the role, a copy of Crew's grants plus Create & edit appointments, limits 25. */
export function newRoleParts(
  rc: RolesConfig,
  id: string,
  crewId: string,
): { role: Role; perms: Record<string, boolean>; limits: Partial<Record<LimitKind, LimitValue>> } {
  return {
    role: { id, name: 'Shift Lead', desc: 'Custom role — starts from Crew.', custom: true },
    perms: { ...rc.perms[crewId], 'sched.edit': true },
    limits: { refund: 25, adjust: 25, credit: 25 },
  }
}

export function withRole(
  rc: RolesConfig,
  parts: { role: Role; perms: Record<string, boolean>; limits: Partial<Record<LimitKind, LimitValue>> },
): RolesConfig {
  const next = cloneRoles(rc)
  next.roles.push(parts.role)
  next.perms[parts.role.id] = parts.perms
  next.limits[parts.role.id] = parts.limits
  return next
}

export function withoutRole(rc: RolesConfig, roleId: string): RolesConfig {
  const next = cloneRoles(rc)
  next.roles = next.roles.filter((x) => x.id !== roleId)
  delete next.perms[roleId]
  delete next.limits[roleId]
  return next
}

export const withoutRoleOnPeople = (employees: Employee[], roleId: string): Employee[] =>
  employees.map((e) => ({ ...e, roles: e.roles.filter((x) => x !== roleId) }))
