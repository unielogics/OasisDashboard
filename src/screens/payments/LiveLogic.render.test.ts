// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// The LIVE template (compiled with the live patches) rendered with the live view model's real values: every root and
// handler the template binds exists, and the Squarespace additions (Confirm button, payment-link input) are in the DOM.
import fs from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compileScreens } from '../../../tools/dc-compile/compile'
import { root } from '../../../tools/dc-compile/tests/original-runtime'
import { makeSession } from '@/auth/test-fixtures'
import { atPath } from './testkit'
import { makeDetail, makeEvent, makeLive, makeRow, makeSummary, resetIds, stubPort } from './live-testkit'

const tmp = path.join(root, 'tools/dc-compile/tests/.tmp-snippets/payments-live-render')
const text = (v: string | Buffer | undefined): string => (Buffer.isBuffer(v) ? v.toString('utf8') : (v ?? ''))
let render: (vals: any, ctx: { name: string }) => any
let bindings: any

beforeAll(async () => {
  const out = compileScreens(['payments'], { root, variant: 'live', tplIds: false, allowComplexExpr: false })
  fs.mkdirSync(tmp, { recursive: true })
  const dir = path.join(tmp, 'gen')
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, buf] of Object.entries(out.perScreen.payments!))
    fs.writeFileSync(path.join(dir, name), text(buf))
  const mod = await import(/* @vite-ignore */ path.join(dir, 'payments.tsx'))
  render = mod.default
  bindings = JSON.parse(text(out.perScreen.payments!['payments.bindings.json']))
})
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

async function world() {
  resetIds()
  const pend = makeEvent({
    type: 'refund',
    amountCents: 8000,
    status: 'pending',
    dest: 'card',
    method: 'Visa ••5521',
    canApprove: true,
    by: 'Sofia D.',
  })
  const awaiting = makeEvent({
    type: 'pay',
    amountCents: 27820,
    method: 'Card',
    methodKind: 'card',
    processorState: 'awaiting_processor',
    awaitingProcessor: true,
  })
  const d = makeDetail({
    label: 'INV-20579',
    client: 'Chloe Bennett',
    events: [awaiting, pend],
    paymentLinkUrl: 'https://pay.squarespace.com/x',
    creditCents: 2500,
  })
  const port = stubPort()
  port.details.set(d.id, d)
  port.rows = [makeRow(d, { awaiting: 'payment' })]
  port.summaries.set(
    '7d',
    makeSummary({
      byMethod: { card: 1, applePay: 0, cash: 0, storeCredit: 0, other: 300 },
      pendingApprovals: {
        count: 1,
        text: '1 refund awaiting approval — $80.00 · Chloe Bennett · requested by Sofia D.',
        first: null,
        all: [],
      },
    }),
  )
  const l = makeLive(makeSession({ role: 'mgmt' }), port)
  for (let i = 0; i < 3; i++) {
    l.vals()
    await l.settle()
  }
  return { l, d }
}

function everyBindingExists(vals: any, sheetOpen = true): void {
  for (const r of bindings.roots) expect(vals, r).toHaveProperty(r)
  for (const h of bindings.handlers as string[]) {
    if (!sheetOpen && h.startsWith('sh.')) continue
    const parts = h.split('[]')
    if (parts.length === 1) {
      expect(typeof atPath(vals, h), h).toBe('function')
      continue
    }
    const list = atPath(vals, parts[0]!)
    if (Array.isArray(list))
      for (const item of list) expect(typeof atPath(item, parts[1]!.replace(/^\./, '')), h).toBe('function')
  }
}

describe('live template + live view model', () => {
  it('renders the table, the ledger row with Approve/Deny and Confirm, and the Other method row', async () => {
    const { l } = await world()
    const vals = l.vals()
    everyBindingExists(vals, false)
    const html = renderToStaticMarkup(render(vals, { name: 'payments' }))
    expect(html).toContain('Refund pending')
    expect(html).toContain('Confirm in Squarespace')
    expect(html).toContain('Mark it done once Squarespace shows it.')
    expect(html).toContain('Approve')
    expect(html).toContain('>Other<')
    expect(html).toContain('Awaiting Squarespace')
    expect(html).toContain('1 refund awaiting approval')
    // the design's Preview-as button is the live one: hidden for a person who is not a Super Admin
    expect(html).not.toContain('Preview as')
  })

  for (const sheet of ['refund', 'adjust', 'credit', 'collect', 'apply'] as const) {
    it(`every binding exists with the ${sheet} sheet open`, async () => {
      const { l, d } = await world()
      l.logic.openSheet(sheet, d)
      const vals = l.vals()
      everyBindingExists(vals)
      const html = renderToStaticMarkup(render(vals, { name: 'payments' }))
      expect(html).toContain(vals.sh.title)
    })
  }

  it('the collect sheet shows the URL input only for "Payment link", prefilled with the attached link, with the inline error', async () => {
    const { l, d } = await world()
    l.logic.openSheet('collect', d)
    let html = renderToStaticMarkup(render(l.vals(), { name: 'payments' }))
    expect(html).not.toContain('Squarespace invoice or checkout URL')
    l.vals().sh.payMethods[2].onClick()
    l.logic.setState({ urlError: 'Payment links must be HTTPS links on an allowed host (squarespace.com)' })
    html = renderToStaticMarkup(render(l.vals(), { name: 'payments' }))
    expect(html).toContain('Squarespace invoice or checkout URL')
    expect(html).toContain('value="https://pay.squarespace.com/x"')
    expect(html).toContain('Payment links must be HTTPS links on an allowed host')
    expect(html).toContain('The link is texted to the client by SMS.')
  })

  it('the locked card renders the viewed role from the session', async () => {
    const s = makeSession({ role: 'crew' })
    const l = makeLive(s)
    const vals = l.vals()
    expect(vals.locked).toBe(true)
    const html = renderToStaticMarkup(render(vals, { name: 'payments' }))
    expect(html).toContain('No payment access')
  })
})
