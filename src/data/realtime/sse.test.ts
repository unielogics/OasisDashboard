import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RealtimeClient } from './sse'
import type { EventSourceLike, RealtimeEvent, RealtimeOptions, SseMessage, StreamStatus } from './sse'

class FakeSource implements EventSourceLike {
  static all: FakeSource[] = []
  readyState = 0
  onopen: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  closed = false
  private listeners = new Map<string, Array<(e: SseMessage) => void>>()
  constructor(readonly url: string) {
    FakeSource.all.push(this)
  }
  addEventListener(type: string, fn: (e: SseMessage) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  close() {
    this.closed = true
    this.readyState = 2
  }
  open() {
    this.readyState = 1
    this.onopen?.({})
  }
  fail() {
    this.readyState = 0
    this.onerror?.({})
  }
  emit(type: string, data: unknown, lastEventId = '') {
    for (const l of this.listeners.get(type) ?? [])
      l({ data: typeof data === 'string' ? data : JSON.stringify(data), lastEventId })
  }
  event(id: number, channel: string, type: string, payload: Record<string, unknown> = {}) {
    this.emit('message', { channel, type, payload, at: '2026-06-13T14:36:00.000Z' }, String(id))
  }
  static get last() {
    return FakeSource.all.at(-1)!
  }
}

function setup(over: Partial<RealtimeOptions> = {}) {
  const events: RealtimeEvent[] = []
  const status: Array<[StreamStatus, StreamStatus]> = []
  const resyncs: string[] = []
  const polls = vi.fn()
  const suspect = vi.fn()
  const client = new RealtimeClient({
    createSource: (u) => new FakeSource(u),
    random: () => 1,
    onEvent: (e) => events.push(e),
    onResync: (r) => resyncs.push(r),
    onStatus: (s, p) => status.push([s, p]),
    onPoll: polls,
    onSuspectAuth: suspect,
    ...over,
  })
  return { client, events, status, resyncs, polls, suspect }
}

beforeEach(() => {
  FakeSource.all = []
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('connecting and receiving', () => {
  it('opens /api/v1/events with the channels and no cursor, goes connecting -> up on open', () => {
    const { client, status } = setup({ channels: ['ops', 'settings'] })
    client.start()
    expect(FakeSource.all).toHaveLength(1)
    expect(FakeSource.last.url).toBe('/api/v1/events?channels=ops%2Csettings')
    expect(client.status).toBe('connecting')
    FakeSource.last.open()
    expect(client.status).toBe('up')
    expect(status).toEqual([
      ['connecting', 'idle'],
      ['up', 'connecting'],
    ])
  })

  it('parses event frames, tracks the id and ignores junk', () => {
    const { client, events } = setup()
    client.start()
    const s = FakeSource.last
    s.open()
    s.event(5, 'ops', 'appointment.updated', { id: 'a1', version: 3 })
    s.emit('message', 'not json', '6')
    s.emit('message', { type: 'x' }, '7')
    s.emit('message', [1, 2], '8')
    s.event(9, 'payments', 'invoice.updated')
    expect(events.map((e) => [e.id, e.channel, e.type])).toEqual([
      [5, 'ops', 'appointment.updated'],
      [9, 'payments', 'invoice.updated'],
    ])
    expect(events[0]!.payload).toEqual({ id: 'a1', version: 3 })
    expect(client.lastEventId).toBe(9)
  })

  it('a ready frame marks the stream up even before onopen and records the cursor', () => {
    const { client } = setup()
    client.start()
    FakeSource.last.emit('ready', { channels: ['ops'], denied: [], cursor: 42, heartbeatMs: 20000 }, '42')
    expect(client.status).toBe('up')
    expect(client.lastEventId).toBe(42)
  })

  it('start() twice does not open a second stream; stop() closes and ignores later frames', () => {
    const { client, events } = setup()
    client.start()
    client.start()
    expect(FakeSource.all).toHaveLength(1)
    const s = FakeSource.last
    s.open()
    client.stop()
    expect(s.closed).toBe(true)
    expect(client.status).toBe('stopped')
    s.event(1, 'ops', 'x')
    vi.advanceTimersByTime(10 * 60_000)
    expect(events).toEqual([])
    expect(FakeSource.all).toHaveLength(1)
  })
})

describe('reconnect with exponential backoff and Last-Event-ID resume', () => {
  it('an error closes the stream, marks it down and retries after 1 s, 2 s, 4 s ... capped at 30 s', () => {
    const { client } = setup()
    client.start()
    FakeSource.last.open()
    FakeSource.last.event(11, 'ops', 'x')
    FakeSource.last.fail()
    expect(client.status).toBe('down')
    expect(FakeSource.all[0]!.closed).toBe(true)
    const waits: number[] = []
    for (let i = 0; i < 8; i++) {
      const before = FakeSource.all.length
      let waited = 0
      while (FakeSource.all.length === before) {
        vi.advanceTimersByTime(250)
        waited += 250
        if (waited > 60_000) throw new Error('no reconnect')
      }
      waits.push(waited)
      FakeSource.last.fail()
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000])
  })

  it('jitter spreads the delay between 50% and 100% of the backoff', () => {
    for (const [r, want] of [
      [0, 500],
      [0.5, 750],
      [1, 1000],
    ] as const) {
      FakeSource.all = []
      const { client } = setup({ random: () => r })
      client.start()
      FakeSource.last.fail()
      vi.advanceTimersByTime(want - 1)
      expect(FakeSource.all, `r=${r} early`).toHaveLength(1)
      vi.advanceTimersByTime(1)
      expect(FakeSource.all, `r=${r}`).toHaveLength(2)
      client.stop()
    }
  })

  it('resumes with ?lastEventId=<n>, reports reconnected, stops polling and resets the backoff', () => {
    const { client, resyncs, polls, status } = setup({ channels: ['ops'], pollMs: 20_000, watchdogMs: 0 })
    client.start()
    FakeSource.last.open()
    FakeSource.last.event(31, 'ops', 'x')
    FakeSource.last.fail()
    vi.advanceTimersByTime(1000)
    expect(FakeSource.last.url).toBe('/api/v1/events?channels=ops&lastEventId=31')
    FakeSource.last.open()
    expect(client.status).toBe('up')
    expect(resyncs).toEqual(['reconnected'])
    expect(status.at(-1)).toEqual(['up', 'down'])
    vi.advanceTimersByTime(120_000)
    expect(polls).not.toHaveBeenCalled()
    // the next failure starts again at 1 s
    FakeSource.last.fail()
    vi.advanceTimersByTime(1000)
    expect(FakeSource.all).toHaveLength(3)
  })

  it('polls every pollMs while down and not before', () => {
    const { client, polls } = setup({ pollMs: 20_000, backoffBaseMs: 100_000, backoffMaxMs: 100_000 })
    client.start()
    FakeSource.last.open()
    FakeSource.last.fail()
    vi.advanceTimersByTime(19_999)
    expect(polls).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(polls).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(40_000)
    expect(polls).toHaveBeenCalledTimes(3)
  })

  it('a throwing EventSource constructor is a failure like any other', () => {
    let n = 0
    const { client } = setup({
      createSource: (u) => {
        if (n++ === 0) throw new Error('blocked')
        return new FakeSource(u)
      },
    })
    client.start()
    expect(client.status).toBe('down')
    vi.advanceTimersByTime(1000)
    expect(FakeSource.all).toHaveLength(1)
  })

  it('reconnectNow() skips the wait (tab visible, browser online) and is a no-op while up', () => {
    const { client } = setup({ watchdogMs: 0 })
    client.start()
    FakeSource.last.open()
    client.reconnectNow()
    expect(FakeSource.all).toHaveLength(1)
    FakeSource.last.fail()
    client.reconnectNow()
    expect(FakeSource.all).toHaveLength(2)
    vi.advanceTimersByTime(60_000)
    expect(FakeSource.all).toHaveLength(2) // the scheduled retry was cancelled
  })

  it('frames from a stream that was replaced are ignored', () => {
    const { client, events } = setup()
    client.start()
    const first = FakeSource.last
    first.open()
    first.fail()
    vi.advanceTimersByTime(1000)
    first.event(1, 'ops', 'late')
    first.onerror?.({})
    expect(events).toEqual([])
    expect(client.status).toBe('down')
    expect(FakeSource.all).toHaveLength(2)
  })
})

describe('resync', () => {
  it('a resync frame refetches everything and moves the cursor to latestId', () => {
    const { client, resyncs, events } = setup()
    client.start()
    FakeSource.last.open()
    FakeSource.last.event(3, 'ops', 'x')
    FakeSource.last.emit('resync', { reason: 'cursor_unavailable', latestId: 500 }, '500')
    expect(resyncs).toEqual(['resync'])
    expect(client.lastEventId).toBe(500)
    expect(events).toHaveLength(1)
    FakeSource.last.fail()
    vi.advanceTimersByTime(1000)
    expect(FakeSource.last.url).toContain('lastEventId=500')
  })
})

describe('heartbeat watchdog', () => {
  it('reopens a stream that stays silent for 3 heartbeats (60 s by default) with the cursor, without an outage', () => {
    const { client, polls, resyncs, status } = setup()
    client.start()
    FakeSource.last.open()
    FakeSource.last.event(8, 'ops', 'x')
    vi.advanceTimersByTime(59_999)
    expect(FakeSource.all).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeSource.all).toHaveLength(2)
    expect(FakeSource.all[0]!.closed).toBe(true)
    expect(FakeSource.last.url).toBe('/api/v1/events?lastEventId=8')
    expect(client.status).toBe('up')
    expect(status.filter(([s]) => s === 'down')).toEqual([])
    expect(polls).not.toHaveBeenCalled()
    expect(resyncs).toEqual([])
  })

  it('every frame (message, ready, heartbeat) resets the timer', () => {
    const { client } = setup()
    client.start()
    FakeSource.last.open()
    vi.advanceTimersByTime(50_000)
    FakeSource.last.event(1, 'ops', 'x')
    vi.advanceTimersByTime(50_000)
    FakeSource.last.emit('heartbeat', {})
    vi.advanceTimersByTime(50_000)
    FakeSource.last.emit('ready', { heartbeatMs: 20000 }, '')
    vi.advanceTimersByTime(59_000)
    expect(FakeSource.all).toHaveLength(1)
    vi.advanceTimersByTime(1000)
    expect(FakeSource.all).toHaveLength(2)
  })

  it('follows the heartbeatMs the server announced (3 x 40 s = 120 s) and can be disabled', () => {
    const a = setup()
    a.client.start()
    FakeSource.last.emit('ready', { heartbeatMs: 40_000 })
    vi.advanceTimersByTime(119_999)
    expect(FakeSource.all).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeSource.all).toHaveLength(2)
    a.client.stop()
    FakeSource.all = []
    const b = setup({ watchdogMs: 0 })
    b.client.start()
    FakeSource.last.open()
    vi.advanceTimersByTime(60 * 60_000)
    expect(FakeSource.all).toHaveLength(1)
  })
})

describe('auth suspicion', () => {
  it('after two failures in a row without ever opening, asks the app to check the session (once)', () => {
    const { client, suspect } = setup()
    client.start()
    FakeSource.last.fail()
    expect(suspect).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    FakeSource.last.fail()
    expect(suspect).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2000)
    FakeSource.last.fail()
    expect(suspect).toHaveBeenCalledTimes(1)
  })
  it('a stream that opened in between does not count', () => {
    const { client, suspect } = setup()
    client.start()
    FakeSource.last.open()
    FakeSource.last.fail()
    vi.advanceTimersByTime(1000)
    FakeSource.last.open()
    FakeSource.last.fail()
    expect(suspect).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    FakeSource.last.open()
    FakeSource.last.fail()
    expect(suspect).not.toHaveBeenCalled()
  })
})
