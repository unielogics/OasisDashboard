// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// The LIVE Settings template with Shop floor (ADR 0180; DV-1009..DV-1011): the nav group for those who may open it, the
// Kiosk section from GET /kiosk and Team activity, rendered with the view model's real values; every handler bound under
// live.kio and live.act exists. And without the permissions the group is not there.
import fs from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { compileScreens } from '../../../../tools/dc-compile/compile'
import { root } from '../../../../tools/dc-compile/tests/original-runtime'
import { ApiError } from '@/data/http/problem'
import type { KioskAdminApi } from '@/data/ports/kiosk-api'
import { createSettingsLogic } from '../Logic'
import { SettingsExtras } from './extras'
import { extendApi } from './extras-testkit'
import { setup } from './testkit'
import { activityFixture, overviewFixture } from './shopfloor-fixtures'

const tmp = path.join(root, 'tools/dc-compile/tests/.tmp-snippets/settings-shopfloor-render')
const text = (v: string | Buffer | undefined): string => (Buffer.isBuffer(v) ? v.toString('utf8') : (v ?? ''))
let render: (vals: any, ctx: { name: string }) => any
let bindings: { handlers: string[] }

beforeAll(async () => {
  process.env.TZ = 'America/New_York'
  const out = compileScreens(['settings'], { root, variant: 'live', tplIds: false, allowComplexExpr: false })
  const dir = path.join(tmp, 'gen')
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, buf] of Object.entries(out.perScreen.settings!)) fs.writeFileSync(path.join(dir, name), text(buf))
  const mod = await import(/* @vite-ignore */ path.join(dir, 'settings.tsx'))
  render = mod.default
  bindings = JSON.parse(text(out.perScreen.settings!['settings.bindings.json']))
})
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

const atPath = (vals: any, p: string): any => {
  let cur = vals
  for (const part of p.match(/[^.[\]]+/g) || []) {
    if (cur === null || cur === undefined) return undefined
    cur = cur[part]
  }
  return cur
}

function handlersExist(vals: any, prefix: string): void {
  for (const h of bindings.handlers.filter((x) => x.startsWith(prefix))) {
    const parts = h.split('[]')
    if (parts.length === 1) {
      expect(typeof atPath(vals, h), h).toBe('function')
      continue
    }
    let lists: any[] = [vals]
    for (let i = 0; i < parts.length - 1; i++) {
      const next: any[] = []
      for (const l of lists) {
        const arr = atPath(l, parts[i]!.replace(/^\./, ''))
        if (Array.isArray(arr)) next.push(...arr)
      }
      lists = next
    }
    for (const item of lists) expect(typeof atPath(item, parts.at(-1)!.replace(/^\./, '')), h).toBe('function')
  }
}

function kioskApi(): KioskAdminApi {
  return {
    overview: vi.fn(async () => overviewFixture()),
    setMode: vi.fn(),
    setPin: vi.fn(async (id: string) => ({ employeeId: id, setAt: '2026-10-13T14:00:00Z', pin: '24681357' })),
    removePin: vi.fn(),
    addNetwork: vi.fn(),
    removeNetwork: vi.fn(),
    clearNetworkLockout: vi.fn(),
    rename: vi.fn(),
    revoke: vi.fn(),
    lockDevice: vi.fn(),
    clearLockout: vi.fn(),
    lockAll: vi.fn(),
    setListed: vi.fn(),
    activity: vi.fn(async (q: any) => ({ ...activityFixture(), from: q.from, to: q.to })),
    events: vi.fn(async () => ({ items: [], nextCursor: null })),
  } as any
}

function make(role: 'mgmt' | 'crew' | 'super' | 'support' | 'acct' = 'mgmt', api = kioskApi()) {
  const s = setup({ role })
  extendApi(s)
  const extras = new SettingsExtras({
    api: s.api,
    qc: s.qc,
    session: () => (s.data as any).sessionOf(),
    schedule: (fn) => fn(),
    kioskApi: api,
    navigate: vi.fn(),
  })
  const logic: any = new (createSettingsLogic(s.data, extras))({})
  const rerender = () => queueMicrotask(() => logic.renderVals())
  logic.__host = {
    __setLogicState(update: any, cb?: () => void) {
      const patch = typeof update === 'function' ? update(logic.state) : update
      logic.state = { ...logic.state, ...patch }
      rerender()
      cb?.()
    },
    forceUpdate: rerender,
  }
  logic.componentDidMount()
  return { logic, api }
}

describe('Settings live template: Shop floor', () => {
  it('no nav entry (the nav has no room at 1000 px, DV-1009): the design nav is unchanged', () => {
    const { logic } = make('mgmt')
    const html = renderToStaticMarkup(render(logic.renderVals(), { name: 'settings' }))
    expect(html).not.toContain('Shop floor')
    expect(html).not.toContain('>Team activity<')
    expect(html).not.toContain('>Kiosk<')
  })

  it('the Kiosk | Team activity tabs over either section, for a person who may open both', async () => {
    const { logic } = make('mgmt')
    logic.renderVals().live.goKiosk()
    await vi.waitFor(() => expect(logic.renderVals().live.secKiosk).toBe(true))
    const v = logic.renderVals()
    expect(v.live.shopTabs.show).toBe(true)
    expect(v.live.shopTabs.tabs.map((t: any) => t.label)).toEqual(['Kiosk', 'Team activity'])
    const html = renderToStaticMarkup(render(v, { name: 'settings' }))
    expect(html).toContain('>Team activity<')
    v.live.shopTabs.tabs[1].onClick()
    await vi.waitFor(() => expect(logic.renderVals().live.secActivity).toBe(true))
    // elsewhere in Settings: no tabs
    logic.setState({ section: 'hours' })
    expect(logic.renderVals().live.shopTabs.show).toBe(false)
  })

  it('a role with Team activity only (no team.roles) gets the report and no tabs; Kiosk is locked', async () => {
    const { logic } = make('mgmt')
    const s = (logic as any).data.sessionOf()
    s.permissions['team.roles'] = { on: false }
    logic.setState({ section: 'activity' })
    await vi.waitFor(() => expect(logic.renderVals().live.secActivity).toBe(true))
    expect(logic.renderVals().live.shopTabs.show).toBe(false)
    logic.setState({ section: 'kiosk' })
    expect(logic.renderVals().live.secKiosk).toBe(false)
  })

  it('the Kiosk section from GET /kiosk: mode, Shop network, Staff PINs, Browsers at the shop, recent events', async () => {
    const { logic } = make('mgmt')
    logic.renderVals().live.goKiosk()
    await vi.waitFor(() => expect(logic.renderVals().live.secKiosk).toBe(true))
    const vals = logic.renderVals()
    handlersExist(vals, 'live.kio.')
    const html = renderToStaticMarkup(render(vals, { name: 'settings' }))
    for (const s of [
      '>Kiosk mode<',
      'On. The sign-in page is the PIN keypad',
      '>Shop network<',
      'Your connection: 73.12.4.9',
      'This is the shop’s network',
      'Do this from a phone or computer connected to the shop Wi-Fi — not mobile data.',
      'Shop Wi-Fi',
      '73.12.4.80 · added Oct 1 by Amara O.',
      'Locked out · too many wrong PINs',
      'PIN tried from a new network',
      'Front desk tablet tried from a new network — your internet provider probably changed the shop’s address',
      'Not from a shop browser — only add it if you know this address is the shop’s',
      'Add this network',
      '>Staff PINs<',
      'Marco R.',
      'PIN set Oct 1 by Rafael M.',
      'Change PIN',
      'Set PIN',
      'Generate',
      'Remove PIN',
      'title="Shows on the kiosk"',
      '>Browsers at the shop<',
      'Lock all kiosks',
      'Front desk tablet',
      'Opened by Marco R.',
      'Unlocked · locks 9:00 PM',
      'Bay tablet',
      'Clear lockout',
      'Recent kiosk events',
      'Oct 13, 8:00 AM · Unlocked · Front desk tablet · Opened by Marco R.',
    ])
      expect(html, s).toContain(s)
    for (const s of ['Old tablet', 'Old P.', 'Make this a kiosk', 'Shop code', 'Only a Super Admin can change the shop network'])
      expect(html, s).not.toContain(s)
    // the PIN form
    vals.live.kio.staff[1].openSet()
    const open = renderToStaticMarkup(render(logic.renderVals(), { name: 'settings' }))
    expect(open).toContain('New PIN (8 digits)')
    expect(open).toContain('Type it again')
    expect(open).toContain('type="password"')
    // a generated PIN, once
    logic.renderVals().live.kio.staff[0].generate()
    await vi.waitFor(() => expect(logic.renderVals().live.kio.staff[0].hasGenerated).toBe(true))
    const gen = renderToStaticMarkup(render(logic.renderVals(), { name: 'settings' }))
    expect(gen).toContain('2468 1357')
    expect(gen).toContain('Write it down now and give it to them. It isn’t shown again.')
    expect(gen).toContain('>Copy<')
  })

  it('a manager who is not a Super Admin sees Shop network read only', async () => {
    const api = kioskApi()
    ;(api.overview as any).mockImplementation(async () => overviewFixture({ canManageNetworks: false }))
    const { logic } = make('mgmt', api)
    logic.renderVals().live.goKiosk()
    await vi.waitFor(() => expect(logic.renderVals().live.secKiosk).toBe(true))
    const html = renderToStaticMarkup(render(logic.renderVals(), { name: 'settings' }))
    expect(html).toContain('Only a Super Admin can change the shop network')
    expect(html).toContain('This connection isn’t a shop network.')
    expect(html).not.toContain('This is the shop’s network')
    expect(html).not.toContain('Add this network')
    expect(html).toContain('Clear lockout')
  })

  it('on a shop network it says so instead of the button', async () => {
    const api = kioskApi()
    ;(api.overview as any).mockImplementation(async () =>
      overviewFixture({ yourAddress: '73.12.4.80', yourAddressIsShop: true, refused: [] }),
    )
    const { logic } = make('mgmt', api)
    logic.renderVals().live.goKiosk()
    await vi.waitFor(() => expect(logic.renderVals().live.secKiosk).toBe(true))
    const html = renderToStaticMarkup(render(logic.renderVals(), { name: 'settings' }))
    expect(html).toContain('This is the shop’s network. PINs work here.')
    expect(html).not.toContain('>This is the shop’s network<')
    expect(html).not.toContain('PIN tried from a new network')
  })

  it('Team activity: chips, the table and the not-built notice', async () => {
    const { logic, api } = make('mgmt')
    logic.renderVals().live.goActivity()
    await vi.waitFor(() => expect(logic.renderVals().live.act.ready).toBe(true))
    const vals = logic.renderVals()
    handlersExist(vals, 'live.act.')
    const html = renderToStaticMarkup(render(vals, { name: 'settings' }))
    for (const s of ['>Today<', '>Yesterday<', '>This week<', '>Last week<', '>Custom<', 'Avg bay time', 'Marco R.', '41 min', '2 · $90.00'])
      expect(html, s).toContain(s)
    ;(api.activity as any).mockImplementation(async () => {
      throw new ApiError({ status: 501, code: 'NOT_BUILT', title: 'Not ready yet' })
    })
    vals.live.act.chips[1].onClick()
    await vi.waitFor(() => expect(logic.renderVals().live.act.notBuilt).toBe(true))
    expect(renderToStaticMarkup(render(logic.renderVals(), { name: 'settings' }))).toContain(
      'Team activity isn’t ready yet.',
    )
  })

  it('#kiosk and #activity open the sections (the user menu’s entries), also while Settings is open', async () => {
    location.hash = '#kiosk'
    try {
      const { logic } = make('mgmt')
      expect(logic.state.section).toBe('kiosk')
      location.hash = '#activity'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
      expect(logic.state.section).toBe('activity')
      logic.componentWillUnmount()
    } finally {
      location.hash = ''
    }
  })
})
