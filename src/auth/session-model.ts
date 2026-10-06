// The normalised session the app works with, built from GET /me (+ GET /meta/now for the server clock when /me does
// not carry it), and the permission helpers `can()` / `limit()`.
import type { MeResponse, MoneyKind, PermissionState, Theme, ViewAsOption } from '@/data/http/auth-types'
import { DEFAULT_TZ } from '@/lib/tz'
import { LIMITED_PERMISSIONS } from './permissions'
import type { LimitedPermission, PermissionKey } from './permissions'

export interface Session {
  user: { id: string; employeeId: string; email: string; name: string; initials: string; title: string }
  roles: { id: string; key: string | null; name: string }[]
  /** Title shown on the header chip: the viewed role while view-as is active, else the person's top role. */
  roleTitle: string
  /** The REAL person is a Super Admin (view-as is available); not the effective authority. */
  isSuperAdmin: boolean
  /** Effective authority (the viewed role under view-as). */
  permissions: Record<string, PermissionState>
  limits: Partial<Record<MoneyKind, number | null>>
  rbacVersion: number
  prefs: { theme: Theme | null }
  viewAs: {
    active: boolean
    canViewAs: boolean
    roleId: string | null
    roleName: string | null
    options: ViewAsOption[]
  }
  csrfToken: string
  expiresAt: string
  serverTime: string
  businessTz: string
  /** Dev-only affordances ("Simulate arrival"); false unless the server says so. */
  devTools: boolean
}

export interface ServerClockInfo {
  serverTime: string
  businessTz: string
}

export function toSession(me: MeResponse, clock: ServerClockInfo): Session {
  return {
    user: {
      id: me.user.id,
      employeeId: me.employee.id,
      email: me.user.email,
      name: me.employee.name,
      initials: me.employee.initials,
      title: me.employee.title,
    },
    roles: me.roles,
    roleTitle: me.displayRole,
    isSuperAdmin: me.isSuperAdmin,
    permissions: me.permissions,
    limits: me.limits,
    rbacVersion: me.rbacVersion,
    prefs: { theme: me.preferences.theme },
    viewAs: me.viewAs,
    csrfToken: me.csrfToken,
    expiresAt: me.session.expiresAt,
    serverTime: clock.serverTime,
    businessTz: clock.businessTz || DEFAULT_TZ,
    devTools: me.config?.devTools === true,
  }
}

/** A granting role with no stored limit counts as $25 (backend: "no row = $25"). */
export const DEFAULT_LIMIT_CENTS = 2500

type Grants = Pick<Session, 'permissions' | 'limits'>

/** True when the effective authority includes the permission. UI gating only; the server enforces everything. */
export const can = (s: Pick<Session, 'permissions'> | null | undefined, key: PermissionKey): boolean =>
  s?.permissions[key]?.on === true

/**
 * The per-transaction money limit for refund / adjust / credit: `has` = the permission is on, `maxCents` = the cap
 * (Infinity when there is no limit). Mirrors Payments lim(): null means unlimited, a missing value means the default.
 */
export function limit(s: Grants | null | undefined, kind: MoneyKind): { has: boolean; maxCents: number } {
  const key = (Object.keys(LIMITED_PERMISSIONS) as LimitedPermission[]).find(
    (k) => LIMITED_PERMISSIONS[k] === kind,
  )!
  const perm = s?.permissions[key]
  if (!perm?.on) return { has: false, maxCents: 0 }
  const v = perm.limit !== undefined ? perm.limit : s?.limits[kind]
  if (v === null) return { has: true, maxCents: Infinity }
  return { has: true, maxCents: v === undefined ? DEFAULT_LIMIT_CENTS : v }
}

/** has the permission and the amount is within the limit (Payments canApprove). */
export const withinLimit = (s: Grants | null | undefined, kind: MoneyKind, amountCents: number): boolean => {
  const l = limit(s, kind)
  return l.has && amountCents <= l.maxCents
}
