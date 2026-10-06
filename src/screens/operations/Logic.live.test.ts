// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// In the live build the class does what tools/dc-compile/live-bridge.ts does to the original classes. Each behaviour is
// checked against the ORIGINAL class with the compiler's own bridge appended.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveChrome } from '@/auth/chrome'
import { makeSession } from '@/auth/test-fixtures'
import { toasts } from '@/data/toast'
import { loadLogic } from '@/dc/loadLogic'
import { serializeVals } from '@/dc/serialize'
import { withLiveBridge } from '../../../tools/dc-compile/live-bridge'
import { attach, originalSource } from './testkit'
import type { Ctor } from './testkit'

let Port: Ctor
let Bridged: Ctor
let Plain: Ctor

beforeAll(async () => {
  process.env.TZ = 'America/New_York'
  vi.stubEnv('NEXT_PUBLIC_VARIANT', 'live')
  vi.resetModules()
  const { OperationsLogic } = await import('./Logic')
  const { FixtureData } = await import('./fixtures')
  Port = class extends OperationsLogic {
    constructor(p?: any) {
      super(p, new FixtureData())
    }
  } as unknown as Ctor
  Bridged = loadLogic(withLiveBridge(originalSource(), 'operations'), 'operations-live') as unknown as Ctor
  Plain = loadLogic(originalSource(), 'operations') as unknown as Ctor
})
afterAll(() => vi.unstubAllEnvs())
beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-06-13T10:36:00-04:00') })
  localStorage.clear()
  delete (window as any).__oasisLive
  document.documentElement.removeAttribute('data-theme')
})
afterEach(() => {
  vi.useRealTimers()
  delete (window as any).__oasisLive
})

describe.each([
  ['port', () => Port],
  ['original + bridge', () => Bridged],
])('%s in the live build', (_name, get) => {
  it('adds `live` last, from window.__oasisLive, and leaves every other key in place', () => {
    const chrome = new LiveChrome()
    chrome.setSession(makeSession({ role: 'super' }))
    ;(window as any).__oasisLive = chrome
    const v = new (get())({}).renderVals()
    expect(v.live).toBe(chrome.vals())
    expect(v.live.user.short).toBe('Rafael M.')
    expect(Object.keys(v).at(-1)).toBe('live')
    expect(Object.keys(v).filter((k) => k !== 'live')).toEqual(Object.keys(new Plain({}).renderVals()))
  })

  it('renders without a chrome store', () => {
    expect(new (get())({}).renderVals().live).toEqual({})
  })

  it('toggleTheme toggles, reports the change and mirrors <html data-theme>', () => {
    const chrome = new LiveChrome()
    const themeChanged = vi.fn()
    chrome.bind({ signOut: vi.fn(), viewAs: vi.fn(), themeChanged })
    ;(window as any).__oasisLive = chrome
    const logic: any = new (get())({})
    attach(logic)
    let v = logic.renderVals()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    v.toggleTheme()
    expect(logic.state.theme).toBe('dark')
    expect(themeChanged).toHaveBeenCalledWith('dark', 'light')
    expect(localStorage.getItem('oasis-theme')).toBe('dark')
    v = logic.renderVals()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    v.toggleTheme()
    expect(themeChanged).toHaveBeenLastCalledWith('light', 'dark')
    expect(themeChanged).toHaveBeenCalledTimes(2)
  })

  it('re-renders when the store changes, only between mount and unmount; API toasts reach flash()', () => {
    const chrome = new LiveChrome()
    ;(window as any).__oasisLive = chrome
    const logic: any = new (get())({})
    const host = attach(logic)
    logic.componentDidMount()
    const base = host.updates
    chrome.setSession(makeSession({ role: 'mgmt' }))
    expect(host.updates).toBe(base + 1)
    toasts.emit({ title: 'Connection lost', desc: 'retrying' })
    expect(logic.state.toast).toEqual({ title: 'Connection lost', desc: 'retrying' })
    toasts.emit({ title: 'Your role can’t issue refunds' })
    expect(logic.state.toast).toEqual({ title: 'Your role can’t issue refunds', desc: undefined })
    logic.componentWillUnmount()
    const after = host.updates
    chrome.toggleUserMenu()
    toasts.emit({ title: 'After unmount' })
    expect(host.updates).toBe(after)
    expect(logic.state.toast).toEqual({ title: 'Your role can’t issue refunds', desc: undefined })
    const tick = logic.state.tick
    vi.advanceTimersByTime(5000)
    expect(logic.state.tick).toBe(tick) // the 1 s tick is gone with the unmount
  })

  it('the original behaviour is intact: same values as the original class apart from `live`', () => {
    const chrome = new LiveChrome()
    ;(window as any).__oasisLive = chrome
    const a: any = new (get())({})
    const b: any = new Plain({})
    const strip = (o: any) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'live'))
    expect(serializeVals(strip(a.renderVals()))).toEqual(serializeVals(b.renderVals()))
  })
})
