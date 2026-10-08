/* eslint-disable @typescript-eslint/no-explicit-any */
// e2e-payments — the live Payments screen against the real ledger API on a stack started by scripts/live-stack.ts.
//
//   pnpm live:up --name payments --api-port 4022 --web-port 3222 --profile design,parity-pay
//   pnpm e2e:payments --name payments [--phase read|write|roles|all] [--keep-going]
//
// Phases (the stack must be freshly seeded; `write` changes data, `read` and `roles` are repeatable until `write` ran):
//   read   Management: ranges, filters, search, one invoice of every status, the banner's Review, reload, every visible
//          figure against the API response (independent formatters), the golden values of the original bundle
//          (backend test/golden/pay) for today/7d/30d, and the cents twin against the server's calc on every invoice.
//   write  Management, Accounting (limit lowered to $50 through the real roles API) and a second browser: collect cash,
//          card (awaiting Squarespace, then confirmed), payment link (host error inline), apply credit, refund full /
//          by item / custom to card, credit and cash, an over-limit refund -> pending -> approved by another person and
//          denied by another, self-approval blocked without a request, adjust $ and % with settlement, issue credit,
//          send receipt, CSV download, live update in a second browser through SSE, a reload after each, no 5xx.
//   roles  Support (locked card, no payments request), Accounting limits in the sheets, a non-Super without "Preview as",
//          Super Admin view-as Crew / Management with the "Viewing as" bar.
// Screenshots go to parity-reports/e2e-payments/ (not committed). Exit code 1 when any check fails or a page errors.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from '@playwright/test'
import type { Browser, BrowserContext, Download, Page } from '@playwright/test'
import { calcCents } from '../src/lib/payments/cents'
import { EMAILS, loadStack, login } from './live-e2e'
import type { LiveStack } from './live-e2e'

process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE ??= 'ubuntu24.04-arm64'

const args = process.argv.slice(2)
const flag = (n: string, d: string): string => (args.includes(n) ? args[args.indexOf(n) + 1]! : d)
const stack: LiveStack = loadStack(flag('--name', 'payments'))
const phase = flag('--phase', 'all')
const keepGoing = args.includes('--keep-going')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const shots = path.join(root, 'parity-reports', 'e2e-payments')
fs.mkdirSync(shots, { recursive: true })
const GOLDEN = path.join(os.homedir(), 'oasis', 'backend', 'test', 'golden', 'pay')

// ---- tiny assertion framework --------------------------------------------------------------------------------------

let passed = 0
const failures: string[] = []
const pageErrors: string[] = []
const apiBad: string[] = []
/** API 4xx answers seen by any page; the run lists them and expects only the ones it provokes. */
const client4xx: string[] = []

function ok(cond: unknown, name: string, detail?: unknown): void {
  if (cond) {
    passed++
    return
  }
  const d =
    detail === undefined ? '' : ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))
  failures.push(name + d)
  console.log('  FAIL ' + name + d.slice(0, 600))
  if (!keepGoing && failures.length > 25) throw new Error('too many failures')
}
const canon = (x: unknown): string =>
  JSON.stringify(x, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  )
function firstDiff(a: unknown, b: unknown, at = '$'): string | null {
  if (canon(a) === canon(b)) return null
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${at}.length ${a.length} != ${b.length}`
    for (let i = 0; i < a.length; i++) {
      const d = firstDiff(a[i], b[i], `${at}[${i}]`)
      if (d) return d
    }
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDiff((a as any)[k], (b as any)[k], `${at}.${k}`)
      if (d) return d
    }
  }
  return `${at}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`
}
function eq<T>(actual: T, expected: T, name: string): void {
  const d = firstDiff(actual, expected)
  ok(d === null, name, d ?? undefined)
}
const section = (s: string): void => console.log('\n== ' + s)
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ---- independent money formatters (not the app's) ------------------------------------------------------------------

const MINUS = '−'
function usd2(c: number): string {
  const a = Math.abs(c)
  return (
    (c < 0 ? MINUS : '') +
    '$' +
    Math.floor(a / 100).toLocaleString('en-US') +
    '.' +
    String(a % 100).padStart(2, '0')
  )
}
function usd0(c: number): string {
  const d = Math.floor((Math.abs(c) + 50) / 100)
  return (c < 0 && d !== 0 ? MINUS : '') + '$' + d.toLocaleString('en-US')
}
const plural = (n: number, one: string, many = one + 's'): string => `${n} ${n === 1 ? one : many}`

// ---- API access through the page (cookies and CSRF of that login) ---------------------------------------------------

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

async function apiList(page: Page, range: string, filter = 'all', q = ''): Promise<any[]> {
  const out: any[] = []
  let cursor = ''
  for (;;) {
    const qs = `range=${range}&filter=${filter}&limit=500${q ? '&q=' + encodeURIComponent(q) : ''}${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`
    const r = await api(page, 'GET', '/payments/invoices?' + qs)
    out.push(...r.body.items)
    if (!r.body.nextCursor) return out
    cursor = r.body.nextCursor
  }
}

// ---- a browser per person ------------------------------------------------------------------------------------------

let lastPage: Page | null = null

interface Person {
  ctx: BrowserContext
  page: Page
  email: string
  requests: string[]
}

async function open(browser: Browser, email: string, startAt = '/payments', mounts = true): Promise<Person> {
  const ctx = await browser.newContext({
    viewport: { width: 1480, height: 1000 },
    timezoneId: 'America/New_York',
    locale: 'en-US',
    acceptDownloads: true,
  })
  // tsx (esbuild) wraps named functions in a __name helper that does not exist inside the page
  await ctx.addInitScript('window.__name = (f) => f')
  const page = await ctx.newPage()
  lastPage = page
  const requests: string[] = []
  page.on('pageerror', (e) => pageErrors.push(`${email}: ${String(e)}`))
  page.on('console', (m) => {
    // the browser logs every failed fetch; an API 4xx is checked as a response (below), not as a page error
    if (
      m.type() === 'error' &&
      !/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())
    )
      pageErrors.push(`${email}: console: ${m.text()}`)
  })
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/'))
      requests.push(`${r.method()} ${new URL(r.url()).pathname}${new URL(r.url()).search}`)
  })
  page.on('response', (r) => {
    if (!r.url().includes('/api/v1/')) return
    if (r.status() >= 500) apiBad.push(`${email}: ${r.status()} ${r.request().method()} ${r.url()}`)
    else if (r.status() >= 400 && r.status() !== 401)
      client4xx.push(
        `${email}: ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname.replace(/[0-9a-f-]{36}/g, ':id')}`,
      )
  })
  await login(page, stack, email, startAt)
  if (mounts) await page.waitForSelector('#dc-root .sc-host', { timeout: 30_000 })
  else await page.waitForSelector('text=No payment access', { timeout: 30_000 })
  return { ctx, page, email, requests }
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(shots, name + '.png') })
}

// ---- scraping the screen --------------------------------------------------------------------------------------------

interface View {
  locked: boolean
  lockedText: string
  rangeActive: string
  rangeLabel: string
  kpis: Array<{ label: string; value: string; sub: string }>
  banner: string
  bars: string[]
  barLabels: string[]
  methods: Array<{ label: string; value: string }>
  filters: Array<{ label: string; count: string; on: boolean }>
  query: string
  rows: Array<{
    id: string
    date: string
    client: string
    vehicle: string
    items: string
    total: string
    status: string
    adj: boolean
    selected: boolean
    statusBg: string
  }>
  noRows: boolean
  detail: null | {
    head: string
    status: string
    statusBg: string
    client: string
    sub: string
    big: Array<{ label: string; value: string }>
    lines: Array<{ label: string; value: string }>
    actions: Array<{ label: string; disabled: boolean; title: string }>
    creditLine: string
    ledger: Array<{
      glyph: string
      title: string
      amt: string
      meta: string
      buttons: string[]
      note: string
    }>
  }
  toast: string
  viewAsBar: string
  previewAs: boolean
}

async function scrape(page: Page): Promise<View> {
  return page.evaluate(() => {
    const root = document.querySelector('#dc-root')!
    const t = (e: Node | null | undefined): string => (e?.textContent ?? '').replace(/\s+/g, ' ').trim()
    const all = <T extends Element = HTMLElement>(sel: string, from: ParentNode = root): T[] => [
      ...from.querySelectorAll<T>(sel),
    ]
    const bodyText = t(root)
    const locked = bodyText.includes('No payment access')
    const lockedText = locked
      ? t(all('div').find((d) => t(d).startsWith('The ') && t(d).includes('role doesn')) ?? null)
      : ''
    const view: any = { locked, lockedText }
    const btns = all<HTMLButtonElement>('button')
    const rangeBtns = btns.filter((b) => ['Today', '7 days', '30 days', 'Month to date'].includes(t(b)))
    view.rangeActive = t(
      rangeBtns.find(
        (b) =>
          b.getAttribute('style')?.includes('background: var(--accent)') ||
          b.style.background.includes('var(--accent)'),
      ),
    )
    view.rangeLabel = t(rangeBtns[0]?.parentElement?.nextElementSibling)
    const grid6 = all('div').find((d) => d.style.gridTemplateColumns.includes('repeat(6'))
    view.kpis = grid6
      ? [...grid6.children].map((c) => ({
          label: t(c.children[0]),
          value: t(c.children[1]),
          sub: t(c.children[2]),
        }))
      : []
    const banner = all('div').find((d) => t(d).includes('awaiting approval') && !d.querySelector('div'))
    view.banner = banner ? t(banner) : ''
    view.bars = all('div[title]')
      .map((d) => d.getAttribute('title')!)
      .filter((x) => x.includes(' · net '))
    view.barLabels = all('div')
      .filter((d) => d.style.fontSize === '10px' && d.style.textAlign === 'center')
      .map((d) => t(d))
    const mh = all('div').find((d) => t(d) === 'Collected by method')
    view.methods = mh
      ? [...mh.parentElement!.children]
          .slice(1)
          .map((c) => ({ label: t(c.children[0]?.children[0]), value: t(c.children[0]?.children[1]) }))
      : []
    const search = root.querySelector<HTMLInputElement>('input[placeholder^="Search client"]')
    view.query = search?.value ?? ''
    const bar = search?.parentElement?.children[0]
    view.filters = bar
      ? [...bar.querySelectorAll('button')].map((b) => ({
          label: t(b.childNodes[0]),
          count: t([...b.querySelectorAll('span')].pop()),
          on: (b as HTMLElement).style.background.includes('accentSoft'),
        }))
      : []
    view.rows = all<HTMLButtonElement>('button')
      .filter((b) => b.style.gridTemplateColumns.startsWith('118px'))
      .map((b) => {
        const c = b.children
        const pill = c[4]?.querySelector('span') as HTMLElement | null
        return {
          date: t(c[0]?.children[0]),
          id: t(c[0]?.children[1]),
          client: t(c[1]?.children[0]),
          vehicle: t(c[1]?.children[1]),
          items: t(c[2]),
          total: t(c[3]),
          status: t(pill),
          adj: t(c[4]).endsWith('ADJ'),
          selected: b.style.background.includes('accentSoft'),
          statusBg: pill?.style.background ?? '',
        }
      })
    view.noRows = bodyText.includes('Nothing matches this filter.')
    const aside = root.querySelector('aside')
    if (aside && aside.textContent) {
      const head = aside.querySelector('span')!
      const statusEl = head.nextElementSibling as HTMLElement | null
      const pad = [...aside.querySelectorAll('div')].filter((d) => d.style.padding === '6px 14px')[0]
      const big = [...aside.querySelectorAll('div')].find((d) =>
        d.style.gridTemplateColumns.startsWith('repeat(3'),
      )
      const actionGrid = [...aside.querySelectorAll('div')].find(
        (d) => d.style.gridTemplateColumns === '1fr 1fr',
      )
      const ledgerHead = [...aside.querySelectorAll('div')].find((d) => t(d).startsWith('Ledger & audit'))
      const ledger: any[] = []
      let n = ledgerHead?.nextElementSibling
      while (n) {
        const body = n.children[1]
        const btnsDiv = [...(body?.children ?? [])].filter((x) => x.querySelector('button'))
        ledger.push({
          glyph: t(n.children[0]),
          title: t(body?.children[0]?.children[0]),
          amt: t(body?.children[0]?.children[1]),
          meta: t(body?.children[1]),
          buttons: btnsDiv.flatMap((d) => [...d.querySelectorAll('button')].map((b) => t(b))),
          note: t(
            body?.children[body.children.length - 1]?.querySelector('button')
              ? undefined
              : body?.children[body.children.length - 1],
          ),
        })
        n = n.nextElementSibling
      }
      const creditEl = [...aside.querySelectorAll('div')].find(
        (d) => d.style.background.includes('accentSoft') && d.style.fontSize === '12.5px',
      )
      view.detail = {
        head: t(head),
        status: t(statusEl),
        statusBg: statusEl?.style.background ?? '',
        client: t([...aside.querySelectorAll('div')].find((d) => d.style.fontSize === '22px')),
        sub: t(
          [...aside.querySelectorAll('div')].find(
            (d) => d.style.fontSize === '13px' && d.style.marginTop === '2px',
          ),
        ),
        big: big ? [...big.children].map((c) => ({ label: t(c.children[0]), value: t(c.children[1]) })) : [],
        lines: pad
          ? [...pad.children].map((c) => ({ label: t(c.children[0]), value: t(c.children[1]) }))
          : [],
        actions: actionGrid
          ? [...actionGrid.querySelectorAll('button')].map((b) => ({
              label: t(b),
              disabled: (b as HTMLButtonElement).disabled,
              title: b.getAttribute('title') ?? '',
            }))
          : [],
        creditLine: t(creditEl),
        ledger,
      }
    } else view.detail = null
    const toast = all('div').find((d) => d.style.position === 'fixed' && d.style.bottom === '26px')
    view.toast = t(toast)
    const bar2 = all('div').find((d) => t(d).startsWith('Viewing as') && d.style.borderBottom !== '')
    view.viewAsBar = bar2 ? t(bar2.children[0]) : ''
    view.previewAs = btns.some((b) => t(b).startsWith('Preview as'))
    return view
  }) as Promise<View>
}

/** Waits until the screen shows data (first row or an empty state) and nothing has changed for a moment. */
async function settled(page: Page, ms = 400): Promise<View> {
  let last = ''
  let v: View = await scrape(page)
  const t0 = Date.now()
  for (;;) {
    const s = JSON.stringify([v.rangeLabel, v.rows.length, v.kpis, v.detail?.head, v.detail?.ledger.length])
    const ready =
      v.locked ||
      ((v.rows.length > 0 || v.noRows) && v.kpis[0]?.value !== '—' && (v.detail?.head ?? '') !== '')
    if (ready && s === last) return v
    last = s
    if (Date.now() - t0 > 20_000) return v
    await sleep(ms)
    v = await scrape(page)
  }
}

const rangeButton = (page: Page, label: string) => page.getByRole('button', { name: label, exact: true })

async function setRange(page: Page, label: string): Promise<View> {
  await rangeButton(page, label).click()
  await sleep(300)
  return settled(page)
}

// ---- expectations from the API --------------------------------------------------------------------------------------

const RANGE_BTN: Record<string, string> = {
  today: 'Today',
  '7d': '7 days',
  '30d': '30 days',
  mtd: 'Month to date',
}
const FILTER_LABEL: Record<string, string> = {
  all: 'All',
  unpaid: 'Open balance',
  refunds: 'Refunds',
  adjusted: 'Adjusted',
  credits: 'Credits',
}

function statusOf(r: { statusLabel: string; refundPending: boolean; awaiting?: string | null }): string {
  if (r.refundPending || r.awaiting === 'refund') return 'Refund pending'
  if (r.awaiting === 'payment') return 'Payment pending'
  return r.statusLabel
}

function expectedRows(items: any[]) {
  return items.map((r) => ({
    id: r.label,
    date: `${r.date} · ${r.time}`,
    client: r.client,
    vehicle: r.vehicle,
    items: r.items.first + (r.items.more > 0 ? ' +' + r.items.more : ''),
    total: usd2(r.totalCents),
    status: statusOf(r),
    adj: r.adjusted,
  }))
}

async function compareSummary(page: Page, v: View, range: string, label: string): Promise<any> {
  const s = (await api(page, 'GET', `/payments/summary?range=${range}`)).body
  const k = s.kpis
  const c = k.counts
  eq(v.rangeLabel, s.range.label, `${label}: range label`)
  eq(
    v.kpis,
    [
      { label: 'Gross sales', value: usd0(k.grossSales), sub: plural(c.invoices, 'invoice') },
      { label: 'Net revenue', value: usd0(k.netRevenue), sub: 'after refunds & discounts' },
      { label: 'Refunds', value: usd0(k.refunds), sub: `${c.refunded} refunded` },
      { label: 'Adjustments', value: usd0(k.adjustments), sub: plural(c.adjusted, 'invoice') },
      { label: 'Credits issued', value: usd0(k.creditsIssued), sub: plural(c.creditClients, 'client') },
      { label: 'Outstanding', value: usd0(k.outstanding), sub: plural(c.openBalances, 'open balance') },
    ],
    `${label}: KPI cards`,
  )
  eq(
    v.methods.slice(0, 4),
    [
      { label: 'Card', value: usd0(s.byMethod.card) },
      { label: 'Apple Pay', value: usd0(s.byMethod.applePay) },
      { label: 'Cash', value: usd0(s.byMethod.cash) },
      { label: 'Store credit', value: usd0(s.byMethod.storeCredit) },
    ],
    `${label}: collected by method`,
  )
  if (s.byMethod.other === 0) eq(v.methods.length, 4, `${label}: no "Other" row when zero`)
  else
    eq(v.methods[4], { label: 'Other', value: usd0(s.byMethod.other) }, `${label}: "Other" row when non-zero`)
  eq(
    v.bars,
    s.chart.buckets.map((b: any) => `${b.title} · net ${usd0(b.netCents)}`),
    `${label}: chart tooltips`,
  )
  eq(
    v.barLabels,
    s.chart.buckets.map((b: any) => b.label),
    `${label}: chart labels`,
  )
  eq(
    v.filters.map((f) => [f.label, f.count]),
    Object.entries(FILTER_LABEL).map(([key, l]) => [l, String(s.filterCounts[key])]),
    `${label}: filter counts`,
  )
  eq(v.banner, s.pendingApprovals.count > 0 ? s.pendingApprovals.text : '', `${label}: pending banner`)
  return s
}

async function compareList(
  page: Page,
  v: View,
  range: string,
  filter: string,
  q: string,
  label: string,
): Promise<any[]> {
  const items = await apiList(page, range, filter, q)
  const exp = expectedRows(items)
  eq(
    v.rows.map((r) => ({
      id: r.id,
      date: r.date,
      client: r.client,
      vehicle: r.vehicle,
      items: r.items,
      total: r.total,
      status: r.status,
      adj: r.adj,
    })),
    exp,
    `${label}: rows (${items.length})`,
  )
  eq(v.noRows, items.length === 0, `${label}: empty state`)
  return items
}

async function compareDetail(page: Page, v: View, id: string, label: string): Promise<any> {
  const d = (await api(page, 'GET', `/invoices/${id}`)).body
  const dv = v.detail
  ok(dv, `${label}: detail panel present`)
  if (!dv) return d
  const awaiting = d.ledger.some((e: any) => e.awaitingProcessor)
  const awaitRefund = d.ledger.some((e: any) => e.awaitingProcessor && e.type === 'refund')
  eq(dv.head, `${d.label} · ${d.when}`, `${label}: detail head`)
  eq(
    dv.status,
    statusOf({
      statusLabel: d.statusLabel,
      refundPending: d.refundPending,
      awaiting: awaiting ? (awaitRefund ? 'refund' : 'payment') : null,
    }),
    `${label}: detail status`,
  )
  eq(dv.client, d.client, `${label}: detail client`)
  eq(dv.sub, `${d.vehicle} · ${d.staff}`, `${label}: detail vehicle and staff`)
  const c = d.calc
  eq(
    dv.big,
    [
      { label: 'Total', value: usd2(c.total) },
      { label: 'Collected', value: usd2(c.paid - c.refunded) },
      c.balance > 0
        ? { label: 'Balance due', value: usd2(c.balance) }
        : { label: 'Refundable', value: usd2(c.refundable) },
    ],
    `${label}: stat cards`,
  )
  const lines: Array<{ label: string; value: string }> = [
    ...d.items.map((i: any) => ({ label: i.name, value: usd2(i.priceCents) })),
    ...d.adjustments.map((a: any) => ({
      label: (a.amountCents < 0 ? 'Discount · ' : 'Surcharge · ') + (a.reason ?? ''),
      value: usd2(a.amountCents),
    })),
    { label: `Tax (${Number((d.taxBp / 100).toFixed(2))}%)`, value: usd2(c.tax) },
    ...(c.tip ? [{ label: 'Tip', value: usd2(c.tip) }] : []),
    { label: 'Total', value: usd2(c.total) },
    ...(c.creditApplied ? [{ label: 'Store credit applied', value: usd2(-c.creditApplied) }] : []),
    { label: 'Paid', value: usd2(c.paidOrig) },
    ...(c.refunded ? [{ label: 'Refunded', value: usd2(-c.refunded) }] : []),
  ]
  eq(dv.lines, lines, `${label}: breakdown lines`)
  eq(
    dv.ledger.map((e) => [e.title, e.amt]),
    d.ledger.map((e: any) => [ledgerTitle(e), ledgerAmt(e)]),
    `${label}: ledger titles and amounts`,
  )
  eq(
    dv.ledger.map((e) => e.meta.endsWith('Awaiting Squarespace')),
    d.ledger.map((e: any) => e.awaitingProcessor),
    `${label}: ledger awaiting tags`,
  )
  eq(
    dv.ledger.map(
      (e) =>
        e.meta.startsWith(e.meta.split(' · ')[0]!) && e.meta.includes(d.ledger[dv.ledger.indexOf(e)].atLabel),
    ),
    d.ledger.map(() => true),
    `${label}: ledger stamps`,
  )
  eq(
    dv.ledger.map((e) => e.buttons.includes('Approve')),
    d.ledger.map((e: any) => e.type === 'refund' && e.status === 'pending'),
    `${label}: approve buttons only on pending refunds`,
  )
  eq(
    dv.ledger.map((e) => e.buttons.includes('Confirm in Squarespace')),
    d.ledger.map((e: any) => e.awaitingProcessor),
    `${label}: confirm buttons only on awaiting entries`,
  )
  eq(
    dv.creditLine,
    d.clientCredit.balanceCents > 0
      ? `${d.client.split(' ')[0]} has ${usd2(d.clientCredit.balanceCents)} in store credit`
      : '',
    `${label}: credit line`,
  )
  return d
}

const ledgerTitle = (e: any): string => {
  const pend = e.type === 'refund' && e.status === 'pending'
  switch (e.type) {
    case 'pay':
      return (e.deposit ? 'Deposit · ' : 'Payment · ') + e.method
    case 'adjust':
      return (e.amountCents < 0 ? 'Discount' : 'Surcharge') + ' · ' + e.reason
    case 'refund':
      return (
        (pend ? 'Refund requested' : e.status === 'denied' ? 'Refund denied' : 'Refund') +
        ' · ' +
        (e.dest === 'credit' ? 'to store credit' : e.dest === 'cash' ? 'cash' : e.method)
      )
    case 'credit_issue':
      return 'Credit issued · ' + e.reason
    case 'credit_apply':
      return 'Store credit applied'
    default:
      return 'Payment voided · ' + e.method
  }
}
const ledgerAmt = (e: any): string => {
  const a = usd2(Math.abs(e.amountCents))
  return e.type === 'refund' || e.type === 'void' ? MINUS + a : e.type === 'credit_issue' ? '+' + a : a
}

/** Everything visible against the API, for the current range, filter and search of the page. */
async function compareAll(
  page: Page,
  label: string,
  opts: { range: string; filter?: string; q?: string },
): Promise<{ v: View; list: any[]; summary: any; detail: any }> {
  let v = await settled(page)
  const summary = await compareSummary(page, v, opts.range, label)
  const list = await compareList(page, v, opts.range, opts.filter ?? 'all', opts.q ?? '', label)
  let sel = v.rows.find((r) => r.selected)
  if (!sel && v.rows.length > 0) {
    // the open invoice stays open when a range, filter or search hides its row (DV-502, as the design does); open the
    // first visible row so its detail panel is checked too
    v = await clickRow(page, v.rows[0]!.id)
    sel = v.rows.find((r) => r.selected)
  }
  const selId = sel ? list.find((x) => x.label === sel.id)?.id : list[0]?.id
  const detail = selId ? await compareDetail(page, v, selId, label) : null
  return { v, list, summary, detail }
}

async function clickRow(page: Page, label: string): Promise<View> {
  await page
    .locator('button[style*="118px"]')
    .filter({ hasText: new RegExp(`${label}(?!\\d)`) })
    .first()
    .click()
  await sleep(250)
  let v = await settled(page)
  for (let i = 0; i < 20 && !v.detail?.head.startsWith(label); i++) {
    await sleep(250)
    v = await scrape(page)
  }
  return v
}

async function waitToast(page: Page, re: RegExp, ms = 6000): Promise<string> {
  const t0 = Date.now()
  let t = ''
  while (Date.now() - t0 < ms) {
    t = (await scrape(page)).toast
    if (re.test(t)) return t
    await sleep(100)
  }
  return t
}

/** A toast that is not the one already showing (a toast stays 3 s, and two actions can say the same words). */
async function waitToastNew(page: Page, re: RegExp, previous: string, ms = 8000): Promise<string> {
  const t0 = Date.now()
  let t = ''
  while (Date.now() - t0 < ms) {
    t = (await scrape(page)).toast
    if (re.test(t) && t !== previous) return t
    await sleep(100)
  }
  return t
}

async function waitFor<T>(fn: () => Promise<T>, pred: (x: T) => boolean, ms = 10_000): Promise<T> {
  const t0 = Date.now()
  let x = await fn()
  while (!pred(x) && Date.now() - t0 < ms) {
    await sleep(250)
    x = await fn()
  }
  return x
}

// ---- golden values of the original bundle ----------------------------------------------------------------------------

const readGolden = (f: string): any => JSON.parse(fs.readFileSync(path.join(GOLDEN, f), 'utf8'))
const stripStamp = (m: string): string =>
  m.replace(/^(?:(?:Today|Yesterday|[A-Z][a-z]{2} \d{1,2})(?: · | ))?\d{1,2}:\d{2} [AP]M(?: · )?/, '')

// ---- phase: read ----------------------------------------------------------------------------------------------------

async function phaseRead(browser: Browser): Promise<void> {
  section('read: Management')
  const p = await open(browser, EMAILS.manager)
  const page = p.page
  let v = await settled(page)
  await shot(page, '01-management-7d')
  ok(!v.previewAs, 'Management has no "Preview as" button (not a Super Admin)')
  eq(v.rangeActive, '7 days', 'default range is 7 days')
  ok(v.rows.length > 0 && v.rows[0]!.selected, 'first row is selected by default')
  await compareAll(page, '7d initial', { range: '7d' })

  // golden values of the original bundle for ranges whose window does not depend on the calendar month
  const golden = readGolden('views.json').views
  const goldenDetails = readGolden('details.json').invoices
  for (const range of ['today', '7d', '30d', 'mtd']) {
    v = await setRange(page, RANGE_BTN[range]!)
    await shot(page, `02-range-${range}`)
    const { summary } = await compareAll(page, `range ${range}`, { range })
    ok(summary.range.key === range, `summary answers for ${range}`)
    if (range === 'mtd') continue // the design's month-to-date is June 1-13; today's is the real month
    for (const filter of Object.keys(FILTER_LABEL)) {
      const g = golden[range][filter]
      await page
        .getByRole('button', { name: new RegExp(`^${FILTER_LABEL[filter]}\\s*\\d*$`) })
        .first()
        .click()
      await sleep(300)
      v = await settled(page)
      const where = `golden ${range}/${filter}`
      // the design's singular bugs are fixed in live mode ("1 invoices" -> "1 invoice")
      const fixPlural = (s: string): string =>
        s
          .replace(/^1 invoices$/, '1 invoice')
          .replace(/^1 clients$/, '1 client')
          .replace(/^1 open balances$/, '1 open balance')
      eq(
        v.kpis.map((k) => [k.label, k.value, k.sub]),
        g.kpis.map((k: any) => [k.label, k.value, fixPlural(k.sub)]),
        `${where}: KPIs`,
      )
      eq(
        v.methods.map((m) => [m.label, m.value]),
        g.methods.map((m: any) => [m.label, m.value]),
        `${where}: methods`,
      )
      eq(
        v.filters.map((f) => [f.label, f.count]),
        g.filters.map((f: any) => [f.label, f.count]),
        `${where}: filter counts`,
      )
      if (range !== '30d' || filter === 'all')
        eq(
          v.bars.map((b) => b.replace(/^.* · net/, 'net')),
          g.bars.map((b: any) => b.title.replace(/^.* · net/, 'net')),
          `${where}: chart net per bucket`,
        )
      // the design reuses invoice ids (its generated history collides with the explicit invoices); the backend renumbers
      // those, so an id is compared only where the original's is one of the 16 explicit invoices and unique in the whole list
      const dup = (id: string): boolean =>
        golden['30d'].all.rows.filter((x: any) => x.id === id).length > 1 || !(id in goldenDetails)
      eq(
        v.rows.map((r, i) => [
          dup(g.rows[i]?.id) ? '(renumbered)' : r.id,
          r.client,
          r.vehicle,
          r.items,
          r.total,
          r.status,
          r.adj,
        ]),
        g.rows.map((r: any) => [
          dup(r.id) ? '(renumbered)' : r.id,
          r.client,
          r.vehicle,
          r.items,
          r.total,
          r.status,
          r.adjusted,
        ]),
        `${where}: rows (${g.rows.length})`,
      )
      eq(v.banner, g.hasPending ? g.pendingText : '', `${where}: banner`)
    }
    await page
      .getByRole('button', { name: /^All\s*\d*$/ })
      .first()
      .click()
  }

  // every filter and search on 30 days against the API
  v = await setRange(page, '30 days')
  for (const filter of Object.keys(FILTER_LABEL)) {
    await page
      .getByRole('button', { name: new RegExp(`^${FILTER_LABEL[filter]}\\s*\\d*$`) })
      .first()
      .click()
    await sleep(300)
    await compareAll(page, `30d filter ${filter}`, { range: '30d', filter })
    if (filter === 'refunds') await shot(page, '03-filter-refunds')
  }
  await page
    .getByRole('button', { name: /^All\s*\d*$/ })
    .first()
    .click()
  const search = page.locator('input[placeholder^="Search client"]')
  for (const q of ['marcus', 'BMW', 'inv-2060', 'wax', 'zzzz-nothing', ' priya ']) {
    await search.fill(q)
    await sleep(600)
    const { v: sv, list } = await compareAll(page, `search "${q}"`, { range: '30d', q })
    if (q === 'zzzz-nothing') {
      ok(sv.noRows && sv.rows.length === 0, 'search with no match shows "Nothing matches this filter."')
      ok(
        /^INV-\d+ · /.test(sv.detail?.head ?? ''),
        'the detail panel keeps the last invoice when nothing matches',
        sv.detail?.head,
      )
      await shot(page, '04-search-empty')
    }
    void list
  }
  await search.fill('')
  await sleep(600)

  // the banner's Review clears filter and search and selects the invoice
  await page
    .getByRole('button', { name: /^Credits\s*\d*$/ })
    .first()
    .click()
  await search.fill('zzzz-nothing')
  await sleep(600)
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await sleep(500)
  v = await settled(page)
  eq(v.query, '', 'Review clears the search')
  eq(
    v.filters.filter((f) => f.on).map((f) => f.label),
    ['All'],
    'Review clears the filter',
  )
  ok(v.detail?.head.startsWith('INV-20579'), 'Review selects the pending invoice', v.detail?.head)
  ok(
    v.rows.some((r) => r.id === 'INV-20579' && r.selected),
    'the pending invoice is in the table and selected',
  )
  const pend = v.detail?.ledger.find((e) => e.buttons.includes('Approve'))
  ok(pend && pend.buttons.includes('Deny'), 'pending refund shows Approve and Deny')
  eq(pend?.note, 'You can approve up to $1,000.', 'approve note for Management + Accounting (highest limit)')
  await shot(page, '05-pending-refund')

  // the 16 invoices of the original's detail panel
  v = await setRange(page, '30 days')
  for (const [id, g] of Object.entries<any>(goldenDetails)) {
    v = await clickRow(page, id)
    const d = v.detail
    const where = `golden detail ${id}`
    ok(d, where + ': panel')
    if (!d) continue
    ok(d.head.startsWith(id), where + ': head')
    const whenOk = !/^(Today|Yesterday)/.test(g.when) || d.head.endsWith(g.when)
    ok(whenOk, where + ': when', { live: d.head, golden: g.when })
    eq([d.client, d.sub], [g.client, `${g.vehicle} · ${g.staff}`], where + ': client, vehicle, staff')
    eq(d.status, g.status, where + ': status')
    eq(d.big, g.big, where + ': stat cards')
    eq(d.lines, g.lines, where + ': breakdown')
    eq(
      d.actions.map((a) => [a.label, a.disabled, a.title]),
      g.actions.map((a: any) => [a.label, a.disabled, a.why]),
      where + ': actions',
    )
    eq(d.creditLine, g.creditLine, where + ': credit line')
    const norm = (l: Array<{ title: string; amt: string; meta: string }>): string[] =>
      l.map((e) => `${e.title}|${e.amt}|${stripStamp(e.meta)}`).sort()
    eq(norm(d.ledger), norm(g.ledger), where + ': ledger (titles, amounts, notes)')
    for (const e of g.ledger)
      if (e.pending)
        ok(
          d.ledger.some((x) => x.note === e.approveNote),
          where + ': approve note',
          e.approveNote,
        )
  }

  // one invoice of every status
  const all30 = await apiList(page, '30d')
  const seen = new Map<string, string>()
  for (const r of all30) if (!seen.has(statusOf(r))) seen.set(statusOf(r), r.label)
  ok(seen.size >= 5, 'the seed reaches at least five statuses', [...seen.keys()])
  for (const [status, id] of seen) {
    v = await clickRow(page, id)
    await compareDetail(page, v, all30.find((x) => x.label === id).id, `status "${status}" (${id})`)
  }
  await shot(page, '06-detail-statuses')

  // the cents twin equals the server's calc on every invoice (105)
  let twinChecked = 0
  for (const r of all30) {
    const d = (await api(page, 'GET', `/invoices/${r.id}`)).body
    const twin = calcCents({
      itemPrices: d.items.map((i: any) => i.priceCents),
      events: d.ledger.map((e: any) => ({
        type: e.type,
        amountCents: e.amountCents,
        status: e.type === 'refund' ? e.status : undefined,
        dest: e.dest,
      })),
      taxBp: d.taxBp,
      tipCents: d.tipCents,
      canceled: d.canceled,
    })
    const bad = Object.entries(twin).filter(([k, val]) => d.calc[k] !== val)
    ok(
      bad.length === 0,
      `cents twin equals server calc on ${d.label}`,
      bad.map(([k, val]) => `${k}: twin ${val} server ${d.calc[k]}`),
    )
    twinChecked++
  }
  eq(twinChecked, 105, 'cents twin checked on all 105 seeded invoices')

  // reload keeps the same figures
  v = await clickRow(page, 'INV-20603')
  await page.reload()
  await page.waitForSelector('#dc-root .sc-host')
  await compareAll(page, 'after reload', { range: '7d' })
  await shot(page, '07-after-reload')
  await p.ctx.close()
}

/**
 * The refund sheet's inline check against the server, on invoices of the 7-day list chosen for the review findings the
 * caps exist for: card money below the other money (2: cash paid, the card cap is smaller), non-credit money below what is
 * refundable (14: store credit applied), and a pending refund (7) when one is listed. For each destination and every
 * amount one cent above a cap the sheet must name the server's refusal word for word and disable its button; the server
 * is then asked (POST /invoices/:id/refunds, refused, so nothing changes) and must answer 422 with that same detail. An
 * amount the sheet allows is never sent.
 */
async function refundCapsAgainstServer(page: Page): Promise<void> {
  const rows = (await apiList(page, '7d')).filter((r) => r.paidCents > 0)
  const details: any[] = []
  for (const r of rows) details.push((await api(page, 'GET', `/invoices/${r.id}`)).body)
  const caps = (d: any) => d.refundCaps as { cardCents: number; otherCents: number; totalCents: number }
  ok(
    details.length > 0 && details.every((d) => d.refundCaps && Number.isInteger(caps(d).totalCents)),
    'GET /invoices/:id carries refundCaps on every paid invoice of the week',
  )
  ok(
    details.every((d) => caps(d).totalCents === d.calc.refundable),
    'refundCaps.totalCents is calc.refundable',
  )
  const pick = (pred: (d: any) => boolean) => details.find((d) => pred(d) && caps(d).totalCents > 0)
  const chosen = [
    pick((d) => caps(d).cardCents < caps(d).otherCents),
    pick((d) => caps(d).otherCents < caps(d).totalCents),
    pick((d) => d.calc.pendingN > 0),
  ].filter((d, i, a) => d && a.findIndex((x) => x?.id === d.id) === i)
  ok(
    chosen.length >= 2,
    'the week has invoices with cash money and with store credit money to check',
    chosen.length,
  )
  for (const d of chosen) {
    const c = caps(d)
    await openSheet(page, d.label, /^Refund$/)
    await sheetButton(page, /^Custom$/).click()
    for (const [label, dest] of [
      ['Original payment', 'card'],
      ['Cash', 'cash'],
      ['Store credit', 'credit'],
    ] as const) {
      await sheetButton(page, new RegExp(`^${label}$`)).click()
      for (const cents of [...new Set([c.cardCents + 1, c.otherCents + 1, c.totalCents + 1])]) {
        await sheet(page)
          .locator('input')
          .first()
          .fill((cents / 100).toFixed(2))
        await sleep(150)
        const txt = await sheetText(page)
        const blocked = await submitBtn(page).isDisabled()
        const capped =
          (dest === 'card' && cents > c.cardCents) ||
          cents > c.totalCents ||
          (dest === 'cash' && cents > c.otherCents)
        const what = `${d.label} ${dest} ${usd2(cents)}`
        ok(blocked === capped, `refund caps: the sheet blocks exactly what the server refuses (${what})`, txt)
        if (!blocked) continue
        const res = await api(page, 'POST', `/invoices/${d.id}/refunds`, {
          mode: 'custom',
          amountCents: cents,
          dest,
        })
        ok(res.status === 422, `refund caps: the server refuses ${what}`, res.body)
        ok(
          typeof res.body?.detail === 'string' && txt.includes(res.body.detail),
          `refund caps: the sheet says the server's words (${what})`,
          { server: res.body?.detail, sheet: txt },
        )
      }
    }
    await sheet(page).getByRole('button', { name: 'Cancel', exact: true }).click()
    const after = (await api(page, 'GET', `/invoices/${d.id}`)).body
    eq(caps(after), c, `refund caps: ${d.label} unchanged by the refused requests`)
  }
}

// ---- phase: write ---------------------------------------------------------------------------------------------------

async function openSheet(page: Page, invoice: string, action: RegExp | string): Promise<View> {
  await clickRow(page, invoice)
  const b = page.locator('aside button').filter({ hasText: action }).first()
  await b.click()
  await sleep(250)
  return scrape(page)
}

const sheet = (page: Page) => page.locator('div[style*="position: fixed"][style*="z-index: 70"]')
const submitBtn = (page: Page) => sheet(page).locator('button').last()
async function sheetText(page: Page): Promise<string> {
  return ((await sheet(page).textContent()) ?? '').replace(/\s+/g, ' ').trim()
}
const sheetButton = (page: Page, name: string | RegExp) =>
  sheet(page).locator('button', { hasText: name }).first()

async function submit(page: Page, toast: RegExp): Promise<string> {
  const previous = (await scrape(page)).toast
  await submitBtn(page).click()
  return waitToastNew(page, toast, previous)
}

interface Seen {
  method: string
  url: string
  key: string | undefined
  status: number
}

function recordCommands(page: Page): Seen[] {
  const seen: Seen[] = []
  page.on('response', async (r) => {
    const req = r.request()
    if (req.method() === 'POST' && req.url().includes('/api/v1/')) {
      seen.push({
        method: req.method(),
        url: new URL(req.url()).pathname,
        key: req.headers()['idempotency-key'],
        status: r.status(),
      })
    }
  })
  return seen
}

/** Reloads (state back to 7 days and the first row), puts the screen back where it was and compares everything. */
async function reloadAndCompare(
  page: Page,
  label: string,
  opts: { range: string; select?: string },
): Promise<View> {
  await page.reload()
  await page.waitForSelector('#dc-root .sc-host')
  await settled(page)
  if (opts.range !== '7d') await setRange(page, RANGE_BTN[opts.range]!)
  if (opts.select) await clickRow(page, opts.select)
  return (await compareAll(page, label, opts)).v
}

async function phaseWrite(browser: Browser): Promise<void> {
  section('write: Management')
  const admin = await open(browser, EMAILS.superAdmin)
  const rafael = await open(browser, EMAILS.manager)
  const daniel = await open(browser, EMAILS.accounting)
  const page = rafael.page
  const cmds = recordCommands(page)
  const acct = (await api(admin.page, 'GET', '/roles')).body.roles.find((r: any) => r.key === 'acct')

  let v = await setRange(page, '7 days')

  // -- apply credit, then collect cash on the unpaid invoice ------------------------------------------------------------
  v = await clickRow(page, 'INV-20603')
  eq(v.detail?.status, 'Unpaid', 'INV-20603 starts Unpaid')
  eq(
    v.detail?.actions.map((a) => a.label),
    ['Collect $164.78', 'Apply $20.00 credit', 'Refund', 'Adjust', 'Issue credit', 'Send receipt'],
    'INV-20603 buttons',
  )
  await page.locator('aside button', { hasText: /^Apply/ }).click()
  await sleep(250)
  let txt = await sheetText(page)
  ok(
    txt.includes('Apply store credit') &&
      txt.includes('Available credit$20.00') &&
      txt.includes('Balance after$144.78'),
    'apply-credit sheet summary',
    txt,
  )
  await shot(page, '10-sheet-apply')
  ok(!(await submitBtn(page).isDisabled()), 'apply submit is enabled')
  const t1 = await submit(page, /credit applied/)
  eq(t1, '$20.00 credit applied', 'apply credit toast')
  v = await settled(page)
  eq(v.detail?.status, 'Partially paid', 'after applying credit the invoice is Partially paid')
  ok(v.detail?.ledger[0]?.title === 'Store credit applied', 'ledger shows the credit applied')
  const apply = cmds.filter((c) => c.url.endsWith('/credit-applications'))
  eq(apply.length, 1, 'one credit-applications request')
  ok(
    apply[0]?.key && apply[0].status === 201,
    'apply request carried an Idempotency-Key and succeeded',
    apply,
  )

  await page.locator('aside button', { hasText: /^Collect/ }).click()
  await sleep(250)
  txt = await sheetText(page)
  ok(
    txt.includes('Balance due$144.78') && txt.includes('Receipt goes out by SMS and email.'),
    'collect sheet: balance and SMS wording',
    txt,
  )
  ok(!txt.includes('WhatsApp'), 'no WhatsApp wording in the collect sheet')
  ok(
    (await sheet(page).locator('input').count()) === 0,
    'collect sheet has no URL input unless "Payment link" is chosen',
  )
  await sheetButton(page, /^Cash$/).click()
  await shot(page, '11-sheet-collect')
  const t2 = await submit(page, /^Collected/)
  eq(t2, 'Collected $144.78', 'collect cash toast')
  v = await settled(page)
  eq(v.detail?.status, 'Paid', 'INV-20603 is Paid after collecting cash')
  eq(v.rows.find((r) => r.id === 'INV-20603')?.status, 'Paid', 'its row says Paid too')
  const pays = cmds.filter((c) => c.url.endsWith('/payments') && c.method === 'POST')
  ok(
    pays.length === 1 && pays[0]!.key && pays[0]!.status === 201,
    'collect request: one POST with an Idempotency-Key',
    pays,
  )
  await reloadAndCompare(page, 'INV-20603 after reload', { range: '7d', select: 'INV-20603' })

  // -- card on file: counts at once, awaiting Squarespace, then confirmed ----------------------------------------------
  const before = (await api(page, 'GET', '/payments/summary?range=7d')).body
  v = await openSheet(page, 'INV-20605', /^Collect/)
  await sheetButton(page, /^Card on file$/).click()
  const t3 = await submit(page, /^Collected/)
  eq(t3, 'Collected $228.20', 'collect card toast (the balance was $228.20: $50 was already paid)')
  v = await settled(page)
  ok(
    v.detail?.status === 'Payment pending',
    'card payment: header pill reads "Payment pending"',
    v.detail?.status,
  )
  ok(v.detail?.statusBg.includes('amberSoft'), 'card payment: the pill is amber', v.detail?.statusBg)
  eq(
    v.rows.find((r) => r.id === 'INV-20605')?.status,
    'Payment pending',
    'card payment: row pill reads "Payment pending"',
  )
  const led = v.detail?.ledger[0]
  eq(led?.title, 'Payment · Card', 'card label is the brand-only "Card" (never an invented last4)')
  ok(
    led?.meta.endsWith(' · Awaiting Squarespace'),
    'ledger meta ends with " · Awaiting Squarespace"',
    led?.meta,
  )
  ok(led?.buttons.includes('Confirm in Squarespace'), 'Confirm in Squarespace button is shown')
  await shot(page, '12-awaiting-squarespace')
  const after = (await api(page, 'GET', '/payments/summary?range=7d')).body
  eq(
    after.byMethod.card - before.byMethod.card,
    22820,
    'the card payment counted at once in "collected by method"',
  )
  eq(
    after.awaitingProcessor.count - before.awaitingProcessor.count,
    1,
    'summary counts one entry awaiting the processor',
  )
  await reloadAndCompare(page, 'INV-20605 awaiting after reload', { range: '7d', select: 'INV-20605' })
  await page.locator('aside button', { hasText: 'Confirm in Squarespace' }).click()
  const t4 = await waitToast(page, /confirmed in Squarespace/)
  eq(t4, 'Payment confirmed in Squarespace · $228.20', 'confirm toast')
  v = await settled(page)
  await waitFor(
    () => scrape(page),
    (x) => x.detail?.status === 'Paid',
    5000,
  )
  v = await scrape(page)
  eq(v.detail?.status, 'Paid', 'after confirming, the pill reads Paid again')
  ok(!v.detail?.ledger[0]?.meta.includes('Awaiting'), 'the awaiting tag is gone')
  await reloadAndCompare(page, 'INV-20605 confirmed after reload', { range: '7d', select: 'INV-20605' })

  // -- payment link: URL input, host error inline, success -----------------------------------------------------------
  v = await openSheet(page, 'INV-20607', /^Collect/)
  await sheetButton(page, /^Payment link$/).click()
  await sleep(200)
  const url = sheet(page).locator('input')
  eq(await url.count(), 1, 'Payment link shows exactly one extra input')
  ok(await submitBtn(page).isDisabled(), 'submit stays disabled until a URL is typed')
  await shot(page, '13-sheet-payment-link')
  await url.fill('http://evil.example/pay')
  await submitBtn(page).click()
  await sleep(1200)
  txt = await sheetText(page)
  ok(
    txt.includes('Payment links must be HTTPS links on an allowed host'),
    'the server host error is shown inline',
    txt,
  )
  await shot(page, '14-payment-link-error')
  const linkBefore = cmds.filter((c) => c.url.endsWith('/payments')).length
  ok(linkBefore >= 2, 'the rejected link did reach the server once', linkBefore)
  await url.fill('https://pay.squarespace.com/oasis/inv-20607')
  const t5 = await submit(page, /^Payment link (sent|saved)/)
  ok(/^Payment link (sent to Marcus Webb|saved · Marcus Webb)/.test(t5), 'payment link toast', t5)
  v = await settled(page)
  eq(v.detail?.status, 'Partially paid', 'no ledger event or status change until Squarespace pays')
  const linkCalls = cmds.filter((c) => c.url.endsWith('/payments')).slice(-2)
  eq(
    linkCalls.map((c) => c.status),
    [422, 201],
    'the rejected link answered 422, the corrected one 201',
  )
  ok(
    linkCalls[0]!.key && linkCalls[0]!.key === linkCalls[1]!.key,
    'the corrected retry reuses the Idempotency-Key of the sheet (generated when it opened)',
    linkCalls.map((c) => c.key),
  )

  // -- refunds: by item to store credit, custom to card, custom to cash, full to card (awaiting), over the limit --------
  v = await openSheet(page, 'INV-20604', /^Refund$/)
  await sheetButton(page, /^By item$/).click()
  await sleep(200)
  txt = await sheetText(page)
  ok(txt.includes('Tax on selected items is refunded proportionally.'), 'by-item note', txt)
  const itemRows = sheet(page).locator('button', { hasText: /\$/ })
  ok(await submitBtn(page).isDisabled(), 'by-item refund is blocked until an item is picked')
  await sheet(page)
    .locator('button', { hasText: 'Interior' })
    .first()
    .click()
    .catch(async () => itemRows.nth(1).click())
  await sheetButton(page, /^Store credit$/).click()
  txt = await sheetText(page)
  ok(
    txt.includes('This refund') && txt.includes('’s credit after'),
    'refund sheet shows the credit-after row for store credit',
    txt,
  )
  await shot(page, '15-sheet-refund-items')
  const t6 = await submit(page, /^Refunded/)
  ok(/^Refunded \$\d+\.\d{2} to store credit$/.test(t6), 'by-item refund to store credit toast', t6)
  v = await settled(page)
  ok(
    v.detail?.ledger[0]?.title === 'Refund · to store credit',
    'ledger: refund to store credit',
    v.detail?.ledger[0]?.title,
  )
  ok(
    v.detail?.ledger[0]?.meta && !v.detail.ledger[0].meta.includes('Awaiting'),
    'a credit refund does not await Squarespace',
  )
  await reloadAndCompare(page, 'INV-20604 refunded after reload', { range: '7d', select: 'INV-20604' })

  v = await openSheet(page, 'INV-20606', /^Refund$/)
  await sheetButton(page, /^Custom$/).click()
  await sheet(page).locator('input').first().fill('10')
  await sleep(150)
  txt = await sheetText(page)
  ok(
    txt.includes('Within your $1,000 limit as Management + Accounting.'),
    "limit text names the person's roles and the highest limit",
    txt,
  )
  ok(txt.includes('Card refunds are completed in Squarespace'), 'card refunds mention Squarespace')
  const t7 = await submit(page, /^Refunded/)
  ok(/^Refunded \$10\.00 to /.test(t7), 'custom refund toast', t7)
  v = await settled(page)
  ok(
    v.detail?.status === 'Refund pending',
    'a card refund awaiting Squarespace reads "Refund pending"',
    v.detail?.status,
  )
  ok(v.detail?.ledger[0]?.meta.endsWith('Awaiting Squarespace'), 'refund meta shows Awaiting Squarespace')
  await page.locator('aside button', { hasText: 'Confirm in Squarespace' }).click()
  const t7b = await waitToast(page, /confirmed in Squarespace/)
  eq(t7b, 'Refund confirmed in Squarespace · $10.00', 'refund confirm toast')
  v = await waitFor(
    () => scrape(page),
    (x) => x.detail?.status === 'Partially refunded',
    5000,
  )
  eq(v.detail?.status, 'Partially refunded', 'after confirming the refund the status is Partially refunded')
  await openSheet(page, 'INV-20606', /^Refund$/)
  await sheetButton(page, /^Custom$/).click()
  await sheetButton(page, /^Cash$/).click()
  await sheet(page).locator('input').first().fill('5')
  const t7c = await submit(page, /^Refunded/)
  eq(t7c, 'Refunded $5.00 to cash', 'custom refund in cash')
  await reloadAndCompare(page, 'INV-20606 after refunds', { range: '7d', select: 'INV-20606' })

  // -- refund over what was paid by card, and over the refundable amount ---------------------------------------------------
  await openSheet(page, 'INV-20606', /^Refund$/)
  await sheetButton(page, /^Custom$/).click()
  await sheet(page).locator('input').first().fill('100000')
  await sleep(150)
  txt = await sheetText(page)
  ok(
    txt.includes('More than the refundable amount.') || txt.includes('was paid by card'),
    'an impossible refund explains itself',
    txt,
  )
  ok(await submitBtn(page).isDisabled(), 'an impossible refund cannot be submitted')
  await sheet(page).getByRole('button', { name: 'Cancel', exact: true }).click()

  await refundCapsAgainstServer(page)

  // -- adjust: percent discount with settlement as store credit, surcharge in dollars ------------------------------------
  v = await openSheet(page, 'INV-20608', /^Adjust$/)
  await sheetButton(page, /^%$/).click()
  await sheet(page).locator('input').first().fill('10')
  await sleep(150)
  txt = await sheetText(page)
  ok(txt.includes('Percent of services'), 'percent unit label')
  ok(
    txt.includes('Discount (pre-tax)−$54.00') &&
      txt.includes('New total$520.02') &&
      txt.includes('Overpaid — returned as store credit$57.78'),
    'adjust preview (cents math)',
    txt,
  )
  await shot(page, '16-sheet-adjust')
  const t8 = await submit(page, /^Discount applied/)
  eq(t8, 'Discount applied · new total $520.02', 'adjust toast uses the server total')
  v = await settled(page)
  ok(
    v.detail?.ledger
      .slice(0, 2)
      .map((e) => e.title)
      .join('|') === 'Refund · to store credit|Discount · Service recovery',
    'ledger: settlement refund to store credit and the discount',
    v.detail?.ledger.map((e) => e.title),
  )
  await reloadAndCompare(page, 'INV-20608 adjusted after reload', { range: '7d', select: 'INV-20608' })

  v = await openSheet(page, 'INV-20607', /^Adjust$/)
  await sheetButton(page, /^Surcharge$/).click()
  await sheet(page).locator('input').first().fill('15')
  await sleep(150)
  txt = await sheetText(page)
  ok(txt.includes('Surcharge (pre-tax)$15.00'), 'surcharge preview', txt)
  const t8b = await submit(page, /^Surcharge applied/)
  ok(/^Surcharge applied · new total \$/.test(t8b), 'surcharge toast', t8b)
  await openSheet(page, 'INV-20607', /^Adjust$/)
  await sheet(page).locator('input').first().fill('100000')
  await sleep(150)
  txt = await sheetText(page)
  ok(
    /Over your \$500 limit as Management \+ Accounting|Over your \$250 limit/.test(txt) ||
      txt.includes('Discount is larger') ||
      txt.includes('Over your'),
    'over-limit adjust is blocked with the design wording',
    txt,
  )
  ok(await submitBtn(page).isDisabled(), 'over-limit adjust cannot be submitted (no approval path)')
  await sheet(page).getByRole('button', { name: 'Cancel', exact: true }).click()

  // -- issue credit, send receipt -----------------------------------------------------------------------------------------
  v = await openSheet(page, 'INV-20606', /^Issue credit$/)
  await sheet(page).locator('input').first().fill('20')
  await sheetButton(page, /^Goodwill$/).click()
  await sheetButton(page, /^30 days$/).click()
  txt = await sheetText(page)
  ok(txt.includes('Issuing+$20.00'), 'credit preview', txt)
  const t9 = await submit(page, /credit issued/)
  eq(t9, '$20.00 credit issued to Liam Chen', 'issue credit toast')
  v = await settled(page)
  eq(v.detail?.creditLine, 'Liam has $20.00 in store credit', 'credit line after issuing')
  ok(
    v.detail?.ledger[0]?.meta.includes('Expires: 30 days'),
    'credit meta shows the expiry',
    v.detail?.ledger[0]?.meta,
  )
  const rcpt = page.waitForResponse((r) => r.url().includes('/receipt') && r.request().method() === 'POST')
  await page.locator('aside button', { hasText: 'Send receipt' }).click()
  const rr = await (await rcpt).json()
  const tr = await waitToast(page, /Receipt/)
  const expectReceipt =
    rr.sms === 'queued' && rr.email === 'queued'
      ? 'Receipt sent to Liam Chen via SMS + email'
      : rr.sms === 'queued'
        ? 'Receipt sent to Liam Chen via SMS'
        : rr.email === 'queued'
          ? 'Receipt sent to Liam Chen via email'
          : 'Receipt not sent · Liam Chen has no SMS or email to reach'
  eq(tr, expectReceipt, 'receipt toast follows what the server queued (SMS wording)')
  ok(!/WhatsApp/.test(tr), 'no WhatsApp wording in the receipt toast')
  await reloadAndCompare(page, 'INV-20606 after credit and receipt', { range: '7d', select: 'INV-20606' })

  // -- full refund to the original payment by Management: one in a day-old invoice (card, awaiting) -----------------------
  v = await setRange(page, '30 days')
  const old = (await apiList(page, '30d')).find((r: any) => r.label === 'INV-20600')!
  v = await openSheet(page, 'INV-20600', /^Refund$/)
  txt = await sheetText(page)
  ok(txt.includes('Refundable') && txt.includes('This refund'), 'full refund sheet', txt)
  const t10 = await submit(page, /^Refunded/)
  ok(/^Refunded \$/.test(t10), 'full refund toast', t10)
  void old

  // -- Accounting with a low limit: over-limit refund -> pending; another person approves / denies ------------------------
  section('write: over-limit refunds, approvals')
  await api(admin.page, 'PUT', `/roles/${acct.id}/limits/refund`, { value: 50 })
  try {
    await daniel.page.reload()
    await daniel.page.waitForSelector('#dc-root .sc-host')
    await settled(daniel.page)
    const dcmds = recordCommands(daniel.page)
    await setRange(daniel.page, '30 days')
    for (const [id, amount, noteOk] of [
      ['INV-20602', '80', true],
      ['INV-20601', '60', true],
    ] as const) {
      await openSheet(daniel.page, id, /^Refund$/)
      await sheetButton(daniel.page, /^Custom$/).click()
      await sheet(daniel.page).locator('input').first().fill(amount)
      await sleep(150)
      txt = await sheetText(daniel.page)
      ok(
        txt.includes(`Over your $50 limit as Accounting. This will be sent for approval.`),
        `${id}: over-limit wording`,
        txt,
      )
      ok(txt.includes(`Request approval · $${amount}.00`), `${id}: submit label`, txt)
      if (id === 'INV-20602') await shot(daniel.page, '17-sheet-over-limit')
      const t = await submit(daniel.page, /Sent for approval/)
      eq(t, `Sent for approval · $${amount}.00`, `${id}: pending toast`)
      void noteOk
    }
    const dv = await settled(daniel.page)
    ok(dv.detail?.status === 'Refund pending', 'requester sees Refund pending', dv.detail?.status)
    const own = dv.detail?.ledger.find((e) => e.buttons.includes('Approve'))
    eq(
      own?.note,
      'Needs a role with a refund limit of at least $60.',
      'requester cannot approve: needs a higher limit',
    )
    const n0 = dcmds.length
    await daniel.page.locator('aside button', { hasText: 'Approve' }).click()
    const tb = await waitToast(daniel.page, /Your role can/)
    eq(tb, 'Your role can’t approve $60.00', 'blocked approve shows the design toast')
    eq(dcmds.length, n0, 'blocked approve did not call the API')
    await shot(daniel.page, '18-daniel-pending')
    eq(
      dcmds.filter((c) => c.url.endsWith('/refunds')).length,
      2,
      'two refund requests went out, each with its own key',
    )
    eq(
      new Set(dcmds.filter((c) => c.url.endsWith('/refunds')).map((c) => c.key)).size,
      2,
      'distinct Idempotency-Keys per sheet',
    )

    // SSE: Management's page (open on INV-20602 after a click) updates without reload
    await setRange(page, '30 days')
    v = await clickRow(page, 'INV-20602')
    const seenPending = await waitFor(
      () => scrape(page),
      (x) => !!x.detail?.ledger.some((e) => e.buttons.includes('Approve')),
      12_000,
    )
    ok(
      seenPending.detail?.ledger.some((e) => e.buttons.includes('Approve')),
      'Management sees the pending request that Accounting made',
    )
    ok(
      /refunds awaiting approval/.test(seenPending.banner),
      'banner counts two requests (plural)',
      seenPending.banner,
    )
    await shot(page, '19-management-sees-pending')
    // approve the seeded one first, then the requests
    await page.getByRole('button', { name: 'Review', exact: true }).click()
    await sleep(500)
    v = await settled(page)
    ok(
      v.detail?.ledger.some((e) => e.buttons.includes('Approve')),
      'Review lands on an invoice with a pending refund',
    )
    const reviewId = v.detail!.head.split(' · ')[0]!
    await page.locator('aside button', { hasText: 'Approve' }).click()
    const ta = await waitToastNew(page, /Refund approved/, v.toast)
    ok(/^Refund approved · \$\d+\.\d{2} to /.test(ta), 'approve toast', ta)
    v = await waitFor(
      () => scrape(page),
      (x) => !x.detail?.ledger.some((e) => e.buttons.includes('Approve')),
      6000,
    )
    ok(
      v.detail?.ledger.some((e) => /Approved by Rafael M\./.test(e.meta)),
      `${reviewId}: approved by the approver, not the requester`,
      v.detail?.ledger.map((e) => e.meta),
    )
    await shot(page, '20-approved')
    const left = await waitFor(
      () => scrape(page),
      (x) => /^2 refunds awaiting approval/.test(x.banner),
      8000,
    )
    ok(
      /^2 refunds awaiting approval/.test(left.banner),
      'banner drops from three requests to two (plural kept)',
      left.banner,
    )
    // deny the next one (the oldest request is first)
    await page.getByRole('button', { name: 'Review', exact: true }).click()
    await sleep(500)
    v = await settled(page)
    const denyId = v.detail!.head.split(' · ')[0]!
    await page.locator('aside button', { hasText: 'Deny' }).click()
    const td = await waitToastNew(page, /denied/, v.toast)
    eq(td, 'Refund request denied', 'deny toast')
    v = await waitFor(
      () => scrape(page),
      (x) => /^1 refund awaiting approval/.test(x.banner),
      8000,
    )
    ok(/^1 refund awaiting approval/.test(v.banner), 'banner drops to the singular', v.banner)
    ok(
      v.detail?.ledger.some((e) => e.title.startsWith('Refund denied')),
      `${denyId}: ledger shows Refund denied`,
    )
    // approve the last one
    await page.getByRole('button', { name: 'Review', exact: true }).click()
    await sleep(500)
    v = await settled(page)
    await page.locator('aside button', { hasText: 'Approve' }).click()
    const ta2 = await waitToastNew(page, /Refund approved/, v.toast)
    ok(/^Refund approved · \$\d+\.\d{2} to /.test(ta2), 'second approve toast', ta2)
    v = await waitFor(
      () => scrape(page),
      (x) => x.banner === '',
      8000,
    )
    eq(v.banner, '', 'banner is gone when nothing is pending')
    await reloadAndCompare(page, 'after approve and deny', { range: '30d', select: 'INV-20602' })

    // Accounting's page followed through SSE
    const dv2 = await waitFor(
      () => scrape(daniel.page),
      (x) => x.banner === '',
      12_000,
    )
    eq(dv2.banner, '', "Accounting's open page lost its banner through the live stream")
  } finally {
    await api(admin.page, 'PUT', `/roles/${acct.id}/limits/refund`, { value: 500 })
  }

  // -- CSV --------------------------------------------------------------------------------------------------------------
  section('write: CSV')
  await setRange(page, '30 days')
  await page
    .getByRole('button', { name: /^Refunds\s*\d*$/ })
    .first()
    .click()
  await page.locator('input[placeholder^="Search client"]').fill('a')
  await sleep(700)
  v = await settled(page)
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click()
  const download: Download = await dl
  const file = await download.path()
  const csv = fs.readFileSync(file, 'utf8')
  const sum = (await api(page, 'GET', '/payments/summary?range=30d')).body
  eq(download.suggestedFilename(), `oasis-invoices_${sum.range.from}_${sum.range.to}.csv`, 'CSV filename')
  ok(
    csv.startsWith(
      '﻿Invoice,Date,Time,Client,Vehicle,Staff,Items,Tip,Adjustments,Subtotal,Tax,Total,Paid,Credit applied,Refunded,Refund pending,Balance,Credits issued,Net revenue,Status',
    ),
    'CSV header with BOM',
  )
  const lines = csv.split('\r\n').filter(Boolean)
  eq(lines.length - 1, v.rows.length, 'CSV has one line per visible row (range, filter and search apply)')
  const tcsv = await waitToast(page, /CSV export started/)
  eq(tcsv, `CSV export started · ${plural(v.rows.length, 'invoice')}`, 'CSV toast keeps the count')
  const ids = lines.slice(1).map((l) => l.split(',')[0])
  eq(
    ids,
    v.rows.map((r) => r.id),
    'CSV rows are the visible rows in order',
  )

  // -- live update across browsers ----------------------------------------------------------------------------------------
  section('write: two browsers')
  await page.locator('input[placeholder^="Search client"]').fill('')
  await page
    .getByRole('button', { name: /^All\s*\d*$/ })
    .first()
    .click()
  v = await clickRow(page, 'INV-20600')
  const beforeLedger = v.detail!.ledger.length
  await daniel.page.reload()
  await daniel.page.waitForSelector('#dc-root .sc-host')
  await setRange(daniel.page, '30 days')
  await openSheet(daniel.page, 'INV-20600', /^Issue credit$/)
  await sheet(daniel.page).locator('input').first().fill('5')
  await submit(daniel.page, /credit issued/)
  const live = await waitFor(
    () => scrape(page),
    (x) => (x.detail?.ledger.length ?? 0) > beforeLedger,
    12_000,
  )
  ok(
    (live.detail?.ledger.length ?? 0) > beforeLedger,
    "Management's open page showed Accounting's new credit through SSE (no reload)",
  )
  ok(
    /has \$5\.00 in store credit/.test(live.detail?.creditLine ?? ''),
    'credit line updated live',
    live.detail?.creditLine,
  )
  await shot(page, '21-live-update')
  await compareAll(page, 'after the live update', { range: '30d' })

  for (const x of [admin, rafael, daniel]) await x.ctx.close()
}

// ---- phase: roles ---------------------------------------------------------------------------------------------------

async function phaseRoles(browser: Browser): Promise<void> {
  section('roles: Support')
  // the route gate answers from the session before the screen mounts: the Payments "No payment access" card
  const sofia = await open(browser, EMAILS.support, '/payments', false)
  await sleep(1500)
  const body = ((await sofia.page.locator('body').textContent()) ?? '').replace(/\s+/g, ' ')
  ok(body.includes('No payment access'), 'Support sees the locked card')
  ok(
    body.includes('The Customer Support role doesn\'t include "View payment reports"'),
    'locked card wording',
    body.slice(0, 300),
  )
  eq(
    await sofia.page.locator('#dc-root .sc-host').count(),
    0,
    'the Payments screen is not mounted for Support',
  )
  await shot(sofia.page, '30-support-locked')
  eq(
    sofia.requests.filter((r) => /\/(payments|invoices)\b/.test(r)),
    [],
    'Support never calls the payments API (the screen is locked from the session)',
  )
  const direct = await api(sofia.page, 'GET', '/payments/summary?range=7d')
  eq(direct.status, 403, 'the server also refuses Support')
  await sofia.ctx.close()
  let v: View

  section('roles: Accounting')
  const daniel = await open(browser, EMAILS.accounting)
  v = await settled(daniel.page)
  ok(!v.previewAs, 'Accounting has no "Preview as"')
  await openSheet(daniel.page, v.rows[0]!.id, /^Refund$/).catch(() => undefined)
  const dtxt = await sheetText(daniel.page)
  ok(
    /as Accounting/.test(dtxt) && /\$500 limit/.test(dtxt),
    'Accounting sees its own role and $500 limit in the refund sheet',
    dtxt,
  )
  await shot(daniel.page, '31-accounting-sheet')
  await daniel.ctx.close()

  section('roles: Super Admin view-as')
  const amara = await open(browser, EMAILS.superAdmin)
  const page = amara.page
  v = await settled(page)
  ok(v.previewAs, 'Super Admin sees "Preview as"')
  await page.getByRole('button', { name: /Preview as/ }).click()
  await sleep(300)
  const menu = ((await page.locator('[data-live-menu="viewas"]').textContent()) ?? '').replace(/\s+/g, ' ')
  ok(
    /Super Admin.*refunds no limit/.test(menu) &&
      /Management.*refunds ≤ \$1000/.test(menu) &&
      /Customer Support.*refunds ≤ \$50/.test(menu) &&
      /Crew.*refunds ≤ \$25/.test(menu),
    'view-as menu lists every role with its refund limit text',
    menu,
  )
  await shot(page, '32-view-as-menu')
  const reqBefore = amara.requests.length
  await page.locator('[data-live-menu="viewas"] button', { hasText: /^Crew/ }).click()
  await page.waitForSelector('text=No payment access', { timeout: 10_000 })
  const cardText = ((await page.locator('body').textContent()) ?? '').replace(/\s+/g, ' ')
  ok(
    cardText.includes('The Crew role doesn\'t include "View payment reports"'),
    'view-as Crew: the locked card names the viewed role',
    cardText.slice(0, 300),
  )
  await shot(page, '33-view-as-crew')
  await sleep(1200)
  eq(
    amara.requests.slice(reqBefore).filter((r) => /\/(payments|invoices)\b/.test(r)),
    [],
    'no payments request while locked in view-as',
  )
  // the route gate card has no header: the way back is another screen, where the "Viewing as" bar has Exit
  await page.getByRole('link', { name: 'Operations', exact: true }).click()
  await page.waitForSelector('#dc-root .sc-host', { timeout: 20_000 })
  await sleep(800)
  const opsBar = ((await page.locator('body').textContent()) ?? '').replace(/\s+/g, ' ')
  ok(
    opsBar.includes('Viewing as Crew'),
    'Operations shows the persistent "Viewing as Crew" bar',
    opsBar.slice(0, 200),
  )
  await shot(page, '33b-view-as-crew-operations')
  await page.getByRole('button', { name: 'Exit', exact: true }).click()
  await page.waitForFunction(() => !document.body.textContent?.includes('Viewing as'), undefined, {
    timeout: 10_000,
  })
  await page.goto(`${stack.webUrl}/payments`)
  await page.waitForSelector('#dc-root .sc-host')
  await settled(page)
  await page.getByRole('button', { name: /Preview as/ }).click()
  await page.locator('[data-live-menu="viewas"] button', { hasText: /^Management/ }).click()
  v = await waitFor(
    () => scrape(page),
    (x) => !x.locked && x.rows.length > 0 && x.viewAsBar.includes('Management'),
    10_000,
  )
  ok(
    !v.locked && v.viewAsBar.includes('Viewing as Management'),
    'view-as Management unlocks with the bar',
    v.viewAsBar,
  )
  await settled(page)
  const d = (await openSheet(page, v.rows[0]!.id, /^Refund$/).catch(() => null)) ?? null
  void d
  const mtxt = await sheetText(page)
  ok(
    /as Management\./.test(mtxt) && /\$1,000 limit/.test(mtxt),
    'sheets use the viewed role and its limit',
    mtxt,
  )
  await shot(page, '34-view-as-management')
  await sheet(page).getByRole('button', { name: 'Cancel', exact: true }).click()
  // exit through the bar
  await page.getByRole('button', { name: 'Exit', exact: true }).click()
  v = await waitFor(
    () => scrape(page),
    (x) => x.viewAsBar === '' && x.rows.length > 0,
    10_000,
  )
  eq(v.viewAsBar, '', 'Exit removes the bar')
  const mtxt2 = await (async () => {
    await openSheet(page, v.rows[0]!.id, /^Refund$/).catch(() => undefined)
    return sheetText(page)
  })()
  ok(/as Super Admin/.test(mtxt2) && /no limit/.test(mtxt2), 'back to Super Admin: no limit', mtxt2)
  await amara.ctx.close()
}

// ---- main -----------------------------------------------------------------------------------------------------------

const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--font-render-hinting=none'] })
let crashed: unknown = null
try {
  if (phase === 'read' || phase === 'all') await phaseRead(browser)
  if (phase === 'write' || phase === 'all') await phaseWrite(browser)
  if (phase === 'roles' || phase === 'all') await phaseRoles(browser)
} catch (e) {
  crashed = e
  console.log('\nCRASH', e instanceof Error ? (e.stack ?? e.message) : e)
  await (lastPage as Page | null)
    ?.screenshot({ path: path.join(shots, '99-crash.png') })
    .catch(() => undefined)
} finally {
  await browser.close()
}

section('summary')
const provoked = new Set([
  'rafael@oasisautospa.com: 422 POST /api/v1/invoices/:id/payments', // the link on a host that is not allowed
  'sofia@oasisautospa.com: 403 GET /api/v1/payments/summary', // the direct call that proves the server refuses Support
])
const unexpected4xx = client4xx.filter((x) => !provoked.has(x))
for (const x of unexpected4xx) console.log('  unexpected API 4xx:', x)
console.log(
  `  API 4xx seen: ${client4xx.length} (${client4xx.length - unexpected4xx.length} provoked on purpose)`,
)
if (unexpected4xx.length) failures.push('unexpected API 4xx: ' + unexpected4xx.join('; '))
for (const e of pageErrors) console.log('  page error:', e.slice(0, 300))
for (const b of apiBad) console.log('  api 5xx:', b)
console.log(
  `${passed} checks passed, ${failures.length} failed, ${pageErrors.length} page errors, ${apiBad.length} API 5xx`,
)
for (const f of failures) console.log('  - ' + f.slice(0, 300))
process.exit(failures.length || pageErrors.length || apiBad.length || crashed ? 1 : 0)
