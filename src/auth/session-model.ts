// The normalised session the app works with, built from GET /me (+ GET /meta/now for the server clock when /me does
// not carry it), or for an unlocked kiosk from GET /kiosk/me (ADR 0180), and the permission helpers `can()` / `limit()`.
import type {
  KioskMe,
  KioskPerson,
  MeResponse,
  MoneyKind,
  PermissionState,
  Theme,
  ViewAsOption,
} from '@/data/http/auth-types'
import { DEFAULT_TZ } from '@/lib/tz'
import { LIMITED_PERMISSIONS } from './permissions'
import type { LimitedPermission, PermissionKey } from './permissions'

/** The unlocked kiosk behind a kiosk session (GET /kiosk/me). */
export interface KioskInfo {
  deviceId: string
  deviceName: string
  unlockedAt: string
  locksAt: string
  /** "9:00 PM" (the server's words, in the shop's time zone). */
  locksAtLabel: string
  rule: KioskMe['lock']['rule']
  /** The employee picker: bay staff first, then by first name. */
  staff: KioskPerson[]
}

export interface Session {
  /** 'kiosk': the shop's unlocked tablet (no person signed in; every write names the employee who taps). */
  kind: 'user' | 'kiosk'
  /** Set for a kiosk session only. */
  kiosk: KioskInfo | null
  /** A person signed in on a registered kiosk device (the short session of ADR 0180, with a bar); null elsewhere. */
  kioskDevice: { id: string; name: string } | null
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
    kind: 'user',
    kiosk: null,
    kioskDevice: me.kioskDevice ?? null,
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

/**
 * The session of an unlocked kiosk: a synthetic user named after the device (initials "K"), the kiosk's permission set
 * (never a role, never assignable), no money limits, no view-as, and the lock time as its end.
 */
export function toKioskSession(me: KioskMe): Session {
  return {
    kind: 'kiosk',
    kiosk: {
      deviceId: me.device.id,
      deviceName: me.device.name,
      unlockedAt: me.lock.unlockedAt,
      locksAt: me.lock.locksAt,
      locksAtLabel: me.lock.locksAtLabel,
      rule: me.lock.rule,
      staff: me.staff,
    },
    kioskDevice: null,
    user: { id: '', employeeId: '', email: '', name: me.device.name, initials: 'K', title: 'Kiosk' },
    roles: [{ id: 'kiosk', key: 'kiosk', name: 'Kiosk' }],
    roleTitle: 'Kiosk',
    isSuperAdmin: false,
    permissions: me.permissions,
    limits: {},
    rbacVersion: 0,
    prefs: { theme: null },
    viewAs: { active: false, canViewAs: false, roleId: null, roleName: null, options: [] },
    csrfToken: me.csrfToken,
    expiresAt: me.lock.locksAt,
    serverTime: me.serverTime,
    businessTz: me.businessTz || DEFAULT_TZ,
    devTools: false,
  }
}

/** The shop's unlocked kiosk (not a signed-in person). */
export const isKiosk = (s: Pick<Session, 'kind'> | null | undefined): boolean => s?.kind === 'kiosk'

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
