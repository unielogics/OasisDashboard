// @vitest-environment jsdom
import fs from 'node:fs'
import path from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Screen from './Screen'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement
let root: Root
beforeEach(() => {
  process.env.TZ = 'America/New_York'
  vi.useFakeTimers({ now: new Date('2026-06-13T10:36:00-04:00') })
  localStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('Operations screen', () => {
  it('does not evaluate the design source at runtime', () => {
    const src = fs.readFileSync(path.resolve(__dirname, 'Screen.tsx'), 'utf8')
    expect(src).not.toMatch(/loadLogic|logicSource|new Function|createScreen/)
  })

  it('renders the Command Center from the typed view model and reacts to clicks and the tick', () => {
    act(() => root.render(createElement(Screen)))
    const text = () => container.textContent ?? ''
    expect(text()).toContain('Live · 10:36 AM')
    expect(text()).toContain('Appointments 24h')
    expect(text()).toContain('Jonathan Franco')
    const bayTab = [...container.querySelectorAll('button')].find((b) =>
      /^\s*Bay Board/.test(b.textContent ?? ''),
    )!
    act(() => bayTab.click())
    expect(text()).toContain('Up Next')
    act(() => {
      vi.advanceTimersByTime(61000)
    })
    expect(text()).toContain('Live · 10:37 AM')
    expect(container.querySelector('#dc-root .sc-host')).not.toBeNull()
  })

  it('unmounting removes the tick and the window listeners', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    act(() => root.render(createElement(Screen)))
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    const keydown = add.mock.calls.filter(([t]) => t === 'keydown').length
    act(() => root.unmount())
    expect(vi.getTimerCount()).toBe(0)
    expect(remove.mock.calls.filter(([t]) => t === 'keydown').length).toBe(keydown)
    root = createRoot(container)
  })
})
