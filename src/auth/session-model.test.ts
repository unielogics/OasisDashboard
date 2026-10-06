import { describe, expect, it } from 'vitest'
import { PERMISSION_KEYS, DEFAULT_ROLE_GRANTS, deniedTitle } from './permissions'
import { DEFAULT_LIMIT_CENTS, can, limit, toSession, withinLimit } from './session-model'
import { makeMe, makeSession } from './test-fixtures'

describe('Session from /me', () => {
  it('normalises the payload: user, role title, prefs, view-as, clock', () => {
    const s = makeSession(
      { role: 'super' },
      { serverTime: '2026-06-13T14:36:00.000Z', businessTz: 'America/New_York' },
    )
    expect(s.user).toMatchObject({
      id: 'user-1',
      employeeId: 'emp-1',
      email: 'rafael@oasis.test',
      name: 'Rafael Mendes',
      initials: 'RM',
    })
    expect(s.roleTitle).toBe('Super Admin')
    expect(s.isSuperAdmin).toBe(true)
    expect(s.viewAs.canViewAs).toBe(true)
    expect(s.prefs.theme).toBeNull()
    expect(s.csrfToken).toBe('csrf-token-1')
    expect(s.serverTime).toBe('2026-06-13T14:36:00.000Z')
    expect(s.businessTz).toBe('America/New_York')
  })
  it('defaults the business timezone when the server sent none', () => {
    expect(toSession(makeMe(), { serverTime: 'x', businessTz: '' }).businessTz).toBe('America/New_York')
  })
  it('exposes canViewAs separately from the effective authority (the view-as trap)', () => {
    const viewing = makeSession({
      role: 'super',
      roles: [{ id: 'role-crew', key: 'crew', name: 'Crew' }],
      displayRole: 'Crew',
      permissions: makeMe({ role: 'crew' }).permissions,
      viewAs: { active: true, canViewAs: true, roleId: 'role-crew', roleName: 'Crew', options: [] },
    })
    expect(viewing.viewAs.canViewAs).toBe(true)
    expect(can(viewing, 'pay.refund')).toBe(false)
    expect(can(viewing, 'sched.view')).toBe(true)
  })
})

describe('can()', () => {
  it('is true only for keys that are on; unknown, off and a missing session are false', () => {
    const s = makeSession({ role: 'crew' })
    expect(can(s, 'jobs.status')).toBe(true)
    expect(can(s, 'pay.reports')).toBe(false)
    expect(can(null, 'sched.view')).toBe(false)
    expect(can(undefined, 'sched.view')).toBe(false)
    expect(can({ permissions: {} }, 'sched.view')).toBe(false)
  })
  it('every default role grants exactly its keys (27 keys in total)', () => {
    expect(PERMISSION_KEYS).toHaveLength(27)
    expect(new Set(PERMISSION_KEYS).size).toBe(27)
    for (const role of Object.keys(DEFAULT_ROLE_GRANTS) as Array<keyof typeof DEFAULT_ROLE_GRANTS>) {
      const s = makeSession({ role })
      for (const k of PERMISSION_KEYS)
        expect(can(s, k), `${role} ${k}`).toBe(DEFAULT_ROLE_GRANTS[role].includes(k))
    }
  })
})

describe('limit() mirrors Payments lim()', () => {
  it('null is unlimited, a number is the cap in cents, a missing value is $25, a permission that is off has none', () => {
    const g = (p: Record<string, { on: boolean; limit?: number | null }>, limits = {}) => ({
      permissions: p,
      limits,
    })
    expect(limit(g({ 'pay.refund': { on: true, limit: null } }), 'refund')).toEqual({
      has: true,
      maxCents: Infinity,
    })
    expect(limit(g({ 'pay.refund': { on: true, limit: 100000 } }), 'refund')).toEqual({
      has: true,
      maxCents: 100000,
    })
    expect(limit(g({ 'pay.adjust': { on: true } }), 'adjust')).toEqual({
      has: true,
      maxCents: DEFAULT_LIMIT_CENTS,
    })
    expect(DEFAULT_LIMIT_CENTS).toBe(2500)
    expect(limit(g({ 'pay.credit': { on: false } }), 'credit')).toEqual({ has: false, maxCents: 0 })
    expect(limit(g({}), 'refund')).toEqual({ has: false, maxCents: 0 })
    expect(limit(null, 'refund')).toEqual({ has: false, maxCents: 0 })
  })
  it('falls back to the limits map when the permission entry carries no limit', () => {
    expect(
      limit({ permissions: { 'pay.refund': { on: true } }, limits: { refund: 7500 } }, 'refund').maxCents,
    ).toBe(7500)
    expect(
      limit({ permissions: { 'pay.refund': { on: true } }, limits: { refund: null } }, 'refund').maxCents,
    ).toBe(Infinity)
  })
  it('withinLimit is inclusive at the boundary and in cents (no 100x slip)', () => {
    const s = makeSession({ role: 'mgmt' }) // 50000 cents = $500
    expect(withinLimit(s, 'refund', 50000)).toBe(true)
    expect(withinLimit(s, 'refund', 50001)).toBe(false)
    expect(withinLimit(s, 'refund', 500)).toBe(true)
    expect(withinLimit(makeSession({ role: 'super' }), 'refund', 10_000_000)).toBe(true)
    expect(withinLimit(makeSession({ role: 'crew' }), 'refund', 1)).toBe(false) // crew cannot refund at all
  })
})

describe('deniedTitle', () => {
  it('has wording for all 27 keys, with the typographic apostrophe', () => {
    for (const k of PERMISSION_KEYS) {
      const t = deniedTitle(k)
      expect(t, k).toMatch(/^Your role can’t \S+/)
      expect(t).not.toContain("'")
    }
    expect(deniedTitle('pay.collect')).toBe('Your role can’t collect payments')
    expect(deniedTitle('nope')).toBe('Your role can’t do that')
  })
})
