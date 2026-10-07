// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// The live Payments view model against a stub ledger API: server figures on screen, the sheets and their requests, the
// Idempotency-Key discipline, permission gating that never reaches the API, Squarespace states and the D3 fixes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSession } from '@/auth/test-fixtures'
import { ApiError } from '@/data/http/problem'
import { makeDetail, makeEvent, makeLive, makeRow, makeSummary, resetIds, stubPort } from './live-testkit'
import type { Live } from './live-testkit'

beforeEach(() => {
  resetIds()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
  localStorage.clear()
})
afterEach(() => vi.useRealTimers())

const unpaid = () => makeDetail({ label: 'INV-20607', client: 'Marcus Webb' })
const paidCard = () =>
  makeDetail({
    label: 'INV-20606',
    events: [
      makeEvent({ type: 'pay', amountCents: 27820, method: 'Visa ••4421', methodKind: 'card', dest: null }),
    ],
  })

function boot(session = makeSession({ role: 'mgmt' }), ...details: ReturnType<typeof makeDetail>[]): Live {
  const port = stubPort()
  const ds = details.length ? details : [unpaid()]
  for (const d of ds) port.details.set(d.id, d)
  port.rows = ds.map((d) => makeRow(d))
  return makeLive(session, port)
}

// reads chain (summary and list first, then the selected invoice): render, settle, render until nothing is missing
async function load(l: Live) {
  for (let i = 0; i < 3; i++) {
    l.vals()
    await l.settle()
  }
  return l.vals()
}

describe('LivePaymentsLogic: what is on screen is what the server said', () => {
  it('renders KPIs, chart, methods, filter counts, rows and the detail from the API (cents to display)', async () => {
    const l = boot()
    const v = await load(l)
    expect(v.rangeLabel).toBe('Jun 7 – Jun 13')
    expect(v.kpis.map((k: any) => [k.label, k.value, k.sub])).toEqual([
      ['Gross sales', '$7,166', '32 invoices'],
      ['Net revenue', '$7,069', 'after refunds & discounts'],
      ['Refunds', '$87', '2 refunded'],
      ['Adjustments', '−$15', '4 invoices'],
      ['Credits issued', '$25', '1 client'],
      ['Outstanding', '$507', '3 open balances'],
    ])
    expect(v.methods.map((m: any) => [m.label, m.value])).toEqual([
      ['Card', '$4,739'],
      ['Apple Pay', '$1,675'],
      ['Cash', '$571'],
      ['Store credit', '$25'],
    ])
    expect(v.bars.map((b: any) => b.title)).toEqual([
      'Fri Jun 12 2026 · net $928',
      'Sat Jun 13 2026 · net $1,878',
    ])
    expect(v.filters.map((f: any) => [f.label, f.count])).toEqual([
      ['All', '32'],
      ['Open balance', '3'],
      ['Refunds', '3'],
      ['Adjusted', '4'],
      ['Credits', '2'],
    ])
    expect(v.rows).toHaveLength(1)
    expect(v.rows[0]).toMatchObject({
      id: 'INV-20607',
      date: 'Today · 10:31 AM',
      items: 'Executive Detail',
      total: '$278.20',
      status: 'Unpaid',
    })
    expect(v.d.id).toBe('INV-20607')
    expect(v.d.big.map((b: any) => [b.label, b.value])).toEqual([
      ['Total', '$278.20'],
      ['Collected', '$0.00'],
      ['Balance due', '$278.20'],
    ])
    expect(v.d.lines.map((x: any) => [x.label, x.value])).toEqual([
      ['Executive Detail', '$260.00'],
      ['Tax (7%)', '$18.20'],
      ['Total', '$278.20'],
      ['Paid', '$0.00'],
    ])
    expect(v.d.actions.map((a: any) => [a.label, a.disabled, a.why])).toEqual([
      ['Collect $278.20', false, ''],
      ['Refund', true, 'Nothing left to refund'],
      ['Adjust', false, ''],
      ['Issue credit', false, ''],
      ['Send receipt', false, ''],
    ])
    expect(v.noRows).toBe(false)
  })

  it('shows structure with placeholders while the first answers are in flight, then fills in', async () => {
    const l = boot()
    const first = l.vals()
    expect(first.kpis.map((k: any) => k.value)).toEqual(Array(6).fill('—'))
    expect(first.rows).toEqual([])
    expect(first.noRows).toBe(false)
    expect(first.d.actions).toEqual([])
    await l.settle()
    expect(l.vals().kpis[0].value).toBe('$7,166')
  })

  it('singular forms and the clients count of "Credits issued" (DV-210)', async () => {
    const l = boot()
    l.port.summaries.set(
      '7d',
      makeSummary({
        kpis: {
          ...makeSummary().kpis,
          counts: {
            invoices: 1,
            refunded: 1,
            adjusted: 1,
            creditInvoices: 3,
            creditClients: 1,
            openBalances: 1,
          },
        },
      }),
    )
    const v = await load(l)
    expect(v.kpis.map((k: any) => k.sub)).toEqual([
      '1 invoice',
      'after refunds & discounts',
      '1 refunded',
      '1 invoice',
      '1 client',
      '1 open balance',
    ])
  })

  it('"Other" collected-by-method row appears only when non-zero (DV-211)', async () => {
    const l = boot()
    l.port.summaries.set(
      '7d',
      makeSummary({ byMethod: { card: 100, applePay: 0, cash: 0, storeCredit: 0, other: 5000 } }),
    )
    const v = await load(l)
    expect(v.methods.map((m: any) => m.label)).toEqual(['Card', 'Apple Pay', 'Cash', 'Store credit', 'Other'])
    expect(v.methods[4].value).toBe('$50')
  })

  it('the pending banner is the server text, and Review clears filter and search and covers the invoice (DV-219)', async () => {
    const pend = makeEvent({
      type: 'refund',
      amountCents: 8000,
      status: 'pending',
      dest: 'card',
      method: 'Visa ••5521',
      reason: 'Service issue',
      by: 'Sofia D.',
      byRole: 'Customer Support',
      canApprove: true,
    })
    const d = makeDetail({
      label: 'INV-20579',
      client: 'Chloe Bennett',
      events: [
        makeEvent({ type: 'pay', amountCents: 27820, method: 'Visa ••5521', methodKind: 'card' }),
        pend,
      ],
      items: [{ name: 'Executive Detail', priceCents: 26000 }],
    })
    const l = boot(makeSession({ role: 'mgmt' }), d)
    l.port.summaries.set(
      '7d',
      makeSummary({
        pendingApprovals: {
          count: 2,
          text: '2 refunds awaiting approval — $80.00 · Chloe Bennett · requested by Sofia D.',
          first: {
            eventId: pend.id,
            invoiceId: d.id,
            invoiceNo: 20579,
            label: 'INV-20579',
            client: 'Chloe Bennett',
            amountCents: 8000,
            dest: 'card',
            method: 'Visa ••5521',
            reason: null,
            note: null,
            requestedBy: 'Sofia D.',
            requestedByRole: 'Customer Support',
            requestedAt: '2026-06-12T20:40:00.000Z',
            atLabel: 'Yesterday 4:40 PM',
            bizDate: '2026-05-20',
          },
          all: [],
        },
      }),
    )
    let v = await load(l)
    expect(v.hasPending).toBe(true)
    expect(v.pendingText).toBe('2 refunds awaiting approval — $80.00 · Chloe Bennett · requested by Sofia D.')
    v.filters[2].onClick()
    v.onQuery({ target: { value: 'zzz' } })
    expect(l.logic.state.filter).toBe('refunds')
    l.vals().openPending()
    expect(l.logic.state).toMatchObject({ selId: d.id, range: '30d', filter: 'all', query: '' })
    v = l.vals()
    expect(v.d.ledger.find((e: any) => e.pending)).toBeTruthy()
  })
})

describe('an empty search keeps the last invoice on screen', () => {
  it('the detail panel does not go blank when no row matches', async () => {
    const l = boot()
    let v = await load(l)
    expect(v.d.id).toBe('INV-20607')
    v.onQuery({ target: { value: 'zzzz-no-such-client' } })
    v = await load(l)
    expect(v.rows).toEqual([])
    expect(v.noRows).toBe(true)
    expect(v.d.id).toBe('INV-20607')
    expect(v.d.actions.length).toBeGreaterThan(0)
  })
})

describe('permissions and the locked screen', () => {
  it('a role without pay.reports gets the locked card and never calls the API', async () => {
    const l = boot(makeSession({ role: 'support' }))
    const v = await load(l)
    expect(v.locked).toBe(true)
    expect(v.unlocked).toBe(false)
    expect(l.port.calls).toEqual([])
    expect(v.rows).toEqual([])
    expect(v.roleName).toBe('Management')
  })

  it('disabled buttons carry the design titles, from the session', async () => {
    const s = makeSession({ role: 'mgmt' })
    for (const k of ['pay.refund', 'pay.adjust', 'pay.credit', 'pay.collect'])
      s.permissions[k] = { on: false }
    const l = boot(s, unpaid())
    const v = await load(l)
    expect(v.d.actions.map((a: any) => [a.label, a.disabled, a.why])).toEqual([
      ['Collect $278.20', true, 'Role can’t collect payments'],
      ['Refund', true, 'Role can’t issue refunds'],
      ['Adjust', true, 'Role can’t adjust invoices'],
      ['Issue credit', true, 'Role can’t issue credits'],
      ['Send receipt', false, ''],
    ])
  })
})

describe('commands', () => {
  async function openCollect(l: Live) {
    let v = await load(l)
    v.d.actions[0].onClick()
    v = l.vals()
    return v
  }

  it('collect cash: not optimistic, submit disabled while in flight, one key per sheet, closes on success', async () => {
    const d = unpaid()
    const l = boot(makeSession({ role: 'mgmt' }), d)
    const after = makeDetail({
      label: 'INV-20607',
      client: 'Marcus Webb',
      events: [makeEvent({ type: 'pay', amountCents: 27820, method: 'Cash', methodKind: 'cash' })],
    })
    l.port.next.collect = { event: after.ledger[0], invoice: after }
    let v = await openCollect(l)
    expect(v.sheetOpen).toBe(true)
    expect(v.sh.isCollect).toBe(true)
    expect(v.sh.submitLabel).toBe('Collect $278.20')
    expect(v.sh.permText).toBe('Receipt goes out by SMS and email.')
    v.sh.payMethods[1].onClick()
    l.port.gate.hold = true
    v = l.vals()
    v.sh.submit()
    await l.settle()
    // in flight: the request went out, nothing changed on screen, the button is in its disabled style
    expect(l.port.calls.filter((c) => c.op === 'collect')).toHaveLength(1)
    expect(l.port.calls.find((c) => c.op === 'collect')!.args).toEqual([d.id, { method: 'cash' }])
    v = l.vals()
    expect(v.sh.blocked).toBe(true)
    expect(v.sh.submitStyle.background).toBe('var(--panel3)')
    expect(v.d.big[2].label).toBe('Balance due')
    v.sh.submit() // a double click while in flight is ignored
    await l.settle()
    expect(l.port.calls.filter((c) => c.op === 'collect')).toHaveLength(1)
    l.port.gate.release!()
    await l.settle()
    v = l.vals()
    expect(v.sheetOpen).toBe(false)
    expect(l.logic.state.toast).toBe('Collected $278.20')
    // the server's invoice replaced the cache: no recomputation on the client
    expect(v.d.big[2].label).toBe('Refundable')
  })

  it('a failed submit keeps the sheet open and the retry reuses the same Idempotency-Key; the next sheet gets a new one', async () => {
    const l = boot()
    l.port.next.collect = new ApiError({
      status: 503,
      title: 'Service unavailable',
      code: 'SERVICE_UNAVAILABLE',
    })
    const v = await openCollect(l)
    v.sh.submit()
    await l.settle()
    expect(l.vals().sheetOpen).toBe(true)
    expect(l.logic.state.busy).toBe(false)
    const d = unpaid()
    const ok = makeDetail({
      label: 'INV-20607',
      events: [
        makeEvent({
          type: 'pay',
          amountCents: 27820,
          method: 'Card',
          methodKind: 'card',
          awaitingProcessor: true,
          processorState: 'awaiting_processor',
        }),
      ],
    })
    l.port.next.collect = { event: ok.ledger[0], invoice: ok }
    l.vals().sh.submit()
    await l.settle()
    const keys = l.port.calls.filter((c) => c.op === 'collect').map((c) => c.key)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
    expect(l.vals().sheetOpen).toBe(false)
    // a new sheet is a new action
    l.port.details.set(d.id, d)
    l.qc.setQueryData(['payments', 'invoice', d.id], d)
    l.qc.invalidateQueries()
    await l.settle()
    l.vals().d.actions[0].onClick()
    l.port.next.collect = { event: ok.ledger[0], invoice: ok }
    l.vals().sh.submit()
    await l.settle()
    const keys2 = l.port.calls.filter((c) => c.op === 'collect').map((c) => c.key)
    expect(keys2[2]).not.toBe(keys[0])
  })

  it('payment link: the URL input appears, is required, and the server host error shows inline', async () => {
    const l = boot()
    l.port.next.collect = new ApiError({
      status: 422,
      code: 'PAYMENT_LINK_HOST',
      title: 'Link not allowed',
      detail: 'Payment links must be HTTPS links on an allowed host (squarespace.com)',
    })
    let v = await openCollect(l)
    expect(v.sh.needsUrl).toBe(false)
    v.sh.payMethods[2].onClick()
    v = l.vals()
    expect(v.sh.needsUrl).toBe(true)
    expect(v.sh.blocked).toBe(true)
    expect(v.sh.permText).toContain('texted to the client by SMS')
    v.sh.setUrl({ target: { value: 'http://evil.example/pay' } })
    v = l.vals()
    expect(v.sh.blocked).toBe(false)
    v.sh.submit()
    await l.settle()
    v = l.vals()
    expect(l.port.calls.find((c) => c.op === 'collect')!.args[1]).toEqual({
      method: 'payment_link',
      url: 'http://evil.example/pay',
    })
    expect(v.sheetOpen).toBe(true)
    expect(v.sh.hasUrlError).toBe(true)
    expect(v.sh.urlError).toBe('Payment links must be HTTPS links on an allowed host (squarespace.com)')
    v.sh.setUrl({ target: { value: 'https://pay.squarespace.com/x' } })
    expect(l.vals().sh.hasUrlError).toBe(false)
  })

  it('over-limit refund: label becomes "Request approval", the strict limit comparison, items map to item ids', async () => {
    const d = paidCard()
    const s = makeSession({ role: 'mgmt' })
    s.permissions['pay.refund'] = { on: true, limit: 10000 }
    s.limits.refund = 10000
    const l = boot(s, d)
    const sent = makeEvent({
      type: 'refund',
      amountCents: 27820,
      status: 'pending',
      dest: 'card',
      method: 'Visa ••4421',
    })
    l.port.next.refund = { event: sent, invoice: d }
    let v = await load(l)
    const refund = v.d.actions.find((a: any) => a.label === 'Refund')
    refund.onClick()
    v = l.vals()
    expect(v.sh.isRefund).toBe(true)
    expect(v.sh.submitLabel).toBe('Request approval · $278.20')
    expect(v.sh.permText).toBe('Over your $100 limit as Management. This will be sent for approval.')
    v.sh.modes[2].onClick()
    l.vals().sh.setAmount({ target: { value: '100' } })
    v = l.vals()
    expect(v.sh.submitLabel).toBe('Refund $100.00') // exactly at the limit is NOT over it
    expect(v.sh.permText).toContain('Within your $100 limit')
    l.vals().sh.setAmount({ target: { value: '100.01' } })
    expect(l.vals().sh.submitLabel).toBe('Request approval · $100.01')
    l.vals().sh.modes[1].onClick()
    l.vals().sh.itemRows[0].onClick()
    v = l.vals()
    expect(v.sh.itemRows[0].value).toBe('$278.20')
    v.sh.submit()
    await l.settle()
    const call = l.port.calls.find((c) => c.op === 'refund')!
    expect(call.args[1]).toMatchObject({
      mode: 'items',
      itemIds: [d.items[0]!.id],
      dest: 'card',
      reason: 'Service issue',
    })
    expect(l.logic.state.toast).toBe('Sent for approval · $278.20')
  })

  it('a role that lacks the permission gets the existing wording and the API is never called', async () => {
    const d = paidCard()
    const s = makeSession({ role: 'mgmt' })
    const l = boot(s, d)
    let v = await load(l)
    v.d.actions.find((a: any) => a.label === 'Refund').onClick()
    // the session loses pay.refund while the sheet is open (rbac change)
    s.permissions['pay.refund'] = { on: false }
    l.chrome.setSession({ ...s })
    v = l.vals()
    l.logic.setState({ sheet: 'refund' })
    v = l.vals()
    v.sh.submit()
    await l.settle()
    expect(l.port.calls.some((c) => c.op === 'refund')).toBe(false)
    expect(l.logic.state.toast).toBe('Your role can’t issue refunds')
  })

  it('approve: server canApprove decides; self-approval and over-limit never call the API; success shows the design toast', async () => {
    const mk = (over: Partial<Parameters<typeof makeEvent>[0]>) =>
      makeDetail({
        label: 'INV-20579',
        client: 'Chloe Bennett',
        events: [
          makeEvent({ type: 'pay', amountCents: 27820, method: 'Visa ••5521', methodKind: 'card' }),
          makeEvent({
            type: 'refund',
            amountCents: 8000,
            status: 'pending',
            dest: 'card',
            method: 'Visa ••5521',
            reason: 'Service issue',
            by: 'Sofia D.',
            ...over,
          }),
        ],
      })
    // blocked by limit
    let d = mk({ canApprove: false, approveBlock: 'limit' })
    let l = boot(makeSession({ role: 'mgmt' }), d)
    let v = await load(l)
    expect(v.d.ledger[0].pending).toBe(true)
    expect(v.d.ledger[0].approveNote).toBe('Needs a role with a refund limit of at least $80.')
    v.d.ledger[0].approve()
    await l.settle()
    expect(l.logic.state.toast).toBe('Your role can’t approve $80.00')
    expect(l.port.calls.some((c) => c.op === 'approveRefund')).toBe(false)
    // blocked: self
    resetIds()
    d = mk({ canApprove: false, approveBlock: 'self' })
    l = boot(makeSession({ role: 'mgmt' }), d)
    v = await load(l)
    v.d.ledger[0].approve()
    expect(l.logic.state.toast).toBe('You can’t approve a refund you requested. Ask another approver.')
    expect(l.port.calls.some((c) => c.op === 'approveRefund')).toBe(false)
    // allowed
    resetIds()
    d = mk({ canApprove: true })
    l = boot(makeSession({ role: 'mgmt' }), d)
    const done = makeEvent({
      type: 'refund',
      amountCents: 8000,
      status: 'done',
      dest: 'card',
      method: 'Visa ••5521',
    })
    l.port.next.approveRefund = { event: done, invoice: d }
    v = await load(l)
    expect(v.d.ledger[0].approveNote).toBe('You can approve up to $500.')
    v.d.ledger[0].approve()
    await l.settle()
    expect(l.port.calls.find((c) => c.op === 'approveRefund')!.args).toEqual([d.id, d.ledger[0]!.id])
    expect(l.logic.state.toast).toBe('Refund approved · $80.00 to Visa ••5521')
  })

  it('deny calls the API with permission, and without pay.refund it shows the wording instead', async () => {
    const d = makeDetail({
      label: 'INV-20579',
      events: [
        makeEvent({ type: 'pay', amountCents: 27820, method: 'Visa ••5521', methodKind: 'card' }),
        makeEvent({
          type: 'refund',
          amountCents: 8000,
          status: 'pending',
          dest: 'card',
          method: 'Visa ••5521',
          canApprove: true,
        }),
      ],
    })
    const l = boot(makeSession({ role: 'mgmt' }), d)
    l.port.next.denyRefund = { event: d.ledger[0], invoice: d }
    const v = await load(l)
    v.d.ledger[0].deny()
    await l.settle()
    expect(l.port.calls.some((c) => c.op === 'denyRefund')).toBe(true)
    expect(l.logic.state.toast).toBe('Refund request denied')
  })
})

describe('deny without the permission', () => {
  it('shows the wording and does not call the API', async () => {
    const d = makeDetail({
      label: 'INV-20579',
      events: [
        makeEvent({ type: 'pay', amountCents: 27820, method: 'Visa ••5521', methodKind: 'card' }),
        makeEvent({
          type: 'refund',
          amountCents: 8000,
          status: 'pending',
          dest: 'card',
          method: 'Visa ••5521',
        }),
      ],
    })
    const s = makeSession({ role: 'mgmt' })
    s.permissions['pay.refund'] = { on: false }
    const l = boot(s, d)
    const v = await load(l)
    v.d.ledger[0].deny()
    expect(l.port.calls.some((c) => c.op === 'denyRefund')).toBe(false)
    expect(l.logic.state.toast).toBe('Your role can’t issue refunds')
  })
})

describe('Squarespace states (DV-212, DV-214)', () => {
  const awaitingPay = () =>
    makeEvent({
      type: 'pay',
      amountCents: 27820,
      method: 'Card',
      methodKind: 'card',
      processorState: 'awaiting_processor',
      awaitingProcessor: true,
    })

  it('an awaiting payment says so in the meta, the pill reads Payment pending, and Confirm calls the endpoint', async () => {
    const ev = awaitingPay()
    const d = makeDetail({ label: 'INV-20610', events: [ev] })
    const l = boot(makeSession({ role: 'mgmt' }), d)
    l.port.rows = [makeRow(d, { awaiting: 'payment' })]
    l.port.next.confirmProcessor = {
      event: { ...ev, awaitingProcessor: false, processorState: 'confirmed' },
      invoice: d,
    }
    const v = await load(l)
    expect(v.rows[0].status).toBe('Payment pending')
    expect(v.rows[0].statusStyle.color).toBe('var(--amber)')
    expect(v.d.status).toBe('Payment pending')
    const e = v.d.ledger[0]
    expect(e.title).toBe('Payment · Card')
    expect(e.meta).toBe('Today 10:00 AM · Rafael M. (Management) · Awaiting Squarespace')
    expect(e.awaiting).toBe(true)
    expect(e.pending).toBe(false)
    e.confirm()
    await l.settle()
    expect(l.port.calls.find((c) => c.op === 'confirmProcessor')!.args).toEqual([ev.id])
    expect(l.logic.state.toast).toBe('Payment confirmed in Squarespace · $278.20')
  })

  it('a refund awaiting Squarespace reads Refund pending and needs pay.refund to confirm', async () => {
    const ev = makeEvent({
      type: 'refund',
      amountCents: 5000,
      dest: 'card',
      method: 'Visa',
      processorState: 'awaiting_processor',
      awaitingProcessor: true,
    })
    const d = makeDetail({
      label: 'INV-20611',
      events: [makeEvent({ type: 'pay', amountCents: 27820, method: 'Visa', methodKind: 'card' }), ev],
    })
    const s = makeSession({ role: 'mgmt' })
    s.permissions['pay.refund'] = { on: false }
    const l = boot(s, d)
    const v = await load(l)
    expect(v.d.status).toBe('Refund pending')
    expect(v.d.ledger[0].confirmNote).toBe('Needs a role that can issue refunds.')
    v.d.ledger[0].confirm()
    expect(l.port.calls.some((c) => c.op === 'confirmProcessor')).toBe(false)
    expect(l.logic.state.toast).toBe('Your role can’t issue refunds')
  })
})

describe('other commands and the D3 fixes in live mode', () => {
  it('send receipt: SMS wording, only the channels that took it', async () => {
    const d = paidCard()
    const l = boot(makeSession({ role: 'mgmt' }), d)
    let v = await load(l)
    const receipt = v.d.actions.find((a: any) => a.label === 'Send receipt')
    l.port.next.sendReceipt = { sms: 'queued', email: 'queued', invoice: d }
    receipt.onClick()
    await l.settle()
    expect(l.logic.state.toast).toBe('Receipt sent to Liam Chen via SMS + email')
    l.port.next.sendReceipt = { sms: 'skipped_opt_out', email: 'queued', invoice: d }
    l.vals()
      .d.actions.find((a: any) => a.label === 'Send receipt')
      .onClick()
    await l.settle()
    expect(l.logic.state.toast).toBe('Receipt sent to Liam Chen via email')
    l.port.next.sendReceipt = { sms: 'no_contact', email: 'no_contact', invoice: d }
    l.vals()
      .d.actions.find((a: any) => a.label === 'Send receipt')
      .onClick()
    await l.settle()
    expect(l.logic.state.toast).toBe('Receipt not sent · Liam Chen has no SMS or email to reach')
    v = l.vals()
  })

  it('adjust: percent goes as basis points, settlement shows for a paid invoice, toast uses the server total', async () => {
    const d = paidCard()
    const l = boot(makeSession({ role: 'mgmt' }), d)
    const after = makeDetail({
      label: 'INV-20606',
      events: [
        ...[...d.ledger].reverse(),
        makeEvent({ type: 'adjust', amountCents: -2600, reason: 'Loyalty' }),
        makeEvent({
          type: 'refund',
          amountCents: 2782,
          dest: 'credit',
          method: 'Store credit',
          reason: 'Adjustment settlement',
        }),
      ],
    })
    l.port.next.adjust = { event: after.ledger[1], settlement: after.ledger[0], invoice: after }
    let v = await load(l)
    v.d.actions.find((a: any) => a.label === 'Adjust').onClick()
    v = l.vals()
    v.sh.units[1].onClick()
    l.vals().sh.setAmount({ target: { value: '10' } })
    v = l.vals()
    expect(v.sh.valueLabel).toBe('Percent of services')
    expect(v.sh.showSettle).toBe(true)
    expect(v.sh.summary.map((r: any) => [r.label, r.value])).toEqual([
      ['Current total', '$278.20'],
      ['Discount (pre-tax)', '−$26.00'],
      ['New total', '$250.38'],
      ['Overpaid — returned as store credit', '$27.82'],
    ])
    v.sh.submit()
    await l.settle()
    expect(l.port.calls.find((c) => c.op === 'adjust')!.args[1]).toEqual({
      kind: 'discount',
      unit: '%',
      value: 1000,
      reason: 'Service recovery',
      note: null,
      settle: 'credit',
    })
    expect(l.logic.state.toast).toBe('Discount applied · new total $250.38')
  })

  it('issue credit and apply credit', async () => {
    const d = makeDetail({ label: 'INV-20607', client: 'Marcus Webb', creditCents: 2500 })
    const l = boot(makeSession({ role: 'mgmt' }), d)
    const ev = makeEvent({
      type: 'credit_issue',
      amountCents: 2000,
      expiry: 'd90',
      expiryLabel: '90 days',
      reason: 'Goodwill',
    })
    l.port.next.issueCredit = { event: ev, invoice: d }
    let v = await load(l)
    expect(v.d.creditLine).toBe('Marcus has $25.00 in store credit')
    expect(v.d.actions.map((a: any) => a.label)).toEqual([
      'Collect $278.20',
      'Apply $25.00 credit',
      'Refund',
      'Adjust',
      'Issue credit',
      'Send receipt',
    ])
    v.d.actions.find((a: any) => a.label === 'Issue credit').onClick()
    l.vals().sh.setAmount({ target: { value: '20' } })
    v = l.vals()
    expect(v.sh.submitLabel).toBe('Issue $20.00 credit')
    expect(v.sh.summary.map((r: any) => r.value)).toEqual(['$25.00', '+$20.00', '$45.00'])
    v.sh.reasons.find((r: any) => r.label === 'Goodwill').onClick()
    l.vals().sh.submit()
    await l.settle()
    expect(l.port.calls.find((c) => c.op === 'issueCredit')!.args[1]).toEqual({
      amountCents: 2000,
      reason: 'Goodwill',
      note: null,
      expiry: '90 days',
    })
    expect(l.logic.state.toast).toBe('$20.00 credit issued to Marcus Webb')
    l.vals()
      .d.actions.find((a: any) => a.label.startsWith('Apply'))
      .onClick()
    expect(l.vals().sh.title).toBe('Apply store credit')
    expect(l.vals().sh.submitLabel).toBe('Apply $25.00')
    l.port.next.applyCredit = { event: makeEvent({ type: 'credit_apply', amountCents: 2500 }), invoice: d }
    l.vals().sh.submit()
    await l.settle()
    expect(l.logic.state.toast).toBe('$25.00 credit applied')
  })

  it('export CSV is a real download of the active range, filter and search; the toast keeps the count', async () => {
    const d = unpaid()
    const l = boot(makeSession({ role: 'mgmt' }), d)
    const v = await load(l)
    v.onQuery({ target: { value: 'marcus' } })
    l.vals().filters[1].onClick()
    await l.settle()
    l.vals().exportCsv()
    await l.settle()
    expect(l.port.calls.find((c) => c.op === 'exportCsv')!.args[0]).toEqual({
      range: '7d',
      filter: 'unpaid',
      q: 'marcus',
    })
    expect(l.downloads).toEqual([{ filename: 'oasis-invoices_2026-06-07_2026-06-13.csv' }])
    expect(l.logic.state.toast).toBe('CSV export started · 1 invoice')
  })
})

describe('view-as and the live chrome', () => {
  it('a view-as or role change refetches the payments family and closes an open sheet', async () => {
    const d = unpaid()
    const l = boot(makeSession({ role: 'super' }), d)
    let v = await load(l)
    v.d.actions[0].onClick()
    expect(l.vals().sheetOpen).toBe(true)
    const before = l.port.calls.filter((c) => c.op === 'summary').length
    const s2 = makeSession({ role: 'super' })
    s2.viewAs = { ...s2.viewAs, active: true, roleId: 'role-crew', roleName: 'Crew' }
    s2.permissions = { ...s2.permissions, 'pay.reports': { on: false } }
    l.chrome.setSession(s2)
    await l.settle()
    v = l.vals()
    expect(v.sheetOpen).toBe(false)
    expect(v.locked).toBe(true)
    expect(v.roleName).toBe('Crew')
    expect(v.live.viewAs.active).toBe(true)
    expect(l.port.calls.filter((c) => c.op === 'summary').length).toBe(before)
    // back to the real role: reads happen again
    l.chrome.setSession(makeSession({ role: 'super' }))
    await l.settle()
    l.vals()
    await l.settle()
    expect(l.port.calls.filter((c) => c.op === 'summary').length).toBeGreaterThan(before)
  })

  it('theme toggles through the chrome and the local cache', async () => {
    const l = boot()
    const v = await load(l)
    const reported: Array<[string, string]> = []
    l.chrome.bind({ signOut() {}, viewAs() {}, themeChanged: (n, p) => void reported.push([n, p]) })
    v.toggleTheme()
    expect(l.logic.state.theme).toBe('dark')
    expect(l.themes).toEqual(['dark'])
    expect(reported).toEqual([['dark', 'light']])
  })
})
