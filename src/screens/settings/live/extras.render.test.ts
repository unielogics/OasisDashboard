// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// The LIVE Settings template (compiled with the live patches) rendered with the view model's real values in the three
// sections the design does not have: the nav buttons, the Packages note, each section's content and the Save bar of the
// reminders are in the DOM, and every root and handler the template binds exists.
import fs from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { compileScreens } from '../../../../tools/dc-compile/compile'
import { root } from '../../../../tools/dc-compile/tests/original-runtime'
import { makeExtrasLogic } from './extras-testkit'

const tmp = path.join(root, 'tools/dc-compile/tests/.tmp-snippets/settings-extras-render')
const text = (v: string | Buffer | undefined): string => (Buffer.isBuffer(v) ? v.toString('utf8') : (v ?? ''))
let render: (vals: any, ctx: { name: string }) => any
let bindings: { roots: string[]; handlers: string[]; paths: string[] }

beforeAll(async () => {
  process.env.TZ = 'America/New_York'
  const out = compileScreens(['settings'], { root, variant: 'live', tplIds: false, allowComplexExpr: false })
  const dir = path.join(tmp, 'gen')
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, buf] of Object.entries(out.perScreen.settings!)) fs.writeFileSync(path.join(dir, name), text(buf))
  const mod = await import(/* @vite-ignore */ path.join(dir, 'settings.tsx'))
  render = mod.default
  bindings = JSON.parse(text(out.perScreen.settings!['settings.bindings.json']))
})
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

const atPath = (vals: any, p: string): any => {
  let cur = vals
  for (const part of p.match(/[^.[\]]+/g) || []) {
    if (cur === null || cur === undefined) return undefined
    cur = cur[part]
  }
  return cur
}

/** Every live.* handler the template binds is a function wherever its list has items. */
function liveHandlersExist(vals: any, prefix: string): void {
  for (const h of bindings.handlers.filter((x) => x.startsWith(prefix))) {
    const parts = h.split('[]')
    if (parts.length === 1) {
      expect(typeof atPath(vals, h), h).toBe('function')
      continue
    }
    let lists: any[] = [vals]
    for (let i = 0; i < parts.length - 1; i++) {
      const next: any[] = []
      for (const l of lists) {
        const arr = atPath(l, parts[i]!.replace(/^\./, ''))
        if (Array.isArray(arr)) next.push(...arr)
      }
      lists = next
    }
    for (const item of lists) expect(typeof atPath(item, parts.at(-1)!.replace(/^\./, '')), h).toBe('function')
  }
}

async function shown(section: 'catalog' | 'categories' | 'reminders') {
  const t = makeExtrasLogic()
  t.logic.setState({ section })
  const flag = section === 'catalog' ? 'secCatalog' : section === 'categories' ? 'secCategories' : 'secReminders'
  await vi.waitFor(() => expect(t.logic.renderVals().live[flag]).toBe(true))
  if (section === 'reminders') await vi.waitFor(() => expect(t.logic.renderVals().live.rem.texts.length).toBe(3))
  return t
}

describe('Settings live template: Catalog, Categories, Reminders & texts', () => {
  it('the nav has the three buttons and Packages & checklists says where prices are edited', async () => {
    const t = makeExtrasLogic()
    t.logic.setState({ section: 'services' })
    await vi.waitFor(() => expect(t.logic.renderVals().live.secOpen).toBe(true))
    const html = renderToStaticMarkup(render(t.logic.renderVals(), { name: 'settings' }))
    expect(html).toContain('>Catalog</span>')
    expect(html).toContain('>Categories</span>')
    expect(html).toContain('>Reminders &amp; texts</span>')
    expect(html).toContain('Prices are set in Catalog')
    expect(html).toContain('Open Catalog')
    // the nav order: Packages, then Catalog and Categories; Arrival, then Reminders
    expect(html.indexOf('Packages &amp; checklists')).toBeLessThan(html.indexOf('>Catalog</span>'))
    expect(html.indexOf('Arrival &amp; check-in')).toBeLessThan(html.indexOf('>Reminders &amp; texts</span>'))
    for (const r of bindings.roots) expect(t.logic.renderVals(), r).toHaveProperty(r)
  })

  it('Catalog renders the list, the form, guest prices, the plans and the tint table', async () => {
    const t = await shown('catalog')
    const v = t.logic.renderVals()
    const html = renderToStaticMarkup(render(v, { name: 'settings' }))
    for (const s of [
      'Change prices only here',
      'Signature Hand Wash',
      'Booking charges $54 · 45 min',
      'Name on the website',
      'Member price ($)',
      'Empty: guests pay $54 (member price + 20%).',
      'VIP members',
      'Shown on the website',
      'Order on the website',
      'Guest prices',
      'Online booking fee for guests: $25',
      'Squarespace checkout link',
      'Window tint prices',
      'SUV / crossover · Carbon',
    ])
      expect(html, s).toContain(s)
    expect(html).not.toContain('Weekly schedule')
    liveHandlersExist(v, 'live.cat')
  })

  it('Categories renders each row with its swatches and the add button', async () => {
    const t = await shown('categories')
    const v = t.logic.renderVals()
    const html = renderToStaticMarkup(render(v, { name: 'settings' }))
    expect(html).toContain('Key wash · built in · 2 active services')
    expect(html).toContain('+ Add category')
    expect(html).toContain('value="Polish"')
    liveHandlersExist(v, 'live.cats')
  })

  it('Reminders renders every group, the preview and, once edited, the Save bar', async () => {
    const t = await shown('reminders')
    let v = t.logic.renderVals()
    let html = renderToStaticMarkup(render(v, { name: 'settings' }))
    for (const s of [
      'Appointment reminders',
      '24 hours before',
      'Preparation by category',
      'Status texts',
      'Running late',
      'Lead follow-up',
      'Preview',
      'Reply C to confirm',
    ])
      expect(html, s).toContain(s)
    expect(html).not.toContain('Unsaved changes to reminders and texts')
    liveHandlersExist(v, 'live.rem')
    v.live.rem.toggles[0].toggle()
    v = t.logic.renderVals()
    html = renderToStaticMarkup(render(v, { name: 'settings' }))
    expect(html).toContain('Unsaved changes to reminders and texts')
  })
})
