// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// The LIVE Payments template (compiled with the live patches) with the saved card's step and the Square receipt link
// (DV-901, DV-902), rendered from the live view model's real values. An invoice without a usable card renders none of it.
import fs from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSession } from '@/auth/test-fixtures'
import { ApiError } from '@/data/http/problem'
import type { InvoiceDetail } from '@/data/ports/payments'
import { compileScreens } from '../../../tools/dc-compile/compile'
import { root } from '../../../tools/dc-compile/tests/original-runtime'
import { makeDetail, makeEvent, makeLive, makeRow, resetIds, stubPort } from './live-testkit'
import type { Live } from './live-testkit'

const tmp = path.join(root, 'tools/dc-compile/tests/.tmp-snippets/payments-live-cards')
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

const CARD = { cardId: 'card-1', label: 'Visa ••4242', brand: 'VISA', last4: '4242' }
const sq = (d: InvoiceDetail, savedCard: typeof CARD | null): InvoiceDetail => ({
  ...d,
  processing: { processor: 'square', squarePosAppSwitch: false, squareTenders: { reader: true, link: true, savedCard } },
})

async function boot(d: InvoiceDetail): Promise<Live> {
  const port = stubPort()
  port.details.set(d.id, d)
  port.rows = [makeRow(d)]
  const l = makeLive(makeSession({ role: 'mgmt' }), port)
  for (let i = 0; i < 4; i++) {
    l.vals()
    await l.settle()
  }
  return l
}
const html = (l: Live) => renderToStaticMarkup(render(l.vals(), { name: 'payments' }))
const unpaid = (card: typeof CARD | null) =>
  sq(makeDetail({ label: 'INV-20640', client: 'Maria Alvarez', items: [{ name: 'Signature Hand Wash', priceCents: 4000 }] }), card)

describe('the live Payments template: saved card and receipts', () => {
  it('without a usable card: no Saved card tender and no OK box', async () => {
    const l = await boot(unpaid(null))
    l.vals().d.actions.find((a: any) => a.label.startsWith('Collect')).onClick()
    const page = html(l)
    expect(page).toContain('Square reader')
    expect(page).not.toContain('Saved card')
    expect(page).not.toContain('said OK to charge')
  })

  it('the saved card’s step: the OK box with the amount, a decline in red, waiting for Square', async () => {
    const l = await boot(unpaid(CARD))
    l.vals().d.actions.find((a: any) => a.label.startsWith('Collect')).onClick()
    l.vals().sh.payMethods.find((m: any) => m.label === 'Saved card ••4242').onClick()
    let page = html(l)
    expect(page).toContain('Saved card ••4242')
    expect(page).toContain('Maria said OK to charge $42.80 to Visa ••4242')
    expect(page).toContain('Charge $42.80 to Visa ••4242')
    expect(page).toContain('Ask Maria first.')
    l.vals().sh.scToggle()
    l.port.next.chargeCard = new ApiError({ status: 422, code: 'CARD_DECLINED', title: 'Card declined', detail: 'Insufficient funds.' })
    l.vals().sh.submit()
    await l.settle()
    page = html(l)
    expect(page).toContain('Card declined: Insufficient funds. Ask Maria for another way to pay.')
    l.vals().sh.scToggle()
    l.port.next.chargeCard = {
      charge: { id: 'ch-1', purpose: 'balance', state: 'unknown', amountCents: 4280, card: { id: 'card-1', label: 'Visa ••4242', brand: null, last4: null } },
      invoice: null,
    }
    l.vals().sh.submit()
    await l.settle()
    page = html(l)
    expect(page).toContain('Waiting for Square:')
    expect(page).toContain('>Done<')
    expect(page).not.toContain('said OK to charge')
  })

  it('a Square payment’s entry: the receipt number in its meta and the receipt link', async () => {
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
    const l = await boot(sq(makeDetail({ label: 'INV-20640', events: [pay] }), null))
    const page = html(l)
    expect(page).toContain('Receipt #Xy7Q')
    expect(page).toContain('Square receipt #Xy7Q')
    // a link is a button that opens the checked page; the URL is never in the markup
    expect(page).not.toContain('squareup.com/receipt')
  })
})
