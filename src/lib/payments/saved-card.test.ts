// The Payments screen's saved card and receipts (ADR 0171 wave Q3; DV-901, DV-902): the Collect tenders follow what the
// server says may be offered (`processing.squareTenders`), the saved card's step asks for the client's OK and charges
// exactly the balance, and a Square payment's ledger entry names its receipt and links only to Square's own receipt page.
import { beforeEach, describe, expect, it } from 'vitest'
import type { InvoiceDetail, InvoiceProcessing } from '@/data/ports/payments'
import { makeDetail, makeEvent, resetIds } from '@/screens/payments/live-testkit'
import { NO_PERMS, eventMeta, liveLedgerEntries, liveSheetCalc, liveSheetForm } from './live'
import type { LivePerms } from './live'
import {
  WAITING_FOR_SQUARE_TEXT,
  cardChargeToast,
  collectTenderList,
  declinedText,
  receiptMeta,
  safeReceiptUrl,
  savedCardOf,
  savedCardOkText,
  savedCardPermText,
  savedCardTender,
} from './square'

const PERMS: LivePerms = { ...NO_PERMS, roleLabel: 'Management', canCollect: true, canReceipt: true }
const CARD = { cardId: 'card-1', label: 'Visa ••4242', brand: 'VISA', last4: '4242' }

const proc = (over: Partial<NonNullable<InvoiceProcessing['squareTenders']>> | null): InvoiceProcessing => ({
  processor: 'square',
  squarePosAppSwitch: false,
  ...(over === null ? {} : { squareTenders: { reader: true, link: true, savedCard: null, ...over } }),
})

const unpaid = (processing?: InvoiceProcessing): InvoiceDetail => ({
  ...makeDetail({
    label: 'INV-20640',
    client: 'Maria Alvarez',
    items: [{ name: 'Signature Hand Wash', priceCents: 4000 }],
  }),
  ...(processing ? { processing } : {}),
})

beforeEach(() => resetIds())

describe('the Collect tenders the server allows (DV-802, DV-901)', () => {
  it('Squarespace, or an older server: the design’s three', () => {
    expect(collectTenderList(undefined)).toEqual(['Card on file', 'Cash', 'Payment link'])
    expect(collectTenderList({ processor: 'squarespace', squarePosAppSwitch: false })).toEqual([
      'Card on file',
      'Cash',
      'Payment link',
    ])
  })
  it('Square before wave Q3 (no tender block): reader, cash, link', () => {
    expect(collectTenderList(proc(null))).toEqual(['Square reader', 'Cash', 'Payment link'])
  })
  it('Square: the saved card only when the server names one; the link only while Square writes are on', () => {
    expect(collectTenderList(proc({}))).toEqual(['Square reader', 'Cash', 'Payment link'])
    expect(collectTenderList(proc({ savedCard: CARD }))).toEqual([
      'Square reader',
      'Saved card ••4242',
      'Cash',
      'Payment link',
    ])
    // observe-only (writes off): no link, no saved card
    expect(collectTenderList(proc({ link: false }))).toEqual(['Square reader', 'Cash'])
  })
  it('the tender names the card by its last 4, else by Square’s label', () => {
    expect(savedCardTender(CARD)).toBe('Saved card ••4242')
    expect(savedCardTender({ ...CARD, last4: null, label: 'Card' })).toBe('Saved card · Card')
  })
  it('the saved card is read only from a Square invoice', () => {
    expect(savedCardOf(unpaid(proc({ savedCard: CARD })))).toEqual(CARD)
    expect(savedCardOf(unpaid(proc({})))).toBeNull()
    expect(savedCardOf(unpaid({ processor: 'squarespace', squarePosAppSwitch: false }))).toBeNull()
    expect(savedCardOf(undefined)).toBeNull()
  })
})

describe('the saved card’s step (DV-901)', () => {
  const d = unpaid(proc({ savedCard: CARD }))
  const calc = (cardOk: boolean, method = 'Saved card ••4242') =>
    liveSheetCalc({ kind: 'collect', f: liveSheetForm({ method, cardOk }), d, p: PERMS })

  it('nothing is sent until the client’s OK is ticked; the box names the amount and the card', () => {
    const c = calc(false)
    expect(c.blocked).toBe(true)
    expect(c.request).toBeNull()
    expect(c.savedCard).toEqual({
      label: 'Visa ••4242',
      okText: 'Maria said OK to charge $42.80 to Visa ••4242',
    })
    expect(c.permText).toBe(
      'Ask Maria first. The card is charged only after they say yes and you confirm here.',
    )
    expect(c.permOk).toBe(false)
    expect(c.submitLabel).toBe('Charge $42.80 to Visa ••4242')
    expect(c.summary).toEqual([
      { label: 'Balance due', value: '$42.80', color: 'var(--red)' },
      { label: 'Card', value: 'Visa ••4242', color: 'var(--ink)' },
    ])
  })
  it('with the OK: exactly the balance on the card the server named', () => {
    const c = calc(true)
    expect(c.blocked).toBe(false)
    expect(c.request).toEqual({
      kind: 'card_charge',
      input: { cardId: 'card-1', amountCents: 4280 },
      card: 'Visa ••4242',
    })
    expect(c.permText).toBe(savedCardPermText('Maria', true))
  })
  it('a paid invoice charges nothing', () => {
    const paid = {
      ...makeDetail({
        label: 'INV-20640',
        client: 'Maria Alvarez',
        items: [{ name: 'Signature Hand Wash', priceCents: 4000 }],
        events: [makeEvent({ type: 'pay', amountCents: 4280 })],
      }),
      processing: proc({ savedCard: CARD }),
    }
    const c = liveSheetCalc({
      kind: 'collect',
      f: liveSheetForm({ method: 'Saved card ••4242', cardOk: true }),
      d: paid,
      p: PERMS,
    })
    expect(c.blocked).toBe(true)
    expect(c.request).toBeNull()
  })
  it('another tender is the Square screen as before (no OK box)', () => {
    const c = calc(true, 'Square reader')
    expect(c.savedCard).toBeNull()
    expect(c.request).toEqual({ kind: 'collect', input: { method: 'card' } })
  })
  it('a server that names no card never offers the step, even with a stale tender label', () => {
    const c = liveSheetCalc({
      kind: 'collect',
      f: liveSheetForm({ method: 'Saved card ••4242', cardOk: true }),
      d: unpaid(proc({})),
      p: PERMS,
    })
    expect(c.savedCard).toBeNull()
    expect(c.request?.kind).toBe('collect')
  })
  it('the words of the answers', () => {
    expect(savedCardOkText('Maria', 4280, 'Visa ••4242')).toBe(
      'Maria said OK to charge $42.80 to Visa ••4242',
    )
    expect(declinedText('Maria', 'The card was declined.')).toBe(
      'Card declined: The card was declined. Ask Maria for another way to pay.',
    )
    expect(declinedText('Maria', null)).toBe(
      'Card declined: the bank said no. Ask Maria for another way to pay.',
    )
    expect(WAITING_FOR_SQUARE_TEXT).toMatch(/^Waiting for Square: .* never charged twice\.$/)
    expect(
      cardChargeToast({
        state: 'charged',
        amountCents: 4280,
        card: { id: 'c', label: 'Visa ••4242', brand: null, last4: null },
      }),
    ).toBe('Charged $42.80 to Visa ••4242')
    expect(cardChargeToast({ state: 'unknown', amountCents: 4280, card: null })).toBe(
      'Waiting for Square · $42.80 on the saved card',
    )
  })
})

describe('Square receipts on the ledger (DV-902)', () => {
  it('only https pages on Square’s receipt hosts are links', () => {
    expect(safeReceiptUrl('https://squareup.com/receipt/preview/abc')).toBe(
      'https://squareup.com/receipt/preview/abc',
    )
    expect(safeReceiptUrl('https://squareupsandbox.com/receipt/preview/abc')).toBe(
      'https://squareupsandbox.com/receipt/preview/abc',
    )
    expect(safeReceiptUrl('https://app.squareup.com/r/x')).toBe('https://app.squareup.com/r/x')
    for (const bad of [
      'http://squareup.com/r',
      'https://squareup.com.evil.test/r',
      'https://evilsquareup.com/r',
      'https://user:pw@squareup.com/r',
      'https://squareup.com:8443/r',
      'javascript:alert(1)',
      'not a url',
      '',
      null,
      undefined,
    ])
      expect(safeReceiptUrl(bad as string | null | undefined), String(bad)).toBeNull()
  })
  it('a Square payment’s meta ends with its receipt number; the entry links to the page', () => {
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
    const d = { ...makeDetail({ events: [pay] }), processing: proc({}) }
    expect(receiptMeta(pay)).toBe('Receipt #Xy7Q')
    expect(eventMeta(pay, d)).toBe('Today 10:00 AM · Rafael M. (Management) · Square · Receipt #Xy7Q')
    const [e] = liveLedgerEntries(d, PERMS)
    expect(e!.view).toMatchObject({
      sqHasReceipt: true,
      sqReceiptUrl: 'https://squareup.com/receipt/preview/sqp-1',
      sqReceiptLabel: 'Square receipt #Xy7Q',
    })
  })
  it('no receipt, a forged URL, a voided payment or a refund: no link', () => {
    const d = { ...makeDetail({}), processing: proc({}) }
    const cases = [
      makeEvent({ type: 'pay', amountCents: 100 }),
      makeEvent({ type: 'pay', amountCents: 100, receiptNumber: 'A1', receiptUrl: 'https://evil.test/r' }),
      makeEvent({ type: 'pay', amountCents: 100, voided: true, receiptUrl: 'https://squareup.com/r' }),
      makeEvent({
        type: 'refund',
        amountCents: 100,
        dest: 'card',
        receiptNumber: 'A2',
        receiptUrl: 'https://squareup.com/r',
      }),
    ]
    const entries = liveLedgerEntries({ ...d, ledger: cases }, PERMS)
    expect(entries.map((e) => e.view.sqHasReceipt)).toEqual([false, false, false, false])
    expect(receiptMeta(cases[3]!)).toBe('')
    expect(entries[1]!.view.sqReceiptLabel).toBe('Square receipt #A1')
  })
})
