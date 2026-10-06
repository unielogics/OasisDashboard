// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// The pure Settings helpers against the ORIGINAL class's methods (evaluated from design/extracted).
import { beforeAll, describe, expect, it } from 'vitest'
import { loadLogic } from '@/dc/loadLogic'
import { originalSource, seeded } from '@/screens/settings/testkit'
import {
  ALL_PERMS,
  PERMS,
  effective,
  limLabel,
  limKey,
  step,
  untilText,
  renderPreview,
  hoursText,
  dayLength,
  nextLimit,
  LIMITS,
  withPermission,
  withLimit,
} from './index'
import type { RolesConfig } from './index'

beforeAll(() => {
  process.env.TZ = 'America/New_York'
})

const original = (): any => {
  const Orig = loadLogic(originalSource, 'settings')
  return new Orig({}) as any
}

describe('constants', () => {
  it('match the original lists', () => {
    const o = original()
    expect([...o.DAYS]).toEqual([
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ])
    expect([...o.ORDER]).toEqual([1, 2, 3, 4, 5, 6, 0])
    expect(o.LIMITS).toEqual([...LIMITS])
    expect(o.PERMS).toEqual(JSON.parse(JSON.stringify(PERMS)))
    expect(ALL_PERMS.length).toBe(27)
  })
})

describe('eff() on random role configs', () => {
  it('matches the original for 3000 random people on random configs, holes and nulls included', () => {
    const o = original()
    const rnd = seeded(7)
    const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)]!
    for (let n = 0; n < 150; n++) {
      const roleIds = ['a', 'b', 'c', 'd']
      const rc: RolesConfig = {
        roles: roleIds.map((id) => ({ id, name: 'Role ' + id, desc: '' })),
        perms: {},
        limits: {},
      }
      for (const id of roleIds) {
        if (rnd() < 0.9) rc.perms[id] = Object.fromEntries(ALL_PERMS.map((p) => [p, rnd() < 0.4]))
        if (rnd() < 0.85)
          rc.limits[id] = {
            refund: pick([25, 50, 100, 250, 500, 1000, null, undefined] as any),
            adjust: pick([25, 50, null, undefined] as any),
            credit: pick([25, 1000, null, undefined] as any),
          }
      }
      o.state.rc = rc
      for (let k = 0; k < 20; k++) {
        const roles = roleIds.filter(() => rnd() < 0.5).concat(rnd() < 0.1 ? ['ghost'] : [])
        const overrides: Record<string, string> = {}
        for (const p of ALL_PERMS) if (rnd() < 0.05) overrides[p] = pick(['allow', 'deny'])
        const e = { roles, overrides }
        for (const p of ALL_PERMS) {
          const a = effective(rc, e as any, p)
          const b = o.eff(e, p)
          expect(a).toEqual(b)
        }
      }
    }
  })
})

describe('formatters', () => {
  it('step, limLabel, limKey, hoursText and dayLength match', () => {
    const o = original()
    for (const t of ['5:00 AM', '12:00 AM', '12:30 PM', '11:30 PM', '9:00 am', '1:05 pm'])
      for (let d = -50; d <= 50; d += 7) expect(step(t, d)).toBe(o.step(t, d))
    for (const v of [null, 0, 25, 1000, 12345, 1e6, 0.5]) expect(limLabel(v)).toBe(o.limLabel(v))
    expect(limKey('pay.refund')).toBe(o.limKey('pay.refund'))
    for (const m of [0, 30, 360, 600, 630, 65 * 60, 1]) expect(hoursText(m)).toBe(m / 60 + ' hrs')
    expect(dayLength({ open: false, from: '9:00 AM', to: '5:00 PM' })).toBe(0)
    expect(dayLength({ open: true, from: '5:00 PM', to: '9:00 AM' })).toBe(0)
    expect(dayLength({ open: true, from: '8:00 AM', to: '6:30 PM' })).toBe(630)
  })

  it('untilText and renderPreview match the original rendering for every duration, reason and date', () => {
    const o = original()
    const reasons = [
      'Severe weather',
      'Power outage',
      'Equipment failure',
      'Staff shortage',
      'Other',
      'Bogus',
    ]
    for (const reason of reasons)
      for (const dur of ['today', 'until', 'days'] as const)
        for (const through of ['2026-06-15', '2026-12-31', '', 'nope'])
          for (const until of ['2:00 PM', '11:30 PM']) {
            const em = {
              ...o.state.em,
              reason,
              dur,
              through,
              until,
              msg: 'Hi {first}, {reason} {until} {link} {first} {x}',
            }
            o.state = { ...o.state, em, section: 'emergency' }
            const vals = o.renderVals()
            expect(renderPreview(em, { first: 'Liam', link: 'oasis.spa/r/8KQ2' })).toBe(vals.emPreview)
            expect(vals.confirmText).toContain(untilText(em))
          }
  })
})

describe('role edits', () => {
  it('nextLimit cycles the chips and wraps; a missing or odd value counts as 25', () => {
    const o = original()
    for (const cur of [25, 50, 100, 250, 500, 1000, null, undefined, 77]) {
      o.state.rc = JSON.parse(JSON.stringify(o.state.rc))
      o.state.rc.limits.crew = cur === undefined ? {} : { refund: cur }
      const lims = o.LIMITS
      const expected = lims[(lims.indexOf(cur === undefined ? 25 : cur) + 1) % lims.length]
      expect(nextLimit(cur as any)).toBe(expected)
    }
  })

  it('withPermission and withLimit leave the input untouched', () => {
    const o = original()
    const rc: RolesConfig = JSON.parse(JSON.stringify(o.state.rc))
    const frozen = JSON.stringify(rc)
    const a = withPermission(rc, 'crew', 'pay.refund', true)
    const b = withLimit(rc, 'crew', 'refund', 1000)
    expect(JSON.stringify(rc)).toBe(frozen)
    expect(a.perms.crew!['pay.refund']).toBe(true)
    expect(b.limits.crew!.refund).toBe(1000)
  })
})
