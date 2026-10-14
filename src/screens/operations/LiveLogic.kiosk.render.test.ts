// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// The LIVE Operations template in kiosk mode (ADR 0180; DV-1003..DV-1006, DV-1008): no Payments or Settings tab and no
// "Manage" links on the kiosk, the chip and its menu, the employee picker (88 px name tiles, no preselection) and the
// "As Marco R. · Change" chip; for a person signed in on a kiosk device, the bar. A signed-in person sees today's header.
import fs from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compileScreens } from '../../../tools/dc-compile/compile'
import { root } from '../../../tools/dc-compile/tests/original-runtime'
import { makeKioskSession } from '@/auth/test-fixtures'
import { FILES, makeLive, makeSession, stubPort } from './live-testkit'

const tmp = path.join(root, 'tools/dc-compile/tests/.tmp-snippets/operations-kiosk-render')
const text = (v: string | Buffer | undefined): string => (Buffer.isBuffer(v) ? v.toString('utf8') : (v ?? ''))
let render: (vals: any, ctx: { name: string }) => any

beforeAll(async () => {
  const out = compileScreens(['operations'], { root, variant: 'live', tplIds: false, allowComplexExpr: false })
  const dir = path.join(tmp, 'gen')
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, buf] of Object.entries(out.perScreen.operations!)) fs.writeFileSync(path.join(dir, name), text(buf))
  const mod = await import(/* @vite-ignore */ path.join(dir, 'operations.tsx'))
  render = mod.default
})
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

const html = (vals: any) => renderToStaticMarkup(render(vals, { name: 'operations' }))

async function live(session = makeKioskSession()) {
  const l = makeLive(session, stubPort())
  l.vals()
  await l.settle()
  return l
}

describe('Operations live template in kiosk mode', () => {
  it('a signed-in person: Payments and Settings tabs and the Manage links, as designed', async () => {
    const l = await live(makeSession({ role: 'mgmt' }))
    const h = html(l.vals())
    expect(h).toContain('href="/payments"')
    expect(h).toContain('href="/settings"')
    expect(h).not.toContain('data-kiosk-picker')
    expect(h).not.toContain('signs out after 15 minutes')
  })

  it('the kiosk: only Operations, the tablet chip, no Manage link (DV-1003, DV-1004)', async () => {
    const l = await live()
    const h = html(l.vals())
    expect(h).not.toContain('href="/payments"')
    expect(h).not.toContain('href="/settings"')
    expect(h).not.toContain('href="/settings#emergency"')
    expect(h).toContain('Front desk tablet')
    expect(h).toContain('Opened by Marco R. · Locks at 9:00 PM')
    expect(h).toContain('>K<')
    l.chrome.toggleUserMenu()
    const menu = html(l.vals())
    expect(menu).toContain('Lock kiosk')
    expect(menu).toContain('Manager sign-in')
    expect(menu).toContain('Opened by Marco R. at 7:58 AM · locks 9:00 PM')
    expect(menu).not.toContain('>Sign out<')
    expect(menu).not.toContain('Kiosk…')
    l.vals().live.menu.signOut()
    const confirm = html(l.vals())
    expect(confirm).toContain('Lock the kiosk now? A PIN opens it again.')
    expect(confirm).not.toContain('Lock kiosk')
  })

  it('the picker: the question, a tile per name (88 px), Cancel; nothing preselected (DV-1005)', async () => {
    const l = await live()
    void l.chrome.picker.pick({ title: 'Who’s putting Maria’s Camry in Bay 2?' })
    const h = html(l.vals())
    expect(h).toContain('data-kiosk-picker="1"')
    expect(h).toContain('role="dialog"')
    expect(h).toContain('Who’s putting Maria’s Camry in Bay 2?')
    expect(h).toContain('Tap your name')
    for (const n of ['Marco R.', 'Lena K.', 'Sofia P.']) expect(h).toContain('>' + n + '<')
    expect(h.match(/data-kiosk-tile="1"/g)).toHaveLength(3)
    expect(h).toContain('min-height:88px')
    expect(h).toContain('z-index:80')
    expect(h).not.toMatch(/data-kiosk-tile="1"[^>]*aria-pressed="true"/)
    l.chrome.picker.cancel()
    expect(html(l.vals())).not.toContain('data-kiosk-picker')
  })

  it('“As Marco R. · Change” over the composer, checklist, add-ons and photos of the open file (DV-1006)', async () => {
    const l = await live()
    const id = (FILES.late as any).id as string
    for (const tab of ['messages', 'checklist', 'addons', 'photos']) {
      l.logic.select(id, tab)
      l.vals()
      await l.settle()
      expect(html(l.vals()), tab).not.toContain('As Marco R.')
      const p = l.chrome.picker.pick({ title: 'x', sticky: id })
      l.chrome.picker.choose('emp-marco')
      await p
      const h = html(l.vals())
      expect(h, tab).toContain('As Marco R.')
      expect(h, tab).toContain('>Change<')
      l.chrome.picker.forget(id)
    }
  })

  it('a person signed in on a kiosk tablet: the bar under the header (DV-1008)', async () => {
    const l = await live(makeSession({ role: 'mgmt', kioskDevice: { id: 'dev-1', name: 'Front desk tablet' } }))
    const h = html(l.vals())
    expect(h).toContain('Signed in as Rafael M. on Front desk tablet · signs out after 15 minutes without use')
    expect(h).toContain('href="/settings"')
  })
})
