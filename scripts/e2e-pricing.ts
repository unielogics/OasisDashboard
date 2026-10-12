/* eslint-disable @typescript-eslint/no-explicit-any */
// e2e-pricing: Settings → Vehicle sizes, Prices by size (with the booking fee) and Memberships (ADR 0170; DEVIATIONS
// DV-322..DV-326) against a live stack running the pricing backend (wave Q1a).
//   pnpm live:up --name qprice --api-port 4072 --web-port 3272 --profile design,website-catalog,pricing-defaults --backend <backend>
//   pnpm e2e:pricing --name qprice [--only <step text>]
// As Management it edits each section in the page, then checks the staff API and the public catalog the website reads
// (GET /public/catalog: a price filled in the grid becomes the service's starting price; a tier's % off becomes the
// member starting price; a tier price edit moves the tier's priceVersion and leaves the price "Not synced yet"). It fails
// on any page error, any API 5xx and any API 4xx the script did not expect. Every change is undone at the end of its step.
// Screenshots: parity-reports/e2e-pricing/ (not committed).
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test'
import { EMAILS, loadStack, login } from './live-e2e'

const args = process.argv.slice(2)
const stack = loadStack(args.includes('--name') ? args[args.indexOf('--name') + 1]! : 'qprice')
const only = args.includes('--only') ? args[args.indexOf('--only') + 1]! : ''
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const shots = path.join(root, 'parity-reports', 'e2e-pricing')
fs.mkdirSync(shots, { recursive: true })
for (const f of fs.readdirSync(shots)) fs.rmSync(path.join(shots, f))

const results: { step: string; ok: boolean; detail?: string }[] = []
const problems: string[] = []
let expected4xx: RegExp[] = []
let shotNo = 0
let current: Page | null = null
let stepName = ''

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
    const detail = (e as Error).message.split('\n').filter((l) => l.trim()).slice(0, 4).join(' | ').slice(0, 400)
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

/** The public catalog the website reads, straight from the API (no session, no proxy cache). */
async function publicCatalog(req: APIRequestContext): Promise<any> {
  const r = await req.get(`${stack.apiUrl}/api/v1/public/catalog`)
  if (!r.ok()) throw new Error(`GET /public/catalog -> ${r.status()}`)
  return r.json()
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
  if (!r.ok()) throw new Error(`${method} ${p} -> ${r.status()} ${(await r.text()).slice(0, 200)}`)
  return r.status() === 204 ? null : r.json().catch(() => null)
}

/** A tier as PUT /catalog/tiers/:key takes it, from GET /catalog/tiers. */
const tierBody = (t: any, version: number) => ({
  name: t.name,
  colour: t.colour,
  sort: t.sort,
  active: t.active,
  public: t.public,
  vipBooking: t.vipBooking,
  memberDiscountBp: t.memberDiscountBp,
  maxVehicles: t.maxVehicles,
  perks: t.perks,
  checkoutUrl: t.checkoutUrl,
  inclusions: t.inclusions.map((i: any) => ({
    id: i.id,
    label: i.label,
    mode: i.mode,
    perCycle: i.perCycle,
    autoApply: i.autoApply,
    active: i.active,
    serviceIds: i.serviceIds,
  })),
  version,
})

const toast = (page: Page, text: string | RegExp) => page.getByText(text).first().waitFor({ timeout: 8000 })

/** The three pricing sections share the nav button `Prices & memberships` and switch by the tabs over them. */
const TABS = ['Prices by size', 'Memberships', 'Vehicle sizes']

async function openTab(page: Page, nav: string): Promise<void> {
  await page.getByRole('button', { name: 'Prices & memberships', exact: true }).click()
  await page.getByText('Loading settings…').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {})
  if (nav !== 'Prices by size') await page.getByRole('button', { name: nav, exact: true }).click()
}

async function openSettings(page: Page, nav: string): Promise<void> {
  await page.goto(`${stack.webUrl}/settings`, { waitUntil: 'load' })
  await page.waitForSelector('#dc-root .sc-host', { timeout: 20_000 })
  if (TABS.includes(nav)) return openTab(page, nav)
  await page.getByRole('button', { name: nav, exact: true }).click()
  await page.getByText('Loading settings…').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {})
}

const missingOf = async (page: Page): Promise<number> => {
  const t = (await page.getByText(/^\d+ prices? not set$/).first().textContent({ timeout: 4000 }).catch(() => '')) ?? ''
  return Number(/^(\d+)/.exec(t)?.[1] ?? 0)
}

const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--font-render-hinting=none'] })

async function session(email: string, who: string, next: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 1000 }, timezoneId: 'America/New_York', locale: 'en-US' })
  const page = await ctx.newPage()
  page.setDefaultTimeout(8000)
  watch(page, who)
  current = page
  await login(page, stack, email, next)
  return { ctx, page }
}

try {
  // a background Super Admin reads and restores through the API, so the page under test keeps its own rate limit
  const { ctx: bg } = await session(EMAILS.superAdmin, 'super-background', '/settings')
  const req = bg.request
  const { page } = await session(EMAILS.manager, 'manager', '/settings')

  await step('Vehicle sizes: the five sizes in order; rename Large car in the page; the API and a reload agree', async () => {
    const before = (await api(req, '/catalog/vehicle-classes')).vehicleClasses
    eq(
      before.map((c: any) => c.label),
      ['Compact car', 'Large car', 'Compact SUV', 'Large SUV', 'Truck'],
      'the default sizes',
    )
    const large = before.find((c: any) => c.key === 'large_car')
    await openSettings(page, 'Vehicle sizes')
    await page.getByText('Smallest first', { exact: false }).first().waitFor()
    await shot(page, 'sizes')
    try {
      const box = page.getByPlaceholder('Name', { exact: true }).nth(1)
      eq(await box.inputValue(), 'Large car', 'the second size')
      await box.fill('Large sedan')
      await page.getByRole('button', { name: 'Save', exact: true }).first().click()
      await toast(page, 'Saved Large sedan')
      const after = (await api(req, '/catalog/vehicle-classes')).vehicleClasses.find((c: any) => c.key === 'large_car')
      eq([after.label, after.version > large.version], ['Large sedan', true], 'saved name, version moved')
      await page.reload({ waitUntil: 'load' })
      await openTab(page, 'Vehicle sizes')
      eq(await page.getByPlaceholder('Name', { exact: true }).nth(1).inputValue(), 'Large sedan', 'the name after a reload')
    } finally {
      const now = (await api(req, '/catalog/vehicle-classes')).vehicleClasses.find((c: any) => c.key === 'large_car')
      if (now.label !== large.label)
        await write(bg, 'PATCH', '/catalog/vehicle-classes/large_car', { label: large.label, version: now.version })
    }
  })

  await step('Vehicle sizes: Compact car is in use (the $40 wash), so Remove says to turn it off; nothing is removed', async () => {
    expected4xx = [/^409 DELETE \/api\/v1\/catalog\/vehicle-classes\/compact_car/]
    await openSettings(page, 'Vehicle sizes')
    await page.getByTitle('Remove').first().click()
    await page.getByText(/^Compact car is in use \(.*prices?.*\), so it can’t be removed\. Turn it off instead\.$/).waitFor()
    await shot(page, 'sizes-in-use')
    check(
      (await api(req, '/catalog/vehicle-classes')).vehicleClasses.some((c: any) => c.key === 'compact_car'),
      'Compact car is still there',
    )
  })

  await step('Catalog: Signature shows its starting price by size and Edit prices opens its row in Prices by size', async () => {
    const cat = await api(req, '/catalog')
    const sig = cat.packages.find((s: any) => s.name === 'Signature Hand Wash')
    check(sig, 'Signature Hand Wash is in the catalog')
    const row = cat.prices.find((r: any) => r.serviceId === sig.id)
    eq(row.cells.find((c: any) => c.class === 'compact_car')?.cents, 4000, 'the $40 seed price')
    await openSettings(page, 'Catalog')
    await page.getByText(sig.publicName || sig.name, { exact: true }).first().click()
    await page.getByText(/^from \$40 · \d sizes not set$/).first().waitFor()
    await page.getByRole('button', { name: 'Edit prices', exact: true }).click()
    await page.getByText('One regular price per service and size', { exact: false }).waitFor()
    eq(await page.getByTitle(`${sig.publicName || sig.name} · Compact car`, { exact: true }).inputValue(), '40', 'the grid cell')
    await shot(page, 'prices-from-catalog')
  })

  await step('Prices by size: fill a price in the page; Save; the grid, GET /catalog and GET /public/catalog agree', async () => {
    const cat = await api(req, '/catalog')
    const ext = cat.packages.find((s: any) => s.name === 'Exterior Hand Wash')
    check(ext, 'Exterior Hand Wash is in the catalog')
    const before = cat.prices.find((r: any) => r.serviceId === ext.id)
    check(!before.cells.some((c: any) => c.class === 'compact_car'), 'no Compact car price yet')
    const name = ext.publicName || ext.name
    try {
      await openSettings(page, 'Prices by size')
      const missing = await missingOf(page)
      eq(missing, cat.missingPrices, 'the banner counts the empty cells')
      await page.getByTitle(`${name} · Compact car`, { exact: true }).fill('33')
      await page.getByText('1 service changed', { exact: true }).waitFor()
      eq(await missingOf(page), missing - 1, 'the banner follows the typing')
      await shot(page, 'prices-draft')
      await page.getByRole('button', { name: 'Save prices', exact: true }).click()
      await toast(page, /^Prices saved · 1 service/)
      const after = await api(req, '/catalog')
      const row = after.prices.find((r: any) => r.serviceId === ext.id)
      eq(row.cells.find((c: any) => c.class === 'compact_car'), { class: 'compact_car', cents: 3300, maxCents: null }, 'saved cell')
      check(row.version > before.version, 'the service version moved')
      eq(row.fromCents, 3300, 'the starting price')
      const pub = await publicCatalog(req)
      const item = pub.services.find((s: any) => s.name === name || s.name === ext.name)
      check(item, `${name} is on the public catalog`)
      eq([item.guestPriceCents, item.priceCents], [3300, 3300], 'the public starting price')
      await page.reload({ waitUntil: 'load' })
      await openTab(page, 'Prices by size')
      eq(await page.getByTitle(`${name} · Compact car`, { exact: true }).inputValue(), '33', 'the cell after a reload')
    } finally {
      const now = (await api(req, '/catalog')).prices.find((r: any) => r.serviceId === ext.id)
      if (now.cells.some((c: any) => c.class === 'compact_car'))
        await write(bg, 'PUT', '/catalog/prices', {
          rows: [{ serviceId: ext.id, version: now.version, cells: [{ class: 'compact_car', cents: null }] }],
        })
    }
  })

  await step('Prices by size: a price someone else saves shows while this page has an unsaved edit; Discard', async () => {
    const cat = await api(req, '/catalog')
    const sig = cat.packages.find((s: any) => s.name === 'Signature Hand Wash')
    const ext = cat.packages.find((s: any) => s.name === 'Exterior Hand Wash')
    const sigName = sig.publicName || sig.name
    const row = cat.prices.find((r: any) => r.serviceId === sig.id)
    try {
      await openSettings(page, 'Prices by size')
      await page.getByTitle(`${ext.publicName || ext.name} · Large car`, { exact: true }).fill('41')
      await write(bg, 'PUT', '/catalog/prices', {
        rows: [{ serviceId: sig.id, version: row.version, cells: [{ class: 'large_suv', cents: 6500 }] }],
      })
      await page.waitForFunction(
        (title) => (document.querySelector(`input[title="${title}"]`) as HTMLInputElement | null)?.value === '65',
        `${sigName} · Large SUV`,
        { timeout: 10_000 },
      )
      eq(await page.getByTitle(`${ext.publicName || ext.name} · Large car`, { exact: true }).inputValue(), '41', 'my edit stays')
      await shot(page, 'prices-live-update')
      await page.getByRole('button', { name: 'Discard', exact: true }).first().click()
      eq(await page.getByTitle(`${ext.publicName || ext.name} · Large car`, { exact: true }).inputValue(), '', 'discarded')
    } finally {
      const now = (await api(req, '/catalog')).prices.find((r: any) => r.serviceId === sig.id)
      if (now.cells.some((c: any) => c.class === 'large_suv'))
        await write(bg, 'PUT', '/catalog/prices', {
          rows: [{ serviceId: sig.id, version: now.version, cells: [{ class: 'large_suv', cents: null }] }],
        })
    }
  })

  await step('Booking fee: $30 by payment link in the page; the API and the public catalog agree', async () => {
    const before = await api(req, '/catalog/guest-fee')
    try {
      await openSettings(page, 'Prices by size')
      await page.getByText('Booking fee for guests', { exact: true }).waitFor()
      await page.getByPlaceholder('0', { exact: true }).fill('30')
      await page.getByRole('button', { name: 'By payment link', exact: true }).click()
      await page.getByRole('button', { name: 'Save fee', exact: true }).click()
      await toast(page, 'Booking fee saved · $30, by payment link')
      const after = await api(req, '/catalog/guest-fee')
      eq([after.cents, after.collect], [3000, 'link'], 'saved fee')
      eq((await publicCatalog(req)).guestBookingFeeCents, 3000, 'the public catalog fee')
    } finally {
      const now = await api(req, '/catalog/guest-fee')
      if (now.version !== before.version)
        await write(bg, 'PUT', '/catalog/guest-fee', { cents: before.cents, collect: before.collect, version: now.version })
    }
  })

  await step('Memberships: Gold’s Compact car price in the grid; Save moves priceVersion; Square state Not synced yet', async () => {
    const before = (await api(req, '/catalog/tiers')).tiers.find((t: any) => t.key === 'gold')
    check(before, 'the Gold tier exists')
    eq(before.prices.find((p: any) => p.class === 'compact_car')?.monthlyCents, 12900, 'the $129 seed price')
    try {
      await openSettings(page, 'Memberships')
      await page.getByText('Monthly price by plan size', { exact: true }).waitFor()
      const cell = page.getByTitle(`${before.name} · Compact car`, { exact: true })
      eq(await cell.inputValue(), '129', 'the grid cell')
      await page.getByText(`Price version ${before.priceVersion}`, { exact: false }).first().waitFor()
      await cell.fill('139')
      await page.getByRole('button', { name: 'Save monthly prices', exact: true }).click()
      await toast(page, /^Monthly prices saved · 1 tier/)
      const after = (await api(req, '/catalog/tiers')).tiers.find((t: any) => t.key === 'gold')
      check(after.priceVersion > before.priceVersion, `priceVersion moved (${before.priceVersion} -> ${after.priceVersion})`)
      const p = after.prices.find((x: any) => x.class === 'compact_car')
      eq([p.monthlyCents, p.squareState], [13900, 'pending'], 'the new price and its Square state')
      await page.getByText(`Price version ${after.priceVersion}`, { exact: false }).first().waitFor()
      check((await page.getByText('Not synced yet', { exact: true }).count()) > 0, 'the Square state is shown')
      eq(
        (await publicCatalog(req)).plans.find((x: any) => x.key === 'gold')?.priceCents,
        13900,
        'the public starting monthly price',
      )
      await shot(page, 'memberships-grid')
    } finally {
      const now = (await api(req, '/catalog/tiers')).tiers.find((t: any) => t.key === 'gold')
      if (now.prices.find((x: any) => x.class === 'compact_car')?.monthlyCents !== 12900)
        await write(bg, 'PUT', '/catalog/tier-prices', {
          rows: [{ tierKey: 'gold', priceVersion: now.priceVersion, cells: [{ class: 'compact_car', monthlyCents: 12900 }] }],
        })
    }
  })

  await step('Memberships: Gold 10% off in the editor; Save; the tier version moves and members see $36 for the $40 wash', async () => {
    const before = (await api(req, '/catalog/tiers')).tiers.find((t: any) => t.key === 'gold')
    try {
      await openSettings(page, 'Memberships')
      await page.getByRole('button', { name: new RegExp('^' + before.name) }).first().click()
      // the switches show the tier picked (Gold is on and on the website; VIP booking is the VIP tier's)
      // (a string, not a function: tsx would wrap a named inner function in a helper the page does not have)
      await page.waitForFunction(
        `(() => {
          const divs = [...document.querySelectorAll('#dc-root div')]
          const bg = (label) => divs.find((d) => d.textContent === label)?.parentElement?.parentElement?.querySelector('button')?.style.background
          return bg('On the website') === 'var(--accent)' && bg('VIP booking') === 'var(--line)'
        })()`,
        undefined,
        { timeout: 5000 },
      )
      const box = page.getByPlaceholder('0', { exact: true }).first()
      await box.fill('10')
      await page.getByText(/costs them \$36\. The size difference gets no % off\./).waitFor()
      await shot(page, 'memberships-editor')
      await page.getByRole('button', { name: 'Save tier', exact: true }).click()
      await toast(page, `Saved the ${before.name} tier`)
      const after = (await api(req, '/catalog/tiers')).tiers.find((t: any) => t.key === 'gold')
      eq([after.memberDiscountBp, after.version > before.version], [1000, true], 'saved % off, version moved')
      eq(after.inclusions.map((i: any) => i.id), before.inclusions.map((i: any) => i.id), 'the inclusions kept their ids')
      const pub = await publicCatalog(req)
      const sig = pub.services.find((s: any) => /Signature/.test(s.name))
      eq([sig.guestPriceCents, sig.memberPriceCents], [4000, 3600], 'the public member starting price')
    } finally {
      const now = (await api(req, '/catalog/tiers')).tiers.find((t: any) => t.key === 'gold')
      if (now.version !== before.version) await write(bg, 'PUT', '/catalog/tiers/gold', tierBody(before, now.version))
    }
  })

  await step('Dark theme: the three sections render in dark (screenshots for review)', async () => {
    await page.goto(`${stack.webUrl}/settings`, { waitUntil: 'load' })
    await page.waitForSelector('#dc-root .sc-host', { timeout: 20_000 })
    await page.getByTitle('Toggle theme').click()
    try {
      await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark')
      await openTab(page, 'Prices by size')
      for (const nav of TABS) {
        await page.getByRole('button', { name: nav, exact: true }).click()
        await page.waitForTimeout(400)
        await shot(page, 'dark-' + nav.replace(/[^a-z]+/gi, '-').toLowerCase())
      }
    } finally {
      await page.getByTitle('Toggle theme').click()
      await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light')
    }
  })
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} steps passed; ${problems.length} page or API problems`)
for (const p of problems) console.log('  problem:', p)
for (const f of failed) console.log('  failed:', f.step, '::', f.detail)
console.log(`screenshots: ${path.relative(root, shots)}/ (${shotNo})`)
process.exit(failed.length || problems.length ? 1 : 0)
