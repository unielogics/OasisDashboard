// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// The fixture module is the design's data verbatim: every constant and the generated history are compared with what
// the original class builds for itself.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadLogic } from '@/dc/loadLogic'
import { ADD, DEF_ROLES, FROZEN_TODAY, FixtureData, PRICE, RANGE_LABELS, buildInvoices } from './fixtures'
import { originalSource } from './testkit'

let orig: any
beforeAll(() => {
  process.env.TZ = 'America/New_York'
  vi.useFakeTimers({ now: new Date('2026-06-13T10:36:00-04:00') })
  localStorage.clear()
  orig = new (loadLogic(originalSource, 'payments'))({})
})
afterAll(() => vi.useRealTimers())

describe('FixtureData', () => {
  it('the constants equal the original class fields', () => {
    expect(DEF_ROLES).toEqual(orig.DEF_ROLES)
    expect(PRICE).toEqual(orig.PRICE)
    expect(ADD).toEqual(orig.ADD)
    expect(Object.keys(PRICE)).toEqual(Object.keys(orig.PRICE))
    expect(Object.keys(ADD)).toEqual(Object.keys(orig.ADD))
  })

  it('the invoice history equals the original state, event by event, with the same key order', () => {
    const txs = buildInvoices()
    expect(txs).toHaveLength(orig.state.txs.length)
    expect(JSON.stringify(txs)).toBe(JSON.stringify(orig.state.txs))
  })

  it('every invoice id and day offset lies where the design puts it', () => {
    const txs = buildInvoices()
    expect(txs.filter((t) => t.off === 0)).toHaveLength(8)
    expect(Math.min(...txs.map((t) => t.off))).toBe(-29)
    expect(txs.some((t) => t.off === -10)).toBe(false)
  })

  it('seed() is fresh on every call (no shared mutable invoices)', () => {
    const d = new FixtureData()
    const a = d.seed()
    const b = d.seed()
    expect(a.invoices).not.toBe(b.invoices)
    a.invoices[0]!.events.push({ type: 'pay', amt: 1 })
    expect(b.invoices[0]!.events.length).not.toBe(a.invoices[0]!.events.length)
  })

  it('the frozen day and the range labels are the design strings', () => {
    expect(new FixtureData().today).toEqual(FROZEN_TODAY)
    expect(RANGE_LABELS).toEqual({
      today: 'Saturday, June 13',
      '7d': 'Jun 7 – Jun 13',
      '30d': 'May 15 – Jun 13',
      mtd: 'Jun 1 – Jun 13',
    })
    for (const k of Object.keys(RANGE_LABELS)) {
      orig.state = { ...orig.state, range: k }
      expect(orig.renderVals().rangeLabel).toBe(RANGE_LABELS[k as keyof typeof RANGE_LABELS])
    }
  })

  it('stampNow follows the clock and saveTheme writes the design key', () => {
    const d = new FixtureData()
    expect(d.stampNow()).toBe(orig.nowT())
    vi.setSystemTime(new Date('2026-06-13T00:05:00-04:00'))
    expect(d.stampNow()).toBe('Today 12:05 AM')
    d.saveTheme('dark')
    expect(localStorage.getItem('oasis-theme')).toBe('dark')
    expect(d.seed().theme).toBe('dark')
  })

  it('saveTheme survives unavailable storage', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => new FixtureData().saveTheme('light')).not.toThrow()
    spy.mockRestore()
  })
})
