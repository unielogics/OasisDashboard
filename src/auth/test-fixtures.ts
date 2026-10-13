// Fixtures for tests: a /me payload and the Session built from it.
import type { KioskMe, MeResponse } from '@/data/http/auth-types'
import { DEFAULT_ROLE_GRANTS, LIMITED_PERMISSIONS, PERMISSION_KEYS } from './permissions'
import { toKioskSession, toSession } from './session-model'
import type { Session } from './session-model'

export const SUPER_OPTIONS: MeResponse['viewAs']['options'] = [
  {
    id: 'role-super',
    key: 'super',
    name: 'Super Admin',
    locked: true,
    limits: { refund: null, adjust: null, credit: null },
  },
  {
    id: 'role-mgmt',
    key: 'mgmt',
    name: 'Management',
    locked: false,
    limits: { refund: 100000, adjust: 50000, credit: 50000 },
  },
  {
    id: 'role-crew',
    key: 'crew',
    name: 'Crew',
    locked: false,
    limits: { refund: 2500, adjust: 2500, credit: 2500 },
  },
]

export function makeMe(
  over: Partial<MeResponse> & { role?: keyof typeof DEFAULT_ROLE_GRANTS } = {},
): MeResponse {
  const { role = 'mgmt', ...rest } = over
  const granted = new Set<string>(DEFAULT_ROLE_GRANTS[role])
  const permissions: MeResponse['permissions'] = {}
  const limits: MeResponse['limits'] = {}
  for (const k of PERMISSION_KEYS) {
    if (!granted.has(k)) {
      permissions[k] = { on: false }
      continue
    }
    const kind = (LIMITED_PERMISSIONS as Record<string, 'refund' | 'adjust' | 'credit'>)[k]
    if (kind) {
      const v = role === 'super' ? null : 50000
      permissions[k] = { on: true, limit: v }
      limits[kind] = v
    } else permissions[k] = { on: true }
  }
  return {
    user: { id: 'user-1', email: 'rafael@oasis.test' },
    employee: {
      id: 'emp-1',
      first: 'Rafael',
      last: 'Mendes',
      name: 'Rafael Mendes',
      initials: 'RM',
      title: 'General Manager',
      phone: '(305) 555-0140',
      email: 'rafael@oasis.test',
      avatarColor: null,
    },
    roles: [{ id: `role-${role}`, key: role, name: role === 'super' ? 'Super Admin' : 'Management' }],
    displayRole: role === 'super' ? 'Super Admin' : 'Management',
    isSuperAdmin: role === 'super',
    permissions,
    limits,
    rbacVersion: 1,
    preferences: { theme: null },
    viewAs: {
      active: false,
      canViewAs: role === 'super',
      roleId: null,
      roleName: null,
      options: role === 'super' ? SUPER_OPTIONS : [],
    },
    csrfToken: 'csrf-token-1',
    session: { expiresAt: '2026-06-27T10:36:00.000Z' },
    ...rest,
  }
}

export const makeSession = (
  over: Parameters<typeof makeMe>[0] = {},
  clock = { serverTime: '2026-06-13T14:36:00.000Z', businessTz: 'America/New_York' },
): Session => toSession(makeMe(over), clock)

/** The kiosk's permission set (backend KIOSK_PERMISSIONS, api-spec 31.1). */
export const KIOSK_KEYS = [
  'sched.view',
  'sched.edit',
  'jobs.status',
  'jobs.checklist',
  'cli.view',
  'cli.contact',
  'pay.collect',
  'msg.send',
] as const

export const KIOSK_STAFF: KioskMe['staff'] = [
  {
    id: 'emp-marco',
    name: 'Marco R.',
    first: 'Marco',
    initials: 'MR',
    avatarColor: '#2563EB',
    title: 'Detailer',
    bayStaff: true,
  },
  {
    id: 'emp-lena',
    name: 'Lena K.',
    first: 'Lena',
    initials: 'LK',
    avatarColor: null,
    title: 'Detailer',
    bayStaff: true,
  },
  {
    id: 'emp-sofia',
    name: 'Sofia P.',
    first: 'Sofia',
    initials: 'SP',
    avatarColor: '#7A3B8A',
    title: 'Front desk',
    bayStaff: false,
  },
]

/** A GET /kiosk/me answer: Front desk tablet, unlocked 7:58 AM, locks 9:00 PM (New York, June 13 2026). */
export function makeKioskMe(over: Partial<KioskMe> = {}): KioskMe {
  const permissions: KioskMe['permissions'] = {}
  for (const k of PERMISSION_KEYS) permissions[k] = { on: (KIOSK_KEYS as readonly string[]).includes(k) }
  return {
    kind: 'kiosk',
    device: { id: 'dev-1', name: 'Front desk tablet' },
    lock: {
      unlockedAt: '2026-06-13T11:58:00.000Z',
      locksAt: '2026-06-14T01:00:00.000Z',
      locksAtLabel: '9:00 PM',
      rule: 'closing',
    },
    permissions,
    limits: {},
    csrfToken: 'kiosk-csrf-1',
    staff: KIOSK_STAFF,
    businessTz: 'America/New_York',
    serverTime: '2026-06-13T14:36:00.000Z',
    ...over,
  }
}

export const makeKioskSession = (over: Partial<KioskMe> = {}): Session => toKioskSession(makeKioskMe(over))
