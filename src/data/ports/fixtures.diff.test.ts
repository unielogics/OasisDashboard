// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// The fixture constants and the FixtureDataPort are checked against the ORIGINAL logic classes.
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadLogic } from '@/dc/loadLogic'
import { addDays } from '@/lib/tz'
import { createFixtureDataPort } from './fixture'
import {
  DESIGN_ADDONS,
  DESIGN_CLOSURES,
  DESIGN_HOURS,
  DESIGN_PACKAGES,
  DESIGN_SLOTS,
  fixtureServices,
} from './fixtures'
import { PortUnavailableError } from './ports'

const root = path.resolve(__dirname, '..', '..', '..')
const load = (screen: string): any => {
  const src = fs.readFileSync(path.join(root, 'design/extracted', screen, 'logic.original.js'), 'utf8')
  return new (loadLogic(src, screen) as any)({})
}
let ops: any
let set: any
beforeAll(() => {
  process.env.TZ = 'America/New_York'
  vi.useFakeTimers({ now: new Date('2026-06-13T10:36:00-04:00') })
  ops = load('operations')
  set = load('settings')
})
afterAll(() => vi.useRealTimers())

describe('fixture constants === the design classes', () => {
  it('packages: names, prices, durations and checklist tasks in order', () => {
    expect(DESIGN_PACKAGES.map(([n]) => n)).toEqual(Object.keys(ops.SERVICES))
    for (const [name, price, dur, tasks] of DESIGN_PACKAGES) {
      expect(ops.SERVICES[name].price, name).toBe(price)
      expect(ops.SERVICES[name].dur, name).toBe(dur)
      expect(ops.SERVICES[name].list, name).toEqual(tasks)
    }
  })
  it('add-ons: names, prices and tasks in order', () => {
    expect(DESIGN_ADDONS.map(([n, p]) => [n, p])).toEqual(ops.ADDONS)
    for (const [name, , tasks] of DESIGN_ADDONS) expect(ops.ADDON_TASKS[name], name).toEqual(tasks)
  })
  it('hours equal the Operations default and the Settings starting state', () => {
    expect(DESIGN_HOURS).toEqual(ops.DEF_HOURS)
    expect(DESIGN_HOURS).toEqual(set.state.hours)
  })
  it('closures equal the Operations defaults (and the Settings list in date, name, type and reduced hours)', () => {
    expect(DESIGN_CLOSURES).toEqual(ops.DEF_CLOSURES)
    expect(DESIGN_CLOSURES.map((c) => [c.date, c.name, c.type])).toEqual(
      set.state.closures.map((c: any) => [c.date, c.name, c.type]),
    )
    expect(set.state.rules).toEqual({ slot: 30, buffer: 10, cutoff: 60 })
  })
  it('the New Appointment slots, VIP-held and blocked ones match renderVals().newSlots', () => {
    const slots = ops.renderVals().newSlots as Array<{ label: string; style: any }>
    expect(slots.map((s) => s.label.replace(' · VIP', ''))).toEqual([...DESIGN_SLOTS.times])
    for (const s of slots) {
      const t = s.label.replace(' · VIP', '')
      expect(s.label.endsWith('VIP'), t).toBe((DESIGN_SLOTS.vipHeld as readonly string[]).includes(t))
      expect(s.style.cursor === 'not-allowed', t).toBe(
        (DESIGN_SLOTS.blocked as readonly string[]).includes(t),
      )
    }
  })
})

describe('FixtureDataPort', () => {
  const port = createFixtureDataPort()

  it('catalog: ids are stable and unique, money is cents, tasks carry ids', async () => {
    const c = await port.catalog.services()
    expect(c.packages).toHaveLength(9)
    expect(c.addons).toHaveLength(10)
    const ids = [...c.packages, ...c.addons].map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(c.packages.find((p) => p.name === 'Express Hand Wash')).toMatchObject({
      priceCents: 4500,
      durationMin: 35,
      kind: 'package',
    })
    const taskIds = [...c.packages, ...c.addons].flatMap((s) => s.tasks.map((t) => t.id))
    expect(new Set(taskIds).size).toBe(taskIds.length)
    expect(fixtureServices().packages[0]!.id).toBe(c.packages[0]!.id)
  })

  it('catalog.saveChecklist keeps ids, trims, drops empties and bumps the version; the read copy is detached', async () => {
    const p = createFixtureDataPort()
    const c = await p.catalog.services()
    const pkg = c.packages[0]!
    const out = await p.catalog.saveChecklist(pkg.id, [
      { id: pkg.tasks[0]!.id, label: '  Rinse  ' },
      { label: '   ' },
      { label: 'New step' },
    ])
    expect(out.tasks.map((t) => t.label)).toEqual(['Rinse', 'New step'])
    expect(out.tasks[0]!.id).toBe(pkg.tasks[0]!.id)
    expect(out.version).toBe(pkg.version + 1)
    out.tasks.length = 0
    expect((await p.catalog.services()).packages[0]!.tasks).toHaveLength(2)
    await expect(p.catalog.saveChecklist('nope', [])).rejects.toThrow(/unknown service/)
  })

  it('hours and closures: read, save, create, delete and range filters', async () => {
    const p = createFixtureDataPort()
    const h = await p.hours.hours()
    expect(h.days).toHaveLength(7)
    expect(h.rules).toEqual({ slot: 30, buffer: 10, cutoff: 60 })
    const saved = await p.hours.saveHours({
      ...h,
      days: h.days.map((d) => (d.weekday === 0 ? { ...d, open: false } : d)),
    })
    expect(saved.version).toBe(h.version + 1)
    expect((await p.hours.hours()).days[0]!.open).toBe(false)
    expect(await p.hours.closures({ from: '2026-09-01', to: '2026-12-24' })).toHaveLength(3)
    const c = await p.hours.createClosure({ date: '2026-06-20', name: 'Training', type: 'closed' })
    expect((await p.hours.closures()).map((x) => x.date)).toContain('2026-06-20')
    await p.hours.deleteClosure(c.id)
    expect((await p.hours.closures()).map((x) => x.date)).not.toContain('2026-06-20')
    expect(await p.hours.previewClosure({ date: '2026-06-20', type: 'closed' })).toEqual({ affected: 0 })
  })

  it('emergency opens and reopens in memory', async () => {
    const p = createFixtureDataPort()
    expect(await p.emergency.current()).toEqual({ active: false })
    expect((await p.emergency.close({ reason: 'Storm', dur: 'today', notify: false })).active).toBe(true)
    expect((await p.emergency.current()).reason).toBe('Storm')
    expect(await p.emergency.reopen()).toEqual({ active: false })
  })

  it('calendar summary === Operations countFor()/dayInfo() for 80 days around today (closed days, reduced hours, today and tomorrow)', async () => {
    const days = await port.calendar.summary('2026-05-24', '2026-08-12')
    expect(days).toHaveLength(81)
    const tomorrowExtra = ops.state.appts.filter((a: any) => a.day === 1).length
    for (const d of days) {
      const off = Math.round(
        (Date.parse(d.date + 'T12:00:00Z') - Date.parse('2026-06-13T12:00:00Z')) / 86400000,
      )
      const info = ops.dayInfo(ops.dateFor(off))
      if (info.closed) {
        expect(d, d.date).toEqual({ date: d.date, count: 0, closed: info.closed })
        continue
      }
      expect(d.reduced, d.date).toBe(!!info.note)
      expect(d.open, d.date).toEqual({ from: info.from, to: info.to })
      if (off === 0) expect(d.count).toBe(ops.countFor(0))
      else if (off === 1) expect(d.count + tomorrowExtra, d.date).toBe(ops.countFor(1))
      else expect(d.count, d.date).toBe(ops.countFor(off))
    }
    expect(days.find((d) => d.date === '2026-06-13')!.count).toBe(11)
    expect(days.find((d) => d.date === '2026-07-04')).toMatchObject({ closed: 'Independence Day', count: 0 })
    expect(days.find((d) => d.date === '2026-06-14')!.open).toEqual({ from: '9:00 AM', to: '3:00 PM' })
  })

  it('calendar.day returns the open window or the closed reason; availability returns the eight design slots', async () => {
    expect((await port.calendar.day('2026-12-25')).dayInfo).toEqual({ closed: 'Christmas Day' })
    expect((await port.calendar.day('2026-12-24')).dayInfo).toEqual({
      from: '8:00 AM',
      to: '1:00 PM',
      note: 'Christmas Eve · reduced hours',
    })
    const slots = await port.availability.slots({ date: '2026-06-13', serviceId: 'x' })
    expect(slots.map((s) => [s.time, s.state])).toEqual([
      ['10:30 AM', 'available'],
      ['11:00 AM', 'blocked'],
      ['11:30 AM', 'vip_held'],
      ['12:30 PM', 'vip_held'],
      ['1:00 PM', 'blocked'],
      ['2:30 PM', 'available'],
      ['4:00 PM', 'available'],
      ['4:30 PM', 'available'],
    ])
  })

  it('regions the verbatim classes still own throw PortUnavailableError instead of inventing data', async () => {
    await expect(port.ops.snapshot({ window: 'today' })).rejects.toBeInstanceOf(PortUnavailableError)
    await expect(port.payments.summary('7d')).rejects.toThrow(
      /payments.summary is not available from the fixture data port/,
    )
    await expect(port.people.roles()).rejects.toBeInstanceOf(PortUnavailableError)
    await expect(port.messages.thread('a')).rejects.toBeInstanceOf(PortUnavailableError)
    expect(port.kind).toBe('fixture')
  })

  it('addDays used by the port agrees with the design date maths across a month end', () => {
    expect(addDays('2026-06-30', 1)).toBe(ops.iso(ops.dateFor(18)))
  })
})
