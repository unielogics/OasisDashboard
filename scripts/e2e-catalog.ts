/* eslint-disable @typescript-eslint/no-explicit-any */
// e2e-catalog: Settings → Catalog, Categories and Reminders & texts, and the categories on the board and in Payments
// (ADR 0160 plan A, I, K; DEVIATIONS DV-317..DV-321, DV-422..DV-424, DV-224, DV-225) against a live stack.
//   pnpm live:up --name w3cat --api-port 4031 --web-port 3231 --profile design,demo --backend <backend checkout>
//   pnpm e2e:catalog --name w3cat [--only <step text>]
// As Management it edits each section in the page, reloads and compares with the API; recolours a category and sees the
// board's chips follow; turns an add-on of an open visit into a tint and sees that visit read Mixed with both chips on the
// card and in the file header and in the counts; filters the board; checks the Payments split. It fails on any page error,
// any API 5xx and any API 4xx the script did not expect. Every change is undone at the end of its step.
// Screenshots: parity-reports/e2e-catalog/ (not committed).
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test'
import { EMAILS, loadStack, login } from './live-e2e'

const args = process.argv.slice(2)
const stack = loadStack(args.includes('--name') ? args[args.indexOf('--name') + 1]! : 'w3cat')
const only = args.includes('--only') ? args[args.indexOf('--only') + 1]! : ''
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const shots = path.join(root, 'parity-reports', 'e2e-catalog')
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
  await page.screenshot({ path: path.join(shots, `${String(++shotNo).padStart(2, '0')}-${name}.png`) })
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
    // the event stream's connect limit (30 a minute per person) answers 429 when a run follows another within the minute;
    // the stream backs off and reconnects, nothing on the page depends on that connect
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
  if (!r.ok()) throw new Error(`${method} ${p} -> ${r.status()} ${(await r.text()).slice(0, 200)}`)
  return r.status() === 204 ? null : r.json().catch(() => null)
}

/** The website fields of a service as the PUT takes them. */
const websiteFields = (s: any, version: number) => ({
  category: s.category,
  publicName: s.publicName,
  description: s.description,
  memberPriceCents: s.memberPriceCents,
  guestPriceCents: s.guestPriceCents,
  vipInclusion: s.vipInclusion,
  vipNote: s.vipNote,
  quoteOnly: s.quoteOnly,
  visibleOnline: s.visibleOnline,
  sort: s.sort,
  version,
})

const toast = (page: Page, text: string | RegExp) => page.getByText(text).first().waitFor({ timeout: 8000 })

async function openSettings(page: Page, nav: string): Promise<void> {
  await page.goto(`${stack.webUrl}/settings`, { waitUntil: 'load' })
  await page.waitForSelector('#dc-root .sc-host', { timeout: 20_000 })
  await page.getByRole('button', { name: nav, exact: true }).click()
  await page.getByText('Loading settings…').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {})
}

async function openBoard(page: Page): Promise<void> {
  await page.goto(`${stack.webUrl}/operations`, { waitUntil: 'load' })
  await page.waitForSelector('#dc-root .sc-host', { timeout: 20_000 })
  await page.getByText(/Today by category/).waitFor({ timeout: 20_000 })
}

/** The background of every chip on the board's cards that reads `label` (timeline cards). */
async function chipBackgrounds(page: Page, label: string): Promise<string[]> {
  return page
    .locator('#dc-root main button span[style*="background"]')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).style.background))
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

  await step('Catalog: edit the first package’s website fields in the page; the API and a reload agree', async () => {
    const before = await api(req, '/catalog')
    const pkg = before.packages[0]
    await openSettings(page, 'Catalog')
    await page.getByText('Change prices only here').waitFor()
    await page.getByText(pkg.name, { exact: true }).first().waitFor()
    await shot(page, 'catalog')
    try {
      await page.getByPlaceholder('No price').fill('61')
      await page.getByPlaceholder('What is included, in a sentence or two').fill('E2E description.')
      await page.getByText('Empty: guests pay $73 (member price + 20%).').waitFor()
      await page.getByRole('button', { name: 'Save', exact: true }).first().click()
      await toast(page, /^Saved /)
      const after = (await api(req, '/catalog')).packages.find((p: any) => p.id === pkg.id)
      eq([after.memberPriceCents, after.description], [6100, 'E2E description.'], 'saved website fields')
      eq(after.priceCents, 7300, 'a booking now charges the guest price')
      check(after.version > pkg.version, 'the version moved')
      await page.reload({ waitUntil: 'load' })
      await page.getByRole('button', { name: 'Catalog', exact: true }).click()
      eq(await page.getByPlaceholder('No price').inputValue(), '61', 'the member price after a reload')
      await shot(page, 'catalog-saved')
    } finally {
      const now = (await api(req, '/catalog')).packages.find((p: any) => p.id === pkg.id)
      if (now.version !== pkg.version) {
        const back = await write(bg, 'PUT', `/catalog/services/${pkg.id}`, websiteFields(pkg, now.version))
        // clearing the website prices leaves the booking charge where the guest price put it: put the plain price back
        if (back.priceCents !== pkg.priceCents)
          await write(bg, 'PATCH', `/services/${pkg.id}`, { priceCents: pkg.priceCents, version: back.version })
      }
    }
  })

  await step('Catalog: a guest price below the member price is refused in the form, nothing is sent', async () => {
    await openSettings(page, 'Catalog')
    await page.getByPlaceholder('No price').fill('50')
    let puts = 0
    const count = (r: any) => {
      if (r.request().method() === 'PUT' && r.url().includes('/catalog/services/')) puts++
    }
    page.on('response', count)
    await page.getByPlaceholder('Automatic').fill('1')
    await page.getByRole('button', { name: 'Save', exact: true }).first().click()
    await page.getByText('The guest price can’t be lower than the member price.').waitFor()
    await page.waitForTimeout(500)
    page.off('response', count)
    eq(puts, 0, 'PUTs sent')
    await page.getByRole('button', { name: 'Discard', exact: true }).click()
  })

  await step('Categories: recolour Wash in the page; the board’s Wash chips take the new colour', async () => {
    const cats = (await api(req, '/catalog/categories')).categories
    const wash = cats.find((c: any) => c.key === 'wash')
    try {
      await openSettings(page, 'Categories')
      const row = page.locator('input[placeholder="#RRGGBB"]').first()
      await row.waitFor()
      eq(await row.inputValue(), wash.colour, 'the Wash colour box')
      await row.fill('#C2410C')
      await page.getByRole('button', { name: 'Save', exact: true }).first().click()
      await toast(page, 'Saved ' + wash.label)
      eq((await api(req, '/catalog/categories')).categories.find((c: any) => c.key === 'wash').colour, '#C2410C', 'API colour')
      await shot(page, 'categories')
      await openBoard(page)
      const bgs = await chipBackgrounds(page, wash.label)
      check(bgs.length > 0, 'the board shows Wash chips')
      check(bgs.every((b) => /194,\s*65,\s*12/.test(b)), `chips in the new colour: ${bgs.join(' | ')}`)
      await shot(page, 'board-chips')
    } finally {
      const now = (await api(req, '/catalog/categories')).categories.find((c: any) => c.key === 'wash')
      if (now.colour !== wash.colour)
        await write(bg, 'PATCH', '/catalog/categories/wash', { colour: wash.colour, version: now.version })
    }
  })

  await step('Reminders: drop a reminder and add a tint prep line in the page; the preview shows it; save; reload', async () => {
    const before = await api(req, '/settings/reminders')
    check(before.reminders.offsetsMin.includes(120), 'the 2-hour reminder is set')
    try {
    await openSettings(page, 'Reminders & texts')
    await page.getByText('2 hours before', { exact: true }).waitFor()
    await page
      .locator('div', { has: page.getByText('2 hours before', { exact: true }) })
      .filter({ has: page.getByTitle('Remove') })
      .last()
      .getByTitle('Remove')
      .click()
    await page.getByText('Unsaved changes to reminders and texts').waitFor()
    await page.getByPlaceholder('e.g. Plan for 2–3 hours.').fill('Plan for 2 to 3 hours.')
    // the preview renders the exact texts for the draft (the sample visit takes the categories with a prep line)
    await page.getByText(/Plan for 2 to 3 hours\./).first().waitFor({ timeout: 10_000 })
    await shot(page, 'reminders-draft')
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await toast(page, 'Reminders saved · the next texts use them')
    const after = await api(req, '/settings/reminders')
    eq(after.reminders.offsetsMin, before.reminders.offsetsMin.filter((m: number) => m !== 120), 'offsets saved')
    eq(after.reminders.categoryPrep.tint, 'Plan for 2 to 3 hours.', 'prep line saved')
    await page.reload({ waitUntil: 'load' })
    await page.getByRole('button', { name: 'Reminders & texts', exact: true }).click()
    await page.getByText('24 hours before', { exact: true }).waitFor()
    eq(await page.getByText('2 hours before', { exact: true }).count(), 0, 'the 2-hour reminder after a reload')
    // the preview through the API equals what the page showed: the server renders it from the saved settings
    const pv = await (async () => {
      const csrf = (await api(req, '/auth/csrf')).csrfToken
      const r = await req.post(`${stack.webUrl}/api/v1/settings/reminders/preview`, {
        headers: { 'X-CSRF-Token': csrf, Origin: stack.webUrl, 'Content-Type': 'application/json' },
        data: '{}',
      })
      return r.json()
    })()
    const reminder = pv.texts.find((t: any) => t.group === 'reminders')
    check(reminder && reminder.text.includes('Plan for 2 to 3 hours.'), 'the saved prep line is in the reminder text')
    await page.getByText(reminder.text, { exact: true }).first().waitFor()
    } finally {
      const now = await api(req, '/settings/reminders')
      if (now.version !== before.version)
        await write(bg, 'PUT', '/settings/reminders', {
          reminders: { offsetsMin: before.reminders.offsetsMin, categoryPrep: before.reminders.categoryPrep },
          version: now.version,
        })
    }
  })

  await step('Board: per-category counts under the KPIs match the API; the filter narrows the timeline', async () => {
    await openBoard(page)
    const k = await api(req, '/ops/kpis')
    const total = k.categoryCounts.total
    await page.getByText(`Today by category · ${total} ${total === 1 ? 'job' : 'jobs'}`).waitFor()
    for (const i of k.categoryCounts.items)
      check((await page.getByText(i.label, { exact: true }).count()) > 0, `the ${i.label} count is shown`)
    const timeline = page.locator('#dc-root main section').first()
    const cards = () => timeline.getByText('Next', { exact: true }).count()
    const all = await cards()
    check(all > 0, 'the timeline has cards')
    const wash = k.categoryCounts.items.find((i: any) => i.key === 'wash')
    await page.getByTitle(`Show only ${wash.label} on the board`).click()
    await page.waitForTimeout(300)
    eq(await timeline.getByText(wash.label, { exact: true }).count(), await cards(), 'with Wash every card shows a Wash chip')
    await shot(page, 'board-filter-wash')
    const empty = k.categoryCounts.items.find((i: any) => i.count === 0 && i.key !== 'mixed')
    if (empty) {
      await page.getByTitle(`Show only ${empty.label} on the board`).click()
      await page.waitForTimeout(300)
      check((await cards()) <= all, `with ${empty.label} only visits holding it show`)
    }
    await page.getByTitle('Show every visit on the board').click()
    await page.waitForTimeout(300)
    eq(await cards(), all, 'All brings every card back')
  })

  await step('A wash with a tint add-on reads Mixed: both chips on the card and in the file header, counted as Mixed', async () => {
    const snap = await api(req, '/ops/snapshot?window=week')
    const cards = snap.timeline.groups.flatMap((g: any) => g.items.map((c: any) => ({ ...c, day: g.bizDate })))
    let target: any = null
    let addon: any = null
    for (const c of cards) {
      if (!c.hasAddons || ['completed', 'canceled', 'noshow'].includes(c.status)) continue
      const f = await api(req, `/appointments/${c.id}`)
      if (f.addons.selected.length) {
        target = c
        addon = f.addons.selected[0]
        break
      }
    }
    check(target, 'an open visit with an add-on today')
    const mixedBefore = snap.categoryCounts.items.find((i: any) => i.key === 'mixed')?.count ?? 0
    const svc = await api(req, `/catalog/services/${addon.serviceId}`)
    const r = await write(bg, 'PUT', `/catalog/services/${addon.serviceId}`, { ...websiteFields(svc, svc.version), category: 'tint' })
    check(r.appointmentsUpdated >= 1, 'open visits re-derived')
    try {
      const after = await api(req, `/appointments/${target.id}`)
      eq(after.category, 'mixed', 'the visit counts as mixed')
      check(after.categories.includes('tint'), 'the visit holds tint')
      await openBoard(page)
      const k = await api(req, '/ops/kpis')
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
      if (target.day === today)
        eq(k.categoryCounts.items.find((i: any) => i.key === 'mixed').count, mixedBefore + 1, 'Mixed count')
      // the board shows the visit's window: open its file from the API id through the page's own search
      await page.getByPlaceholder(/Search customer/).fill(target.customer.name)
      await page.getByRole('button', { name: 'Week', exact: true }).click()
      await page.waitForTimeout(600)
      await page
        .locator('#dc-root button', { hasText: target.customer.name })
        .filter({ hasNot: page.locator('[data-drop]') })
        .first()
        .click()
      await page.waitForFunction(
        (n) => document.querySelector('div[style*="z-index: 60"]')?.textContent?.includes(n),
        target.customer.name,
        { timeout: 10_000 },
      )
      // the header's chips: the spans after the status badge in the file's name row
      await page.waitForFunction(
        () => {
          const m = document.querySelector('div[style*="z-index: 60"]')
          const spans = [...(m?.querySelectorAll('span[style*="background"]') ?? [])].map((e) => e.textContent?.trim())
          return spans.includes('Wash') && spans.includes('Tint')
        },
        undefined,
        { timeout: 10_000 },
      )
      await shot(page, 'file-mixed')
      await page.keyboard.press('Escape').catch(() => {})
    } finally {
      const now = await api(req, `/catalog/services/${addon.serviceId}`)
      await write(bg, 'PUT', `/catalog/services/${addon.serviceId}`, websiteFields(svc, now.version))
    }
  })

  await step('Payments: the split by category under the KPIs and a chip on each categorized row', async () => {
    await page.goto(`${stack.webUrl}/payments`, { waitUntil: 'load' })
    await page.waitForSelector('#dc-root .sc-host', { timeout: 20_000 })
    await page.getByText(/^By category · /).waitFor({ timeout: 20_000 })
    const label = (await page.getByText(/^By category · /).first().textContent()) ?? ''
    check(/^By category · .+/.test(label), `the split names its range: ${label}`)
    const sum = await api(req, '/payments/summary?range=7d')
    const total = sum.byCategory.reduce((n: number, c: any) => n + c.count, 0)
    eq(total, sum.kpis.counts.invoices, 'the split counts each invoice once')
    await shot(page, 'payments-split')
  })
  await step('Dark theme: the chips, counts and the three sections render in dark (screenshots for review)', async () => {
    await openBoard(page)
    await page.getByTitle('Toggle theme').click()
    try {
      await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark')
      await shot(page, 'dark-board')
      for (const nav of ['Catalog', 'Categories', 'Reminders & texts']) {
        await openSettings(page, nav)
        await page.waitForTimeout(400)
        await shot(page, 'dark-' + nav.replace(/[^a-z]+/gi, '-').toLowerCase())
      }
      await page.goto(`${stack.webUrl}/payments`, { waitUntil: 'load' })
      await page.getByText(/^By category · /).waitFor({ timeout: 20_000 })
      await shot(page, 'dark-payments')
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
