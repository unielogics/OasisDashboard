// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// The live variant: the class itself does what the compiler's appended bridge did to the original (live values in
// renderVals(), re-render on store changes, theme report, API toasts through flash()). The oracle is the original
// source with that very bridge appended (tools/dc-compile/live-bridge.ts).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { withLiveBridge } from '../../../tools/dc-compile/live-bridge'
import { makeSession } from '@/auth/test-fixtures'
import { originalSource } from './testkit'

beforeAll(() => {
  process.env.TZ = 'America/New_York'
})
beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-06-13T10:36:00-04:00') })
  localStorage.clear()
  delete (window as any).__oasisLive
  document.documentElement.removeAttribute('data-theme')
})
afterEach(() => {
  delete (window as any).__oasisLive
  vi.useRealTimers()
  vi.unstubAllEnvs()
})
afterAll(() => vi.useRealTimers())

async function setup(live: boolean) {
  vi.resetModules()
  if (live) vi.stubEnv('NEXT_PUBLIC_VARIANT', 'live')
  const { createPaymentsLogic } = await import('./Logic')
  const { FixtureData } = await import('./fixtures')
  const { LiveChrome } = await import('@/auth/chrome')
  const { toasts } = await import('@/data/toast')
  const { loadLogic } = await import('@/dc/loadLogic')
  const { attach } = await import('./testkit')
  const chrome = new LiveChrome()
  chrome.setSession(makeSession({ role: 'super' }))
  const orig: any = new (loadLogic(withLiveBridge(originalSource, 'payments'), 'payments'))({})
  const port: any = new (createPaymentsLogic(new FixtureData()))({})
  const oh = attach(orig)
  const ph = attach(port)
  return { chrome, orig, port, oh, ph, toasts }
}

describe('live variant', () => {
  it('adds `live` last, from window.__oasisLive, exactly like the bridge', async () => {
    const { chrome, orig, port } = await setup(true)
    ;(window as any).__oasisLive = chrome
    const a = port.renderVals()
    const b = orig.renderVals()
    expect(Object.keys(a)).toEqual(Object.keys(b))
    expect(Object.keys(a).at(-1)).toBe('live')
    expect(a.live).toBe(chrome.vals())
    expect(b.live).toBe(chrome.vals())
  })

  it('renders with an empty live object when no chrome store is installed', async () => {
    const { orig, port } = await setup(true)
    expect(port.renderVals().live).toEqual({})
    expect(orig.renderVals().live).toEqual({})
  })

  it('the default and parity builds add no `live` key', async () => {
    const { chrome, port } = await setup(false)
    ;(window as any).__oasisLive = chrome
    expect('live' in port.renderVals()).toBe(false)
    expect(document.documentElement.getAttribute('data-theme')).toBeNull()
    port.componentDidMount()
    chrome.toggleUserMenu()
    expect(port.__host).toBeDefined()
  })

  it('toggleTheme toggles, saves, reports to the chrome and mirrors <html data-theme>', async () => {
    const { chrome, orig, port } = await setup(true)
    const themeChanged = vi.fn()
    chrome.bind({ signOut: vi.fn(), viewAs: vi.fn(), themeChanged })
    ;(window as any).__oasisLive = chrome
    for (const l of [orig, port]) {
      const v = l.renderVals()
      expect(document.documentElement.getAttribute('data-theme')).toBe('light')
      v.toggleTheme()
      expect(l.state.theme).toBe('dark')
      expect(themeChanged).toHaveBeenLastCalledWith('dark', 'light')
      expect(localStorage.getItem('oasis-theme')).toBe('dark')
      l.renderVals()
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
      l.renderVals().toggleTheme()
      expect(themeChanged).toHaveBeenLastCalledWith('light', 'dark')
      l.renderVals()
      localStorage.clear()
    }
    expect(themeChanged).toHaveBeenCalledTimes(4)
  })

  it('re-renders on store changes only between mount and unmount', async () => {
    const { chrome, orig, port, oh, ph } = await setup(true)
    ;(window as any).__oasisLive = chrome
    for (const [l, h] of [
      [orig, oh],
      [port, ph],
    ] as const) {
      l.componentDidMount()
      chrome.toggleUserMenu()
      chrome.toggleUserMenu()
      expect(h.forced()).toBe(2)
      l.componentWillUnmount()
      chrome.toggleUserMenu()
      expect(h.forced()).toBe(2)
    }
  })

  it('API toasts appear through flash() as one line and stop after unmount', async () => {
    const { chrome, orig, port, toasts } = await setup(true)
    ;(window as any).__oasisLive = chrome
    for (const l of [orig, port]) l.componentDidMount()
    toasts.emit({ title: 'Your role can’t issue refunds' })
    expect(port.state.toast).toBe(orig.state.toast)
    expect(port.state.toast).toBe('Your role can’t issue refunds')
    toasts.emit({ title: 'Connection lost', desc: 'retrying' })
    expect(port.state.toast).toBe('Connection lost · retrying')
    expect(orig.state.toast).toBe('Connection lost · retrying')
    for (const l of [orig, port]) l.componentWillUnmount()
    toasts.emit({ title: 'After unmount' })
    expect(port.state.toast).toBe('Connection lost · retrying')
  })

  it('unmounting clears the pending toast timer (the original leaves it running)', async () => {
    const { port } = await setup(false)
    port.flash('hello')
    expect(vi.getTimerCount()).toBe(1)
    port.componentWillUnmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
