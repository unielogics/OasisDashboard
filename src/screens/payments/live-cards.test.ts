// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// The live Payments view model with saved cards (ADR 0171 wave Q3; DV-901, DV-902): the Collect sheet offers "Saved card
// ••4242" only when the server names a usable card, asks for the client's OK, charges exactly the balance with the sheet's
// Idempotency-Key, and shows a decline (a retry is a new attempt on the same charge, same key) or "waiting for Square" (202).
// A Square payment's ledger entry links to its receipt page. A role without pay.collect gets the wording and no request.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeMe } from '@/auth/test-fixtures'
import { toSession } from '@/auth/session-model'
import type { Session } from '@/auth/session-model'
import { ApiError } from '@/data/http/problem'
import type { CardCharge, InvoiceDetail } from '@/data/ports/payments'
import { makeDetail, makeEvent, makeLive, makeRow, resetIds, stubPort } from './live-testkit'
import type { Live } from './live-testkit'

beforeEach(() => {
  resetIds()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
  localStorage.clear()
})
afterEach(() => vi.useRealTimers())

const CARD = { cardId: 'card-1', label: 'Visa ••4242', brand: 'VISA', last4: '4242' }
const withCard = (d: InvoiceDetail, savedCard: typeof CARD | null = CARD): InvoiceDetail => ({
  ...d,
  processing: {
    processor: 'square',
    squarePosAppSwitch: false,
    squareTenders: { reader: true, link: true, savedCard },
  },
})
const unpaid = (savedCard: typeof CARD | null = CARD) =>
  withCard(
    makeDetail({
      label: 'INV-20640',
      client: 'Maria Alvarez',
      items: [{ name: 'Signature Hand Wash', priceCents: 4000 }],
    }),
    savedCard,
  )

function session(role: 'mgmt' | 'acct', without: string[] = []): Session {
  const me = makeMe({ role })
  for (const k of without) me.permissions[k] = { on: false }
  return toSession(me, { serverTime: '2026-06-13T14:36:00.000Z', businessTz: 'America/New_York' })
}

function boot(who: Session, ...details: InvoiceDetail[]): Live {
  const port = stubPort()
  for (const d of details) port.details.set(d.id, d)
  port.rows = details.map((d) => makeRow(d))
  return makeLive(who, port)
}

async function load(l: Live) {
  for (let i = 0; i < 4; i++) {
    l.vals()
    await l.settle()
  }
  return l.vals()
}

async function openCollect(l: Live) {
  const v = await load(l)
  v.d.actions.find((a: any) => a.label.startsWith('Collect')).onClick()
  return l.vals()
}

function charge(over: Partial<CardCharge> = {}): CardCharge {
  return {
    id: 'ch-1',
    purpose: 'balance',
    state: 'charged',
    amountCents: 4280,
    reason: 'Balance',
    card: { id: 'card-1', label: 'Visa ••4242', brand: 'VISA', last4: '4242' },
    invoiceId: 'uuid-INV-20640',
    appointmentId: null,
    squarePaymentId: 'sqp-1',
    error: null,
    declineCode: null,
    attempts: 1,
    proposedBy: null,
    decidedBy: 'Rafael M.',
    decidedAt: '2026-06-13T14:36:00.000Z',
    chargedAt: '2026-06-13T14:36:00.000Z',
    waiveReason: null,
    createdAt: '2026-06-13T14:36:00.000Z',
    ...over,
  }
}

describe('Collect: the saved card (DV-901)', () => {
  it('is offered only when the server names a usable card', async () => {
    let l = boot(session('mgmt'), unpaid())
    let v = await openCollect(l)
    expect(v.sh.payMethods.map((m: any) => m.label)).toEqual([
      'Square reader',
      'Saved card ••4242',
      'Cash',
      'Payment link',
    ])
    l = boot(session('mgmt'), unpaid(null))
    v = await openCollect(l)
    expect(v.sh.payMethods.map((m: any) => m.label)).toEqual(['Square reader', 'Cash', 'Payment link'])
    expect(v.sh.scShow).toBe(false)
  })

  it('asks for the client’s OK, then charges exactly the balance with the sheet’s key', async () => {
    const d = unpaid()
    const l = boot(session('mgmt'), d)
    let v = await openCollect(l)
    v.sh.payMethods.find((m: any) => m.label === 'Saved card ••4242').onClick()
    v = l.vals()
    expect(v.sh.scShow).toBe(true)
    expect(v.sh.scOk).toBe(false)
    expect(v.sh.scOkText).toBe('Maria said OK to charge $42.80 to Visa ••4242')
    expect(v.sh.submitLabel).toBe('Charge $42.80 to Visa ••4242')
    expect(v.sh.blocked).toBe(true)
    v.sh.submit()
    await l.settle()
    expect(l.port.calls.some((c) => c.op === 'chargeCard')).toBe(false)
    v.sh.scToggle()
    v = l.vals()
    expect(v.sh.scOk).toBe(true)
    expect(v.sh.blocked).toBe(false)
    l.port.next.chargeCard = { charge: charge(), invoice: { ...d, status: 'paid' } }
    v.sh.submit()
    await l.settle()
    const call = l.port.calls.find((c) => c.op === 'chargeCard')!
    expect(call.args).toEqual(['uuid-INV-20640', { cardId: 'card-1', amountCents: 4280 }])
    expect(call.key).toBeTruthy()
    v = l.vals()
    expect(v.sheetOpen).toBe(false)
    expect(l.logic.state.toast).toBe('Charged $42.80 to Visa ••4242')
  })

  it('a decline keeps the sheet, says why, clears the OK; the retry is the same charge (same key)', async () => {
    const l = boot(session('mgmt'), unpaid())
    let v = await openCollect(l)
    v.sh.payMethods.find((m: any) => m.label === 'Saved card ••4242').onClick()
    l.vals().sh.scToggle()
    l.port.next.chargeCard = new ApiError({
      status: 422,
      code: 'CARD_DECLINED',
      title: 'Card declined',
      detail: 'The card was declined.',
      meta: { chargeId: 'ch-1' },
    })
    l.vals().sh.submit()
    await l.settle()
    v = l.vals()
    expect(v.sheetOpen).toBe(true)
    expect(v.sh.scDeclined).toBe(true)
    expect(v.sh.scDeclineText).toBe('Card declined: The card was declined. Ask Maria for another way to pay.')
    expect(v.sh.scOk).toBe(false)
    expect(v.sh.blocked).toBe(true)
    const first = l.port.calls.filter((c) => c.op === 'chargeCard')[0]!.key
    v.sh.scToggle()
    v = l.vals()
    expect(v.sh.scDeclined).toBe(false)
    l.port.next.chargeCard = { charge: charge({ attempts: 2 }), invoice: null }
    v.sh.submit()
    await l.settle()
    const keys = l.port.calls.filter((c) => c.op === 'chargeCard').map((c) => c.key)
    expect(keys).toEqual([first, first])
    expect(l.vals().sheetOpen).toBe(false)
  })

  it('Square did not answer (202): waiting for Square, Done closes; nothing is sent again', async () => {
    const l = boot(session('mgmt'), unpaid())
    l.vals()
    let v = await openCollect(l)
    v.sh.payMethods.find((m: any) => m.label === 'Saved card ••4242').onClick()
    l.vals().sh.scToggle()
    l.port.next.chargeCard = {
      charge: charge({ state: 'unknown', squarePaymentId: null, chargedAt: null }),
      invoice: null,
    }
    l.vals().sh.submit()
    await l.settle()
    v = l.vals()
    expect(v.sheetOpen).toBe(true)
    expect(v.sh.scWaiting).toBe(true)
    expect(v.sh.scWaitingText).toMatch(/^Waiting for Square:/)
    expect(v.sh.scShow).toBe(false)
    expect(v.sh.submitLabel).toBe('Done')
    expect(l.logic.state.toast).toBe('Waiting for Square · $42.80 on Visa ••4242')
    v.sh.submit()
    await l.settle()
    expect(l.vals().sheetOpen).toBe(false)
    expect(l.port.calls.filter((c) => c.op === 'chargeCard')).toHaveLength(1)
  })

  it('another tender clears the OK and the last answer', async () => {
    const l = boot(session('mgmt'), unpaid())
    const v = await openCollect(l)
    v.sh.payMethods.find((m: any) => m.label === 'Saved card ••4242').onClick()
    l.vals().sh.scToggle()
    l.vals()
      .sh.payMethods.find((m: any) => m.label === 'Cash')
      .onClick()
    l.vals()
      .sh.payMethods.find((m: any) => m.label === 'Saved card ••4242')
      .onClick()
    expect(l.vals().sh.scOk).toBe(false)
  })

  it('a role without pay.collect: the wording, no request', async () => {
    const l = boot(session('acct', ['pay.collect']), unpaid())
    await load(l)
    l.logic.openSheet('collect', unpaid(), { method: 'Saved card ••4242', cardOk: true })
    l.vals().sh.submit()
    await l.settle()
    expect(l.port.calls.some((c) => c.op === 'chargeCard')).toBe(false)
    expect(l.logic.state.toast).toBe('Your role can’t collect payments')
  })
})

describe('Square receipts on the ledger (DV-902)', () => {
  it('the entry links to Square’s receipt page, opened in a new tab', async () => {
    const pay = makeEvent({
      type: 'pay',
      amountCents: 4280,
      method: 'Visa ••4242',
      methodKind: 'card',
      processor: 'square',
      processorState: 'confirmed',
      processorRef: 'sqp-1',
      receiptNumber: 'Xy7Q',
      receiptUrl: 'https://squareup.com/receipt/preview/sqp-1',
    })
    const d = withCard(makeDetail({ label: 'INV-20640', events: [pay] }), null)
    const l = boot(session('mgmt'), d)
    const v = await load(l)
    const e = v.d.ledger[0]
    expect(e.meta).toContain('Receipt #Xy7Q')
    expect(e.sqHasReceipt).toBe(true)
    expect(e.sqReceiptLabel).toBe('Square receipt #Xy7Q')
    e.sqReceiptOpen()
    expect(l.opened).toEqual(['https://squareup.com/receipt/preview/sqp-1'])
  })
})

describe('the fee of a canceled visit on its invoice (DV-904)', () => {
  const canceled = (): InvoiceDetail => ({
    ...makeDetail({
      label: 'INV-20641',
      client: 'Maria Alvarez',
      canceled: true,
      items: [{ name: 'Signature Hand Wash', priceCents: 4000 }],
    }),
    appointmentId: 'appt-1',
  })
  const fee = (over: Partial<CardCharge> = {}): CardCharge =>
    charge({
      id: 'fee-1',
      purpose: 'no_show_fee',
      state: 'proposed',
      amountCents: 1500,
      squarePaymentId: null,
      chargedAt: null,
      decidedBy: null,
      ...over,
    })

  it('a proposed fee shows under the actions; Charge asks first, then charges on the visit', async () => {
    const d = canceled()
    const l = boot(session('mgmt'), d)
    l.port.charges.set(d.id, [fee()])
    let v = await load(l)
    expect(l.port.calls.some((c) => c.op === 'invoiceCharges')).toBe(true)
    expect(v.live.feeShow).toBe(true)
    expect(v.live.feeRows[0]).toMatchObject({ title: 'No-show fee · $15 on Visa ••4242', canDecide: true })
    v.live.feeRows[0].charge()
    v = l.vals()
    expect(v.live.feeRows[0].confirming).toBe(true)
    expect(v.live.feeRows[0].confirmText).toBe('Charge the No-show fee of $15 on Visa ••4242 now?')
    l.port.next.chargeFee = { charge: fee({ state: 'charged' }), invoice: null }
    v.live.feeRows[0].confirm()
    await l.settle()
    const call = l.port.calls.find((c) => c.op === 'chargeFee')!
    expect(call.args).toEqual(['appt-1', 'fee-1'])
    expect(call.key).toBeTruthy()
    expect(l.logic.state.toast).toBe('No-show fee charged · $15 on Visa ••4242')
  })

  it('Waive needs a reason; an open invoice reads no fees', async () => {
    const d = canceled()
    const l = boot(session('mgmt'), d)
    l.port.charges.set(d.id, [fee()])
    let v = await load(l)
    v.live.feeRows[0].waive()
    l.vals().live.feeRows[0].waiveConfirm()
    await l.settle()
    expect(l.port.calls.some((c) => c.op === 'waiveFee')).toBe(false)
    l.vals().live.feeRows[0].setReason({ target: { value: 'First time' } })
    l.port.next.waiveFee = { charge: fee({ state: 'waived' }) }
    l.vals().live.feeRows[0].waiveConfirm()
    await l.settle()
    expect(l.port.calls.find((c) => c.op === 'waiveFee')!.args).toEqual(['appt-1', 'fee-1', 'First time'])
    const open = boot(session('mgmt'), unpaid())
    v = await load(open)
    expect(v.live.feeShow).toBe(false)
    expect(open.port.calls.some((c) => c.op === 'invoiceCharges')).toBe(false)
  })
})
