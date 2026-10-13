// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// Cards on file, the visit's cancel / no-show with the proposed fee, the deposit line, the processor for every role and the
// Square billing block on the live appointment file (ADR 0171 wave Q3; DV-903..DV-907): what the file shows from the server,
// what each control sends (permission first, then the request), and the live template rendering the new parts. With today's
// defaults (no saved cards, Squarespace, no Square membership) none of it shows, the visit's Cancel / No-show neither (F5).
import fs from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeMe } from '@/auth/test-fixtures'
import { toSession } from '@/auth/session-model'
import { ApiError } from '@/data/http/problem'
import type { CustomerCards, FeeCharges, MembershipView, TierList } from '@/data/ports/operations'
import { compileScreens } from '../../../tools/dc-compile/compile'
import { root } from '../../../tools/dc-compile/tests/original-runtime'
import { FILES, clone, fixtures, makeLive, makeSession, stubPayments, stubPort } from './live-testkit'
import type { Live, StubPort } from './live-testkit'

const calls = (l: Live, name: string) => l.port.calls.filter((c) => c[0] === name)
const payCalls = (l: Live, name: string) => l.payments.calls.filter((c) => c[0] === name)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
})
afterEach(() => vi.useRealTimers())

const flushed = async (l: Live) => {
  for (let i = 0; i < 8; i++) {
    await vi.advanceTimersByTimeAsync(5)
    await Promise.resolve()
  }
  await l.settle()
}

async function boot(port: StubPort = stubPort(), role: Parameters<typeof makeSession>[0] = { role: 'mgmt' }) {
  const l = makeLive(makeSession(role), port, stubPayments())
  l.vals()
  await l.settle()
  l.vals()
  return l
}

async function openFile(l: Live, id: string, tab = 'overview') {
  l.logic.select(id, tab)
  for (let i = 0; i < 3; i++) {
    l.vals()
    await flushed(l)
  }
  return l.vals()
}
const again = async (l: Live) => {
  for (let i = 0; i < 3; i++) {
    l.vals()
    await flushed(l)
  }
  return l.vals()
}

let render: (vals: any, ctx: { name: string }) => any
const tmp = path.join(root, 'tools/dc-compile/tests/.tmp-snippets/operations-live-billing')
const text = (v: string | Buffer | undefined): string => (Buffer.isBuffer(v) ? v.toString('utf8') : (v ?? ''))
beforeAll(async () => {
  const out = compileScreens(['operations'], {
    root,
    variant: 'live',
    tplIds: false,
    allowComplexExpr: false,
  })
  const dir = path.join(tmp, 'gen')
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, buf] of Object.entries(out.perScreen.operations!))
    fs.writeFileSync(path.join(dir, name), text(buf))
  render = (await import(/* @vite-ignore */ path.join(dir, 'operations.tsx'))).default
})
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))
const html = (l: Live) => renderToStaticMarkup(render(l.vals(), { name: 'operations' }))

const CARDS = (charge = true): CustomerCards =>
  ({
    charge,
    cards: [
      {
        id: 'card-1',
        brand: 'VISA',
        last4: '4242',
        label: 'Visa ••4242',
        expMonth: 12,
        expYear: 2028,
        state: 'active',
        createdVia: 'card_link',
        createdAt: '2026-06-12T15:00:00.000Z',
        disabledAt: null,
        disabledReason: null,
        purposes: ['no_show_fee', 'balance'],
        consents: [
          {
            id: 'k1',
            version: 'v1',
            purposes: ['no_show_fee', 'balance'],
            acceptedAt: '2026-06-12T15:00:00.000Z',
            revokedAt: null,
            revokeReason: null,
            via: 'link',
          },
        ],
      },
    ],
  }) as CustomerCards

/** Square takes card money on this file's invoice (wave Q3's `invoice.processing`); `status` changes the visit's status. */
const squareFile = (port: StubPort, status?: string): any => {
  const f = clone(FILES.late) as any
  if (status) f.status = status
  f.invoice = {
    ...f.invoice,
    processing: {
      processor: 'square',
      squarePosAppSwitch: false,
      squareTenders: { reader: true, link: true, savedCard: null },
    },
  }
  port.files.set(f.id, f)
  return f
}

describe('with today’s defaults', () => {
  it('no cards block, no billing block, no Visit card (Squarespace: nothing new shows, F5)', async () => {
    const l = await boot()
    const f = FILES.late as any
    let v = await openFile(l, f.id)
    expect(calls(l, 'cards')).toHaveLength(1)
    expect(v.sel.cdShow).toBe(false)
    expect(v.sel.vsShow).toBe(false)
    expect(v.sel.feeRows).toEqual([])
    expect(calls(l, 'feeCharges')).toHaveLength(0)
    const page = html(l)
    expect(page).not.toContain('Cancel visit')
    expect(page).not.toContain('Cards on file')
    v = await openFile(l, (FILES.cleaning as any).id, 'membership')
    expect(v.sel.blShow).toBe(false)
    expect(html(l)).not.toContain('Billed by Square')
  })
})

describe('cards on file (DV-903)', () => {
  it('lists the cards with their consent; Remove asks first, then the server disables it', async () => {
    const port = stubPort()
    const f = FILES.late as any
    port.cardsOf.set(f.customer.id, CARDS())
    const l = await boot(port)
    let v = await openFile(l, f.id)
    expect(v.sel.cdShow).toBe(true)
    expect(v.sel.cdRows[0]).toMatchObject({
      label: 'Visa ••4242',
      sub: 'Expires 12/28 · On file',
      consent: 'Consent v1 · Jun 12 · no-show fee and balances · on the client’s link',
    })
    let page = html(l)
    expect(page).toContain('Cards on file')
    expect(page).toContain('Visa ••4242')
    expect(page).toContain('Text card link')
    v.sel.cdRows[0].remove()
    v = l.vals()
    expect(v.sel.cdRows[0].confirming).toBe(true)
    page = html(l)
    expect(page).toContain(
      'Remove Visa ••4242? Square disables it and Marcus’s permission to charge it ends.',
    )
    expect(calls(l, 'removeCard')).toHaveLength(0)
    v.sel.cdRows[0].confirm()
    await flushed(l)
    expect(calls(l, 'removeCard')[0]!.slice(1, 3)).toEqual([f.customer.id, 'card-1'])
    expect(l.vals().toastTitle).toBe('Card removed')
    expect(l.vals().sel.cdRows[0].confirming).toBe(false)
  })

  it('Text card link sends the request and says whether the text went', async () => {
    const port = stubPort()
    const f = FILES.late as any
    port.cardsOf.set(f.customer.id, { cards: [], charge: true } as CustomerCards)
    const l = await boot(port)
    const v = await openFile(l, f.id)
    expect(v.sel.cdEmpty).toBe(true)
    expect(v.sel.cdEmptyText).toBe('No card saved yet. Text Marcus a secure link to save one.')
    v.sel.cdLink()
    await flushed(l)
    expect(calls(l, 'cardLink')[0]![1]).toBe(f.customer.id)
    expect(l.vals().toastTitle).toBe('Card link texted')
  })

  it('a role without cli.edit sees the cards, gets the wording and sends nothing', async () => {
    const port = stubPort()
    const f = FILES.late as any
    port.cardsOf.set(f.customer.id, CARDS())
    const l = await boot(port, { role: 'acct' } as any)
    const v = await openFile(l, f.id)
    expect(v.sel.cdShow).toBe(true)
    v.sel.cdRows[0].remove()
    v.sel.cdLink()
    await flushed(l)
    expect(calls(l, 'removeCard')).toHaveLength(0)
    expect(calls(l, 'cardLink')).toHaveLength(0)
    expect(l.vals().toastTitle).toBe('Your role can’t edit clients')
  })
})

const FEES = (state = 'proposed', extra: Record<string, unknown> = {}): FeeCharges =>
  ({
    items: [
      {
        id: 'ch-1',
        purpose: 'no_show_fee',
        state,
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
        createdAt: '2026-06-13T14:00:00.000Z',
        ...extra,
      },
    ],
  }) as unknown as FeeCharges

describe('the visit: cancel, no-show and the fee (DV-904)', () => {
  it('Cancel visit asks for a reason first, then sends it with the text to the client', async () => {
    const port = stubPort()
    const f = squareFile(port)
    const l = await boot(port)
    let v = await openFile(l, f.id)
    expect(v.sel.vsShow).toBe(true)
    expect(v.sel.vsCanClose).toBe(true)
    const page = html(l)
    expect(page).toContain('Cancel visit')
    expect(page).toContain('No-show')
    v.sel.vsCancel()
    v = l.vals()
    expect(v.sel.vsCancelling).toBe(true)
    expect(v.sel.vsCancelText).toBe(
      'Cancel Marcus’s visit? Marcus gets a text, and the deposit follows your cancellation rules.',
    )
    v.sel.vsConfirmCancel()
    await flushed(l)
    expect(calls(l, 'cancel')).toHaveLength(0)
    expect(l.vals().toastTitle).toBe('Say why first')
    l.vals().sel.vsSetReason({ target: { value: 'Client called' } })
    l.vals().sel.vsConfirmCancel()
    await flushed(l)
    const c = calls(l, 'cancel')[0]!
    expect(c[1]).toBe(f.id)
    expect(c[2]).toEqual({ reason: 'Client called', notify: true })
    expect((c[3] as any).idempotencyKey).toBeTruthy()
    expect(l.vals().sel.vsCancelling).toBe(false)
  })

  it('No-show asks first, then sends it', async () => {
    const port = stubPort()
    const f = squareFile(port)
    const l = await boot(port)
    const v = await openFile(l, f.id)
    v.sel.vsNoShow()
    expect(l.vals().sel.vsNoShowText).toBe(
      'Mark Marcus as a no-show? No text is sent, and the deposit follows your no-show rules.',
    )
    l.vals().sel.vsConfirmNoShow()
    await flushed(l)
    expect(calls(l, 'noShow')[0]![1]).toBe(f.id)
  })

  it('a no-show visit lists its proposed fee: Charge asks first, then charges; Waive needs a reason', async () => {
    const port = stubPort()
    const f = squareFile(port, 'no_show')
    port.feesOf.set(f.id, FEES())
    const l = await boot(port)
    let v = await openFile(l, f.id)
    expect(v.sel.vsShow).toBe(true)
    expect(v.sel.vsCanClose).toBe(false)
    expect(v.sel.vsClosedText).toBe('Marked as a no-show')
    expect(v.sel.feeRows[0]).toMatchObject({
      title: 'No-show fee · $15 on Visa ••4242',
      line: 'Proposed by the cancellation rules. Charge it or waive it.',
      canDecide: true,
    })
    let page = html(l)
    expect(page).toContain('No-show fee · $15 on Visa ••4242')
    expect(page).toContain('Charge $15')
    expect(page).toContain('Waive')
    v.sel.feeRows[0].charge()
    v = l.vals()
    expect(v.sel.feeRows[0].confirming).toBe(true)
    page = html(l)
    expect(page).toContain('Charge the No-show fee of $15 on Visa ••4242 now?')
    expect(calls(l, 'chargeFee')).toHaveLength(0)
    v.sel.feeRows[0].confirm()
    await flushed(l)
    expect(calls(l, 'chargeFee')[0]!.slice(1, 3)).toEqual([f.id, 'ch-1'])
    expect(l.vals().toastTitle).toBe('No-show fee charged')
    // waive
    v = l.vals()
    v.sel.feeRows[0].waive()
    v = l.vals()
    expect(v.sel.feeRows[0].waiving).toBe(true)
    v.sel.feeRows[0].waiveConfirm()
    await flushed(l)
    expect(calls(l, 'waiveFee')).toHaveLength(0)
    l.vals().sel.feeRows[0].setReason({ target: { value: 'First time' } })
    l.vals().sel.feeRows[0].waiveConfirm()
    await flushed(l)
    expect(calls(l, 'waiveFee')[0]!.slice(1, 4)).toEqual([f.id, 'ch-1', 'First time'])
    expect(l.vals().toastTitle).toBe('Fee waived')
  })

  it('declined and waiting-for-Square fees say so; a charged one cannot be decided again', async () => {
    const port = stubPort()
    const f = squareFile(port, 'canceled')
    port.feesOf.set(f.id, FEES('declined', { error: 'Insufficient funds.', purpose: 'late_cancel_fee' }))
    const l = await boot(port)
    let v = await openFile(l, f.id)
    expect(v.sel.feeRows[0]).toMatchObject({
      title: 'Late-cancel fee · $15 on Visa ••4242',
      line: 'Declined: Insufficient funds. Charge it again or waive it.',
      canDecide: true,
    })
    port.feesOf.set(f.id, FEES('unknown'))
    await l.qc.invalidateQueries({ queryKey: ['ops', 'fees'] })
    v = await again(l)
    expect(v.sel.feeRows[0].line).toBe(
      'Waiting for Square: it is recorded as soon as Square answers, never twice.',
    )
    expect(v.sel.feeRows[0].canDecide).toBe(false)
  })

  it('without pay.collect the fee can be read but not charged; without sched.cancel nothing closes', async () => {
    const port = stubPort()
    const f = squareFile(port, 'no_show')
    port.feesOf.set(f.id, FEES())
    // Crew: neither pay.collect nor sched.cancel: the fee is not even read
    const crew = await boot(port, { role: 'crew' } as any)
    let v = await openFile(crew, f.id)
    expect(calls(crew, 'feeCharges')).toHaveLength(0)
    expect(v.sel.feeRows).toEqual([])
    expect(v.sel.vsShow).toBe(false)
    // an open visit: no Cancel / No-show without sched.cancel (F5); a stray call is still refused
    const openPort = stubPort()
    const g = squareFile(openPort)
    const open = await boot(openPort, { role: 'crew' } as any)
    v = await openFile(open, g.id)
    expect(v.sel.vsShow).toBe(false)
    expect(html(open)).not.toContain('Cancel visit')
    v.sel.vsCancel()
    expect(open.vals().sel.vsCancelling).toBe(false)
    expect(open.vals().toastTitle).toBe('Your role can’t cancel appointments')
  })
})

describe('Not charged (checked Square) on a fee waiting for Square (DV-910)', () => {
  const SETTLING = 'Square may still be answering this charge. Check again in a few minutes.'

  it('asks first, then sends it on the fee’s invoice with a key; a refusal is the server’s words, on the row too', async () => {
    const port = stubPort()
    const f = squareFile(port, 'no_show')
    port.feesOf.set(f.id, FEES('unknown'))
    const l = await boot(port)
    let v = await openFile(l, f.id)
    expect(v.sel.feeRows[0]).toMatchObject({
      line: 'Waiting for Square: it is recorded as soon as Square answers, never twice.',
      canDecide: false,
      ncShow: true,
      ncLabel: 'Not charged (checked Square)',
      ncConfirming: false,
    })
    const page = html(l)
    expect(page).toContain('Not charged (checked Square)')
    expect(page).not.toContain('Only if Square shows no payment for this charge.')
    v.sel.feeRows[0].ncOpen()
    v = l.vals()
    expect(v.sel.feeRows[0].ncConfirming).toBe(true)
    expect(html(l)).toContain('Only if Square shows no payment for this charge.')
    expect(payCalls(l, 'notCharged')).toHaveLength(0)
    l.payments.fail.set(
      'notCharged',
      new ApiError({
        status: 409,
        code: 'CARD_CHARGE_IN_PROGRESS',
        title: 'A charge is still going',
        detail: SETTLING,
      }),
    )
    v.sel.feeRows[0].ncConfirm()
    await flushed(l)
    const first = payCalls(l, 'notCharged')[0]!
    expect(first.slice(1, 3)).toEqual(['inv-1', 'ch-1'])
    expect((first[3] as any).idempotencyKey).toBeTruthy()
    v = l.vals()
    expect(v.toastTitle).toBe('A charge is still going')
    expect(v.toastDesc).toBe(SETTLING)
    expect(v.sel.feeRows[0].ncConfirming).toBe(false)
    expect(v.sel.feeRows[0].ncNote).toBe(SETTLING)
    expect(html(l)).toContain(SETTLING)
    // a few minutes later: Square has none, the fee is closed as not charged
    l.payments.fail.delete('notCharged')
    l.vals().sel.feeRows[0].ncOpen()
    l.vals().sel.feeRows[0].ncConfirm()
    await flushed(l)
    const second = payCalls(l, 'notCharged')[1]!
    expect((second[3] as any).idempotencyKey).toBe((first[3] as any).idempotencyKey)
    v = l.vals()
    expect(v.toastTitle).toBe('Nothing was charged')
    expect(v.toastDesc).toBe('Charge the fee again or waive it')
    expect(v.sel.feeRows[0].ncHasNote).toBe(false)
  })

  it('without pay.collect the waiting fee reads, but Not charged is not offered and nothing is sent', async () => {
    const port = stubPort()
    const f = squareFile(port, 'no_show')
    port.feesOf.set(f.id, FEES('unknown'))
    const me = makeMe({ role: 'mgmt' })
    me.permissions['pay.collect'] = { on: false }
    const l = makeLive(
      toSession(me, { serverTime: '2026-06-13T14:36:00.000Z', businessTz: 'America/New_York' }),
      port,
      stubPayments(),
    )
    l.vals()
    await l.settle()
    const v = await openFile(l, f.id)
    expect(v.sel.feeRows[0].line).toMatch(/^Waiting for Square:/)
    expect(v.sel.feeRows[0].ncShow).toBe(false)
    expect(html(l)).not.toContain('Not charged (checked Square)')
    v.sel.feeRows[0].ncOpen()
    v.sel.feeRows[0].ncConfirm()
    await flushed(l)
    expect(l.vals().sel.feeRows[0].ncConfirming).toBe(false)
    expect(payCalls(l, 'notCharged')).toHaveLength(0)
  })

  it('a proposed or decided fee offers no Not charged', async () => {
    const port = stubPort()
    const f = squareFile(port, 'no_show')
    port.feesOf.set(f.id, FEES('proposed'))
    const l = await boot(port)
    const v = await openFile(l, f.id)
    expect(v.sel.feeRows[0].ncShow).toBe(false)
    expect(html(l)).not.toContain('Not charged (checked Square)')
  })
})

describe('the Visit card only once Square takes card money (F5)', () => {
  it('Squarespace: no Visit card on an open visit, and a closed one reads no fees', async () => {
    const port = stubPort()
    const f = clone(FILES.late) as any
    f.status = 'no_show'
    port.files.set(f.id, f)
    port.feesOf.set(f.id, FEES())
    const l = await boot(port)
    const v = await openFile(l, f.id)
    expect(v.sel.vsShow).toBe(false)
    expect(calls(l, 'feeCharges')).toHaveLength(0)
    expect(html(l)).not.toContain('No-show fee')
  })
  it('Square: a closed visit without fees shows no card', async () => {
    const port = stubPort()
    const f = squareFile(port, 'canceled')
    port.feesOf.set(f.id, { items: [] } as unknown as FeeCharges)
    const l = await boot(port)
    const v = await openFile(l, f.id)
    expect(calls(l, 'feeCharges')).toHaveLength(1)
    expect(v.sel.vsShow).toBe(false)
  })
})

describe('the deposit line and the processor for every role (DV-905)', () => {
  it('the server’s deposit state and processor, without reading the invoice (a role without pay.reports)', async () => {
    const port = stubPort()
    const f = clone(FILES.late) as any
    f.invoice = {
      ...f.invoice,
      deposit: {
        state: 'link_sent',
        requestedCents: 2500,
        paidCents: 0,
        refundedCents: 0,
        pendingRefundCents: 0,
        keptCents: 0,
        refundFailed: false,
        refundSending: false,
        link: {
          state: 'active',
          sentAt: '2026-06-13T13:00:00.000Z',
          expiresAt: null,
          createdAt: '2026-06-13T13:00:00.000Z',
        },
      },
      processing: {
        processor: 'square',
        squarePosAppSwitch: false,
        squareTenders: { reader: true, link: true, savedCard: null },
      },
    }
    port.files.set(f.id, f)
    const l = await boot(port, { role: 'support' } as any)
    const v = await openFile(l, f.id, 'payments')
    expect(v.sel.payRows.find((r: any) => r.label.startsWith('Deposit link'))).toMatchObject({
      label: 'Deposit link texted · not paid yet',
      val: '$25',
    })
    expect(v.sel.payTenders.map((t: any) => t.label)).toContain('Square reader')
    expect(payCalls(l, 'invoice')).toHaveLength(0)
  })
})

const billingOf = (over: Record<string, unknown> = {}) => ({
  status: 'ok',
  squareStatus: 'ACTIVE',
  failedAt: null,
  notifiedAt: null,
  pastDueOn: null,
  cancelOn: null,
  monthlyCents: 12900,
  planClassLabel: 'Compact car',
  nextChargeOn: '2026-07-12',
  card: { brand: 'VISA', last4: '5858', label: 'Visa ••5858', expMonth: 12, expYear: 2028, state: 'active' },
  cancelAt: null,
  pauseAt: null,
  change: null,
  lastInvoice: null,
  lastPaid: {
    amountCents: 12900,
    paidAt: '2026-06-12T14:00:00.000Z',
    dueDate: '2026-06-12',
    refundedCents: 0,
  },
  lastFailed: null,
  enrollment: null,
  ...over,
})

function squareMember(port: StubPort, over: Record<string, unknown> = {}) {
  const f = clone(FILES.cleaning) as any
  const mem = clone(fixtures.membershipMember) as any
  mem.membership.source = 'square'
  mem.membership.planClass = 'compact_car'
  mem.membership.planClassLabel = 'Compact car'
  mem.membership.household = []
  mem.membership.billing = billingOf(over)
  port.memberships.set(f.customer.id, mem as MembershipView)
  return { f, mem }
}

describe('the Membership tab’s billing block (DV-907)', () => {
  it('shows status, plan, next charge, card and last payment; Pause asks first, then the server', async () => {
    const port = stubPort()
    const { f, mem } = squareMember(port)
    const l = await boot(port)
    let v = await openFile(l, f.id, 'membership')
    expect(v.sel.blShow).toBe(true)
    expect(v.sel.blStatus).toBe('Active · billed by Square')
    expect(v.sel.blLines.map((x: any) => x.label + ': ' + x.value)).toEqual([
      'Plan: Premium · Compact car · $129/month',
      'Next charge: Jul 12 · $129',
      'Card: Visa ••5858 · expires 12/28',
      'Last payment: $129 on Jun 12',
    ])
    expect(v.sel.blButtons.map((b: any) => b.label)).toEqual([
      'Pause',
      'Cancel at period end',
      'Change tier or size',
      'Text card link',
      'Refund last payment',
    ])
    let page = html(l)
    expect(page).toContain('Billed by Square')
    expect(page).toContain('Visa ••5858 · expires 12/28')
    v.sel.blButtons[0].onClick()
    v = l.vals()
    expect(v.sel.blConfirming).toBe(true)
    expect(v.sel.blConfirmText).toBe(
      'Pause from the next billing date? No charge while paused; perks stop then.',
    )
    page = html(l)
    expect(page).toContain('Pause from the next billing date?')
    expect(calls(l, 'billing')).toHaveLength(0)
    v.sel.blConfirm()
    await flushed(l)
    expect(calls(l, 'billing')[0]!.slice(1, 3)).toEqual([mem.membership.id, 'pause'])
    expect(l.vals().toastTitle).toBe('Membership will pause')
    expect(l.vals().sel.blConfirming).toBe(false)
  })

  it('undo actions and the card link go at once; the refund needs pay.refund and asks first', async () => {
    const port = stubPort()
    const { f, mem } = squareMember(port, { cancelAt: '2026-07-12', nextChargeOn: null })
    const l = await boot(port)
    let v = await openFile(l, f.id, 'membership')
    expect(v.sel.blNotes.map((n: any) => n.text)).toEqual([
      'Ends on Jul 12: canceled at the end of the paid month. Perks stay on until then.',
    ])
    v.sel.blButtons.find((b: any) => b.label === 'Undo cancel').onClick()
    await flushed(l)
    expect(calls(l, 'billing')[0]!.slice(1, 3)).toEqual([mem.membership.id, 'cancel/undo'])
    v = l.vals()
    v.sel.blButtons.find((b: any) => b.label === 'Text card link').onClick()
    await flushed(l)
    expect(calls(l, 'billing')[1]!.slice(1, 3)).toEqual([mem.membership.id, 'card-link'])
    expect(l.vals().toastTitle).toBe('Card link texted')
    v = l.vals()
    v.sel.blButtons.find((b: any) => b.label === 'Refund last payment').onClick()
    v = l.vals()
    expect(v.sel.blConfirmText).toBe(
      'Refund $129 of Jun 12 to the card through Square? The membership itself does not change.',
    )
    v.sel.blConfirm()
    await flushed(l)
    expect(calls(l, 'refundLast')[0]![1]).toBe(mem.membership.id)
    expect((calls(l, 'refundLast')[0]![2] as any).idempotencyKey).toBeTruthy()
    expect(l.vals().toastTitle).toBe('Refund sent to Square')
  })

  it('Change tier or size: the priced tiers and sizes, the summary, then the server', async () => {
    const port = stubPort()
    const { f, mem } = squareMember(port)
    mem.membership.plan.key = 'gold'
    port.tierList = {
      tiers: [
        {
          key: 'gold',
          name: 'Gold',
          active: true,
          prices: [
            { class: 'compact_car', monthlyCents: 12900 },
            { class: 'large_suv', monthlyCents: 14900 },
          ],
        },
        { key: 'vip', name: 'VIP', active: true, prices: [{ class: 'large_suv', monthlyCents: 21900 }] },
      ],
    } as unknown as TierList
    const l = await boot(port)
    let v = await openFile(l, f.id, 'membership')
    v.sel.blButtons.find((b: any) => b.label === 'Change tier or size').onClick()
    v = await again(l)
    expect(v.sel.blChangeOpen).toBe(true)
    expect(v.sel.blTiers.map((t: any) => t.label)).toEqual(['Gold', 'VIP'])
    expect(v.sel.blSizes.map((t: any) => t.label)).toEqual([
      'Compact car · $129/month',
      'Large SUV · $149/month',
    ])
    v.sel.blTiers[1].onClick()
    v = l.vals()
    expect(v.sel.blChangeSummary).toBe('VIP has no price at Compact car. Pick a size with a price.')
    v.sel.blChangeConfirm()
    await flushed(l)
    expect(calls(l, 'changeBilling')).toHaveLength(0)
    l.vals().sel.blSizes[0].onClick()
    v = l.vals()
    expect(v.sel.blChangeSummary).toBe('Change to VIP · Large SUV · $219/month from the next billing date?')
    const page = html(l)
    expect(page).toContain('Change to VIP · Large SUV · $219/month')
    v.sel.blChangeConfirm()
    await flushed(l)
    expect(calls(l, 'changeBilling')[0]!.slice(1, 3)).toEqual([
      mem.membership.id,
      { planKey: 'vip', planClass: 'large_suv' },
    ])
    expect(l.vals().toastTitle).toBe('Change scheduled')
    expect(l.vals().sel.blChangeOpen).toBe(false)
  })

  it('a role without cli.member gets the wording and nothing is sent', async () => {
    const port = stubPort()
    const { f } = squareMember(port)
    const l = await boot(port, { role: 'crew' } as any)
    const v = await openFile(l, f.id, 'membership')
    v.sel.blButtons[0].onClick()
    await flushed(l)
    expect(l.vals().sel.blConfirming).toBe(false)
    expect(calls(l, 'billing')).toHaveLength(0)
    expect(l.vals().toastTitle).toBe('Your role can’t manage memberships')
  })
})

describe('board cards carry the tier colours (DV-906)', () => {
  it('a card’s member badge takes the server’s colours', async () => {
    const port = stubPort()
    const card = port.snap.timeline.groups.flatMap((g) => g.items).find((c) => c.member)!
    ;(card.member as any).color = '#123456'
    ;(card.member as any).bgColor = '#ABCDEF'
    const l = await boot(port)
    const v = await again(l)
    const vm = v.groups.flatMap((g: any) => g.items).find((x: any) => x.id === card.id)
    expect(vm.memberStyle.color).toBe('#123456')
    expect(vm.memberStyle.background).toBe('#ABCDEF')
  })
})
