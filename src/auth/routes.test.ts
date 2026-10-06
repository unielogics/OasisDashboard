import { describe, expect, it } from 'vitest'
import { ROUTE_ACCESS, canOpen, lockedText, openableScreens, ruleFor } from './routes'
import { PERMISSION_KEYS, PERMISSION_LABELS } from './permissions'
import { makeMe, makeSession } from './test-fixtures'

describe('route access', () => {
  it('knows the three screens and nothing else', () => {
    expect(ROUTE_ACCESS.map((r) => r.path)).toEqual(['/operations', '/payments', '/settings'])
    expect(ruleFor('/payments')!.named).toBe('pay.reports')
    expect(ruleFor('/settings/x')!.path).toBe('/settings')
    expect(ruleFor('/login')).toBeUndefined()
    expect(ruleFor('/paymentsx')).toBeUndefined()
  })
  it('default roles: Crew can open Operations only; Accounting opens Payments but not Operations settings', () => {
    const open = (role: Parameters<typeof makeSession>[0]) =>
      openableScreens(makeSession(role)).map((r) => r.nav)
    expect(open({ role: 'super' })).toEqual(['Operations', 'Payments', 'Settings'])
    expect(open({ role: 'mgmt' })).toEqual(['Operations', 'Payments', 'Settings'])
    expect(open({ role: 'crew' })).toEqual(['Operations'])
    expect(open({ role: 'support' })).toEqual(['Operations', 'Settings']) // Support keeps the design: no pay.reports, so no Payments
    expect(open({ role: 'acct' })).toEqual(['Operations', 'Payments', 'Settings'])
  })
  it('Settings opens for any one team, settings or membership permission', () => {
    const only = (key: string) => {
      const me = makeMe({ role: 'crew' })
      me.permissions = { ...me.permissions, [key]: { on: true } }
      return canOpen(makeSession({ role: 'crew', permissions: me.permissions }), ruleFor('/settings')!)
    }
    for (const k of [
      'set.hours',
      'set.emergency',
      'set.services',
      'team.view',
      'team.edit',
      'team.roles',
      'cli.member',
      'set.billing',
    ])
      expect(only(k), k).toBe(true)
    for (const k of ['sched.edit', 'pay.reports', 'msg.send']) expect(only(k), k).toBe(false)
  })
  it('uses the design card text with the role title', () => {
    expect(lockedText('Crew', ruleFor('/payments')!)).toBe(
      'The Crew role doesn\'t include "View payment reports". A Super Admin can grant it in Settings.',
    )
  })
  it('has a design label for every permission key', () => {
    for (const k of PERMISSION_KEYS) expect(PERMISSION_LABELS[k], k).toBeTruthy()
    expect(Object.keys(PERMISSION_LABELS)).toHaveLength(27)
  })
})
