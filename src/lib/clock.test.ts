import { describe, expect, it } from 'vitest'
import { ServerClock } from './clock'

describe('ServerClock', () => {
  it('is the client clock until synced', () => {
    const c = new ServerClock(() => 1000)
    expect(c.now()).toBe(1000)
    expect(c.isSynced).toBe(false)
  })
  it('applies the offset between the server stamp and the client clock', () => {
    let client = 1_000_000
    const c = new ServerClock(() => client)
    c.sync(1_000_000 + 5_000) // the device is 5 s slow
    expect(c.offset).toBe(5_000)
    expect(c.now()).toBe(1_005_000)
    client += 2_000
    expect(c.now()).toBe(1_007_000) // keeps ticking with the client clock
  })
  it('accepts ISO strings and brackets the request to approximate the server instant', () => {
    const c = new ServerClock(() => 0)
    // the server stamped 10:00:00.000Z; the request left at t=100 and the reply arrived at t=300 (midpoint 200)
    const server = Date.parse('2026-06-13T10:00:00.000Z')
    c.sync('2026-06-13T10:00:00.000Z', 100, 300)
    expect(c.offset).toBe(server - 200)
  })
  it('ignores an unparsable server time and can be reset', () => {
    const c = new ServerClock(() => 50)
    c.sync('not a date')
    expect(c.isSynced).toBe(false)
    c.sync(150)
    expect(c.now()).toBe(150)
    c.reset()
    expect(c.now()).toBe(50)
    expect(c.rawNow()).toBe(50)
  })
  it('a client clock a day off still yields the server day', () => {
    const c = new ServerClock(() => Date.parse('2026-06-14T10:36:00-04:00'))
    c.sync('2026-06-13T10:36:00-04:00')
    expect(new Date(c.now()).toISOString()).toBe('2026-06-13T14:36:00.000Z')
  })
})
