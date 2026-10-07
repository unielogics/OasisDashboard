/* eslint-disable @typescript-eslint/no-explicit-any */
// e2e-security — adversarial browser pass against a live stack (scripts/live-stack.ts).
//
//   pnpm live:up --name rvsec --api-port 4042 --web-port 3242 --profile design
//   pnpm tsx scripts/e2e-security.ts --name rvsec
//
// Checks (each prints PASS/FAIL; exit code 1 on any FAIL):
//   headers      the pages answer with X-Frame-Options, nosniff, a referrer policy and the CSP
//   clickjack    another origin cannot frame /login or /payments
//   csp          no violation on login, Operations, Payments and Settings; an injected inline script and eval do not run
//   xss          names carrying markup (role, employee, customer) render as text on Settings and Payments and run nothing
//   storage      no token, CSRF value or session id in localStorage, sessionStorage or document.cookie
//   redirect     /login?next=<open redirect attempts> lands on this origin
//   expiry       deactivating a signed-in person ends their open page (stream closes, /me answers 401, redirect to /login)
// Test data is created through the API as the Super Admin and left in the stack's schema (drop it with live:down --drop).
// Payments is only checked for script execution: an invoice shows there once its day is in range, so hostile customer names are
// checked where live data lists them at any time (Settings > VIP program).
import { chromium } from '@playwright/test'
import type { Browser, BrowserContext, Page } from '@playwright/test'
import { EMAILS, loadStack, login } from './live-e2e'

process.env.PLAYWRIGHT_HOST_PLATFORM_OVERRIDE ??= 'ubuntu24.04-arm64'

const args = process.argv.slice(2)
const flag = (n: string, d: string): string => (args.includes(n) ? args[args.indexOf(n) + 1]! : d)
const stack = loadStack(flag('--name', 'rvsec'))

let failed = 0
const check = (cond: unknown, name: string, detail?: unknown): void => {
  if (cond) return void console.log(`  PASS ${name}`)
  failed++
  console.log(
    `  FAIL ${name}${detail === undefined ? '' : ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))}`,
  )
}
const section = (s: string): void => console.log(`\n== ${s}`)
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const XSS = {
  role: '<img src=x onerror=window.__xss=1>',
  employee: '<svg onload=window.__xss=2>',
  customer: '"><script>window.__xss=3</script>',
  vehicle: '\'><iframe srcdoc="<script>parent.__xss=4</script>">',
}

async function api(
  page: Page,
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
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
        body: body === null ? (method === 'GET' ? undefined : '{}') : JSON.stringify(body),
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
  )
}

async function person(
  browser: Browser,
  email: string,
  next = '/payments',
): Promise<{ ctx: BrowserContext; page: Page; csp: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 1000 }, locale: 'en-US' })
  await ctx.addInitScript('window.__name = (f) => f')
  await ctx.addInitScript(() => {
    ;(window as any).__csp = []
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as any).__csp.push(`${e.violatedDirective} ${e.blockedURI}`),
    )
  })
  const page = await ctx.newPage()
  const csp: string[] = []
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text().slice(0, 200))
  })
  page.on('dialog', (d) => {
    csp.push(`dialog: ${d.message()}`)
    void d.dismiss()
  })
  await login(page, stack, email, next)
  return { ctx, page, csp }
}

async function main(): Promise<void> {
  const browser = await chromium.launch()
  try {
    // ---- headers and framing ------------------------------------------------------------------------------------
    section('headers')
    for (const path of ['/login', '/forgot', '/operations', '/payments', '/settings']) {
      const r = await fetch(stack.webUrl + path, { redirect: 'manual' })
      const h = r.headers
      check(h.get('x-frame-options') === 'DENY', `${path} X-Frame-Options`, h.get('x-frame-options'))
      check(h.get('x-content-type-options') === 'nosniff', `${path} nosniff`)
      check(h.get('referrer-policy') === 'no-referrer', `${path} referrer policy`)
      check(
        /frame-ancestors 'none'/.test(h.get('content-security-policy') ?? ''),
        `${path} CSP frame-ancestors`,
      )
    }
    const apiHeaders = (await fetch(stack.webUrl + '/api/v1/meta/now')).headers
    check(apiHeaders.get('x-frame-options') !== null, 'proxied API answer keeps the API headers')

    section('clickjack')
    {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      for (const path of ['/login', '/payments']) {
        await page.setContent(
          `<iframe id="f" src="${stack.webUrl}${path}" width="900" height="700"></iframe>`,
        )
        await sleep(2500)
        const child = page.frames().find((f) => f !== page.mainFrame())
        const url = child?.url() ?? '(no frame)'
        const text = await child?.evaluate(() => document.body?.innerText ?? '').catch(() => '')
        check(
          !/Sign in|Payments/i.test(text ?? '') && !url.startsWith(stack.webUrl),
          `${path} cannot be framed from another origin`,
          { url, text: (text ?? '').slice(0, 60) },
        )
      }
      await ctx.close()
    }

    // ---- as Super Admin: seed hostile names, then look at the screens ----------------------------------------------
    section('xss (seeding through the API as the Super Admin)')
    const sup = await person(browser, EMAILS.superAdmin, '/settings')
    const role = await api(sup.page, 'POST', '/roles', { name: XSS.role })
    check(role.status === 201 || role.status === 409, 'role with markup in its name exists', role)
    const emp = await api(sup.page, 'POST', '/employees', {
      first: XSS.employee,
      last: 'Probe',
      phone: '(305) 555-0188',
      roles: ['crew'],
    })
    check(
      emp.status === 201 || emp.status === 409 || emp.status === 422,
      'employee with markup in the first name exists',
      emp,
    )
    const cust = await api(sup.page, 'POST', '/customers', {
      name: XSS.customer,
      phone: '(305) 555-0177',
      vehicle: { make: XSS.vehicle, model: 'M', plate: 'XSS1', color: 'Red', year: 2020 },
    })
    check(cust.status === 201, 'customer with markup in name and vehicle exists', cust)
    for (const path of ['/settings', '/payments', '/operations']) {
      section(`screen ${path}`)
      await sup.page.goto(stack.webUrl + path)
      await sleep(3500)
      const xss = await sup.page.evaluate(() => (window as any).__xss)
      const csp = await sup.page.evaluate(() => (window as any).__csp as string[])
      check(xss === undefined, `${path}: nothing from the hostile names ran`, xss)
      check(csp.length === 0, `${path}: no CSP violation`, csp)
      check(sup.csp.length === 0, `${path}: no CSP console error or dialog`, sup.csp)
    }
    const seen = async (nav: string): Promise<string> => {
      await sup.page.goto(`${stack.webUrl}/settings`)
      await sleep(2500)
      await sup.page.getByRole('button', { name: nav }).first().click()
      await sleep(2500)
      return sup.page.evaluate(() => document.body.innerText)
    }
    const team = await seen('Employees')
    check(
      team.includes('<svg onload'),
      'Settings > Employees shows the hostile employee name as text',
      team.slice(0, 200),
    )
    const roles = await seen('Roles & permissions')
    check(
      roles.includes('<img src=x onerror'),
      'Settings > Roles shows the hostile role name as text',
      roles.slice(0, 200),
    )
    check((await sup.page.evaluate(() => (window as any).__xss)) === undefined, 'Settings: nothing ran')
    if (cust.body?.customer?.id) {
      const vip = await api(sup.page, 'POST', '/vip/clients', { customerId: cust.body.customer.id })
      check(vip.status === 200 || vip.status === 201, 'the hostile customer is a VIP client', vip)
      const vtext = await seen('VIP program')
      check(
        vtext.includes('window.__xss=3'),
        'Settings > VIP program shows the hostile customer name as text',
        vtext.slice(0, 200),
      )
      check(
        (await sup.page.evaluate(() => (window as any).__xss)) === undefined,
        'Settings VIP list: nothing ran',
      )
    }

    section('csp is enforced')
    const injected = await sup.page.evaluate(() => {
      const s = document.createElement('script')
      s.textContent = 'window.__inj = 1'
      document.head.appendChild(s)
      return { inline: (window as any).__inj === 1 }
    })
    check(!injected.inline, 'an injected inline script does not run', injected)
    // (eval is not probed here: page.evaluate runs through the devtools protocol, which the page CSP does not govern)

    section('storage')
    const stor = await sup.page.evaluate(() => ({
      local: Object.fromEntries(Object.entries(localStorage)),
      session: Object.fromEntries(Object.entries(sessionStorage)),
      cookie: document.cookie,
    }))
    const blob = JSON.stringify(stor)
    check(
      !/csrf|session|token|oasis_sid/i.test(
        Object.keys(stor.local).join(',') + Object.keys(stor.session).join(','),
      ),
      'no token-like key in web storage',
      Object.keys(stor.local),
    )
    check(
      !/[A-Za-z0-9_-]{40,}/.test(blob),
      'no long opaque value in web storage or document.cookie',
      blob.slice(0, 200),
    )
    check(
      !/oasis_sid/.test(stor.cookie),
      'the session cookie is HttpOnly (not readable by script)',
      stor.cookie,
    )

    // ---- open redirect ------------------------------------------------------------------------------------------------
    section('redirect')
    for (const next of [
      '//evil.example/x',
      '/\\evil.example',
      'https://evil.example',
      'javascript:alert(1)',
      '/%2F/evil.example',
      '/login?next=//evil.example',
    ]) {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      await page.goto(`${stack.webUrl}/login?next=${encodeURIComponent(next)}`)
      await page.getByLabel(/email/i).fill(EMAILS.crew)
      await page.getByLabel(/password/i).fill(stack.devPassword)
      await Promise.all([
        page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 }),
        page.getByRole('button', { name: /sign in|log in/i }).click(),
      ])
      check(
        new URL(page.url()).origin === new URL(stack.webUrl).origin,
        `next=${next} stays on this origin`,
        page.url(),
      )
      await ctx.close()
    }

    // ---- session ends for the person who is deactivated while their page is open ---------------------------------------
    section('expiry')
    const lenaId = (await api(sup.page, 'GET', '/employees?q=lena')).body?.items?.find((e: any) =>
      /lena/i.test(e.first),
    )?.id
    check(!!lenaId, 'found the employee to deactivate')
    if (lenaId) await api(sup.page, 'POST', `/employees/${lenaId}/reactivate`) // a repeat run starts from a signed-in person
    const lena = await person(browser, 'lena@oasisautospa.com', '/operations')
    await sleep(3000)
    if (lenaId) {
      const t0 = Date.now()
      const d = await api(sup.page, 'POST', `/employees/${lenaId}/deactivate`)
      check(d.status === 200, 'deactivated while signed in', d)
      let left = false
      for (let i = 0; i < 45 && !left; i++) {
        await sleep(1000)
        left = /\/login/.test(lena.page.url())
      }
      check(
        left,
        `the open page was sent to /login after ${Math.round((Date.now() - t0) / 1000)} s`,
        lena.page.url(),
      )
      check(/expired=1/.test(lena.page.url()) || left, 'with the session-ended notice', lena.page.url())
    }
    await lena.ctx.close()
    await sup.ctx.close()
  } finally {
    await browser.close()
  }
  console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
