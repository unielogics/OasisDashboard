/* eslint-disable @typescript-eslint/no-explicit-any */
// e2e-kiosk — kiosk mode with per-employee PINs at the shop's network (ADR 0180 and its 2026-10-14 amendment) end to end:
// the live dashboard against the real API on a stack started by scripts/live-stack.ts with a backend that has K-PIN.
//
//   export SMS_ALLOWLIST=+13055550171,+13055550172 ALLOW_DEV_ENDPOINTS=true
//   pnpm live:up --name kiosk --api-port 4031 --web-port 3231 --profile design,parity-ops \
//        --freeze 2026-06-13T10:36:00-04:00 --trust-proxy --backend ~/oasis/wt/k-pin
//   pnpm e2e:kiosk --name kiosk [--keep-going]
//   pnpm live:down --name kiosk --drop
//
// --trust-proxy lets each browser context say which internet address it comes from (X-Forwarded-For through the dashboard's
// proxy, TRUST_PROXY=true on the API, as behind production's nginx): the tablet and the Super Admin's phone are on the shop
// Wi-Fi (203.0.113.7), the manager is in the office, a stranger is elsewhere. The stack must be freshly seeded (kiosk mode is
// on by default; the run adds a shop network and PINs and writes).
// Steps: no shop network yet → the keypad says a Super Admin must set it and sends nothing → the Super Admin, on a phone on
// the shop Wi-Fi (not the tablet), presses "This is the shop's network" (the phone drops to mobile data first: 409, the screen
// re-reads the address) → a manager sees it read only and sets Marco's PIN and generates Lena's → the tablet's keypad takes
// Marco's PIN (a wrong one first) and opens Operations: "Opened by Marco R. · Locks at …" → carried to a café's Wi-Fi the
// unlocked tablet is covered ("This tablet works only on the shop's Wi-Fi", nothing else is sent) and back on the shop Wi-Fi
// the cover goes by itself, the session kept → each car step asks who (the
// picker) and sends X-Oasis-Employee → a direct PUT /settings/hours answers 403, /settings goes back to /operations → Lock
// kiosk → wrong PINs show the countdown → a PIN from outside the shop is never sent (and the API refuses it) → the provider
// changes the shop's address: the tablet, reloaded there, sends one PIN (it opened the kiosk before), the try is listed as "Front desk tablet tried from a new network, and the shop's usual
// network has been quiet since …", the Super Admin adds it (after the confirm), the tablet's open keypad is ready again by itself and Lena's PIN opens it → the manager removes Marco's PIN, it no longer works → Team activity.
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

/** Marco's PIN: 8 digits, no run, no repeat pattern, no date, not starting with 0218. */
const MARCO_PIN = '58149263'
const WRONG = '73920584'
/** The internet addresses the browsers say they come from (X-Forwarded-For; documentation ranges). */
const SHOP_IP = '203.0.113.7'
const NEW_SHOP_IP = '203.0.113.99'
const MOBILE_IP = '172.56.1.9'
const OFFICE_IP = '192.0.2.10'
const AWAY_IP = '198.51.100.23'
/** A café's Wi-Fi the unlocked tablet is carried to (ADR 0180 A13). */
const CAFE_IP = '198.51.100.77'

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

async function context(
  browser: Browser,
  label: string,
  ip: string,
): Promise<{ ctx: BrowserContext; page: Page; seen: Seen[] }> {
  const ctx = await browser.newContext({
    viewport: { width: 1480, height: 1000 },
    timezoneId: 'America/New_York',
    locale: 'en-US',
    extraHTTPHeaders: { 'X-Forwarded-For': ip },
  })
  await ctx.addInitScript('window.__name = (f) => f')
  const page = await ctx.newPage()
  const seen: Seen[] = []
  page.on('pageerror', (e) => pageErrors.push(`${label}: ${String(e)}`))
  page.on('console', (m) => {
    // 4xx are answers
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

/** Sets where a browser context says it comes from (the phone left the Wi-Fi, the provider changed the address). */
const moveTo = (ctx: BrowserContext, ip: string): Promise<void> => ctx.setExtraHTTPHeaders({ 'X-Forwarded-For': ip })

const unlockSent = (seen: Seen[], from: number): Seen[] => seen.slice(from).filter((s) => s.path.endsWith('/kiosk/unlock'))

async function onKeypad(page: Page): Promise<void> {
  await page.goto(`${stack.webUrl}/login`)
  await page.waitForSelector('text=Enter your PIN', { timeout: 20_000 })
}

/** A staff row of Settings → Kiosk → Staff PINs. */
const staffRow = (page: Page, name: string) => page.locator('[data-kiosk-staff] > div').filter({ hasText: name }).first()

/** Settings → Kiosk, once GET /kiosk has answered (the section's header text alone says "staff PINs" while it loads). */
async function waitKioskSettings(page: Page): Promise<void> {
  await page.locator('[data-kiosk-staff]').waitFor({ timeout: 30_000 })
}

async function openKioskSettings(page: Page): Promise<void> {
  await page.goto(`${stack.webUrl}/settings#kiosk`)
  await waitKioskSettings(page)
}

async function main(): Promise<void> {
  const browser = await chromium.launch()
  try {
    // ---------------------------------------------------------------------------------------------------------------
    section('kiosk mode is on by default; before any shop network the keypad says so and sends nothing')
    const T = await context(browser, 'tablet', SHOP_IP)
    const tablet = T.page
    await onKeypad(tablet)
    let st = (await api(tablet, 'GET', '/kiosk/status')).body
    ok(st.enabled === true && st.networkSet === false && st.atShop === false, 'GET /kiosk/status: on, no network yet', st)
    ok((await tablet.locator('input[name=email]').count()) === 0, 'no email field on the keypad')
    ok((await tablet.locator('[data-key]').count()) === 12, 'twelve keys')
    const keyBox = await tablet.locator('[data-key="5"]').boundingBox()
    ok((keyBox?.height ?? 0) >= 72, 'keys at least 72 px tall', keyBox)
    ok(
      (await text(tablet)).includes('A Super Admin must set the shop network first — Settings → Kiosk'),
      'the keypad: “A Super Admin must set the shop network first — Settings → Kiosk”',
    )
    let mark = T.seen.length
    let r: { status: number; body: any }
    await keypadType(tablet, MARCO_PIN)
    await sleep(500)
    ok(unlockSent(T.seen, mark).length === 0, 'a PIN typed before any network is never sent')
    await shot(tablet, '01-keypad-no-network')
    mark = T.seen.length
    await keypadType(tablet, '0218')
    await tablet.waitForSelector('input[name=email]', { timeout: 3000 })
    ok(unlockSent(T.seen, mark).length === 0, '0218 reveals the email/password card and sends nothing')
    await tablet.getByRole('link', { name: 'Back to keypad' }).click()
    await tablet.waitForSelector('text=Enter your PIN')
    ok((await tablet.locator('input[name=email]').count()) === 0, 'Back to keypad hides the form again')
    ok((await text(tablet)).includes('A Super Admin must set the shop network first'), 'and the keypad still says why')

    // ---------------------------------------------------------------------------------------------------------------
    section('the Super Admin adds the shop network from a phone on the shop Wi-Fi (not the tablet)')
    const S = await context(browser, 'super-admin phone', SHOP_IP)
    await login(S.page, stack, EMAILS.superAdmin, '/settings#kiosk')
    await waitKioskSettings(S.page)
    ok((await text(S.page)).includes('Your connection: ' + SHOP_IP), 'Settings → Kiosk shows “Your connection: 203.0.113.7”')
    ok(
      (await text(S.page)).includes('Do this from a phone or computer connected to the shop Wi-Fi — not mobile data.'),
      'the help line says to use the shop Wi-Fi, not mobile data',
    )
    const addButton = S.page.getByRole('button', { name: 'This is the shop’s network', exact: true })
    // the phone drops to mobile data between reading the page and pressing: refused, the page reads the address again
    await moveTo(S.ctx, MOBILE_IP)
    await addButton.click()
    await until(async () => (await text(S.page)).includes('Your connection changed to ' + MOBILE_IP), 10_000)
    ok(
      (await text(S.page)).includes('Your connection changed to ' + MOBILE_IP + '. Check you’re on the shop Wi-Fi'),
      '409 KIOSK_ADDRESS_CHANGED: “Your connection changed to 172.56.1.9 …”',
    )
    await until(async () => (await text(S.page)).includes('Your connection: ' + MOBILE_IP), 10_000)
    ok((await text(S.page)).includes('Your connection: ' + MOBILE_IP), 'the page re-read the address it shows')
    ok(((await api(S.page, 'GET', '/kiosk')).body.networks ?? []).length === 0, 'no network was added from mobile data')
    await shot(S.page, '02-network-changed')
    // back on the Wi-Fi: the page still shows the mobile address, so the first press is refused again and re-reads it
    await moveTo(S.ctx, SHOP_IP)
    await addButton.click()
    await until(async () => (await text(S.page)).includes('Your connection: ' + SHOP_IP), 10_000)
    ok((await text(S.page)).includes('Your connection: ' + SHOP_IP), 'back on the Wi-Fi the page shows the shop address again')
    await S.page.locator('input[title="Network name"]').fill('Shop Wi-Fi')
    await addButton.click()
    await until(async () => (await text(S.page)).includes('This is the shop’s network. PINs work here.'), 10_000)
    ok((await text(S.page)).includes('This is the shop’s network. PINs work here.'), 'the button is replaced by “This is the shop’s network”')
    const nets = (await api(S.page, 'GET', '/kiosk')).body.networks ?? []
    ok(nets.length === 1 && nets[0].address === SHOP_IP && nets[0].label === 'Shop Wi-Fi', 'the shop network is 203.0.113.7 “Shop Wi-Fi”', nets)
    ok((await text(S.page)).includes(SHOP_IP + ' · added Jun 13 by Amara'), 'the list says who added it and when')
    await shot(S.page, '03-network-added')
    // the tablet's keypad is ready now, by itself: it reads the status again every 30 s while blocked (no reload; review F1)
    st = (await api(tablet, 'GET', '/kiosk/status')).body
    ok(st.networkSet === true && st.atShop === true, 'the tablet is at the shop now', st)
    let toastSeen = false
    await until(async () => {
      const t = await text(tablet)
      if (t.includes('Ready — PINs work here now.')) toastSeen = true
      return !/PINs work only|must set the shop network/.test(t)
    }, 45_000)
    ok(!/PINs work only|must set the shop network/.test(await text(tablet)), 'the open keypad drops its warning by itself (no reload)')
    await until(async () => toastSeen || (await text(tablet)).includes('Ready — PINs work here now.'), 2000)
    ok(toastSeen || (await text(tablet)).includes('Ready — PINs work here now.'), 'and says “Ready — PINs work here now.”')

    // ---------------------------------------------------------------------------------------------------------------
    section('a manager (not a Super Admin) sees the shop network read only and sets the PINs')
    const M = await context(browser, 'manager', OFFICE_IP)
    await login(M.page, stack, EMAILS.manager, '/settings#kiosk')
    await waitKioskSettings(M.page)
    ok((await text(M.page)).includes('Only a Super Admin can change the shop network'), 'the manager reads “Only a Super Admin can change the shop network”')
    ok((await M.page.getByRole('button', { name: 'This is the shop’s network', exact: true }).count()) === 0, 'no “This is the shop’s network” for the manager')
    ok(
      (await M.page.locator('[data-kiosk-networks]').getByRole('button', { name: 'Remove', exact: true }).count()) === 0,
      'no Remove on the networks for the manager',
    )
    r = await api(M.page, 'POST', '/kiosk/networks', { confirmAddress: OFFICE_IP })
    ok(r.status === 403 && (r.body as any)?.code === 'SUPER_ONLY', 'POST /kiosk/networks answers 403 SUPER_ONLY to a manager', r)
    // Marco's PIN, typed twice
    await staffRow(M.page, 'Marco R.').getByRole('button', { name: 'Set PIN' }).click()
    await M.page.locator('input[title="New PIN"]').fill(MARCO_PIN)
    await M.page.locator('input[title="The new PIN again"]').fill(MARCO_PIN)
    await M.page.getByRole('button', { name: 'Save PIN' }).click()
    await until(async () => /PIN set Jun 13 by Rafael/.test((await staffRow(M.page, 'Marco R.').textContent()) ?? ''), 10_000)
    ok(/PIN set Jun 13 by Rafael/.test((await staffRow(M.page, 'Marco R.').textContent()) ?? ''), 'Marco: “PIN set Jun 13 by Rafael M.”')
    ok(!(await text(M.page)).includes(MARCO_PIN), 'the PIN is never shown back')
    // Lena's PIN, generated: shown once
    await staffRow(M.page, 'Lena K.').getByRole('button', { name: 'Generate', exact: true }).click()
    await M.page.locator('[data-kiosk-generated]').waitFor({ timeout: 10_000 })
    const shown = ((await M.page.locator('[data-kiosk-generated]').textContent()) ?? '').match(/\d{4} \d{4}/)?.[0] ?? ''
    const LENA_PIN = shown.replace(' ', '')
    ok(/^\d{8}$/.test(LENA_PIN), 'Generate shows the new PIN once, in two halves', shown)
    ok((await M.page.locator('[data-kiosk-generated]').textContent())?.includes('It isn’t shown again.'), 'with the write-it-down note')
    ok((await M.page.locator('[data-kiosk-generated]').getByRole('button', { name: 'Copy' }).count()) === 1, 'and a Copy button')
    await shot(M.page, '04-pin-generated')
    await M.page.locator('[data-kiosk-generated]').getByRole('button', { name: 'Done' }).click()
    ok((await M.page.locator('[data-kiosk-generated]').count()) === 0, 'Done hides it for good')
    const kiosk = (await api(M.page, 'GET', '/kiosk')).body
    ok(
      kiosk.staff.filter((p: any) => p.pin).map((p: any) => p.name).sort().join(',') === 'Lena K.,Marco R.',
      'GET /kiosk: Marco and Lena have a PIN (never the PIN)',
      kiosk.staff,
    )

    // ---------------------------------------------------------------------------------------------------------------
    section('the PIN opens the tablet at the shop: Operations only, “Opened by Marco R.”')
    await onKeypad(tablet)
    await keypadType(tablet, WRONG)
    await until(async () => (await text(tablet)).includes('didn’t work'), 5000)
    ok((await text(tablet)).includes('That PIN didn’t work.'), 'a wrong PIN: “That PIN didn’t work.”')
    await tablet.keyboard.type(MARCO_PIN, { delay: 40 })
    await tablet.waitForURL((u) => u.pathname === '/operations', { timeout: 15_000 })
    await tablet.waitForSelector('text=Appointments 24h', { timeout: 30_000 })
    ok(true, 'Marco’s PIN (typed on the keyboard) opens Operations')
    ok((await T.ctx.cookies()).some((c) => /oasis_kdev$/.test(c.name)), 'the tablet got its device cookie at its first unlock')
    const kioskMe = (await api(tablet, 'GET', '/kiosk/me')).body
    ok(kioskMe.openedBy?.name === 'Marco R.', 'GET /kiosk/me: opened by Marco R.', kioskMe.openedBy)
    const staff: Array<{ id: string; name: string; first: string }> = kioskMe.staff ?? []
    const marco = staff.find((s) => s.first === 'Marco')
    ok(!!marco, 'the picker lists Marco', staff.map((s) => s.name))
    ok((await tablet.locator('a[href="/payments"]').count()) === 0, 'no Payments tab on the kiosk')
    ok((await tablet.locator('a[href="/settings"]').count()) === 0, 'no Settings tab on the kiosk')
    ok(/Opened by Marco R\. · Locks at \d{1,2}:\d{2} [AP]M/.test(await text(tablet)), 'the chip: “Opened by Marco R. · Locks at …”')
    await shot(tablet, '05-kiosk-board')
    // the Super Admin names the new shop browser and sees who opened it
    await openKioskSettings(S.page)
    const browsers = S.page.locator('[data-kiosk-browsers]')
    await until(async () => (await browsers.textContent())?.includes('Opened by Marco R.'), 10_000)
    ok((await browsers.textContent())?.includes('Opened by Marco R.'), 'Browsers at the shop: “Opened by Marco R.”', await browsers.textContent())
    await browsers.getByRole('button', { name: 'Rename' }).first().click()
    await browsers.locator('input[title="Browser name"]').fill('Front desk tablet')
    await browsers.getByRole('button', { name: 'Save', exact: true }).click()
    await until(async () => (await browsers.textContent())?.includes('Front desk tablet'), 10_000)
    ok((await browsers.textContent())?.includes('Front desk tablet'), 'the shop browser is renamed “Front desk tablet”')
    ok(
      /Opened by Marco R\./.test((await S.page.locator('text=Recent kiosk events').locator('..').textContent()) ?? ''),
      'Recent kiosk events: “Unlocked … Opened by Marco R.”',
    )

    // ---------------------------------------------------------------------------------------------------------------
    section('the unlocked tablet carried off the shop Wi-Fi: covered, and back at the shop the board works (ADR 0180 A13)')
    await moveTo(T.ctx, CAFE_IP)
    r = await api(tablet, 'GET', '/kiosk/me')
    ok(r.status === 403 && (r.body as any)?.code === 'KIOSK_NOT_AT_SHOP', 'from another network the kiosk answers 403 KIOSK_NOT_AT_SHOP', r)
    // the board reads its snapshot every few seconds: the next read is refused and the cover goes up
    const away = tablet.locator('[data-kiosk-away]')
    await away.waitFor({ timeout: 30_000 })
    ok(
      ((await away.textContent()) ?? '').includes('This tablet works only on the shop’s Wi-Fi'),
      'the cover: “This tablet works only on the shop’s Wi-Fi”',
      await away.textContent(),
    )
    ok((await away.locator('button').allTextContents()).join('|') === 'Manager sign-in', 'its only button: “Manager sign-in”')
    ok((await tablet.locator('#dc-root').count()) === 1, 'the board stays under the cover')
    await shot(tablet, '05b-away-cover')
    // nothing loops while covered: only the public GET /kiosk/status may go out (every 30 s, on focus)
    mark = T.seen.length
    await tablet.evaluate(() => window.dispatchEvent(new Event('focus')))
    await sleep(5000)
    const whileAway = T.seen.slice(mark).map((x) => x.method + ' ' + x.path)
    ok(
      whileAway.every((x) => x === 'GET /api/v1/kiosk/status') && whileAway.length <= 2,
      'while covered nothing else is sent (the calls wait)',
      whileAway,
    )
    // back on the shop Wi-Fi: the tablet comes back into view and the cover goes by itself, no PIN
    await moveTo(T.ctx, SHOP_IP)
    await tablet.evaluate(() => window.dispatchEvent(new Event('focus')))
    await until(async () => (await away.count()) === 0, 15_000)
    ok((await away.count()) === 0, 'back on the shop Wi-Fi the cover goes by itself (no PIN)')
    r = await api(tablet, 'GET', '/kiosk/me')
    ok(r.status === 200 && (r.body as any)?.openedBy?.name === 'Marco R.', 'the kiosk session was kept (not revoked): still opened by Marco R.', r.status)
    ok(new URL(tablet.url()).pathname === '/operations', 'and the tablet is still on the board')
    await tablet.waitForSelector('text=Appointments 24h', { timeout: 30_000 })
    ok(/Opened by Marco R\. · Locks at/.test(await text(tablet)), 'the board works again: “Opened by Marco R. · Locks at …”')

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
      const sts = await until(async () => ((await api(tablet, 'GET', `/appointments/${graceId}`)).body.status === status ? status : null))
      ok(sts === status, `${label} -> ${status} in the API`, sts)
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
    await shot(tablet, '06-file-acting')
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
    await shot(tablet, '07-picker')
    await tap(tablet, 'Marco', /^Who’s putting Marcus’s .+ in Bay 2\?/)
    tt = await waitToast(tablet, 'Bay 2')
    ok(tt.includes('Bay 2'), 'the server’s toast after the drop', tt)
    const assign = writesWith(T.seen.slice(assignBefore), 'POST', /\/assign-bay$/)
    ok(assign.length === 1 && assign[0]!.actor === marco?.id, 'POST assign-bay carries X-Oasis-Employee = Marco', assign)
    const snap = (await api(tablet, 'GET', '/ops/snapshot?window=next24')).body
    const bay2 = snap.bays?.find((x: any) => x.number === 2)
    ok(bay2?.occupant?.card?.customer?.name === 'Marcus Webb', 'Marcus is in Bay 2 in the API')
    later(bay2?.occupant?.worker?.name?.startsWith('Marco'), 'the bay card’s worker is Marco (attribution package)', bay2?.occupant?.worker)

    // ---------------------------------------------------------------------------------------------------------------
    section('the kiosk cannot reach Settings, even by direct URL')
    r = await api(tablet, 'PUT', '/settings/hours', { days: [] })
    ok(r.status === 403 && (r.body as any)?.code === 'KIOSK_FORBIDDEN', 'a direct PUT /settings/hours answers 403 KIOSK_FORBIDDEN', r)
    await tablet.goto(`${stack.webUrl}/settings`)
    await tablet.waitForURL((u) => u.pathname === '/operations', { timeout: 15_000 })
    ok(true, '/settings sends the kiosk back to /operations')
    await tablet.waitForSelector('text=Appointments 24h', { timeout: 30_000 })

    // ---------------------------------------------------------------------------------------------------------------
    section('Lock kiosk, then wrong PINs')
    await tablet.locator('[data-live-menu="user"] > div').first().click()
    await tablet.getByRole('button', { name: 'Lock kiosk' }).click()
    ok((await text(tablet)).includes('Lock the kiosk now? A PIN opens it again.'), 'Lock kiosk asks first')
    await tablet.getByRole('button', { name: 'Lock', exact: true }).click()
    await tablet.waitForURL((u) => u.pathname === '/login', { timeout: 15_000 })
    await tablet.waitForSelector('text=Enter your PIN')
    ok((await text(tablet)).includes('The kiosk is locked. Enter your PIN to open it.'), 'the keypad says the kiosk locked')
    let countdown = ''
    for (let i = 0; i < 6 && !countdown; i++) {
      await keypadType(tablet, WRONG)
      await until(async () => (await text(tablet)).includes('didn’t work'), 5000)
      const t = await text(tablet)
      if (/Try again in \d+ s/.test(t)) countdown = t.match(/Try again in \d+ s/)![0]
      else await sleep(300)
    }
    ok((await text(tablet)).includes('That PIN didn’t work.'), 'a wrong PIN: “That PIN didn’t work.”')
    ok(!!countdown, 'after the free tries the keypad counts down', countdown)
    await shot(tablet, '08-countdown')

    // ---------------------------------------------------------------------------------------------------------------
    section('a PIN from outside the shop network is refused')
    const A = await context(browser, 'away', AWAY_IP)
    await onKeypad(A.page)
    ok((await text(A.page)).includes('PINs work only at the shop.'), 'away from the shop the keypad says “PINs work only at the shop.”')
    mark = A.seen.length
    await keypadType(A.page, MARCO_PIN)
    await sleep(500)
    ok(unlockSent(A.seen, mark).length === 0, 'the keypad never sends the PIN from there (this browser never opened the kiosk)')
    ok(new URL(A.page.url()).pathname === '/login', 'and it stays on the keypad')
    await shot(A.page, '09-not-at-shop')
    r = await api(A.page, 'POST', '/kiosk/unlock', { pin: MARCO_PIN })
    ok(
      r.status === 403 && (r.body as any)?.code === 'KIOSK_NOT_AT_SHOP' && (r.body as any)?.meta?.networkSet === true,
      'POST /kiosk/unlock from there answers 403 KIOSK_NOT_AT_SHOP (the PIN is never checked)',
      r,
    )
    await keypadType(A.page, '0218')
    await A.page.waitForSelector('input[name=email]', { timeout: 3000 })
    ok(true, '0218 still reveals the email/password card there')

    // ---------------------------------------------------------------------------------------------------------------
    section('the provider changes the shop’s address: the tablet’s try is listed, the Super Admin adds it')
    // (the stack's clock is frozen, so the tablet's wrong-PIN wait never runs out by itself: a manager clears it below;
    // an unknown network is refused before any wait is looked at)
    // the tablet (re)loads its keypad after the change (a reboot, a purged tab): the status already says it is not at the shop
    await moveTo(T.ctx, NEW_SHOP_IP)
    await onKeypad(tablet)
    ok((await text(tablet)).includes('PINs work only at the shop.'), 'the tablet on the new address: “PINs work only at the shop.”')
    mark = T.seen.length
    await keypadType(tablet, MARCO_PIN)
    await until(async () => unlockSent(T.seen, mark).length === 1, 10_000)
    await sleep(500)
    ok(
      unlockSent(T.seen, mark).length === 1,
      'it opened the kiosk before, so its PIN goes out once and the try is listed (review F2; the server never checks it)',
    )
    ok((await text(tablet)).includes('PINs work only at the shop.'), 'and the keypad still says “PINs work only at the shop.”')
    mark = T.seen.length
    await keypadType(tablet, MARCO_PIN)
    await sleep(800)
    ok(unlockSent(T.seen, mark).length === 0, 'a second PIN from there is not sent')
    await openKioskSettings(S.page)
    const known = S.page.locator('[data-kiosk-refused]').filter({ hasText: NEW_SHOP_IP })
    const unknown = S.page.locator('[data-kiosk-refused]').filter({ hasText: AWAY_IP })
    await until(async () => (await known.count()) > 0, 10_000)
    ok(
      ((await known.textContent()) ?? '').includes(
        'Front desk tablet tried from a new network, and the shop’s usual network has been quiet since — your internet provider probably changed the shop’s address.',
      ),
      '“Front desk tablet tried from a new network, and the shop’s usual network has been quiet since — your internet provider probably changed the shop’s address.”',
      await known.textContent(),
    )
    ok(
      ((await unknown.textContent()) ?? '').includes('Not from a shop browser — only add it if you know this address is the shop’s'),
      'the stranger’s try carries the warning',
      await unknown.textContent(),
    )
    await shot(S.page, '10-refused')
    // the tablet's wrong PINs (the stack's clock is frozen, so its wait never ends by itself): Clear lockout (Browsers at the
    // shop) starts its counter over
    ok((await browsers.textContent())?.includes('wrong PIN'), 'Browsers at the shop: the tablet’s wrong PINs', await browsers.textContent())
    await browsers.getByRole('button', { name: 'Clear lockout' }).first().click()
    await until(async () => (await browsers.getByRole('button', { name: 'Clear lockout' }).count()) === 0, 10_000)
    ok((await browsers.getByRole('button', { name: 'Clear lockout' }).count()) === 0, 'Clear lockout starts the tablet’s counter over')
    await known.getByRole('button', { name: 'Add this network' }).click()
    // it always asks first, also for a known shop browser (review N1)
    ok(
      ((await known.textContent()) ?? '').includes('Add ' + NEW_SHOP_IP + ' as a shop network? Anyone on that network can then use a PIN.'),
      'Add this network asks first: “Anyone on that network can then use a PIN.”',
      await known.textContent(),
    )
    await known.getByRole('button', { name: 'Add', exact: true }).click()
    await until(async () => (await S.page.locator('[data-kiosk-networks]').textContent())?.includes(NEW_SHOP_IP + ' · added'), 10_000)
    ok((await S.page.locator('[data-kiosk-networks]').textContent())?.includes(NEW_SHOP_IP + ' · added'), 'Add this network adds 203.0.113.99')
    // no reload on the tablet: its keypad reads the status again by itself (review F1)
    await until(async () => !(await text(tablet)).includes('PINs work only'), 45_000)
    ok(!(await text(tablet)).includes('PINs work only'), 'the tablet’s open keypad is ready again by itself')
    await keypadType(tablet, LENA_PIN)
    await tablet.waitForURL((u) => u.pathname === '/operations', { timeout: 15_000 })
    await tablet.waitForSelector('text=Appointments 24h', { timeout: 30_000 })
    ok(/Opened by Lena K\. · Locks at/.test(await text(tablet)), 'Lena’s generated PIN opens it: “Opened by Lena K. · Locks at …”')

    // ---------------------------------------------------------------------------------------------------------------
    section('the manager removes Marco’s PIN; it no longer opens the kiosk')
    await openKioskSettings(M.page)
    await staffRow(M.page, 'Marco R.').getByRole('button', { name: 'Remove PIN' }).click()
    ok(((await staffRow(M.page, 'Marco R.').textContent()) ?? '').includes('Remove Marco’s PIN?'), 'Remove asks first')
    await staffRow(M.page, 'Marco R.').getByRole('button', { name: 'Remove', exact: true }).click()
    await until(async () => ((await staffRow(M.page, 'Marco R.').textContent()) ?? '').includes('No PIN yet'), 10_000)
    ok(((await staffRow(M.page, 'Marco R.').textContent()) ?? '').includes('No PIN yet'), 'Marco: “No PIN yet”')
    r = await api(tablet, 'POST', '/kiosk/lock')
    ok(r.status === 204 || r.status === 200, 'the tablet locks', r.status)
    await onKeypad(tablet)
    await keypadType(tablet, MARCO_PIN)
    await until(async () => (await text(tablet)).includes('didn’t work'), 15_000)
    ok((await text(tablet)).includes('That PIN didn’t work.'), 'Marco’s old PIN: “That PIN didn’t work.”')
    ok(new URL(tablet.url()).pathname === '/login', 'and the tablet stays locked')
    await shot(tablet, '11-pin-removed')

    // ---------------------------------------------------------------------------------------------------------------
    section('Team activity')
    // the user menu's "Team activity…" (the Settings nav has no room for a Shop floor group, DV-1009)
    await M.page.locator('[data-live-menu="user"] > div').first().click()
    ok((await M.page.getByRole('button', { name: 'Kiosk…' }).count()) === 1, 'the user menu has “Kiosk…” (no “Make this a kiosk…”)')
    await M.page.getByRole('button', { name: 'Team activity…' }).click()
    await until(async () => /Avg bay time/.test(await text(M.page)), 10_000)
    later(/Marco/.test(await text(M.page)), 'Team activity lists Marco with his counts')
    await shot(M.page, '12-team-activity')
    await A.ctx.close()
    await M.ctx.close()
    await S.ctx.close()
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
