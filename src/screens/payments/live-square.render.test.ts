// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// The LIVE Payments template (compiled with the live patches) rendered with the live view model's real values for the Square
// parts (DV-801..DV-806): the banner and the sheet, the ledger's Square buttons, the Collect tenders and the link with Copy.
// A Squarespace invoice renders none of it.
import fs from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSession } from '@/auth/test-fixtures'
import type { InvoiceDetail } from '@/data/ports/payments'
import { compileScreens } from '../../../tools/dc-compile/compile'
import { root } from '../../../tools/dc-compile/tests/original-runtime'
import { makeDetail, makeEvent, makeLive, makeRow, resetIds, stubPort } from './live-testkit'
import type { Live } from './live-testkit'

const tmp = path.join(root, 'tools/dc-compile/tests/.tmp-snippets/payments-live-square')
const text = (v: string | Buffer | undefined): string => (Buffer.isBuffer(v) ? v.toString('utf8') : (v ?? ''))
let render: (vals: any, ctx: { name: string }) => any

beforeAll(async () => {
  const out = compileScreens(['payments'], { root, variant: 'live', tplIds: false, allowComplexExpr: false })
  const dir = path.join(tmp, 'gen')
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, buf] of Object.entries(out.perScreen.payments!)) fs.writeFileSync(path.join(dir, name), text(buf))
  render = (await import(/* @vite-ignore */ path.join(dir, 'payments.tsx'))).default
})
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

beforeEach(() => {
  resetIds()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
})
afterEach(() => vi.useRealTimers())

const SQUARE = { processing: { processor: 'square' as const, squarePosAppSwitch: false } }

async function boot(...details: InvoiceDetail[]): Promise<Live> {
  const port = stubPort()
  for (const d of details) port.details.set(d.id, d)
  port.rows = details.map((d) => makeRow(d))
  const l = makeLive(makeSession({ role: 'mgmt' }), port)
  for (let i = 0; i < 4; i++) {
    l.vals()
    await l.settle()
  }
  return l
}
const html = (l: Live) => renderToStaticMarkup(render(l.vals(), { name: 'payments' }))

describe('the live Payments template with Square', () => {
  it('a Squarespace invoice renders as before: no Square words anywhere', async () => {
    const l = await boot(
      makeDetail({ events: [makeEvent({ type: 'pay', amountCents: 1000, awaitingProcessor: true, processorState: 'awaiting_processor' })] }),
    )
    const page = html(l)
    expect(page).toContain('Confirm in Squarespace')
    expect(page).not.toContain('Square payments to match')
    expect(page).not.toContain('Match a Square payment')
    expect(page).not.toContain('Square reader')
  })

  it('banner, sheet, the reader entry’s button and the move link render with the server’s words', async () => {
    const entry = makeEvent({ type: 'pay', amountCents: 4280, method: 'Card', methodKind: 'card', awaitingProcessor: true, processorState: 'awaiting_processor' })
    const moved = makeEvent({ type: 'pay', amountCents: 1000, method: 'Visa ••4242', methodKind: 'card', processor: 'square', processorState: 'confirmed', processorRef: 'sqp-2' })
    const failed = makeEvent({ type: 'refund', amountCents: 500, dest: 'card', processor: 'square', processorState: 'failed' })
    const d = { ...makeDetail({ label: 'INV-20640', client: 'Maria Alvarez', items: [{ name: 'Signature Hand Wash', priceCents: 4000 }], events: [entry, moved, failed] }), ...SQUARE }
    const port = stubPort()
    port.details.set(d.id, d)
    port.rows = [makeRow(d)]
    port.toMatch = [
      {
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
        note: 'INV?',
        receiptNumber: 'Xy7Q',
        product: 'SQUARE_POS',
        createdAt: '',
        ageMinutes: 3,
        candidates: [],
      },
    ]
    const l = makeLive(makeSession({ role: 'mgmt' }), port)
    for (let i = 0; i < 4; i++) {
      l.vals()
      await l.settle()
    }
    let page = html(l)
    expect(page).toContain('1 Square payment to match · $42.80 · oldest 3 min ago')
    expect(page).toContain('Match a Square payment')
    expect(page).toContain('Awaiting Square')
    expect(page).toContain('Wrong invoice? Move it')
    expect(page).toContain('Refund failed · not refunded')
    expect(page).not.toContain('Confirm in Squarespace')
    l.vals().live.sqReview()
    for (let i = 0; i < 3; i++) {
      l.vals()
      await l.settle()
    }
    page = html(l)
    expect(page).toContain('Square payments to match')
    expect(page).toContain('$42.80 · Visa ••4242')
    expect(page).toContain('Note: INV?')
    expect(page).toContain('INV-20640 · Maria Alvarez (open on screen)')
    expect(page).toContain('Not an Oasis sale')
    expect(page).toContain('Set aside')
  })

  it('Collect: the Square tenders, no URL box, and the link with Copy after a send', async () => {
    const d = { ...makeDetail({ label: 'INV-20640', client: 'Maria Alvarez', items: [{ name: 'Signature Hand Wash', priceCents: 4000 }] }), ...SQUARE }
    const l = await boot(d)
    l.vals().d.actions.find((a: any) => a.label.startsWith('Collect')).onClick()
    let page = html(l)
    expect(page).toContain('Square reader')
    expect(page).toContain('Charge $42.80 on the reader')
    l.vals().sh.payMethods.find((m: any) => m.label === 'Payment link').onClick()
    page = html(l)
    expect(page).not.toContain('Squarespace invoice or checkout URL')
    expect(page).toContain('Text link · $42.80')
    l.port.next.collect = {
      invoice: d,
      paymentLink: { id: 'pl', url: 'https://square.link/u/AbCd', expectedCents: 4280, purpose: 'balance', sms: 'queued', provider: 'square' },
    }
    l.vals().sh.submit()
    await l.settle()
    page = html(l)
    expect(page).toContain('https://square.link/u/AbCd')
    expect(page).toContain('Copy link')
    expect(page).toContain('>Done<')
  })
})
