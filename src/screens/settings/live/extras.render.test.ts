// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// The LIVE Settings template (compiled with the live patches) rendered with the view model's real values in the six
// sections the design does not have (Catalog, Categories, Reminders & texts; Vehicle sizes, Prices by size, Memberships):
// the nav buttons, the Packages note, each section's content and the Save bars are in the DOM, and every root and
// handler the template binds exists.
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

const FLAG = {
  catalog: 'secCatalog',
  categories: 'secCategories',
  reminders: 'secReminders',
  sizes: 'secSizes',
  prices: 'secPrices',
  memberships: 'secMemberships',
} as const

async function shown(section: keyof typeof FLAG) {
  const t = makeExtrasLogic()
  t.logic.setState({ section })
  const flag = FLAG[section]
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
    expect(html).toContain('>Prices &amp; memberships</span>')
    expect(html).toContain('Prices are set by vehicle size in Prices by size')
    expect(html).toContain('Open Prices by size')
    // the three pricing sections share one nav button; their tabs show only over them
    expect(html).not.toContain('>Vehicle sizes<')
    // the nav order: Packages, then Catalog, Categories, Prices & memberships; Arrival, then Reminders
    expect(html.indexOf('Packages &amp; checklists')).toBeLessThan(html.indexOf('>Catalog</span>'))
    expect(html.indexOf('>Categories</span>')).toBeLessThan(html.indexOf('>Prices &amp; memberships</span>'))
    expect(html.indexOf('Arrival &amp; check-in')).toBeLessThan(html.indexOf('>Reminders &amp; texts</span>'))
    for (const r of bindings.roots) expect(t.logic.renderVals(), r).toHaveProperty(r)
  })

  it('Catalog renders the list with starting prices and the website form with Edit prices; no pre-size price boxes', async () => {
    const t = await shown('catalog')
    const v = t.logic.renderVals()
    const html = renderToStaticMarkup(render(v, { name: 'settings' }))
    for (const s of [
      'Prices are set per vehicle size in Prices by size',
      'Signature Hand Wash',
      'Wash · from $40 · 2 sizes not set',
      'Prices by vehicle size',
      '>45 min<',
      'Edit prices',
      'Name on the website',
      'Shown on the website',
      'Order on the website',
    ])
      expect(html, s).toContain(s)
    for (const s of ['Member price ($)', 'Guest price', 'VIP members', 'Guest prices', 'Window tint prices', 'Squarespace'])
      expect(html, s).not.toContain(s)
    expect(html).not.toContain('Weekly schedule')
    liveHandlersExist(v, 'live.cat')
  })

  it('Vehicle sizes renders each size with its use, the switches and the add button', async () => {
    const t = await shown('sizes')
    const v = t.logic.renderVals()
    const html = renderToStaticMarkup(render(v, { name: 'settings' }))
    for (const s of [
      '>Prices by size</span></button>',
      '>Memberships</span></button>',
      '>Vehicle sizes</span></button>',
      'Smallest first',
      'value="Compact car"',
      'value="Truck"',
      'Key compact_car · 3 services priced',
      'off: not offered, its prices are kept',
      '+ Add size',
    ])
      expect(html, s).toContain(s)
    liveHandlersExist(v, 'live.sizes')
    liveHandlersExist(v, 'live.pricingTabs')
  })

  it('Prices by size renders the grid by category and size, the banner, tint from–to, the fee; once edited, the Save bar', async () => {
    const t = await shown('prices')
    let v = t.logic.renderVals()
    let html = renderToStaticMarkup(render(v, { name: 'settings' }))
    for (const s of [
      'One regular price per service and size',
      '12 prices not set',
      'Compact car',
      'Large SUV',
      'Signature Hand Wash',
      'Package · from $40',
      'value="40"',
      'placeholder="—"',
      'title="Carbon window tint · Compact car (up to)"',
      'value="359"',
      'Booking fee for guests',
      'At the counter',
      'By payment link',
    ])
      expect(html, s).toContain(s)
    expect(html).not.toContain('>Truck<')
    expect(html).not.toContain('Save prices')
    liveHandlersExist(v, 'live.prices')
    v.live.prices.groups[0].rows[0].cells[1].setFrom({ target: { value: '45' } })
    v = t.logic.renderVals()
    html = renderToStaticMarkup(render(v, { name: 'settings' }))
    expect(html).toContain('1 service changed')
    expect(html).toContain('Save prices')
  })

  it('Memberships renders the tiers, the editor with inclusions and the monthly grid with the Square state', async () => {
    const t = await shown('memberships')
    const v = t.logic.renderVals()
    const html = renderToStaticMarkup(render(v, { name: 'settings' }))
    for (const s of [
      'a car up to the plan size is covered in full',
      'from $129/mo · on the website',
      'Key gold · was premium · not sold yet · Square: not synced yet',
      'Member % off',
      'Cars on one membership',
      'VIP booking',
      'What it includes',
      'value="Hand washes"',
      'Per month',
      'Every wash',
      'Apply by itself',
      '+ Add inclusion',
      '+ Add tier',
      'Monthly price by plan size',
      'Price version 2',
      'value="129"',
      'Not synced yet',
      'Save tier',
    ])
      expect(html, s).toContain(s)
    // Gold is on and on the website, without VIP booking: the switches show it
    const after = (label: string) => html.slice(html.indexOf('>' + label + '<')).match(/<button[^>]*style="([^"]*)"/)![1]
    expect(after('On the website')).toContain('background:var(--accent)')
    expect(after('VIP booking')).toContain('background:var(--line)')
    liveHandlersExist(v, 'live.mem')
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
