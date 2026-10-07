// The live view builders that need no class: status text, range covering, ledger lines and toasts.
import { describe, expect, it } from 'vitest'
import { makeDetail, makeEvent, makeRow, resetIds } from '@/screens/payments/live-testkit'
import {
  collectToast,
  eventMeta,
  headerView,
  liveLedgerEntries,
  rangeCovering,
  refundToast,
  rowView,
  statusText,
  NO_PERMS,
} from './live'

describe('statusText', () => {
  it('an approval-pending refund wins, then awaiting card money, else the server label', () => {
    const base = { statusLabel: 'Paid', refundPending: false, awaiting: null } as const
    expect(statusText(base)).toBe('Paid')
    expect(statusText({ ...base, awaiting: 'payment' })).toBe('Payment pending')
    expect(statusText({ ...base, awaiting: 'refund' })).toBe('Refund pending')
    expect(statusText({ ...base, refundPending: true, awaiting: 'payment' })).toBe('Refund pending')
    expect(statusText({ ...base, statusLabel: 'Canceled · deposit kept' })).toBe('Canceled · deposit kept')
  })
  it('the pill is amber for pending texts and neutral for an unknown server label', () => {
    resetIds()
    const d = makeDetail({ label: 'INV-20700', canceled: true })
    const r = rowView(makeRow(d))
    expect(r.status).toBe('Canceled')
    expect(r.statusStyle.background).toBe('var(--panel3)')
    expect(rowView(makeRow(d, { awaiting: 'payment' })).statusStyle.background).toBe('var(--amberSoft)')
  })
})

describe('rangeCovering', () => {
  const today = '2026-06-13'
  it('keeps the current range when it covers the date', () => {
    expect(rangeCovering('30d', today, '2026-05-20')).toBe('30d')
    expect(rangeCovering('7d', today, '2026-06-10')).toBe('7d')
    expect(rangeCovering('today', today, '2026-06-13')).toBe('today')
  })
  it('widens to the narrowest range that covers it', () => {
    expect(rangeCovering('today', today, '2026-06-12')).toBe('7d')
    expect(rangeCovering('7d', today, '2026-06-05')).toBe('mtd')
    expect(rangeCovering('7d', today, '2026-05-31')).toBe('30d')
    expect(rangeCovering('mtd', today, '2026-05-20')).toBe('30d')
    // older than every range: the widest one
    expect(rangeCovering('7d', today, '2026-01-02')).toBe('30d')
  })
})

describe('ledger entries', () => {
  it('meta lines join stamp, actor, reason, note, expiry, approver and the Squarespace tag', () => {
    resetIds()
    const e = makeEvent({
      type: 'refund',
      amountCents: 1000,
      reason: 'Goodwill',
      note: 'n',
      approvedBy: 'Rafael M. · Management',
      awaitingProcessor: true,
    })
    expect(eventMeta(e)).toBe(
      'Today 10:00 AM · Rafael M. (Management) · Goodwill · n · Approved by Rafael M. · Management · Awaiting Squarespace',
    )
    const c = makeEvent({
      type: 'credit_issue',
      amountCents: 2500,
      expiryLabel: '90 days',
      reason: 'Goodwill',
    })
    expect(eventMeta(c)).toContain('Expires: 90 days')
  })
  it('titles and amounts follow the design; a void is its own entry', () => {
    resetIds()
    const d = makeDetail({
      events: [
        makeEvent({ type: 'pay', amountCents: 10700, method: 'Cash', methodKind: 'cash' }),
        makeEvent({ type: 'void', amountCents: 10700, method: 'Cash' }),
        makeEvent({ type: 'adjust', amountCents: -1500, reason: 'Loyalty' }),
        makeEvent({ type: 'credit_apply', amountCents: 2500, method: 'Store credit' }),
        makeEvent({ type: 'refund', amountCents: 2000, status: 'denied', dest: 'cash', method: 'Cash' }),
      ],
    })
    const rows = liveLedgerEntries(d, { ...NO_PERMS }).map((x) => [x.view.glyph, x.view.title, x.view.amt])
    expect(rows).toEqual([
      ['↩', 'Refund denied · cash', '−$20.00'],
      ['◆', 'Store credit applied', '$25.00'],
      ['±', 'Discount · Loyalty', '$15.00'],
      ['×', 'Payment voided · Cash', '−$107.00'],
      ['$', 'Payment · Cash', '$107.00'],
    ])
  })
  it('header uses the awaiting state from the ledger', () => {
    resetIds()
    const d = makeDetail({
      events: [
        makeEvent({
          type: 'pay',
          amountCents: 27820,
          method: 'Card',
          methodKind: 'card',
          awaitingProcessor: true,
        }),
      ],
    })
    expect(headerView(d).status).toBe('Payment pending')
  })
})

describe('toasts', () => {
  it('refund and collect', () => {
    resetIds()
    const d = makeDetail()
    const done = makeEvent({ type: 'refund', amountCents: 4280, dest: 'credit' })
    expect(refundToast({ event: done, invoice: d })).toBe('Refunded $42.80 to store credit')
    const link = { id: 'l', url: 'https://x', expectedCents: 1, purpose: 'balance' as const }
    expect(collectToast({ invoice: d, paymentLink: { ...link, sms: 'queued' } }, 'Ana Ruiz')).toBe(
      'Payment link sent to Ana Ruiz',
    )
    expect(collectToast({ invoice: d, paymentLink: { ...link, sms: 'no_contact' } }, 'Ana Ruiz')).toBe(
      'Payment link saved · Ana Ruiz has no phone on file',
    )
  })
})
