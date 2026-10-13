// Cards on file, fees and Square billing on the appointment file (ADR 0171 wave Q3; DV-903, DV-904, DV-905, DV-907), pure:
// the words of the client's cards and consents, the fee rows in every state, the deposit line from the server's state, the
// membership's billing block and which actions fit, and the "Change tier or size" chooser.
import { describe, expect, it } from 'vitest'
import type {
  AppointmentFile,
  CustomerCards,
  FeeCharge,
  MembershipView,
  TierOption,
} from '@/data/ports/operations'
import {
  billingBlock,
  billingStatus,
  billingToast,
  canCloseVisit,
  cardLinkToast,
  cardRows,
  cardsShown,
  changeChoice,
  chargeFeeText,
  closedText,
  dayText,
  feeChargeToast,
  feeRows,
  isClosedVisit,
  monthly,
  purposesText,
  removeCardText,
} from './billing'
import { depositLine, hasServerDeposit } from './sizes'
import type { DepositView } from './sizes'

const TZ = 'America/New_York'
const TODAY = '2026-10-13'

type Card = CustomerCards['cards'][number]
const card = (over: Partial<Card> = {}): Card => ({
  id: 'card-1',
  brand: 'VISA',
  last4: '4242',
  label: 'Visa ••4242',
  expMonth: 12,
  expYear: 2028,
  state: 'active',
  createdVia: 'card_link',
  createdAt: '2026-10-12T15:00:00.000Z',
  disabledAt: null,
  disabledReason: null,
  purposes: ['no_show_fee', 'balance'],
  consents: [
    {
      id: 'k1',
      version: 'v1',
      purposes: ['no_show_fee', 'balance'],
      acceptedAt: '2026-10-12T15:00:00.000Z',
      revokedAt: null,
      revokeReason: null,
      via: 'link',
    },
  ],
  ...over,
})

describe('cards on file (DV-903)', () => {
  it('a saved card: label, expiry, state, and the consent in force with its version, date and purposes', () => {
    expect(cardRows({ cards: [card()], charge: true }, TZ, TODAY)).toEqual([
      {
        id: 'card-1',
        label: 'Visa ••4242',
        sub: 'Expires 12/28 · On file',
        consent: 'Consent v1 · Oct 12 · no-show fee and balances · on the client’s link',
        active: true,
        canRemove: true,
      },
    ])
  })
  it('a removed card says when, its withdrawn consent says so, and it can’t be removed again', () => {
    const [r] = cardRows(
      {
        cards: [
          card({
            state: 'disabled',
            disabledAt: '2026-10-13T14:00:00.000Z',
            purposes: [],
            consents: [
              {
                ...card().consents[0]!,
                revokedAt: '2026-10-13T14:00:00.000Z',
                revokeReason: 'staff',
                via: 'staff',
              },
            ],
          }),
        ],
        charge: true,
      },
      TZ,
      TODAY,
    )
    expect(r).toMatchObject({
      sub: 'Expires 12/28 · Removed Oct 13',
      consent: 'Consent v1 · Oct 12 · no-show fee and balances · recorded by staff · withdrawn Oct 13',
      canRemove: false,
    })
  })
  it('the purposes in plain words, in the server’s order', () => {
    expect(purposesText(['membership_billing', 'no_show_fee', 'late_cancel_fee', 'balance'])).toBe(
      'membership, no-show fee, late-cancel fee and balances',
    )
    expect(purposesText(['balance'])).toBe('balances')
    expect(purposesText([])).toBe('')
  })
  it('the block shows with a card, or when saved cards are on; not with today’s defaults', () => {
    expect(cardsShown(undefined)).toBe(false)
    expect(cardsShown({ cards: [], charge: false })).toBe(false)
    expect(cardsShown({ cards: [], charge: true })).toBe(true)
    expect(cardsShown({ cards: [card()], charge: false })).toBe(true)
  })
  it('the words of Remove and of Text card link', () => {
    expect(removeCardText('Maria', 'Visa ••4242')).toBe(
      'Remove Visa ••4242? Square disables it and Maria’s permission to charge it ends. It can’t be undone.',
    )
    expect(cardLinkToast('Maria', { sent: true, reason: null })).toEqual({
      title: 'Card link texted',
      desc: 'Maria can save a card on a secure page for 24 hours',
    })
    expect(cardLinkToast('Maria', { sent: false, reason: 'opted_out' }).desc).toBe('Maria opted out of SMS')
    expect(cardLinkToast('Maria', { sent: false, reason: 'no_phone' }).desc).toBe(
      'Maria has no phone on file',
    )
  })
})

const charge = (over: Partial<FeeCharge> = {}): FeeCharge => ({
  id: 'ch-1',
  purpose: 'no_show_fee',
  state: 'proposed',
  amountCents: 1500,
  reason: 'No-show fee',
  card: { id: 'card-1', label: 'Visa ••4242', brand: 'VISA', last4: '4242' },
  invoiceId: 'inv-1',
  appointmentId: 'a-1',
  squarePaymentId: null,
  error: null,
  declineCode: null,
  attempts: 0,
  proposedBy: 'system',
  decidedBy: null,
  decidedAt: null,
  chargedAt: null,
  waiveReason: null,
  createdAt: '2026-10-13T14:00:00.000Z',
  ...over,
})

describe('the visit and its fee (DV-904)', () => {
  it('cancel and no-show only for a booked or confirmed visit; a closed visit says what it is', () => {
    expect(canCloseVisit({ status: 'booked' })).toBe(true)
    expect(canCloseVisit({ status: 'confirmed' })).toBe(true)
    for (const s of ['arrived', 'cleaning', 'completed', 'canceled', 'no_show'] as const)
      expect(canCloseVisit({ status: s })).toBe(false)
    expect(isClosedVisit({ status: 'no_show' })).toBe(true)
    expect(closedText({ status: 'no_show' })).toBe('Marked as a no-show')
    expect(closedText({ status: 'canceled' })).toBe('Canceled')
  })
  it('every state of a fee in plain words; only proposed and declined ones can be decided', () => {
    const rows = feeRows(
      [
        charge(),
        charge({ id: 'ch-2', state: 'declined', error: 'Insufficient funds.', purpose: 'late_cancel_fee' }),
        charge({ id: 'ch-3', state: 'unknown' }),
        charge({
          id: 'ch-4',
          state: 'charged',
          chargedAt: '2026-10-13T15:00:00.000Z',
          decidedBy: 'Rafael M.',
        }),
        charge({ id: 'ch-5', state: 'waived', decidedBy: 'Rafael M.', waiveReason: 'First time' }),
        charge({ id: 'ch-6', purpose: 'balance' }),
      ],
      TZ,
      TODAY,
    )
    expect(rows.map((r) => [r.title, r.line, r.canDecide, r.tone])).toEqual([
      [
        'No-show fee · $15 on Visa ••4242',
        'Proposed by the cancellation rules. Charge it or waive it.',
        true,
        'amber',
      ],
      [
        'Late-cancel fee · $15 on Visa ••4242',
        'Declined: Insufficient funds. Charge it again or waive it.',
        true,
        'red',
      ],
      [
        'No-show fee · $15 on Visa ••4242',
        'Waiting for Square: it is recorded as soon as Square answers, never twice.',
        false,
        'amber',
      ],
      ['No-show fee · $15 on Visa ••4242', 'Charged Oct 13 by Rafael M.', false, 'green'],
      ['No-show fee · $15 on Visa ••4242', 'Waived by Rafael M.: First time', false, 'ink'],
    ])
    expect(rows[0]!.chargeLabel).toBe('Charge $15')
    expect(chargeFeeText(rows[0]!)).toBe('Charge the No-show fee of $15 on Visa ••4242 now?')
  })
  it('the toast after a charge: charged, or waiting for Square', () => {
    expect(feeChargeToast(charge({ state: 'charged' }))).toEqual({
      title: 'No-show fee charged',
      desc: '$15 on Visa ••4242',
    })
    expect(feeChargeToast(charge({ state: 'unknown' })).title).toBe('Waiting for Square')
  })
})

type Inv = NonNullable<AppointmentFile['invoice']>
const inv = (over: Partial<Inv> & { deposit?: unknown }): Inv =>
  ({
    invoiceId: 'inv-1',
    invoiceNo: 20640,
    subtotalCents: 4000,
    taxCents: 280,
    tipCents: 0,
    totalCents: 4280,
    paidCents: 2500,
    balanceCents: 1780,
    depositCents: 2500,
    status: 'partially_paid',
    refundPending: false,
    awaitingCents: 0,
    items: [],
    payMethodLabel: null,
    ...over,
  }) as Inv
const dep = (over: Record<string, unknown>): DepositView =>
  ({
    state: 'paid',
    requestedCents: 2500,
    paidCents: 2500,
    refundedCents: 0,
    pendingRefundCents: 0,
    keptCents: 0,
    refundFailed: false,
    refundSending: false,
    link: null,
    ...over,
  }) as DepositView

describe('the deposit line from the server (DV-905)', () => {
  it('an older server sends no deposit field; a newer one may send null', () => {
    expect(hasServerDeposit(inv({}))).toBe(false)
    expect(hasServerDeposit(inv({ deposit: null }))).toBe(true)
    expect(depositLine(inv({ deposit: null }))).toEqual({ row: null, paidLabel: 'Deposit paid' })
  })
  it('an open visit: asked for, texted, lapsed, paid (the design’s row), a refund waiting, refunded', () => {
    expect(depositLine(inv({ deposit: dep({ state: 'requested', paidCents: 0 }) })).row).toEqual({
      label: 'Deposit requested · not paid yet',
      value: '$25',
    })
    expect(depositLine(inv({ deposit: dep({ state: 'link_sent', paidCents: 0 }) })).row?.label).toBe(
      'Deposit link texted · not paid yet',
    )
    expect(depositLine(inv({ deposit: dep({ state: 'link_expired', paidCents: 0 }) })).row?.label).toBe(
      'Deposit link expired · not paid',
    )
    expect(depositLine(inv({ deposit: dep({}) }))).toEqual({ row: null, paidLabel: 'Deposit paid' })
    expect(depositLine(inv({ deposit: dep({ refundedCents: 500 }) })).paidLabel).toBe(
      'Deposit paid · $5 refunded',
    )
    expect(
      depositLine(inv({ deposit: dep({ state: 'refund_pending', pendingRefundCents: 2500 }) })).row,
    ).toEqual({
      label: 'Deposit refund waiting for approval',
      value: '$25',
    })
    expect(
      depositLine(inv({ deposit: dep({ state: 'refunded', refundedCents: 2500, refundSending: true }) })).row,
    ).toEqual({
      label: 'Deposit refund on its way to the card',
      value: '$25',
    })
  })
  it('a canceled visit: kept (after a partial refund), a refund failed, a refund waiting, refunded', () => {
    const c = (d: Record<string, unknown>) =>
      depositLine(inv({ status: 'canceled_kept', deposit: dep(d) })).row
    expect(c({ state: 'kept', keptCents: 2500 })).toEqual({ label: 'Deposit kept (canceled)', value: '$25' })
    expect(c({ state: 'kept', keptCents: 1250, refundedCents: 1250 })).toEqual({
      label: 'Deposit kept (canceled) · $12.50 refunded',
      value: '$12.50',
    })
    expect(c({ state: 'kept', keptCents: 2500, refundFailed: true })).toEqual({
      label: 'Deposit refund failed · not refunded',
      value: '$25',
    })
    expect(c({ state: 'refund_pending', pendingRefundCents: 2500 })?.label).toBe(
      'Deposit refund waiting for approval (canceled)',
    )
    expect(c({ state: 'refunded', refundedCents: 2500 })).toEqual({ label: 'Deposit refunded', value: '$25' })
  })
})

type Billing = NonNullable<NonNullable<MembershipView['membership']>['billing']>
const billing = (over: Partial<Billing> = {}): Billing => ({
  status: 'ok',
  squareStatus: 'ACTIVE',
  failedAt: null,
  notifiedAt: null,
  pastDueOn: null,
  cancelOn: null,
  monthlyCents: 12900,
  planClassLabel: 'Compact car',
  nextChargeOn: '2026-11-13',
  card: { brand: 'VISA', last4: '5858', label: 'Visa ••5858', expMonth: 12, expYear: 2028, state: 'active' },
  cancelAt: null,
  pauseAt: null,
  change: null,
  lastInvoice: null,
  lastPaid: {
    amountCents: 12900,
    paidAt: '2026-10-13T14:00:00.000Z',
    dueDate: '2026-10-13',
    refundedCents: 0,
  },
  lastFailed: null,
  enrollment: null,
  ...over,
})
const member = (b: Billing | null, status = 'active'): MembershipView =>
  ({
    customerId: 'c-1',
    membership: {
      id: 'm-1',
      customerId: 'c-1',
      status,
      source: 'square',
      plan: {
        key: 'gold',
        name: 'Gold',
        label: 'Gold',
        color: '#8A6D3B',
        bgColor: '#F2E9D6',
        tint: '#8A6D3B',
        perks: [],
      },
      planClass: 'compact_car',
      planClassLabel: 'Compact car',
      billing: b,
    },
    sharedFrom: null,
    upgrade: null,
    history: { visitCount: 0, lifetimeSpendCents: 0, avgFreqDays: null, favPackage: null },
  }) as unknown as MembershipView
const ui = { tz: TZ, today: TODAY }

describe('the billing block (DV-907)', () => {
  it('not billed by Square (or no membership): nothing', () => {
    expect(billingBlock(member(null), ui).show).toBe(false)
    expect(billingBlock(undefined, ui).show).toBe(false)
  })
  it('an active member: status, plan, next charge, card, last payment; Pause, Cancel at period end, Change, card link, refund', () => {
    const b = billingBlock(member(billing()), ui)
    expect(b.status).toEqual({ label: 'Status', value: 'Active · billed by Square', tone: 'green' })
    expect(b.lines.map((l) => [l.label, l.value])).toEqual([
      ['Plan', 'Gold · Compact car · $129/month'],
      ['Next charge', 'Nov 13 · $129'],
      ['Card', 'Visa ••5858 · expires 12/28'],
      ['Last payment', '$129 on Oct 13'],
    ])
    expect(b.notes).toEqual([])
    expect(b.buttons.map((x) => x.label)).toEqual([
      'Pause',
      'Cancel at period end',
      'Change tier or size',
      'Text card link',
      'Refund last payment',
    ])
    expect(b.buttons.find((x) => x.key === 'refund-last')!.confirm).toBe(
      'Refund $129 of Oct 13 to the card through Square? The membership itself does not change.',
    )
  })
  it('scheduled cancel, pause and change: said in words, and their undo is offered', () => {
    const b = billingBlock(
      member(
        billing({
          nextChargeOn: null,
          cancelAt: '2026-11-13',
          pauseAt: null,
          change: {
            kind: 'change',
            planKey: 'vip',
            planName: 'VIP',
            planClass: 'large_suv',
            planClassLabel: 'Large SUV',
            monthlyCents: 21900,
            effectiveDate: '2026-11-13',
            swapAfter: null,
          },
        }),
      ),
      ui,
    )
    expect(b.lines[1]).toMatchObject({ label: 'Next charge', value: 'None scheduled' })
    expect(b.notes).toEqual([
      'Ends on Nov 13: canceled at the end of the paid month. Perks stay on until then.',
      'Changes to VIP · Large SUV · $219/month from Nov 13.',
    ])
    expect(b.buttons.map((x) => x.key)).toEqual(['cancel/undo', 'change/undo', 'card-link', 'refund-last'])
    const p = billingBlock(member(billing({ pauseAt: '2026-11-13' })), ui)
    expect(p.notes).toEqual(['Pauses on Nov 13, the next billing date.'])
    expect(p.buttons[0]).toMatchObject({ key: 'resume', label: 'Undo pause' })
    const paused = billingBlock(member(billing({ squareStatus: 'PAUSED', nextChargeOn: null }), 'paused'), ui)
    expect(paused.status.value).toBe('Paused')
    expect(paused.buttons[0]).toMatchObject({ key: 'resume', label: 'Resume' })
  })
  it('a price move after the notice (Move members) is not undone here', () => {
    const b = billingBlock(
      member(
        billing({
          change: {
            kind: 'move',
            planKey: 'gold',
            planName: 'Gold',
            planClass: 'compact_car',
            planClassLabel: 'Compact car',
            monthlyCents: 13900,
            effectiveDate: null,
            swapAfter: '2026-11-12T14:00:00.000Z',
          },
        }),
      ),
      ui,
    )
    expect(b.notes).toEqual([
      'New price after the notice: Gold · Compact car · $139/month from the first bill after Nov 12.',
    ])
    expect(b.buttons.map((x) => x.key)).not.toContain('change')
    expect(b.buttons.map((x) => x.key)).not.toContain('change/undo')
  })
  it('a failed renewal: in grace with the date perks stop, then past due; the failed payment is listed', () => {
    const failed = billing({
      status: 'failed',
      nextChargeOn: null,
      pastDueOn: '2026-10-20',
      cancelOn: '2026-11-03',
      lastFailed: {
        amountCents: 12900,
        failedAt: '2026-10-13T14:00:00.000Z',
        dueDate: '2026-10-13',
        paid: false,
        payUrl: null,
      },
    })
    const b = billingBlock(member(failed), ui)
    expect(b.status).toEqual({
      label: 'Status',
      value: 'Payment failed · perks stay on until Oct 20',
      tone: 'red',
    })
    expect(b.lines.find((l) => l.label === 'Failed payment')).toMatchObject({
      value: '$129 on Oct 13 · not paid yet',
      tone: 'red',
    })
    expect(billingStatus(member(failed, 'past_due').membership!, failed, TODAY)).toEqual({
      label: 'Status',
      value: 'Past due · perks paused · canceled Nov 3 unless paid',
      tone: 'red',
    })
  })
  it('a membership still joining or canceled: no billing actions but the refund of a paid month', () => {
    const joining = billingBlock(member(billing({ lastPaid: null, nextChargeOn: null }), 'pending'), ui)
    expect(joining.status.value).toBe('Joining · waiting for the first payment')
    expect(joining.buttons).toEqual([])
    const ended = billingBlock(member(billing({ nextChargeOn: null }), 'canceled'), ui)
    expect(ended.status.value).toBe('Canceled')
    expect(ended.buttons.map((x) => x.key)).toEqual(['refund-last'])
    const refunded = billingBlock(
      member(
        billing({
          lastPaid: {
            amountCents: 12900,
            paidAt: '2026-10-13T14:00:00.000Z',
            dueDate: null,
            refundedCents: 12900,
          },
        }),
        'canceled',
      ),
      ui,
    )
    expect(refunded.buttons).toEqual([])
    expect(refunded.lines.find((l) => l.label === 'Last payment')!.value).toBe(
      '$129 on Oct 13 · $129 refunded',
    )
  })
  it('a payment already partly refunded: no Refund last payment, the server refunds only in full and once (F2)', () => {
    const part = billingBlock(
      member(
        billing({
          lastPaid: {
            amountCents: 12900,
            paidAt: '2026-10-13T14:00:00.000Z',
            dueDate: null,
            refundedCents: 900,
          },
        }),
      ),
      ui,
    )
    expect(part.buttons.map((x) => x.key)).not.toContain('refund-last')
    expect(part.lines.find((l) => l.label === 'Last payment')!.value).toBe('$129 on Oct 13 · $9 refunded')
    const free = billingBlock(
      member(
        billing({
          lastPaid: { amountCents: 0, paidAt: '2026-10-13T14:00:00.000Z', dueDate: null, refundedCents: 0 },
        }),
      ),
      ui,
    )
    expect(free.buttons.map((x) => x.key)).not.toContain('refund-last')
  })
  it('no card on file reads in red', () => {
    const b = billingBlock(member(billing({ card: null })), ui)
    expect(b.lines.find((l) => l.label === 'Card')).toMatchObject({ value: 'No card on file', tone: 'red' })
  })
  it('the toasts', () => {
    expect(billingToast('pause', 'Maria', {})).toEqual({
      title: 'Membership will pause',
      desc: 'From the next billing date',
    })
    expect(billingToast('card-link', 'Maria', { sms: 'queued' }).title).toBe('Card link texted')
    expect(billingToast('card-link', 'Maria', { sms: 'skipped' }).title).toBe('Card link not texted')
    expect(
      billingToast('refund-last', 'Maria', { refund: { amountCents: 12900, status: 'PENDING' } }),
    ).toEqual({
      title: 'Refund sent to Square',
      desc: '$129 back to the card',
    })
  })
})

describe('Change tier or size', () => {
  const tier = (key: string, name: string, prices: Array<[string, number]>, active = true): TierOption =>
    ({
      key,
      name,
      active,
      prices: prices.map(([cls, cents]) => ({ class: cls, monthlyCents: cents })),
    }) as unknown as TierOption
  const tiers = [
    tier('gold', 'Gold', [
      ['compact_car', 12900],
      ['large_suv', 14900],
    ]),
    tier('vip', 'VIP', [['large_suv', 21900]]),
    tier('old', 'Old', [['compact_car', 9900]], false),
    tier('new', 'New', []),
  ]
  const sizes = [
    { key: 'compact_car', label: 'Compact car' },
    { key: 'large_suv', label: 'Large SUV' },
  ]
  const cur = { planKey: 'gold', planClass: 'compact_car' }
  it('only tiers that are on and priced; the current plan first picked is no change', () => {
    const c = changeChoice(tiers, sizes, cur, { tier: null, size: null })
    expect(c.tiers.map((t) => t.key)).toEqual(['gold', 'vip'])
    expect(c.sizes).toEqual([
      { key: 'compact_car', label: 'Compact car', price: '$129/month', on: true },
      { key: 'large_suv', label: 'Large SUV', price: '$149/month', on: false },
    ])
    expect(c.ready).toBe(false)
    expect(c.summary).toBe('That is the plan it has now. Pick another tier or size.')
  })
  it('a size of the same tier, or another tier at a priced size', () => {
    expect(changeChoice(tiers, sizes, cur, { tier: null, size: 'large_suv' })).toMatchObject({
      ready: true,
      summary: 'Change to Gold · Large SUV · $149/month from the next billing date?',
    })
    const vip = changeChoice(tiers, sizes, cur, { tier: 'vip', size: null })
    expect(vip.ready).toBe(false)
    expect(vip.summary).toBe('VIP has no price at Compact car. Pick a size with a price.')
    expect(changeChoice(tiers, sizes, cur, { tier: 'vip', size: 'large_suv' }).summary).toBe(
      'Change to VIP · Large SUV · $219/month from the next billing date?',
    )
  })
  it('formats', () => {
    expect(monthly(12900)).toBe('$129/month')
    expect(monthly(null)).toBe('')
    expect(dayText('2026-11-13', TODAY)).toBe('Nov 13')
    expect(dayText('2027-01-02', TODAY)).toBe('Jan 2, 2027')
  })
})
