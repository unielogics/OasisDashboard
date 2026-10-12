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
    expect(keysForEvent(ev('settings', 'rbac.changed'))).toEqual([
      ['me'],
      ['settings', 'roles'],
      ['settings', 'employees'],
    ])
    expect(keysForEvent(ev('settings', 'settings.changed', { section: 'hours' }))).toEqual([
      ['settings', 'hours'],
    ])
    expect(keysForEvent(ev('settings', 'settings.changed'))).toEqual([['settings']])
    expect(keysForEvent(ev('notifications', 'auth.expired'))).toEqual([['me']])
    expect(keysForEvent(ev('weird', 'x'))).toEqual([])
  })

  it('catalog, service and reminder sections also refresh where they show (ADR 0160 plan A, I, K)', () => {
    const s = (section: string) => keysForEvent(ev('settings', 'settings.changed', { section }))
    const views = [
      ['ops', 'snapshot'],
      ['ops', 'file'],
      ['ops', 'calendar'],
      ['ops', 'catalog'],
      ['payments', 'summary'],
      ['payments', 'invoices'],
      ['payments', 'invoice'],
    ]
    expect(s('services')).toEqual([
      ['settings', 'services'],
      ['settings', 'catalog'],
      ...views,
      ['ops', 'availability'],
    ])
    expect(s('catalog')).toEqual([['settings', 'catalog'], ['settings', 'reminders'], ...views])
    // never a whole family: a client's identity, membership or thread does not change with the catalog
    for (const x of ['services', 'catalog']) {
      expect(s(x)).not.toContainEqual(['ops'])
      expect(s(x)).not.toContainEqual(['payments'])
    }
    for (const x of ['reviews', 'status_texts', 'leads'])
      expect(s(x)).toEqual([['settings', x], ['settings', 'reminders']])
    expect(s('reminders')).toEqual([['settings', 'reminders']])
    // the booking fee (booking.guest_fee) is edited in Settings → Prices by size, which reads the catalog, and shows in
    // Settings → Billing & integrations with link tipping, the membership renewal policy and notice and the card fees
    // (ADR 0171, DV-908)
    expect(s('booking')).toEqual([['settings', 'booking'], ['settings', 'catalog'], ['settings', 'billing']])
    for (const x of ['payments', 'memberships', 'fees']) expect(s(x)).toEqual([['settings', x], ['settings', 'billing']])
    expect(s('constructor')).toEqual([['settings', 'constructor']])
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
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['ops'] }))
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['payments'] }))
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

  it('skips a query whose fetch started after the event arrived (it already holds the change), not one started before', async () => {
    const c = new InvalidationCoalescer(qc, 250)
    let resolveOwn: (v: number) => void = () => {}
    qc.setQueryData(['settings', 'hours'], 1)
    qc.setQueryData(['settings', 'vip'], 1)
    // a fetch on its way before the event: it may have read the old row
    void qc.fetchQuery({ queryKey: ['settings', 'vip'], queryFn: () => new Promise<number>(() => {}) })
    vi.advanceTimersByTime(5)
    c.push([['settings', 'hours'], ['settings', 'vip']])
    vi.advanceTimersByTime(5)
    // the page's own save answered: command() refetches hours after the event arrived
    void qc.fetchQuery({
      queryKey: ['settings', 'hours'],
      queryFn: () => new Promise<number>((r) => (resolveOwn = r)),
      staleTime: 0,
    })
    vi.advanceTimersByTime(250)
    expect(qc.getQueryState(['settings', 'hours'])!.isInvalidated).toBe(false)
    expect(qc.getQueryState(['settings', 'vip'])!.isInvalidated).toBe(true)
    resolveOwn(2)
    await vi.advanceTimersByTimeAsync(0)
    expect(qc.getQueryData(['settings', 'hours'])).toBe(2)
    // a later event is newer than that fetch: invalidated again
    c.push([['settings', 'hours']])
    vi.advanceTimersByTime(250)
    expect(qc.getQueryState(['settings', 'hours'])!.isInvalidated).toBe(true)
    c.dispose()
  })

  it('a fetch that started after the event but failed does not count', async () => {
    const c = new InvalidationCoalescer(qc, 250)
    qc.setQueryData(['settings', 'arrival'], 1)
    c.push([['settings', 'arrival']])
    vi.advanceTimersByTime(5)
    await qc
      .fetchQuery({ queryKey: ['settings', 'arrival'], queryFn: () => Promise.reject(new Error('down')), retry: false })
      .catch(() => {})
    vi.advanceTimersByTime(250)
    expect(qc.getQueryState(['settings', 'arrival'])!.isInvalidated).toBe(true)
    c.dispose()
  })
})
