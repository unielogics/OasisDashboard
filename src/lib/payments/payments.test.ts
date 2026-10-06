// @vitest-environment jsdom
// Hand-checked behaviour of the pure Payments modules on the design's invoices (the differential tests prove the same
// code equals the original class; these pin the numbers a person can verify with a calculator).
import { beforeAll, describe, expect, it } from 'vitest'
import { buildInvoices, DEF_ROLES, FROZEN_TODAY } from '@/screens/payments/fixtures'
import {
  FILTERS,
  RANGE_WINDOWS,
  calcInvoice,
  calcSheet,
  chartBars,
  clientCredit,
  defaultSheetForm,
  displayStatus,
  filterCount,
  invoiceActions,
  invoicesInRange,
  kpiCards,
  ledgerEntries,
  methodBars,
  parseAmount,
  pendingApprovals,
  rangeForPending,
  reasonsFor,
  visibleInvoices,
} from './index'
import type { Invoice, SheetForm, SheetKind } from './index'

let txs: Invoice[]
const byId = (id: string) => txs.find((t) => t.id === id)!
beforeAll(() => {
  process.env.TZ = 'America/New_York'
  txs = buildInvoices()
})

describe('KPIs', () => {
  it('Today adds up by hand', () => {
    const k = kpiCards(invoicesInRange(txs, RANGE_WINDOWS.today))
    expect(k.map((x) => [x.label, x.value, x.sub])).toEqual([
      ['Gross sales', '$1,903', '8 invoices'],
      ['Net revenue', '$1,878', 'after refunds & discounts'],
      ['Refunds', '$0', '0 refunded'],
      ['Adjustments', '−$25', '1 invoices'],
      ['Credits issued', '$0', '0 clients'],
      ['Outstanding', '$507', '3 open balances'],
    ])
    expect(k[2]!.color).toBe('var(--ink)')
    expect(k[5]!.color).toBe('var(--amber)')
  })

  it('refunds turn red when there are any', () => {
    const k = kpiCards(invoicesInRange(txs, RANGE_WINDOWS['7d']))
    expect(k[2]!.color).toBe('var(--red)')
    expect(k[2]!.sub).toMatch(/^\d+ refunded$/)
  })
})

describe('chart and methods', () => {
  it('Today has ten hourly buckets, 8a to 5p', () => {
    const bars = chartBars(invoicesInRange(txs, RANGE_WINDOWS.today), 'today', FROZEN_TODAY)
    expect(bars.map((b) => b.label)).toEqual(['8a', '9a', '10a', '11a', '12p', '1p', '2p', '3p', '4p', '5p'])
    expect(bars[2]!.title).toMatch(/^10a · net \$/)
  })

  it('7 days starts on Sunday June 7 and ends on Saturday June 13', () => {
    const bars = chartBars(invoicesInRange(txs, RANGE_WINDOWS['7d']), '7d', FROZEN_TODAY)
    expect(bars.map((b) => b.label)).toEqual(['S 7', 'M 8', 'T 9', 'W 10', 'T 11', 'F 12', 'S 13'])
    expect(bars[0]!.title).toMatch(/^Sun Jun 07 2026 · net /)
  })

  it('30 days labels only the 1st, 4th, 7th... of the month', () => {
    const bars = chartBars(invoicesInRange(txs, RANGE_WINDOWS['30d']), '30d', FROZEN_TODAY)
    expect(bars).toHaveLength(30)
    expect(bars.filter((b) => b.label).map((b) => b.label)).toEqual([
      '16',
      '19',
      '22',
      '25',
      '28',
      '31',
      '1',
      '4',
      '7',
      '10',
      '13',
    ])
  })

  it('the tallest bar fills its column and an empty one has no min height', () => {
    const bars = chartBars(invoicesInRange(txs, RANGE_WINDOWS.today), 'today', FROZEN_TODAY)
    const heights = bars.map(
      (b) => parseFloat(String(b.netStyle.height)) + parseFloat(String(b.lossStyle.height)),
    )
    expect(Math.max(...heights)).toBeCloseTo(100, 6)
    expect(bars[bars.length - 1]!.netStyle.minHeight).toBe('0')
  })

  it('payment methods bucket cards, Apple Pay, cash and store credit', () => {
    const m = methodBars(invoicesInRange(txs, RANGE_WINDOWS.today))
    expect(m.map((x) => x.label)).toEqual(['Card', 'Apple Pay', 'Cash', 'Store credit'])
    // Apple Pay today: INV-20604 paid in full, 184 + 7% = 196.88
    expect(m[1]!.value).toBe('$197')
    expect(m[3]!.barStyle.background).toBe('var(--amber)')
  })
})

describe('filters, search and sort', () => {
  const inR = () => invoicesInRange(txs, RANGE_WINDOWS['7d'])

  it('counts every chip', () => {
    const counts = Object.fromEntries(FILTERS.map((f) => [f.key, filterCount(inR(), f.key)]))
    expect(counts.all).toBe(inR().length)
    expect(counts.unpaid).toBe(3 + 0 + 0)
    expect(counts.refunds).toBeGreaterThanOrEqual(3)
  })

  it('searches id, client, vehicle and item names, ignoring case and outer spaces', () => {
    expect(visibleInvoices(inR(), 'all', '  priya ').map((x) => x.t.id)).toEqual(['INV-20603'])
    expect(visibleInvoices(inR(), 'all', 'ceramic').length).toBeGreaterThanOrEqual(2)
    expect(visibleInvoices(inR(), 'all', 'zzzz')).toEqual([])
  })

  it('sorts newest day first, then by id descending', () => {
    const ids = visibleInvoices(inR(), 'all', '').map((x) => x.t.id)
    expect(ids.slice(0, 8)).toEqual([
      'INV-20608',
      'INV-20607',
      'INV-20606',
      'INV-20605',
      'INV-20604',
      'INV-20603',
      'INV-20602',
      'INV-20601',
    ])
  })

  it('an unknown filter fails loudly, like the original lookup', () => {
    expect(() => visibleInvoices(inR(), 'nope' as never, '')).toThrow(TypeError)
  })

  it('a pending refund overrides the status text', () => {
    const c = calcInvoice(byId('INV-20579'))
    expect(c.status).toBe('Paid')
    expect(displayStatus(c)).toBe('Refund pending')
    expect(pendingApprovals(txs)).toHaveLength(1)
  })

  it('the pending refund link keeps Today and 7 days wide enough', () => {
    expect(rangeForPending('today', -1)).toBe('7d')
    expect(rangeForPending('today', 0)).toBe('today')
    expect(rangeForPending('mtd', -3)).toBe('mtd')
    expect(rangeForPending('7d', -8)).toBe('30d')
  })
})

describe('invoice detail', () => {
  it('shows Collect and Apply credit when a balance is open and the client holds credit', () => {
    const tx = byId('INV-20603')
    const c = calcInvoice(tx)
    const credit = clientCredit(txs, tx.client)
    expect(credit).toBe(20)
    const labels = invoiceActions(tx, c, credit, DEF_ROLES, 'mgmt').map((a) => a.label)
    expect(labels).toEqual([
      'Collect $164.78',
      'Apply $20.00 credit',
      'Refund',
      'Adjust',
      'Issue credit',
      'Send receipt',
    ])
  })

  it('a role without the permission gets a disabled button and the design reason', () => {
    const tx = byId('INV-20601')
    const acts = invoiceActions(tx, calcInvoice(tx), 0, DEF_ROLES, 'crew')
    const byKind = Object.fromEntries(acts.map((a) => [a.kind, a]))
    expect(byKind.refund).toMatchObject({ ok: false, why: 'Role can’t issue refunds' })
    expect(byKind.adjust).toMatchObject({ ok: false, why: 'Role can’t adjust invoices' })
    expect(byKind.credit).toMatchObject({ ok: false, why: 'Role can’t issue credits' })
    expect(byKind.receipt).toMatchObject({ ok: true, why: '' })
  })

  it('a fully refunded invoice has nothing left to refund', () => {
    const tx = byId('INV-20571')
    const a = invoiceActions(tx, calcInvoice(tx), 0, DEF_ROLES, 'mgmt').find((x) => x.kind === 'refund')!
    expect(a).toMatchObject({ ok: false, why: 'Nothing left to refund' })
    expect(
      invoiceActions(tx, calcInvoice(tx), 0, DEF_ROLES, 'mgmt').find((x) => x.kind === 'adjust')!.ok,
    ).toBe(false)
  })

  it('the pending refund can be approved by Management and not by Support', () => {
    const tx = byId('INV-20579')
    const find = (role: string) => ledgerEntries(tx, DEF_ROLES, role).find((e) => e.view.pending)!
    expect(find('mgmt').canApprove).toBe(true)
    expect(find('mgmt').view.approveNote).toBe('You can approve up to $1,000.')
    expect(find('super').view.approveNote).toBe('You can approve up to any amount.')
    expect(find('support').canApprove).toBe(false)
    expect(find('support').view.approveNote).toBe('Needs a role with a refund limit of at least $80.')
  })
})

describe('sheets', () => {
  const sheet = (kind: SheetKind, id: string, preset: Partial<SheetForm> = {}, role = 'mgmt') => {
    const tx = byId(id)
    return calcSheet({
      kind,
      f: defaultSheetForm(preset),
      tx,
      c: calcInvoice(tx),
      credit: clientCredit(txs, tx.client),
      rc: DEF_ROLES,
      role,
    })
  }

  it('a full refund within the limit is done immediately', () => {
    const s = sheet('refund', 'INV-20601')
    expect(s.summary.map((r) => [r.label, r.value])).toEqual([
      ['Refundable', '$98.95'],
      ['This refund', '$98.95'],
      ['Collected after', '$0.00'],
    ])
    expect(s.permText).toBe('Within your $1,000 limit as Management.')
    expect(s.submitLabel).toBe('Refund $98.95')
    expect(s.plan?.events[0]).toMatchObject({
      type: 'refund',
      amt: 98.95,
      status: 'done',
      dest: 'card',
      method: 'Visa ••4421',
      reason: 'Service issue',
      byRole: 'Management',
    })
    expect(s.plan?.toast).toBe('Refunded $98.95 to Visa ••4421')
  })

  it('over the role limit it becomes a request for approval', () => {
    const s = sheet('refund', 'INV-20601', {}, 'support')
    expect(s.permText).toBe('Over your $50 limit as Customer Support. This will be sent for approval.')
    expect(s.submitLabel).toBe('Request approval · $98.95')
    expect(s.permOk).toBe(false)
    expect(s.plan?.events[0]!.status).toBe('pending')
    expect(s.plan?.toast).toBe('Sent for approval · $98.95')
  })

  it('card refunds are capped at what was paid by card', () => {
    const s = sheet('refund', 'INV-20560', { mode: 'custom', amount: '45' })
    // paid $25 by credit and $20.08 by card on a $45 + tax invoice
    expect(s.blocked).toBe(true)
    expect(s.permText).toMatch(/^Only \$\d+\.\d\d was paid by card — refund the rest to store credit\.$/)
    expect(s.plan).toBeNull()
    expect(sheet('refund', 'INV-20560', { mode: 'custom', amount: '45', dest: 'credit' }).blocked).toBe(false)
  })

  it('by-item refunds add the tax and cap at the refundable amount', () => {
    const s = sheet('refund', 'INV-20601', { mode: 'items', items: [1] })
    // Wax 40 + 7% = 42.80
    expect(s.summary[1]!.value).toBe('$42.80')
  })

  it('a discount on a paid invoice previews the overpayment and settles to credit by default', () => {
    const s = sheet('adjust', 'INV-20601', { amount: '10', unit: '%' })
    // 10% of 85 = 8.50 pre-tax; (85 - 8.50) x 1.07 + 8 tip = 89.855, rounded to 89.86; 98.95 - 89.86 = 9.09
    expect(s.summary.map((r) => r.value)).toEqual(['$98.95', '−$8.50', '$89.86', '$9.09'])
    expect(s.summary[3]!.label).toBe('Overpaid — returned as store credit')
    expect(s.showSettle).toBe(true)
    expect(s.plan?.events.map((e) => e.type)).toEqual(['adjust', 'refund'])
    expect(s.plan?.events[1]).toMatchObject({
      dest: 'credit',
      method: 'Store credit',
      reason: 'Adjustment settlement',
      status: 'done',
    })
  })

  it('an adjustment over the role limit stays blocked', () => {
    const s = sheet('adjust', 'INV-20601', { amount: '30' }, 'support')
    expect(s.blocked).toBe(true)
    expect(s.permText).toBe('Over your $25 limit as Customer Support. Ask Management or a Super Admin.')
    expect(sheet('adjust', 'INV-20601', { amount: '500' }).blocked).toBe(true)
    expect(sheet('adjust', 'INV-20601', { amount: '500' }, 'super').permText).toBe(
      'Discount is larger than the invoice.',
    )
  })

  it('a surcharge raises the total and leaves a balance', () => {
    const s = sheet('adjust', 'INV-20601', { kind: 'surcharge', amount: '10' })
    expect(s.summary[2]!.value).toBe('$109.65')
    expect(s.summary[3]).toMatchObject({ label: 'New balance due', value: '$10.70' })
    expect(s.showSettle).toBe(false)
  })

  it('credit is limited per role and shows the running balance', () => {
    const ok = sheet('credit', 'INV-20603', { amount: '30' }, 'support')
    expect(ok.summary.map((r) => r.value)).toEqual(['$20.00', '+$30.00', '$50.00'])
    expect(ok.submitLabel).toBe('Issue $30.00 credit')
    expect(ok.plan?.toast).toBe('$30.00 credit issued to Priya Nair')
    const over = sheet('credit', 'INV-20603', { amount: '51' }, 'support')
    expect(over).toMatchObject({ blocked: true, permText: 'Over your $50 limit as Customer Support.' })
    expect(sheet('credit', 'INV-20603', { amount: '' }).blocked).toBe(true)
  })

  it('collect and apply have no validation and never block', () => {
    const c = sheet('collect', 'INV-20607')
    expect(c.blocked).toBe(false)
    expect(c.summary[0]!.value).toBe('$113.75')
    expect(c.plan?.events[0]).toMatchObject({ type: 'pay', amt: 113.75, method: 'Visa ••4421' })
    expect(sheet('collect', 'INV-20607', { method: 'Cash' }).plan?.events[0]!.method).toBe('Cash')
    expect(sheet('collect', 'INV-20607', { method: 'Payment link' }).plan).toEqual({
      events: [],
      toast: 'Payment link sent to Marcus Webb',
    })
    const a = sheet('apply', 'INV-20603')
    expect(a.summary.map((r) => r.value)).toEqual(['$20.00', '$20.00', '$144.78'])
    expect(a.plan?.events[0]).toMatchObject({ type: 'credit_apply', amt: 20 })
  })

  it('reasons depend on the sheet and, for adjustments, on discount versus surcharge', () => {
    expect(reasonsFor('refund', { kind: 'discount' })).toHaveLength(6)
    expect(reasonsFor('adjust', { kind: 'discount' })[0]).toBe('Service recovery')
    expect(reasonsFor('adjust', { kind: 'surcharge' })[0]).toBe('Extra soil surcharge')
    expect(reasonsFor('collect', { kind: 'discount' })).toEqual([])
    expect(sheet('adjust', 'INV-20601', { amount: '5', reason: 'Not a real reason' }).reason).toBe(
      'Service recovery',
    )
    expect(sheet('adjust', 'INV-20601', { amount: '5', reason: 'Price match' }).reason).toBe('Price match')
  })

  it('parses the amount field like the original', () => {
    expect([
      parseAmount(''),
      parseAmount('abc'),
      parseAmount('$1,234.5'),
      parseAmount('-5'),
      parseAmount('1e3'),
      parseAmount('.5'),
      parseAmount('1.2.3'),
    ]).toEqual([0, 0, 1234.5, 5, 13, 0.5, 1.2])
  })
})
