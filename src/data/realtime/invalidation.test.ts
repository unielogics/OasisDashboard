import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InvalidationCoalescer, invalidateEverything, keysForEvent, refreshActive } from './invalidation'
import type { RealtimeEvent } from './sse'

const ev = (channel: string, type: string, payload: Record<string, unknown> = {}): RealtimeEvent => ({
  id: 1,
  channel,
  type,
  payload,
  at: '',
})

describe('keysForEvent', () => {
  it('maps channels to query families, and rbac.changed to the session', () => {
    expect(keysForEvent(ev('ops', 'appointment.updated'))).toEqual([['ops']])
    expect(keysForEvent(ev('payments', 'invoice.updated'))).toEqual([['payments']])
    expect(keysForEvent(ev('messages', 'message.in'))).toEqual([['messages']])
    expect(keysForEvent(ev('notifications', 'notification.new'))).toEqual([['notifications']])
    expect(keysForEvent(ev('settings', 'rbac.changed'))).toEqual([['me'], ['settings']])
    expect(keysForEvent(ev('settings', 'settings.changed', { section: 'hours' }))).toEqual([
      ['settings', 'hours'],
    ])
    expect(keysForEvent(ev('settings', 'settings.changed'))).toEqual([['settings']])
    expect(keysForEvent(ev('notifications', 'auth.expired'))).toEqual([['me']])
    expect(keysForEvent(ev('weird', 'x'))).toEqual([])
  })
})

const spyOn = (qc: QueryClient) => vi.spyOn(qc, 'invalidateQueries')

describe('InvalidationCoalescer', () => {
  let qc: QueryClient
  let spy: ReturnType<typeof spyOn>
  beforeEach(() => {
    vi.useFakeTimers()
    qc = new QueryClient()
    spy = spyOn(qc)
  })

  it('turns a burst into one invalidation per family after the window', () => {
    const c = new InvalidationCoalescer(qc, 250)
    c.push([['ops']])
    vi.advanceTimersByTime(100)
    c.push([['ops'], ['payments']])
    c.push([['ops']])
    vi.advanceTimersByTime(149)
    expect(spy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy).toHaveBeenCalledWith({ queryKey: ['ops'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['payments'] })
    vi.advanceTimersByTime(1000)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('starts a new window for later events, flush() is immediate and dispose() drops what is pending', () => {
    const c = new InvalidationCoalescer(qc, 250)
    c.push([['ops']])
    vi.advanceTimersByTime(250)
    c.push([['ops']])
    vi.advanceTimersByTime(250)
    expect(spy).toHaveBeenCalledTimes(2)
    c.push([['me']])
    c.flush()
    expect(spy).toHaveBeenCalledTimes(3)
    c.push([['settings']])
    c.dispose()
    vi.advanceTimersByTime(1000)
    expect(spy).toHaveBeenCalledTimes(3)
  })

  it('invalidation really marks cached queries stale', async () => {
    qc.setQueryData(['ops', 'board'], 1)
    qc.setQueryData(['payments'], 2)
    const c = new InvalidationCoalescer(qc, 10)
    c.push([['ops']])
    vi.advanceTimersByTime(10)
    expect(qc.getQueryState(['ops', 'board'])!.isInvalidated).toBe(true)
    expect(qc.getQueryState(['payments'])!.isInvalidated).toBe(false)
    await invalidateEverything(qc)
    expect(qc.getQueryState(['payments'])!.isInvalidated).toBe(true)
    await refreshActive(qc)
  })
})
