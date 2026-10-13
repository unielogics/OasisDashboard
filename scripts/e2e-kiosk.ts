/* eslint-disable @typescript-eslint/no-explicit-any */
// e2e-kiosk — kiosk mode (ADR 0180) end to end: the live dashboard against the real API on a stack started by
// scripts/live-stack.ts with a backend that has the kiosk core (wave K1a).
//
//   export SMS_ALLOWLIST=+13055550171,+13055550172 ALLOW_DEV_ENDPOINTS=true
//   pnpm live:up --name kiosk --api-port 4031 --web-port 3231 --profile design,parity-ops \
//        --freeze 2026-06-13T10:36:00-04:00 --backend ~/oasis/wt/k-kiosk-core
//   pnpm e2e:kiosk --name kiosk [--keep-going]
//   pnpm live:down --name kiosk --drop
//
// The stack must be freshly seeded (the run sets the shop code, registers a tablet, turns kiosk mode on and writes).
// Steps: a manager sets the code, makes the browser a kiosk (Settings → Kiosk) and turns kiosk mode on → signing out shows
// the keypad → 0218 reveals the email form → Back → the code unlocks Operations only → a drag to a bay asks who (the
// picker) and sends X-Oasis-Employee → the bay card's worker and the History line (what this backend records; the worker
// write lands with the attribution package: reported PENDING, not failed) → complete, collect and text with the picker →
// a direct PUT /settings/hours answers 403 → /settings goes back to /operations → Lock kiosk → wrong codes show the
// countdown → the manager removes the tablet → "Codes work only on the shop’s kiosk tablet." → Team activity (501 until
// the report is built: PENDING).
// Exit code 1 when any check fails, a page errors or the API answers 5xx. PENDING lines never fail the run.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'
import type { Browser, BrowserContext, Page, Request } from '@playwright/test'
import { EMAILS, loadStack, login } from './live-e2e'
import type { LiveStack } from './live-e2e'

process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE ??= 'ubuntu24.04-arm64'

const args = process.argv.slice(2)
const flag = (n: string, d: string): string => (args.includes(n) ? args[args.indexOf(n) + 1]! : d)
const stack: LiveStack = loadStack(flag('--name', 'kiosk'))
const keepGoing = args.includes('--keep-going')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const shots = path.join(root, 'parity-reports', 'e2e-kiosk')
fs.mkdirSync(shots, { recursive: true })

/** The shop code of the run: 8 digits, no run, no repeat pattern, no date, not starting with 0218. */
const CODE = '58149263'
const WRONG = '73920584'

let passed = 0
const failures: string[] = []
const pending: string[] = []
const pageErrors: string[] = []
const apiBad: string[] = []

function ok(cond: unknown, name: string, detail?: unknown): void {
  if (cond) {
    passed++
    console.log('  ok   ' + name)
    return
  }
  const d = detail === undefined ? '' : ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))
  failures.push(name + d)
  console.log('  FAIL ' + name + d.slice(0, 700))
  if (!keepGoing && failures.length > 25) throw new Error('too many failures')
}
/** Expected only once the attribution package (wave K1b) is merged: reported, never failed. */
function later(cond: unknown, name: string, detail?: unknown): void {
  if (cond) {
    passed++
    console.log('  ok   ' + name)
    return
  }
  const d = detail === undefined ? '' : ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))
  pending.push(name + d)
  console.log('  PENDING ' + name + d.slice(0, 300))
}
const section = (s: string): void => console.log('\n== ' + s)
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function until<T>(fn: () => Promise<T>, ms = 8000): Promise<T | undefined> {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) return undefined
    await sleep(150)
  }
}

/** A request from the page with its cookies (and, for a write, a fresh CSRF token and Idempotency-Key). */
async function api<T = any>(page: Page, method: string, url: string, body?: unknown): Promise<{ status: number; body: T }> {
  return page.evaluate(
    async ([method, url, body]) => {
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (method !== 'GET') {
        const csrf = await (await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' })).json()
        headers['X-CSRF-Token'] = csrf.csrfToken
        headers['Idempotency-Key'] = crypto.randomUUID()
        headers['Content-Type'] = 'application/json'
      }
      const r = await fetch('/api/v1' + url, {
        method,
        headers,
        body: body === null ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
      })
      const t = await r.text()
      let b: unknown = t
      try {
        b = JSON.parse(t)
      } catch {
        /* text */
      }
      return { status: r.status, body: b }
    },
    [method, url, body ?? null] as [string, string, unknown],
  ) as Promise<{ status: number; body: T }>
}

interface Seen {
  method: string
  path: string
  actor: string | undefined
}

async function context(browser: Browser, label: string): Promise<{ ctx: BrowserContext; page: Page; seen: Seen[] }> {
  const ctx = await browser.newContext({
    viewport: { width: 1480, height: 1000 },
    timezoneId: 'America/New_York',
    locale: 'en-US',
  })
  await ctx.addInitScript('window.__name = (f) => f')
  const page = await ctx.newPage()
  const seen: Seen[] = []
  page.on('pageerror', (e) => pageErrors.push(`${label}: ${String(e)}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text()))
      pageErrors.push(`${label}: console: ${m.text()}`)
  })
  page.on('request', (r: Request) => {
    if (!r.url().includes('/api/v1/')) return
    seen.push({ method: r.method(), path: new URL(r.url()).pathname, actor: r.headers()['x-oasis-employee'] })
  })
  page.on('response', (r) => {
    if (r.url().includes('/api/v1/') && r.status() >= 500)
      apiBad.push(`${label}: ${r.status()} ${r.request().method()} ${r.url()}`)
  })
  return { ctx, page, seen }
}

const shot = async (page: Page, name: string): Promise<void> =>
  void (await page.screenshot({ path: path.join(shots, name + '.png') }))

const text = (page: Page): Promise<string> => page.evaluate(() => document.body.innerText)

const toastText = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const el = document.querySelector('#dc-root div[style*="z-index: 90"]')
    return (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
  })

async function waitToast(page: Page, includes: string, ms = 8000): Promise<string> {
  let last = ''
  await until(async () => {
    last = await toastText(page)
    return last.includes(includes)
  }, ms)
  return last
}

const picker = (page: Page) => page.locator('[data-kiosk-picker]')

/** Waits for the employee picker, checks its question, taps the person whose name starts with `first`. */
async function tap(page: Page, first: string, question?: RegExp): Promise<string> {
  await picker(page).waitFor({ timeout: 8000 })
  const title = ((await picker(page).locator('div').first().textContent()) ?? '').replace(/\s+/g, ' ')
  if (question) ok(question.test(title), 'the picker asks: ' + question.source, title)
  await picker(page).locator('[data-kiosk-tile]', { hasText: first }).first().click()
  await picker(page).waitFor({ state: 'detached', timeout: 5000 })
  return title
}

async function dragTo(page: Page, from: ReturnType<Page['locator']>, to: ReturnType<Page['locator']>): Promise<void> {
  await from.scrollIntoViewIfNeeded()
  const a = (await from.boundingBox())!
  const gx = a.x + a.width / 2
  const gy = a.y + a.height * 0.6
  const b = (await to.boundingBox())!
  const vh = page.viewportSize()!.height
  const top = Math.max(b.y, 0)
  const bottom = Math.min(b.y + b.height, vh - 40)
  const tx = b.x + b.width / 2
  const ty = (top + bottom) / 2
  await page.mouse.move(gx, gy)
  await page.mouse.down()
  await page.mouse.move(gx + 30, gy + 10, { steps: 4 })
  await page.mouse.move(tx, ty, { steps: 12 })
  await page.mouse.move(tx + 2, ty + 2, { steps: 2 })
  await page.mouse.up()
}

const modal = (page: Page) => page.locator('div[style*="z-index: 60"]').first()

async function openFile(page: Page, name: string): Promise<void> {
  await page.locator('#dc-root button', { hasText: name }).filter({ hasNot: page.locator('[data-drop]') }).first().click()
  await modal(page).waitFor({ timeout: 10_000 })
}

async function tab(page: Page, label: string): Promise<void> {
  await modal(page).locator('button', { hasText: label }).first().click()
  await sleep(300)
}

async function keypadType(page: Page, digits: string): Promise<void> {
  for (const d of digits) await page.locator(`[data-key="${d}"]`).click()
}

const writesWith = (seen: Seen[], method: string, re: RegExp): Seen[] =>
  seen.filter((s) => s.method === method && re.test(s.path))

async function main(): Promise<void> {
  const browser = await chromium.launch()
  try {
    // ---------------------------------------------------------------------------------------------------------------
    section('a manager sets the code, makes this browser a kiosk and turns kiosk mode on')
    const T = await context(browser, 'tablet')
    const tablet = T.page
    await login(tablet, stack, EMAILS.manager, '/operations')
    await tablet.waitForSelector('text=Appointments 24h', { timeout: 30_000 })
    let r = await api(tablet, 'PUT', '/kiosk/code', { code: CODE })
    ok(r.status === 200, 'PUT /kiosk/code sets the shop code', r)
    await tablet.goto(`${stack.webUrl}/settings#kiosk`)
    await tablet.waitForSelector('text=Kiosk tablets', { timeout: 20_000 })
    ok((await text(tablet)).includes('Set Jun 13 by Rafael'), 'Settings → Kiosk shows when and by whom the code was set')
    await tablet.locator('input[title="Tablet name"]').fill('Front desk tablet')
    await tablet.getByRole('button', { name: 'Make this a kiosk' }).click()
    await until(async () => (await text(tablet)).includes('This browser is the kiosk'), 10_000)
    ok((await text(tablet)).includes('This browser is the kiosk “Front desk tablet”.'), 'Make this a kiosk registers this browser')
    const cookies = (await T.ctx.cookies()).map((c) => c.name)
    ok(cookies.some((n) => /oasis_kdev$/.test(n)), 'the device cookie is set', cookies)
    await tablet.locator('button[title="Kiosk mode on or off"]').click()
    await until(async () => (await api(tablet, 'GET', '/kiosk')).body.enabled === true)
    const overview = (await api(tablet, 'GET', '/kiosk')).body
    ok(overview.enabled === true, 'kiosk mode is on')
    const deviceId: string = overview.thisDeviceId
    ok(!!deviceId, 'GET /kiosk names this browser', overview.thisDeviceId)
    await shot(tablet, '01-settings-kiosk')

    // ---------------------------------------------------------------------------------------------------------------
    section('the keypad and the hidden email form')
    await tablet.locator('[data-live-menu="user"] > div').first().click()
    await tablet.getByRole('button', { name: 'Sign out' }).click()
    await tablet.waitForURL((u) => u.pathname === '/login', { timeout: 15_000 })
    await tablet.waitForSelector('text=Enter the shop code', { timeout: 15_000 })
    ok((await text(tablet)).includes('Front desk tablet'), 'the keypad names the tablet')
    ok((await tablet.locator('input[name=email]').count()) === 0, 'no email field on the keypad')
    ok((await tablet.locator('[data-key]').count()) === 12, 'twelve keys')
    const keyBox = await tablet.locator('[data-key="5"]').boundingBox()
    ok((keyBox?.height ?? 0) >= 72, 'keys at least 72 px tall', keyBox)
    await shot(tablet, '02-keypad')
    const beforeReveal = T.seen.length
    await keypadType(tablet, '0218')
    await tablet.waitForSelector('input[name=email]', { timeout: 3000 })
    ok(true, '0218 reveals the email/password card')
    ok(!T.seen.slice(beforeReveal).some((s) => s.path.endsWith('/kiosk/unlock')), '0218 sends nothing')
    await shot(tablet, '03-reveal')
    await tablet.getByRole('link', { name: 'Back to keypad' }).click()
    await tablet.waitForSelector('text=Enter the shop code')
    ok((await tablet.locator('input[name=email]').count()) === 0, 'Back to keypad hides the form again')

    // ---------------------------------------------------------------------------------------------------------------
    section('the code unlocks Operations, and only Operations')
    await tablet.keyboard.type(CODE, { delay: 40 })
    await tablet.waitForURL((u) => u.pathname === '/operations', { timeout: 15_000 })
    await tablet.waitForSelector('text=Appointments 24h', { timeout: 30_000 })
    ok(true, 'the code (typed on the keyboard) opens Operations')
    const kioskMe = (await api(tablet, 'GET', '/kiosk/me')).body
    const staff: Array<{ id: string; name: string; first: string }> = kioskMe.staff ?? []
    const marco = staff.find((s) => s.first === 'Marco')
    ok(!!marco, 'the picker lists Marco', staff.map((s) => s.name))
    ok((await tablet.locator('a[href="/payments"]').count()) === 0, 'no Payments tab on the kiosk')
    ok((await tablet.locator('a[href="/settings"]').count()) === 0, 'no Settings tab on the kiosk')
    ok((await text(tablet)).includes('Locks at'), 'the chip says when the kiosk locks')
    await shot(tablet, '04-kiosk-board')

    // ---------------------------------------------------------------------------------------------------------------
    section('a car to a bay: the picker asks who, the request names them')
    const assignBefore = T.seen.length
    await dragTo(
      tablet,
      tablet.locator('#dc-root button', { hasText: 'Marcus Webb' }).first(),
      tablet.locator('[data-drop="bay:2"]').first(),
    )
    ok(!T.seen.slice(assignBefore).some((s) => s.path.endsWith('/assign-bay')), 'nothing is sent before a name is tapped')
    await shot(tablet, '05-picker')
    await tap(tablet, 'Marco', /^Who’s putting Marcus’s .+ in Bay 2\?/)
    let tt = await waitToast(tablet, 'Bay 2')
    ok(tt.includes('Bay 2'), 'the server’s toast after the drop', tt)
    const assign = writesWith(T.seen.slice(assignBefore), 'POST', /\/assign-bay$/)
    ok(assign.length === 1 && assign[0]!.actor === marco?.id, 'POST assign-bay carries X-Oasis-Employee = Marco', assign)
    const cards = (await api(tablet, 'GET', '/ops/snapshot?window=next24')).body
    const bay2 = cards.bays?.find((b: any) => b.number === 2)
    ok(bay2?.occupant?.card?.customer?.name === 'Marcus Webb', 'Marcus is in Bay 2 in the API')
    later(bay2?.occupant?.worker?.name?.startsWith('Marco'), 'the bay card’s worker is Marco (attribution package)', bay2?.occupant?.worker)
    const marcusId: string | undefined = bay2?.occupant?.card?.id
    if (marcusId) {
      const file = (await api(tablet, 'GET', `/appointments/${marcusId}`)).body
      const line = (file.activity ?? []).find((a: any) => /bay|clean|start/i.test(a.text ?? ''))
      later(
        (file.activity ?? []).some((a: any) => (a.actorName ?? '').startsWith('Marco')),
        'History reads “Today · Marco R.” for the bay step',
        line,
      )
    }

    // ---------------------------------------------------------------------------------------------------------------
    section('complete, collect and text, each with the picker')
    await tablet.locator('#dc-root button', { hasText: 'Bay Board' }).first().click()
    await sleep(500)
    const completeBefore = T.seen.length
    await tablet.locator('[data-drop="bay:1"]').getByRole('button', { name: 'Mark Complete' }).click()
    await tap(tablet, 'Lena')
    tt = await waitToast(tablet, 'completed')
    ok(tt.toLowerCase().includes('completed'), 'Mark Complete from the bay card, after the picker', tt)
    const lena = staff.find((s) => s.first === 'Lena')
    const adv = T.seen.slice(completeBefore).filter((s) => s.method === 'POST' && /\/(advance|complete)$/.test(s.path))
    ok(adv.length >= 1 && adv.every((s) => s.actor === lena?.id), 'the completion names Lena', adv)
    await tablet.locator('#dc-root button', { hasText: 'Timeline' }).first().click()
    await sleep(500)
    await openFile(tablet, 'Jonathan Franco')
    await modal(tablet).getByRole('button', { name: 'Collect Payment', exact: true }).click()
    await sleep(300)
    await modal(tablet).getByRole('button', { name: 'Cash', exact: true }).click()
    const payBefore = T.seen.length
    await modal(tablet).getByRole('button', { name: /^Mark Paid/ }).click()
    await tap(tablet, 'Marco', /^Who’s taking Jonathan’s payment\?/)
    tt = await waitToast(tablet, 'Payment collected', 10_000)
    ok(tt.includes('Payment collected'), 'Mark Paid by cash after the picker', tt)
    const pays = T.seen.slice(payBefore).filter((s) => s.method === 'POST' && /\/invoices\/[^/]+\/(payments|receipt)$/.test(s.path))
    ok(pays.length === 2 && pays.every((s) => s.actor === marco?.id), 'payment and receipt carry the one name asked', pays)
    await tab(tablet, 'Messages')
    const composer = modal(tablet).locator('input[placeholder="Type a message…"]')
    await composer.fill('Your car is ready at the front.')
    const textBefore = T.seen.length
    await composer.press('Enter')
    await tap(tablet, 'Sofia', /^Who’s texting Jonathan\?/)
    tt = await waitToast(tablet, 'Message sent')
    ok(tt.includes('Message sent'), 'the text is sent after the picker', tt)
    ok((await text(tablet)).includes('As Sofia'), 'the file shows “As Sofia … · Change”')
    await composer.fill('See you soon.')
    await composer.press('Enter')
    await sleep(800)
    ok((await picker(tablet).count()) === 0, 'a second text within 2 minutes does not ask again')
    const texts = writesWith(T.seen.slice(textBefore), 'POST', /\/appointments\/[^/]+\/messages$/)
    const sofia = staff.find((s) => s.first === 'Sofia')
    ok(texts.length === 2 && texts.every((s) => s.actor === sofia?.id), 'both texts name Sofia', texts)
    await shot(tablet, '06-file-acting')
    await tablet.keyboard.press('Escape')

    // ---------------------------------------------------------------------------------------------------------------
    section('the kiosk cannot reach Settings, even by direct URL')
    r = await api(tablet, 'PUT', '/settings/hours', { days: [] })
    ok(r.status === 403 && (r.body as any)?.code === 'KIOSK_FORBIDDEN', 'a direct PUT /settings/hours answers 403 KIOSK_FORBIDDEN', r)
    await tablet.goto(`${stack.webUrl}/settings`)
    await tablet.waitForURL((u) => u.pathname === '/operations', { timeout: 15_000 })
    ok(true, '/settings sends the kiosk back to /operations')
    await tablet.goto(`${stack.webUrl}/payments`)
    await tablet.waitForURL((u) => u.pathname === '/operations', { timeout: 15_000 })
    ok(true, '/payments sends the kiosk back to /operations')
    await tablet.waitForSelector('text=Appointments 24h', { timeout: 30_000 })

    // ---------------------------------------------------------------------------------------------------------------
    section('Lock kiosk, then wrong codes')
    await tablet.locator('[data-live-menu="user"] > div').first().click()
    await tablet.getByRole('button', { name: 'Lock kiosk' }).click()
    ok((await text(tablet)).includes('Lock the kiosk now?'), 'Lock kiosk asks first')
    await tablet.getByRole('button', { name: 'Lock', exact: true }).click()
    await tablet.waitForURL((u) => u.pathname === '/login', { timeout: 15_000 })
    await tablet.waitForSelector('text=Enter the shop code')
    ok((await text(tablet)).includes('The kiosk is locked. Enter the code to open it.'), 'the keypad says the kiosk locked')
    let countdown = ''
    for (let i = 0; i < 6 && !countdown; i++) {
      await keypadType(tablet, WRONG)
      await until(async () => (await text(tablet)).includes('didn’t work'), 5000)
      const t = await text(tablet)
      if (/Try again in \d+ s/.test(t)) countdown = t.match(/Try again in \d+ s/)![0]
      else await sleep(300)
    }
    ok((await text(tablet)).includes('That code didn’t work.'), 'a wrong code: “That code didn’t work.”')
    ok(!!countdown, 'after the free tries the keypad counts down', countdown)
    await shot(tablet, '07-countdown')

    // ---------------------------------------------------------------------------------------------------------------
    section('the manager removes the tablet; codes no longer work there')
    const M = await context(browser, 'manager')
    await login(M.page, stack, EMAILS.manager, '/operations')
    await M.page.waitForSelector('text=Appointments 24h', { timeout: 30_000 })
    r = await api(M.page, 'DELETE', `/kiosk/devices/${deviceId}`)
    ok(r.status === 200 || r.status === 204, 'DELETE /kiosk/devices/:id removes the tablet', r.status)
    await sleep(8000) // the countdown of the wrong codes
    await tablet.goto(`${stack.webUrl}/login`)
    await tablet.waitForSelector('text=Enter the shop code')
    await keypadType(tablet, CODE)
    await until(async () => (await text(tablet)).includes('Codes work only'), 8000)
    ok((await text(tablet)).includes('Codes work only on the shop’s kiosk tablet.'), 'a removed tablet: “Codes work only on the shop’s kiosk tablet.”')
    ok(tablet.url().includes('/login'), 'and it stays on the keypad')
    await shot(tablet, '08-removed')

    // ---------------------------------------------------------------------------------------------------------------
    section('Team activity')
    await M.page.goto(`${stack.webUrl}/settings`)
    await M.page.getByRole('button', { name: 'Team activity' }).click()
    await until(async () => /isn’t ready yet|Avg bay time/.test(await text(M.page)), 10_000)
    const act = await text(M.page)
    if (act.includes('isn’t ready yet')) later(false, 'Team activity counts Marco’s steps (the report answers 501 until wave K2b)')
    else later(/Marco/.test(act), 'Team activity lists Marco with his counts', act.slice(0, 300))
    await shot(M.page, '09-team-activity')
    await M.ctx.close()
    await T.ctx.close()
  } finally {
    await browser.close()
  }
}

main()
  .catch((e) => {
    failures.push('run aborted: ' + String(e?.stack ?? e))
  })
  .finally(() => {
    console.log('\n== result')
    for (const e of pageErrors) failures.push('page error: ' + e)
    for (const e of apiBad) failures.push('API 5xx: ' + e)
    console.log(`passed ${passed}, failed ${failures.length}, pending ${pending.length}`)
    for (const p of pending) console.log('  PENDING ' + p.slice(0, 300))
    for (const f of failures) console.log('  FAIL ' + f.slice(0, 800))
    process.exitCode = failures.length ? 1 : 0
  })
