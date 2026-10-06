// live:smoke — signs in through the real /login page of a running live stack and visits the three screens.
//   pnpm live:up --name smoke && pnpm live:smoke --name smoke [--as manager|superAdmin|crew|support|accounting]
// Asserts each screen mounts (#dc-root .sc-host), prints page errors and failed API calls, writes screenshots to
// parity-reports/live-smoke/. Exit code 1 on any page error, API 5xx or missing mount.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { EMAILS, login, loadStack } from './live-e2e'

const args = process.argv.slice(2)
const flag = (n: string, d: string) => (args.includes(n) ? args[args.indexOf(n) + 1]! : d)
const stack = loadStack(flag('--name', 'smoke'))
const who = flag('--as', 'manager') as keyof typeof EMAILS
const out = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'parity-reports', 'live-smoke')
fs.mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--font-render-hinting=none'] })
let failed = 0
try {
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 1000 }, timezoneId: 'America/New_York', locale: 'en-US' })
  const page = await ctx.newPage()
  const errors: string[] = []
  const bad: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))
  page.on('response', (r) => {
    if (r.url().startsWith(stack.webUrl + '/api/') && r.status() >= 500) bad.push(`${r.status()} ${r.request().method()} ${r.url()}`)
  })
  await login(page, stack, EMAILS[who])
  for (const screen of ['operations', 'payments', 'settings']) {
    errors.length = 0
    await page.goto(`${stack.webUrl}/${screen}`, { waitUntil: 'load' })
    const mounted = await page
      .waitForSelector('#dc-root .sc-host', { timeout: 20_000 })
      .then(() => true)
      .catch(() => false)
    await page.waitForTimeout(800)
    const text = await page.evaluate(() => document.body.innerText.slice(0, 120).replace(/\s+/g, ' '))
    await page.screenshot({ path: path.join(out, `${who}-${screen}.png`) })
    const ok = mounted && errors.length === 0
    if (!ok) failed++
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${screen}${page.url().includes(screen) ? '' : ` (landed on ${new URL(page.url()).pathname})`} :: ${text}`)
    for (const e of errors) console.log('     ', e.slice(0, 300))
  }
  for (const b of bad) {
    failed++
    console.log('FAIL api', b)
  }
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
