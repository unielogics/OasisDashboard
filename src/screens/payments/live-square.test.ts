// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// The live Payments view model with Square (ADR 0171; DV-802..DV-806): the Collect tenders and the link that stays on screen,
// the "Square payments to match" banner and sheet (apply, set aside, the reader entry's match button, the refused refunds),
// and moving a Square payment to the right invoice. Every command goes to the server; a role without the permission gets
// the wording and no request.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeMe } from '@/auth/test-fixtures'
import { toSession } from '@/auth/session-model'
import type { Session } from '@/auth/session-model'
import type { InvoiceDetail, SquarePaymentToMatch } from '@/data/ports/payments'
import { makeDetail, makeEvent, makeLive, makeRow, resetIds, stubPort } from './live-testkit'
import type { Live } from './live-testkit'

beforeEach(() => {
  resetIds()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
  localStorage.clear()
})
afterEach(() => vi.useRealTimers())

const SQUARE = { processing: { processor: 'square' as const, squarePosAppSwitch: false } }

const sq = (d: InvoiceDetail): InvoiceDetail => ({ ...d, ...SQUARE })

function payment(over: Partial<SquarePaymentToMatch> = {}): SquarePaymentToMatch {
  return {
    paymentId: 'sqp-1',
    matchState: 'unmatched',
    classification: 'counter',
    amountCents: 4280,
    tipCents: 0,
    totalCents: 4280,
    refundedCents: 0,
    method: 'Visa ••4242',
    sourceType: 'CARD',
    brand: 'VISA',
    last4: '4242',
    note: null,
    receiptNumber: 'Xy7Q',
    product: 'SQUARE_POS',
    createdAt: '2026-06-13T14:00:00.000Z',
    ageMinutes: 12,
    candidates: [],
    ...over,
  }
}

/** Management, or Accounting with some permissions taken away. */
function session(role: 'mgmt' | 'acct', without: string[] = []): Session {
  const me = makeMe({ role })
  for (const k of without) me.permissions[k] = { on: false }
  return toSession(me, { serverTime: '2026-06-13T14:36:00.000Z', businessTz: 'America/New_York' })
}

function boot(who: 'mgmt' | Session, ...details: InvoiceDetail[]): Live {
  const port = stubPort()
  for (const d of details) port.details.set(d.id, d)
  port.rows = details.map((d) => makeRow(d))
  return makeLive(who === 'mgmt' ? session('mgmt') : who, port)
}

async function load(l: Live) {
  for (let i = 0; i < 4; i++) {
    l.vals()
    await l.settle()
  }
  return l.vals()
}

const unpaid = () =>
  sq(makeDetail({ label: 'INV-20640', client: 'Maria Alvarez', items: [{ name: 'Signature Hand Wash', priceCents: 4000 }] }))

describe('Collect with Square (DV-802)', () => {
  it('offers Square reader / Cash / Payment link; the reader records the card entry Square confirms', async () => {
    const l = boot('mgmt', unpaid())
    let v = await load(l)
    v.d.actions.find((a: any) => a.label.startsWith('Collect')).onClick()
    v = l.vals()
    expect(v.sh.payMethods.map((m: any) => m.label)).toEqual(['Square reader', 'Cash', 'Payment link'])
    expect(v.sh.needsUrl).toBe(false)
    expect(v.sh.submitLabel).toBe('Charge $42.80 on the reader')
    l.port.next.collect = {
      event: makeEvent({ type: 'pay', amountCents: 4280, awaitingProcessor: true, processorState: 'awaiting_processor' }),
      invoice: unpaid(),
    }
    v.sh.submit()
    await l.settle()
    expect(l.port.calls.find((c) => c.op === 'collect')!.args[1]).toEqual({ method: 'card' })
    v = l.vals()
    expect(v.sheetOpen).toBe(false)
    expect(v.toast).toBe('Awaiting Square · $42.80 on the reader')
  })

  it('a payment link has no URL box; a Square link the server made stays on screen with Copy, Done closes', async () => {
    const l = boot('mgmt', unpaid())
    let v = await load(l)
    v.d.actions.find((a: any) => a.label.startsWith('Collect')).onClick()
    v = l.vals()
    v.sh.payMethods.find((m: any) => m.label === 'Payment link').onClick()
    v = l.vals()
    expect(v.sh.needsUrl).toBe(false)
    expect(v.sh.submitLabel).toBe('Text link · $42.80')
    l.port.next.collect = {
      invoice: unpaid(),
      paymentLink: {
        id: 'pl1',
        url: 'https://square.link/u/AbCd',
        expectedCents: 4280,
        purpose: 'balance',
        sms: 'queued',
        provider: 'square',
      },
    }
    v.sh.submit()
    await l.settle()
    expect(l.port.calls.find((c) => c.op === 'collect')!.args[1]).toEqual({ method: 'payment_link' })
    v = l.vals()
    expect(v.sheetOpen).toBe(true)
    expect(v.sh.hasSentLink).toBe(true)
    expect(v.sh.sentLink).toBe('https://square.link/u/AbCd')
    expect(v.toast).toBe('Pay link texted to Maria · $42.80')
    expect(v.sh.permText).toBe('Link texted. It is for exactly $42.80.')
    v.sh.copyLink()
    await l.settle()
    expect(l.copied).toEqual(['https://square.link/u/AbCd'])
    expect(l.vals().toast).toBe('Link copied')
    l.vals().sh.submit()
    expect(l.vals().sheetOpen).toBe(false)
    expect(l.port.calls.filter((c) => c.op === 'collect')).toHaveLength(1)
  })

  it('a Square link the client could not be texted says so on the sheet, not "Link texted" (F2)', async () => {
    const l = boot('mgmt', unpaid())
    let v = await load(l)
    v.d.actions.find((a: any) => a.label.startsWith('Collect')).onClick()
    l.vals().sh.payMethods.find((m: any) => m.label === 'Payment link').onClick()
    l.port.next.collect = {
      invoice: unpaid(),
      paymentLink: {
        id: 'pl1',
        url: 'https://square.link/u/AbCd',
        expectedCents: 4280,
        purpose: 'balance',
        sms: 'skipped_opt_out',
        provider: 'square',
      },
    }
    l.vals().sh.submit()
    await l.settle()
    v = l.vals()
    expect(v.sheetOpen).toBe(true)
    expect(v.sh.sentLink).toBe('https://square.link/u/AbCd')
    expect(v.toast).toBe('Pay link ready · Maria opted out of SMS')
    expect(v.sh.permText).toBe(
      'Not texted: Maria opted out of SMS. Copy the link and send it another way. It is for exactly $42.80.',
    )
    expect(v.sh.permText).not.toContain('Link texted')
    l.vals().sh.submit()
    expect(l.vals().sheetOpen).toBe(false)
  })

  it('a texted personal link (no URL back) closes the sheet', async () => {
    const l = boot('mgmt', unpaid())
    let v = await load(l)
    v.d.actions.find((a: any) => a.label.startsWith('Collect')).onClick()
    l.vals().sh.payMethods.find((m: any) => m.label === 'Payment link').onClick()
    l.port.next.collect = {
      invoice: unpaid(),
      paymentLink: { id: 'pl1', url: null, expectedCents: 4280, purpose: 'balance', sms: 'queued', provider: 'personal' },
    }
    l.vals().sh.submit()
    await l.settle()
    v = l.vals()
    expect(v.sheetOpen).toBe(false)
    expect(v.toast).toBe('Pay link texted to Maria · $42.80')
  })
})

describe('Square payments to match (DV-805, DV-806)', () => {
  it('no queue, no banner (an older server or nothing waiting)', async () => {
    const l = boot('mgmt', unpaid())
    const v = await load(l)
    expect(v.live.sqHasBanner).toBe(false)
    expect(v.live.sqOpen).toBe(false)
  })

  it('the banner opens the sheet; Apply records it on the candidate and confirms its reader entry', async () => {
    const d = unpaid()
    const l = boot('mgmt', d)
    l.port.toMatch = [
      payment({
        candidates: [
          { invoiceId: d.id, invoiceNo: 20640, client: 'Maria Alvarez', balanceCents: 4280, awaitingEventId: 'ev-77', score: 0.9, why: ['same amount'] },
        ],
      }),
    ]
    let v = await load(l)
    expect(v.live.sqHasBanner).toBe(true)
    expect(v.live.sqBanner).toBe('1 Square payment to match · $42.80 · oldest 12 min ago')
    v.live.sqReview()
    v = await load(l)
    expect(v.live.sqOpen).toBe(true)
    expect(l.port.calls.some((c) => c.op === 'reconciliation')).toBe(true)
    const item = v.live.sqItems[0]
    expect(item.line).toBe('$42.80 · Visa ••4242')
    expect(item.meta).toBe('12 min ago · Receipt #Xy7Q')
    expect(item.targets).toHaveLength(1)
    expect(item.targets[0].label).toBe('INV-20640 · Maria Alvarez')
    l.port.next.squareApply = { paymentId: 'sqp-1', matchState: 'matched', invoiceId: d.id, eventId: 'ev-77', invoice: d }
    item.targets[0].apply()
    await l.settle()
    const call = l.port.calls.find((c) => c.op === 'squareApply')!
    expect(call.args).toEqual(['sqp-1', { invoiceId: d.id, confirmEventId: 'ev-77' }])
    expect(call.key).toBeTruthy()
    expect(l.vals().toast).toBe('Square reader payment confirmed · $42.80')
  })

  it('Set aside needs a reason, then sends it; nothing is written to the ledger by the screen', async () => {
    const l = boot('mgmt', unpaid())
    l.port.toMatch = [payment()]
    let v = await load(l)
    v.live.sqReview()
    v = await load(l)
    // no candidates: the invoice open on screen is offered
    expect(v.live.sqItems[0].targets[0].label).toBe('INV-20640 · Maria Alvarez (open on screen)')
    v.live.sqItems[0].ignore()
    await l.settle()
    expect(l.vals().toast).toBe('Pick a reason first')
    expect(l.port.calls.some((c) => c.op === 'squareIgnore')).toBe(false)
    l.vals().live.sqItems[0].reasons.find((r: any) => r.label === 'Not an Oasis sale').onClick()
    l.port.next.squareIgnore = { paymentId: 'sqp-1', matchState: 'ignored', invoiceId: null, eventId: null, invoice: null }
    l.vals().live.sqItems[0].ignore()
    await l.settle()
    expect(l.port.calls.find((c) => c.op === 'squareIgnore')!.args).toEqual(['sqp-1', { reason: 'not_oasis_sale' }])
    expect(l.vals().toast).toBe('Set aside · $42.80')
  })

  it('a role without pay.collect sees the queue but cannot apply or set aside', async () => {
    const l = boot(session('acct', ['pay.collect']), unpaid())
    l.port.toMatch = [payment()]
    let v = await load(l)
    expect(v.live.sqHasBanner).toBe(true)
    v.live.sqReview()
    v = await load(l)
    expect(v.live.sqItems[0].targets[0].style.cursor).toBe('not-allowed')
    v.live.sqItems[0].targets[0].apply()
    v.live.sqItems[0].reasons[0].onClick()
    l.vals().live.sqItems[0].ignore()
    await l.settle()
    expect(l.port.calls.some((c) => c.op === 'squareApply' || c.op === 'squareIgnore')).toBe(false)
    expect(l.vals().toast).toBe('Your role can’t collect payments')
  })

  it('the refused card refunds and the refunds on their way are listed; Open selects the invoice', async () => {
    const d = unpaid()
    const other = sq(makeDetail({ label: 'INV-20641', client: 'Liam Chen' }))
    const l = boot('mgmt', d, other)
    l.port.toMatch = [payment()]
    l.port.recon = {
      square: {
        paymentsToMatch: [],
        failedRefunds: [
          { eventId: 'e', invoiceId: other.id, label: 'INV-20641', client: 'Liam Chen', amountCents: 2000, occurredAt: '', refundedCents: 0, uncoveredCents: 2000, errors: [] },
        ],
        refundsInFlight: 1,
      },
    }
    let v = await load(l)
    v.live.sqReview()
    v = await load(l)
    expect(v.live.sqHasFailed).toBe(true)
    expect(v.live.sqFailed[0].title).toBe('INV-20641 · Liam Chen · $20.00')
    expect(v.live.sqInFlight).toBe('1 card refund on the way to Square')
    v.live.sqFailed[0].open()
    v = await load(l)
    expect(v.live.sqOpen).toBe(false)
    expect(v.d.id).toBe('INV-20641')
  })
})

describe('ledger entries with Square (DV-803, DV-804)', () => {
  it('a waiting Square reader entry has no hand confirm; its button opens the queue on its amount', async () => {
    const entry = makeEvent({ type: 'pay', amountCents: 4280, method: 'Card', methodKind: 'card', awaitingProcessor: true, processorState: 'awaiting_processor' })
    const d = sq(makeDetail({ label: 'INV-20640', client: 'Maria Alvarez', items: [{ name: 'Signature Hand Wash', priceCents: 4000 }], events: [entry] }))
    const l = boot('mgmt', d)
    l.port.toMatch = [payment({ paymentId: 'other', amountCents: 999, totalCents: 999 }), payment()]
    let v = await load(l)
    const e = v.d.ledger[0]
    expect(e.meta).toMatch(/Awaiting Square$/)
    expect(e.awaiting).toBe(false)
    expect(e.sqMatch).toBe(true)
    e.sqMatchOpen()
    v = await load(l)
    expect(v.live.sqOpen).toBe(true)
    expect(v.live.sqSub).toBe('Pick the Square payment for the $42.80 reader entry on INV-20640')
    // the payment of the entry's amount comes first and applying it confirms the entry
    expect(v.live.sqItems[0].line).toBe('$42.80 · Visa ••4242')
    expect(v.live.sqItems[0].targets[0].sub).toBe('$0.00 due · confirms the Square reader entry')
  })

  it('a Square payment on the wrong invoice moves by invoice number (pay.void)', async () => {
    const pay = makeEvent({ type: 'pay', amountCents: 4280, method: 'Visa ••4242', methodKind: 'card', processor: 'square', processorState: 'confirmed', processorRef: 'sqp-9' })
    const d = sq(makeDetail({ label: 'INV-20640', client: 'Maria Alvarez', events: [pay] }))
    const target = sq(makeDetail({ label: 'INV-20641', client: 'Liam Chen' }))
    const l = boot('mgmt', d, target)
    l.port.invoicePage = async (q) => {
      l.port.calls.push({ op: 'invoicePage', args: [q] })
      return { items: l.port.rows.filter((r) => r.label === q.q), nextCursor: null }
    }
    let v = await load(l)
    let e = v.d.ledger[0]
    expect(e.sqCanMove).toBe(true)
    e.sqMoveToggle()
    l.vals().d.ledger[0].sqMoveInput({ target: { value: 'banana' } })
    l.vals().d.ledger[0].sqMoveSubmit()
    await l.settle()
    expect(l.vals().d.ledger[0].sqMoveError).toBe('Type the invoice number, like INV-20640.')
    l.vals().d.ledger[0].sqMoveInput({ target: { value: '20641' } })
    l.port.next.squareReassign = { paymentId: 'sqp-9', matchState: 'matched', invoiceId: target.id, eventId: 'x', invoice: target }
    l.vals().d.ledger[0].sqMoveSubmit()
    await l.settle()
    expect(l.port.calls.find((c) => c.op === 'squareReassign')!.args).toEqual(['sqp-9', target.id])
    v = await load(l)
    expect(v.toast).toBe('Moved to INV-20641 · $42.80')
    expect(v.d.id).toBe('INV-20641')
    e = v.d.ledger[0]
    expect(e?.sqMoveOpen ?? false).toBe(false)
  })

  it('without pay.void the move box never opens', async () => {
    const pay = makeEvent({ type: 'pay', amountCents: 4280, method: 'Visa ••4242', methodKind: 'card', processor: 'square', processorState: 'confirmed', processorRef: 'sqp-9' })
    const l = boot(session('acct', ['pay.void']), sq(makeDetail({ events: [pay] })))
    const v = await load(l)
    v.d.ledger[0].sqMoveToggle()
    const after = l.vals()
    expect(after.d.ledger[0].sqMoveOpen).toBe(false)
    expect(after.toast).toBe('Your role can’t mark payments unpaid')
  })
})
