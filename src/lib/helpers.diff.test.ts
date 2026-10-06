// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// Differential tests: every pure helper in src/lib is run against the ORIGINAL class method from
// design/extracted/<screen>/logic.original.js (evaluated by the same loader the screens use) on a broad input set.
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadLogic } from '@/dc/loadLogic'
import { businessClock } from './tz'
import {
  calLabel,
  dateFor,
  dayCount,
  dayInfo,
  employeeStatusLabel,
  employeeStatusStyle,
  fmtDateOffset,
  fmtT,
  fmtTRaw,
  hexA,
  invoicePill,
  iso,
  lighten,
  clockLabel,
  moneyCents,
  moneyWhole,
  moneyWhole0,
  offFor,
  parseT,
  r2,
  rng,
  statusMeta,
  todayStamp,
} from './index'

const root = path.resolve(__dirname, '..', '..')
const originals: Record<string, string> = {}
const load = (screen: 'operations' | 'payments' | 'settings'): any => {
  originals[screen] ??= fs.readFileSync(
    path.join(root, 'design/extracted', screen, 'logic.original.js'),
    'utf8',
  )
  const Logic = loadLogic(originals[screen]!, screen)
  return new Logic({})
}

let ops: any
let pay: any
let set: any

beforeAll(() => {
  process.env.TZ = 'America/New_York'
  vi.useFakeTimers({ now: new Date('2026-06-13T10:36:00-04:00') })
  ops = load('operations')
  pay = load('payments')
  set = load('settings')
})
afterAll(() => vi.useRealTimers())

/** Deterministic pseudo-random sequence (mulberry32) so failures reproduce. */
function seq(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

const numbers = (): number[] => {
  const base = [
    0,
    -0,
    0.4,
    0.5,
    0.49999,
    0.505,
    0.995,
    1,
    1.005,
    1.5,
    2.5,
    2.675,
    9.995,
    10,
    12.345,
    38,
    38.5,
    99.99,
    100.004,
    148,
    1234.5,
    1234.56,
    12345.678,
    999999.995,
    1e6,
    1e6 + 0.5,
    123456789.987,
    1e15,
    -0.4,
    -0.5,
    -0.004,
    -0.005,
    -0.006,
    -1,
    -1.005,
    -2.5,
    -38.5,
    -99.99,
    -1234.567,
    -1e6,
    -123456789.987,
    NaN,
    Infinity,
    -Infinity,
  ]
  const rnd = seq(20260613)
  const out = [...base]
  for (let i = 0; i < 1500; i++) {
    const mag = [1, 10, 100, 1000, 100000][i % 5]!
    const v = (rnd() * 2 - 1) * mag
    out.push(v, Math.round(v * 100) / 100, Math.round(v * 2) / 2)
  }
  return out
}

describe('money', () => {
  const nums = numbers()
  it('moneyWhole === Operations money()', () => {
    for (const n of nums) expect(moneyWhole(n), String(n)).toBe(ops.money(n))
  })
  it('r2 === Payments r2()', () => {
    for (const n of nums) expect(Object.is(r2(n), pay.r2(n)), String(n)).toBe(true)
  })
  it('moneyCents === Payments money() (U+2212 minus)', () => {
    for (const n of nums) expect(moneyCents(n), String(n)).toBe(pay.money(n))
    expect(moneyCents(-12.5)).toBe('−$12.50')
    expect(moneyCents(-12.5)).not.toContain('-')
  })
  it('moneyWhole0 === Payments money0() (U+2212 minus)', () => {
    for (const n of nums) expect(moneyWhole0(n), String(n)).toBe(pay.money0(n))
    expect(moneyWhole0(-1234)).toBe('−$1,234')
  })
  it('Operations money() keeps the locale hyphen for negatives (replicated quirk)', () => {
    expect(moneyWhole(-5)).toBe('$-5')
  })
})

describe('time of day', () => {
  const texts = [
    '8:30 AM',
    '12:00 AM',
    '12:00 PM',
    '12:59 pm',
    '1:05PM',
    '11:59 PM',
    '0:00 AM',
    '13:00 PM',
    '9:00 am',
    '10:60 AM',
    ' 7:15  PM ',
    'open 8:00 AM',
    '8:00 AM to 6:00 PM',
    '12:30 am',
    '6:5 PM',
  ]
  for (let h = 1; h <= 12; h++)
    for (const m of [0, 5, 15, 30, 45, 59])
      for (const ap of ['AM', 'PM']) texts.push(`${h}:${String(m).padStart(2, '0')} ${ap}`)

  it('parseT === Operations and Settings parseT()', () => {
    for (const s of texts) {
      expect(parseT(s), s).toBe(ops.parseT(s))
      expect(parseT(s), s).toBe(set.parseT(s))
    }
  })
  it('parseT throws a TypeError on non-times, like the originals', () => {
    for (const s of ['', 'noon', '8 AM', '25']) {
      expect(() => ops.parseT(s), s).toThrow(TypeError)
      expect(() => parseT(s), s).toThrow(TypeError)
    }
  })
  it('fmtT === Operations fmtT() (wrapping), including out-of-range and fractional minutes', () => {
    const xs = [-2000, -1441, -1440, -1439, -61, -60, -1, 1439, 1440, 1441, 2880, 3000, 90.5, -90.5, 0.25]
    for (let i = 0; i < 1440; i++) xs.push(i)
    for (const x of xs) expect(fmtT(x), String(x)).toBe(ops.fmtT(x))
  })
  it('fmtTRaw === Settings fmtT() (no wrapping)', () => {
    const xs = [-2000, -61, -1, 1440, 1500, 2880, 90.5, -90.5, 0.25]
    for (let i = 0; i < 1440; i++) xs.push(i)
    for (const x of xs) expect(fmtTRaw(x), String(x)).toBe(set.fmtT(x))
  })
  it('parseT and fmtT round-trip every minute of the day', () => {
    for (let i = 0; i < 1440; i++) expect(parseT(fmtT(i))).toBe(i)
  })

  it('clockLabel / todayStamp === Operations nowClock() / Payments nowT() at many instants', () => {
    const rnd = seq(7)
    for (let i = 0; i < 400; i++) {
      const t = Date.UTC(2026, 0, 1) + Math.floor(rnd() * 365 * 86400000)
      vi.setSystemTime(t)
      const d = new Date()
      expect(clockLabel(d.getHours(), d.getMinutes()), String(t)).toBe(ops.nowClock())
      expect(todayStamp(d.getHours(), d.getMinutes()), String(t)).toBe(pay.nowT())
      // the Intl version in the business timezone agrees with the class running in TZ=America/New_York
      expect(businessClock(t, 'America/New_York'), String(t)).toBe(ops.nowClock())
    }
    vi.setSystemTime(new Date('2026-06-13T10:36:00-04:00'))
  })
})

describe('colour', () => {
  const hexes = [
    '#2563EB',
    '#0E9E6E',
    '#C2740B',
    '#7C3AED',
    '#6B7280',
    '#9F1239',
    '#B91C1C',
    '#000000',
    '#FFFFFF',
    '#0e7a63',
    '2563EB',
    '#abcdef',
    '#012345',
  ]
  const alphas = [0, 0.04, 0.12, 0.14, 0.18, 0.22, 0.26, 0.5, 0.145, 1]
  it('hexA === Operations hexA()', () => {
    for (const h of hexes) for (const a of alphas) expect(hexA(h, a), `${h} ${a}`).toBe(ops.hexA(h, a))
    const rnd = seq(99)
    for (let i = 0; i < 500; i++) {
      const h =
        '#' +
        Math.floor(rnd() * 0xffffff)
          .toString(16)
          .padStart(6, '0')
      expect(hexA(h, 0.18)).toBe(ops.hexA(h, 0.18))
    }
  })
  it('lighten === Operations lighten()', () => {
    for (const h of hexes) expect(lighten(h), h).toBe(ops.lighten(h))
    const rnd = seq(100)
    for (let i = 0; i < 500; i++) {
      const h =
        '#' +
        Math.floor(rnd() * 0xffffff)
          .toString(16)
          .padStart(6, '0')
      expect(lighten(h), h).toBe(ops.lighten(h))
    }
  })
  it('statusMeta === Operations stMeta() for every status and unknown keys', () => {
    for (const s of [
      'booked',
      'confirmed',
      'arrived',
      'cleaning',
      'completed',
      'canceled',
      'noshow',
      '',
      'Booked',
      'weird',
      'no-show',
      'in progress',
    ])
      expect(statusMeta(s), s).toEqual(ops.stMeta(s))
  })
  it('statusMeta does not return inherited Object.prototype members (deliberate: the original returns a function)', () => {
    expect(statusMeta('constructor')).toEqual({ l: 'constructor', c: '#6B7280' })
    expect(typeof ops.stMeta('constructor')).toBe('function')
  })
  it('invoicePill === Payments pill() for every invoice status and unknown text', () => {
    for (const s of [
      'Paid',
      'Unpaid',
      'Partially paid',
      'Refunded',
      'Canceled · refunded',
      'Partially refunded',
      '',
      'Void',
      'paid',
    ])
      expect(invoicePill(s), s).toEqual(pay.pill(s))
  })
  it('employee status label and pill === Settings employee rows', () => {
    const base = set.state.employees[0]
    for (const st of ['active', 'invited', 'inactive']) {
      set.state = { ...set.state, employees: [{ ...base, status: st }] }
      const row = set.renderVals().empRows[0]
      expect(employeeStatusLabel(st)).toBe(row.status)
      expect(employeeStatusStyle(st)).toEqual(row.statusStyle)
    }
  })
})

describe('dates', () => {
  const offs: number[] = []
  for (let o = -400; o <= 800; o++) offs.push(o)

  it('dateFor / iso / offFor === Operations dateFor() / iso() / offFor()', () => {
    for (const o of offs) {
      const d = ops.dateFor(o)
      expect(dateFor(o).getTime(), String(o)).toBe(d.getTime())
      expect(iso(dateFor(o))).toBe(ops.iso(d))
      expect(offFor(dateFor(o))).toBe(ops.offFor(d))
      expect(offFor(dateFor(o))).toBe(o)
    }
    // times of day inside the day do not change the offset
    expect(offFor(new Date(2026, 5, 14, 23, 59))).toBe(ops.offFor(new Date(2026, 5, 14, 23, 59)))
  })

  it('dayInfo === Operations dayInfo() with the default hours and closures', () => {
    for (const o of offs) {
      const d = ops.dateFor(o)
      expect(dayInfo(d, ops.DEF_CLOSURES, ops.DEF_HOURS), String(o)).toEqual(ops.dayInfo(d))
    }
  })
  it('dayInfo === Operations dayInfo() with edited state (closed weekday, reduced and closed closures)', () => {
    const hours = ops.DEF_HOURS.map((h: any, i: number) =>
      i === 3 ? { open: false, from: h.from, to: h.to } : { ...h },
    )
    hours[5] = { open: true, from: '7:30 AM', to: '8:15 PM' }
    const closures = [
      ...ops.DEF_CLOSURES,
      { date: '2026-06-17', name: 'Staff training', type: 'closed' },
      { date: '2026-06-18', name: 'Short day', type: 'reduced', from: '11:00 AM', to: '1:30 PM' },
      { date: '2026-06-19', name: 'Late open', type: 'reduced', from: '12:00 PM', to: '4:45 PM' },
    ]
    ops.state = { ...ops.state, hours, closures }
    for (const o of offs) {
      const d = ops.dateFor(o)
      expect(dayInfo(d, closures, hours), String(o)).toEqual(ops.dayInfo(d))
    }
  })

  it('calLabel === Operations calLabel across year boundaries', () => {
    ops.state = { ...ops.state, calMode: 'day', hours: undefined, closures: undefined }
    for (const o of [-400, -200, -1, 0, 1, 7, 29, 30, 200, 201, 202, 300, 400, 800]) {
      ops.state = { ...ops.state, calOffset: o }
      expect(calLabel(dateFor(o)), String(o)).toBe(ops.renderVals().calLabel)
    }
  })

  it('fmtDateOffset === Payments fmtDate() and dateOf() agrees with dateFor()', () => {
    for (let o = -60; o <= 60; o++) {
      expect(fmtDateOffset(o), String(o)).toBe(pay.fmtDate(o))
      expect(dateFor(o).getTime()).toBe(pay.dateOf(o).getTime())
    }
  })
})

describe('calendar generator', () => {
  it('rng === Operations rng() sequences', () => {
    for (const seed of [0, 1, 7919, 104729, -104729, 123456789, 2 ** 31, o2seed(-45), o2seed(60)]) {
      const a = rng(seed)
      const b = ops.rng(seed)
      for (let i = 0; i < 50; i++) expect(a(), `${seed}#${i}`).toBe(b())
    }
  })
  it('dayCount === Operations dayCount() for 400 day offsets, reduced or not', () => {
    for (let o = -200; o <= 200; o++) {
      for (const reduced of [false, true]) {
        const mine = dayCount(o, reduced)
        const orig = ops.dayCount(o, { note: reduced ? 'x' : '' })
        expect(mine.n, `${o} ${reduced}`).toBe(orig.n)
        expect(mine.rnd(), `${o} ${reduced} next`).toBe(orig.rnd())
      }
    }
  })
})
const o2seed = (o: number): number => o * 7919 + 104729
