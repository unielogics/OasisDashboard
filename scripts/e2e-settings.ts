/* eslint-disable @typescript-eslint/no-explicit-any */
// e2e-settings: the Settings screen against a live stack (real API, real Postgres, the live dashboard build).
//   pnpm live:up --name settings --api-port 4021 --web-port 3221 --profile design
//   pnpm tsx scripts/e2e-settings.ts --name settings
// As Management it edits every section, reloads the page and compares what it sees (and the API) with what it saved;
// then it signs in as Super Admin for the Super-only changes, as Support for the per-section locks and as Crew for the
// locked screen. It fails on any page error, any API 5xx, and on any API 4xx that the script did not expect.
// Screenshots go to parity-reports/e2e-settings/ (not committed). Every change is undone at the end of its step so the
// script can run again against the same stack.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Locator, Page } from '@playwright/test'
import { EMAILS, loadStack, login } from './live-e2e'
import { effective } from '../src/lib/settings'
import { mapEmployeeDetail, mapRoles } from '../src/screens/settings/live/mapping'

const args = process.argv.slice(2)
const stack = loadStack(args.includes('--name') ? args[args.indexOf('--name') + 1]! : 'settings')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const shots = path.join(root, 'parity-reports', 'e2e-settings')
fs.mkdirSync(shots, { recursive: true })
for (const f of fs.readdirSync(shots)) fs.rmSync(path.join(shots, f))

// ---- bookkeeping ------------------------------------------------------------------------------------------------

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

const only = args.includes('--only') ? args[args.indexOf('--only') + 1]! : ''

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  if (only && !name.includes(only)) return
  // a toast of the previous step must not satisfy this step's expectations
  if (current)
    await current
      .locator('div[style*="position: fixed"][style*="bottom: 26px"]')
      .waitFor({ state: 'detached', timeout: 5000 })
      .catch(() => {})
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
      .slice(0, 400)
    results.push({ step: name, ok: false, detail })
    console.log(`  FAIL ${name}\n       ${detail}`)
    if (current)
      await shot(current, 'FAILED-' + name.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)).catch(() => {})
  }
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(shots, `${String(++shotNo).padStart(2, '0')}-${name}.png`) })
}

function watch(page: Page, who: string): void {
  page.on('pageerror', (e) => problems.push(`[${who}] page error: ${String(e).slice(0, 300)}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    if (/status of 4\d\d/.test(m.text())) return // network 4xx is judged on the response below
    problems.push(`[${who}] console error: ${m.text().slice(0, 300)}`)
  })
  page.on('response', (r) => {
    const url = r.url()
    if (!url.includes('/api/')) return
    const line = `${r.status()} ${r.request().method()} ${url.replace(stack.webUrl, '')}`
    if (r.status() >= 500) problems.push(`[${who}] API 5xx: ${line}`)
    else if (r.status() >= 400 && !expected4xx.some((re) => re.test(line)))
      problems.push(`[${who}] unexpected API 4xx during "${stepName}": ${line}`)
  })
}

async function api<T = any>(ctx: APIRequestContext, p: string): Promise<T> {
  const r = await ctx.get(`${stack.webUrl}/api/v1${p}`)
  if (!r.ok()) throw new Error(`GET ${p} -> ${r.status()}`)
  return (await r.json()) as T
}

// ---- page helpers -------------------------------------------------------------------------------------------------

const SECTIONS: Record<string, string> = {
  hours: 'Working hours',
  closures: 'Holidays & closures',
  emergency: 'Emergency closing',
  employees: 'Employees',
  roles: 'Roles & permissions',
  vip: 'VIP program',
  arrival: 'Arrival & check-in',
  services: 'Packages & checklists',
}

async function open(page: Page, hash = ''): Promise<void> {
  await page.goto(`${stack.webUrl}/settings${hash}`, { waitUntil: 'load' })
  if (hash) await page.reload({ waitUntil: 'load' }) // a hash-only change is not a page load
  await page.waitForSelector('#dc-root .sc-host', { timeout: 20_000 })
  await page
    .getByText('Loading settings…')
    .waitFor({ state: 'detached', timeout: 20_000 })
    .catch(() => {})
}

async function section(page: Page, key: keyof typeof SECTIONS): Promise<void> {
  await page.locator('aside button', { hasText: SECTIONS[key]! }).first().click()
  await page.getByText(SECTIONS[key]!, { exact: true }).first().waitFor()
  await page
    .getByText('Loading settings…')
    .waitFor({ state: 'detached', timeout: 20_000 })
    .catch(() => {})
}

async function reload(page: Page, key: keyof typeof SECTIONS): Promise<void> {
  await open(page)
  await section(page, key)
}

const toast = (page: Page): Locator => page.locator('div[style*="position: fixed"][style*="bottom: 26px"]')

async function expectToast(page: Page, re: RegExp | string): Promise<void> {
  const t = toast(page).filter({ hasText: re })
  await t.waitFor({ timeout: 8000 })
}

const xp = (page: Page, x: string): Locator => page.locator('xpath=' + x)
/** The row div that holds a label div as a direct child ("Monday" in the hours list, a permission in the matrix). */
const rowWith = (page: Page, label: string): Locator =>
  xp(page, `//div[./div[normalize-space(.)='${label}']]`).last()
/** The row of a label with a sub-line (switches of the VIP, arrival and emergency cards, drawer permissions). */
const optionRow = (page: Page, label: string): Locator =>
  xp(page, `//div[./div/div[normalize-space(.)='${label}']]`).last()

/** Polls an API read until it equals the expected value (the page saves a moment after the click). */
async function eventually<T>(read: () => Promise<T>, expected: T, what: string, ms = 6000): Promise<void> {
  const end = Date.now() + ms
  let last: T | undefined
  for (;;) {
    last = await read()
    if (JSON.stringify(last) === JSON.stringify(expected)) return
    if (Date.now() > end)
      throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(last)}`)
    await sleep(300)
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function isoDate(daysFromToday: number): string {
  const d = new Date(Date.now() + daysFromToday * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)
}

/** A write through the API as the person of this context (CSRF token, Origin and an Idempotency-Key like the app sends). */
async function write(
  ctx: BrowserContext,
  method: 'POST' | 'PUT' | 'DELETE' | 'PATCH',
  p: string,
  data?: unknown,
): Promise<any> {
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

// ---- the script ---------------------------------------------------------------------------------------------------

const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--font-render-hinting=none'] })

async function session(
  email: string,
  who: string,
  next = '/settings',
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    viewport: { width: 1480, height: 1000 },
    timezoneId: 'America/New_York',
    locale: 'en-US',
  })
  const page = await ctx.newPage()
  page.setDefaultTimeout(8000)
  watch(page, who)
  current = page
  await login(page, stack, email, next)
  return { ctx, page }
}

try {
  // ====================================================================================================== Management
  console.log('Management (rafael)')
  // the script reads and writes through a second person's session, so the API's per-user rate limit is not spent by
  // the polling of this script and the page under test gets all of its own
  const { ctx: bg } = await session(EMAILS.superAdmin, 'super-background')
  const req = bg.request
  // a run that was interrupted can leave its closures behind
  for (const c of (await api(req, '/closures')).upcoming)
    if (/^E2E /.test(c.name)) await write(bg, 'DELETE', `/closures/${c.id}`)
  const { ctx: mctx, page } = await session(EMAILS.manager, 'manager')
  await open(page)
  await page.waitForSelector('text=Working hours')
  await shot(page, 'management-hours')

  // ---- working hours -------------------------------------------------------------------------------------------------
  await step('hours: edit shows the Save bar, Discard restores, Save persists across a reload', async () => {
    const monday = rowWith(page, 'Monday')
    const before = (await api(req, '/settings/hours')).days[1].to
    eq(before, '6:00 PM', 'seeded Monday close')
    await monday.locator('button').nth(4).click() // "to" +30 min
    await page.getByText('Unsaved changes to working hours').waitFor()
    check((await monday.innerText()).includes('6:30 PM'), 'Monday shows 6:30 PM while dirty')
    await shot(page, 'hours-dirty')
    await page.getByRole('button', { name: 'Discard' }).click()
    check((await monday.innerText()).includes('6:00 PM'), 'Discard brought back 6:00 PM')
    check(!(await page.getByText('Unsaved changes to working hours').isVisible()), 'bar gone after Discard')

    await monday.locator('button').nth(4).click()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expectToast(page, 'Working hours saved · booking and calendar updated')
    await reload(page, 'hours')
    check(
      (await rowWith(page, 'Monday').innerText()).includes('6:30 PM'),
      'Monday still 6:30 PM after reload',
    )
    eq((await api(req, '/settings/hours')).days[1].to, '6:30 PM', 'API Monday close')
    await shot(page, 'hours-saved')
    // undo
    await rowWith(page, 'Monday').locator('button').nth(3).click()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expectToast(page, 'Working hours saved')
    eq((await api(req, '/settings/hours')).days[1].to, '6:00 PM', 'API Monday close restored')
  })

  await step('hours: a rule chip saves at once and a rule click keeps the unsaved hours edit', async () => {
    const monday = rowWith(page, 'Monday')
    await monday.locator('button').nth(2).click() // "from" +30 min: dirty
    await page.getByText('Unsaved changes to working hours').waitFor()
    await page.getByRole('button', { name: '15 min', exact: true }).first().click()
    await sleep(700)
    await eventually(async () => (await api(req, '/settings/rules')).rules.slot, 15, 'API slot')
    check((await monday.innerText()).includes('8:30 AM'), 'the dirty edit survived the rule click')
    check(await page.getByText('Unsaved changes to working hours').isVisible(), 'bar still up')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expectToast(page, 'Working hours saved')
    await eventually(
      async () => (await api(req, '/settings/hours')).days[1].from,
      '8:30 AM',
      'API Monday open after saving on the shared version',
    )
    await reload(page, 'hours')
    // undo both
    await rowWith(page, 'Monday').locator('button').nth(1).click()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expectToast(page, 'Working hours saved')
    await page.getByRole('button', { name: '30 min', exact: true }).first().click()
    await sleep(700)
    await eventually(async () => (await api(req, '/settings/rules')).rules.slot, 30, 'API slot restored')
  })

  await step('hours: a closing time before opening is refused with the server message', async () => {
    const monday = rowWith(page, 'Monday')
    for (let i = 0; i < 24; i++) await monday.locator('button').nth(3).click() // to -30 min x24 -> before 8:00 AM
    expected4xx = [/^422 PUT \/api\/v1\/settings\/hours/]
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expectToast(page, /closing time must be after opening time/i)
    expected4xx = []
    await shot(page, 'hours-refused')
    await page.getByRole('button', { name: 'Discard' }).click()
  })

  // ---- closures --------------------------------------------------------------------------------------------------------
  const closureDate = isoDate(75)
  await step('closures: validate, add with a real affected count, list, notify, remove', async () => {
    await section(page, 'closures')
    await page.getByRole('button', { name: 'Add closure' }).click()
    await page.getByRole('button', { name: 'Add closure' }).last().click()
    await page.getByText('Add a date and a name.').waitFor()
    await page.locator('input[type="date"]').fill(closureDate)
    await page.getByPlaceholder('e.g. Staff training day').fill('E2E staff day')
    await page
      .getByText(/(customers are|customer is) booked that day|No customers are booked that day/)
      .waitFor({ timeout: 8000 })
    await shot(page, 'closure-form')
    await page.getByRole('button', { name: 'Add closure' }).last().click()
    await expectToast(page, 'E2E staff day added · calendar updated')
    check(await page.getByText('E2E staff day', { exact: true }).isVisible(), 'row listed')
    check(
      await page
        .getByText(/Online booking blocked · \d+ existing bookings? to move/)
        .first()
        .isVisible(),
      'real sub-line',
    )
    // duplicate date
    await page.getByRole('button', { name: 'Add closure' }).first().click()
    await page.locator('input[type="date"]').fill(closureDate)
    await page.getByPlaceholder('e.g. Staff training day').fill('Again')
    await page.getByRole('button', { name: 'Add closure' }).last().click()
    await page.getByText('There’s already a closure on that date.').waitFor()
    await page.getByRole('button', { name: 'Cancel' }).click()

    await reload(page, 'closures')
    const list = await api(req, '/closures')
    const mine = list.upcoming.find((c: any) => c.name === 'E2E staff day')
    check(mine, 'closure in the API after reload')
    eq(mine.date, closureDate, 'closure date')
    check(await page.getByText('E2E staff day', { exact: true }).isVisible(), 'row listed after reload')
    await shot(page, 'closures-list')

    // notify switch, then remove
    const row = xp(page, `//div[./div/div/span[normalize-space(.)='E2E staff day']]`).first()
    await row.locator('button').first().click()
    await sleep(700)
    eq(
      (await api(req, '/closures')).upcoming.find((c: any) => c.name === 'E2E staff day').notify,
      false,
      'API notify off',
    )
    await row.getByTitle('Remove').click()
    await expectToast(page, 'E2E staff day removed')
    await reload(page, 'closures')
    check(
      !(await api(req, '/closures')).upcoming.some((c: any) => c.name === 'E2E staff day'),
      'closure gone in the API',
    )
    check(!(await page.getByText('E2E staff day', { exact: true }).isVisible()), 'row gone after reload')
    // the federal-holiday toggle persists (the design never saved it)
    const federal = () =>
      xp(page, `//div[./div/div[normalize-space(.)='Auto-add US federal holidays']]`)
        .first()
        .locator('button')
    await federal().click()
    await eventually(async () => (await api(req, '/closures')).federalAuto, false, 'API federal toggle off')
    await reload(page, 'closures')
    await eventually(async () => (await api(req, '/closures')).federalAuto, false, 'still off after reload')
    await federal().click()
    await eventually(
      async () => (await api(req, '/closures')).federalAuto,
      true,
      'API federal toggle back on',
    )
  })

  // ---- emergency --------------------------------------------------------------------------------------------------------
  await step(
    'emergency: live strip, preview, confirm dialog, close, active state survives a reload, reopen',
    async () => {
      // after closing time "rest of today" cannot be closed: the preview answers 422 and the screen toasts the server's message
      expected4xx = [/^422 GET \/api\/v1\/emergency\/preview/]
      await open(page, '#emergency')
      await page
        .getByText(/Open now|Closed now|Closed today/)
        .first()
        .waitFor()
      eq(
        await page.getByText('Emergency closing', { exact: true }).first().isVisible(),
        true,
        'deep link opened the section',
      )
      const strip = await page
        .locator('div', { hasText: /^(Open now|Closed now|Closed today) ·/ })
        .last()
        .innerText()
      check(
        /appointments? left today, \d+ vehicles? on site/.test(strip),
        'idle strip has live counts: ' + strip,
      )
      check(await page.getByText('Sent by SMS').isVisible(), 'SMS wording')
      check(await page.getByText(/^Preview · SMS to /).isVisible(), 'SMS preview label')
      await page.getByRole('button', { name: 'Multiple days' }).click()
      await page.locator('input[type="date"]').fill(isoDate(1))
      await page
        .getByText(/customers?$/)
        .first()
        .waitFor()
      await shot(page, 'emergency-idle')
      await page.getByRole('button', { name: 'Close the shop now' }).click()
      await page.getByText('Close Oasis Auto Spa now?').waitFor()
      await shot(page, 'emergency-confirm')
      await page.getByRole('button', { name: 'Confirm closure' }).click()
      await expectToast(page, /^Shop closed · /)
      await page.getByText('Emergency closure active').waitFor()
      await shot(page, 'emergency-active')
      const em = await api(req, '/emergency')
      eq(em.active, true, 'API emergency active')
      await open(page, '#emergency')
      await page.getByText('Emergency closure active').waitFor()
      check(await page.getByText('online booking', { exact: true }).isVisible(), 'counters')
      // the closure list shows the emergency rows
      await section(page, 'closures')
      check(
        await page.getByText('Emergency', { exact: true }).first().isVisible(),
        'Emergency tag in the closure list',
      )
      await section(page, 'emergency')
      await page.getByRole('button', { name: 'Reopen now' }).click()
      await expectToast(page, 'Shop reopened · online booking resumed')
      await open(page, '#emergency')
      await page.getByRole('button', { name: 'Close the shop now' }).waitFor()
      eq((await api(req, '/emergency')).active, false, 'API emergency idle')
      check(
        await page
          .getByText(/Reopened by /)
          .first()
          .isVisible(),
        'history shows the reopen',
      )
      await shot(page, 'emergency-reopened')
      await sleep(1000) // the preview of the reloaded page is requested a moment after it loads
      expected4xx = []
    },
  )

  // ---- employees --------------------------------------------------------------------------------------------------------
  const unique = String(Date.now()).slice(-6)
  const phone = `(305) 555-${unique.slice(-4)}`
  let newEmployeeId = ''
  await step(
    'employees: add with an exception, schedule validation message, persist, deactivate and reactivate',
    async () => {
      await reload(page, 'employees')
      await page.getByPlaceholder('Search name, phone, role…').fill('sofia')
      await page.getByText('Sofia Duarte', { exact: true }).waitFor()
      check(await page.getByText('1 exception', { exact: true }).isVisible(), 'seeded exception badge')
      await page.getByPlaceholder('Search name, phone, role…').fill('')
      await page.getByRole('button', { name: 'Add employee' }).click()
      await page.getByRole('button', { name: 'Create & send invite' }).click()
      await page.getByText('First name and mobile number are required.').waitFor()
      await page.getByPlaceholder('First').fill('E2E')
      await page.getByPlaceholder('Last').fill('Tester' + unique)
      await page.getByPlaceholder('(305) 555-0000').fill(phone)
      await page.getByPlaceholder('e.g. Detailer').fill('Test detailer')
      await page.getByRole('button', { name: 'Roles & access' }).click()
      await page.getByText('Effective permissions').waitFor()
      const override = optionRow(page, 'Override bay capacity')
      await override.getByRole('button', { name: 'Allow' }).click()
      check((await override.innerText()).includes('Exception · allowed'), 'exception shown')
      await shot(page, 'employee-access')
      await page.getByRole('button', { name: 'Schedule' }).click()
      // Sunday opens 9-3 but the new employee starts 8-6: the server refuses it
      const sunday = xp(page, `//div[./span[normalize-space(.)='Sunday']]`).first()
      await sunday.locator('button').first().click()
      expected4xx = [/^422 POST \/api\/v1\/employees/]
      await page.getByRole('button', { name: 'Create & send invite' }).click()
      await page
        .getByText(/Sunday: availability must sit inside business hours \(9:00 AM – 3:00 PM\)\./)
        .waitFor()
      expected4xx = []
      await shot(page, 'employee-schedule-error')
      await sunday.locator('button').first().click()
      await page.getByRole('button', { name: 'Create & send invite' }).click()
      await expectToast(page, `Invite sent to ${phone}`)
      const created = (await api(req, '/employees')).items.find((e: any) => e.last === 'Tester' + unique)
      check(created, 'employee in the API')
      newEmployeeId = created.id
      await reload(page, 'employees')
      await page.getByPlaceholder('Search name, phone, role…').fill('Tester' + unique)
      await page.getByText('E2E Tester' + unique, { exact: true }).waitFor()
      check(await page.getByText('1 exception', { exact: true }).isVisible(), 'exception badge after reload')
      const detail = await api(req, `/employees/${newEmployeeId}`)
      eq(detail.overrides, { 'sched.override': 'allow' }, 'API exception')
      eq(detail.status, 'invited', 'API status')
      await shot(page, 'employees-added')
      // the drawer shows the server's effective permissions
      await page.getByText('E2E Tester' + unique, { exact: true }).click()
      await page.getByRole('button', { name: 'Roles & access' }).click()
      const eff = detail.effectivePermissions.filter((p: any) => p.on).length
      await page.getByText(`${eff} of 27 allowed`).waitFor()
      // deactivate then reactivate (restores "invited" for someone who never accepted)
      await page.getByRole('button', { name: 'Deactivate' }).click()
      await page.getByRole('button', { name: 'Save changes' }).click()
      await expectToast(page, `Saved E2E Tester${unique}`)
      await eventually(
        async () => (await api(req, `/employees/${newEmployeeId}`)).status,
        'inactive',
        'API inactive',
      )
      await page.getByText('E2E Tester' + unique, { exact: true }).click()
      await page.getByRole('button', { name: 'Reactivate' }).click()
      await page.getByRole('button', { name: 'Save changes' }).click()
      await expectToast(page, `Saved E2E Tester${unique}`)
      await eventually(
        async () => (await api(req, `/employees/${newEmployeeId}`)).status,
        'invited',
        'API reactivated as invited',
      )
    },
  )

  // ---- roles -----------------------------------------------------------------------------------------------------------
  await step(
    'roles: toggle persists, the locked role refuses, a Management limit click is refused, custom role add and remove',
    async () => {
      await reload(page, 'roles')
      const rolesBefore = await api(req, '/roles')
      const crew = rolesBefore.roles.find((r: any) => r.key === 'crew')
      const was = rolesBefore.matrix[crew.id]['cli.export']
      // Crew x "Export client data"
      const crewCol = rolesBefore.roles.findIndex((r: any) => r.key === 'crew')
      const cell = (label: string, col: number): Locator =>
        xp(page, `//div[./div[normalize-space(.)='${label}']]/div[${col + 2}]`).last()
      await cell('Export client data', crewCol).locator('button').first().click()
      await sleep(800)
      await eventually(
        async () => (await api(req, '/roles')).matrix[crew.id]['cli.export'],
        !was,
        'API toggled',
      )
      await reload(page, 'roles')
      await cell('Export client data', crewCol).locator('button').first().click() // back
      await sleep(800)
      await eventually(
        async () => (await api(req, '/roles')).matrix[crew.id]['cli.export'],
        was,
        'API restored',
      )
      // locked role
      await cell('Export client data', 0).locator('button').first().click()
      await expectToast(page, 'Super Admin always has every permission')
      // Management cannot change a limit
      await rowWith(page, 'Issue refunds').getByText('≤ $500', { exact: true }).click()
      await expectToast(page, /Super Admin only/)
      await shot(page, 'roles-matrix')
      // custom role
      await page.getByRole('button', { name: 'Custom role' }).click()
      await expectToast(page, 'Custom role added — adjust its permissions below')
      const after = await api(req, '/roles')
      const custom = after.roles.find((r: any) => r.custom && r.id !== undefined)
      check(custom, 'custom role in the API')
      await page
        .getByText(custom.name.toUpperCase(), { exact: true })
        .first()
        .waitFor()
        .catch(() => {})
      await shot(page, 'roles-custom')
      await page.getByRole('button', { name: 'Remove' }).first().click()
      await expectToast(page, `${custom.name} removed`)
      await reload(page, 'roles')
      check(!(await api(req, '/roles')).roles.some((r: any) => r.id === custom.id), 'custom role gone')
    },
  )

  // ---- VIP -------------------------------------------------------------------------------------------------------------
  await step('vip: hold, stepper, client by partial name (candidates), remove, all persisted', async () => {
    await reload(page, 'vip')
    await page.getByRole('button', { name: 'Add hold' }).click()
    await expectToast(page, 'Sat 11:00 AM held for VIPs')
    await page.getByRole('button', { name: 'Add hold' }).click()
    await expectToast(page, 'That slot is already held')
    await reload(page, 'vip')
    check(
      await page.getByText('Saturday · 11:00 AM', { exact: true }).isVisible(),
      'hold listed after reload',
    )
    const vip = await api(req, '/vip')
    check(
      vip.holds.some((h: any) => h.weekday === 6 && h.time === '11:00 AM'),
      'hold in the API',
    )
    // remove it: the ✕ next to the chip
    await xp(page, `//div[./span[normalize-space(.)='Saturday · 11:00 AM']]`)
      .first()
      .locator('button')
      .click()
    await sleep(700)
    check(
      !(await api(req, '/vip')).holds.some((h: any) => h.weekday === 6 && h.time === '11:00 AM'),
      'hold removed',
    )
    // stepper: VIP window 30 -> 37 -> 30
    const win = optionRow(page, 'VIP booking window')
    await win.locator('button').last().click()
    await sleep(700)
    eq((await api(req, '/vip')).windowVip, 37, 'API window after +')
    await win.locator('button').first().click()
    await sleep(700)
    eq((await api(req, '/vip')).windowVip, 30, 'API window restored')
    // clients: a partial name is not a match, the server answers with the customers it could mean
    expected4xx = [/^409 POST \/api\/v1\/vip\/clients/]
    await page.getByPlaceholder('Client name').fill('Chen')
    await page.getByRole('button', { name: 'Make VIP' }).click()
    const prompt = page.getByText('More than one client matches that name. Pick the right one:')
    await prompt.waitFor()
    await prompt.scrollIntoViewIfNeeded()
    await shot(page, 'vip-candidates')
    await page.locator('button', { hasText: /Liam Chen · .*already VIP/ }).click()
    await expectToast(page, 'Liam Chen is already VIP')
    // a customer who is not VIP yet: pick from the candidates, check the list, remove again
    const before = (await api(req, '/vip/clients')).items.map((c: any) => c.fullName)
    await page.getByPlaceholder('Client name').fill('Okaf')
    await page.getByRole('button', { name: 'Make VIP' }).click()
    await prompt.waitFor()
    expected4xx = []
    await page.locator('button', { hasText: /^David Okafor/ }).click()
    await expectToast(page, 'David Okafor is now VIP')
    eq(
      (await api(req, '/vip/clients')).items.map((c: any) => c.fullName).sort(),
      [...before, 'David Okafor'].sort(),
      'client added by id',
    )
    await reload(page, 'vip')
    check(await page.getByText('David Okafor', { exact: true }).isVisible(), 'client listed after reload')
    await xp(page, `//div[./span[normalize-space(.)='David Okafor']]`)
      .first()
      .getByRole('button', { name: 'Remove' })
      .click()
    await eventually(
      async () => (await api(req, '/vip/clients')).items.map((c: any) => c.fullName).sort(),
      before.sort(),
      'client removed',
    )
  })

  // ---- arrival ---------------------------------------------------------------------------------------------------------
  await step('arrival: toggles and chips persist across a reload', async () => {
    await reload(page, 'arrival')
    await optionRow(page, 'Send welcome message').locator('button').click()
    await sleep(700)
    eq((await api(req, '/arrival-settings')).welcome, false, 'API welcome off')
    check(!(await page.getByText('Customer gets a welcome message.').isVisible()), 'explainer follows')
    await page.getByRole('button', { name: '500 m' }).click()
    await sleep(700)
    await reload(page, 'arrival')
    const a = await api(req, '/arrival-settings')
    eq([a.welcome, a.radius], [false, 500], 'API after reload')
    check(await page.getByText('Within 500 m').isVisible(), 'step text follows the radius')
    await shot(page, 'arrival')
    await optionRow(page, 'Send welcome message').locator('button').click()
    await page.getByRole('button', { name: '300 m' }).click()
    await sleep(700)
    const b = await api(req, '/arrival-settings')
    eq([b.welcome, b.radius], [true, 300], 'API restored')
  })

  // ---- services --------------------------------------------------------------------------------------------------------
  await step('services: rename keeps the task id, reorder, add and remove persist (debounced)', async () => {
    await reload(page, 'services')
    const name = 'Premium Hand Wash + Interior'
    const svc = async () => (await api(req, '/services')).packages.find((p: any) => p.name === name)
    const before = await svc()
    const ids = before.tasks.map((t: any) => t.id)
    const inputs = page.locator('input[value="Tire shine"]')
    await inputs.fill('Tire shine and dress')
    await sleep(1500)
    let now = await svc()
    eq(
      now.tasks.map((t: any) => t.id),
      ids,
      'rename kept every id',
    )
    eq(now.tasks[3].label, 'Tire shine and dress', 'renamed in the API')
    // move it down one place
    const taskRow = (v: string): Locator => xp(page, `//div[./input[@value='${v}']]`).first()
    await taskRow('Tire shine and dress').getByTitle('Move down').click()
    await sleep(1500)
    now = await svc()
    eq(now.tasks[4].id, ids[3], 'reorder kept the id, moved it')
    // add a task with Enter
    await page.getByPlaceholder('Add a task…').fill('E2E final check')
    await page.getByPlaceholder('Add a task…').press('Enter')
    await sleep(1500)
    now = await svc()
    eq(now.tasks.at(-1).label, 'E2E final check', 'added task last')
    await reload(page, 'services')
    check(await page.locator('input[value="E2E final check"]').isVisible(), 'added task after reload')
    await shot(page, 'services')
    // undo: remove the added task, move back, rename back
    await taskRow('E2E final check').getByTitle('Remove').click()
    await taskRow('Tire shine and dress').getByTitle('Move up').click()
    await page.locator('input[value="Tire shine and dress"]').fill('Tire shine')
    await sleep(1500)
    now = await svc()
    eq(
      now.tasks.map((t: any) => t.label),
      before.tasks.map((t: any) => t.label),
      'restored',
    )
    eq(
      now.tasks.map((t: any) => t.id),
      ids,
      'ids unchanged by the round trip',
    )
  })

  // ---- realtime and merging ---------------------------------------------------------------------------------------------
  await step(
    'realtime: a closure added elsewhere appears without a reload, and goes away again',
    async () => {
      const name = 'E2E remote ' + unique
      await reload(page, 'closures')
      const taken = new Set<string>((await api(req, '/closures')).upcoming.map((c: any) => c.date))
      let date = isoDate(60)
      for (let n = 61; taken.has(date); n++) date = isoDate(n)
      const made = await write(bg, 'POST', '/closures', {
        date,
        name,
        type: 'closed',
        notify: false,
      })
      await page.getByText(name, { exact: true }).waitFor({ timeout: 10_000 })
      await shot(page, 'realtime-closure')
      await write(bg, 'DELETE', `/closures/${made.closure.id}`)
      await page.getByText(name, { exact: true }).waitFor({ state: 'detached', timeout: 10_000 })
    },
  )

  await step(
    'hours: an edit made elsewhere is merged under the unsaved edit, and one Save keeps both',
    async () => {
      await reload(page, 'hours')
      const was = await api(req, '/settings/hours')
      eq([was.days[1].from, was.days[2].to], ['8:00 AM', '6:00 PM'], 'seeded days')
      await rowWith(page, 'Monday').locator('button').nth(2).click() // Monday opens 8:30 (unsaved)
      await page.getByText('Unsaved changes to working hours').waitFor()
      const days = was.days.map((d: any) => ({ weekday: d.weekday, open: d.open, from: d.from, to: d.to }))
      days[2].to = '6:30 PM' // somebody else: Tuesday closes 6:30
      await write(bg, 'PUT', '/settings/hours', { days, version: was.version })
      await page.waitForFunction(() => document.body.innerText.includes('6:30 PM'), null, { timeout: 10_000 })
      check(
        (await rowWith(page, 'Monday').innerText()).includes('8:30 AM'),
        'the unsaved edit is still there',
      )
      check(
        (await rowWith(page, 'Tuesday').innerText()).includes('6:30 PM'),
        'the other person’s change arrived',
      )
      await shot(page, 'hours-merged')
      await page.getByRole('button', { name: 'Save changes' }).click()
      await expectToast(page, 'Working hours saved')
      const now = await api(req, '/settings/hours')
      eq([now.days[1].from, now.days[2].to], ['8:30 AM', '6:30 PM'], 'both edits persisted')
      // undo
      const back = now.days.map((d: any) => ({ weekday: d.weekday, open: d.open, from: d.from, to: d.to }))
      back[1].from = '8:00 AM'
      back[2].to = '6:00 PM'
      await write(bg, 'PUT', '/settings/hours', { days: back, version: now.version })
      await eventually(async () => (await api(req, '/settings/hours')).days[1].from, '8:00 AM', 'restored')
    },
  )

  await step(
    'employees: the drawer’s effective permissions equal the server’s for every person',
    async () => {
      const roles = mapRoles(await api(req, '/roles'))
      const list = (await api(req, '/employees')).items as { id: string }[]
      let rows = 0
      for (const e of list) {
        const detail = await api(req, `/employees/${e.id}`)
        const emp = mapEmployeeDetail(detail)
        for (const row of detail.effectivePermissions as { key: string; on: boolean; src: string }[]) {
          const mine = effective(roles, emp, row.key)
          eq([mine.on, mine.src], [row.on, row.src], `${detail.fullName} / ${row.key}`)
          rows++
        }
      }
      check(rows >= 7 * 27, `compared ${rows} permission rows`)
    },
  )

  await step('employees: a person added or changed elsewhere shows up in the open list', async () => {
    await reload(page, 'employees')
    const last = 'Hire' + unique
    const made = await write(bg, 'POST', '/employees', {
      first: 'Remote',
      last,
      phone: `(786) 555-${String(Number(unique.slice(-4)) + 1).padStart(4, '0')}`,
    })
    await page.getByText('Remote ' + last, { exact: true }).waitFor({ timeout: 10_000 })
    await write(bg, 'POST', `/employees/${made.employee.id}/deactivate`)
    const row = xp(page, `//button[.//div[normalize-space(.)='Remote ${last}']]`).first()
    await row.getByText('Inactive', { exact: true }).waitFor({ timeout: 10_000 })
    await shot(page, 'realtime-employee')
  })

  await step('theme: toggling saves the preference on the server', async () => {
    await page
      .locator('header button')
      .filter({ has: page.locator('svg') })
      .first()
      .click()
      .catch(() => {})
    await sleep(600)
    const me = await api(mctx.request, '/me')
    check(
      me.preferences.theme === 'dark' || me.preferences.theme === 'light',
      'preference set: ' + me.preferences.theme,
    )
    await shot(page, 'dark')
    await page
      .locator('header button')
      .filter({ has: page.locator('svg') })
      .first()
      .click()
      .catch(() => {})
    await sleep(600)
  })
  await mctx.close()
  await bg.close()

  // ================================================================================================== Super Admin
  console.log('Super Admin (amara)')
  const { ctx: sctx, page: sp } = await session(EMAILS.superAdmin, 'super')
  await step('roles: a Super Admin changes a limit chip (cents on the wire) and wraps it back', async () => {
    await open(sp)
    await section(sp, 'roles')
    const rolesBefore = await api(sctx.request, '/roles')
    const acct = rolesBefore.roles.find((r: any) => r.key === 'acct')
    eq(rolesBefore.limits[acct.id].refund, 50000, 'seeded Accounting refund limit')
    const refundRow = rowWith(sp, 'Issue refunds')
    await refundRow.getByText('≤ $500', { exact: true }).click()
    await sleep(800)
    eq((await api(sctx.request, '/roles')).limits[acct.id].refund, 100000, 'API limit in cents')
    await reload(sp, 'roles')
    check(await sp.getByText('≤ $1,000', { exact: true }).first().isVisible(), 'label after reload')
    await shot(sp, 'roles-limit')
    const accountingCol = rolesBefore.roles.findIndex((r: any) => r.key === 'acct')
    for (let i = 0; i < 6; i++) {
      // 1,000 -> No limit -> 25 -> 50 -> 100 -> 250 -> 500
      await xp(sp, `//div[./div[normalize-space(.)='Issue refunds']]/div[${accountingCol + 2}]`)
        .last()
        .locator('button')
        .nth(1)
        .click()
      await sleep(600)
    }
    eq((await api(sctx.request, '/roles')).limits[acct.id].refund, 50000, 'API limit restored')
  })
  await sctx.close()

  // ===================================================================================================== Support
  console.log('Support (sofia)')
  const { ctx: pctx, page: pp } = await session(EMAILS.support, 'support')
  await step(
    'support: sections lock per permission, writes show "Your role can’t ..." and never call the API',
    async () => {
      await open(pp)
      const writes: string[] = []
      pp.on('request', (r) => {
        if (
          ['PUT', 'POST', 'PATCH', 'DELETE'].includes(r.method()) &&
          r.url().includes('/api/v1/') &&
          !/\/(me|auth)\b/.test(r.url())
        )
          writes.push(`${r.method()} ${r.url().replace(stack.webUrl, '')}`)
      })
      await rowWith(pp, 'Monday').locator('button').nth(4).click()
      await expectToast(pp, 'Your role can’t change hours and closures')
      check(!(await pp.getByText('Unsaved changes to working hours').isVisible()), 'no edit happened')
      await shot(pp, 'support-hours')
      await section(pp, 'emergency')
      await pp.getByText('You don’t have access to Emergency closing').waitFor()
      await shot(pp, 'support-emergency-locked')
      await section(pp, 'employees')
      await pp.getByText('Sofia Duarte', { exact: true }).waitFor()
      await pp.getByRole('button', { name: 'Add employee' }).click()
      await expectToast(pp, 'Your role can’t edit employees')
      // pay data is withheld without team.edit
      await pp.getByText('Marco Ruiz', { exact: true }).click()
      await pp.getByPlaceholder('Pay hidden').waitFor()
      await shot(pp, 'support-employee')
      await pp.getByRole('button', { name: 'Cancel' }).click()
      await section(pp, 'roles')
      await xp(pp, `//div[./div[normalize-space(.)='Export client data']]/div[6]`)
        .last()
        .locator('button')
        .first()
        .click()
      await expectToast(pp, 'Your role can’t change roles')
      await section(pp, 'services')
      await pp.locator('input[value="Tire shine"]').fill('x')
      await expectToast(pp, 'Your role can’t edit packages and checklists')
      eq(writes, [], 'no write request left the browser')
    },
  )
  await pctx.close()

  // ======================================================================================================== Crew
  console.log('Crew (marco)')
  const { ctx: cctx, page: cp } = await session(EMAILS.crew, 'crew')
  await step('crew: /settings is the locked card and the API refuses every write with 403', async () => {
    await cp.goto(`${stack.webUrl}/settings`, { waitUntil: 'load' })
    await cp.getByText('No settings access').waitFor({ timeout: 15_000 })
    await shot(cp, 'crew-locked')
    expected4xx = [/^403 /]
    const csrf = (await api(cctx.request, '/auth/csrf')).csrfToken as string
    const headers = {
      'X-CSRF-Token': csrf,
      Origin: stack.webUrl,
      'Idempotency-Key': 'e2e-crew-' + unique,
      'Content-Type': 'application/json',
    }
    const h = await api(cctx.request, '/settings/hours')
    const put = await cctx.request.put(`${stack.webUrl}/api/v1/settings/hours`, {
      headers,
      data: { days: h.days, version: h.version },
    })
    eq(put.status(), 403, 'PUT /settings/hours as Crew')
    const emerg = await cctx.request.post(`${stack.webUrl}/api/v1/emergency/close`, {
      headers,
      data: { reason: 'Other', dur: 'today' },
    })
    eq(emerg.status(), 403, 'POST /emergency/close as Crew')
    const roles = await cctx.request.get(`${stack.webUrl}/api/v1/roles`)
    eq(roles.status(), 403, 'GET /roles as Crew')
    const bundle = await api(cctx.request, '/settings/bundle')
    eq(
      bundle.omitted.sort(),
      ['counts.employees', 'emergency.history', 'vip.clients'],
      'bundle omits what Crew cannot read',
    )
    expected4xx = []
  })
  await cctx.close()
} finally {
  await browser.close()
}

// ---- summary ---------------------------------------------------------------------------------------------------------

const failed = results.filter((r) => !r.ok)
console.log(
  `\n${results.length - failed.length}/${results.length} steps passed; ${problems.length} page or API problems`,
)
for (const p of problems) console.log('  problem:', p)
for (const f of failed) console.log('  failed:', f.step, '::', f.detail)
console.log(`screenshots: ${path.relative(root, shots)}/ (${shotNo})`)
process.exit(failed.length || problems.length ? 1 : 0)
