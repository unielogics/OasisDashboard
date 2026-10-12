// The Payments screen with Square (ADR 0171, DV-801..DV-806): tenders, line labels with sizes and coverage, ledger states,
// the queue's words and apply targets. The Squarespace screen must read exactly as before when the server says Squarespace
// or says nothing.
import { describe, expect, it } from 'vitest'
import type { InvoiceDetail, LedgerEvent, SquarePaymentToMatch } from '@/data/ports/payments'
import { makeDetail, makeEvent, resetIds } from '@/screens/payments/live-testkit'
import { coverageLine, coverageText, lineLabel, lineSub, pctText, sizeSourceText } from '../sizes'
import { NO_PERMS, collectToast, defaultTender, eventMeta, lineViews, liveLedgerEntries, liveSheetCalc, liveSheetForm } from './live'
import type { LivePerms } from './live'
import {
  ageText,
  applyTargets,
  canMoveSquarePay,
  collectTenders,
  failedRefundLine,
  inFlightText,
  paymentLine,
  paymentMeta,
  parseInvoiceNo,
  processorMeta,
  processorOf,
  sentLinkText,
  squareState,
  toMatchBanner,
} from './square'

const SQUARE = { processing: { processor: 'square' as const, squarePosAppSwitch: false } }
const SQSP = { processing: { processor: 'squarespace' as const, squarePosAppSwitch: false } }

const PERMS: LivePerms = {
  ...NO_PERMS,
  roleLabel: 'Management',
  canCollect: true,
  canReceipt: true,
  refund: { has: true, maxCents: 100_000 },
}

function square(d: InvoiceDetail): InvoiceDetail {
  return { ...d, ...SQUARE }
}

function toMatch(over: Partial<SquarePaymentToMatch> = {}): SquarePaymentToMatch {
  return {
    paymentId: 'sq-pay-1',
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
    receiptNumber: 'Ab12',
    product: 'SQUARE_POS',
    createdAt: '2026-06-13T14:00:00.000Z',
    ageMinutes: 35,
    candidates: [],
    ...over,
  }
}

describe('sizes and coverage words (ADR 0170)', () => {
  it('names the size and the member % off of a line; nothing for a line priced before sizes', () => {
    expect(pctText(1000)).toBe('10%')
    expect(pctText(1250)).toBe('12.5%')
    expect(lineSub('Large SUV', 1000)).toBe('Large SUV · 10% member price')
    expect(lineSub('Large SUV', 0)).toBe('Large SUV')
    expect(lineSub(null, null)).toBe('')
    expect(lineLabel('Signature Hand Wash', null, undefined)).toBe('Signature Hand Wash')
    expect(lineLabel('Wax', 'Truck', 1500)).toBe('Wax · Truck · 15% member price')
  })
  it('coverage reads "Covered $40 · $20 size difference due", whole dollars without cents', () => {
    expect(coverageText({ coveredCents: 4000, differenceCents: 2000 })).toBe('Covered $40 · $20 size difference due')
    expect(coverageText({ coveredCents: 4000, differenceCents: 0 })).toBe('Covered $40')
    expect(coverageText({ coveredCents: 4050, differenceCents: 1999 })).toBe('Covered $40.50 · $19.99 size difference due')
    expect(
      coverageLine({ serviceName: 'Signature Hand Wash', coveredCents: 4000, differenceCents: 2000, planClassLabel: 'Compact car' }),
    ).toBe('Signature Hand Wash · Covered $40 · $20 size difference due (Compact car plan)')
    expect(sizeSourceText('staff')).toBe('set by staff')
    expect(sizeSourceText(null)).toBe('')
  })
})

describe('the processor (DV-802)', () => {
  it('an older server, or one that says Squarespace, keeps the design tenders', () => {
    resetIds()
    const d = makeDetail()
    expect(processorOf(d)).toBe('squarespace')
    expect(processorOf({ ...d, ...SQSP })).toBe('squarespace')
    expect(collectTenders('squarespace')).toEqual(['Card on file', 'Cash', 'Payment link'])
    expect(defaultTender(d)).toBe('Card on file')
  })
  it('Square: Square reader / Cash / Payment link, no URL box, the reader tender is the card method', () => {
    resetIds()
    const d = square(makeDetail({ items: [{ name: 'Signature Hand Wash', priceCents: 4000 }] }))
    expect(collectTenders('square')).toEqual(['Square reader', 'Cash', 'Payment link'])
    expect(defaultTender(d)).toBe('Square reader')
    const reader = liveSheetCalc({ kind: 'collect', f: liveSheetForm({ method: 'Square reader' }), d, p: PERMS })
    expect(reader.needsUrl).toBe(false)
    expect(reader.request).toEqual({ kind: 'collect', input: { method: 'card' } })
    expect(reader.submitLabel).toBe('Charge $42.80 on the reader')
    expect(reader.permText).toMatch(/Awaiting Square/)
    const link = liveSheetCalc({ kind: 'collect', f: liveSheetForm({ method: 'Payment link' }, null), d, p: PERMS })
    expect(link.needsUrl).toBe(false)
    expect(link.blocked).toBe(false)
    expect(link.request).toEqual({ kind: 'collect', input: { method: 'payment_link' } })
    expect(link.submitLabel).toBe('Text link · $42.80')
    expect(link.permText).toBe('We text Liam a secure link to pay this balance. The payment is recorded as soon as they pay.')
  })
  it('Squarespace: the link still needs its URL (DV-215 unchanged)', () => {
    resetIds()
    const d = makeDetail({ items: [{ name: 'Signature Hand Wash', priceCents: 4000 }] })
    const link = liveSheetCalc({ kind: 'collect', f: liveSheetForm({ method: 'Payment link' }, null), d, p: PERMS })
    expect(link.needsUrl).toBe(true)
    expect(link.blocked).toBe(true)
  })
  it('the Square link left on screen says whether it was texted (F2)', () => {
    expect(sentLinkText('queued', 'Maria Alvarez', 4280)).toBe('Link texted. It is for exactly $42.80.')
    expect(sentLinkText('skipped_opt_out', 'Maria Alvarez', 4280)).toBe(
      'Not texted: Maria opted out of SMS. Copy the link and send it another way. It is for exactly $42.80.',
    )
    expect(sentLinkText('no_contact', 'Maria Alvarez', 4280)).toBe(
      'Not texted: Maria has no phone on file. Copy the link and send it another way. It is for exactly $42.80.',
    )
  })
  it('collect toasts: a texted personal link, a Square link, the reader entry', () => {
    resetIds()
    const inv = square(makeDetail())
    const link = (provider: string, sms: string) =>
      collectToast(
        { invoice: inv, paymentLink: { id: 'l1', url: null, expectedCents: 4280, purpose: 'balance', sms, provider } },
        'Maria Alvarez',
      )
    expect(link('personal', 'queued')).toBe('Pay link texted to Maria · $42.80')
    expect(link('square', 'skipped_opt_out')).toBe('Pay link ready · Maria opted out of SMS')
    const ev = makeEvent({ type: 'pay', amountCents: 4280, awaitingProcessor: true, processorState: 'awaiting_processor' })
    expect(collectToast({ event: ev, invoice: inv }, 'Maria Alvarez')).toBe('Awaiting Square · $42.80 on the reader')
    // Squarespace wording is unchanged
    expect(
      collectToast(
        { invoice: makeDetail(), paymentLink: { id: 'l', url: 'https://x', expectedCents: 1, purpose: 'balance', sms: 'queued' } },
        'Maria Alvarez',
      ),
    ).toBe('Payment link sent to Maria Alvarez')
  })
})

describe('invoice lines with sizes and coverage (DV-801)', () => {
  it('an item names its size and % off; a coverage adjustment reads the coverage', () => {
    resetIds()
    const adj = makeEvent({ type: 'adjust', amountCents: -4000, reason: 'Membership credit' })
    const d = makeDetail({ items: [{ name: 'Signature Hand Wash', priceCents: 6000 }], events: [adj] })
    d.items[0] = { ...d.items[0]!, listCents: 6000, discountBp: 0, classLabel: 'Large SUV', memberDiscountCents: 0 }
    d.adjustments[0] = {
      ...d.adjustments[0]!,
      coverage: { serviceName: 'Signature Hand Wash', coveredCents: 4000, lineCents: 6000, differenceCents: 2000, planClassLabel: 'Compact car' },
    }
    const lines = lineViews(d)
    expect(lines[0]!.label).toBe('Signature Hand Wash · Large SUV')
    expect(lines[1]!.label).toBe('Covered $40 · $20 size difference due')
    expect(lines[1]!.value).toBe('−$40.00')
  })
  it('a line priced before sizes and a plain discount read as before', () => {
    resetIds()
    const adj = makeEvent({ type: 'adjust', amountCents: -500, reason: 'Loyalty' })
    const d = makeDetail({ items: [{ name: 'Executive Detail', priceCents: 26000 }], events: [adj] })
    const lines = lineViews(d)
    expect(lines[0]!.label).toBe('Executive Detail')
    expect(lines[1]!.label).toBe('Discount · Loyalty')
  })
})

describe('ledger entries with Square (DV-803, DV-804)', () => {
  const pay = (over: Partial<LedgerEvent> = {}) => makeEvent({ type: 'pay', amountCents: 4280, method: 'Card', methodKind: 'card', ...over })
  it('a staff Square reader entry waits on Square and offers the queue, never a hand confirm', () => {
    resetIds()
    const e = pay({ awaitingProcessor: true, processorState: 'awaiting_processor' })
    const d = square(makeDetail({ events: [e] }))
    expect(squareState(e, d)).toBe('awaiting')
    expect(eventMeta(e, d)).toBe('Today 10:00 AM · Rafael M. (Management) · Awaiting Square')
    const [en] = liveLedgerEntries(d, PERMS)
    expect(en!.view.awaiting).toBe(false)
    expect(en!.view.sqMatch).toBe(true)
    expect(en!.canConfirm).toBe(false)
  })
  it('a Squarespace entry keeps "Awaiting Squarespace" and its Confirm button', () => {
    resetIds()
    const e = pay({ awaitingProcessor: true, processorState: 'awaiting_processor' })
    const d = makeDetail({ events: [e] })
    expect(eventMeta(e, d)).toBe('Today 10:00 AM · Rafael M. (Management) · Awaiting Squarespace')
    expect(eventMeta(e)).toBe('Today 10:00 AM · Rafael M. (Management) · Awaiting Squarespace')
    const [en] = liveLedgerEntries(d, PERMS)
    expect(en!.view.awaiting).toBe(true)
    expect(en!.view.sqMatch).toBe(false)
    expect(en!.canConfirm).toBe(true)
  })
  it('refund states: sent, refunded, failed (failed is dimmed and no longer counts)', () => {
    resetIds()
    const p = pay({ processor: 'square', processorState: 'confirmed', processorRef: 'sqp1', method: 'Visa ••4242' })
    const sent = makeEvent({ type: 'refund', amountCents: 1000, dest: 'card', processor: 'square', processorState: 'awaiting_processor', awaitingProcessor: true })
    const done = makeEvent({ type: 'refund', amountCents: 1000, dest: 'card', processor: 'square', processorState: 'confirmed' })
    const failed = makeEvent({ type: 'refund', amountCents: 1000, dest: 'card', processor: 'square', processorState: 'failed' })
    const d = square(makeDetail({ events: [p, sent, done, failed] }))
    expect(processorMeta(p, d)).toBe('Square')
    expect(processorMeta(sent, d)).toBe('Refund sent to Square')
    expect(processorMeta(done, d)).toBe('Refunded by Square')
    expect(processorMeta(failed, d)).toBe('Refund failed · not refunded')
    // the twin leaves the failed refund out: two counted refunds of $10
    expect(d.calc.refunded).toBe(2000)
    const entries = liveLedgerEntries(d, PERMS)
    const f = entries.find((x) => x.event.id === failed.id)!
    expect(f.view.amtColor).toBe('var(--ink3)')
    const s = entries.find((x) => x.event.id === sent.id)!
    expect(s.view.awaiting).toBe(false)
  })
  it('a confirmed Square payment can be moved; a tip, a void or a Squarespace payment cannot', () => {
    resetIds()
    expect(canMoveSquarePay(pay({ processor: 'square', processorState: 'confirmed', processorRef: 'p1' }))).toBe(true)
    expect(canMoveSquarePay(pay({ processor: 'square', processorState: 'confirmed', processorRef: 'p1', reason: 'Tip' }))).toBe(false)
    expect(canMoveSquarePay(pay({ processor: 'square', processorState: 'confirmed', processorRef: 'p1', voided: true }))).toBe(false)
    expect(canMoveSquarePay(pay({ processor: 'squarespace', processorState: 'confirmed', processorRef: 'p1' }))).toBe(false)
    expect(parseInvoiceNo('INV-20640')).toBe(20640)
    expect(parseInvoiceNo(' inv 20640 ')).toBe(20640)
    expect(parseInvoiceNo('20640')).toBe(20640)
    expect(parseInvoiceNo('Maria')).toBeNull()
  })
})

describe('the queue (DV-805)', () => {
  it('banner, money and meta lines', () => {
    expect(toMatchBanner([])).toBe('')
    expect(toMatchBanner(undefined)).toBe('')
    expect(toMatchBanner([toMatch(), toMatch({ paymentId: 'b', totalCents: 4000, ageMinutes: 5 })])).toBe(
      '2 Square payments to match · $82.80 · oldest 35 min ago',
    )
    expect(paymentLine(toMatch({ tipCents: 600, totalCents: 4880 }))).toBe('$42.80 + $6.00 tip · Visa ••4242')
    expect(paymentMeta(toMatch({ note: 'Maria', matchState: 'pending' }))).toBe(
      '35 min ago · Note: Maria · Receipt #Ab12 · still being matched',
    )
    expect(ageText(0)).toBe('just now')
    expect(ageText(125)).toBe('2 h 5 min ago')
    expect(ageText(60)).toBe('1 h ago')
    expect(ageText(60 * 50)).toBe('2 days ago')
  })
  it('apply targets: the candidates first, then the invoice open on screen (confirming its reader entry of that amount)', () => {
    resetIds()
    const p = toMatch({
      candidates: [
        { invoiceId: 'i1', invoiceNo: 20640, client: 'Maria Alvarez', balanceCents: 4280, awaitingEventId: 'e1', score: 0.9, why: ['same amount'] },
      ],
    })
    const entry = makeEvent({ type: 'pay', amountCents: 4280, awaitingProcessor: true, processorState: 'awaiting_processor' })
    const open = square(makeDetail({ label: 'INV-20641', client: 'Liam Chen', events: [entry] }))
    const t = applyTargets(p, open)
    expect(t).toHaveLength(2)
    expect(t[0]).toEqual({
      invoiceId: 'i1',
      confirmEventId: 'e1',
      label: 'INV-20640 · Maria Alvarez',
      sub: '$42.80 due · confirms the Square reader entry · same amount',
    })
    expect(t[1]!.invoiceId).toBe(open.id)
    expect(t[1]!.confirmEventId).toBe(entry.id)
    expect(t[1]!.label).toBe('INV-20641 · Liam Chen (open on screen)')
    // the open invoice already a candidate: listed once
    expect(applyTargets({ ...p, candidates: [{ ...p.candidates[0]!, invoiceId: open.id }] }, open)).toHaveLength(1)
  })
  it('refused refunds and refunds on their way', () => {
    expect(
      failedRefundLine({
        eventId: 'e',
        invoiceId: 'i',
        label: 'INV-20640',
        client: 'Maria Alvarez',
        amountCents: 4000,
        occurredAt: '',
        refundedCents: 1000,
        uncoveredCents: 3000,
        errors: ['CARD_EXPIRED'],
      }),
    ).toEqual({
      title: 'INV-20640 · Maria Alvarez · $40.00',
      sub: '$10.00 went back · $30.00 did not go back to the card. Give it back another way. (CARD_EXPIRED)',
    })
    expect(inFlightText({ square: { paymentsToMatch: [], failedRefunds: [], refundsInFlight: 2 } })).toBe(
      '2 card refunds on the way to Square',
    )
    expect(inFlightText({})).toBe('')
  })
})
