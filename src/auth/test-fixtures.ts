// Fixtures for tests: a /me payload and the Session built from it.
import type { MeResponse } from '@/data/http/auth-types'
import { DEFAULT_ROLE_GRANTS, LIMITED_PERMISSIONS, PERMISSION_KEYS } from './permissions'
import { toSession } from './session-model'
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
