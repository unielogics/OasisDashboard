/* eslint-disable @typescript-eslint/no-explicit-any */
// e2e-visits: vehicle sizes on visits, membership coverage and Square payments on the live dashboard (ADR 0170 wave Q2a,
// ADR 0171 wave Q2b; DEVIATIONS DV-801..DV-813) against a live stack on the Q2 backend with Square taking card money
// through the HTTP Square simulator (`pnpm sim:square` of the backend) and the worker running the jobs:
//
//   (cd <backend> && pnpm sim:square --port 4593 --seed none --webhook-url http://127.0.0.1:4081/hooks/square --webhook-key "$K" &)
//   PAYMENT_PROCESSOR=square SQUARE_PROVIDER=live SQUARE_API_BASE=http://127.0.0.1:4593 SQUARE_ACCESS_TOKEN=sim-square-access-token \
//   SQUARE_LOCATION_ID=LSIMOASIS0001 SQUARE_APPLICATION_ID=sim-app SQUARE_WEBHOOK_SIGNATURE_KEY="$K" \
//   SQUARE_WEBHOOK_URL=http://127.0.0.1:4081/hooks/square SQUARE_MATCH_DELAY_SECONDS=0 SQUARE_WRITES_ENABLED=true \
//   pnpm live:up --name qvis --api-port 4081 --web-port 3281 --profile design,website-catalog,pricing-defaults --jobs \
//     --freeze 2026-10-13T10:30:00-04:00 --backend <backend>
//   SQUARE_SIM_URL=http://127.0.0.1:4593 pnpm e2e:visits --name qvis [--only <step text>]
//
// As Management, in the pages: book a guest with a size (the price preview is the server's quote), change the size in the
// file (the invoice is priced again), book a Gold member's larger car (the preview shows what the plan covers), complete
// it (the file and Payments show "Covered $40 · $20 size difference due"), take the difference on the Square reader and
// let a simulated POS payment confirm it, apply a POS payment nobody could match from the "Square payments to match"
// sheet, watch one with the invoice number in its note match itself, and text a Square payment link with Copy. Every
// figure is checked against the API. It fails on any page error, API 5xx or unexpected API 4xx. Screenshots go to
// parity-reports/e2e-visits/ (not committed).
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test'
import { EMAILS, loadStack, login } from './live-e2e'

process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE ??= 'ubuntu24.04-arm64'

const args = process.argv.slice(2)
const stack = loadStack(args.includes('--name') ? args[args.indexOf('--name') + 1]! : 'qvis')
const only = args.includes('--only') ? args[args.indexOf('--only') + 1]! : ''
const SIM = process.env.SQUARE_SIM_URL ?? 'http://127.0.0.1:4593'
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const shots = path.join(root, 'parity-reports', 'e2e-visits')
fs.mkdirSync(shots, { recursive: true })
for (const f of fs.readdirSync(shots)) fs.rmSync(path.join(shots, f))

const results: { step: string; ok: boolean; detail?: string }[] = []
const problems: string[] = []
let expected4xx: RegExp[] = []
let shotNo = 0
let current: Page | null = null
let stepName = ''
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function check(cond: unknown, what: string): void {
  if (!cond) throw new Error(`assertion failed: ${what}`)
}
function eq<T>(actual: T, expected: T, what: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  if (only && !name.includes(only)) return
  stepName = name
  try {
    await fn()
    results.push({ step: name, ok: true })
    console.log(`  ok   ${name}`)
  } catch (e) {
    const detail = (e as Error).message.split('\n').filter((l) => l.trim()).slice(0, 4).join(' | ').slice(0, 500)
    results.push({ step: name, ok: false, detail })
    console.log(`  FAIL ${name}\n       ${detail}`)
    if (current) await shot(current, 'FAILED-' + name.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)).catch(() => {})
  } finally {
    expected4xx = []
  }
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(shots, `${String(++shotNo).padStart(2, '0')}-${name}.png`), fullPage: true })
}

function watch(page: Page, who: string): void {
  page.on('pageerror', (e) => problems.push(`[${who}] page error: ${String(e).slice(0, 300)}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    if (/status of 4\d\d/.test(m.text())) return
    problems.push(`[${who}] console error: ${m.text().slice(0, 300)}`)
  })
  page.on('response', (r) => {
    const url = r.url()
    if (!url.includes('/api/')) return
    const line = `${r.status()} ${r.request().method()} ${url.replace(stack.webUrl, '')}`
    if (r.status() >= 500) problems.push(`[${who}] API 5xx: ${line}`)
    else if (r.status() === 429 && /GET \/api\/v1\/events/.test(line)) return
    else if (r.status() >= 400 && !expected4xx.some((re) => re.test(line)))
      problems.push(`[${who}] unexpected API 4xx during "${stepName}": ${line}`)
  })
}

async function api<T = any>(req: APIRequestContext, p: string): Promise<T> {
  const r = await req.get(`${stack.webUrl}/api/v1${p}`)
  if (!r.ok()) throw new Error(`GET ${p} -> ${r.status()}`)
  return (await r.json()) as T
}

async function write(ctx: BrowserContext, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', p: string, data?: unknown): Promise<any> {
  const csrf = (await api(ctx.request, '/auth/csrf')).csrfToken as string
  const r = await ctx.request.fetch(`${stack.webUrl}/api/v1${p}`, {
    method,
    headers: {
      'X-CSRF-Token': csrf,
      Origin: stack.webUrl,
      'Idempotency-Key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    data: data === undefined ? undefined : JSON.stringify(data),
  })
  if (!r.ok()) throw new Error(`${method} ${p} -> ${r.status()} ${(await r.text()).slice(0, 300)}`)
  return r.status() === 204 ? null : r.json().catch(() => null)
}

/** A control of the Square simulator (never the API: the simulator is Square). */
async function sim(p: string, body: unknown = {}): Promise<any> {
  const r = await fetch(`${SIM}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`simulator ${p} -> ${r.status} ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

async function until<T>(what: string, fn: () => Promise<T | undefined | null | false>, ms = 20_000): Promise<T> {
  const t0 = Date.now()
  let last: unknown
  for (;;) {
    try {
      const v = await fn()
      if (v) return v as T
      last = v
    } catch (e) {
      last = (e as Error).message
    }
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what} (last: ${JSON.stringify(last)?.slice(0, 200)})`)
    await sleep(300)
  }
}

const money = (c: number) => '$' + (c / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const sheet = (page: Page) => page.locator('div[style*="z-index: 70"]').last()
const fileModal = (page: Page) => page.locator('div[style*="z-index: 60"]').first()
const seeText = (page: Page, text: string | RegExp, ms = 10_000) => page.getByText(text).first().waitFor({ timeout: ms })

const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--font-render-hinting=none'] })

async function session(email: string, who: string, next: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 1000 }, timezoneId: 'America/New_York', locale: 'en-US' })
  const page = await ctx.newPage()
  page.setDefaultTimeout(10_000)
  watch(page, who)
  current = page
  await login(page, stack, email, next)
  return { ctx, page }
}

async function openFileOf(page: Page, name: string): Promise<void> {
  await page.goto(`${stack.webUrl}/operations`, { waitUntil: 'load' })
  await page.waitForSelector('#dc-root .sc-host', { timeout: 20_000 })
  await page.locator('#dc-root button', { hasText: name }).first().click()
  await fileModal(page).waitFor()
  await page.waitForFunction((n) => document.querySelector('div[style*="z-index: 60"]')?.textContent?.includes(n), name)
}

async function fileTab(page: Page, label: string): Promise<void> {
  await fileModal(page).locator('button', { hasText: new RegExp('^\\s*' + label) }).first().click()
  await sleep(400)
}

async function openInvoice(page: Page, label: string): Promise<void> {
  await page.goto(`${stack.webUrl}/payments`, { waitUntil: 'load' })
  await page.waitForSelector('#dc-root .sc-host', { timeout: 20_000 })
  await page.locator('#dc-root button', { hasText: label }).first().click()
  await page.waitForFunction((l) => document.querySelector('aside')?.textContent?.includes(l), label)
}

const S: Record<string, any> = {}

try {
  const { ctx: bg } = await session(EMAILS.superAdmin, 'super-background', '/operations')
  const req = bg.request
  const { ctx, page } = await session(EMAILS.manager, 'manager', '/operations')
  void ctx

  await step('setup: a package priced $40 Compact car / $60 Large SUV, Gold covering it, a Gold member at Compact car', async () => {
    // the stack's clock is frozen; Square's (the simulator's) moves to 20 minutes before that instant, so a POS payment and the
    // staff entry it confirms are minutes apart, as at the counter, and no payment is ever "in the future" of the frozen clock
    // (a counter payment waits until the clock passes its matching time)
    if (stack.frozen)
      await sim('/__sim/clock', { advanceMs: Math.max(0, Date.parse(stack.frozen) - 20 * 60_000 - Date.now()) })
    const services = await api(req, '/services')
    const pkg = services.packages[0]
    check(pkg, 'a package to book')
    S.pkg = pkg
    const cat = await api(req, '/catalog')
    const row = cat.prices.find((r: any) => r.serviceId === pkg.id)
    const cells = new Map<string, any>((row?.cells ?? []).map((c: any) => [c.class, { class: c.class, cents: c.cents, maxCents: c.maxCents }]))
    cells.set('compact_car', { class: 'compact_car', cents: 4000, maxCents: null })
    cells.set('large_suv', { class: 'large_suv', cents: 6000, maxCents: null })
    await write(bg, 'PUT', '/catalog/prices', { rows: [{ serviceId: pkg.id, version: row.version, cells: [...cells.values()] }] })
    const tiers = (await api(req, '/catalog/tiers')).tiers
    const gold = tiers.find((t: any) => t.key === 'gold')
    check(gold, 'the Gold tier')
    const covers = gold.inclusions.some((i: any) => i.active && i.serviceIds.includes(pkg.id))
    if (!covers) {
      await write(bg, 'PUT', '/catalog/tiers/gold', {
        name: gold.name,
        colour: gold.colour,
        sort: gold.sort,
        active: gold.active,
        public: gold.public,
        vipBooking: gold.vipBooking,
        memberDiscountBp: gold.memberDiscountBp,
        maxVehicles: gold.maxVehicles,
        perks: gold.perks,
        checkoutUrl: gold.checkoutUrl,
        inclusions: [
          ...gold.inclusions.map((i: any) => ({ id: i.id, label: i.label, mode: i.mode, perCycle: i.perCycle, autoApply: i.autoApply, active: i.active, serviceIds: i.serviceIds })),
          { label: pkg.name, mode: 'per_cycle', perCycle: 2, autoApply: true, active: true, serviceIds: [pkg.id] },
        ],
        version: gold.version,
      })
    }
    const member = await write(bg, 'POST', '/customers', { name: 'Gwen Sizewell', phone: '(201) 555-0190', smsOptIn: false, vehicle: { year: 2022, make: 'Chevrolet', model: 'Tahoe' } })
    S.memberId = member.customer?.id ?? member.id
    check(S.memberId, 'the member was created')
    const m = await write(bg, 'POST', '/memberships', { customerId: S.memberId, planKey: 'gold', planClass: 'compact_car' })
    eq(m.membership?.planClass ?? m.planClass, 'compact_car', 'the plan size')
  })

  await step('booking sheet: a guest with Large SUV; the preview is the server quote; booked with the size', async () => {
    await page.goto(`${stack.webUrl}/operations`, { waitUntil: 'load' })
    await page.waitForSelector('#dc-root .sc-host', { timeout: 20_000 })
    await page.locator('#dc-root button', { hasText: 'New Appointment' }).first().click()
    await page.waitForSelector('input[placeholder="Full name"]')
    await page.fill('input[placeholder="Full name"]', 'Sam Sizeguest')
    await page.fill('input[placeholder="Phone number"]', '(201) 555-0191')
    await page.fill('input[placeholder="Year / Make / Model"]', '2021 Ford Expedition')
    await sheet(page).locator('button', { hasText: S.pkg.name }).first().click()
    await sheet(page).getByRole('button', { name: 'Large SUV', exact: true }).click()
    await seeText(page, 'Price · Large SUV')
    const q = await write(bg, 'POST', '/appointments/quote', { serviceId: S.pkg.id, vehicleClass: 'large_suv' })
    eq(q.pricing.totals.dueCents, 6000, 'the quote for a Large SUV')
    await seeText(page, /^\$60$/)
    await shot(page, 'sheet-large-suv')
    const date = (await api(req, '/ops/snapshot?window=today')).now.bizDate
    const av = await api(req, `/availability?date=${date}&serviceId=${S.pkg.id}&channel=desk`)
    const slot = av.slots.find((s: any) => s.state === 'available')
    check(slot, 'an open slot today')
    await sheet(page).locator('button', { hasText: new RegExp('^' + slot.time + '$') }).first().click()
    await sheet(page).locator('button', { hasText: 'Book Appointment' }).click()
    await seeText(page, 'Appointment booked')
    const card = await until('the guest card', async () => {
      const s = await api(req, '/ops/snapshot?window=today')
      return s.timeline.groups.flatMap((g: any) => g.items).find((c: any) => c.customer.name === 'Sam Sizeguest')
    })
    S.guestAppt = card.id
    const f = await api(req, `/appointments/${card.id}`)
    eq([f.vehicleClass, f.vehicleClassLabel, f.needsSizeConfirm], ['large_suv', 'Large SUV', false], 'the visit size')
    eq(f.invoice.items[0].listCents, 6000, 'the line at the Large SUV price')
    eq(f.invoice.items[0].classLabel, 'Large SUV', 'the line size')
    S.guestInvoice = f.invoice.invoiceId
    S.guestLabel = 'INV-' + String(f.invoice.invoiceNo).padStart(5, '0')
  })

  await step('file: Change size to Compact car prices the visit again', async () => {
    await openFileOf(page, 'Sam Sizeguest')
    await seeText(page, 'Large SUV')
    await fileModal(page).getByRole('button', { name: 'Change size', exact: true }).click()
    await fileModal(page).getByRole('button', { name: 'Compact car', exact: true }).first().click()
    await seeText(page, /Compact car/)
    const f = await until('the repriced visit', async () => {
      const x = await api(req, `/appointments/${S.guestAppt}`)
      return x.vehicleClass === 'compact_car' ? x : null
    })
    eq(f.invoice.items[0].priceCents, 4000, 'the line at the Compact car price')
    eq(f.vehicle.vehicleClass, 'compact_car', 'the car keeps the size')
    await shot(page, 'file-size-changed')
  })

  await step('booking sheet: the Gold member’s Large SUV shows what the plan covers; completed, the coverage line', async () => {
    await page.goto(`${stack.webUrl}/operations`, { waitUntil: 'load' })
    await page.waitForSelector('#dc-root .sc-host', { timeout: 20_000 })
    await page.locator('#dc-root button', { hasText: 'New Appointment' }).first().click()
    await page.waitForSelector('input[placeholder="Full name"]')
    await page.fill('input[placeholder="Full name"]', 'Gwen Size')
    await sheet(page).locator('button', { hasText: 'Gwen Sizewell' }).first().click()
    await sheet(page).locator('button', { hasText: S.pkg.name }).first().click()
    await sheet(page).getByRole('button', { name: 'Large SUV', exact: true }).click()
    await seeText(page, 'Included · $20 size difference due')
    await seeText(page, 'Gold member · Compact car plan')
    await shot(page, 'sheet-member')
    const date = (await api(req, '/ops/snapshot?window=today')).now.bizDate
    const av = await api(req, `/availability?date=${date}&serviceId=${S.pkg.id}&channel=desk&customerId=${S.memberId}`)
    const slot = av.slots.filter((s: any) => s.state === 'available').at(-1)
    check(slot, 'an open slot today for the member')
    await sheet(page).locator('button', { hasText: new RegExp('^' + slot.time + '$') }).first().click()
    await sheet(page).locator('button', { hasText: 'Book Appointment' }).click()
    await seeText(page, 'Appointment booked')
    const card = await until('the member card', async () => {
      const s = await api(req, '/ops/snapshot?window=today')
      return s.timeline.groups.flatMap((g: any) => g.items).find((c: any) => c.customer.name === 'Gwen Sizewell')
    })
    S.memberAppt = card.id
    // the job through the shop to completed (completion settles the membership's coverage)
    for (const status of ['booked', 'confirmed', 'arrived', 'cleaning']) {
      const cur = await api(req, `/appointments/${card.id}`)
      if (cur.status !== status) continue
      await write(bg, 'POST', `/appointments/${card.id}/advance`, { expectedStatus: status })
    }
    const f = await until('the completed, covered visit', async () => {
      const x = await api(req, `/appointments/${card.id}`)
      return x.status === 'completed' && x.invoice?.coverage?.length ? x : null
    })
    eq(
      [f.invoice.coverage[0].coveredCents, f.invoice.coverage[0].differenceCents, f.invoice.coverage[0].planClassLabel],
      [4000, 2000, 'Compact car'],
      'covered up to the Compact car price',
    )
    S.memberInvoice = f.invoice.invoiceId
    S.memberLabel = 'INV-' + String(f.invoice.invoiceNo).padStart(5, '0')
    S.memberBalance = f.invoice.balanceCents
    check(S.memberBalance > 0, 'the size difference is due')
    await openFileOf(page, 'Gwen Sizewell')
    await seeText(page, 'Covered $40 · $20 size difference due (Compact car plan)')
    await fileTab(page, 'Payments')
    await seeText(page, 'Membership · Covered $40 · $20 size difference due')
    await shot(page, 'file-coverage')
  })

  await step('Payments: the member invoice names the size and the coverage; Square reader leaves it Awaiting Square', async () => {
    const d = await api(req, `/invoices/${S.memberInvoice}`)
    eq(d.processing?.processor, 'square', 'the server says Square takes card money')
    await openInvoice(page, S.memberLabel)
    await seeText(page, S.pkg.name + ' · Large SUV')
    await seeText(page, /^Covered \$40 · \$20 size difference due$/)
    await page.locator('aside button', { hasText: 'Collect ' + money(S.memberBalance) }).first().click()
    await sheet(page).getByRole('button', { name: 'Square reader', exact: true }).waitFor()
    await sheet(page).getByRole('button', { name: 'Charge ' + money(S.memberBalance) + ' on the reader', exact: true }).click()
    await seeText(page, 'Awaiting Square · ' + money(S.memberBalance) + ' on the reader')
    await seeText(page, 'Match a Square payment')
    await shot(page, 'payments-awaiting-square')
    const after = await api(req, `/invoices/${S.memberInvoice}`)
    const e = after.ledger.find((x: any) => x.type === 'pay' && x.awaitingProcessor)
    check(e, 'the staff card entry waits on Square')
    S.readerEntry = e.id
  })

  await step('Square POS payment of that amount confirms the reader entry by itself (R3)', async () => {
    await sim('/__sim/pos/payment', { amountCents: S.memberBalance, sourceType: 'CARD' })
    const d = await until('the confirmed reader entry', async () => {
      const x = await api(req, `/invoices/${S.memberInvoice}`)
      const e = x.ledger.find((y: any) => y.id === S.readerEntry)
      return e && e.processorState === 'confirmed' && e.processor === 'square' ? x : null
    }, 40_000)
    eq(d.calc.balance, 0, 'nothing left to pay')
    await openInvoice(page, S.memberLabel)
    await seeText(page, /· Square$/)
    await shot(page, 'payments-square-confirmed')
  })

  await step('a POS payment nobody could match lands in the queue and is applied to the invoice open on screen', async () => {
    await sim('/__sim/pos/payment', { amountCents: 1337, sourceType: 'CARD' })
    const item = await until('the unmatched payment', async () => {
      const q = await api(req, '/payments/square/unmatched')
      return q.items.find((p: any) => p.amountCents === 1337 && p.matchState === 'unmatched')
    }, 40_000)
    await openInvoice(page, S.guestLabel)
    await seeText(page, /Square payments? to match/)
    await page.getByRole('button', { name: 'Match', exact: true }).click()
    await seeText(page, '$13.37 · ' + item.method)
    await shot(page, 'queue-sheet')
    await page.locator('div', { hasText: S.guestLabel + ' · Sam Sizeguest (open on screen)' }).locator('button', { hasText: 'Apply' }).last().click()
    await seeText(page, 'Recorded on ' + S.guestLabel + ' · $13.37')
    const d = await until('the payment on the guest invoice', async () => {
      const x = await api(req, `/invoices/${S.guestInvoice}`)
      return x.ledger.some((e: any) => e.type === 'pay' && e.processor === 'square' && e.amountCents === 1337) ? x : null
    })
    S.guestBalance = d.calc.balance
    const q = await api(req, '/payments/square/unmatched')
    check(!q.items.some((p: any) => p.paymentId === item.paymentId), 'it left the queue')
  })

  await step('a POS payment with the invoice number in its note matches itself (R1)', async () => {
    await sim('/__sim/pos/payment', { amountCents: S.guestBalance, sourceType: 'CARD', note: S.guestLabel })
    const d = await until('the guest invoice paid', async () => {
      const x = await api(req, `/invoices/${S.guestInvoice}`)
      return x.calc.balance === 0 ? x : null
    }, 40_000)
    check(d.ledger.filter((e: any) => e.type === 'pay' && e.processor === 'square').length === 2, 'two Square payments on it')
  })

  await step('Payment link with Square: no URL box; the Square link the server made shows with Copy', async () => {
    const date = (await api(req, '/ops/snapshot?window=today')).now.bizDate
    const av = await api(req, `/availability?date=${date}&serviceId=${S.pkg.id}&channel=desk`)
    const slot = av.slots.find((s: any) => s.state === 'available')
    check(slot, 'an open slot for a third visit')
    const b = await write(bg, 'POST', '/appointments', {
      customer: { name: 'Lia Linkpay', phone: '(201) 555-0192', smsOptIn: false },
      serviceId: S.pkg.id,
      vehicleClass: 'large_suv',
      start: slot.start,
    })
    const label = 'INV-' + String(b.invoice.invoiceNo).padStart(5, '0')
    await openInvoice(page, label)
    await page.locator('aside button', { hasText: /^Collect / }).first().click()
    await sheet(page).getByRole('button', { name: 'Payment link', exact: true }).click()
    check((await page.locator('input[placeholder="https://"]').count()) === 0, 'no URL box')
    await sheet(page).getByRole('button', { name: /^Text link · / }).click()
    await seeText(page, 'Copy link')
    const url = await sheet(page).locator('div[style*="user-select"]').first().textContent()
    check(/^https?:\/\//.test(url ?? ''), 'the link is shown: ' + url)
    await shot(page, 'collect-square-link')
    await sheet(page).getByRole('button', { name: 'Done', exact: true }).click()
  })
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\ne2e-visits: ${results.length - failed.length}/${results.length} steps ok, ${problems.length} problems`)
for (const p of problems) console.log('  PROBLEM ' + p)
process.exit(failed.length || problems.length ? 1 : 0)
