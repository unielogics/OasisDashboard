import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { HELD_TIMER_MS, timerControlScript } from './live'

type Fn = (...a: unknown[]) => unknown

/** A window with a settable Date.now and real timers that are recorded instead of scheduled. */
function sandbox() {
  const real: Array<{ id: number; fn: () => void; ms: number }> = []
  let n = 0
  let now = 1_000_000
  const win: Record<string, unknown> = {
    setTimeout: (fn: () => void, ms: number) => {
      real.push({ id: ++n, fn, ms })
      return n
    },
    clearTimeout: (id: number) => {
      const i = real.findIndex((t) => t.id === id)
      if (i >= 0) real.splice(i, 1)
    },
    Date: { now: () => now },
    Map,
    Math,
    Number,
    Array,
  }
  win.window = win
  vm.runInNewContext(timerControlScript(HELD_TIMER_MS), win)
  const w = win as Record<string, Fn>
  return {
    w,
    real,
    setNow: (t: number) => void (now = t),
    /** what the harness does on runFor(ms): fire every due timer at its own instant */
    advance(ms: number, seen: number[]) {
      const end = now + ms
      for (;;) {
        const due = w.__parityDue!(end) as Array<[number, number]>
        if (!due.length) break
        now = Math.max(now, due[0]![1])
        seen.push(now)
        w.__parityFire!(due[0]![0])
      }
      now = end
    },
  }
}

describe('live mode: page timers follow the scenario clock', () => {
  it('a long timer (a toast) waits for runFor; a short one also runs in real time, once', () => {
    const { w, real, advance } = sandbox()
    const fired: string[] = []
    w.setTimeout!(() => fired.push('short'), 250)
    w.setTimeout!(() => fired.push('toast'), 3200)
    expect(real.map((t) => t.ms)).toEqual([250])
    real[0]!.fn() // the real timer fires during a settle
    expect(fired).toEqual(['short'])
    advance(3000, [])
    expect(fired).toEqual(['short'])
    advance(300, [])
    expect(fired).toEqual(['short', 'toast'])
  })

  it('runFor fires due timers in order at their own instant (a 380 ms long-press inside a 400 ms advance)', () => {
    const { w, real, advance } = sandbox()
    const at: number[] = []
    const order: string[] = []
    w.setTimeout!(() => order.push('press'), 380)
    w.setTimeout!(() => order.push('later'), 900)
    w.setTimeout!(() => {
      order.push('first')
      w.setTimeout!(() => order.push('chained'), 50)
    }, 100)
    advance(400, at)
    expect(order).toEqual(['first', 'chained', 'press'])
    expect(at).toEqual([1_000_100, 1_000_150, 1_000_380])
    // a timer fired by the harness never fires again from its real schedule
    for (const t of real.splice(0)) t.fn()
    expect(order).toEqual(['first', 'chained', 'press', 'later'])
  })

  it('clearTimeout cancels a recorded timer, and the arguments pass through', () => {
    const { w, advance } = sandbox()
    const got: unknown[] = []
    const id = w.setTimeout!(() => got.push('cleared'), 5000)
    w.setTimeout!((a: unknown, b: unknown) => got.push([a, b]), 4000, 1, 'x')
    w.clearTimeout!(id)
    advance(6000, [])
    expect(got).toEqual([[1, 'x']])
  })
})
