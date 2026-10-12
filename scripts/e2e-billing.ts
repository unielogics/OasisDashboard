/* eslint-disable @typescript-eslint/no-explicit-any */
// e2e-billing: saved cards, fees, memberships billed by Square and Settings → Billing & integrations on the live dashboard
// (ADR 0171 wave Q3; DEVIATIONS DV-901..DV-909) against a live stack on the Q3 backend with Square taking card money through
// the backend's HTTP Square simulator, the worker running the jobs, and the personal links switched on (a test PIN_PEPPER
// made for the run): scripts/e2e-billing-stack.sh starts all of it, runs this and tears it down.
//
// As the Super Admin, in the pages: Settings → Billing & integrations (Test connection on the simulator, the no-show fee
// switched on, Sync to Square, the price grid "On Square"); a client saves a card on their own card page (the real link
// routes: the link issued with the backend's issueClientLink, the page verified by its texted code) and the client file
// lists it with its consent; the Collect sheet offers "Saved card ••5858", asks for the client's OK and charges it; a visit
// marked a no-show proposes the fee, which is charged after a confirm; a client joins Gold on their membership page
// (Square subscription, first invoice paid, webhooks through the worker) and the Membership tab's billing block shows it
// and pauses it. Every figure is checked against the API. It fails on any page error, API 5xx or unexpected API 4xx.
// Screenshots go to parity-reports/e2e-billing/ (not committed). The link tokens and codes are never printed.
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test'
import { EMAILS, loadStack, login } from './live-e2e'

process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE ??= 'ubuntu24.04-arm64'

const args = process.argv.slice(2)
const stackName = args.includes('--name') ? args[args.indexOf('--name') + 1]! : 'qbill'
const stack = loadStack(stackName) as ReturnType<typeof loadStack> & { backend: string }
const only = args.includes('--only') ? args[args.indexOf('--only') + 1]! : ''
const SIM = process.env.SQUARE_SIM_URL ?? 'http://127.0.0.1:4593'
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const shots = path.join(root, 'parity-reports', 'e2e-billing')
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
  } finally {
    expected4xx = []
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
    else if (r.status() >= 400 && !expected4xx.some((re) => re.test(line))) {
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

/** A control of the Square simulator (never the API: the simulator is Square). */
async function sim(p: string, body: unknown = {}): Promise<any> {
  const r = await fetch(`${SIM}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`simulator ${p} -> ${r.status} ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

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

const fileModal = (page: Page) => page.locator('div[style*="z-index: 60"]').first()
const seeText = (page: Page, text: string | RegExp, ms = 15_000) =>
  page.getByText(text).first().waitFor({ timeout: ms })

// ---- the backend's own modules on the stack's schema: issue a personal link, recover the code a text carried ------------------

const envOf = (file: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]!] = m[2]!.replace(/^['"]|['"]$/g, '')
  }
  return out
}
const dbUrl = envOf(path.join(stack.backend, '.env')).DATABASE_URL!
const be = (rel: string): Promise<any> => import(pathToFileURL(path.join(stack.backend, rel)).href)
const [dbm, ids, clockm, links, otp, consents] = await Promise.all([
  be('src/platform/db.ts'),
  be('src/platform/ids.ts'),
  be('src/platform/clock.ts'),
  be('src/modules/identity/links.ts'),
  be('src/modules/public/otp.ts'),
  be('src/modules/square/consents.ts'),
])
const clock = clockm.systemClock
const newId = ids.createIdGenerator(clock)
const db = dbm.createDb({
  url: dbUrl,
  searchPath: `${stack.schema},public`,
  poolMax: 2,
  applicationName: 'dash-e2e-billing',
})
const locationId: string = (
  await db.selectFrom('locations').select('id').orderBy('created_at').orderBy('id').executeTakeFirstOrThrow()
).id

function psql(sql: string): string {
  return execFileSync('psql', [dbUrl, '-Atq', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
    input: `set search_path = ${stack.schema}, public;\n` + sql,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}

/** The link routes as a client's page calls them (the link API, never the dashboard's). */
async function linkApi(
  method: string,
  p: string,
  o: { session?: string; body?: unknown; key?: string } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (o.session) headers.authorization = `Bearer ${o.session}`
  if (o.key) headers['idempotency-key'] = o.key
  const r = await fetch(`${stack.apiUrl}/api/v1/public/links${p}`, {
    method,
    headers,
    ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
  })
  const text = await r.text()
  let body: any = text
  try {
    body = JSON.parse(text)
  } catch {
    /* text */
  }
  return { status: r.status, body }
}

/** A client's own page of a kind (card, membership), verified now by the code texted to their number. */
async function verifiedPage(
  customerId: string,
  kind: 'card' | 'membership',
  planKey: string | null = null,
): Promise<string> {
  const link = await db
    .transaction()
    .execute((t: any) =>
      links.issueClientLink(
        t,
        { newId, now: clock.now() },
        { locationId, kind, customerId, planKey, issuedBy: 'staff' },
      ),
    )
  const ex = await linkApi('POST', '/exchange', { body: { token: link.token } })
  check(ex.status === 200, `the ${kind} page opens (${ex.status})`)
  const session = ex.body.session as string
  const req = await linkApi('POST', '/verify/code', { session, body: { purpose: 'verify' } })
  check(req.status === 202, `a code is texted (${req.status} ${JSON.stringify(req.body).slice(0, 120)})`)
  const challengeId = req.body.challengeId as string
  const hash = psql(`select code_hash from public_otp_challenges where id = '${challengeId}'`)
  let code = ''
  for (let n = 0; n < 1_000_000 && !code; n++) {
    const c = String(n).padStart(6, '0')
    if (otp.hashCode(challengeId, c) === hash) code = c
  }
  check(code, 'the texted code is recovered from its hash')
  const ok = await linkApi('POST', '/verify/code/confirm', { session, body: { challengeId, code } })
  check(ok.status === 200, `the page is verified (${ok.status})`)
  return session
}

// ---- the browser ---------------------------------------------------------------------------------------------------------

const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--font-render-hinting=none'] })

async function session(
  email: string,
  who: string,
  next: string,
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    viewport: { width: 1480, height: 1000 },
    timezoneId: 'America/New_York',
    locale: 'en-US',
  })
  const page = await ctx.newPage()
  page.setDefaultTimeout(15_000)
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
  await page.waitForFunction(
    (n) => document.querySelector('div[style*="z-index: 60"]')?.textContent?.includes(n),
    name,
  )
}

async function fileTab(page: Page, label: string): Promise<void> {
  await fileModal(page)
    .locator('button', { hasText: new RegExp('^\\s*' + label) })
    .first()
    .click()
  await sleep(500)
}

const S: Record<string, any> = {}
const PHONES = { a: '(201) 555-0181', b: '(201) 555-0182', c: '(201) 555-0183' }
const NAMES = { a: 'Cora Cardholder', b: 'Nolan Noshow', c: 'Mira Member' }

try {
  const { ctx, page } = await session(EMAILS.superAdmin, 'super', '/settings#billing')
  const req = ctx.request

  await step('setup: three clients with a visit each; the no-show visit started two hours ago', async () => {
    const services = await api(req, '/services')
    const pkg = services.packages[0]
    check(pkg, 'a package to book')
    S.pkg = pkg
    for (const k of ['a', 'b', 'c'] as const) {
      const c = await write(ctx, 'POST', '/customers', {
        name: NAMES[k],
        phone: PHONES[k],
        smsOptIn: true,
        vehicle: { year: 2022, make: 'Honda', model: 'Civic' },
      })
      S[k] = { id: c.customer?.id ?? c.id }
      check(S[k].id, `client ${k} created`)
      // the first open time, today or in the next days
      let booked: any = null
      for (let d = 0; d < 7 && !booked; d++) {
        const snap = await api(req, '/ops/snapshot?window=today')
        const date = new Date(Date.parse(snap.now.bizDate + 'T12:00:00Z') + d * 86_400_000)
          .toISOString()
          .slice(0, 10)
        const av = await api(
          req,
          `/availability?date=${date}&serviceId=${pkg.id}&channel=desk&customerId=${S[k].id}`,
        )
        const slot = av.slots.find((s: any) => s.state === 'available')
        if (slot)
          booked = await write(ctx, 'POST', '/appointments', {
            customer: { id: S[k].id },
            serviceId: pkg.id,
            source: 'dashboard',
            start: slot.start,
            vehicleClass: 'compact_car',
          })
      }
      check(booked, `a visit for client ${k}`)
      S[k].appt = booked.appointment.id
      S[k].invoice = booked.invoice?.invoiceId
    }
    // a test hook: the visits are today's (the Payments list shows today's invoices; a no-show is taken only after the start
    // and the grace period): the no-show visit started two hours ago, the others an hour and half an hour ago
    const tz = 'America/New_York'
    for (const [k, mins] of [
      ['a', 60],
      ['b', 120],
      ['c', 30],
    ] as const)
      psql(`
        with t as (
          select greatest(now() - interval '${mins} minutes',
                          (date_trunc('day', now() at time zone '${tz}') at time zone '${tz}') + interval '${150 - mins} seconds') as s)
        update appointments a set scheduled_start = t.s, scheduled_end = t.s + interval '30 minutes' from t where a.id = '${S[k].appt}';
        update invoices i set occurred_at = a.scheduled_start, biz_date = (a.scheduled_start at time zone '${tz}')::date
          from appointments a where a.id = '${S[k].appt}' and i.appointment_id = a.id;`)
  })

  await step(
    'Settings → Billing & integrations: Test connection on the simulator, the switches read only',
    async () => {
      await page.goto(`${stack.webUrl}/settings#billing`, { waitUntil: 'load' })
      await seeText(page, 'How payments run')
      const b = await api(req, '/settings/billing')
      eq(b.processing.processor, 'square', 'Square takes card money in this stack')
      await seeText(page, 'Card payments go through')
      await seeText(page, /^Square$/)
      await page.locator('#dc-root button', { hasText: 'Test connection' }).click()
      await seeText(page, /Square connection/)
      const after = await until('the test is stored', async () => {
        const x = await api(req, '/settings/billing')
        return x.square.lastTest ? x : null
      })
      for (const c of after.square.lastTest.checks)
        await seeText(page, (c.ok ? 'OK' : 'Not OK') + (c.detail ? ' · ' + c.detail : ''))
      await shot(page, 'billing-test-connection')
    },
  )

  await step(
    'Settings → Billing & integrations: the no-show fee on ($100), saved with its version',
    async () => {
      await page.locator('#dc-root button[title="Fees on or off"]').click()
      await page.locator('#dc-root input[title="No-show fee"]').fill('100')
      await page.locator('#dc-root button', { hasText: 'Save fees' }).click()
      await seeText(page, 'Saved-card fees saved · on')
      const f = await api(req, '/settings/card-fees')
      eq([f.fees.enabled, f.fees.noShowCents, f.active], [true, 10_000, true], 'the fee is on at $100')
    },
  )

  await step(
    'Settings: Sync to Square puts the Gold price on Square; the Memberships grid says "On Square"',
    async () => {
      await page.locator('#dc-root button', { hasText: 'Sync to Square' }).click()
      await seeText(page, /^Synced to Square/)
      const tiers = await until('the Gold Compact car price synced', async () => {
        const t = await api(req, '/catalog/tiers')
        const gold = t.tiers.find((x: any) => x.key === 'gold')
        return gold?.prices.find((p: any) => p.class === 'compact_car' && p.squareState === 'synced')
          ? t
          : null
      })
      void tiers
      await page
        .locator('#dc-root button', { hasText: /^Memberships$/ })
        .first()
        .click()
      await seeText(page, 'On Square')
      await shot(page, 'memberships-on-square')
    },
  )

  await step('a client saves a card on their own card page; the file lists it with its consent', async () => {
    for (const k of ['a', 'b'] as const) {
      const s = await verifiedPage(S[k].id, 'card')
      const r = await linkApi('POST', '/cards', {
        session: s,
        key: `e2e-card-${crypto.randomUUID()}`,
        body: {
          sourceId: 'cnon:card-nonce-ok',
          consentVersion: consents.CURRENT_CONSENT_VERSION,
          purposes: ['no_show_fee', 'late_cancel_fee', 'balance'],
          postalCode: '07026',
        },
      })
      check(r.status === 201, `the card is saved (${r.status} ${JSON.stringify(r.body).slice(0, 160)})`)
    }
    const cards = await api(req, `/customers/${S.a.id}/cards`)
    eq(
      cards.cards.map((c: any) => [c.label, c.state]),
      [['Visa ••5858', 'active']],
      'the saved card',
    )
    await openFileOf(page, NAMES.a)
    await seeText(page, 'Cards on file')
    await seeText(page, 'Visa ••5858')
    await seeText(
      page,
      new RegExp(
        '^Consent ' +
          cards.cards[0].consents[0].version +
          ' · .* · no-show fee, late-cancel fee and balances · on the client’s link$',
      ),
    )
    await shot(page, 'file-cards-on-file')
  })

  await step('Collect: "Saved card ••5858", the client’s OK, the charge; the invoice is paid', async () => {
    const inv = await api(req, `/invoices/${S.a.invoice}`)
    eq(inv.processing.squareTenders.savedCard?.label, 'Visa ••5858', 'the server names the usable card')
    const due = inv.calc.balance
    check(due > 0, 'a balance to collect')
    await page.goto(`${stack.webUrl}/payments`, { waitUntil: 'load' })
    await page.waitForSelector('#dc-root .sc-host', { timeout: 20_000 })
    await page.fill('#dc-root input[placeholder*="Search"]', inv.label)
    await page.locator('#dc-root button', { hasText: inv.label }).first().click()
    await page.waitForFunction((l) => document.querySelector('aside')?.textContent?.includes(l), inv.label)
    await page
      .locator('aside button', { hasText: /^Collect / })
      .first()
      .click()
    await page.locator('#dc-root button', { hasText: 'Saved card ••5858' }).click()
    const money = '$' + (due / 100).toFixed(2)
    await seeText(page, `${NAMES.a.split(' ')[0]} said OK to charge ${money} to Visa ••5858`)
    const charge = page.getByRole('button', { name: `Charge ${money} to Visa ••5858`, exact: true })
    check(await charge.isDisabled(), 'nothing is charged before the client’s OK')
    await page.locator('#dc-root button', { hasText: 'said OK to charge' }).click()
    await shot(page, 'collect-saved-card')
    await charge.click()
    await seeText(page, `Charged ${money} to Visa ••5858`)
    const paid = await until('the invoice paid', async () => {
      const d = await api(req, `/invoices/${S.a.invoice}`)
      return d.calc.balance === 0 ? d : null
    })
    const pay = paid.ledger.find((e: any) => e.type === 'pay' && e.processor === 'square')
    check(pay, 'a Square payment on the ledger')
    eq(pay.amountCents, due, 'the amount charged')
  })

  await step('No-show: the fee is proposed on the saved card, charged after a confirm', async () => {
    await openFileOf(page, NAMES.b)
    await page.locator('div[style*="z-index: 60"] button', { hasText: /^No-show$/ }).click()
    await seeText(page, /^Mark Nolan as a no-show\?/)
    await page.locator('div[style*="z-index: 60"] button', { hasText: 'Mark no-show' }).click()
    const fees = await until('the proposed fee', async () => {
      const f = await api(req, `/appointments/${S.b.appt}/fee-charges`)
      return f.items.find((c: any) => c.purpose === 'no_show_fee' && c.state === 'proposed') ? f : null
    })
    const fee = fees.items[0]
    const money =
      '$' + (fee.amountCents % 100 ? (fee.amountCents / 100).toFixed(2) : String(fee.amountCents / 100))
    await seeText(page, `No-show fee · ${money} on Visa ••5858`)
    await seeText(page, 'Proposed by the cancellation rules. Charge it or waive it.')
    await shot(page, 'file-no-show-fee')
    await page
      .locator('div[style*="z-index: 60"] button', { hasText: `Charge ${money}` })
      .first()
      .click()
    await seeText(page, `Charge the No-show fee of ${money} on Visa ••5858 now?`)
    await page
      .locator('div[style*="z-index: 60"] button', { hasText: `Charge ${money}` })
      .last()
      .click()
    await seeText(page, 'No-show fee charged')
    const done = await until('the fee charged', async () => {
      const f = await api(req, `/appointments/${S.b.appt}/fee-charges`)
      return f.items.find((c: any) => c.id === fee.id && c.state === 'charged')
    })
    check(done.squarePaymentId, 'Square took the payment')
    await seeText(page, /^Charged .+/)
  })

  await step(
    'a client joins Gold on their membership page; the Membership tab shows the Square billing block',
    async () => {
      const s = await verifiedPage(S.c.id, 'membership', 'gold')
      const r = await linkApi('POST', '/membership/subscribe', {
        session: s,
        key: `e2e-sub-${crypto.randomUUID()}`,
        body: {
          email: 'mira.member.e2e@gmail.com',
          planClass: 'compact_car',
          sourceId: 'cnon:card-nonce-ok',
          consentVersion: consents.CURRENT_CONSENT_VERSION,
          postalCode: '07026',
        },
      })
      check(
        r.status === 202,
        `the subscription is asked for (${r.status} ${JSON.stringify(r.body).slice(0, 160)})`,
      )
      const view = await until(
        'the membership active, billed by Square',
        async () => {
          await sim('/__sim/clock', { advanceMs: 15_000 }).catch(() => null)
          const m = await api(req, `/customers/${S.c.id}/membership`)
          return m.membership?.status === 'active' && m.membership.billing?.lastPaid ? m : null
        },
        90_000,
      )
      S.c.membership = view.membership
      eq(view.membership.billing.planClassLabel, 'Compact car', 'the plan size')
      await openFileOf(page, NAMES.c)
      await fileTab(page, 'Membership')
      await seeText(page, 'Billed by Square')
      await seeText(page, 'Active · billed by Square')
      await seeText(page, view.membership.billing.card.label + ' · expires')
      await shot(page, 'membership-billing-block')
    },
  )

  await step('the billing block: Pause asks first, then Square schedules it', async () => {
    await page.locator('div[style*="z-index: 60"] button', { hasText: /^Pause$/ }).click()
    await seeText(page, 'Pause from the next billing date? No charge while paused; perks stop then.')
    await page
      .locator('div[style*="z-index: 60"] button', { hasText: /^Pause$/ })
      .last()
      .click()
    await seeText(page, 'Membership will pause')
    const m = await until('the pause scheduled', async () => {
      const v = await api(req, `/customers/${S.c.id}/membership`)
      return v.membership?.billing?.pauseAt ? v : null
    })
    await seeText(page, new RegExp('^Pauses on '))
    await seeText(page, 'Undo pause')
    void m
    await shot(page, 'membership-paused')
  })
} catch (e) {
  results.push({ step: 'the run', ok: false, detail: (e as Error).message })
  console.log('  FAIL the run: ' + (e as Error).message)
} finally {
  await browser.close().catch(() => {})
  await db.destroy().catch(() => {})
}

for (const p of problems) console.log('  PROBLEM ' + p)
const failed = results.filter((r) => !r.ok).length
console.log(`e2e-billing: ${results.length} steps, ${failed} failing, ${problems.length} problems`)
process.exit(failed || problems.length ? 1 : 0)
