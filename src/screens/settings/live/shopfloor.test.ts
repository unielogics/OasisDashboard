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
import type { RunOptions, RunResult } from './ui'

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
    setPin: step('setPin', (id: string, body: any) =>
      body.generate ? { employeeId: id, setAt: 'x', pin: '24681357' } : { employeeId: id, setAt: 'x' },
    ),
    removePin: step('removePin', () => undefined),
    addNetwork: step('addNetwork', (body: any) => ({
      created: true,
      network: { ...overviewFixture().networks[0]!, address: body.address ?? body.confirmAddress },
    })),
    removeNetwork: step('removeNetwork', () => undefined),
    clearNetworkLockout: step('clearNetworkLockout', () => overviewFixture().networks[1]),
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

function kioskSection(o: { allowed?: boolean; copy?: (t: string) => Promise<boolean> } = {}) {
  const api = fakeApi()
  const flashes: string[] = []
  const nav = vi.fn()
  const changed = vi.fn()
  const busy = new Set<string>()
  const section = new KioskSection({
    api,
    run: async <T>(name: string, request: (idem: string) => Promise<T>, ro: RunOptions = {}): Promise<RunResult<T>> => {
      busy.add(name)
      try {
        return { ok: true, data: await request('idem-' + name) }
      } catch (e) {
        if (e instanceof ApiError) {
          const own = ro.explain?.(e)
          if (own) return { ok: false, message: own }
          return { ok: false, message: e.errors[0]?.message || e.detail || e.title }
        }
        return { ok: false, message: 'x' }
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
    copy: o.copy,
  })
  return { api, section, flashes, nav, changed }
}

const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve()
}

describe('Settings → Kiosk (DV-1010)', () => {
  it('shows mode, the shop network, staff PINs, the shop browsers and recent events (with “Opened by”)', () => {
    const { section } = kioskSection()
    const v: any = section.vals(overviewFixture())
    expect(v.has).toBe(true)
    expect(v.enabled).toBe(true)
    expect(v.modeText).toMatch(/^On\. The sign-in page is the PIN keypad/)
    expect(v.yourLine).toBe('Your connection: 73.12.4.9')
    expect(v.devices.map((d: any) => [d.name, d.state, d.canLock, d.canClear, d.hasOpenedBy, d.openedBy])).toEqual([
      ['Front desk tablet', 'Unlocked · locks 9:00 PM', true, false, true, 'Opened by Marco R.'],
      ['Bay tablet', 'Locked out · too many wrong PINs', false, true, false, ''],
    ])
    expect(v.devices[0].seen).toBe('Last seen Oct 13, 2:14 PM · 100.64.1.7 · Chrome on Android')
    expect(v.recent).toEqual([{ line: 'Oct 13, 8:00 AM · Unlocked · Front desk tablet · Opened by Marco R.' }])
    expect(section.vals(undefined)).toMatchObject({ has: false })
  })

  it('kiosk mode on and off with the version the view had', async () => {
    const { api, section, flashes } = kioskSection()
    ;(section.vals(overviewFixture({ enabled: false })) as any).modeToggle()
    await flush()
    expect(api.calls.find((c) => c[0] === 'setMode')!.slice(1, 3)).toEqual([true, 3])
    expect(flashes).toEqual(['Kiosk mode is on · the sign-in page shows the PIN keypad'])
  })

  it('switched on the tablet itself: the manager is signed out there and the browser goes to the keypad (K4 review kiosk:F1)', async () => {
    const { api, section, flashes, nav } = kioskSection()
    api.setMode = (async () => ({ enabled: true, version: 4, signedOut: true })) as any
    ;(section.vals(overviewFixture({ enabled: false })) as any).modeToggle()
    await flush()
    expect(nav).toHaveBeenCalledWith('/login')
    expect(flashes).toEqual([])
  })

  it('no “Make this a kiosk” and no shop code any more', () => {
    const { section } = kioskSection()
    const v: any = section.vals(overviewFixture())
    for (const k of ['register', 'codeLine', 'generatedCode', 'saveCode', 'deviceName']) expect(v[k], k).toBeUndefined()
  })
})

describe('Settings → Kiosk → Shop network (Super Admin only to change)', () => {
  it('a Super Admin on a connection that is no shop network: the address, the button and the help line', () => {
    const { section } = kioskSection()
    const v: any = section.vals(overviewFixture())
    expect(v.canAdd).toBe(true)
    expect(v.isShop).toBe(false)
    expect(v.readOnly).toBe(false)
    expect(v.addLabel).toBe('This is the shop’s network')
    expect(v.networkHelp).toBe(
      'Do this from a phone or computer connected to the shop Wi-Fi — not mobile data. Every device on the shop Wi-Fi shares this address, so it doesn’t have to be the tablet.',
    )
    expect(v.networkVpn).toBe('Turn off any VPN or iCloud Private Relay on that device first.')
    expect(v.networks.map((n: any) => [n.title, n.line, n.state, n.canClear, n.canRemove])).toEqual([
      ['Shop Wi-Fi', '73.12.4.80 · added Oct 1 by Amara O. · last used Oct 13, 8:00 AM', '', false, true],
      ['Shop network', '2001:db8:1:2::/64 · added Oct 2 · not used yet', 'Locked out · too many wrong PINs', true, true],
    ])
  })

  it('“This is the shop’s network” sends the address the screen showed (confirmAddress) and the optional name', async () => {
    const { api, section, flashes } = kioskSection()
    const v: any = section.vals(overviewFixture())
    v.setNetworkLabel({ target: { value: 'Shop Wi-Fi 2' } })
    ;(section.vals(overviewFixture()) as any).addNetwork()
    await flush()
    expect(api.calls.find((c) => c[0] === 'addNetwork')![1]).toEqual({ confirmAddress: '73.12.4.9', label: 'Shop Wi-Fi 2' })
    expect(flashes).toEqual(['73.12.4.9 is a shop network · PINs work there now'])
    expect((section.vals(overviewFixture()) as any).networkLabel).toBe('')
  })

  it('the connection changed meanwhile (409 KIOSK_ADDRESS_CHANGED): says so with the new address; the re-read shows it', async () => {
    const { api, section } = kioskSection()
    api.addNetwork = (async () => {
      throw new ApiError({
        status: 409,
        code: 'KIOSK_ADDRESS_CHANGED',
        title: 'Your connection changed',
        meta: { yourAddress: '172.56.1.9' },
      })
    }) as any
    ;(section.vals(overviewFixture()) as any).addNetwork()
    await flush()
    const v: any = section.vals(overviewFixture({ yourAddress: '172.56.1.9' }))
    expect(v.networkError).toBe(
      'Your connection changed to 172.56.1.9. Check you’re on the shop Wi-Fi, then press the button again.',
    )
    expect(v.yourLine).toBe('Your connection: 172.56.1.9')
    // the next press confirms the address now shown
    v.addNetwork()
    await flush()
  })

  it('already on a shop network: says so instead of the button', () => {
    const { section } = kioskSection()
    const v: any = section.vals(overviewFixture({ yourAddress: '73.12.4.80', yourAddressIsShop: true }))
    expect(v.isShop).toBe(true)
    expect(v.shopText).toBe('This is the shop’s network. PINs work here.')
    expect(v.canAdd).toBe(false)
  })

  it('a manager (not a Super Admin) sees it read only: no add, no remove, no approve; Clear lockout stays', async () => {
    const { api, section } = kioskSection()
    const ro = overviewFixture({ canManageNetworks: false })
    const v: any = section.vals(ro)
    expect(v.readOnly).toBe(true)
    expect(v.readOnlyText).toBe('Only a Super Admin can change the shop network')
    expect(v.canAdd).toBe(false)
    expect(v.notShopReadOnly).toBe(true)
    expect(v.networks.every((n: any) => n.canRemove === false)).toBe(true)
    expect(v.refused.every((t: any) => t.canAdd === false)).toBe(true)
    v.addNetwork()
    v.networks[0].remove()
    v.refused[0].add()
    await flush()
    expect(api.calls).toEqual([])
    expect((section.vals(ro) as any).networks[0].confirming).toBe(false)
    expect(v.networks[1].canClear).toBe(true)
    v.networks[1].clear()
    await flush()
    expect(api.calls).toEqual([['clearNetworkLockout', 'net-2', { idempotencyKey: 'idem-kiosk:network:clear:net-2' }]])
  })

  it('remove a network after a confirm', async () => {
    const { api, section, flashes } = kioskSection()
    ;(section.vals(overviewFixture()) as any).networks[0].remove()
    let v: any = section.vals(overviewFixture())
    expect(v.networks[0].confirming).toBe(true)
    expect(v.networks[0].canRemove).toBe(false)
    expect(api.calls.some((c) => c[0] === 'removeNetwork')).toBe(false)
    v.networks[0].removeYes()
    await flush()
    expect(api.calls.find((c) => c[0] === 'removeNetwork')![1]).toBe('net-1')
    expect(flashes).toEqual(['73.12.4.80 removed · PINs no longer work from it'])
    v = section.vals(overviewFixture())
    expect(v.networks[0].confirming).toBe(false)
  })

  it('PIN tried from a new network: the wording says what it most likely is, and Add this network always asks first (review N1)', async () => {
    const { api, section, flashes } = kioskSection()
    let v: any = section.vals(overviewFixture())
    expect(v.hasRefused).toBe(true)
    expect(v.refused.map((t: any) => [t.title, t.line, t.warn])).toEqual([
      [
        'Front desk tablet tried from a new network, and the shop’s usual network has been quiet since — your internet provider probably changed the shop’s address.',
        '98.4.2.1 · 2 tries · last Oct 13, 8:05 AM',
        false,
      ],
      ['A PIN was tried from a new network', '203.0.113.50 · 1 try · last Oct 13, 9:00 AM', true],
      [
        'Marco’s phone tried from another network while the shop’s network was still in use — probably a phone away from the shop. Don’t add it unless you’re sure.',
        '172.58.10.7 · 1 try · last Oct 13, 6:00 PM',
        false,
      ],
    ])
    expect(v.refused[1].warning).toBe('Not from a shop browser — only add it if you know this address is the shop’s')
    // every kind asks first, also a known shop browser
    for (const [i, address] of [
      [0, '98.4.2.1'],
      [1, '203.0.113.50'],
      [2, '172.58.10.7'],
    ] as const) {
      v = section.vals(overviewFixture())
      v.refused[i].add()
      await flush()
      expect(api.calls.filter((c) => c[0] === 'addNetwork')).toHaveLength(i)
      v = section.vals(overviewFixture())
      expect(v.refused[i].confirming).toBe(true)
      expect(v.refused[i].canAdd).toBe(false)
      expect(v.refused[i].confirmText).toBe('Add ' + address + ' as a shop network? Anyone on that network can then use a PIN.')
      v.refused[i].addYes()
      await flush()
      expect(api.calls.filter((c) => c[0] === 'addNetwork')[i]![1]).toEqual({ address })
      expect(flashes[i]).toBe(address + ' is a shop network · PINs work there now')
      expect((section.vals(overviewFixture()) as any).refused[i].confirming).toBe(false)
    }
    // Cancel sends nothing
    v = section.vals(overviewFixture())
    v.refused[0].add()
    v = section.vals(overviewFixture())
    v.refused[0].addNo()
    await flush()
    expect(api.calls.filter((c) => c[0] === 'addNetwork')).toHaveLength(3)
    expect((section.vals(overviewFixture()) as any).refused[0].confirming).toBe(false)
  })

  it('no network yet: says PINs don’t work anywhere until one is added', () => {
    const { section } = kioskSection()
    expect((section.vals(overviewFixture({ networks: [] })) as any).noNetworksText).toBe(
      'No shop network yet. PINs don’t work anywhere until you add one.',
    )
    expect((section.vals(overviewFixture({ networks: [], canManageNetworks: false })) as any).noNetworksText).toBe(
      'No shop network yet. PINs don’t work anywhere until a Super Admin adds one.',
    )
  })
})

describe('Settings → Kiosk → Staff PINs', () => {
  it('one row per active or invited employee: who has a PIN (never the PIN) and “Shows on the kiosk”', async () => {
    const { api, section, flashes } = kioskSection()
    const v: any = section.vals(overviewFixture())
    expect(v.staff.map((p: any) => [p.name, p.sub, p.setLabel, p.canRemove])).toEqual([
      ['Marco R.', 'PIN set Oct 1 by Rafael M.', 'Change PIN', true],
      ['Lena K.', 'Invited · No PIN yet · hidden on the kiosk', 'Set PIN', false],
    ])
    expect(JSON.stringify(v.staff)).not.toMatch(/\d{8}/)
    v.staff[1].toggle()
    await flush()
    expect(api.calls.find((c) => c[0] === 'setListed')!.slice(1, 3)).toEqual(['emp-lena', true])
    expect(flashes).toEqual(['Lena K. shows on the kiosk'])
  })

  it('Set: two masked entries, digits only, checked before it is sent', async () => {
    const { api, section, flashes } = kioskSection()
    ;(section.vals(overviewFixture()) as any).staff[1].openSet()
    let v: any = section.vals(overviewFixture())
    expect(v.staff[1].editing).toBe(true)
    expect(v.staff[1].idle).toBe(false)
    v.staff[1].setPin1({ target: { value: '2468-1357x9' } })
    v.staff[1].setPin2({ target: { value: '24681358' } })
    v = section.vals(overviewFixture())
    expect(v.staff[1].pin1).toBe('24681357')
    v.staff[1].savePin()
    await flush()
    v = section.vals(overviewFixture())
    expect(v.staff[1].error).toBe('The two PINs don’t match.')
    expect(api.calls.some((c) => c[0] === 'setPin')).toBe(false)
    v.staff[1].setPin2({ target: { value: '24681357' } })
    ;(section.vals(overviewFixture()) as any).staff[1].savePin()
    await flush()
    expect(api.calls.find((c) => c[0] === 'setPin')!.slice(1, 3)).toEqual(['emp-lena', { pin: '24681357' }])
    expect(flashes).toEqual(['Lena K.’s PIN is set'])
    v = section.vals(overviewFixture())
    expect(v.staff[1].editing).toBe(false)
    expect(v.staff[1].pin1).toBe('')
  })

  it('the server’s rule shows under the row (422 KIOSK_PIN_REJECTED)', async () => {
    const { api, section } = kioskSection()
    api.setPin = (async () => {
      throw new ApiError({
        status: 422,
        code: 'KIOSK_PIN_REJECTED',
        title: 'Choose another PIN',
        errors: [{ path: 'body.pin', message: 'Choose another PIN.' }],
      })
    }) as any
    const v: any = section.vals(overviewFixture())
    v.staff[0].openSet()
    const w: any = section.vals(overviewFixture())
    w.staff[0].setPin1({ target: { value: '58149263' } })
    w.staff[0].setPin2({ target: { value: '58149263' } })
    ;(section.vals(overviewFixture()) as any).staff[0].savePin()
    await flush()
    expect((section.vals(overviewFixture()) as any).staff[0].error).toBe('Choose another PIN.')
  })

  it('Generate: shown once, in two halves, with Copy and the write-it-down note, until Done', async () => {
    const copied: string[] = []
    const { api, section } = kioskSection({ copy: async (t) => (copied.push(t), true) })
    ;(section.vals(overviewFixture()) as any).staff[0].generate()
    await flush()
    expect(api.calls.find((c) => c[0] === 'setPin')!.slice(1, 3)).toEqual(['emp-marco', { generate: true }])
    let v: any = section.vals(overviewFixture())
    expect(v.staff[0].hasGenerated).toBe(true)
    expect(v.staff[0].generatedPin).toBe('2468 1357')
    expect(v.staff[0].generatedFor).toBe('The new PIN for Marco')
    expect(v.staff[0].copyLabel).toBe('Copy')
    expect(v.staff[1].hasGenerated).toBe(false)
    v.staff[0].copy()
    await flush()
    expect(copied).toEqual(['24681357'])
    v = section.vals(overviewFixture())
    expect(v.staff[0].copyLabel).toBe('Copied')
    v.staff[0].doneGenerated()
    v = section.vals(overviewFixture())
    expect(v.staff[0].hasGenerated).toBe(false)
    expect(v.staff[0].generatedPin).toBe('')
  })

  it('a browser that refuses to copy says so (write it down instead)', async () => {
    const { section } = kioskSection({ copy: async () => false })
    ;(section.vals(overviewFixture()) as any).staff[0].generate()
    await flush()
    ;(section.vals(overviewFixture()) as any).staff[0].copy()
    await flush()
    expect((section.vals(overviewFixture()) as any).staff[0].copyFailed).toBe(true)
  })

  it('Remove asks first, then the PIN stops working', async () => {
    const { api, section, flashes } = kioskSection()
    ;(section.vals(overviewFixture()) as any).staff[0].remove()
    let v: any = section.vals(overviewFixture())
    expect(v.staff[0].removing).toBe(true)
    expect(v.staff[0].removeText).toBe('Remove Marco’s PIN? It stops opening the kiosk right away.')
    expect(api.calls.some((c) => c[0] === 'removePin')).toBe(false)
    v.staff[0].removeYes()
    await flush()
    expect(api.calls.find((c) => c[0] === 'removePin')![1]).toBe('emp-marco')
    expect(flashes).toEqual(['Marco R.’s PIN removed · it no longer opens the kiosk'])
    v = section.vals(overviewFixture())
    expect(v.staff[0].removing).toBe(false)
  })
})

describe('Settings → Kiosk → Browsers at the shop', () => {
  it('rename (with its version), lock, clear a lockout, remove after a confirm; Lock all after a confirm', async () => {
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
    expect(flashes).toContain('Bay tablet removed · a PIN typed there later makes it a new shop browser')
    v = section.vals(overviewFixture())
    v.lockAll()
    expect(api.calls.some((c) => c[0] === 'lockAll')).toBe(false)
    ;(section.vals(overviewFixture()) as any).lockAllYes()
    await flush()
    expect(flashes).toContain('2 kiosks locked')
  })

  it('this browser is named so', () => {
    const { section } = kioskSection()
    const v: any = section.vals(overviewFixture({ thisDeviceId: 'dev-1' }))
    expect(v.devices[0].name).toBe('Front desk tablet (this browser)')
  })

  it('without the permission nothing is sent', async () => {
    const { api, section } = kioskSection({ allowed: false })
    const v: any = section.vals(overviewFixture())
    v.modeToggle()
    v.addNetwork()
    v.lockAll()
    v.staff[0].toggle()
    v.staff[0].generate()
    v.staff[0].openSet()
    v.staff[0].remove()
    v.networks[1].clear()
    await flush()
    expect(api.calls).toEqual([])
    const w: any = section.vals(overviewFixture())
    expect(w.staff[0].editing).toBe(false)
    expect(w.staff[0].removing).toBe(false)
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
