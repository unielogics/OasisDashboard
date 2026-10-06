// parity:setup — smoke gate for the visual-parity toolchain.
// Serves the three ORIGINAL design bundles from design/original/ on localhost, renders each offline in
// headless Chromium (arm64) with a pinned timezone/locale/clock, and asserts the dc runtime mounted,
// the bundled fonts loaded, and the page is not blank. Writes screenshots to parity-reports/setup/.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const origDir = path.join(root, 'design', 'original')
const outDir = path.join(root, 'parity-reports', 'setup')
fs.mkdirSync(outDir, { recursive: true })

const FIXED_NOW = process.env.PARITY_FIXED_NOW ?? '2026-06-13T10:36:00-04:00'
const TZ = process.env.PARITY_TZ ?? 'America/New_York'
const SCREENS = ['operations', 'payments', 'settings']

const server = http.createServer((req, res) => {
  const name = path.basename((req.url ?? '/').split('?')[0])
  const file = path.join(origDir, name)
  if (!name.endsWith('.html') || !fs.existsSync(file)) {
    res.writeHead(404).end('not found')
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(fs.readFileSync(file))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

const browser = await chromium.launch({
  args: [
    '--disable-dev-shm-usage',
    '--force-color-profile=srgb',
    '--font-render-hinting=none',
    '--disable-lcd-text',
    ...(process.env.PARITY_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
  ],
})
let failed = 0
try {
  for (const screen of SCREENS) {
    const ctx = await browser.newContext({
      viewport: { width: 1480, height: 1000 },
      deviceScaleFactor: 1,
      timezoneId: TZ,
      locale: 'en-US',
    })
    // Offline: only localhost may be reached.
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url())
      if (u.hostname === '127.0.0.1' || u.protocol === 'blob:' || u.protocol === 'data:') return route.continue()
      return route.abort()
    })
    const page = await ctx.newPage()
    await page.clock.install({ time: new Date(FIXED_NOW) })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`http://127.0.0.1:${port}/${screen}.bundle.html`, { waitUntil: 'load' })
    await page.waitForSelector('#dc-root .sc-host', { timeout: 20000 })
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => {
      const b = document.getElementById('__claude_design_branding')
      if (b) b.style.display = 'none'
    })
    await page.waitForTimeout(250)
    const info = await page.evaluate(() => ({
      // @font-face blocks load lazily, so assert that at least one face of each family actually loaded.
      manrope: [...document.fonts].some((f) => f.family.replace(/["']/g, '') === 'Manrope' && f.status === 'loaded'),
      bricolage: [...document.fonts].some(
        (f) => f.family.replace(/["']/g, '') === 'Bricolage Grotesque' && f.status === 'loaded',
      ),
      textLen: document.body.innerText.length,
      children: document.querySelectorAll('#dc-root *').length,
    }))
    const shot = path.join(outDir, `${screen}.png`)
    await page.screenshot({ path: shot, animations: 'disabled', caret: 'hide' })
    const ok = info.manrope && info.bricolage && info.textLen > 200 && info.children > 100 && errors.length === 0
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${screen}`, JSON.stringify(info), errors.length ? `errors=${errors.join(' | ')}` : '')
    if (!ok) failed++
    await ctx.close()
  }
} finally {
  await browser.close()
  server.close()
}
if (failed) {
  console.error(`parity:setup failed for ${failed} screen(s)`)
  process.exit(1)
}
console.log(`parity:setup OK — screenshots in ${path.relative(root, outDir)}`)
