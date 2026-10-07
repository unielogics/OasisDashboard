// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// The LIVE template (compiled with the live patches) rendered with the live view model's real values on responses
// captured from the API: every root and handler the template binds exists in every state, and the live additions
// (composer, real fields, upload tile, Payment pending, SMS chips) are in the DOM.
import fs from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compileScreens } from '../../../tools/dc-compile/compile'
import { root } from '../../../tools/dc-compile/tests/original-runtime'
import { FILES, clone, fixtures, makeLive, makeSession, stubPort } from './live-testkit'

const tmp = path.join(root, 'tools/dc-compile/tests/.tmp-snippets/operations-live-render')
const text = (v: string | Buffer | undefined): string => (Buffer.isBuffer(v) ? v.toString('utf8') : (v ?? ''))
let render: (vals: any, ctx: { name: string }) => any
let bindings: any

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
  const mod = await import(/* @vite-ignore */ path.join(dir, 'operations.tsx'))
  render = mod.default
  bindings = JSON.parse(text(out.perScreen.operations!['operations.bindings.json']))
})
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

const atPath = (vals: any, p: string): any => {
  let cur = vals
  for (const part of p.match(/[^.[\]]+/g) || []) {
    if (cur === null || cur === undefined) return undefined
    cur = cur[part]
  }
  return cur
}

function everyBindingExists(vals: any): void {
  for (const r of bindings.roots) {
    if (r === 'sel') continue
    expect(vals, r).toHaveProperty(r)
  }
  for (const h of bindings.handlers as string[]) {
    if (h.startsWith('sel.') && !vals.sel) continue
    const parts = h.split('[]')
    if (parts.length === 1) {
      if (h === 'ghostRef') continue
      expect(typeof atPath(vals, h), h).toBe('function')
      continue
    }
    if (parts.length > 2) continue
    // a handler inside a list (some items carry it only in one state: a free bay has `assign`, an occupied one `open`)
    const list = atPath(vals, parts[0]!)
    if (!Array.isArray(list)) continue
    const rest = parts[1]!.replace(/^\./, '')
    const types = list.map((item) => typeof atPath(item, rest))
    expect(
      types.filter((t) => t !== 'function' && t !== 'undefined'),
      h,
    ).toEqual([])
    if (list.length && !/^(bays|calRows)/.test(h)) expect(types, h).not.toContain('undefined')
  }
}

async function open(fileKey: keyof typeof FILES, tab: string, session = makeSession({ role: 'mgmt' })) {
  const port = stubPort()
  const l = makeLive(session, port)
  l.vals()
  await l.settle()
  const id = (FILES[fileKey] as any).id as string
  l.logic.select(id, tab)
  l.vals()
  await l.settle()
  l.vals()
  await l.settle()
  return { l, port, id }
}

describe('live template + live view model', () => {
  it('renders the board from the captured snapshot with every binding present', async () => {
    const l = makeLive()
    l.vals()
    await l.settle()
    const vals = l.vals()
    everyBindingExists(vals)
    const html = renderToStaticMarkup(render(vals, { name: 'operations' }))
    expect(html).toContain('Appointments 24h')
    expect(html).toContain('Jonathan Franco')
    expect(html).toContain('Live · 10:36 AM')
    expect(html).toContain('Saturday, June 13')
    expect(html).toContain('$1,487.48')
    // the arrival button is the real check-in, not a simulation
    expect(html).toContain('>Check in<')
    expect(html).not.toContain('Simulate arrival')
    expect(html).not.toContain('WhatsApp')
  })

  it('the New Appointment sheet has real fields, the SMS toggle, the date row and the real slot grid', async () => {
    const l = makeLive()
    l.vals()
    await l.settle()
    l.vals().openNew()
    l.vals()
    await l.settle()
    l.vals()
    await l.settle()
    const vals = l.vals()
    everyBindingExists(vals)
    const html = renderToStaticMarkup(render(vals, { name: 'operations' }))
    expect(html).toContain('placeholder="Full name"')
    expect(html).toContain('placeholder="Phone number"')
    expect(html).toContain('placeholder="Year / Make / Model"')
    expect(html).toContain('placeholder="License plate"')
    expect(html).toContain('>SMS<')
    expect(html).toContain('Today · Saturday, June 13')
    expect(html).toContain('11:00 AM')
    expect(html).toContain('Book Appointment')
    expect(html).not.toContain('WhatsApp')
    // a walk-in has no slot grid and says so on its button
    l.vals().openWalkin()
    const walk = renderToStaticMarkup(render(l.vals(), { name: 'operations' }))
    expect(walk).not.toContain('Available slots')
    expect(walk).toContain('Check in walk-in')
  })

  for (const tab of [
    'overview',
    'checklist',
    'addons',
    'photos',
    'messages',
    'payments',
    'membership',
    'history',
  ]) {
    it(`every binding exists with the ${tab} tab open`, async () => {
      const { l } = await open('completed', tab)
      const vals = l.vals()
      expect(vals.sel, 'the file opened').toBeTruthy()
      everyBindingExists(vals)
      const html = renderToStaticMarkup(render(vals, { name: 'operations' }))
      expect(html).toContain('Priya Nair')
      expect(html).not.toContain('WhatsApp')
    })
  }

  it('Messages: a real composer, the pills, the SMS chip and no WhatsApp', async () => {
    const { l } = await open('completed', 'messages')
    const html = renderToStaticMarkup(render(l.vals(), { name: 'operations' }))
    expect(html).toContain('placeholder="Type a message…"')
    expect(html).toContain('SMS opted-in')
    expect(html).toContain('Confirmed')
    expect(html).toContain('Ready for pickup')
  })

  it('Photos: thumbnails for real photos and a file input on the add tile', async () => {
    const { l } = await open('cleaning', 'photos')
    const html = renderToStaticMarkup(render(l.vals(), { name: 'operations' }))
    expect(html).toContain('<img src="http://127.0.0.1:4023/dev-storage/files/')
    expect(html).toContain('type="file"')
    expect(html).toContain('accept="image/jpeg,image/png,image/webp,image/heic,image/heif"')
  })

  it('Payments: the tender choice, the link input, and Payment pending for unconfirmed card money', async () => {
    const { l, port, id } = await open('completed', 'payments')
    let html = renderToStaticMarkup(render(l.vals(), { name: 'operations' }))
    expect(html).toContain('>Card<')
    expect(html).toContain('>Cash<')
    expect(html).toContain('Mark Paid · <span class="sc-interp">$164.78</span>')
    expect(html).not.toContain('Squarespace invoice or checkout URL')
    l.vals().sel.sendLink()
    html = renderToStaticMarkup(render(l.vals(), { name: 'operations' }))
    expect(html).toContain('Squarespace invoice or checkout URL')
    // the same job once staff recorded card money that Squarespace has not confirmed
    const f = port.files.get(id)!
    f.overview.pay = {
      label: 'Payment pending',
      kind: 'pending',
      balanceCents: 0,
      awaitingCents: 16478,
      invoiceNo: 20613,
      status: 'paid',
    }
    f.invoice = {
      ...f.invoice!,
      paidCents: 16478,
      balanceCents: 0,
      awaitingCents: 16478,
      status: 'paid',
      payMethodLabel: 'Card',
    }
    l.qc.removeQueries()
    l.vals()
    await l.settle()
    html = renderToStaticMarkup(render(l.vals(), { name: 'operations' }))
    expect(html).toContain('Payment pending')
    expect(html).toContain('$164.78 recorded by staff · waiting for Squarespace to confirm')
    expect(html).not.toContain('Payment complete')
    expect(html).not.toContain('Mark Paid')
  })

  it('Membership: a member shows credits and Apply credit; a non-member shows the neutral line', async () => {
    const { l } = await open('completed', 'membership')
    let html = renderToStaticMarkup(render(l.vals(), { name: 'operations' }))
    expect(html).toContain('Premium')
    expect(html).toContain(' Member')
    expect(html).toContain('Jul 12, 2026')
    expect(html).toContain('Apply credit')
    const n = await open('nonMember', 'membership')
    html = renderToStaticMarkup(render(n.l.vals(), { name: 'operations' }))
    expect(html).toContain('Not a member yet')
    expect(html).toContain('is not a member yet. Offer a plan at check-out.')
  })

  it('a message from an opted-out customer shows the chip and the blocked placeholder', async () => {
    const port = stubPort()
    const id = (FILES.completed as any).id
    const f = port.files.get(id)!
    f.customer.smsOptedOut = true
    const t = clone(fixtures.thread)
    t.customer = { ...(t.customer as any), optedOut: true, canMessage: false }
    port.threads.set(id, t)
    const l = makeLive(makeSession({ role: 'mgmt' }), port)
    l.vals()
    await l.settle()
    l.logic.select(id, 'messages')
    l.vals()
    await l.settle()
    const html = renderToStaticMarkup(render(l.vals(), { name: 'operations' }))
    expect(html).toContain('SMS opted-out')
    expect(html).toContain('Customer opted out of SMS')
  })

  it('Calendar day, week and month render with every binding', async () => {
    const l = makeLive()
    l.vals()
    await l.settle()
    l.vals().viewTabs[3].onClick()
    for (const m of [0, 1, 2]) {
      l.vals().calModes[m].onClick()
      l.vals()
      await l.settle()
      const vals = l.vals()
      everyBindingExists(vals)
      const html = renderToStaticMarkup(render(vals, { name: 'operations' }))
      expect(html).toContain('June')
    }
  })
})
