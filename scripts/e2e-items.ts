/* eslint-disable @typescript-eslint/no-explicit-any */
// e2e-items: the sales tax rate and the Square item library on the live dashboard (ADR 0172, ADR 0173; DEVIATIONS DV-213,
// DV-911..DV-914) against a live stack in the item library's rollout state (Square writes and the item sync on, Squarespace
// still the processor) talking to the backend's HTTP Square simulator: scripts/e2e-items-stack.sh starts all of it, runs this
// and tears it down.
//
// As the Super Admin, in the pages: Settings → Billing & integrations → Sales tax refuses "6.6255" before sending and saves
// 6.625%; Square item library → Sync now makes Oasis's items and its "Sales tax" in Square (read back from the simulator) and
// the block shows the server's counts and tax check; Prices by size shows a dot per price Square has, a price edit waits for
// Square and the next Sync now changes the same Square variation in place; with the rollout's rounding (half to even, set
// through the API as the orchestrator will) the Billing block says so by itself (event stream), a visit's invoice reads
// "Tax (6.625%)" in Payments and in the operations file, the Adjust sheet previews the new total exactly as the server then
// computes it on a half-cent subtotal ($4 + $8k), and the cents twin equals the server's calc on both invoices (half up and
// half to even). Fails on any page error, API 5xx or unexpected API 4xx. Screenshots go to parity-reports/e2e-items/.
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test'
import { calcCents, money, salesTaxCents, taxPercentLabel } from '../src/lib/payments/cents'
import { countsText, taxLine } from '../src/lib/settings/square-items'
import { EMAILS, loadStack, login } from './live-e2e'

process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE ??= 'ubuntu24.04-arm64'

const args = process.argv.slice(2)
const stackName = args.includes('--name') ? args[args.indexOf('--name') + 1]! : 'qitems'
const stack = loadStack(stackName) as ReturnType<typeof loadStack> & { backend: string }
const SIM = process.env.SQUARE_SIM_URL ?? 'http://127.0.0.1:4595'
const SIM_TOKEN = 'sim-square-access-token'
/** The server's 422 text on a rate it refuses (api-spec 30.15), which the form says before sending. */
const SALES_TAX_FORMAT = 'Use a percentage from 0 to 100 with up to three decimals, such as 6.625'
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const shots = path.join(root, 'parity-reports', 'e2e-items')
fs.mkdirSync(shots, { recursive: true })
for (const f of fs.readdirSync(shots)) fs.rmSync(path.join(shots, f))

const results: { step: string; ok: boolean; detail?: string }[] = []
const problems: string[] = []
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
  stepName = name
  try {
    await fn()
    results.push({ step: name, ok: true })
    console.log(`  ok   ${name}`)
  } catch (e) {
    const detail = (e as Error).message
      .split('\n')
      .filter((l) => l.trim())
      .slice(0, 4)
      .join(' | ')
      .slice(0, 500)
    results.push({ step: name, ok: false, detail })
    console.log(`  FAIL ${name}\n       ${detail}`)
    if (current)
      await shot(current, 'FAILED-' + name.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)).catch(() => {})
  }
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({
    path: path.join(shots, `${String(++shotNo).padStart(2, '0')}-${name}.png`),
    fullPage: true,
  })
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
    else if (r.status() >= 400) {
      const during = stepName
      void r
        .text()
        .catch(() => '')
        .then((body) =>
          problems.push(
            `[${who}] unexpected API 4xx during "${during}": ${line} ${body.replace(/\s+/g, ' ').slice(0, 300)}`,
          ),
        )
    }
  })
}

async function api<T = any>(req: APIRequestContext, p: string): Promise<T> {
  const r = await req.get(`${stack.webUrl}/api/v1${p}`)
  if (!r.ok()) throw new Error(`GET ${p} -> ${r.status()}`)
  return (await r.json()) as T
}

async function write(
  ctx: BrowserContext,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  p: string,
  data?: unknown,
): Promise<any> {
  const csrf = (await api(ctx.request, '/auth/csrf')).csrfToken as string
  const r = await ctx.request.fetch(`${stack.webUrl}/api/v1${p}`, {
    method,
    headers: {
      'X-CSRF-Token': csrf,
      Origin: stack.webUrl,
      'Idempotency-Key': `e2e-${crypto.randomUUID()}`,
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    data: data === undefined ? undefined : JSON.stringify(data),
  })
  if (!r.ok()) throw new Error(`${method} ${p} -> ${r.status()} ${(await r.text()).slice(0, 300)}`)
  return r.status() === 204 ? null : r.json().catch(() => null)
}

/** Square's catalog as the simulator holds it (SearchCatalogObjects, every page): what the POS would show. */
async function squareObjects(types: string[]): Promise<any[]> {
  const out: any[] = []
  let cursor: string | undefined
  for (let i = 0; i < 50; i++) {
    const r = await fetch(`${SIM}/v2/catalog/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${SIM_TOKEN}` },
      body: JSON.stringify({ object_types: types, ...(cursor ? { cursor } : {}) }),
    })
    if (!r.ok) throw new Error(`simulator catalog search -> ${r.status} ${(await r.text()).slice(0, 200)}`)
    const b = (await r.json()) as { objects?: any[]; cursor?: string }
    out.push(...(b.objects ?? []))
    cursor = b.cursor
    if (!cursor) break
  }
  return out
}
const oasisItems = async () =>
  (await squareObjects(['ITEM'])).filter(
    (o) =>
      !o.is_deleted &&
      (o.item_data?.variations ?? []).some((v: any) => /^oasis:v1:/.test(v.item_variation_data?.user_data ?? '')),
  )
const variationOf = (items: any[], marker: string): any =>
  items
    .flatMap((o) => o.item_data?.variations ?? [])
    .find((v: any) => v.item_variation_data?.user_data === marker)

async function until<T>(
  what: string,
  fn: () => Promise<T | undefined | null | false>,
  ms = 30_000,
): Promise<T> {
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
    if (Date.now() - t0 > ms)
      throw new Error(`timed out waiting for ${what} (last: ${JSON.stringify(last)?.slice(0, 200)})`)
    await sleep(400)
  }
}

const seeText = (page: Page, text: string | RegExp, ms = 15_000) =>
  page.getByText(text).first().waitFor({ timeout: ms })
const fileModal = (page: Page) => page.locator('div[style*="z-index: 60"]').first()
const sheet = (page: Page) => page.locator('div[style*="z-index: 70"]').first()

// the stack's database (a test hook: the visits are moved to today so Payments and the board list them)
const envOf = (file: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]!] = m[2]!.replace(/^['"]|['"]$/g, '')
  }
  return out
}
const dbUrl = envOf(path.join(stack.backend, '.env')).DATABASE_URL!
function psql(sql: string): string {
  return execFileSync('psql', [dbUrl, '-Atq', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    input: `set search_path = ${stack.schema}, public;\n` + sql,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}

/** The cents twin of an invoice as GET /invoices/:id sends it, with the invoice's own rate and rounding. */
function twinOf(d: any) {
  return calcCents({
    itemPrices: d.items.map((i: any) => i.priceCents),
    events: d.ledger.map((e: any) => ({
      type: e.type,
      amountCents: e.amountCents,
      status: e.type === 'refund' ? e.status : undefined,
      dest: e.dest,
      processorState: e.processorState,
    })),
    taxDbp: d.taxDbp,
    taxRounding: d.taxRounding,
    tipCents: d.tipCents,
    canceled: d.canceled,
  })
}
function sameAsServer(d: any, what: string): void {
  const twin = twinOf(d)
  const bad = Object.entries(twin).filter(([k, v]) => d.calc[k] !== v)
  eq(
    bad.map(([k, v]) => `${k}: twin ${v} server ${d.calc[k]}`),
    [],
    `${what}: the cents twin equals the server's calc`,
  )
}

// ---- the browser ---------------------------------------------------------------------------------------------------------

const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--font-render-hinting=none'] })
const ctx = await browser.newContext({
  viewport: { width: 1480, height: 1000 },
  timezoneId: 'America/New_York',
  locale: 'en-US',
})
const page = await ctx.newPage()
page.setDefaultTimeout(15_000)
watch(page, 'super')
current = page
const req = ctx.request
const NAMES = { a: 'Hana Halfup', b: 'Eve Evenson' }
const PHONES = { a: '(201) 555-0191', b: '(201) 555-0192' }
const S: Record<string, any> = {}

async function tab(label: string): Promise<void> {
  await page
    .locator('#dc-root button', { hasText: new RegExp('^' + label + '$') })
    .first()
    .click()
}

/** A client with a visit at the first open time (desk booking), moved to today; returns the invoice. */
async function visitFor(k: 'a' | 'b'): Promise<any> {
  const services = await api(req, '/services')
  const pkg = services.packages.find((p: any) => !p.quoteOnly) ?? services.packages[0]
  const c = await write(ctx, 'POST', '/customers', {
    name: NAMES[k],
    phone: PHONES[k],
    smsOptIn: true,
    vehicle: { year: 2022, make: 'Honda', model: 'Civic' },
  })
  const customerId = c.customer?.id ?? c.id
  let booked: any = null
  for (let d = 0; d < 7 && !booked; d++) {
    const snap = await api(req, '/ops/snapshot?window=today')
    const date = new Date(Date.parse(snap.now.bizDate + 'T12:00:00Z') + d * 86_400_000).toISOString().slice(0, 10)
    const av = await api(req, `/availability?date=${date}&serviceId=${pkg.id}&channel=desk&customerId=${customerId}`)
    const slot = av.slots.find((s: any) => s.state === 'available')
    if (slot)
      booked = await write(ctx, 'POST', '/appointments', {
        customer: { id: customerId },
        serviceId: pkg.id,
        source: 'dashboard',
        start: slot.start,
        vehicleClass: 'compact_car',
      })
  }
  check(booked?.invoice?.invoiceId, `a visit with an invoice for ${NAMES[k]}`)
  const tz = 'America/New_York'
  const mins = k === 'a' ? 60 : 30
  psql(`
    with t as (
      select greatest(now() - interval '${mins} minutes',
                      (date_trunc('day', now() at time zone '${tz}') at time zone '${tz}') + interval '${150 - mins} seconds') as s)
    update appointments a set scheduled_start = t.s, scheduled_end = t.s + interval '30 minutes' from t where a.id = '${booked.appointment.id}';
    update invoices i set occurred_at = a.scheduled_start, biz_date = (a.scheduled_start at time zone '${tz}')::date
      from appointments a where a.id = '${booked.appointment.id}' and i.appointment_id = a.id;`)
  return { appt: booked.appointment.id, invoice: booked.invoice.invoiceId }
}

async function openInvoice(label: string): Promise<void> {
  await page.goto(`${stack.webUrl}/payments`, { waitUntil: 'load' })
  await page.waitForSelector('#dc-root .sc-host', { timeout: 20_000 })
  await page.fill('#dc-root input[placeholder*="Search"]', label)
  await page.locator('#dc-root button', { hasText: label }).first().click()
  await page.waitForFunction((l) => document.querySelector('aside')?.textContent?.includes(l), label)
}

try {
  await login(page, stack, EMAILS.superAdmin, '/settings#billing')

  await step('Sales tax: a rate the server would refuse is said before sending; 6.625% is saved with its version', async () => {
    await page.goto(`${stack.webUrl}/settings#billing`, { waitUntil: 'load' })
    await seeText(page, 'How payments run')
    const b0 = await api(req, '/settings/billing')
    eq([b0.salesTax.percent, b0.salesTax.rounding], ['7', 'half_up'], 'the defaults')
    await seeText(page, 'Rounded half up, once per invoice.')
    const input = page.locator('#dc-root input[title="Sales tax rate"]')
    eq(await input.inputValue(), '7', 'the rate on screen')
    await input.fill('6.6255')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await seeText(page, SALES_TAX_FORMAT)
    eq((await api(req, '/settings/billing')).salesTax.rateDbp, 7000, 'nothing was sent')
    await input.fill('6.625')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await seeText(page, 'Sales tax saved · 6.625% on new invoices')
    const b1 = await api(req, '/settings/billing')
    eq(
      [b1.salesTax.rateDbp, b1.salesTax.label, b1.salesTax.rounding, b1.salesTax.version],
      [6625, '6.625%', 'half_up', b0.salesTax.version + 1],
      'saved: the rate, never the rounding',
    )
    await shot(page, 'sales-tax-saved')
  })

  await step('Square item library: Sync now makes Oasis’s items and its tax in Square; the block shows the server’s state', async () => {
    await seeText(page, 'Square item library')
    await seeText(page, 'On · Oasis services and prices are kept in step with Square')
    await seeText(page, /^Square item library$/)
    eq((await api(req, '/settings/billing')).processing.itemsSyncEnabled, true, 'the switch is on in this stack')
    await page.getByRole('button', { name: 'Sync now', exact: true }).click()
    await seeText(page, /^Synced with Square · \d+ made/, 60_000)
    const v = await until('every sold service on Square', async () => {
      const x = await api(req, '/integrations/square/items')
      return x.counts.onSquare > 0 && x.counts.waiting === 0 && x.counts.failed === 0 ? x : null
    })
    await seeText(page, countsText(v.counts))
    await seeText(page, taxLine(v.taxCheck).text)
    await seeText(page, /^Last sync /)
    const items = await oasisItems()
    eq(items.length, v.counts.onSquare + v.counts.archived, 'Oasis items at Square (the simulator)')
    const taxes = (await squareObjects(['TAX'])).filter((t) => !t.is_deleted)
    eq(
      taxes.map((t) => [t.tax_data?.name, t.tax_data?.percentage]),
      [['Sales tax', '6.625']],
      'Oasis’s own Square tax at the new rate',
    )
    S.items = v
    await shot(page, 'square-item-library-synced')
    // the next sync confirms Oasis's own tax: the check reads "the same as Oasis"
    await page.getByRole('button', { name: 'Sync now', exact: true }).click()
    await seeText(page, /^Synced with Square/, 60_000)
    const w = await until('the tax check ok', async () => {
      const x = await api(req, '/integrations/square/items')
      return x.taxCheck?.status === 'ok' ? x : null
    })
    check(w.taxCheck.own, 'Oasis’s own tax')
    await seeText(page, taxLine(w.taxCheck).text)
  })

  await step('Prices by size: a dot per price Square has; an edit waits for Square; Sync now changes the same variation in place', async () => {
    await tab('Prices by size')
    await seeText(page, /^One regular price per service and size/)
    const cat = await api(req, '/catalog')
    const active = cat.vehicleClasses.filter((x: any) => x.active).map((x: any) => x.key)
    const synced = (c: any) =>
      c.prices.reduce(
        (n: number, r: any) =>
          n + Object.entries(r.square?.cells ?? {}).filter(([k, s]) => active.includes(k) && s === 'synced').length,
        0,
      )
    const want = synced(cat)
    check(want > 0, 'prices on Square')
    await until('the dots', async () => (await page.locator('#dc-root span[title="On Square"]').count()) === want)
    // a price of its own at an active size, not a range
    const services = [...cat.packages, ...cat.addons]
    let pick: any = null
    for (const r of cat.prices)
      for (const c of r.cells)
        if (
          !pick &&
          active.includes(c.class) &&
          c.maxCents === null &&
          c.cents % 100 === 0 &&
          r.square?.cells?.[c.class] === 'synced'
        )
          pick = { row: r, cell: c, svc: services.find((s: any) => s.id === r.serviceId) }
    check(pick?.svc, 'a price to change')
    const size = cat.vehicleClasses.find((x: any) => x.key === pick.cell.class)
    const marker = `oasis:v1:${pick.row.serviceId}:${pick.cell.class}`
    const before = variationOf(await oasisItems(), marker)
    check(before, 'its Square variation')
    eq(before.item_variation_data.price_money.amount, pick.cell.cents, 'Square has Oasis’s price')
    const newCents = pick.cell.cents + 500
    await page
      .locator(`#dc-root input[title="${(pick.svc.publicName || pick.svc.name) + ' · ' + size.label}"]`)
      .fill(String(newCents / 100))
    await page.getByRole('button', { name: 'Save prices', exact: true }).click()
    await seeText(page, /^Prices saved · 1 service/)
    await until('the row waits for Square', async () => {
      const c = await api(req, '/catalog')
      return c.prices.find((r: any) => r.serviceId === pick.row.serviceId)?.square?.cells?.[pick.cell.class] === 'pending'
    })
    await page
      .locator('#dc-root span[title="Waiting for Square (the next sync sends it)"]')
      .first()
      .waitFor({ timeout: 15_000 })
    await seeText(page, /waiting for Square/)
    await shot(page, 'prices-waiting-for-square')
    await tab('Billing & integrations')
    await page.getByRole('button', { name: 'Sync now', exact: true }).click()
    await seeText(page, /^Synced with Square · 1 updated/, 60_000)
    await until('the row on Square again', async () => {
      const c = await api(req, '/catalog')
      return c.prices.find((r: any) => r.serviceId === pick.row.serviceId)?.square?.cells?.[pick.cell.class] === 'synced'
    })
    const after = variationOf(await oasisItems(), marker)
    eq(after.id, before.id, 'the same Square variation (updated in place)')
    eq(after.item_variation_data.price_money.amount, newCents, 'Square has the new price')
    check(after.version !== before.version, 'a new version')
    await tab('Prices by size')
    await until('the dots again', async () => (await page.locator('#dc-root span[title="On Square"]').count()) === want)
    await shot(page, 'prices-on-square')
  })

  await step('a visit at 6.625% rounded half up: the invoice keeps its rate and rule; the twin equals the server', async () => {
    S.a = await visitFor('a')
    const d = await api(req, `/invoices/${S.a.invoice}`)
    eq([d.taxDbp, d.taxRounding, d.taxBp], [6625, 'half_up', 663], 'the invoice’s rate and rule')
    eq(d.calc.tax, salesTaxCents(d.calc.sub, { dbp: 6625, rounding: 'half_up' }), 'the tax')
    sameAsServer(d, d.label)
    S.a.label = d.label
  })

  await step('the rollout’s rounding (half to even, set through the API) shows in Billing by itself', async () => {
    await tab('Billing & integrations')
    const b = await api(req, '/settings/billing')
    await write(ctx, 'PUT', '/settings/billing/sales-tax', {
      percent: '6.625',
      rounding: 'half_even',
      version: b.salesTax.version,
    })
    await seeText(page, 'Rounded like Square (half cents to the even cent), once per invoice.', 20_000)
    await shot(page, 'sales-tax-like-square')
  })

  await step('Payments: Tax (6.625%); the Adjust sheet previews a half-cent subtotal exactly as the server computes it', async () => {
    S.b = await visitFor('b')
    const d = await api(req, `/invoices/${S.b.invoice}`)
    eq([d.taxDbp, d.taxRounding], [6625, 'half_even'], 'the new invoice takes the rule')
    sameAsServer(d, d.label)
    S.b.label = d.label
    // a discount down to a subtotal of $4 + $16k: its 6.625% tax is exactly half a cent with an even floor, where the two
    // rules differ ($4 + $8k with k odd ends in half a cent too, but rounds up under both)
    const items = d.calc.items
    let target = 400 + 1600 * Math.floor((items - 400) / 1600)
    if (target === items) target -= 1600
    check(target >= 400, `a subtotal to aim at (items ${items})`)
    const even = salesTaxCents(target, { dbp: 6625, rounding: 'half_even' })
    check(even !== salesTaxCents(target, { dbp: 6625, rounding: 'half_up' }), 'a half-cent subtotal')
    const discount = items - target
    const newTotal = target + even + d.calc.tip
    await openInvoice(d.label)
    await page.waitForFunction(() => document.querySelector('aside')?.textContent?.includes('Tax (6.625%)'))
    await page.locator('aside button', { hasText: /^Adjust/ }).first().click()
    await sheet(page).waitFor()
    await sheet(page).locator('input[placeholder="0"]').fill((discount / 100).toFixed(2))
    await sheet(page).getByText('New total').waitFor()
    await page.waitForFunction(
      (t) => document.querySelector('div[style*="z-index: 70"]')?.textContent?.includes('New total' + t),
      money(newTotal),
    )
    await shot(page, 'adjust-preview-half-even')
    await sheet(page).getByRole('button', { name: 'Apply discount', exact: true }).click()
    await seeText(page, 'Discount applied · new total ' + money(newTotal))
    const after = await api(req, `/invoices/${S.b.invoice}`)
    eq([after.calc.sub, after.calc.tax, after.calc.total], [target, even, newTotal], 'the server’s figures')
    sameAsServer(after, after.label)
    await page.waitForFunction(
      (t) => document.querySelector('aside')?.textContent?.includes('Tax (6.625%)' + t),
      money(even),
    )
    await shot(page, 'payments-tax-6625')
    // the half-up invoice reads the same rate
    await openInvoice(S.a.label)
    await page.waitForFunction(() => document.querySelector('aside')?.textContent?.includes('Tax (6.625%)'))
    sameAsServer(await api(req, `/invoices/${S.a.invoice}`), S.a.label)
    eq(taxPercentLabel(after.taxDbp), '6.625%', 'the label')
  })

  await step('the operations file’s Payments tab reads Tax (6.625%)', async () => {
    await page.goto(`${stack.webUrl}/operations`, { waitUntil: 'load' })
    await page.waitForSelector('#dc-root .sc-host', { timeout: 20_000 })
    await page.locator('#dc-root button', { hasText: NAMES.b }).first().click()
    await fileModal(page).waitFor()
    await fileModal(page)
      .locator('button', { hasText: /^\s*Payments/ })
      .first()
      .click()
    await page.waitForFunction(
      () => document.querySelector('div[style*="z-index: 60"]')?.textContent?.includes('Tax (6.625%)'),
    )
    await shot(page, 'ops-file-tax-6625')
  })
} catch (e) {
  results.push({ step: 'the run', ok: false, detail: (e as Error).message })
  console.log('  FAIL the run: ' + (e as Error).message)
} finally {
  await browser.close().catch(() => {})
}

for (const p of problems) console.log('  PROBLEM ' + p)
const failed = results.filter((r) => !r.ok).length
console.log(`e2e-items: ${results.length} steps, ${failed} failing, ${problems.length} problems`)
process.exit(failed || problems.length ? 1 : 0)
