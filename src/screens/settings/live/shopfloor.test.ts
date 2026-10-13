/* eslint-disable @typescript-eslint/no-explicit-any */
// Settings → Shop floor (ADR 0180, design 6.6; DV-1010, DV-1011): the Kiosk section's view model over GET /kiosk and
// its writes, and the Team activity report (which answers 501 NOT_BUILT until the backend report is built: fixtures here).
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/data/http/problem'
import { QueryStore } from '@/data/query-store'
import type { KioskAdminApi } from '@/data/ports/kiosk-api'
import { KioskSection } from './kiosk'
import { activityFixture, overviewFixture } from './shopfloor-fixtures'
import { TeamActivitySection } from './team-activity'
import type { RunResult } from './ui'

function fakeApi(): KioskAdminApi & { calls: any[][] } {
  const calls: any[][] = []
  const step =
    (name: string, fn: (...a: any[]) => any) =>
    async (...a: any[]) => {
      calls.push([name, ...a])
      return fn(...a)
    }
  return {
    calls,
    overview: step('overview', () => overviewFixture()),
    setMode: step('setMode', (enabled: boolean, version: number) => ({ enabled, version: version + 1, signedOut: false })),
    setCode: step('setCode', (body: any) => (body.generate ? { setAt: 'x', code: '24681357' } : { setAt: 'x' })),
    register: step('register', (name: string) => ({ device: { ...overviewFixture().devices[0]!, name }, signedOut: false })),
    rename: step('rename', () => overviewFixture().devices[0]),
    revoke: step('revoke', () => undefined),
    lockDevice: step('lockDevice', () => undefined),
    clearLockout: step('clearLockout', () => overviewFixture().devices[1]),
    lockAll: step('lockAll', () => ({ locked: 2 })),
    setListed: step('setListed', (id: string, listed: boolean) => ({ id, listed, name: 'x', status: 'active' })),
    activity: step('activity', () => {
      throw new ApiError({ status: 501, code: 'NOT_BUILT', title: 'Not ready yet' })
    }),
    events: step('events', () => ({ items: [], nextCursor: null })),
  } as any
}

function kioskSection(o: { allowed?: boolean } = {}) {
  const api = fakeApi()
  const flashes: string[] = []
  const nav = vi.fn()
  const changed = vi.fn()
  const busy = new Set<string>()
  const section = new KioskSection({
    api,
    run: async <T>(name: string, request: (idem: string) => Promise<T>): Promise<RunResult<T>> => {
      busy.add(name)
      try {
        return { ok: true, data: await request('idem-' + name) }
      } catch (e) {
        return { ok: false, message: e instanceof ApiError ? e.errors[0]?.message || e.detail || e.title : 'x' }
      } finally {
        busy.delete(name)
      }
    },
    allowed: () => o.allowed ?? true,
    busy: (n) => busy.has(n),
    changed,
    flash: (t) => void flashes.push(t),
    tz: () => 'America/New_York',
    today: () => '2026-10-13',
    navigate: nav,
  })
  return { api, section, flashes, nav, changed }
}

const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

describe('Settings → Kiosk (DV-1010)', () => {
  it('shows mode, code, this browser, the live devices, who shows on the kiosk and recent events', () => {
    const { section } = kioskSection()
    const v: any = section.vals(overviewFixture())
    expect(v.has).toBe(true)
    expect(v.enabled).toBe(false)
    expect(v.modeText).toMatch(/^Off\./)
    expect(v.codeLine).toBe('Set Oct 1 by Rafael M. · 12 days ago')
    expect(v.codeOld).toBe(false)
    expect(v.notThisKiosk).toBe(true)
    expect(v.devices.map((d: any) => [d.name, d.state, d.canLock, d.canClear])).toEqual([
      ['Front desk tablet', 'Unlocked · locks 9:00 PM', true, false],
      ['Bay tablet', 'Locked out · too many wrong codes', false, true],
    ])
    expect(v.devices[0].seen).toBe('Last seen Oct 13, 2:14 PM · 100.64.1.7 · Chrome on Android')
    expect(v.staff.map((p: any) => [p.name, p.sub])).toEqual([
      ['Marco R.', 'Active'],
      ['Lena K.', 'Invited · no login yet'],
    ])
    expect(v.recent).toEqual([{ line: 'Oct 13, 8:00 AM · Unlocked · Front desk tablet' }])
    expect(section.vals(undefined)).toMatchObject({ has: false })
  })

  it('kiosk mode on and off with the version the view had', async () => {
    const { api, section, flashes } = kioskSection()
    ;(section.vals(overviewFixture()) as any).modeToggle()
    await flush()
    expect(api.calls.find((c) => c[0] === 'setMode')!.slice(1, 3)).toEqual([true, 3])
    expect(flashes).toEqual(['Kiosk mode is on · the tablet shows the keypad'])
  })

  it('turned on from the tablet itself: the manager is signed out there and the browser goes to the keypad (K4 review kiosk:F1)', async () => {
    const { api, section, flashes, nav } = kioskSection()
    api.setMode = (async () => ({ enabled: true, version: 4, signedOut: true })) as any
    ;(section.vals(overviewFixture()) as any).modeToggle()
    await flush()
    expect(nav).toHaveBeenCalledWith('/login')
    expect(flashes).toEqual([])
  })

  it('turning it on without a code shows the server’s words under the switch', async () => {
    const { api, section } = kioskSection()
    api.setMode = (async () => {
      throw new ApiError({ status: 409, code: 'KIOSK_CODE_NOT_SET', title: 'No shop code yet', detail: 'A manager needs to set the shop code first' })
    }) as any
    ;(section.vals(overviewFixture()) as any).modeToggle()
    await flush()
    expect((section.vals(overviewFixture()) as any).modeError).toBe('A manager needs to set the shop code first')
  })

  it('change the code: two masked entries, digits only, checked before it is sent; every kiosk locks', async () => {
    const { api, section, flashes } = kioskSection()
    let v: any = section.vals(overviewFixture())
    v.openCode()
    v = section.vals(overviewFixture())
    expect(v.codeOpen).toBe(true)
    expect(v.codeWarn).toBe('Changing the code locks every kiosk now.')
    v.setCode1({ target: { value: '2468-1357x9' } })
    v.setCode2({ target: { value: '24681358' } })
    v = section.vals(overviewFixture())
    expect(v.code1).toBe('24681357')
    v.saveCode()
    await flush()
    v = section.vals(overviewFixture())
    expect(v.codeError).toBe('The two codes don’t match.')
    expect(api.calls.some((c) => c[0] === 'setCode')).toBe(false)
    v.setCode2({ target: { value: '24681357' } })
    section.vals(overviewFixture())
    ;(section.vals(overviewFixture()) as any).saveCode()
    await flush()
    expect(api.calls.find((c) => c[0] === 'setCode')![1]).toEqual({ code: '24681357' })
    expect(flashes).toContain('Shop code changed · every kiosk locked')
    v = section.vals(overviewFixture())
    expect(v.codeOpen).toBe(false)
    expect(v.code1).toBe('')
  })

  it('the server’s rule message shows under the form (KIOSK_CODE_REJECTED)', async () => {
    const { api, section } = kioskSection()
    api.setCode = (async () => {
      throw new ApiError({
        status: 422,
        code: 'KIOSK_CODE_REJECTED',
        title: 'Choose another code',
        errors: [{ path: 'body.code', message: 'No runs like 12345678' }],
      })
    }) as any
    const v: any = section.vals(overviewFixture())
    v.openCode()
    v.setCode1({ target: { value: '23456789' } })
    v.setCode2({ target: { value: '23456789' } })
    ;(section.vals(overviewFixture()) as any).saveCode()
    await flush()
    expect((section.vals(overviewFixture()) as any).codeError).toBe('No runs like 12345678')
  })

  it('generate: the new code is shown once, in two halves, until Done', async () => {
    const { section } = kioskSection()
    ;(section.vals(overviewFixture()) as any).generate()
    await flush()
    let v: any = section.vals(overviewFixture())
    expect(v.hasGenerated).toBe(true)
    expect(v.generatedCode).toBe('2468 1357')
    expect(v.codeClosed).toBe(false)
    v.doneGenerated()
    v = section.vals(overviewFixture())
    expect(v.hasGenerated).toBe(false)
    expect(v.generatedCode).toBe('')
  })

  it('Make this a kiosk: a name, then the device cookie; with kiosk mode on the keypad comes next', async () => {
    const { api, section, nav, flashes } = kioskSection()
    let v: any = section.vals(overviewFixture())
    v.register()
    await flush()
    expect((section.vals(overviewFixture()) as any).registerError).toMatch(/Give this tablet a name/)
    v = section.vals(overviewFixture())
    v.setDeviceName({ target: { value: '  Front desk 2  ' } })
    ;(section.vals(overviewFixture()) as any).register()
    await flush()
    expect(api.calls.find((c) => c[0] === 'register')![1]).toBe('Front desk 2')
    expect(flashes[0]).toMatch(/^Front desk 2 is a kiosk now/)
    expect(nav).not.toHaveBeenCalled()
    api.register = (async () => ({ device: overviewFixture().devices[0], signedOut: true })) as any
    v = section.vals(overviewFixture({ enabled: true }))
    v.setDeviceName({ target: { value: 'Front desk 3' } })
    ;(section.vals(overviewFixture({ enabled: true })) as any).register()
    await flush()
    expect(nav).toHaveBeenCalledWith('/login')
  })

  it('this browser already is a kiosk: says so instead of the form', () => {
    const { section } = kioskSection()
    const v: any = section.vals(overviewFixture({ thisDeviceId: 'dev-1' }))
    expect(v.isThisKiosk).toBe(true)
    expect(v.notThisKiosk).toBe(false)
    expect(v.thisLine).toBe('This browser is the kiosk “Front desk tablet”.')
    expect(v.devices[0].name).toBe('Front desk tablet (this browser)')
  })

  it('devices: rename (with its version), lock, clear a lockout, remove after a confirm; Lock all after a confirm', async () => {
    const { api, section, flashes } = kioskSection()
    let v: any = section.vals(overviewFixture())
    v.devices[0].startRename()
    v = section.vals(overviewFixture())
    expect(v.devices[0].renaming).toBe(true)
    v.devices[0].setRename({ target: { value: 'Counter' } })
    ;(section.vals(overviewFixture()) as any).devices[0].saveRename()
    await flush()
    expect(api.calls.find((c) => c[0] === 'rename')!.slice(1, 4)).toEqual(['dev-1', 'Counter', 1])
    v = section.vals(overviewFixture())
    v.devices[0].lock()
    v.devices[1].clear()
    await flush()
    expect(api.calls.some((c) => c[0] === 'lockDevice' && c[1] === 'dev-1')).toBe(true)
    expect(api.calls.some((c) => c[0] === 'clearLockout' && c[1] === 'dev-2')).toBe(true)
    v.devices[1].revoke()
    v = section.vals(overviewFixture())
    expect(v.devices[1].confirming).toBe(true)
    expect(v.devices[1].showRevoke).toBe(false)
    expect(api.calls.some((c) => c[0] === 'revoke')).toBe(false)
    v.devices[1].revokeYes()
    await flush()
    expect(api.calls.some((c) => c[0] === 'revoke' && c[1] === 'dev-2')).toBe(true)
    expect(flashes).toContain('Bay tablet removed · its code no longer works there')
    v = section.vals(overviewFixture())
    v.lockAll()
    expect(api.calls.some((c) => c[0] === 'lockAll')).toBe(false)
    ;(section.vals(overviewFixture()) as any).lockAllYes()
    await flush()
    expect(flashes).toContain('2 kiosks locked')
  })

  it('who shows on the kiosk: one switch per active or invited employee', async () => {
    const { api, section, flashes } = kioskSection()
    ;(section.vals(overviewFixture()) as any).staff[1].toggle()
    await flush()
    expect(api.calls.find((c) => c[0] === 'setListed')!.slice(1, 3)).toEqual(['emp-lena', true])
    expect(flashes).toEqual(['Lena K. shows on the kiosk'])
  })

  it('without the permission nothing is sent', async () => {
    const { api, section } = kioskSection({ allowed: false })
    const v: any = section.vals(overviewFixture())
    v.modeToggle()
    v.generate()
    v.lockAll()
    v.staff[0].toggle()
    await flush()
    expect(api.calls).toEqual([])
  })

  it('a code older than 90 days gets a nudge', () => {
    const { section } = kioskSection()
    const v: any = section.vals(overviewFixture({ code: { set: true, setAt: '2026-06-01T14:00:00Z', setBy: null, ageDays: 134 } }))
    expect(v.codeOld).toBe(true)
    expect(v.codeOldText).toBe('This code is 134 days old. If someone who knew it has left, change it.')
  })
})

function activitySection(api = fakeApi()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const store = new QueryStore(qc, { schedule: (fn) => fn() })
  const changed = vi.fn()
  const section = new TeamActivitySection({
    api,
    store,
    changed,
    tz: () => 'America/New_York',
    today: () => '2026-10-13',
  })
  return { api, section, qc }
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
}

describe('Settings → Team activity (DV-1011)', () => {
  it('until the backend builds the report (501 NOT_BUILT) it says so plainly', async () => {
    const { section } = activitySection()
    expect((section.vals(true) as any).loading).toBe(true)
    await settle()
    const v: any = section.vals(true)
    expect(v.notBuilt).toBe(true)
    expect(v.ready).toBe(false)
    expect(v.failed).toBe(false)
  })

  it('a failure that is not 501 offers Try again', async () => {
    const api = fakeApi()
    api.activity = (async () => {
      throw new ApiError({ status: 500, title: 'Boom' })
    }) as any
    const { section } = activitySection(api)
    section.vals(true)
    await settle()
    const v: any = section.vals(true)
    expect(v.failed).toBe(true)
    expect(typeof v.retry).toBe('function')
  })

  it('the per-employee table, the range chips and the drill-down (days, cars with steps, timeline)', async () => {
    const api = fakeApi()
    api.activity = vi.fn(async (q: any) => {
      const r = activityFixture()
      if (q.employeeId)
        return {
          ...r,
          cars: [
            {
              appointmentId: 'a1',
              seq: 1042,
              customer: 'Maria Lopez',
              vehicle: 'Toyota Camry',
              date: '2026-10-13',
              worker: { id: 'emp-marco', name: 'Marco R.' },
              bayMinutes: 38,
              paidCents: 4500,
              steps: [
                { kind: 'assign_bay', at: '2026-10-13T14:02:00Z', by: 'Marco R.', via: 'kiosk' },
                { kind: 'complete', at: '2026-10-13T14:40:00Z', by: 'Rafael M.', via: 'signed_in' },
              ],
            },
          ],
        }
      return r
    }) as any
    api.events = vi.fn(async (_id: string, q: any) =>
      q.cursor
        ? { items: [{ id: 'e2', at: '2026-10-13T13:00:00Z', kind: 'arrive', via: 'kiosk', customer: 'Ann B.', customerId: 'c2', appointmentId: 'a2', amountCents: null, messageId: null, deviceName: 'Front desk tablet', meta: {} }], nextCursor: null }
        : { items: [{ id: 'e1', at: '2026-10-13T14:30:00Z', kind: 'payment', via: 'kiosk', customer: 'Maria Lopez', customerId: 'c1', appointmentId: 'a1', amountCents: 4500, messageId: null, deviceName: 'Front desk tablet', meta: {} }], nextCursor: 'c-2' },
    ) as any
    const { section } = activitySection(api)
    section.vals(true)
    await settle()
    let v: any = section.vals(true)
    expect(v.ready).toBe(true)
    expect(v.rangeText).toBe('Oct 13')
    expect(v.headings.map((h: any) => h.text)).toEqual([
      'Checked in',
      'In bay',
      'Finished',
      'Picked up',
      'Avg bay time',
      'Payments',
      'Texts',
      'Bookings',
    ])
    expect(v.rows.map((r: any) => [r.name, r.cells.map((c: any) => c.text)])).toEqual([
      ['Marco R.', ['3', '4', '4', '2', '41 min', '2 · $90.00', '5', '2']],
      ['Lena K.', ['—', '—', '—', '—', '—', '—', '—', '—']],
    ])
    v.rows[0].onClick()
    section.vals(true)
    await settle()
    v = section.vals(true)
    expect(v.detail.show).toBe(true)
    expect(v.detail.name).toBe('Marco R.')
    expect(v.detail.bayTime).toBe('Bay time 2 h 44 min over 4 cars · 41 min each')
    expect(v.detail.days.map((d: any) => d.label)).toEqual(['Tue, Oct 13'])
    expect(v.detail.cars[0].title).toBe('Maria Lopez · Toyota Camry')
    expect(v.detail.cars[0].sub).toBe('Tue, Oct 13 · #1042 · Worker Marco R. · in bay 38 min · paid $45.00')
    expect(v.detail.cars[0].steps).toMatchObject([
      { text: '10:02 AM · Put in a bay · Marco R.', tag: 'Kiosk' },
      { text: '10:40 AM · Finished · Rafael M.', tag: 'Signed in' },
    ])
    expect(v.detail.events.map((e: any) => [e.line, e.tag])).toEqual([
      ['Oct 13, 10:30 AM · Took a payment · Maria Lopez · $45.00 · Front desk tablet', 'Kiosk'],
    ])
    expect(v.detail.hasMore).toBe(true)
    v.detail.more()
    section.vals(true)
    await settle()
    v = section.vals(true)
    expect(v.detail.events).toHaveLength(2)
    expect(v.detail.hasMore).toBe(false)
    // another range: the drill-down closes, the report is read for those dates
    v.chips[3].onClick()
    section.vals(true)
    await settle()
    expect((api.activity as any).mock.calls.at(-1)[0]).toEqual({ from: '2026-10-04', to: '2026-10-10' })
    expect((section.vals(true) as any).detail.show).toBe(false)
  })

  it('a custom range is checked before it is read', async () => {
    const api = fakeApi()
    api.activity = vi.fn(async () => activityFixture()) as any
    const { section } = activitySection(api)
    let v: any = section.vals(true)
    v.chips[4].onClick()
    v = section.vals(true)
    expect(v.custom).toBe(true)
    expect(v.customFrom).toBe('2026-10-11')
    v.setFrom({ target: { value: '2026-08-01' } })
    v.applyCustom()
    v = section.vals(true)
    expect(v.customError).toBe('Pick at most 31 days.')
    v.setFrom({ target: { value: '2026-10-01' } })
    v.applyCustom()
    section.vals(true)
    await settle()
    expect((api.activity as any).mock.calls.at(-1)[0]).toEqual({ from: '2026-10-01', to: '2026-10-13' })
  })

  it('without the amounts (no “View payment reports”) it says why the money column shows counts', async () => {
    const api = fakeApi()
    api.activity = vi.fn(async () => ({ ...activityFixture(), amounts: false })) as any
    const { section } = activitySection(api)
    section.vals(true)
    await settle()
    expect((section.vals(true) as any).rangeText).toBe('Oct 13 · amounts need “View payment reports”')
  })

  it('reads nothing while the section is closed', () => {
    const api = fakeApi()
    const { section } = activitySection(api)
    section.vals(false)
    expect(api.calls).toEqual([])
  })
})
