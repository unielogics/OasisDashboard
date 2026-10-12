// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// Vehicle sizes, coverage, households and Square on the live Operations screen (ADR 0170/0171; DV-807..DV-813), on the
// captured responses plus sized ones: what the sheet and the file show, what each control sends, what the server's refusal
// looks like, and the live template rendering the new parts.
import fs from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/data/http/problem'
import type { AppointmentFile, MembershipView } from '@/data/ports/operations'
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

/** The late file as a visit priced by size: no size known yet, a Gold member's coverage on its invoice. */
function sizedFile(over: Record<string, unknown> = {}): AppointmentFile {
  const f = clone(FILES.late) as any
  f.priceBasis = 'unknown_class'
  f.vehicleClass = null
  f.vehicleClassLabel = null
  f.needsSizeConfirm = true
  f.needsPriceConfirm = false
  f.classConfirmedAt = null
  f.vehicle = { ...f.vehicle, vehicleClass: null, vehicleClassSource: null }
  f.version = 7
  Object.assign(f, over)
  return f as AppointmentFile
}

async function boot(port: StubPort = stubPort(), role: Parameters<typeof makeSession>[0] = { role: 'mgmt' }) {
  const payments = stubPayments()
  const l = makeLive(makeSession(role), port, payments)
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

let render: (vals: any, ctx: { name: string }) => any
const tmp = path.join(root, 'tools/dc-compile/tests/.tmp-snippets/operations-live-sizes')
const text = (v: string | Buffer | undefined): string => (Buffer.isBuffer(v) ? v.toString('utf8') : (v ?? ''))
beforeAll(async () => {
  const out = compileScreens(['operations'], { root, variant: 'live', tplIds: false, allowComplexExpr: false })
  const dir = path.join(tmp, 'gen')
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, buf] of Object.entries(out.perScreen.operations!)) fs.writeFileSync(path.join(dir, name), text(buf))
  render = (await import(/* @vite-ignore */ path.join(dir, 'operations.tsx'))).default
})
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))
const html = (l: Live) => renderToStaticMarkup(render(l.vals(), { name: 'operations' }))

describe('the booking sheet: sizes and the price (DV-807)', () => {
  async function sheet(port = stubPort()) {
    const l = await boot(port)
    l.vals().openNew()
    for (let i = 0; i < 3; i++) {
      l.vals()
      await flushed(l)
    }
    return l
  }

  it('offers the sizes that are on and "Not sure"; the preview is the server quote for the picked size', async () => {
    const l = await sheet()
    let v = l.vals()
    expect(v.nf.hasSizes).toBe(true)
    expect(v.nf.sizes.map((c: any) => c.label)).toEqual([
      'Compact car',
      'Large car',
      'Compact SUV',
      'Large SUV',
      'Truck',
      'Not sure',
    ])
    expect(v.nf.sizes.find((c: any) => c.on).label).toBe('Not sure')
    expect(v.nf.hasQuote).toBe(true)
    expect(v.nf.quoteTitle).toBe('Price')
    expect(v.nf.quoteNote).toBe('Size not set: starting price. Confirm the size at the shop.')
    v.nf.sizes.find((c: any) => c.label === 'Large SUV').pick()
    for (let i = 0; i < 2; i++) {
      l.vals()
      await flushed(l)
    }
    v = l.vals()
    expect(v.nf.quoteTitle).toBe('Price · Large SUV')
    expect(v.nf.quoteTotal).toBe('$70')
    const q = calls(l, 'quote').at(-1)![1] as any
    expect(q.vehicleClass).toBe('large_suv')
    const page = html(l)
    expect(page).toContain('Large SUV')
    expect(page).toContain('Price · Large SUV')
  })

  it('books with the size; a picked customer’s car goes by id with its size on file preselected', async () => {
    const port = stubPort()
    const hits = clone(fixtures.customers) as any
    hits.items[0].vehicles[0].vehicleClass = 'compact_suv'
    hits.items[0].vehicles[0].vehicleClassSource = 'client'
    port.customers = (async (...a: unknown[]) => {
      port.calls.push(['customers', ...a])
      return clone(hits)
    }) as any
    const l = await sheet(port)
    l.vals().nf.setName({ target: { value: 'Priya' } })
    for (let i = 0; i < 4; i++) {
      l.vals()
      await vi.advanceTimersByTimeAsync(250)
      await flushed(l)
    }
    l.vals().nf.hits[0].pick()
    l.vals()
    await flushed(l)
    let v = l.vals()
    expect(v.nf.sizes.find((c: any) => c.on).label).toBe('Compact SUV')
    v.newSlots.find((s: any) => s.label === '2:30 PM').pick()
    l.vals().createAppt()
    await flushed(l)
    const body = calls(l, 'book')[0]![1] as any
    expect(body.customer).toEqual({ id: hits.items[0].id })
    expect(body.vehicleId).toBe(hits.items[0].vehicles[0].id)
    expect(body.vehicle).toBeUndefined()
    expect(body.vehicleClass).toBe('compact_suv')
    // typing another car drops the id: the typed car is sent
    l.vals().openNew()
    v = l.vals()
    expect(v.nf.vehicle).toBe('')
  })

  it('a role without sched.edit gets no preview request', async () => {
    const l = await boot(stubPort(), { role: 'crew' })
    l.vals().openNew()
    l.vals()
    await flushed(l)
    expect(calls(l, 'quote')).toHaveLength(0)
  })
})

describe('the appointment file: size, coverage, household, Square (DV-808..DV-813)', () => {
  it('a visit booked before sizes looks as designed: no size row, no badge', async () => {
    const l = await boot()
    const v = await openFile(l, (FILES.late as any).id)
    expect(v.sel.sizeShow).toBe(false)
    expect(v.sel.sizeBadgeShow).toBe(false)
    expect(v.sel.covShow).toBe(false)
    expect(html(l)).not.toContain('Confirm size')
  })

  it('"Confirm size" until the size is set; Change size sends the size with the file version', async () => {
    const port = stubPort()
    const f = sizedFile()
    port.files.set(f.id, f)
    const l = await boot(port)
    let v = await openFile(l, f.id)
    expect(v.sel.sizeShow).toBe(true)
    expect(v.sel.sizeText).toBe('Not set · priced at the starting price')
    expect(v.sel.sizeBadge).toBe('Confirm size')
    expect(v.sel.carText).toBe('This car has no size on file')
    expect(v.sel.sizeToggleLabel).toBe('Set size')
    const page = html(l)
    expect(page).toContain('Confirm size')
    expect(page).toContain('Not set · priced at the starting price')
    v.sel.sizeToggle()
    v = l.vals()
    expect(v.sel.sizeOpen).toBe(true)
    expect(v.sel.sizeChips.map((c: any) => c.label)).toEqual(['Compact car', 'Large car', 'Compact SUV', 'Large SUV', 'Truck'])
    v.sel.sizeChips.find((c: any) => c.label === 'Large SUV').pick()
    await flushed(l)
    const c = calls(l, 'setVisitSize')[0]!
    expect(c.slice(1, 4)).toEqual([f.id, 'large_suv', 7])
    expect((c[4] as any).idempotencyKey).toBeTruthy()
    v = l.vals()
    expect(v.sel.sizeOpen).toBe(false)
    expect(v.toastTitle).toBe('Size set')
  })

  it('a change that would overpay is refused with the server’s words and the chips stay open', async () => {
    const port = stubPort()
    const f = sizedFile({ vehicleClass: 'large_suv', vehicleClassLabel: 'Large SUV', needsSizeConfirm: false, priceBasis: 'class' })
    port.files.set(f.id, f)
    port.fail.set(
      'setVisitSize',
      new ApiError({
        status: 409,
        code: 'PRICE_CHANGE_OVERPAID',
        title: 'This change would leave the invoice overpaid',
        detail: 'Refund or adjust the invoice first.',
      }),
    )
    const l = await boot(port)
    let v = await openFile(l, f.id)
    expect(v.sel.sizeToggleLabel).toBe('Change size')
    v.sel.sizeToggle()
    l.vals().sel.sizeChips.find((c: any) => c.label === 'Compact car').pick()
    await flushed(l)
    v = l.vals()
    expect(v.toastTitle).toBe('This change would leave the invoice overpaid')
    expect(v.toastDesc).toBe('Refund or adjust the invoice first.')
    expect(v.sel.sizeOpen).toBe(true)
  })

  it('the car’s size alone (cli.edit), and nothing without the permission', async () => {
    const port = stubPort()
    const f = sizedFile()
    port.files.set(f.id, f)
    const l = await boot(port)
    const v = await openFile(l, f.id)
    v.sel.carToggle()
    l.vals().sel.carChips.find((c: any) => c.label === 'Truck').pick()
    await flushed(l)
    expect(calls(l, 'setVehicleSize')[0]!.slice(1, 4)).toEqual([f.customer.id, f.vehicle!.id, 'truck'])
    expect(l.vals().toastTitle).toBe('Car size saved')
    const crew = await boot(port, { role: 'crew' })
    const cv = await openFile(crew, f.id)
    cv.sel.carToggle()
    expect(crew.vals().sel.carOpen).toBe(false)
    expect(crew.vals().toastTitle).toMatch(/^Your role can’t/)
    cv.sel.sizeToggle()
    expect(crew.vals().sel.sizeOpen).toBe(false)
  })

  it('coverage and size on the lines; the Payments tab with Square says Square reader and Awaiting Square', async () => {
    const port = stubPort()
    const f = sizedFile({ vehicleClass: 'large_suv', vehicleClassLabel: 'Large SUV', needsSizeConfirm: false, priceBasis: 'class' }) as any
    f.invoice = {
      ...f.invoice,
      items: [{ name: 'Signature Hand Wash', priceCents: 6000, kind: 'package', listCents: 6000, discountBp: 0, classLabel: 'Large SUV' }],
      coverage: [{ serviceName: 'Signature Hand Wash', coveredCents: 4000, lineCents: 6000, differenceCents: 2000, planClassLabel: 'Compact car' }],
    }
    port.files.set(f.id, f)
    const payments = stubPayments()
    ;(payments as any).invoice = async (id: string) => {
      payments.calls.push(['invoice', id])
      return { id, ledger: [], processing: { processor: 'square', squarePosAppSwitch: false } }
    }
    const l = makeLive(makeSession({ role: 'mgmt' }), port, payments)
    l.vals()
    await l.settle()
    let v = await openFile(l, f.id)
    expect(v.sel.covShow).toBe(true)
    expect(v.sel.covLines[0].text).toBe('Signature Hand Wash · Covered $40 · $20 size difference due (Compact car plan)')
    expect(html(l)).toContain('Membership coverage')
    v = await openFile(l, f.id, 'payments')
    expect(v.sel.payRows.map((r: any) => r.label).slice(0, 2)).toEqual([
      'Signature Hand Wash · Large SUV',
      'Membership · Covered $40 · $20 size difference due',
    ])
    expect(v.sel.payTenders.map((t: any) => t.label)).toEqual(['Square reader', 'Cash'])
    expect(v.sel.payLinkSquare).toBe(true)
    // Send payment link with Square: no URL box, the server makes the link
    v.sel.sendLink()
    v = l.vals()
    expect(v.sel.payLinkOpen).toBe(true)
    expect(v.sel.payLinkNeedsUrl).toBe(false)
    expect(html(l)).not.toContain('Squarespace invoice or checkout URL')
    v.sel.submitLink()
    await flushed(l)
    expect(payCalls(l, 'collect')[0]![2]).toEqual({ method: 'payment_link' })
  })

  it('the Membership tab: plan size and household; add and remove go to the server', async () => {
    const port = stubPort()
    const f = clone(FILES.cleaning) as any
    const mem = clone(fixtures.membershipMember) as any
    mem.membership.planClass = 'compact_car'
    mem.membership.planClassLabel = 'Compact car'
    mem.membership.household = [{ customerId: 'c-ana', name: 'Ana Alvarez', addedAt: '2026-06-01T00:00:00Z' }]
    port.memberships.set(f.customer.id, mem as MembershipView)
    const l = await boot(port)
    let v = await openFile(l, f.id, 'membership')
    expect(v.sel.hhShow).toBe(true)
    expect(v.sel.hhPlanSize).toBe('Compact car · a larger car pays the size difference at the shop')
    expect(v.sel.hhMembers.map((m: any) => m.name)).toEqual(['Ana Alvarez'])
    const page = html(l)
    expect(page).toContain('Plan size')
    expect(page).toContain('Ana Alvarez')
    v.sel.hhMembers[0].remove()
    await flushed(l)
    expect(calls(l, 'removeHousehold')[0]!.slice(1, 3)).toEqual([mem.membership.id, 'c-ana'])
    v = l.vals()
    v.sel.setHhQuery({ target: { value: 'Priya' } })
    for (let i = 0; i < 3; i++) {
      l.vals()
      await flushed(l)
    }
    v = l.vals()
    expect(v.sel.hhHasHits).toBe(true)
    v.sel.hhHits[0].add()
    await flushed(l)
    expect(calls(l, 'addHousehold')[0]!.slice(1, 3)).toEqual([mem.membership.id, fixtures.customers.items[0]!.id])
    expect(l.vals().toastTitle).toBe('Added to the membership')
  })

  it('the file’s member badge takes the tier colours the server sends', async () => {
    const port = stubPort()
    const f = clone(FILES.cleaning) as any
    f.membership = { ...f.membership, color: '#123456', bgColor: '#ABCDEF' }
    port.files.set(f.id, f)
    const l = await boot(port)
    const v = await openFile(l, f.id)
    expect(v.sel.memberStyle.color).toBe('#123456')
    expect(v.sel.memberStyle.background).toBe('#ABCDEF')
  })
})
