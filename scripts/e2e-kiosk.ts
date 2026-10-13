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
        if (body !== null) headers['Content-Type'] = 'application/json'
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
    // 4xx are answers; 501 is the team activity report until wave K2b builds it (checked as PENDING below)
    if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of (4\d\d|501)/.test(m.text()))
      pageErrors.push(`${label}: console: ${m.text()}`)
  })
  page.on('request', (r: Request) => {
    if (!r.url().includes('/api/v1/')) return
    seen.push({ method: r.method(), path: new URL(r.url()).pathname, actor: r.headers()['x-oasis-employee'] })
  })
  page.on('response', (r) => {
    if (r.url().includes('/api/v1/') && r.status() >= 500 && !(r.status() === 501 && r.url().includes('/reports/employee-activity')))
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
  const title = ((await picker(page).locator('div').first().textContent()) ?? '').replace(/\s+/g, ' ').trim()
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

/** The appointment id of a customer's card on today's board. */
async function cardId(page: Page, name: string): Promise<string | undefined> {
  const snap = (await api(page, 'GET', '/ops/snapshot?window=next24')).body
  const cards = [
    ...(snap.timeline?.groups ?? []).flatMap((g: any) => g.items),
    ...(snap.completed?.items ?? []),
    ...(snap.bays ?? []).flatMap((b: any) => (b.occupant ? [b.occupant.card] : [])),
  ]
  return cards.find((c: any) => c.customer?.name === name)?.id
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
    // the manager's session on this browser is tied to the tablet now: short, with the bar (K4 review kiosk:F1)
    const me = (await api(tablet, 'GET', '/me')).body
    ok(me.kioskDevice?.name === 'Front desk tablet', 'the manager signed in on the tablet is on a short kiosk session', me.kioskDevice)
    const deviceId: string = me.kioskDevice?.id
    await shot(tablet, '01-settings-kiosk')
    await tablet.locator('button[title="Kiosk mode on or off"]').click()

    // ---------------------------------------------------------------------------------------------------------------
    section('the keypad and the hidden email form')
    // turning kiosk mode on from the tablet signs the manager out there: the tablet goes straight to the keypad
    await tablet.waitForURL((u) => u.pathname === '/login', { timeout: 15_000 })
    ok((await api(tablet, 'GET', '/kiosk/status')).body.enabled === true, 'kiosk mode is on')
    ok(!!deviceId, 'the tablet is a registered kiosk device', deviceId)
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
    section('one job through every step from its file, each step asking who (Grace Adeyemi)')
    const lena = staff.find((s) => s.first === 'Lena')
    const sofia = staff.find((s) => s.first === 'Sofia')
    const graceId = await cardId(tablet, 'Grace Adeyemi')
    ok(!!graceId, 'Grace Adeyemi is on the board')
    await openFile(tablet, 'Grace Adeyemi')
    const steps: Array<[string, RegExp, string, string, string | undefined]> = [
      ['Confirm Appointment', /^Who’s confirming Grace’s/, 'Confirmation sent', 'confirmed', marco?.id],
      ['Mark Arrived', /^Who’s checking in Grace’s/, 'Marked arrived', 'arrived', lena?.id],
      ['Start Cleaning', /^Who’s starting Grace’s/, 'Cleaning started', 'cleaning', marco?.id],
      ['Mark Complete', /^Who finished Grace’s/, 'Job completed', 'completed', lena?.id],
    ]
    for (const [label, question, toast, status, who] of steps) {
      const before = T.seen.length
      await modal(tablet).getByRole('button', { name: label, exact: true }).click()
      await tap(tablet, who === lena?.id ? 'Lena' : 'Marco', question)
      const t = await waitToast(tablet, toast)
      ok(t.includes(toast), `${label}: the server's toast after the picker`, t)
      const st = await until(async () => ((await api(tablet, 'GET', `/appointments/${graceId}`)).body.status === status ? status : null))
      ok(st === status, `${label} -> ${status} in the API`, st)
      const sent = T.seen.slice(before).filter((x) => x.method === 'POST' && /\/appointments\/[^/]+\/[a-z-]+$/.test(x.path))
      ok(sent.length === 1 && sent[0]!.actor === who, `${label} names the person tapped`, sent)
    }
    // collect: one question for the payment and its receipt
    await modal(tablet).getByRole('button', { name: 'Collect Payment', exact: true }).click()
    await sleep(300)
    await modal(tablet).getByRole('button', { name: 'Cash', exact: true }).click()
    const payBefore = T.seen.length
    await modal(tablet).getByRole('button', { name: /^Mark Paid/ }).click()
    await tap(tablet, 'Marco', /^Who’s taking Grace’s payment\?/)
    let tt = await waitToast(tablet, 'Payment collected', 10_000)
    ok(tt.includes('Payment collected'), 'Mark Paid by cash after the picker', tt)
    const pays = T.seen.slice(payBefore).filter((x) => x.method === 'POST' && /\/invoices\/[^/]+\/(payments|receipt)$/.test(x.path))
    ok(pays.length === 2 && pays.every((x) => x.actor === marco?.id), 'payment and receipt carry the one name asked', pays)
    const file = (await api(tablet, 'GET', `/appointments/${graceId}`)).body
    const lines = (file.activity ?? []).map((a: any) => `${a.text} · ${a.actorName ?? ''}`)
    later(
      (file.activity ?? []).some((a: any) => /arriv/i.test(a.text ?? '') && (a.actorName ?? '').startsWith('Lena')),
      'History: “Arrival logged · Today · Lena …” (the tapped name)',
      lines.slice(0, 6),
    )
    await tablet.keyboard.press('Escape')
    await modal(tablet).waitFor({ state: 'detached', timeout: 5000 }).catch(() => undefined)

    // ---------------------------------------------------------------------------------------------------------------
    section('a booking asks once; texts ask once per open file (Dana Whitfield, an allowed number)')
    const cat = (await api(tablet, 'GET', '/services')).body
    const express = cat.packages.find((x: any) => x.name === 'Express Hand Wash')
    const slots = ((await api(tablet, 'GET', `/availability?date=2026-06-13&serviceId=${express.id}&channel=desk`)).body.slots ?? []).filter(
      (x: any) => x.state === 'available',
    )
    ok(slots.length >= 2, 'the day has open slots', slots.length)
    await tablet.locator('#dc-root button', { hasText: 'New Appointment' }).first().click()
    await tablet.waitForSelector('input[placeholder="Full name"]')
    await tablet.fill('input[placeholder="Full name"]', 'Dana Whitfield')
    await tablet.fill('input[placeholder="Phone number"]', '(305) 555-0171')
    await tablet.fill('input[placeholder="Year / Make / Model"]', '2022 Tesla Model 3')
    await tablet.fill('input[placeholder="License plate"]', 'dw-2022')
    await tablet.locator('div[style*="z-index: 70"] button', { hasText: 'Express Hand Wash' }).first().click()
    await sleep(900)
    await tablet
      .locator('div[style*="z-index: 70"] button', { hasText: new RegExp('^' + slots[1].time + '$') })
      .first()
      .click()
    const bookBefore = T.seen.length
    await tablet.locator('div[style*="z-index: 70"] button', { hasText: 'Book Appointment' }).click()
    await tap(tablet, 'Sofia', /^Who’s making this booking\?/)
    tt = await waitToast(tablet, 'booked')
    ok(tt.includes('booked'), 'the booking is made after the picker', tt)
    const books = writesWith(T.seen.slice(bookBefore), 'POST', /\/api\/v1\/appointments$/)
    ok(books.length === 1 && books[0]!.actor === sofia?.id, 'POST /appointments names Sofia', books)
    const danaId = await until(() => cardId(tablet, 'Dana Whitfield'))
    ok(!!danaId, 'Dana is on the board')
    await openFile(tablet, 'Dana Whitfield')
    await tab(tablet, 'Messages')
    const composer = modal(tablet).locator('input[placeholder="Type a message…"]')
    await composer.fill('Hi Dana, we will text you when your Tesla is ready.')
    const textBefore = T.seen.length
    await composer.press('Enter')
    await tap(tablet, 'Sofia', /^Who’s texting Dana\?/)
    tt = await waitToast(tablet, 'Message sent')
    ok(tt.includes('Message sent'), 'the text is sent after the picker', tt)
    ok((await text(tablet)).includes('As Sofia'), 'the file shows “As Sofia … · Change”')
    await composer.fill('See you soon.')
    await composer.press('Enter')
    tt = await waitToast(tablet, 'Message sent')
    ok((await picker(tablet).count()) === 0, 'a second text within 2 minutes does not ask again')
    const texts = writesWith(T.seen.slice(textBefore), 'POST', /\/appointments\/[^/]+\/messages$/)
    ok(texts.length === 2 && texts.every((x) => x.actor === sofia?.id), 'both texts name Sofia', texts)
    await shot(tablet, '05-file-acting')
    // the composer has the focus: the first Escape leaves it, the second closes the file
    await tablet.keyboard.press('Escape')
    await tablet.keyboard.press('Escape')
    await modal(tablet).waitFor({ state: 'detached', timeout: 5000 }).catch(() => undefined)

    // ---------------------------------------------------------------------------------------------------------------
    section('a car to a bay by drag: the picker asks who, the request names them')
    const assignBefore = T.seen.length
    await dragTo(
      tablet,
      tablet.locator('#dc-root button', { hasText: 'Marcus Webb' }).first(),
      tablet.locator('[data-drop="bay:2"]').first(),
    )
    await picker(tablet).waitFor({ timeout: 8000 })
    ok(!T.seen.slice(assignBefore).some((x) => x.path.endsWith('/assign-bay')), 'nothing is sent before a name is tapped')
    await sleep(400) // the overlay fades in
    await shot(tablet, '06-picker')
    await tap(tablet, 'Marco', /^Who’s putting Marcus’s .+ in Bay 2\?/)
    tt = await waitToast(tablet, 'Bay 2')
    ok(tt.includes('Bay 2'), 'the server’s toast after the drop', tt)
    const assign = writesWith(T.seen.slice(assignBefore), 'POST', /\/assign-bay$/)
    ok(assign.length === 1 && assign[0]!.actor === marco?.id, 'POST assign-bay carries X-Oasis-Employee = Marco', assign)
    const snap = (await api(tablet, 'GET', '/ops/snapshot?window=next24')).body
    const bay2 = snap.bays?.find((x: any) => x.number === 2)
    ok(bay2?.occupant?.card?.customer?.name === 'Marcus Webb', 'Marcus is in Bay 2 in the API')
    later(bay2?.occupant?.worker?.name?.startsWith('Marco'), 'the bay card’s worker is Marco (attribution package)', bay2?.occupant?.worker)
    const marcusId: string | undefined = bay2?.occupant?.card?.id
    if (marcusId) {
      const mf = (await api(tablet, 'GET', `/appointments/${marcusId}`)).body
      ok(
        (mf.activity ?? []).some((a: any) => (a.actorName ?? '').startsWith('Marco')),
        'History names Marco for the bay step',
        (mf.activity ?? []).slice(0, 3),
      )
    }

    // ---------------------------------------------------------------------------------------------------------------
    section('complete from the bay card')
    await tablet.locator('#dc-root button', { hasText: 'Bay Board' }).first().click()
    await sleep(500)
    const completeBefore = T.seen.length
    await tablet.locator('[data-drop="bay:1"]').getByRole('button', { name: 'Mark Complete' }).click()
    await tap(tablet, 'Lena', /^Who finished /)
    tt = await waitToast(tablet, 'completed')
    ok(tt.toLowerCase().includes('completed'), 'Mark Complete from the bay card, after the picker', tt)
    const adv = T.seen.slice(completeBefore).filter((x) => x.method === 'POST' && /\/(advance|complete)$/.test(x.path))
    ok(adv.length >= 1 && adv.every((x) => x.actor === lena?.id), 'the completion names Lena', adv)

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
    // kiosk mode is on: every sign-in page shows the keypad; 0218 reveals the email form (a browser that is not a kiosk)
    await M.page.goto(`${stack.webUrl}/login`)
    await M.page.waitForSelector('text=Enter the shop code', { timeout: 15_000 })
    ok((await text(M.page)).includes('Oasis kiosk'), 'another browser shows the keypad too, without a tablet name')
    await M.page.keyboard.type('0218')
    await M.page.getByLabel(/email/i).fill(EMAILS.manager)
    await M.page.getByLabel(/password/i).fill(stack.devPassword)
    await Promise.all([
      M.page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 }),
      M.page.getByRole('button', { name: /sign in/i }).click(),
    ])
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
    // the user menu's "Team activity…" (the Settings nav has no room for a Shop floor group, DV-1009)
    await M.page.locator('[data-live-menu="user"] > div').first().click()
    await M.page.getByRole('button', { name: 'Team activity…' }).click()
    await M.page.waitForURL((u) => u.pathname === '/settings', { timeout: 15_000 })
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
