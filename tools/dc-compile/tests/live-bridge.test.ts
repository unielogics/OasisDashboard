// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { compileScreens, SCREENS } from '../compile'
import { loadLogic } from '../../../src/dc/loadLogic'
import { LiveChrome } from '../../../src/auth/chrome'
import { makeSession } from '../../../src/auth/test-fixtures'
import { root } from './original-runtime'

const live = compileScreens(SCREENS, { root, variant: 'live', tplIds: false, allowComplexExpr: false })
const sourceOf = (s: (typeof SCREENS)[number]): string => {
  const src = live.perScreen[s]![`${s}.logic.ts`] as string
  return JSON.parse(src.slice(src.indexOf('= ') + 2)) as string
}

beforeAll(() => {
  process.env.TZ = 'America/New_York'
  vi.useFakeTimers({ now: new Date('2026-06-13T10:36:00-04:00') })
})
afterAll(() => vi.useRealTimers())
beforeEach(() => {
  localStorage.clear()
  delete (window as any).__oasisLive
  document.documentElement.removeAttribute('data-theme')
})
afterEach(() => {
  delete (window as any).__oasisLive
})

/** A host that behaves like DCHost: setState is synchronous, forceUpdate is observable. */
function attach(logic: any) {
  const forceUpdate = vi.fn()
  logic.__host = {
    __setLogicState(u: any) {
      logic.state = { ...logic.state, ...(typeof u === 'function' ? u(logic.state) : u) }
    },
    forceUpdate,
  }
  return forceUpdate
}

describe('live bridge on the original logic classes', () => {
  for (const s of SCREENS) {
    describe(s, () => {
      const Logic = loadLogic(sourceOf(s), s)

      it('adds `live` to renderVals() from window.__oasisLive and leaves every original key in place', () => {
        const orig = loadLogic(
          // the same script without the bridge
          sourceOf(s).slice(0, sourceOf(s).indexOf(';(function () {')),
          s,
        )
        const chrome = new LiveChrome()
        chrome.setSession(makeSession({ role: 'super' }))
        ;(window as any).__oasisLive = chrome
        const a = new Logic({}).renderVals()
        const b = new orig({}).renderVals()
        expect(a.live).toBe(chrome.vals())
        expect(a.live.user.short).toBe('Rafael M.')
        expect(Object.keys(a).filter((k) => k !== 'live')).toEqual(Object.keys(b))
        expect(b.live).toBeUndefined()
      })

      it('renders without a chrome store (live is an empty object, nothing throws)', () => {
        const v = new Logic({}).renderVals()
        expect(v.live).toEqual({})
      })

      it('toggleTheme still toggles, reports the change to the chrome and mirrors <html data-theme>', () => {
        const chrome = new LiveChrome()
        const themeChanged = vi.fn()
        chrome.bind({ signOut: vi.fn(), viewAs: vi.fn(), themeChanged })
        ;(window as any).__oasisLive = chrome
        const logic: any = new Logic({})
        attach(logic)
        expect(logic.state.theme).toBe('light')
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

      it('re-renders the screen when the store changes, only between mount and unmount', () => {
        const chrome = new LiveChrome()
        ;(window as any).__oasisLive = chrome
        const logic: any = new Logic({})
        const force = attach(logic)
        logic.componentDidMount()
        chrome.setSession(makeSession({ role: 'mgmt' }))
        expect(force).toHaveBeenCalledTimes(1)
        chrome.toggleUserMenu()
        expect(force).toHaveBeenCalledTimes(2)
        logic.componentWillUnmount()
        chrome.toggleUserMenu()
        expect(force).toHaveBeenCalledTimes(2)
      })

      it('still runs the original componentDidMount / componentWillUnmount', () => {
        const chrome = new LiveChrome()
        ;(window as any).__oasisLive = chrome
        const logic: any = new Logic({})
        attach(logic)
        const timers = vi.getTimerCount()
        logic.componentDidMount()
        if (s === 'operations') expect(logic._t).toBeDefined()
        logic.componentWillUnmount()
        expect(logic.__liveOff).toBeNull()
        expect(vi.getTimerCount()).toBe(timers)
      })
    })
  }

  it('the bridge is inert when the page has no chrome (parity/prod code path never installs one)', () => {
    const Logic = loadLogic(sourceOf('payments'), 'payments')
    const logic: any = new Logic({})
    attach(logic)
    expect(() => {
      logic.componentDidMount()
      logic.renderVals().toggleTheme()
      logic.componentWillUnmount()
    }).not.toThrow()
    expect(logic.state.theme).toBe('dark')
  })
})
