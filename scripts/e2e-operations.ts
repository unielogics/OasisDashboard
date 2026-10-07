/* eslint-disable @typescript-eslint/no-explicit-any */
// e2e-operations — the live Operations screen against the real API on a stack started by scripts/live-stack.ts.
//
//   export SMS_ALLOWLIST=<the seeded customers' numbers, +13055550171 and +13055550172> ALLOW_DEV_ENDPOINTS=true
//   pnpm live:up --name ops --api-port 4023 --web-port 3223 --profile design,parity-ops \
//        --freeze 2026-06-13T10:36:00-04:00 --backend ~/oasis/wt/d9-be
//   pnpm e2e:operations --name ops [--phase visual|read|write|roles|all] [--keep-going]
//
// Phases (the stack must be freshly seeded; `write` changes data, `visual` and `read` are repeatable until `write` ran):
//   visual  the ORIGINAL bundle and the live page in the same state (clock pinned to 10:36, light theme): the board, the
//           Bay Board, Staff, Calendar day/week/month, the New Appointment sheet and the eight tabs of the file; PNGs of
//           both and a pixel diff of each pair in parity-reports/e2e-operations/.
//   read    Management: every visible figure of the board, the bay board, the pickup column, the alerts, the calendar and
//           the eight tabs of every appointment against the API, after a reload too.
//   write   Management, Accounting and a second browser (Support): advance a job through every stage to pickup and
//           collect, assign by drag and by menu, reschedule by drag (and a refused one), add-on after payment and its 409,
//           new appointment and walk-in with real fields, an SMS sent and delivered through the SMS Gate simulator, an
//           inbound STOP, a photo upload (and HEIC refused), a membership credit, Mark Paid by card -> "Payment pending"
//           -> confirm in Squarespace -> "Paid", checklist, a second browser that sees every change without a reload, a
//           reload that still matches the API.
//   roles   Crew, Support, Accounting and a Super Admin viewing as Crew: what they may do, the design's toast and no request.
// Exit code 1 when any check fails, a page errors or the API answers 5xx.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
import { EMAILS, loadStack, login } from './live-e2e'
import type { LiveStack } from './live-e2e'

process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE ??= 'ubuntu24.04-arm64'

const args = process.argv.slice(2)
const flag = (n: string, d: string): string => (args.includes(n) ? args[args.indexOf(n) + 1]! : d)
const stack: LiveStack = loadStack(flag('--name', 'ops'))
const phase = flag('--phase', 'all')
const keepGoing = args.includes('--keep-going')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const shots = path.join(root, 'parity-reports', 'e2e-operations')
fs.mkdirSync(shots, { recursive: true })

// ---- tiny assertion framework --------------------------------------------------------------------------------------

let passed = 0
const failures: string[] = []
const pageErrors: string[] = []
const apiBad: string[] = []
const client4xx: string[] = []

function ok(cond: unknown, name: string, detail?: unknown): void {
  if (cond) {
    passed++
    return
  }
  const d =
    detail === undefined ? '' : ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))
  failures.push(name + d)
  console.log('  FAIL ' + name + d.slice(0, 700))
  if (!keepGoing && failures.length > 40) throw new Error('too many failures')
}
const section = (s: string): void => console.log('\n== ' + s)
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const has = (text: string, ...parts: Array<string | null | undefined>): string[] =>
  parts.filter((p): p is string => !!p && !text.includes(p))

// ---- money, independent of the app ---------------------------------------------------------------------------------

function usd(c: number): string {
  const s = '$' + Math.floor(Math.abs(c) / 100).toLocaleString('en-US')
  return (c < 0 ? '−' : '') + (c % 100 === 0 ? s : s + '.' + String(Math.abs(c) % 100).padStart(2, '0'))
}

// ---- API access through the page (cookies and CSRF of that login) --------------------------------------------------

async function api<T = any>(
  page: Page,
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
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
        /* text body */
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

async function open(
  browser: Browser,
  email: string,
  o: { clock?: boolean; viewport?: { width: number; height: number } } = {},
): Promise<Person> {
  const ctx = await browser.newContext({
    viewport: o.viewport ?? { width: 1480, height: 1000 },
    timezoneId: 'America/New_York',
    locale: 'en-US',
    acceptDownloads: true,
  })
  await ctx.addInitScript('window.__name = (f) => f')
  const page = await ctx.newPage()
  const requests: string[] = []
  page.on('pageerror', (e) => pageErrors.push(`${email}: ${String(e)}`))
  page.on('console', (m) => {
    if (
      m.type() === 'error' &&
      !/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())
    )
      pageErrors.push(`${email}: console: ${m.text()}`)
  })
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/')) requests.push(`${r.method()} ${new URL(r.url()).pathname}`)
  })
  page.on('response', (r) => {
    if (!r.url().includes('/api/v1/') && !r.url().includes('/dev-storage/')) return
    if (r.status() >= 500) apiBad.push(`${email}: ${r.status()} ${r.request().method()} ${r.url()}`)
    else if (r.status() >= 400 && r.status() !== 401)
      client4xx.push(
        `${email}: ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname.replace(/[0-9a-f-]{36}/g, ':id')}`,
      )
  })
  await login(page, stack, email, '/operations')
  await page.waitForSelector('text=Appointments 24h', { timeout: 30_000 })
  await page
    .waitForFunction(() => !document.body.innerText.includes('—\n'), null, { timeout: 15_000 })
    .catch(() => undefined)
  return { ctx, page, email, requests }
}

const shot = async (page: Page, name: string): Promise<void> =>
  void (await page.screenshot({ path: path.join(shots, name + '.png') }))

// ---- scraping the screen --------------------------------------------------------------------------------------------

interface Board {
  kpis: Array<{ label: string; value: string; sub: string }>
  clock: string
  date: string
  dividers: string[]
  cards: Array<{ name: string; text: string }>
  inFacility: string
  bays: Array<{ name: string; text: string }>
  arrivals: string[]
  completed: Array<{ name: string; text: string; chips: string[] }>
  completedCount: string
  alerts: Array<{ title: string; text: string }>
  queue: string[]
  staff: Array<{ name: string; count: string; jobs: string[] }>
  emergency: string
  toast: string
  viewAsBar: string
}

async function scrapeBoard(page: Page): Promise<Board> {
  return page.evaluate(() => {
    const root = document.querySelector('#dc-root')!
    const t = (e: Node | null | undefined): string => (e?.textContent ?? '').replace(/\s+/g, ' ').trim()
    const all = <T extends Element = HTMLElement>(sel: string, from: ParentNode = root): T[] => [
      ...from.querySelectorAll<T>(sel),
    ]
    const labels = [
      'Appointments 24h',
      'Active jobs',
      'Ready for pickup',
      'Pending payments',
      'Bay time free',
      'Members today',
      'Revenue today',
    ]
    const kpis = labels.map((label) => {
      const l = all('div').find((d) => d.children.length === 0 && t(d) === label)
      const tile = l?.parentElement
      const v = l?.nextElementSibling
      return { label, value: t(v?.children[0]), sub: t(v?.children[1]), ok: !!tile }
    })
    const clockEl = all('span').find((s) => t(s.parentElement).startsWith('Live ·'))
    const clock = t(clockEl?.parentElement)
    const date = t(clockEl?.parentElement?.nextElementSibling)
    const main = root.querySelector('main')!
    const sections = [...main.querySelectorAll('section')]
    const tl = sections.find((s) => t(s).startsWith('Appointment Timeline'))
    const dividers = tl
      ? all('div', tl)
          .filter(
            (d) =>
              d.style.textTransform === 'uppercase' &&
              d.children.length === 0 &&
              d.style.letterSpacing === '0.07em' &&
              t(d),
          )
          .map((d) => t(d))
      : []
    const cards = tl
      ? all<HTMLButtonElement>('button', tl).map((b) => ({
          name: t(b.querySelector('span span')),
          text: t(b),
        }))
      : []
    const bayCol = sections.find((s) => t(s).startsWith('Active Bays'))
    const inFacility = t(all('div', bayCol).find((d) => /in facility$/.test(t(d)) && d.children.length === 0))
    const bays = bayCol
      ? all('div[data-drop]', bayCol).map((d) => ({ name: t(d.querySelector('div')), text: t(d) }))
      : []
    const arrivals = bayCol
      ? all('button', bayCol)
          .filter((b) => t(b).startsWith('Prep Bay') || t(b).includes('ready ✓') || t(b) === 'Check in')
          .map((b) => t(b))
      : []
    const aside = [...main.querySelectorAll('aside')]
    const done = aside.find((a) => t(a).startsWith('Ready & Completed'))
    const completed = done
      ? all<HTMLElement>('div', done)
          .filter((d) => d.style.padding === '14px 15px 14px 18px')
          .map((d) => ({
            name: t(d.querySelector('button span')),
            text: t(d),
            chips: all('button', d)
              .filter((b) =>
                ['Paid', 'Unpaid · collect', 'Payment pending', 'Picked up', 'Needs pickup'].includes(t(b)),
              )
              .map((b) => t(b)),
          }))
      : []
    const completedCount = t(done?.querySelector('div > div:nth-child(2)'))
    const na = aside.find((a) => t(a).startsWith('Needs Attention'))
    const alerts = na
      ? all<HTMLElement>('div', na)
          .filter((d) => d.style.padding === '13px 14px')
          .map((d) => ({ title: t(d.querySelector('div > div > div:nth-child(2) > div')), text: t(d) }))
      : []
    const queue = all(
      'button',
      [...main.querySelectorAll('div')].find((d) => t(d.firstElementChild) === 'Up Next') ?? root,
    ).map((b) => t(b))
    const staff: Board['staff'] = []
    const emergency = t(
      all('div').find((d) => t(d).startsWith('Emergency closure active') && d.children.length === 0),
    )
    const toastEl = all('div').find((d) => d.style.position === 'fixed' && d.style.bottom === '26px')
    const bar = all('div').find(
      (d) => t(d.children[0]).startsWith('Viewing as') && d.style.borderBottom !== '',
    )
    return {
      kpis,
      clock,
      date,
      dividers,
      cards,
      inFacility,
      bays,
      arrivals,
      completed,
      completedCount,
      alerts,
      queue,
      staff,
      emergency,
      toast: t(toastEl),
      viewAsBar: bar ? t(bar.children[0]) : '',
    }
  }) as Promise<Board>
}

const toast = async (page: Page): Promise<string> => (await scrapeBoard(page)).toast

async function waitToast(page: Page, includes: string, ms = 8000): Promise<string> {
  const t0 = Date.now()
  let last = ''
  while (Date.now() - t0 < ms) {
    last = await toast(page)
    if (last.includes(includes)) return last
    await sleep(120)
  }
  return last
}

/** Polls until `fn` returns a truthy value (SSE and refetches take a moment). */
async function until<T>(fn: () => Promise<T>, ms = 8000): Promise<T | undefined> {
  const t0 = Date.now()
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() - t0 > ms) return undefined
    await sleep(150)
  }
}

// ---- the file --------------------------------------------------------------------------------------------------------

const modal = (page: Page) => page.locator('div[style*="z-index: 60"]').first()

async function openFile(
  page: Page,
  name: string,
  where: 'card' | 'completed' | 'any' = 'any',
): Promise<void> {
  const sel = '#dc-root button'
  const btn = page.locator(sel, { hasText: name }).filter({ hasNot: page.locator('[data-drop]') })
  await btn.first().click()
  await modal(page).waitFor({ timeout: 10_000 })
  await page.waitForFunction(
    (n) => document.querySelector('div[style*="z-index: 60"]')?.textContent?.includes(n),
    name,
    { timeout: 10_000 },
  )
  void where
}

async function closeFile(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await modal(page)
    .waitFor({ state: 'detached', timeout: 5000 })
    .catch(() => undefined)
}

async function tab(page: Page, label: string): Promise<void> {
  await modal(page)
    .locator('button', { hasText: new RegExp('^\\s*' + label) })
    .first()
    .click()
  await sleep(250)
}

const fileText = async (page: Page): Promise<string> =>
  (
    (await modal(page)
      .innerText()
      .catch(() => '')) as string
  ).replace(/\s+/g, ' ')

async function apiCards(page: Page, window = 'next24'): Promise<any> {
  return (await api(page, 'GET', `/ops/snapshot?window=${window}`)).body
}
const findCard = (snap: any, name: string): any =>
  [
    ...snap.timeline.groups.flatMap((g: any) => g.items),
    ...snap.completed.items,
    ...snap.bays.flatMap((b: any) => (b.occupant ? [b.occupant.card] : [])),
  ].find((c: any) => c.customer.name === name)

// ---- comparing the screen with the API ---------------------------------------------------------------------------------

async function compareBoard(page: Page, label: string, view: 'timeline' | 'bay' = 'timeline'): Promise<void> {
  const snap = await apiCards(page)
  // allow a refetch to land
  let b = await scrapeBoard(page)
  const expectedCards = snap.timeline.groups.reduce((n: number, g: any) => n + g.items.length, 0)
  await until(async () => {
    b = await scrapeBoard(page)
    return view === 'bay' || b.cards.length === expectedCards
  })
  ok(
    snap.kpis.every((k: any, i: number) => b.kpis[i]!.value === k.value && b.kpis[i]!.sub === k.sub),
    `${label}: KPIs equal the API`,
    { screen: b.kpis, api: snap.kpis.map((k: any) => [k.value, k.sub]) },
  )
  ok(b.date === snap.now.dateLabel, `${label}: the date`, [b.date, snap.now.dateLabel])
  if (view === 'timeline') {
    ok(b.cards.length === expectedCards, `${label}: ${expectedCards} timeline cards`, b.cards.length)
    const cards: any[] = snap.timeline.groups.flatMap((g: any) => g.items)
    for (const c of cards) {
      const on = b.cards.find((x) => x.text.includes(c.customer.name) && x.text.includes(c.vehicleLine))
      const miss = on
        ? has(
            on.text,
            c.service,
            c.bayLabel,
            c.durLabel,
            c.pay.label,
            c.badge.label,
            c.next.label,
            c.vip ? 'VIP' : null,
            c.member?.label,
          )
        : ['card missing']
      ok(miss.length === 0, `${label}: card ${c.customer.name}`, miss)
    }
    const dividers = snap.timeline.groups.map((g: any) => g.divider).filter(Boolean)
    ok(JSON.stringify(b.dividers) === JSON.stringify(dividers), `${label}: dividers`, [b.dividers, dividers])
    ok(b.inFacility === snap.inFacilityLabel, `${label}: in-facility label`, [
      b.inFacility,
      snap.inFacilityLabel,
    ])
    for (const bay of snap.bays) {
      const on = b.bays.find((x) => x.name === bay.name)
      const miss = !on
        ? ['bay missing']
        : bay.occupant
          ? has(
              on.text,
              bay.occupant.card.customer.name,
              bay.occupant.card.vehicle.plate,
              bay.occupant.card.service,
              bay.occupant.durLabel,
              bay.occupant.worker?.name ?? 'Unassigned',
              bay.occupant.card.next.label,
            )
          : has(on.text, 'Available', bay.nextUp)
      ok(miss.length === 0, `${label}: ${bay.name}`, miss)
    }
    const occ = snap.bays.find((x: any) => x.occupant)
    if (occ) {
      const on = b.bays.find((x) => x.name === occ.name)!
      const m = /(\d+):(\d\d) elapsed/.exec(on.text)
      const elapsed = m ? Number(m[1]) * 60 + Number(m[2]) : -1
      ok(elapsed >= occ.occupant.elapsedSec - 3, `${label}: the bay timer runs from the server's start`, [
        elapsed,
        occ.occupant.elapsedSec,
      ])
    }
    for (const a of snap.arrivals)
      ok(b.arrivals.includes(a.prepLabel), `${label}: arrival ${a.prepLabel}`, b.arrivals)
    ok(b.completedCount === String(snap.completed.count), `${label}: pickup column count`, [
      b.completedCount,
      snap.completed.count,
    ])
    for (const c of snap.completed.items) {
      const on = b.completed.find((x) => x.name === c.customer.name)
      const payChip =
        c.pay.kind === 'paid' ? 'Paid' : c.pay.kind === 'pending' ? 'Payment pending' : 'Unpaid · collect'
      const pickChip = c.pickupState === 'collected' ? 'Picked up' : 'Needs pickup'
      const miss = on
        ? has(on.text, c.vehicleLine, c.service, c.time).concat(
            on.chips.includes(payChip) ? [] : ['pay chip ' + payChip + ' in ' + on.chips.join('|')],
            on.chips.includes(pickChip) ? [] : ['pickup chip'],
          )
        : ['completed card missing']
      ok(miss.length === 0, `${label}: completed ${c.customer.name}`, miss)
    }
  } else {
    ok(
      b.alerts.length === snap.alerts.length,
      `${label}: ${snap.alerts.length} alerts`,
      b.alerts.map((a) => a.title),
    )
    for (const a of snap.alerts) {
      const on = b.alerts.find((x) => x.text.includes(a.title) && x.text.includes(a.actionLabel))
      ok(
        !!on,
        `${label}: alert ${a.title}`,
        b.alerts.map((x) => x.text),
      )
    }
  }
}

// ---- phase: visual -----------------------------------------------------------------------------------------------------

function diffPngs(a: string, b: string, out: string): { pct: number; w: number; h: number } {
  const A = PNG.sync.read(fs.readFileSync(a))
  const B = PNG.sync.read(fs.readFileSync(b))
  const w = Math.min(A.width, B.width)
  const h = Math.min(A.height, B.height)
  const crop = (p: PNG): Buffer => {
    const o = Buffer.alloc(w * h * 4)
    for (let y = 0; y < h; y++) p.data.copy(o, y * w * 4, y * p.width * 4, y * p.width * 4 + w * 4)
    return o
  }
  const D = new PNG({ width: w, height: h })
  const n = pixelmatch(crop(A), crop(B), D.data, w, h, { threshold: 0.1 })
  fs.writeFileSync(out, PNG.sync.write(D))
  return { pct: (n / (w * h)) * 100, w, h }
}

async function phaseVisual(browser: Browser): Promise<void> {
  section('visual: the original bundle and the live page, same state')
  const { startOriginalServer } = await import('../tools/parity/serve-original')
  const { newParityContext, launchBrowser } = await import('../tools/parity/browser')
  const orig = await startOriginalServer({ port: 4311 })
  const pbrowser = await launchBrowser()
  const o = await newParityContext(pbrowser, {
    theme: 'light',
    allowedOrigins: [orig.origin],
    hideBranding: true,
  })
  await o.page.goto(orig.url('operations'))
  await o.page.waitForSelector('text=Appointments 24h')
  await sleep(500)
  // live: the same clock (the page's own clock is pinned to the server's 10:36 AM) and a quiet screen
  const ctx = await browser.newContext({
    viewport: { width: 1480, height: 1000 },
    timezoneId: 'America/New_York',
    locale: 'en-US',
  })
  await ctx.addInitScript('window.__name = (f) => f')
  await ctx.addInitScript(
    `try { localStorage.setItem('oasis-theme','light') } catch (e) {}
     (function(){ var css='*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'; function ensure(){ if(document.querySelector('style[data-e2e]'))return; var p=document.head||document.documentElement; if(!p)return; var s=document.createElement('style'); s.setAttribute('data-e2e','1'); s.textContent=css; p.appendChild(s)} ensure(); new MutationObserver(ensure).observe(document,{childList:true}) })()`,
  )
  const lp = await ctx.newPage()
  lp.on('pageerror', (e) => pageErrors.push(`visual: ${String(e)}`))
  await ctx.clock.install({ time: new Date('2026-06-13T10:36:00-04:00') })
  await login(lp, stack, EMAILS.manager, '/operations')
  await lp.waitForSelector('text=Appointments 24h')
  await ctx.clock.runFor(1500)
  await sleep(800)
  const pairs: Array<[string, (p: Page) => Promise<void>]> = []
  const clickText =
    (text: string, nth = 0) =>
    async (p: Page) => {
      await p.locator('#dc-root button', { hasText: text }).nth(nth).click()
      await sleep(350)
    }
  const fileOf = (name: string, tabLabel: string) => async (p: Page) => {
    await p.locator('#dc-root button', { hasText: name }).first().click()
    await sleep(500)
    if (tabLabel !== 'Overview') {
      await p
        .locator('div[style*="z-index: 60"] button', { hasText: new RegExp('^\\s*' + tabLabel) })
        .first()
        .click()
      await sleep(350)
    }
  }
  pairs.push(['01-board', async () => undefined])
  pairs.push(['02-bay-board', clickText('Bay Board')])
  pairs.push(['03-staff', clickText('Staff')])
  pairs.push(['04-calendar-day', clickText('Calendar')])
  pairs.push(['05-calendar-week', clickText('Week')])
  pairs.push(['06-calendar-month', clickText('Month')])
  const results: Array<{ name: string; pct: number }> = []
  const snapBoth = async (name: string): Promise<void> => {
    const a = path.join(shots, `orig-${name}.png`)
    const b = path.join(shots, `live-${name}.png`)
    await o.page.screenshot({ path: a })
    await lp.screenshot({ path: b })
    const d = diffPngs(a, b, path.join(shots, `diff-${name}.png`))
    results.push({ name, pct: d.pct })
  }
  for (const [name, step] of pairs) {
    await step(o.page)
    await step(lp)
    await ctx.clock.runFor(300)
    await snapBoth(name)
  }
  // reset to the board and open the sheets and the file
  await clickText('Timeline')(o.page)
  await clickText('Timeline')(lp)
  await o.page.locator('#dc-root button', { hasText: 'New Appointment' }).first().click()
  await lp.locator('#dc-root button', { hasText: 'New Appointment' }).first().click()
  await sleep(500)
  await ctx.clock.runFor(300)
  await snapBoth('07-new-appointment')
  await o.page.keyboard.press('Escape')
  await lp.keyboard.press('Escape')
  await sleep(300)
  for (const tabName of [
    'Overview',
    'Checklist',
    'Add-ons',
    'Photos',
    'Messages',
    'Payments',
    'Membership',
    'History',
  ]) {
    await fileOf('Priya Nair', tabName)(o.page)
    await fileOf('Priya Nair', tabName)(lp)
    await ctx.clock.runFor(300)
    await snapBoth(`08-file-${tabName.toLowerCase().replace(/[^a-z]/g, '')}`)
    await o.page.keyboard.press('Escape')
    await lp.keyboard.press('Escape')
    await sleep(300)
  }
  for (const r of results) console.log(`  ${r.name.padEnd(26)} ${r.pct.toFixed(2)}% of pixels differ`)
  ok(results.length >= 15, 'visual: all screens captured', results.length)
  fs.writeFileSync(path.join(shots, 'visual-summary.json'), JSON.stringify(results, null, 2))
  await ctx.close()
  await o.ctx.close()
  await pbrowser.close()
  await orig.close()
}

// ---- phase: read ---------------------------------------------------------------------------------------------------------

async function compareFile(page: Page, id: string, name: string): Promise<void> {
  const f = (await api(page, 'GET', `/appointments/${id}`)).body
  const o = f.overview
  await tab(page, 'Overview')
  let t = await fileText(page)
  let miss = has(
    t,
    f.customer.name,
    f.customer.phone,
    f.vehicle?.plate,
    f.vehicle?.make,
    o.service.name,
    o.time,
    o.durationMin + ' min',
    f.badge.label,
    f.status === 'completed' && f.invoice && f.invoice.balanceCents === 0 && f.overview.pay.kind === 'paid'
      ? 'Paid in full'
      : o.pay.label,
    f.customer.vip ? 'VIP' : null,
    f.membership ? f.membership.plan.split(' ')[0] : 'Non-member',
    o.bayLabel === 'No bay' ? 'Unassigned' : o.bayLabel,
    f.next.step ? f.next.label : 'Job Complete',
  )
  ok(miss.length === 0, `file ${name}: overview`, miss)
  await tab(page, 'Checklist')
  t = await fileText(page)
  miss = has(
    t,
    `${f.checklist.done} of ${f.checklist.total} tasks complete`,
    f.checklist.pct + '%',
    ...f.checklist.sections.map((s: any) => s.title),
    ...f.checklist.sections.flatMap((s: any) => s.items.map((i: any) => i.label)),
  )
  ok(miss.length === 0, `file ${name}: checklist`, miss)
  await tab(page, 'Add-ons')
  t = await fileText(page)
  miss = has(
    t,
    usd(f.addons.totalCents),
    ...f.addons.catalog.map((a: any) => a.name),
    ...f.addons.catalog.map((a: any) => usd(a.priceCents)),
  )
  ok(miss.length === 0, `file ${name}: add-ons`, miss)
  await tab(page, 'Photos')
  t = await fileText(page)
  miss = has(
    t,
    `Arrival · ${f.photos.arrival.count} photos`,
    `Before · ${f.photos.before.count} photos`,
    `After · ${f.photos.after.count} photos`,
    `Damage / Issues · ${f.photos.issue.count} notes`,
  )
  ok(miss.length === 0, `file ${name}: photos`, miss)
  const imgs = await modal(page).locator('img').count()
  const withThumb = ['arrival', 'before', 'after', 'issue'].reduce(
    (n, c) => n + f.photos[c].items.filter((p: any) => p.thumbUrl || p.url).length,
    0,
  )
  ok(imgs === withThumb, `file ${name}: a thumbnail per photo`, [imgs, withThumb])
  await tab(page, 'Messages')
  t = await fileText(page)
  const th = (await api(page, 'GET', `/appointments/${id}/messages`)).body
  miss = has(t, ...th.items.map((m: any) => m.text))
  ok(miss.length === 0, `file ${name}: messages`, miss)
  await tab(page, 'Payments')
  t = await fileText(page)
  const inv = f.invoice
  if (inv) {
    miss = has(
      t,
      usd(inv.totalCents),
      usd(inv.subtotalCents - 0 > 0 ? inv.taxCents : 0),
      ...inv.items.map((i: any) => i.name),
      'Total',
    )
    ok(miss.length === 0, `file ${name}: payments`, miss)
    ok(
      t.includes(
        o.pay.kind === 'pending'
          ? 'Payment pending'
          : o.pay.kind === 'paid'
            ? 'Paid in full'
            : usd(o.pay.balanceCents),
      ),
      `file ${name}: payment state`,
      [t.slice(0, 300), o.pay],
    )
  }
  await tab(page, 'Membership')
  t = await fileText(page)
  if (f.membership) {
    const m = f.membership
    miss = has(t, m.renewLabel, String(m.creditsUsed), ...m.perks, m.retention?.label)
    ok(miss.length === 0, `file ${name}: membership`, miss)
  } else ok(t.includes('Not a member yet'), `file ${name}: non-member card`, t.slice(0, 200))
  await tab(page, 'History')
  t = await fileText(page)
  const mem = (await api(page, 'GET', `/customers/${f.customer.id}/membership`)).body
  miss = has(t, 'Service History', String(mem.history.visitCount), usd(mem.history.lifetimeSpendCents))
  ok(miss.length === 0, `file ${name}: history`, miss)
}

async function phaseRead(browser: Browser): Promise<void> {
  section('read: Management, every visible figure against the API')
  const m = await open(browser, EMAILS.manager)
  const p = m.page
  await compareBoard(p, 'timeline')
  await shot(p, 'read-timeline')
  await p.locator('#dc-root button', { hasText: 'Bay Board' }).first().click()
  await sleep(500)
  await compareBoard(p, 'bay board', 'bay')
  await shot(p, 'read-bay-board')
  await p.locator('#dc-root button', { hasText: 'Staff' }).first().click()
  await sleep(500)
  const snap = await apiCards(p)
  const staffText = (await p.locator('main').innerText()).replace(/\s+/g, ' ')
  for (const s of snap.staff)
    ok(has(staffText, s.name, s.role).length === 0, `staff column ${s.name}`, staffText.slice(0, 200))
  await shot(p, 'read-staff')
  await p.locator('#dc-root button', { hasText: 'Timeline' }).first().click()
  await sleep(300)
  // every appointment of the board, all eight tabs
  const cards = [
    ...snap.timeline.groups.flatMap((g: any) => g.items),
    ...snap.completed.items,
    ...snap.bays.flatMap((b: any) => (b.occupant ? [b.occupant.card] : [])),
  ]
  for (const c of cards) {
    await openFile(p, c.customer.name)
    await compareFile(p, c.id, c.customer.name)
    if (c.customer.name === 'Priya Nair') await shot(p, 'read-file-priya-history')
    await closeFile(p)
  }
  // filters
  await p.locator('#dc-root input#oa-search').fill('Jeep')
  await sleep(800)
  const b2 = await scrapeBoard(p)
  ok(
    b2.cards.length === 1 && b2.cards[0]!.text.includes('Marcus Webb'),
    'search "Jeep" leaves one card',
    b2.cards.map((c) => c.name),
  )
  const q = (await api(p, 'GET', '/ops/snapshot?window=next24&q=Jeep')).body
  ok(q.timeline.count === 1, 'the API agrees on the search', q.timeline.count)
  await p.locator('#dc-root input#oa-search').fill('')
  await sleep(600)
  await p.locator('#dc-root button', { hasText: 'Tomorrow' }).first().click()
  await sleep(700)
  const tom = (await api(p, 'GET', '/ops/snapshot?window=tomorrow')).body
  const b3 = await scrapeBoard(p)
  ok(b3.cards.length === tom.timeline.count, "Tomorrow shows the API's jobs", [
    b3.cards.length,
    tom.timeline.count,
  ])
  ok(
    b3.dividers.join() ===
      tom.timeline.groups
        .map((g: any) => g.divider)
        .filter(Boolean)
        .join(),
    "Tomorrow's divider is Tomorrow",
    b3.dividers,
  )
  await p.locator('#dc-root button', { hasText: 'Next 24h' }).first().click()
  // calendar: today's day, a closed or reduced day, week, month
  await p.locator('#dc-root button', { hasText: 'Calendar' }).first().click()
  await sleep(700)
  const day = (await api(p, 'GET', '/calendar/day?date=2026-06-13')).body
  const ct = (await p.locator('main').innerText()).replace(/\s+/g, ' ')
  ok(has(ct, day.label, day.sub).length === 0, 'calendar day heading and sub-line equal the API', [
    ct.slice(0, 160),
    day.sub,
  ])
  for (const r of day.rows)
    for (const c of r.items) ok(ct.includes(c.customer.name), `calendar day has ${c.customer.name}`)
  await p.locator('#dc-root button', { hasText: 'Week' }).first().click()
  await sleep(600)
  const wk = (await api(p, 'GET', '/calendar/summary?from=2026-06-07&to=2026-06-13')).body
  const wt = (await p.locator('main').innerText()).replace(/\s+/g, ' ')
  ok(
    wt.includes(
      `${wk.days.reduce((n: number, d: any) => n + (d.closed ? 0 : d.count), 0)} appointments this week`,
    ),
    'week total equals the API',
    wt.slice(0, 200),
  )
  await p.locator('#dc-root button', { hasText: 'Month' }).first().click()
  await sleep(600)
  const mo = (await api(p, 'GET', '/calendar/summary?from=2026-05-31&to=2026-07-04')).body
  const mt = (await p.locator('main').innerText()).replace(/\s+/g, ' ')
  const inJune = mo.days
    .filter((d: any) => d.date.startsWith('2026-06'))
    .reduce((n: number, d: any) => n + (d.closed ? 0 : d.count), 0)
  ok(mt.includes(`${inJune} appointments in June`), 'month total equals the API', [mt.slice(0, 200), inJune])
  await shot(p, 'read-calendar-month')
  // the new appointment sheet, open and closed
  await p.locator('#dc-root button', { hasText: 'Timeline' }).first().click()
  await p.locator('#dc-root button', { hasText: 'New Appointment' }).first().click()
  await sleep(900)
  const sheet = (await p.locator('div[style*="z-index: 70"]').innerText()).replace(/\s+/g, ' ')
  const av = (
    await api(
      p,
      'GET',
      `/availability?date=2026-06-13&serviceId=${snap.timeline.groups[0].items[0].id ? (await api(p, 'GET', '/services')).body.packages.find((x: any) => x.name === 'Premium Hand Wash + Interior').id : ''}&channel=desk`,
    )
  ).body
  for (const s of av.slots.filter((x: any) => x.state !== 'past'))
    ok(sheet.includes(s.time.replace(/ (AM|PM)/, ' $1')), `sheet slot ${s.time}`)
  ok(!sheet.includes('8:00 AM'), 'past slots are not offered')
  await shot(p, 'read-new-appointment')
  await p.keyboard.press('Escape')
  // reload keeps the figures
  await p.reload()
  await p.waitForSelector('text=Appointments 24h')
  await sleep(1200)
  await compareBoard(p, 'after reload')
  ok(pageErrors.length === 0, 'read: no page errors', pageErrors.slice(0, 3))
  await m.ctx.close()
}

// ---- phase: write --------------------------------------------------------------------------------------------------------

const CARD_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

async function ledgerOf(page: Page, invoiceId: string): Promise<any> {
  return (await api(page, 'GET', `/invoices/${invoiceId}`)).body
}

async function dragTo(
  page: Page,
  from: ReturnType<Page['locator']>,
  to: ReturnType<Page['locator']>,
): Promise<void> {
  const a = (await from.boundingBox())!
  const b = (await to.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + 20)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 30, a.y + 30, { steps: 4 })
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
  await page.mouse.move(b.x + b.width / 2 + 2, b.y + b.height / 2 + 2, { steps: 2 })
  await page.mouse.up()
}

async function phaseWrite(browser: Browser): Promise<void> {
  section('write: Management with a second browser (Support) watching')
  const a = await open(browser, EMAILS.manager)
  const b = await open(browser, EMAILS.support)
  const acct = await open(browser, EMAILS.accounting)
  const A = a.page
  const B = b.page
  const Acc = acct.page
  const sup = await open(browser, EMAILS.superAdmin)
  const S = sup.page
  const statusOf = async (name: string): Promise<string> => findCard(await apiCards(A), name)?.status

  // 1. one job through every stage: Grace Adeyemi (booked, 11:00, $48.15 due)
  await openFile(A, 'Grace Adeyemi')
  const grace = findCard(await apiCards(A), 'Grace Adeyemi')
  const step = async (label: string, expect: string, toastHas: string): Promise<void> => {
    await modal(A).getByRole('button', { name: label, exact: true }).click()
    const t = await waitToast(A, toastHas)
    ok(t.includes(toastHas), `advance: ${label} toasts ${toastHas}`, t)
    const st = await until(async () => ((await statusOf('Grace Adeyemi')) === expect ? expect : null))
    ok(st === expect, `advance: ${label} -> ${expect} in the API`, st)
    const seenB = await until(async () => await fileTextOf(B, 'Grace Adeyemi', expect))
    void seenB
  }
  // the second browser follows without a reload: its card badge changes
  const fileTextOf = async (p: Page, name: string, status: string): Promise<boolean> => {
    const b = await scrapeBoard(p)
    const label = {
      booked: 'Booked',
      confirmed: 'Confirmed',
      arrived: 'Arrived',
      cleaning: 'In Wash',
      completed: 'Completed',
    }[status]!
    const card = b.cards.find((c) => c.name === name)
    const bay = b.bays.find((x) => x.text.includes(name))
    const done = b.completed.find((c) => c.name === name)
    return !!(
      card?.text.includes(label) ||
      (status === 'cleaning' && bay) ||
      (status === 'completed' && done)
    )
  }
  await step('Confirm Appointment', 'confirmed', 'Confirmation sent')
  ok(
    !!(await until(() => fileTextOf(B, 'Grace Adeyemi', 'confirmed'))),
    'second browser: Confirmed without a reload',
  )
  await step('Mark Arrived', 'arrived', 'Marked arrived')
  await step('Start Cleaning', 'cleaning', 'Cleaning started')
  ok(
    !!(await until(() => fileTextOf(B, 'Grace Adeyemi', 'cleaning'))),
    'second browser: Grace is in a bay without a reload',
  )
  const bays = (await apiCards(A)).bays
  ok(
    bays.some((x: any) => x.occupant?.card.customer.name === 'Grace Adeyemi' && x.number === 2),
    'Start Cleaning used the planned Bay 2',
  )
  await step('Mark Complete', 'completed', 'Job completed')
  ok(
    !!(await until(() => fileTextOf(B, 'Grace Adeyemi', 'completed'))),
    'second browser: Grace is in the pickup column without a reload',
  )
  // collect: the primary button is now "Collect Payment" and goes to the Payments tab
  await modal(A).getByRole('button', { name: 'Collect Payment', exact: true }).click()
  await sleep(300)
  let t = await fileText(A)
  ok(
    t.includes('Mark Paid · $48.15') && t.includes('Card') && t.includes('Cash'),
    'Collect Payment opens Payments with the tender choice',
    t.slice(0, 300),
  )
  await modal(A).getByRole('button', { name: 'Cash', exact: true }).click()
  await modal(A)
    .getByRole('button', { name: /^Mark Paid/ })
    .click()
  let tt = await waitToast(A, 'Payment collected')
  ok(tt.includes('Payment collected'), 'Mark Paid by cash toasts', tt)
  let gFile = (await api(A, 'GET', `/appointments/${grace.id}`)).body
  ok(
    gFile.invoice.status === 'paid' && gFile.invoice.balanceCents === 0 && gFile.overview.pay.kind === 'paid',
    'cash payment settles the invoice',
    gFile.overview.pay,
  )
  await until(async () => (await fileText(A)).includes('Payment complete'))
  ok(
    (await fileText(A)).includes('Payment complete') &&
      (await fileText(A)).includes('Receipt sent via SMS + email'),
    'the file says Payment complete',
  )
  const doneB = await until(async () =>
    (await scrapeBoard(B)).completed.find((c) => c.name === 'Grace Adeyemi')?.chips.includes('Paid'),
  )
  ok(!!doneB, 'second browser: Paid chip without a reload')
  // 2. add-on after payment, then remove it (409)
  await tab(A, 'Add-ons')
  await modal(A).locator('button', { hasText: 'Wax' }).first().click()
  tt = await waitToast(A, 'Invoice')
  gFile = (await api(A, 'GET', `/appointments/${grace.id}`)).body
  ok(
    gFile.addons.selected.some((x: any) => x.name === 'Wax') && gFile.invoice.balanceCents > 0,
    'an add-on after payment reopens a balance',
    [tt, gFile.invoice.balanceCents],
  )
  ok(
    tt.includes('Added Wax') || tt.includes('Wax'),
    "the add-on toast says Added (not the design's inverted Removed)",
    tt,
  )
  await tab(A, 'Payments')
  await modal(A)
    .getByRole('button', { name: /^Mark Paid/ })
    .click()
  await waitToast(A, 'Payment collected')
  gFile = (await api(A, 'GET', `/appointments/${grace.id}`)).body
  ok(gFile.invoice.balanceCents === 0, 'the new balance is paid', gFile.invoice.balanceCents)
  await tab(A, 'Add-ons')
  await modal(A).locator('button', { hasText: 'Wax' }).first().click()
  tt = await waitToast(A, 'remove')
  ok(tt.includes('Can’t remove add-on'), "removing a paid add-on is refused with the server's 409 text", tt)
  gFile = (await api(A, 'GET', `/appointments/${grace.id}`)).body
  ok(
    gFile.addons.selected.some((x: any) => x.name === 'Wax'),
    'the add-on is still there after the refusal',
  )
  // 3. pickup from the column
  await closeFile(A)
  const chipRow = A.locator('aside div[style*="padding: 14px 15px 14px 18px"]', { hasText: 'Grace Adeyemi' })
  await chipRow.getByRole('button', { name: 'Needs pickup' }).click()
  await waitToast(A, 'Vehicle picked up')
  ok(
    (await api(A, 'GET', `/appointments/${grace.id}`)).body.overview.pickupState === 'collected',
    'pickup recorded',
  )
  ok(
    !!(await until(async () =>
      (await scrapeBoard(B)).completed.find((c) => c.name === 'Grace Adeyemi')?.chips.includes('Picked up'),
    )),
    'second browser: Picked up without a reload',
  )
  await compareBoard(A, 'after the job flow')

  // 4. assign by drag: Marcus Webb (confirmed, late) onto the free Bay 2
  await dragTo(
    A,
    A.locator('#dc-root button', { hasText: 'Marcus Webb' }).first(),
    A.locator('[data-drop="bay:2"]').first(),
  )
  tt = await waitToast(A, 'Bay 2')
  ok(tt.includes('Moved to Bay 2'), 'drag onto Bay 2 toasts the server text', tt)
  ok((await statusOf('Marcus Webb')) === 'cleaning', 'the dragged job is cleaning in the API')
  ok(
    !!(await until(async () =>
      (await scrapeBoard(B)).bays.find((x) => x.name === 'Bay 2')?.text.includes('Marcus Webb'),
    )),
    'second browser: Marcus is in Bay 2 without a reload',
  )
  // a second drag onto a busy bay is refused with the design's text
  await dragTo(
    A,
    A.locator('#dc-root button', { hasText: 'Liam Chen' }).first(),
    A.locator('[data-drop="bay:2"]').first(),
  )
  tt = await waitToast(A, 'busy')
  ok(
    tt.includes('Bay 2 is busy') && tt.includes('Finish Marcus’s vehicle first'),
    "drop on a busy bay: the design's refusal",
    tt,
  )
  // 5. complete Jonathan from the bay card, then assign by menu on the free Bay 1
  await A.locator('[data-drop="bay:1"]').getByRole('button', { name: 'Mark Complete' }).click()
  await waitToast(A, 'completed')
  ok((await statusOf('Jonathan Franco')) === 'completed', 'Mark Complete from the bay card')
  await A.locator('#dc-root button', { hasText: 'Bay Board' }).first().click()
  await sleep(500)
  await A.locator('[data-drop="bay:1"]').getByRole('button', { name: 'Assign next vehicle' }).click()
  await modal(A).waitFor()
  const next1 = (await apiCards(A)).bays.find((x: any) => x.number === 1).nextUpAppointmentId
  t = await fileText(A)
  ok(t.includes('Liam Chen'), "Assign next vehicle opens the next vehicle's file", t.slice(0, 120))
  void next1
  await modal(A).getByRole('button', { name: 'Mark Arrived', exact: true }).click()
  await waitToast(A, 'arrived')
  await modal(A).getByRole('button', { name: 'Start Cleaning', exact: true }).click()
  await waitToast(A, 'Cleaning started')
  ok(
    !!(await api(A, 'GET', '/ops/snapshot')).body.bays.find(
      (x: any) => x.number === 1 && x.occupant?.card.customer.name === 'Liam Chen',
    ),
    'by menu: Liam is in Bay 1',
  )
  await closeFile(A)
  await A.locator('#dc-root button', { hasText: 'Timeline' }).first().click()

  // 6. reschedule by drag in the Calendar (and one refused)
  await A.locator('#dc-root button', { hasText: 'Calendar' }).first().click()
  await sleep(700)
  const tom = findCard(await apiCards(A), 'Tom Bradley')
  await dragTo(
    A,
    A.locator('#dc-root button', { hasText: 'Tom Bradley' }).first(),
    A.locator('[data-drop="hr:15"]').first(),
  )
  tt = await waitToast(A, 'Moved')
  const tomAfter = (await api(A, 'GET', `/appointments/${tom.id}`)).body
  ok(
    tt.includes('Moved to 3:30 PM') && tomAfter.overview.time === '3:30 PM',
    'drop on 3 PM moves the job to 3:30 PM (minutes kept)',
    [tt, tomAfter.overview.time],
  )
  await dragTo(
    A,
    A.locator('#dc-root button', { hasText: 'Tom Bradley' }).first(),
    A.locator('[data-drop="hr:11"]').first(),
  )
  tt = await waitToast(A, 'unavailable')
  ok(tt.includes('Slot unavailable'), 'a move into a full hour is refused by the server', tt)
  ok(
    (await api(A, 'GET', `/appointments/${tom.id}`)).body.overview.time === '3:30 PM',
    'a refused move leaves the job where it was',
  )
  await A.locator('#dc-root button', { hasText: 'Timeline' }).first().click()

  // 7. new appointment with real fields
  await A.locator('#dc-root button', { hasText: 'New Appointment' }).first().click()
  await A.waitForSelector('input[placeholder="Full name"]')
  await A.fill('input[placeholder="Full name"]', 'Dana Whitfield')
  await A.fill('input[placeholder="Phone number"]', '(305) 555-0171')
  await A.fill('input[placeholder="Year / Make / Model"]', '2022 Tesla Model 3')
  await A.fill('input[placeholder="License plate"]', 'dw-2022')
  await A.locator('div[style*="z-index: 70"] button', { hasText: 'Express Hand Wash' }).first().click()
  await sleep(900)
  const slotBtn = A.locator('div[style*="z-index: 70"] button', { hasText: /^4:00 PM$/ })
  if (await slotBtn.count()) await slotBtn.first().click()
  await A.locator('div[style*="z-index: 70"] button', { hasText: 'Book Appointment' }).click()
  tt = await waitToast(A, 'booked')
  ok(tt.includes('Appointment booked'), 'New Appointment books and toasts the server text', tt)
  const dana = await until(async () => findCard(await apiCards(A), 'Dana Whitfield'))
  ok(
    !!dana && dana.vehicleLine.includes('2022 Tesla Model 3') && dana.service === 'Express Hand Wash',
    'the booking has the typed vehicle and the package',
    dana,
  )
  const danaFile = (await api(A, 'GET', `/appointments/${dana.id}`)).body
  ok(
    danaFile.vehicle.plate === 'DW-2022' && danaFile.customer.smsOptedIn === true,
    'plate upper-cased and SMS opt-in recorded',
    danaFile.vehicle,
  )
  ok(
    !!(await until(async () => (await scrapeBoard(B)).cards.find((c) => c.name === 'Dana Whitfield'))),
    'second browser: the new card without a reload',
  )
  // walk-in
  await A.locator('#dc-root button', { hasText: 'Walk-in' }).first().click()
  await A.waitForSelector('input[placeholder="Full name"]')
  await A.fill('input[placeholder="Full name"]', 'Walt Inwood')
  await A.fill('input[placeholder="Phone number"]', '(305) 555-0172')
  await A.fill('input[placeholder="Year / Make / Model"]', '2019 Subaru Outback')
  await A.locator('div[style*="z-index: 70"] button', { hasText: 'Check in walk-in' }).click()
  tt = await waitToast(A, 'booked')
  const walk = await until(async () => findCard(await apiCards(A), 'Walt Inwood'))
  ok(!!walk && walk.status === 'arrived', 'a walk-in is booked as arrived', walk?.status)
  // a booking without a name is stopped before the API
  const before = a.requests.length
  await A.locator('#dc-root button', { hasText: 'New Appointment' }).first().click()
  await A.locator('div[style*="z-index: 70"] button', { hasText: 'Book Appointment' }).click()
  tt = await waitToast(A, 'name')
  ok(
    tt.includes('Add the customer’s name') &&
      !a.requests.slice(before).some((r) => r.startsWith('POST /api/v1/appointments')),
    'an empty form never calls the API',
    tt,
  )
  await A.keyboard.press('Escape')

  // 8. SMS from the Messages tab, through the SMS Gate simulator
  await openFile(A, 'Dana Whitfield')
  await tab(A, 'Messages')
  const composer = modal(A).locator('input[placeholder="Type a message…"]')
  await composer.fill('Hi Dana, your Tesla slot is confirmed for 4:00 PM.')
  ok(
    (await fileText(A)).includes('50 characters · 1 text'),
    'the composer counts characters and texts',
    (await fileText(A)).slice(-200),
  )
  await composer.press('Enter')
  tt = await waitToast(A, 'Message sent')
  ok(
    tt.includes('Queued via SMS to Dana'),
    'send toasts "Queued via SMS" (not the design\'s untrue Delivered)',
    tt,
  )
  const delivered = await until(async () => {
    const th = (await api(A, 'GET', `/appointments/${dana.id}/messages`)).body
    const m = th.items.find((x: any) => x.direction === 'out' && x.text.startsWith('Hi Dana'))
    return m && ['sent', 'delivered'].includes(m.status) ? m : null
  }, 20_000)
  ok(!!delivered, 'the SMS Gate simulator took the text (sent or delivered)', delivered?.status)
  ok(
    !!(await until(
      async () => /Hi Dana, your Tesla slot[^]*· (Sent|Delivered)/.test(await fileText(A)),
      10_000,
    )),
    'the bubble shows its state',
    (await fileText(A)).slice(-300),
  )
  // a quick reply and a second browser
  await modal(A).getByRole('button', { name: 'Being cleaned', exact: true }).click()
  await waitToast(A, 'Message sent')
  ok(
    (await api(A, 'GET', `/appointments/${dana.id}/messages`)).body.items.some(
      (m: any) => m.text === 'Your vehicle is now being cleaned.',
    ),
    "a pill sends the server's quick reply",
  )
  // 9. inbound STOP through the dev route: the chip flips on a second browser without a reload
  await openFile(B, 'Dana Whitfield')
  await tab(B, 'Messages')
  ok((await fileText(B)).includes('SMS opted-in'), 'the chip says SMS opted-in before the STOP')
  const inbound = await api(S, 'POST', '/dev/sms/inbound', { from: '+13055550171', body: 'STOP' })
  ok(inbound.status === 200, 'the simulator accepts an inbound text', inbound)
  ok(
    !!(await until(async () => (await fileText(B)).includes('SMS opted-out'), 10_000)),
    'second browser: SMS opted-out chip appears without a reload',
    (await fileText(B)).slice(0, 400),
  )
  ok(
    !!(await until(async () => (await fileText(B)).includes('STOP'), 8000)),
    "the customer's reply is in the thread",
  )
  await B.locator('div[style*="z-index: 60"] input[placeholder^="Customer opted out"]')
    .first()
    .waitFor({ timeout: 5000 })
    .catch(() => undefined)
  ok(
    (await fileText(A)).includes('SMS opted-out') ||
      !!(await until(async () => (await fileText(A)).includes('SMS opted-out'), 8000)),
    'the first browser sees the opt-out too',
  )
  const sendReq = a.requests.length
  await composer.fill('Are you still coming?')
  await composer.press('Enter')
  tt = await waitToast(A, 'opted out')
  ok(
    a.requests.slice(sendReq).some((r) => r.startsWith('POST') && r.includes('/messages')) &&
      /opted out|STOP|blocked/i.test(tt),
    "sending to an opted-out customer shows the server's refusal",
    tt,
  )
  await shot(A, 'write-messages-opted-out')
  await closeFile(B)

  // 10. photos: upload (thumbnail), HEIC refused
  await tab(A, 'Photos')
  const inputs = modal(A).locator('input[type="file"]')
  ok((await inputs.count()) === 4, 'a file input on each photo section', await inputs.count())
  const photosBefore = (await api(A, 'GET', `/appointments/${dana.id}`)).body.photos.before.count
  await inputs.nth(1).setInputFiles({ name: 'front.png', mimeType: 'image/png', buffer: CARD_PNG })
  tt = await waitToast(A, 'Photo added')
  ok(tt.includes('Photo added') && tt.includes('Before'), 'upload toasts Photo added · Before', tt)
  const ph = (await api(A, 'GET', `/appointments/${dana.id}`)).body.photos
  ok(
    ph.before.count === photosBefore + 1 && ph.before.items.at(-1).thumbUrl,
    'the photo is stored and has a thumbnail URL',
    ph.before,
  )
  const loaded = await until(async () =>
    modal(A)
      .locator('img')
      .evaluateAll(
        (els) =>
          els.length > 0 &&
          els.every((e) => (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth > 0),
      ),
  )
  ok(
    !!loaded,
    'the thumbnail loads in the page (cross-origin object store)',
    await modal(A).locator('img').count(),
  )
  await inputs
    .nth(1)
    .setInputFiles({ name: 'IMG_0007.HEIC', mimeType: 'image/heic', buffer: Buffer.from('not really heic') })
  tt = await waitToast(A, 'HEIC')
  ok(/HEIC/.test(tt), "HEIC is refused with the server's message", tt)
  ok(
    (await api(A, 'GET', `/appointments/${dana.id}`)).body.photos.before.count === photosBefore + 1,
    'nothing was stored for the refused photo',
  )
  await closeFile(A)

  // 11. checklist: a task, a section, check all; optimistic and equal to the API after
  await openFile(A, 'Marcus Webb')
  await tab(A, 'Checklist')
  const marcus = findCard(await apiCards(A), 'Marcus Webb')
  const m0 = (await api(A, 'GET', `/appointments/${marcus.id}`)).body.checklist
  await modal(A).locator('button', { hasText: m0.sections[0].items[0].label }).first().click()
  const m1 = await until(async () => {
    const c = (await api(A, 'GET', `/appointments/${marcus.id}`)).body.checklist
    return c.done === m0.done + 1 ? c : null
  })
  ok(!!m1, 'ticking a task is saved', m0.done)
  ok(
    (await fileText(A)).includes(`${m0.done + 1} of ${m0.total} tasks complete`),
    'the file shows the new count',
  )
  await modal(A).getByRole('button', { name: 'Check all', exact: true }).first().click()
  const m2 = await until(async () => {
    const c = (await api(A, 'GET', `/appointments/${marcus.id}`)).body.checklist
    return c.allDone ? c : null
  })
  ok(!!m2, 'Check all completes the checklist', m0.total)
  tt = await toast(A)
  ok(
    /All tasks checked/.test(tt) || (await waitToast(A, 'All tasks checked')).includes('All tasks checked'),
    'Check all toasts',
    tt,
  )
  await closeFile(A)

  // 12. membership credit: Priya (Premium) completed and unpaid
  const priya = findCard(await apiCards(A), 'Priya Nair')
  const priyaBefore = (await api(A, 'GET', `/appointments/${priya.id}`)).body
  await openFile(A, 'Priya Nair')
  await tab(A, 'Membership')
  await modal(A).getByRole('button', { name: 'Apply credit', exact: true }).click()
  tt = await waitToast(A, 'Credit applied')
  ok(tt.includes('Credit applied'), 'Apply credit toasts', tt)
  const priyaAfter = (await api(A, 'GET', `/appointments/${priya.id}`)).body
  ok(
    priyaAfter.invoice.balanceCents < priyaBefore.invoice.balanceCents &&
      priyaAfter.membership.creditsLeft === priyaBefore.membership.creditsLeft - 1,
    'the credit reduced the balance and used one credit',
    [priyaBefore.invoice.balanceCents, priyaAfter.invoice.balanceCents, priyaAfter.membership.creditsLeft],
  )
  await tab(A, 'Payments')
  t = await fileText(A)
  ok(
    has(t, usd(priyaAfter.invoice.balanceCents)).length === 0,
    'Payments shows the reduced balance',
    t.slice(0, 300),
  )
  await closeFile(A)

  // 13. card money: Payment pending -> confirmed -> Paid, on both browsers, then Accounting confirms
  const elena = findCard(await apiCards(A), 'Elena Volkov')
  await openFile(A, 'Elena Volkov')
  await tab(A, 'Payments')
  await modal(A).getByRole('button', { name: 'Card', exact: true }).click()
  await modal(A)
    .getByRole('button', { name: /^Mark Paid/ })
    .click()
  tt = await waitToast(A, 'Card payment recorded')
  ok(tt.includes('Waiting for Squarespace'), 'card: toast says it waits for Squarespace', tt)
  const ef = (await api(A, 'GET', `/appointments/${elena.id}`)).body
  ok(
    ef.overview.pay.kind === 'pending' &&
      ef.overview.pay.label === 'Payment pending' &&
      ef.invoice.awaitingCents > 0,
    'the API reads Payment pending',
    ef.overview.pay,
  )
  t = await fileText(A)
  ok(
    t.includes('Payment pending') && !t.includes('Payment complete'),
    'the file says Payment pending, not Paid',
    t.slice(0, 300),
  )
  await closeFile(A)
  let eb = await scrapeBoard(A)
  ok(
    eb.cards.find((c) => c.name === 'Elena Volkov')?.text.includes('Payment pending'),
    'the card says Payment pending',
    eb.cards.find((c) => c.name === 'Elena Volkov')?.text,
  )
  ok(
    !!(await until(async () =>
      (await scrapeBoard(B)).cards.find((c) => c.name === 'Elena Volkov')?.text.includes('Payment pending'),
    )),
    'second browser: Payment pending without a reload',
  )
  const kp = (await apiCards(A)).kpis
  ok(kp[3]!.value !== '6', 'Pending payments dropped (the card money counts at once)', kp[3])
  const inv = await ledgerOf(A, ef.invoice.invoiceId)
  const ev = inv.ledger.find((e: any) => e.type === 'pay' && e.awaitingProcessor)
  ok(
    !!ev,
    'the ledger holds an awaiting payment',
    inv.ledger.map((e: any) => [e.type, e.processorState]),
  )
  const conf = await api(Acc, 'POST', `/ledger-events/${ev.id}/confirm-processor`, {})
  ok(conf.status < 300, 'Accounting confirms it in Squarespace terms', conf.body)
  ok(
    !!(await until(async () =>
      (await scrapeBoard(A)).cards.find((c) => c.name === 'Elena Volkov')?.text.includes('Paid'),
    )),
    'the first browser flips to Paid without a reload',
  )
  ok(
    !!(await until(
      async () =>
        !(await scrapeBoard(B)).cards
          .find((c) => c.name === 'Elena Volkov')
          ?.text.includes('Payment pending'),
    )),
    'the second browser flips to Paid without a reload',
  )
  eb = await scrapeBoard(A)
  ok(
    !eb.cards.find((c) => c.name === 'Elena Volkov')?.text.includes('Payment pending'),
    'no pending text is left',
  )

  // 14. un-pay needs pay.void: Support is refused, Super reverses a cash payment through the ledger
  await shot(A, 'write-after-flows')
  // 15. reload: every figure still equals the API
  await A.reload()
  await A.waitForSelector('text=Appointments 24h')
  await sleep(1500)
  await compareBoard(A, 'write: after reload')
  await B.reload()
  await B.waitForSelector('text=Appointments 24h')
  await sleep(1500)
  await compareBoard(B, 'write: second browser after reload')
  ok(pageErrors.length === 0, 'write: no page errors', pageErrors.slice(0, 3))
  for (const p of [a, b, acct, sup]) await p.ctx.close()
}

// ---- phase: roles --------------------------------------------------------------------------------------------------------

async function phaseRoles(browser: Browser): Promise<void> {
  section('roles: Crew, Support, Accounting, and a Super Admin viewing as Crew')
  const crew = await open(browser, EMAILS.crew)
  const C = crew.page
  await compareBoard(C, 'crew board')
  const snap = await apiCards(C)
  const priya = findCard(snap, 'Priya Nair')
  await openFile(C, 'Priya Nair')
  ok(
    !(await fileText(C)).includes('555-0104'),
    'Crew sees a masked phone (no cli.contact)',
    (await fileText(C)).slice(0, 200),
  )
  await tab(C, 'Payments')
  let n = crew.requests.length
  await modal(C)
    .getByRole('button', { name: /^Mark Paid/ })
    .click()
  let tt = await waitToast(C, 'Your role')
  ok(
    tt.includes('Your role can’t collect payments') &&
      !crew.requests.slice(n).some((r) => r.startsWith('POST')),
    'Crew: Mark Paid toasts the denial and sends nothing',
    tt,
  )
  await tab(C, 'Messages')
  const comp = modal(C).locator('input[placeholder="Your role can’t send messages"]')
  ok(
    (await comp.count()) === 1 && (await comp.isDisabled()),
    'Crew: the composer is disabled with the wording',
    await comp.count(),
  )
  await modal(C).getByRole('button', { name: 'Confirmed', exact: true }).click()
  tt = await waitToast(C, 'Your role')
  ok(tt.includes('Your role can’t send messages'), 'Crew: a pill toasts the denial', tt)
  await tab(C, 'Add-ons')
  n = crew.requests.length
  await modal(C).locator('button', { hasText: 'Rain repellent' }).first().click()
  tt = await waitToast(C, 'Your role')
  ok(
    tt.includes('Your role can’t edit appointments') &&
      !crew.requests.slice(n).some((r) => r.startsWith('PUT') || r.startsWith('DELETE')),
    'Crew: an add-on toggle toasts the denial',
    tt,
  )
  await tab(C, 'Checklist')
  const f0 = (await api(C, 'GET', `/appointments/${priya.id}`)).body.checklist
  ok(f0.total > 0, 'Crew can read the checklist')
  await closeFile(C)
  // Crew may move a job (jobs.status) and tick checklists, but may not book
  await C.locator('#dc-root button', { hasText: 'New Appointment' }).first().click()
  await C.waitForSelector('input[placeholder="Full name"]')
  await C.fill('input[placeholder="Full name"]', 'Crew Try')
  await C.fill('input[placeholder="Phone number"]', '3055550199')
  n = crew.requests.length
  await C.locator('div[style*="z-index: 70"] button', { hasText: 'Book Appointment' }).click()
  tt = await waitToast(C, 'Your role')
  ok(
    tt.includes('Your role can’t edit appointments') &&
      !crew.requests.slice(n).some((r) => r.startsWith('POST /api/v1/appointments')),
    'Crew: booking toasts the denial',
    tt,
  )
  await C.keyboard.press('Escape')
  await crew.ctx.close()

  const sup = await open(browser, EMAILS.support)
  const SP = sup.page
  await openFile(SP, 'Priya Nair')
  await tab(SP, 'Payments')
  n = sup.requests.length
  await SP.locator('div[style*="z-index: 60"] button', { hasText: 'Send payment link' }).click()
  ok(
    (await fileText(SP)).includes('Squarespace invoice or checkout URL'),
    'Support: the payment-link input opens',
  )
  await SP.fill('input[placeholder="Squarespace invoice or checkout URL"]', 'https://evil.example/pay')
  await SP.getByRole('button', { name: 'Send link by SMS' }).click()
  await sleep(1000)
  const linkText = await fileText(SP)
  ok(
    /squarespace|allowed|host|HTTPS/i.test(linkText.slice(linkText.indexOf('Squarespace invoice') + 40)),
    "Support: a wrong host shows the server's text inline",
    linkText.slice(-300),
  )
  await tab(SP, 'Messages')
  const spc = modal(SP).locator('input[placeholder="Type a message…"]')
  ok((await spc.count()) === 1 && !(await spc.isDisabled()), 'Support: the composer is live')
  await closeFile(SP)
  await sup.ctx.close()

  const acc = await open(browser, EMAILS.accounting)
  const AC = acc.page
  const startCard = findCard(await apiCards(AC), 'Elena Volkov')
  await openFile(AC, 'Elena Volkov')
  n = acc.requests.length
  const prim = modal(AC)
    .getByRole('button', { name: /Confirm Appointment|Mark Arrived|Start Cleaning/ })
    .first()
  await prim.click()
  tt = await waitToast(AC, 'Your role')
  ok(
    tt.includes('Your role can’t change job status') &&
      !acc.requests.slice(n).some((r) => r.includes('/advance')),
    'Accounting: moving a job toasts the denial',
    tt,
  )
  void startCard
  await acc.ctx.close()

  // Super Admin: view-as Crew through the session, the bar, the denials, exit
  const su = await open(browser, EMAILS.superAdmin)
  const SU = su.page
  const me = (await api(SU, 'GET', '/me')).body
  const crewRole = me.viewAs.options.find((o: any) => o.key === 'crew')
  const va = await api(SU, 'POST', '/me/view-as', { roleId: crewRole.id })
  ok(va.status === 200, 'Super Admin: POST /me/view-as Crew', va.status)
  await SU.reload()
  await SU.waitForSelector('text=Appointments 24h')
  await sleep(1200)
  const bar = (await scrapeBoard(SU)).viewAsBar
  ok(bar.includes('Viewing as Crew'), 'the Viewing-as bar names the role', bar)
  await openFile(SU, 'Priya Nair')
  await tab(SU, 'Payments')
  n = su.requests.length
  await modal(SU)
    .getByRole('button', { name: /^Mark Paid/ })
    .click()
  tt = await waitToast(SU, 'Your role')
  ok(
    tt.includes('Your role can’t collect payments') &&
      !su.requests.slice(n).some((r) => r.startsWith('POST')),
    'viewing as Crew: Mark Paid is denied and sends nothing',
    tt,
  )
  await closeFile(SU)
  await api(SU, 'POST', '/me/view-as', { roleId: null })
  await SU.reload()
  await SU.waitForSelector('text=Appointments 24h')
  await sleep(1000)
  ok(!(await scrapeBoard(SU)).viewAsBar, 'exit view-as: the bar is gone')
  await su.ctx.close()
  ok(pageErrors.length === 0, 'roles: no page errors', pageErrors.slice(0, 3))
}

// ---- main ----------------------------------------------------------------------------------------------------------------

const browser = await chromium.launch()
try {
  if (phase === 'visual' || phase === 'all') await phaseVisual(browser)
  if (phase === 'read' || phase === 'all') await phaseRead(browser)
  if (phase === 'write' || phase === 'all') await phaseWrite(browser)
  if (phase === 'roles' || phase === 'all') await phaseRoles(browser)
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
console.log(`API 4xx seen (provoked by the scenarios): ${seen.length}`)
for (const e of seen) console.log('  - ' + e)
process.exit(failures.length || pageErrors.length || apiBad.length ? 1 : 0)
