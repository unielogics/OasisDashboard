// The refund sheet's inline check uses the invoice's refundCaps (the server's own caps after done and pending refunds), so
// its message and its disabled state match what POST /invoices/:id/refunds would answer in every case the money review
// found (2: card refund of cash money, 7: pending card refunds reserve the card cap, 14: store credit cashed out).
import { describe, expect, it } from 'vitest'
import type { LedgerEvent } from '@/data/ports/payments'
import { liveSheetCalc, liveSheetForm, refundCapError, type LivePerms } from '@/lib/payments/live'
import { makeDetail, makeEvent, refundCapsOf, resetIds } from './live-testkit'

const PERMS: LivePerms = {
  roleLabel: 'Management + Accounting',
  canCollect: true,
  canReceipt: true,
  refund: { has: true, maxCents: Infinity },
  adjust: { has: true, maxCents: Infinity },
  credit: { has: true, maxCents: Infinity },
}

const card = (amountCents: number) =>
  makeEvent({ type: 'pay', amountCents, method: 'Visa', methodKind: 'card', processorState: 'confirmed' })
const cash = (amountCents: number) =>
  makeEvent({ type: 'pay', amountCents, method: 'Cash', methodKind: 'cash' })
const credit = (amountCents: number) =>
  makeEvent({ type: 'credit_apply', amountCents, method: 'Store credit', methodKind: 'store_credit' })
const refund = (amountCents: number, dest: 'card' | 'cash' | 'credit', status: 'done' | 'pending') =>
  makeEvent({ type: 'refund', amountCents, dest, status })

interface Case {
  name: string
  priceCents: number
  events: () => LedgerEvent[]
  /** what the backend answers in GET /invoices/:id for the same ledger (test/payments/refund-caps.test.ts) */
  caps: { cardCents: number; otherCents: number; totalCents: number }
}

const CASES: Case[] = [
  {
    name: 'paid in full by card',
    priceCents: 10000,
    events: () => [card(10700)],
    caps: { cardCents: 10700, otherCents: 10700, totalCents: 10700 },
  },
  {
    name: 'paid in full in cash (finding 2)',
    priceCents: 10000,
    events: () => [cash(10700)],
    caps: { cardCents: 0, otherCents: 10700, totalCents: 10700 },
  },
  {
    name: 'cash 70.00 + card 37.00 (finding 2)',
    priceCents: 10000,
    events: () => [cash(7000), card(3700)],
    caps: { cardCents: 3700, otherCents: 10700, totalCents: 10700 },
  },
  {
    name: 'card 120.00 + store credit 59.76, a 100.00 card refund pending (finding 7)',
    priceCents: 16800,
    events: () => [card(12000), credit(5976), refund(10000, 'card', 'pending')],
    caps: { cardCents: 2000, otherCents: 2000, totalCents: 7976 },
  },
  {
    name: 'store credit only (finding 14)',
    priceCents: 4000,
    events: () => [credit(3000)],
    caps: { cardCents: 0, otherCents: 0, totalCents: 3000 },
  },
  {
    name: 'card, refunded in full to store credit',
    priceCents: 10000,
    events: () => [card(10700), refund(10700, 'credit', 'done')],
    caps: { cardCents: 10700, otherCents: 10700, totalCents: 0 },
  },
]

/** The server's answer (commands.ts refund), as its problem detail text. */
function serverAnswer(c: Case['caps'], dest: 'card' | 'cash' | 'credit', val: number): string | null {
  const usd = (n: number) => '$' + (n / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })
  if (dest === 'card' && val > c.cardCents)
    return `Only ${usd(c.cardCents)} was paid by card — refund the rest to store credit.`
  if (val > c.totalCents) return 'More than the refundable amount.'
  if (dest === 'cash' && val > c.otherCents)
    return `Only ${usd(c.otherCents)} was paid by card or cash — refund the rest to store credit.`
  return null
}

const amount = (cents: number) => (cents / 100).toFixed(2)

describe('refund sheet: the inline check is the server’s refund caps', () => {
  for (const c of CASES) {
    it(`${c.name}: the testkit's caps are the server's`, () => {
      resetIds()
      const events = c.events()
      const d = makeDetail({ items: [{ name: 'Express Hand Wash', priceCents: c.priceCents }], events })
      expect(refundCapsOf(events, d.calc.refundable)).toEqual(c.caps)
      expect(d.refundCaps).toEqual(c.caps)
    })

    for (const dest of ['card', 'cash', 'credit'] as const) {
      it(`${c.name}: a refund to ${dest} says and blocks what the server would answer`, () => {
        resetIds()
        const d = makeDetail({
          items: [{ name: 'Express Hand Wash', priceCents: c.priceCents }],
          events: c.events(),
        })
        const probes = [
          ...new Set([1, c.caps.cardCents, c.caps.otherCents, c.caps.totalCents].flatMap((v) => [v, v + 1])),
        ].filter((v) => v > 0)
        for (const val of probes) {
          const want = serverAnswer(c.caps, dest, val)
          expect(refundCapError(d.refundCaps, dest, val), `${val} to ${dest}`).toBe(want)
          const s = liveSheetCalc({
            kind: 'refund',
            f: liveSheetForm({ mode: 'custom', amount: amount(val), dest }),
            d,
            p: PERMS,
          })
          expect(s.blocked, `${val} to ${dest}`).toBe(want !== null)
          expect(s.request === null, `${val} to ${dest}`).toBe(want !== null)
          if (want) expect(s.permText).toBe(want)
          else expect(s.permText).toMatch(/^Within your no limit as Management \+ Accounting\./)
        }
      })
    }
  }

  it('a full refund to the card of a mixed invoice is blocked with the card part named', () => {
    resetIds()
    const d = makeDetail({
      items: [{ name: 'Express Hand Wash', priceCents: 10000 }],
      events: [cash(7000), card(3700)],
    })
    const s = liveSheetCalc({ kind: 'refund', f: liveSheetForm({ mode: 'full', dest: 'card' }), d, p: PERMS })
    expect(s.blocked).toBe(true)
    expect(s.permText).toBe('Only $37.00 was paid by card — refund the rest to store credit.')
    const toCash = liveSheetCalc({
      kind: 'refund',
      f: liveSheetForm({ mode: 'full', dest: 'cash' }),
      d,
      p: PERMS,
    })
    expect(toCash.blocked).toBe(false)
    expect(toCash.submitLabel).toBe('Refund $107.00')
  })

  it('a card refund within the caps keeps the Squarespace sentence (DV-216)', () => {
    resetIds()
    const d = makeDetail({ items: [{ name: 'Express Hand Wash', priceCents: 10000 }], events: [card(10700)] })
    const s = liveSheetCalc({
      kind: 'refund',
      f: liveSheetForm({ mode: 'custom', amount: '10', dest: 'card' }),
      d,
      p: PERMS,
    })
    expect(s.permText).toBe(
      'Within your no limit as Management + Accounting. Card refunds are completed in Squarespace; confirm it here once done.',
    )
  })
})
