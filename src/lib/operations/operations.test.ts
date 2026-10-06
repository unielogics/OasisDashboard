import { describe, expect, it } from 'vitest'
import {
  CAL_SWIPE_MS,
  CAL_SWIPE_PX,
  CAL_SWIPE_RATIO,
  CLICK_SUPPRESS_MS,
  LONG_PRESS_MS,
  MOUSE_DRAG_PX,
  SWIPE_CLAMP_PX,
  SWIPE_COMMIT_PX,
  TOUCH_INTENT_PX,
  TOUCH_INTENT_RATIO,
  absMin,
  arrivalsOf,
  balance,
  bayProgress,
  buildKpis,
  calendarSwipe,
  canDrag,
  checklistFor,
  checklistProgress,
  clampSwipe,
  clickSuppressed,
  decideMove,
  groupTimeline,
  hourLabel,
  inFacility,
  initChecks,
  isLate,
  money,
  monthGrid,
  navOffset,
  nextStep,
  queueOf,
  searchMatcher,
  selectPool,
  setChecks,
  sortPool,
  swipeOutcome,
  swipeTransform,
  ghostTransform,
  dayHeading,
  weekHeading,
  total,
  upcoming,
  withActivity,
  ORDER,
} from './index'
import type { Appt } from './types'
import { parseT } from '../time'

const priced = (o: Partial<Appt> = {}) =>
  ({
    price: 129,
    addons: [],
    member: null,
    tip: 0,
    pay: 'unpaid',
    deposit: undefined,
    status: 'booked',
    ...o,
  }) as Appt

describe('pricing', () => {
  it('sums package and add-ons, taxes both at 7% rounded to a whole dollar, leaves the tip untaxed', () => {
    const t = total(priced({ addons: [{ name: 'Rain repellent', price: 25 }], tip: 8 }))
    expect(t).toEqual({ sub: 154, addon: 25, credit: 0, tax: 11, grand: 173, tip: 8 })
  })
  it('rounds tax half up on the float product (the whole-dollar rule of the design)', () => {
    expect(total(priced({ price: 50 })).tax).toBe(4) // 3.5000000000000004
    expect(total(priced({ price: 150 })).tax).toBe(11) // 10.5
    expect(total(priced({ price: 35 })).tax).toBe(2) // 2.45
    expect(total(priced({ price: 0 })).tax).toBe(0)
  })
  it('a membership never reduces the price (the credit expression is always 0)', () => {
    for (const member of ['Essential', 'Premium', 'Exotic']) expect(total(priced({ member })).credit).toBe(0)
  })
  it('balance: paid is 0, a deposit is deducted from the grand total, unpaid owes it all', () => {
    expect(balance(priced({ pay: 'paid' }))).toBe(0)
    expect(balance(priced({ pay: 'unpaid' }))).toBe(138)
    expect(balance(priced({ pay: 'deposit', deposit: 50 }))).toBe(88)
    expect(balance(priced({ pay: 'deposit' }))).toBe(138)
  })
  it('money shows whole dollars with thousands separators', () => {
    expect(money(1298.53)).toBe('$1,299')
    expect(money(0)).toBe('$0')
    expect(money(650)).toBe('$650')
  })
})

describe('status flow', () => {
  it('maps each status to its next step', () => {
    const to = (status: Appt['status'], o: Partial<Appt> = {}) =>
      nextStep(priced({ status, ...o }))?.to ?? null
    expect(to('booked')).toBe('confirmed')
    expect(to('confirmed')).toBe('arrived')
    expect(to('arrived')).toBe('cleaning')
    expect(to('cleaning')).toBe('completed')
    expect(to('completed', { pay: 'unpaid' })).toBe('pay')
    expect(to('completed', { pay: 'paid' })).toBeNull()
    expect(to('canceled')).toBeNull()
    expect(to('noshow')).toBeNull()
  })
  it('the order and the predicates', () => {
    expect(ORDER).toEqual(['booked', 'confirmed', 'arrived', 'cleaning', 'completed'])
    expect(inFacility({ status: 'cleaning' })).toBe(true)
    expect(canDrag({ status: 'cleaning' })).toBe(false)
    expect(canDrag({ status: 'completed' })).toBe(false)
    expect(canDrag({ status: 'confirmed' })).toBe(true)
    expect(isLate({ late: true, status: 'confirmed' })).toBe(true)
    expect(isLate({ late: true, status: 'arrived' })).toBe(false)
    expect(isLate({ status: 'confirmed' })).toBe(false)
    expect(absMin({ day: 1, time: '9:00 AM' }, parseT)).toBe(1440 + 540)
  })
})

describe('checklists', () => {
  const services = { Wash: { price: 1, dur: 1, list: ['Rinse', 'Dry'] } }
  const tasks = { Wax: ['Apply', 'Buff'] }
  it('keys are pkg|task and ad|add-on|task; an add-on without tasks lists itself', () => {
    const secs = checklistFor(
      { svc: 'Wash', addons: [{ name: 'Wax', price: 40 }, 'Mystery'] },
      services,
      tasks,
    )
    expect(secs.map((s) => [s.title, s.kind, s.items.map((i) => i.key)])).toEqual([
      ['Wash', 'Package', ['pkg|Rinse', 'pkg|Dry']],
      ['Wax', 'Add-on', ['ad|Wax|Apply', 'ad|Wax|Buff']],
      ['Mystery', 'Add-on', ['ad|Mystery|Mystery']],
    ])
  })
  it('pre-ticks round(n * fraction) keys; progress and set/clear', () => {
    const addons = [{ name: 'Wax', price: 40 }]
    expect(Object.keys(initChecks('Wash', addons, 0.5, services, tasks))).toEqual(['pkg|Rinse', 'pkg|Dry'])
    expect(initChecks('Wash', addons, 0, services, tasks)).toEqual({})
    const secs = checklistFor({ svc: 'Wash', addons }, services, tasks)
    const all = initChecks('Wash', addons, 1, services, tasks)
    expect(checklistProgress(secs, all)).toEqual({ done: 4, total: 4, allDone: true, pct: 100 })
    expect(checklistProgress(secs, { 'pkg|Rinse': true })).toEqual({
      done: 1,
      total: 4,
      allDone: false,
      pct: 25,
    })
    expect(checklistProgress([], {})).toEqual({ done: 0, total: 0, allDone: false, pct: 0 })
    expect(setChecks({ a: true, b: true }, ['a'], false)).toEqual({ b: true })
    expect(setChecks({ a: true }, ['b'], true)).toEqual({ a: true, b: true })
  })
})

describe('gesture thresholds', () => {
  it('the constants are the design numbers', () => {
    expect([LONG_PRESS_MS, MOUSE_DRAG_PX, TOUCH_INTENT_PX, TOUCH_INTENT_RATIO]).toEqual([380, 6, 12, 1.4])
    expect([SWIPE_COMMIT_PX, SWIPE_CLAMP_PX, CLICK_SUPPRESS_MS]).toEqual([90, 150, 450])
    expect([CAL_SWIPE_PX, CAL_SWIPE_RATIO, CAL_SWIPE_MS]).toEqual([70, 1.5, 800])
  })
  it('mouse drag starts strictly beyond 6 px, only on a draggable card', () => {
    const d = (dx: number, dy: number, can = true) =>
      decideMove({ touch: false, can, ctx: 'tl', dx, dy }).decision
    expect(d(6, 0)).toBe('idle')
    expect(d(6.01, 0)).toBe('begin-drag')
    expect(d(4, 4)).toBe('idle') // hypot 5.66
    expect(d(5, 4)).toBe('begin-drag') // hypot 6.4
    expect(d(100, 100, false)).toBe('idle')
  })
  it('touch intent: horizontal needs > 12 px and > 1.4 x |dy|, any other move > 12 px hands back to scrolling', () => {
    const m = (dx: number, dy: number, ctx = 'tl') => decideMove({ touch: true, can: true, ctx, dx, dy })
    expect(m(12, 0)).toEqual({ decision: 'idle', cancelTimer: false })
    expect(m(13, 0)).toEqual({ decision: 'swipe', cancelTimer: true })
    expect(m(14, 10)).toEqual({ decision: 'end', cancelTimer: false }) // 14 > 1.4 x 10 is false, and hypot > 12
    expect(m(15, 10)).toEqual({ decision: 'swipe', cancelTimer: true })
    expect(m(13, 0, 'q')).toEqual({ decision: 'end', cancelTimer: true }) // other cards give horizontal moves to native scroll
    expect(m(0, 13)).toEqual({ decision: 'end', cancelTimer: false })
    expect(m(8, 8)).toEqual({ decision: 'idle', cancelTimer: false }) // hypot 11.3
    expect(m(9, 9)).toEqual({ decision: 'end', cancelTimer: false }) // hypot 12.7
  })
  it('swipe commit, clamp, ghost, click suppression and the calendar swipe', () => {
    expect(swipeOutcome(90)).toBe('none')
    expect(swipeOutcome(91)).toBe('advance')
    expect(swipeOutcome(-90)).toBe('none')
    expect(swipeOutcome(-91)).toBe('messages')
    expect(clampSwipe(400)).toBe(150)
    expect(clampSwipe(-400)).toBe(-150)
    expect(clampSwipe(42)).toBe(42)
    expect(swipeTransform(-151)).toBe('translateX(-150px)')
    expect(ghostTransform(300, 200)).toBe('translate(160px,164px) rotate(-2deg)')
    expect(clickSuppressed(1000, 551)).toBe(true)
    expect(clickSuppressed(1000, 550)).toBe(false)
    expect(clickSuppressed(1000, undefined)).toBe(false)
    expect(calendarSwipe(-71, 0, 799)).toBe(1)
    expect(calendarSwipe(71, 0, 799)).toBe(-1)
    expect(calendarSwipe(-70, 0, 10)).toBe(0)
    expect(calendarSwipe(-100, 67, 10)).toBe(0) // 100 > 100.5 is false
    expect(calendarSwipe(-100, 66, 10)).toBe(1)
    expect(calendarSwipe(-100, 0, 800)).toBe(0)
  })
})

describe('calendar helpers', () => {
  const base = { y: 2026, m: 5, d: 13 }
  it('navOffset: a day, a week, or the first of the neighbouring month', () => {
    expect(navOffset('day', 3, 1, base)).toBe(4)
    expect(navOffset('day', 0, -1, base)).toBe(-1)
    expect(navOffset('week', 0, 1, base)).toBe(7)
    expect(navOffset('month', 0, 1, base)).toBe(18) // July 1 is 18 days after June 13
    expect(navOffset('month', 0, -1, base)).toBe(-43) // May 1
    expect(navOffset('month', 200, 1, base)).toBe(navOffset('month', 200, 1, base))
  })
  it('headings and rows', () => {
    expect(dayHeading(new Date(2026, 5, 13), 2026)).toBe('Saturday, June 13')
    expect(dayHeading(new Date(2027, 0, 2), 2026)).toBe('Saturday, January 2, 2027')
    expect(weekHeading(new Date(2026, 5, 7), new Date(2026, 5, 13))).toBe('Jun 7 – 13, 2026')
    expect(weekHeading(new Date(2026, 5, 28), new Date(2026, 6, 4))).toBe('Jun 28 – Jul 4, 2026')
    expect(hourLabel(0)).toEqual({ time: '12', ampm: 'AM' })
    expect(hourLabel(12)).toEqual({ time: '12', ampm: 'PM' })
    expect(hourLabel(13)).toEqual({ time: '1', ampm: 'PM' })
    expect(monthGrid(new Date(2026, 5, 13), base)).toEqual({
      y: 2026,
      m: 5,
      firstOffset: -12,
      lead: 1,
      cells: 35,
    })
  })
})

describe('board selection', () => {
  const mk = (id: string, day: number, time: string, o: Partial<Appt> = {}): Appt =>
    ({
      id,
      day,
      time,
      status: 'confirmed',
      staff: 'Marco R.',
      cust: { name: 'Ann Lee', phone: '(305) 111-2222' },
      veh: { year: 2020, make: 'Audi', model: 'A4', color: 'Red', plate: 'XYZ-1' },
      svc: 'Express Hand Wash',
      bay: 1,
      member: null,
      pay: 'unpaid',
      addons: [],
      price: 45,
      tip: 0,
      photos: { arrival: 0, before: 0, after: 0, issue: 0 },
      ...o,
    }) as Appt
  const list = [
    mk('x1', 0, '10:00 AM'),
    mk('x2', 0, '10:00 AM', { vip: true }),
    mk('x3', 1, '9:00 AM'),
    mk('x4', 0, '8:00 AM', { status: 'completed' }),
    mk('x5', 0, '9:00 AM', { status: 'cleaning', bay: 2 }),
  ]
  it('search matches name, phone, vehicle, plate and service, case-insensitively; empty matches all', () => {
    expect(list.filter(searchMatcher('  AUDI a4 ')).length).toBe(5) // trimmed, make and model are adjacent
    expect(list.filter(searchMatcher('audi')).length).toBe(5)
    expect(list.filter(searchMatcher('xyz-1')).length).toBe(5)
    expect(list.filter(searchMatcher('(305) 111')).length).toBe(5)
    expect(list.filter(searchMatcher('')).length).toBe(5)
    expect(list.filter(searchMatcher('nothing')).length).toBe(0)
  })
  it('only today and tomorrow filter by range', () => {
    expect(selectPool(list, '', 'today').map((a) => a.id)).toEqual(['x1', 'x2', 'x4', 'x5'])
    expect(selectPool(list, '', 'tomorrow').map((a) => a.id)).toEqual(['x3'])
    expect(selectPool(list, '', 'next24').length).toBe(5)
    expect(selectPool(list, '', 'week').length).toBe(5)
  })
  it('sorts by absolute minute, VIP first at the same minute; upcoming drops finished and in-bay cars', () => {
    const sorted = sortPool(list)
    expect(sorted.map((a) => a.id)).toEqual(['x4', 'x5', 'x2', 'x1', 'x3'])
    expect(upcoming(sorted).map((a) => a.id)).toEqual(['x2', 'x1', 'x3'])
  })
  it('groups by day and time with Today and Tomorrow dividers', () => {
    const g = groupTimeline(upcoming(sortPool(list)))
    expect(g.map((x) => [x.key, x.items.length, x.dividerLabel, x.showDivider])).toEqual([
      ['0|10:00 AM', 2, 'Today', true],
      ['1|9:00 AM', 1, 'Tomorrow', true],
    ])
    // the quirk: with nothing left today, the first group of tomorrow is labelled Tomorrow, never Today
    expect(groupTimeline([list[2]!])[0]!.dividerLabel).toBe('Tomorrow')
  })
  it('queue keeps six, VIP first; arrivals sort VIP then soonest', () => {
    const many = Array.from({ length: 9 }, (_, i) => mk('q' + i, 0, '10:00 AM', { vip: i === 7 }))
    const q = queueOf(many)
    expect(q.length).toBe(6)
    expect(q[0]!.id).toBe('q7')
    const arr = arrivalsOf([
      mk('e1', 0, '1:00 PM', { eta: 20 }),
      mk('e2', 0, '1:00 PM', { eta: 5 }),
      mk('e3', 0, '1:00 PM', { eta: 30, vip: true }),
      mk('e4', 0, '1:00 PM', { eta: 3, status: 'arrived' }),
    ])
    expect(arr.map((a) => a.id)).toEqual(['e3', 'e2', 'e1'])
  })
  it('bay progress: elapsed mm:ss, percent capped at 100, planned finish', () => {
    const occ = { startedAt: 1_000_000, dur: 75, time: '10:00 AM' }
    const p = bayProgress(occ, 1_000_000 + 27 * 60000 + 5000)
    expect([p.elapMin, p.elapSec, p.etaMin]).toEqual([27, 5, 675])
    expect(p.pct).toBeCloseTo(36.111, 3)
    expect(bayProgress(occ, 1_000_000 + 999 * 60000).pct).toBe(100)
    expect(bayProgress({ ...occ, startedAt: null }, 5)).toEqual({
      elapMin: 0,
      elapSec: 0,
      pct: 0,
      etaMin: 675,
    })
  })
})

describe('kpis and activity', () => {
  it('a day with nothing gives zeros and the design placeholders', () => {
    const k = buildKpis([])
    expect(k.map((x) => [x.label, x.value, x.sub])).toEqual([
      ['Appointments 24h', '0', '12 booked'],
      ['Active jobs', '0', 'in bays'],
      ['Ready for pickup', '0', 'clear'],
      ['Pending payments', '0', '$0'],
      ['Bay time free', '3.5h', 'today'],
      ['Members today', '0', 'of 0'],
      ['Revenue today', '$0', 'paid'],
    ])
  })
  it('withActivity fills the thread once and keeps what is already there', () => {
    const a = priced({
      status: 'confirmed',
      dur: 35,
      time: '10:45 AM',
      veh: { make: 'BMW' },
      cust: { name: 'Liam Chen' },
    } as Partial<Appt>)
    a.messages = null
    a.log = null
    withActivity(a, ORDER)
    expect(a.messages!.map((m) => m.from)).toEqual(['staff', 'system'])
    expect(a.log!.map((l) => l.time)).toEqual(['Yesterday 4:02 PM', 'Yesterday 4:12 PM'])
    const before = a.messages
    withActivity(a, ORDER)
    expect(a.messages).toBe(before)
  })
})
