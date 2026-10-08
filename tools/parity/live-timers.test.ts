import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { HELD_TIMER_MS, holdLongTimersScript } from './live'

/** A window whose real timers are recorded instead of scheduled. */
function sandbox() {
  const real: Array<{ id: number; fn: () => void; ms: number }> = []
  let n = 0
  const win: Record<string, unknown> = {
    setTimeout: (fn: () => void, ms: number) => {
      real.push({ id: ++n, fn, ms })
      return n
    },
    clearTimeout: (id: number) => {
      const i = real.findIndex((t) => t.id === id)
      if (i >= 0) real.splice(i, 1)
    },
  }
  win.window = win
  vm.runInNewContext(holdLongTimersScript(HELD_TIMER_MS), win)
  const flush = () => real.splice(0).forEach((t) => t.fn())
  return { win: win as Record<string, (...a: unknown[]) => unknown>, real, flush }
}

describe('live mode: long page timers follow runFor', () => {
  it('short timers stay real; a toast-length timer waits for the harness to move time on', () => {
    const { win, real, flush } = sandbox()
    const fired: string[] = []
    win.setTimeout!(() => fired.push('short'), 250)
    win.setTimeout!(() => fired.push('toast'), 3200)
    expect(real.map((t) => t.ms)).toEqual([250])
    flush()
    expect(fired).toEqual(['short'])
    expect(win.__parityAdvance!(3000)).toBe(0)
    expect(win.__parityAdvance!(300)).toBe(1)
    flush()
    expect(fired).toEqual(['short', 'toast'])
  })

  it('clearTimeout cancels a held timer, and passes the arguments through', () => {
    const { win, flush } = sandbox()
    const got: unknown[] = []
    const id = win.setTimeout!(() => got.push('cleared'), 5000)
    win.setTimeout!((a: unknown, b: unknown) => got.push([a, b]), 4000, 1, 'x')
    win.clearTimeout!(id)
    win.__parityAdvance!(6000)
    flush()
    expect(got).toEqual([[1, 'x']])
  })
})
