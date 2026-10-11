/* eslint-disable @typescript-eslint/no-explicit-any */
// e2e-assistant — the AI assistant and phone identity parts of the live dashboard (ADR 0160, design section 8, plan G)
// against the real API on a stack started by scripts/live-stack.ts with the assistant's server switch on:
//
//   export AI_ENABLED=true ALLOW_DEV_ENDPOINTS=true SMS_ALLOWLIST=<the seeded numbers, docs/screens-operations-live.md>
//   pnpm live:up --name asst --api-port 4031 --web-port 3231 --profile design,parity-ops \
//        --freeze 2026-06-13T10:36:00-04:00 --backend ~/oasis/wt/ai-w3-dashapi
//   pnpm e2e:assistant --name asst [--keep-going]
//
// AI_PROVIDER stays `sim` (nothing reaches AWS); this backend has no turn yet, so nothing answers a text: the checks are
// the dashboard's. Changes data: reseed (live:down --drop, live:up) before running it again.
//   settings  Settings → Oasis AI assistant: the nav entry, the default "off" words, switch on, a test number (and a
//             refused one), the stage, the staff pause, an FAQ pair; one Save sends the changed fields and the version; a
//             change saved by someone else meanwhile is merged (both kept); #assistant; Support may read but not change.
//   messages  an inbound AGENT from an allowlisted client opens a handoff: the violet alert, the "AI paused — waiting for
//             a staff reply" line; a staff reply pauses the assistant ("AI paused — staff replying", until 10:36 PM); an
//             assistant text carries the "Oasis AI · SMS" tag; with the assistant switched off the line is gone.
//   identity  the Website PIN cell is absent without a PIN; with a PIN and a trusted number it reads "Set · trusted to
//             Jul 13"; Crew is refused without a request; Keep it; Clear PIN clears it on the server.
// Screenshots in parity-reports/e2e-assistant/. Exit code 1 when a check fails, a page errors or the API answers 5xx.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { EMAILS, loadStack, login } from './live-e2e'

process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE ??= 'ubuntu24.04-arm64'

const args = process.argv.slice(2)
const flag = (n: string, d: string): string => (args.includes(n) ? args[args.indexOf(n) + 1]! : d)
const name = flag('--name', 'asst')
const stack = loadStack(name) as ReturnType<typeof loadStack> & { backend: string }
const keepGoing = args.includes('--keep-going')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const shots = path.join(root, 'parity-reports', 'e2e-assistant')
fs.mkdirSync(shots, { recursive: true })

/** A seeded client with an appointment on the board (her number is read from the database). */
const CLIENT = { name: 'Priya Nair', first: 'Priya', phone: '' }
const TEST_NUMBER = { typed: '(305) 555-0171', e164: '+13055550171' }

// ---- assertions -------------------------------------------------------------------------------------------------------

let passed = 0
const failures: string[] = []
const pageErrors: string[] = []
const apiBad: string[] = []
const client4xx: string[] = []

function ok(cond: unknown, label: string, detail?: unknown): void {
  if (cond) {
    passed++
    console.log('  ok   ' + label)
    return
  }
  const d = detail === undefined ? '' : ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))
  failures.push(label + d)
  console.log('  FAIL ' + label + d.slice(0, 700))
  if (!keepGoing && failures.length > 25) throw new Error('too many failures')
}
const section = (s: string): void => console.log('\n== ' + s)
/** The stack's frozen clock (the database's own now() is the real one): fixtures are stamped a few minutes before it. */
const AT = `timestamptz '2026-06-13 10:30:00-04'`
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function until<T>(fn: () => Promise<T>, ms = 10_000): Promise<T | undefined> {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) return undefined
    await sleep(150)
  }
}

// ---- the stack's database (fixtures the dashboard cannot create: a PIN, a trust, an assistant text) -------------------

function databaseUrl(): string {
  const env = fs.readFileSync(path.join(stack.backend, '.env'), 'utf8')
  const m = env.match(/^DATABASE_URL=(.*)$/m)
  if (!m) throw new Error('no DATABASE_URL in the backend .env')
  return m[1]!.replace(/^['"]|['"]$/g, '')
}
function sql(text: string): string {
  const r = spawnSync(
    'psql',
    [databaseUrl(), '-v', 'ON_ERROR_STOP=1', '-qAtc', `set search_path to ${stack.schema}, public; ${text}`],
    { encoding: 'utf8' },
  )
  if (r.status !== 0) throw new Error('psql: ' + r.stderr)
  return r.stdout.trim()
}

// ---- API through a page (its cookies and CSRF) ----------------------------------------------------------------------------

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

interface Person {
  ctx: BrowserContext
  page: Page
  email: string
  requests: string[]
}

async function person(browser: Browser, email: string, next: string): Promise<Person> {
  const ctx = await browser.newContext({
    viewport: { width: 1480, height: 1000 },
    timezoneId: 'America/New_York',
    locale: 'en-US',
  })
  await ctx.addInitScript('window.__name = (f) => f')
  const page = await ctx.newPage()
  const requests: string[] = []
  page.on('pageerror', (e) => pageErrors.push(`${email}: ${String(e)}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text()))
      pageErrors.push(`${email}: console: ${m.text()}`)
  })
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/')) requests.push(`${r.method()} ${new URL(r.url()).pathname}`)
  })
  page.on('response', (r) => {
    if (!r.url().includes('/api/v1/')) return
    if (r.status() >= 500) apiBad.push(`${email}: ${r.status()} ${r.request().method()} ${r.url()}`)
    else if (r.status() >= 400 && r.status() !== 401)
      client4xx.push(`${email}: ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname.replace(/[0-9a-f-]{36}/g, ':id')}`)
  })
  await login(page, stack, email, next)
  return { ctx, page, email, requests }
}

const shot = async (page: Page, file: string): Promise<void> =>
  void (await page.screenshot({ path: path.join(shots, file + '.png') }))
const bodyText = async (page: Page): Promise<string> =>
  ((await page.locator('#dc-root').innerText().catch(() => '')) as string).replace(/\s+/g, ' ')
const waitText = async (page: Page, s: string, ms = 10_000): Promise<boolean> =>
  !!(await until(async () => (await bodyText(page)).includes(s), ms))

// ---- Settings ---------------------------------------------------------------------------------------------------------------

async function openSettings(page: Page, hash = ''): Promise<void> {
  await page.goto(`${stack.webUrl}/settings${hash}`, { waitUntil: 'load' })
  if (hash) await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('#dc-root .sc-host', { timeout: 20_000 })
  await page.getByText('Loading settings…').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {})
}
const navButton = (page: Page) => page.locator('aside button', { hasText: 'Oasis AI assistant' }).first()
const main = (page: Page) => page.locator('#dc-root section').first()

async function phaseSettings(browser: Browser): Promise<void> {
  section('Settings → Oasis AI assistant')
  const m = await person(browser, EMAILS.manager, '/settings')
  const A = m.page
  await openSettings(A)
  const aside = (await A.locator('aside').innerText()).replace(/\s+/g, ' ')
  ok(/Packages & checklists Texting Oasis AI assistant$/i.test(aside.trim()), 'the nav entry is the Texting group, last', aside)
  ok(!aside.includes(' ON'), 'no ON badge while the assistant is off')
  await navButton(A).click()
  ok(await waitText(A, 'Who it answers'), 'the section opens')
  let t = await bodyText(A)
  ok(t.includes('Oasis AI assistant') && t.includes('Who the texting assistant answers'), 'the header names the section')
  ok(t.includes('Oasis AI is off: texts reach the team as today.'), 'off, in plain words', t.slice(0, 600))
  ok(t.includes('Book, move and cancel by text') && t.includes('Pause after a staff reply') && t.includes('12 hours'), 'switches and the pause')
  ok(t.includes('No numbers yet.') && t.includes('No questions yet.') && t.includes('0 of 40'), 'empty lists say so')
  await shot(A, 'settings-default')

  // a refused number: no request
  const n0 = m.requests.length
  const numberBox = main(A).locator('input[placeholder="(201) 555-0142"]')
  await numberBox.fill('555-0142')
  await main(A).getByRole('button', { name: 'Add number' }).click()
  ok(await waitText(A, 'Enter a 10-digit US or Canadian number.'), 'a number that is not one is refused inline')
  ok(!m.requests.slice(n0).some((r) => r.startsWith('PUT')), 'and nothing is sent')

  // switch on, a test number, the stage stays Test numbers, the pause, a question
  await main(A)
    .getByText('Answer texts with Oasis AI', { exact: true })
    .locator('xpath=ancestor::div[.//button][1]//button')
    .click()
  await numberBox.fill('305-555-0171')
  await numberBox.press('Enter')
  ok(await waitText(A, TEST_NUMBER.typed), 'the number is listed the way people write it')
  await main(A).getByRole('button', { name: '+', exact: true }).click()
  ok(await waitText(A, '13 hours'), 'the pause steps by an hour')
  await main(A).getByRole('button', { name: 'Add question' }).click()
  await main(A).locator('input[placeholder="Question, as a client would ask it"]').first().fill('Do you take walk-ins?')
  await main(A).locator('textarea').first().fill('Yes, any time we are open. Booked cars go first.')
  ok(await waitText(A, 'Unsaved changes to the assistant'), 'the save bar appears')
  await shot(A, 'settings-edited')
  const before = (await api(A, 'GET', '/settings/assistant')).body
  const n1 = m.requests.length
  await A.getByRole('button', { name: 'Save changes' }).click()
  ok(await waitText(A, 'Assistant settings saved'), 'the save toast', (await bodyText(A)).slice(-300))
  ok(m.requests.slice(n1).filter((r) => r === 'PUT /api/v1/settings/assistant').length === 1, 'one PUT')
  const after = (await api(A, 'GET', '/settings/assistant')).body
  ok(
    after.enabled === true &&
      after.stage === 'allowlist' &&
      JSON.stringify(after.allowlist) === JSON.stringify([TEST_NUMBER.e164]) &&
      after.staffPauseHours === 13 &&
      after.faq.length === 1 &&
      after.faq[0].q === 'Do you take walk-ins?' &&
      after.version > before.version,
    'the server has what the screen saved',
    after,
  )
  ok(after.active === true && after.server.aiEnabled === true, 'the stack runs with AI_ENABLED: the assistant is active', after)
  ok(await waitText(A, 'Oasis AI is answering texts.'), 'the strip says it answers texts')
  ok(!(await bodyText(A)).includes('Unsaved changes to the assistant'), 'the save bar is gone')
  ok(/Oasis AI assistant\s*ON/.test(await A.locator('aside').innerText()), 'the nav badge reads ON')

  // someone else saves meanwhile (Super Admin through the API); this page changes the stage: both are kept
  const su = await person(browser, EMAILS.superAdmin, '/settings')
  const cur = (await api(su.page, 'GET', '/settings/assistant')).body
  const other = await api(su.page, 'PUT', '/settings/assistant', { staffPauseHours: 6, version: cur.version })
  ok(other.status === 200, 'another person saves the pause', other)
  await main(A).getByRole('button', { name: 'Clients', exact: true }).click()
  ok(await waitText(A, 'Every client already on file gets answers'), 'the stage is explained')
  ok(await waitText(A, '6 hours'), 'the other person’s pause shows without a reload (the field nobody touched here)')
  await A.getByRole('button', { name: 'Save changes' }).click()
  const merged = await until(async () => {
    const v = (await api(A, 'GET', '/settings/assistant')).body
    return v.stage === 'customers' ? v : undefined
  })
  ok(merged?.stage === 'customers' && merged?.staffPauseHours === 6, 'saved over the newer version: both changes are kept', merged)
  // back to the test numbers for the Messages phase
  await main(A).getByRole('button', { name: 'Test numbers', exact: true }).click()
  await A.getByRole('button', { name: 'Save changes' }).click()
  ok(
    !!(await until(async () => (await api(A, 'GET', '/settings/assistant')).body.stage === 'allowlist')),
    'stage back to Test numbers',
  )

  // a deep link opens the section; a reload shows what the server has
  await openSettings(A, '#assistant')
  ok(await waitText(A, 'Who it answers'), '#assistant opens the section')
  t = await bodyText(A)
  ok(t.includes(TEST_NUMBER.typed) && t.includes('6 hours') && t.includes('1 of 40'), 'after a reload the section shows the server', t.slice(0, 900))
  await shot(A, 'settings-saved')

  // Support may read but not change (set.hours)
  const sp = await person(browser, EMAILS.support, '/settings')
  await openSettings(sp.page)
  await navButton(sp.page).click()
  ok(await waitText(sp.page, 'Who it answers'), 'Support reads the section')
  const n2 = sp.requests.length
  await main(sp.page).getByRole('button', { name: 'Everyone', exact: true }).click()
  ok(await waitText(sp.page, 'Your role can’t change the assistant settings'), 'Support gets the design toast')
  ok(!sp.requests.slice(n2).some((r) => r.startsWith('PUT')), 'and nothing is sent')
  ok(!(await bodyText(sp.page)).includes('Unsaved changes to the assistant'), 'nothing changed on screen')
  for (const p of [m, su, sp]) await p.ctx.close()
}

// ---- Operations: the file --------------------------------------------------------------------------------------------------

const modal = (page: Page) => page.locator('div[style*="z-index: 60"]').first()
const fileText = async (page: Page): Promise<string> =>
  ((await modal(page).innerText().catch(() => '')) as string).replace(/\s+/g, ' ')

async function openBoard(page: Page): Promise<void> {
  await page.goto(`${stack.webUrl}/operations`, { waitUntil: 'load' })
  await page.waitForSelector('text=Appointments 24h', { timeout: 30_000 })
  await sleep(800)
}
async function view(page: Page, label: 'Timeline' | 'Bay Board'): Promise<void> {
  if (await modal(page).isVisible().catch(() => false)) return
  await page.locator('#dc-root button', { hasText: label }).first().click()
  await sleep(300)
}
async function openFile(page: Page, who: string): Promise<void> {
  await view(page, 'Timeline')
  await page.locator('#dc-root button', { hasText: who }).filter({ hasNot: page.locator('[data-drop]') }).first().click()
  await modal(page).waitFor({ timeout: 10_000 })
  await page.waitForFunction((n) => document.querySelector('div[style*="z-index: 60"]')?.textContent?.includes(n), who, {
    timeout: 10_000,
  })
}
async function tab(page: Page, label: string): Promise<void> {
  await modal(page).locator('button', { hasText: new RegExp('^\\s*' + label) }).first().click()
  await sleep(400)
}
async function closeFile(page: Page): Promise<void> {
  // keys typed in an input belong to the input (the composer): leave it first
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Escape')
  await modal(page).waitFor({ state: 'detached', timeout: 5000 }).catch(() => undefined)
}

async function clientAppointment(page: Page): Promise<string> {
  const snap = (await api(page, 'GET', '/ops/snapshot?window=next24')).body
  const cards = [
    ...snap.timeline.groups.flatMap((g: any) => g.items),
    ...snap.completed.items,
    ...snap.bays.flatMap((b: any) => (b.occupant ? [b.occupant.card] : [])),
  ]
  return cards.find((c: any) => c.customer.name === CLIENT.name)!.id
}

async function phaseMessages(browser: Browser): Promise<void> {
  section('Messages: handoff, AI paused, the Oasis AI tag')
  const m = await person(browser, EMAILS.manager, '/operations')
  const A = m.page
  await openBoard(A)
  const apptId = await clientAppointment(A)
  CLIENT.phone = sql(
    `select phone_e164 from customers where full_name = '${CLIENT.name}' and deleted_at is null and merged_into is null limit 1`,
  )
  ok(/^\+1\d{10}$/.test(CLIENT.phone), 'the client has a number', CLIENT.phone)
  // her number joins the test numbers (the stage is Test numbers)
  const v0 = (await api(A, 'GET', '/settings/assistant')).body
  const put = await api(A, 'PUT', '/settings/assistant', { allowlist: [...v0.allowlist, CLIENT.phone], version: v0.version })
  ok(put.status === 200 && put.body.stage === 'allowlist', 'her number is on the test list', put)
  const thread0 = (await api(A, 'GET', `/appointments/${apptId}/messages`)).body
  ok(thread0.assistantActive === true && thread0.handoff.open === false, 'the thread says the assistant is active', thread0)
  await openFile(A, CLIENT.name)
  await tab(A, 'Messages')
  ok(!(await fileText(A)).includes('AI paused'), 'no line before anything happened')
  await closeFile(A)

  // AGENT from her number (on the test list): a handoff and its alert
  const inbound = await api(A, 'POST', '/dev/sms/inbound', { from: CLIENT.phone, body: 'AGENT' })
  ok(inbound.status === 200, 'the simulator takes the AGENT text', inbound)
  const alertTitle = `Asked for a person · ${CLIENT.name}`
  // Needs attention lives on the Bay Board
  await view(A, 'Bay Board')
  ok(await waitText(A, alertTitle, 12_000), 'the handoff alert appears on the board without a reload', (await bodyText(A)).slice(0, 500))
  await shot(A, 'board-handoff-alert')
  const snap = (await api(A, 'GET', '/ops/snapshot?window=next24')).body
  const alert = snap.alerts.find((a: any) => a.kind === 'ai_handoff')
  ok(!!alert && alert.tone === 'violet' && alert.actionLabel === 'Open messages', 'the API alert', alert)
  // its button: the thread when the server names an appointment, else the alert's own words
  await A.locator('#dc-root button', { hasText: 'Open messages' }).first().click()
  await sleep(600)
  if (alert?.appointmentId) {
    ok(await until(async () => (await fileText(A)).includes('Conversation')), 'the alert opens the Messages tab')
  } else {
    ok(
      !(await modal(A).isVisible().catch(() => false)) && (await waitText(A, 'texted AGENT')),
      'the server names no appointment for the handoff: the alert says what it says (no file to open)',
    )
  }
  await closeFile(A)
  await openFile(A, CLIENT.name)
  await tab(A, 'Messages')
  ok(
    await until(async () => (await fileText(A)).includes('AI paused — waiting for a staff reply')),
    'the thread says the AI waits for staff',
    (await fileText(A)).slice(-400),
  )
  ok((await fileText(A)).includes('The client asked for a person at 10:36 AM.'), 'and why, with the time')
  const fileNow = (await api(A, 'GET', `/appointments/${apptId}`)).body
  const ct = (await api(A, 'GET', `/customers/${fileNow.customer.id}/messages`)).body
  ok(ct.items.some((x: any) => x.direction === 'in' && x.text === 'AGENT'), "the client's AGENT is in her thread", ct.items.slice(-3))
  await shot(A, 'file-handoff-line')

  // a staff reply: the handoff closes and the assistant is paused until 10:36 PM (13 hours were saved, then 6: 4:36 PM)
  const pause = (await api(A, 'GET', '/settings/assistant')).body.staffPauseHours
  const box = modal(A).locator('input[placeholder="Type a message…"]')
  await box.fill('Hi Priya, this is Rafael. How can I help?')
  await box.press('Enter')
  const until12 = new Date(Date.parse('2026-06-13T10:36:00-04:00') + pause * 3600_000)
  const clock = until12.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
  ok(
    await until(async () => (await fileText(A)).includes('AI paused — staff replying')),
    'after the staff reply: AI paused — staff replying',
    (await fileText(A)).slice(-400),
  )
  ok((await fileText(A)).includes(`Oasis AI answers again at ${clock}.`), `until ${clock} (the saved pause)`, (await fileText(A)).slice(-300))
  const thread1 = (await api(A, 'GET', `/appointments/${apptId}/messages`)).body
  ok(thread1.handoff.open === false && !!thread1.aiPausedUntil, 'the server: handoff closed, paused', thread1.handoff)
  await closeFile(A)
  await view(A, 'Bay Board')
  ok(!!(await until(async () => !(await bodyText(A)).includes(alertTitle), 12_000)), 'the handoff alert is gone')
  await openFile(A, CLIENT.name)
  await tab(A, 'Messages')
  await shot(A, 'file-paused-line')

  // an assistant text (no turn exists in this backend: written straight to the database) carries the tag
  sql(
    `insert into messages (id, location_id, thread_id, customer_id, appointment_id, direction, sender_kind, channel, body, klass, status, segments, queued_at, sent_at, delivered_at)
     select gen_random_uuid(), location_id, thread_id, customer_id, appointment_id, 'out', 'ai', 'sms',
            'We are open today until 6:00 PM. A team member will text you shortly.', 'ai_reply', 'delivered', 1, ${AT}, ${AT}, ${AT}
     from messages where appointment_id = '${apptId}' and direction = 'out' order by queued_at limit 1`,
  )
  await closeFile(A)
  await openBoard(A)
  await openFile(A, CLIENT.name)
  await tab(A, 'Messages')
  ok(
    await until(async () => /Oasis AI · SMS/i.test(await fileText(A))),
    'the assistant text carries the Oasis AI tag',
    (await fileText(A)).slice(-500),
  )
  const thread2 = (await api(A, 'GET', `/appointments/${apptId}/messages`)).body
  const ai = thread2.items.find((x: any) => x.author === 'ai')
  ok(ai?.senderName === 'Oasis AI' && ai?.from === 'system', 'the API marks it as the assistant', ai)
  await shot(A, 'file-ai-tag')

  // the assistant switched off: the line is gone (the tag stays: it says who wrote it)
  const v = (await api(A, 'GET', '/settings/assistant')).body
  await api(A, 'PUT', '/settings/assistant', { enabled: false, version: v.version })
  await closeFile(A)
  await openBoard(A)
  await openFile(A, CLIENT.name)
  await tab(A, 'Messages')
  await sleep(800)
  ok(!(await fileText(A)).includes('AI paused'), 'assistant off: no AI paused line', (await fileText(A)).slice(-300))
  ok(/Oasis AI · SMS/i.test(await fileText(A)), 'the tag stays on the text the assistant wrote')
  await m.ctx.close()
}

async function phaseIdentity(browser: Browser): Promise<void> {
  section('Overview: Website PIN')
  const m = await person(browser, EMAILS.manager, '/operations')
  const A = m.page
  await openBoard(A)
  const apptId = await clientAppointment(A)
  const file = (await api(A, 'GET', `/appointments/${apptId}`)).body
  const customerId = file.customer.id
  await openFile(A, CLIENT.name)
  await sleep(800)
  ok((await fileText(A)).includes('Membership') && !(await fileText(A)).includes('Website PIN'), 'no PIN, not trusted: no cell')
  await closeFile(A)

  // a PIN and a trusted number (the link pages that set them are not live in this backend)
  const loc = sql(`select location_id from appointments where id = '${apptId}'`)
  sql(
    `insert into customer_pins (customer_id, pin_hash, version, set_at) values ('${customerId}', 'e2e-not-a-real-scrypt-hash-0000000000', 1, ${AT});
     insert into phone_trust (location_id, phone_e164, customer_id, verified_at, verified_by, expires_at, epoch)
     values ('${loc}', '${CLIENT.phone}', '${customerId}', ${AT}, 'pin', ${AT} + interval '30 days',
             coalesce((select (value #>> '{}')::int from settings where key = 'links.epoch' limit 1), 1))`,
  )
  const id0 = (await api(A, 'GET', `/customers/${customerId}/identity`)).body
  ok(id0.pin.status === 'set' && id0.trust.trusted === true, 'the server: PIN set, number trusted', id0)
  await openFile(A, CLIENT.name)
  ok(
    await until(async () => (await fileText(A)).includes('Website PIN')),
    'the cell appears',
    (await fileText(A)).slice(0, 600),
  )
  ok((await fileText(A)).includes('Set · trusted to Jul 13'), 'Set · trusted to Jul 13', (await fileText(A)).slice(0, 700))
  await shot(A, 'file-pin-cell')
  await closeFile(A)

  // Crew: the toast, no request
  const crew = await person(browser, EMAILS.crew, '/operations')
  await openBoard(crew.page)
  await openFile(crew.page, CLIENT.name)
  await until(async () => (await fileText(crew.page)).includes('Website PIN'))
  const n0 = crew.requests.length
  await modal(crew.page).getByRole('button', { name: 'Clear PIN' }).click()
  ok(await waitText(crew.page, 'Your role can’t edit clients'), 'Crew gets the design toast')
  ok(!crew.requests.slice(n0).some((r) => r.startsWith('POST')), 'and nothing is sent')
  ok(!(await fileText(crew.page)).includes('Keep it'), 'no question for Crew')
  await crew.ctx.close()

  // Management: Keep it, then Clear PIN
  await openFile(A, CLIENT.name)
  await until(async () => (await fileText(A)).includes('Website PIN'))
  await modal(A).getByRole('button', { name: 'Clear PIN' }).click()
  ok(
    await until(async () => (await fileText(A)).includes('Clear Priya’s website PIN?')),
    'Clear PIN asks first',
    (await fileText(A)).slice(0, 700),
  )
  await shot(A, 'file-pin-confirm')
  await modal(A).getByRole('button', { name: 'Keep it' }).click()
  ok(!(await fileText(A)).includes('Clear Priya’s website PIN?'), 'Keep it closes the question')
  ok((await api(A, 'GET', `/customers/${customerId}/identity`)).body.pin.status === 'set', 'and the PIN is untouched')
  await modal(A).getByRole('button', { name: 'Clear PIN' }).click()
  const n1 = m.requests.length
  await modal(A).getByRole('button', { name: 'Clear PIN' }).last().click()
  ok(await waitText(A, 'Website PIN cleared'), 'the toast', (await bodyText(A)).slice(-300))
  ok(m.requests.slice(n1).filter((r) => r.endsWith('/identity/pin/clear')).length === 1, 'one POST pin/clear')
  ok(
    await until(async () => (await fileText(A)).includes('Cleared · not trusted')),
    'the cell follows the server: Cleared · not trusted',
    (await fileText(A)).slice(0, 700),
  )
  const id1 = (await api(A, 'GET', `/customers/${customerId}/identity`)).body
  ok(id1.pin.status === 'cleared' && id1.trust.trusted === false, 'the server: PIN cleared, trust ended', id1)
  ok(!(await fileText(A)).includes('Clear PIN'), 'no Clear PIN once there is no PIN')
  await shot(A, 'file-pin-cleared')
  await m.ctx.close()
}

// ---- main -------------------------------------------------------------------------------------------------------------------

const browser = await chromium.launch()
try {
  await phaseSettings(browser)
  await phaseMessages(browser)
  await phaseIdentity(browser)
} catch (e) {
  failures.push('uncaught: ' + String((e as Error).stack ?? e))
  console.log('  FAIL uncaught', (e as Error).message)
} finally {
  await browser.close()
}

console.log('\n== summary')
console.log(`checks passed: ${passed}`)
console.log(`failures: ${failures.length}`)
for (const f of failures) console.log('  - ' + f.slice(0, 400))
console.log(`page errors: ${pageErrors.length}`)
for (const e of pageErrors.slice(0, 10)) console.log('  - ' + e.slice(0, 300))
console.log(`API 5xx: ${apiBad.length}`)
for (const e of apiBad) console.log('  - ' + e)
const seen = [...new Set(client4xx)]
console.log(`API 4xx seen: ${seen.length}`)
for (const e of seen) console.log('  - ' + e)
process.exit(failures.length || pageErrors.length || apiBad.length ? 1 : 0)
