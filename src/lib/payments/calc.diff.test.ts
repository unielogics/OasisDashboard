// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// The pure Payments formulas against the ORIGINAL class methods on the design's invoices and on thousands of seeded
// random invoices (cents amounts, canceled, every event type and refund status, role configs with holes).
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { loadLogic } from '@/dc/loadLogic'
import { buildInvoices, DEF_ROLES, FROZEN_TODAY } from '@/screens/payments/fixtures'
import { seeded } from '@/screens/payments/testkit'
import {
  RANGE_WINDOWS,
  calcInvoice,
  clientCredit,
  dateOf,
  fmtDate,
  invoicesInRange,
  limitFor,
  roleMenuLimit,
  roleName,
} from './index'
import type { Invoice, LedgerEvent, RolesConfig } from './index'

const src = fs.readFileSync(
  path.resolve(__dirname, '../../../design/extracted/payments/logic.original.js'),
  'utf8',
)
let orig: any

beforeAll(() => {
  process.env.TZ = 'America/New_York'
  vi.useFakeTimers({ now: new Date('2026-06-13T10:36:00-04:00') })
  localStorage.clear()
  const Orig = loadLogic(src, 'payments')
  orig = new Orig({})
})
afterAll(() => vi.useRealTimers())

function randomInvoice(r: () => number, n: number): Invoice {
  const price = () => [45, 129, 139, 260, 37.45, 0.1, 99.99, 320, 650][Math.floor(r() * 9)]!
  const items = Array.from({ length: 1 + Math.floor(r() * 4) }, (_, i) => ({
    name: 'Item ' + i,
    price: price(),
  }))
  const types = ['pay', 'adjust', 'refund', 'credit_issue', 'credit_apply'] as const
  const amt = () => Math.round(r() * 20000) / 100
  const events: LedgerEvent[] = Array.from({ length: Math.floor(r() * 7) }, () => {
    const type = types[Math.floor(r() * types.length)]!
    const e: LedgerEvent = { type, amt: type === 'adjust' && r() < 0.5 ? -amt() / 4 : amt() }
    if (type === 'pay')
      e.method = ['Visa ••4421', 'Apple Pay', 'Cash', 'Amex ••3008', 'Store credit'][Math.floor(r() * 5)]!
    if (type === 'refund') {
      e.status = (['done', 'pending', 'denied'] as const)[Math.floor(r() * 3)]
      e.dest = (['card', 'credit', 'cash'] as const)[Math.floor(r() * 3)]
      e.method = 'Visa ••4421'
    }
    return e
  })
  // sometimes pay exactly the total so the boundary statuses (Paid, Refunded within a cent) occur
  const probe: Invoice = {
    id: 'INV-' + n,
    off: -Math.floor(r() * 30),
    time: '9:00 AM',
    client: 'C' + (n % 5),
    vehicle: 'v',
    staff: 's',
    items,
    tip: [0, 5, 10, 20][Math.floor(r() * 4)]!,
    canceled: r() < 0.15,
    events,
  }
  if (r() < 0.4) {
    const tot = orig.calc({ ...probe, events: probe.events.filter((e) => e.type === 'adjust') }).total
    probe.events.push({ type: 'pay', amt: tot, method: 'Visa ••4421' })
    if (r() < 0.5)
      probe.events.push({
        type: 'refund',
        amt: tot - (r() < 0.5 ? 0.01 : 0),
        status: 'done',
        dest: 'card',
        method: 'Visa ••4421',
      })
  }
  return probe
}

describe('calcInvoice', () => {
  it('matches the original on the design invoices', () => {
    const txs = buildInvoices()
    expect(txs.length).toBeGreaterThan(100)
    for (const tx of txs) expect(calcInvoice(tx)).toEqual(orig.calc(tx))
  })

  it('matches the original on 5000 random invoices, including every status', () => {
    const r = seeded(7)
    const statuses = new Set<string>()
    for (let n = 0; n < 5000; n++) {
      const tx = randomInvoice(r, n)
      const a = calcInvoice(tx)
      expect(a).toEqual(orig.calc(tx))
      statuses.add(a.status)
    }
    expect([...statuses].sort()).toEqual(
      ['Canceled · refunded', 'Paid', 'Partially paid', 'Partially refunded', 'Refunded', 'Unpaid'].sort(),
    )
  })

  it('has hand-checked values for a paid invoice with a discount and a tip', () => {
    const tx = buildInvoices().find((t) => t.id === 'INV-20602')!
    const c = calcInvoice(tx)
    // Full Detail 320 + Engine bay 55 - 25 loyalty = 350 pre-tax; tax 24.50; tip 20
    expect(c).toMatchObject({
      items: 375,
      adj: -25,
      sub: 350,
      tax: 24.5,
      total: 394.5,
      paid: 394.5,
      balance: 0,
      status: 'Paid',
    })
  })

  it('the unpaid seed invoice owes its whole total', () => {
    const c = calcInvoice(buildInvoices().find((t) => t.id === 'INV-20603')!)
    expect(c).toMatchObject({ paid: 0, status: 'Unpaid' })
    expect(c.balance).toBe(c.total)
  })
})

describe('clientCredit', () => {
  it('matches the original for every client on the design data and on random data', () => {
    const txs = buildInvoices()
    orig.state = { ...orig.state, txs }
    for (const name of new Set(txs.map((t) => t.client)))
      expect(clientCredit(txs, name)).toBe(orig.clientCredit(name))
    const r = seeded(3)
    const rand = Array.from({ length: 400 }, (_, n) => randomInvoice(r, n))
    orig.state = { ...orig.state, txs: rand }
    for (const name of ['C0', 'C1', 'C2', 'C3', 'C4', 'nobody'])
      expect(clientCredit(rand, name)).toBe(orig.clientCredit(name))
  })
})

describe('limits and role names', () => {
  const configs = (): RolesConfig[] => {
    const r = seeded(11)
    const out: RolesConfig[] = [DEF_ROLES]
    for (let i = 0; i < 60; i++) {
      const rc: RolesConfig = JSON.parse(JSON.stringify(DEF_ROLES))
      for (const id of ['super', 'mgmt', 'acct', 'support', 'crew']) {
        for (const k of ['refund', 'adjust', 'credit']) {
          const x = r()
          if (x < 0.25) delete rc.limits[id]![k]
          else if (x < 0.4) rc.limits[id]![k] = null
          else if (x < 0.55) rc.limits[id]![k] = Math.round(r() * 4000) / 4
        }
        if (r() < 0.2) delete rc.limits[id]
        if (r() < 0.2) delete rc.perms[id]
        else
          for (const k of ['pay.refund', 'pay.adjust', 'pay.credit', 'pay.collect', 'pay.reports'])
            if (r() < 0.3) delete rc.perms[id]![k]
      }
      out.push(rc)
    }
    return out
  }

  it('limitFor, roleName and the Preview-as text match the original for every role, kind and config', () => {
    for (const rc of configs()) {
      orig.state = { ...orig.state, rc }
      for (const role of [...rc.roles.map((x) => x.id), 'ghost']) {
        for (const kind of ['refund', 'adjust', 'credit'] as const) {
          expect(limitFor(rc, role, kind)).toEqual(orig.lim(kind, role))
        }
        expect(roleName(rc, role)).toBe(orig.roleName(role))
      }
      const vals = orig.renderVals()
      expect(rc.roles.map((x) => roleMenuLimit(rc, x.id))).toEqual(vals.roleOpts.map((o: any) => o.lim))
    }
  })

  it('has the design numbers: super has no limit, support refunds up to $50, a missing limit is $25', () => {
    expect(limitFor(DEF_ROLES, 'super', 'refund')).toEqual({ has: true, max: Infinity })
    expect(limitFor(DEF_ROLES, 'support', 'refund')).toEqual({ has: true, max: 50 })
    expect(limitFor(DEF_ROLES, 'crew', 'refund')).toEqual({ has: false, max: 0 })
    const rc: RolesConfig = { ...DEF_ROLES, limits: { ...DEF_ROLES.limits, mgmt: {} } }
    expect(limitFor(rc, 'mgmt', 'refund')).toEqual({ has: true, max: 25 })
    const sup: RolesConfig = { ...DEF_ROLES, limits: { ...DEF_ROLES.limits, super: {} } }
    expect(limitFor(sup, 'super', 'refund')).toEqual({ has: true, max: Infinity })
  })
})

describe('dates and ranges', () => {
  it('dateOf and fmtDate match the original over the whole history window', () => {
    for (let off = -45; off <= 5; off++) {
      expect(dateOf(FROZEN_TODAY, off).getTime()).toBe(orig.dateOf(off).getTime())
      expect(fmtDate(FROZEN_TODAY, off)).toBe(orig.fmtDate(off))
    }
    expect(fmtDate(FROZEN_TODAY, 0)).toBe('Today')
    expect(fmtDate(FROZEN_TODAY, -1)).toBe('Yesterday')
    expect(fmtDate(FROZEN_TODAY, -6)).toBe('Jun 7')
  })

  it('the range windows hold the invoice counts the design shows', () => {
    const txs = buildInvoices()
    const counts = Object.fromEntries(
      Object.entries(RANGE_WINDOWS).map(([k, w]) => [k, invoicesInRange(txs, w).length]),
    )
    orig.state = { ...orig.state, txs }
    for (const [k, n] of Object.entries(counts)) {
      orig.state = { ...orig.state, range: k }
      expect(orig.renderVals().kpis[0].sub).toBe(`${n} invoices`)
    }
  })
})
