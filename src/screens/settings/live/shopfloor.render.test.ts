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
    setCode: vi.fn(),
    register: vi.fn(),
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
  it('the nav group last in the nav (no design entry moves), with Kiosk and Team activity, for a manager', () => {
    const { logic } = make('mgmt')
    const html = renderToStaticMarkup(render(logic.renderVals(), { name: 'settings' }))
    expect(html).toContain('>Shop floor<')
    expect(html.indexOf('Oasis AI assistant')).toBeLessThan(html.indexOf('>Shop floor<'))
    expect(html.indexOf('Prices &amp; memberships')).toBeLessThan(html.indexOf('>Shop floor<'))
    expect(html.indexOf('>Shop floor<')).toBeLessThan(html.indexOf('>Kiosk<'))
    expect(html).toContain('>Team activity<')
  })

  it('no Shop floor for a role without team.roles or team.edit', () => {
    const { logic } = make('acct')
    const html = renderToStaticMarkup(render(logic.renderVals(), { name: 'settings' }))
    expect(html).not.toContain('>Shop floor<')
  })

  it('the Kiosk section from GET /kiosk', async () => {
    const { logic } = make('mgmt')
    logic.renderVals().live.goKiosk()
    await vi.waitFor(() => expect(logic.renderVals().live.secKiosk).toBe(true))
    const vals = logic.renderVals()
    handlersExist(vals, 'live.kio.')
    const html = renderToStaticMarkup(render(vals, { name: 'settings' }))
    for (const s of [
      '>Kiosk mode<',
      'Off. Everyone signs in with their email and password.',
      '>Shop code<',
      'Set Oct 1 by Rafael M. · 12 days ago',
      'Change code',
      'Generate a code',
      '>This tablet<',
      'Make this a kiosk',
      '>Kiosk tablets<',
      'Lock all kiosks',
      'Front desk tablet',
      'Unlocked · locks 9:00 PM',
      'Bay tablet',
      'Clear lockout',
      'Who shows on the kiosk',
      'Marco R.',
      'Invited · no login yet',
      'Recent kiosk events',
    ])
      expect(html, s).toContain(s)
    expect(html).not.toContain('Old tablet')
    expect(html).not.toContain('Old P.')
    // the code form
    vals.live.kio.openCode()
    const open = renderToStaticMarkup(render(logic.renderVals(), { name: 'settings' }))
    expect(open).toContain('New code (8 digits)')
    expect(open).toContain('Changing the code locks every kiosk now.')
    expect(open).toContain('type="password"')
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

  it('#kiosk opens the Kiosk section (the user menu’s “Make this a kiosk…”)', () => {
    location.hash = '#kiosk'
    try {
      const { logic } = make('mgmt')
      expect(logic.state.section).toBe('kiosk')
    } finally {
      location.hash = ''
    }
  })
})
