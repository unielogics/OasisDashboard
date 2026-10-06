// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// Function-level differential tests: each pure helper in src/lib/operations against the matching method of the ORIGINAL
// Operations class, on many generated inputs. (Logic.diff.test.ts compares whole renderVals() runs.)
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  ADDONS,
  ADDON_TASKS,
  DEF_CLOSURES,
  DEF_HOURS,
  HIST,
  POOL_NAMES,
  POOL_VEH,
  SERVICES,
} from '@/screens/operations/fixtures'
import { OriginalClass } from '@/screens/operations/testkit'
import {
  balance,
  buildActivity,
  checklistFor,
  checklistProgress,
  countFor,
  dayCount,
  generateDay,
  hintFor,
  infoFor,
  initChecks,
  memberMeta,
  nextStep,
  ORDER,
  total,
} from './index'
import type { ApptStatus } from './types'

let ops: any
beforeAll(() => {
  process.env.TZ = 'America/New_York'
  vi.useFakeTimers({ now: new Date('2026-06-13T10:36:00-04:00') })
  localStorage.clear()
  const Original = OriginalClass()
  ops = new Original({})
})
afterAll(() => vi.useRealTimers())

/** Deterministic pseudo-random sequence (mulberry32) so a failure reproduces. */
function seq(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!

const STATUSES: ApptStatus[] = [
  'booked',
  'confirmed',
  'arrived',
  'cleaning',
  'completed',
  'canceled',
  'noshow',
  'ready',
  'paid',
]
const PAYS = ['paid', 'deposit', 'unpaid'] as const
const MEMBERS = [
  null,
  'Essential',
  'Premium',
  'Premium Care',
  'Executive',
  'Exotic',
  'Gold',
  'constructor ' + 'x',
]
const PRICES = [0, 1, 10, 12.5, 45, 95, 129, 139, 180, 260, 320, 420, 650, 33.33, 0.1 + 0.2, 99.99]

function randomPriced(r: () => number) {
  const n = Math.floor(r() * 4)
  return {
    price: pick(r, PRICES),
    addons: Array.from({ length: n }, (_, i) => ({ name: 'x' + i, price: pick(r, PRICES) })),
    member: pick(r, MEMBERS),
    tip: pick(r, [0, 0, 5, 8, 20, 2.5, undefined as unknown as number]),
    pay: pick(r, PAYS),
    deposit: pick(r, [0, 20, 50, 1000, undefined as unknown as number]),
    status: pick(r, STATUSES),
  }
}

describe('pricing and flow against the original', () => {
  it('total and balance on 5,000 random appointments (floats, no tip, big deposits)', () => {
    const r = seq(7)
    for (let i = 0; i < 5000; i++) {
      const a = randomPriced(r)
      expect(total(a as any)).toEqual(ops.total(a))
      expect(balance(a as any)).toEqual(ops.balance(a))
    }
  })

  it('nextStep, hintFor for every status and payment state', () => {
    const r = seq(11)
    for (let i = 0; i < 2000; i++) {
      const a = randomPriced(r)
      const mine = nextStep(a as any)
      expect(mine).toEqual(ops.nextStep(a))
      if (mine) expect(hintFor(a as any, mine)).toEqual(ops.hintFor(a, mine))
    }
  })

  it('memberMeta for plan names (prototype keys are the one deliberate difference)', () => {
    for (const m of [
      null,
      '',
      'Essential',
      'Premium Care',
      'Executive',
      'Exotic',
      'Exotic Plus',
      'Gold',
      'x',
    ])
      expect(memberMeta(m)).toEqual(ops.memberMeta(m))
    expect(memberMeta('constructor')).toEqual({ c: '#8A6D3B', bg: '#F2E9D6' })
    expect(typeof ops.memberMeta('constructor')).toBe('function')
  })
})

describe('checklists against the original', () => {
  const names = Object.keys(SERVICES)
  const addonNames = ADDONS.map((a) => a[0])
  const catalog = () => ({ services: ops.SERVICES, addonTasks: ops.ADDON_TASKS })

  it('sections and keys for every package with random add-ons (objects, strings, unknown names)', () => {
    const r = seq(3)
    for (const svc of [...names, 'Not a package']) {
      for (let i = 0; i < 40; i++) {
        const picks = Array.from({ length: Math.floor(r() * 4) }, () =>
          pick(r, [...addonNames, 'Mystery add-on']),
        )
        const asObjects = picks.map((name) => ({ name, price: 1 }))
        const addons = r() < 0.5 ? asObjects : picks
        const a = { svc, addons }
        const { services, addonTasks } = catalog()
        expect(checklistFor(a, services, addonTasks)).toEqual(ops.checklistFor(a))
        for (const fr of [0, 0.25, 0.333, 0.5, 0.75, 1])
          expect(initChecks(svc, addons, fr, services, addonTasks)).toEqual(ops.initChecks(svc, addons, fr))
      }
    }
    expect(Object.keys(ADDON_TASKS)).toEqual(addonNames)
  })

  it('progress counts', () => {
    const r = seq(5)
    for (let i = 0; i < 300; i++) {
      const svc = pick(r, names)
      const addons = [{ name: pick(r, addonNames), price: 1 }]
      const { services, addonTasks } = catalog()
      const secs = checklistFor({ svc, addons }, services, addonTasks)
      const checks = initChecks(svc, addons, r(), services, addonTasks)
      const p = checklistProgress(secs, checks)
      const ck = ops.checkVM({ id: 'x', svc, addons, checks })
      expect([p.done, p.total, p.pct + '%', p.allDone ? 'Clear all' : 'Check all']).toEqual([
        ck.checkDone,
        ck.checkTotal,
        ck.checkPct,
        ck.checkAllLabel,
      ])
    }
  })
})

describe('activity against the original', () => {
  it('the lazily built thread and log for every status, duration and start time', () => {
    for (const status of [...STATUSES, 'weird' as ApptStatus]) {
      for (const dur of [35, 50, 75, 90, 120, 150, 5]) {
        for (const time of ['8:30 AM', '11:45 PM', '12:00 AM', '12:00 PM', '11:59 PM']) {
          const a = {
            status,
            dur,
            time,
            veh: { make: 'Audi' },
            cust: { name: 'Maria Delgado' },
            messages: null,
            log: null,
          }
          const mine = buildActivity(a as any, ORDER)
          const theirs = ops.ensureActivity({ ...a })
          expect(mine.messages).toEqual(theirs.messages)
          expect(mine.log).toEqual(theirs.log)
        }
      }
    }
  })
})

describe('calendar against the original', () => {
  const baseCivil = { y: 2026, m: 5, d: 13 }
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
  const cat = () => ({ services: ops.SERVICES, addons: ops.ADDONS, addonTasks: ops.ADDON_TASKS })

  function withSettings(hours: any, closures: any, fn: () => void) {
    const prev = [ops.state.hours, ops.state.closures]
    ops.state.hours = hours
    ops.state.closures = closures
    ops._gen = {}
    try {
      fn()
    } finally {
      ;[ops.state.hours, ops.state.closures] = prev
      ops._gen = {}
    }
  }

  const randomSettings = (r: () => number) => {
    const hours = [0, 1, 2, 3, 4, 5, 6].map(() =>
      r() < 0.25
        ? { open: false, from: '9:00 AM', to: '3:00 PM' }
        : {
            open: true,
            from: pick(r, ['6:00 AM', '7:30 AM', '8:00 AM', '9:15 AM']),
            to: pick(r, ['1:15 PM', '5:00 PM', '6:45 PM', '8:00 PM']),
          },
    )
    const closures = range(0, 3).map(() => {
      const off = Math.floor(r() * 120) - 20
      const d = new Date(2026, 5, 13 + off)
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      return r() < 0.5
        ? { date, name: 'Closed ' + off, type: 'closed' }
        : {
            date,
            name: 'Short ' + off,
            type: 'reduced',
            from: pick(r, ['9:00 AM', '10:00 AM', '12:00 PM']),
            to: pick(r, ['1:00 PM', '3:30 PM', '7:00 PM']),
          }
    })
    return { hours, closures }
  }

  it('dayInfo and day counts for 700 days with the default settings and with random ones', () => {
    const r = seq(21)
    const sets = [{ hours: DEF_HOURS, closures: DEF_CLOSURES }, ...range(1, 12).map(() => randomSettings(r))]
    for (const sch of sets) {
      withSettings(sch.hours, sch.closures, () => {
        for (const o of range(-350, 350)) {
          const d = ops.dateFor(o)
          const inf = infoFor(d, sch as any)
          expect(inf).toEqual(ops.dayInfo(d))
          const fresh = { hours: sch.hours, closures: sch.closures }
          expect(inf).toEqual(infoFor(d, fresh as any))
          if (!inf.closed) {
            const theirs = ops.dayCount(o, ops.dayInfo(d))
            const mine = dayCount(o, !!inf.note, baseCivil)
            expect(mine.n).toBe(theirs.n)
            expect([mine.rnd(), mine.rnd()]).toEqual([theirs.rnd(), theirs.rnd()])
          }
        }
      })
    }
  })

  it('generated days (every field of every appointment) for 400 offsets and 6 settings', () => {
    const r = seq(33)
    const pools = { names: POOL_NAMES, vehicles: POOL_VEH }
    const sets = [{ hours: DEF_HOURS, closures: DEF_CLOSURES }, ...range(1, 5).map(() => randomSettings(r))]
    for (const sch of sets) {
      withSettings(sch.hours, sch.closures, () => {
        for (const o of range(-200, 200)) {
          const mine = generateDay(o, baseCivil, sch as any, cat(), pools, HIST)
          const theirs = ops.genDay(o).filter((a: any) => (o === 1 ? a.id.startsWith('g') : true))
          expect(mine).toEqual(theirs)
        }
      })
    }
  })

  it('countFor equals the original for every offset, with and without a changed schedule', () => {
    const r = seq(77)
    const sets = [{ hours: DEF_HOURS, closures: DEF_CLOSURES }, ...range(1, 4).map(() => randomSettings(r))]
    for (const sch of sets) {
      withSettings(sch.hours, sch.closures, () => {
        for (const o of range(-100, 100)) {
          expect(countFor(o, ops.state.appts, baseCivil, sch as any)).toEqual(ops.countFor(o))
        }
      })
    }
  })
})
