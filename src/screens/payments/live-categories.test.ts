// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// Categories in live Payments (ADR 0160 plan K, DV-224, DV-225): each row carries its visit's category chip, and the
// summary's split by category sits under the KPI tiles (gross, invoices, what is still open), rendered by the live
// template; an older server without the fields shows neither.
import fs from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compileScreens } from '../../../tools/dc-compile/compile'
import { root } from '../../../tools/dc-compile/tests/original-runtime'
import { categorySplitVMs, rowCategory } from '@/lib/payments/categories'
import { makeSession } from '@/auth/test-fixtures'
import { makeDetail, makeLive, makeRow, makeSummary, resetIds, stubPort } from './live-testkit'

const tmp = path.join(root, 'tools/dc-compile/tests/.tmp-snippets/payments-categories')
const text = (v: string | Buffer | undefined): string => (Buffer.isBuffer(v) ? v.toString('utf8') : (v ?? ''))
let render: (vals: any, ctx: { name: string }) => any

beforeAll(async () => {
  const out = compileScreens(['payments'], { root, variant: 'live', tplIds: false, allowComplexExpr: false })
  const dir = path.join(tmp, 'gen')
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, buf] of Object.entries(out.perScreen.payments!)) fs.writeFileSync(path.join(dir, name), text(buf))
  render = (await import(/* @vite-ignore */ path.join(dir, 'payments.tsx'))).default
})
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

const SPLIT = [
  { key: 'wash', label: 'Wash', colour: '#1FB6FF', count: 3, grossCents: 16200, netCents: 15000, outstandingCents: 0 },
  { key: 'tint', label: 'Tint', colour: '#2EE59D', count: 1, grossCents: 27500, netCents: 27500, outstandingCents: 27500 },
  { key: 'detail', label: 'Detail', colour: '#FFB547', count: 0, grossCents: 0, netCents: 0, outstandingCents: 0 },
  { key: 'mixed', label: 'Mixed', colour: null, count: 1, grossCents: 32900, netCents: 32900, outstandingCents: 0 },
]

describe('payments categories (pure)', () => {
  it('the split: label with the range, gross, invoices and what is open; empty categories dimmed', () => {
    const s = categorySplitVMs(makeSummary({ byCategory: SPLIT } as any))
    expect(s.label).toMatch(/^By category · /)
    expect(s.items.map((i: any) => [i.label, i.value, i.sub])).toEqual([
      ['Wash', '$162', '3 invoices'],
      ['Tint', '$275', '1 invoice · $275 open'],
      ['Detail', '$0', '0 invoices'],
      ['Mixed', '$329', '1 invoice'],
    ])
    expect((s.items[2] as any).style.opacity).toBe(0.55)
    expect((s.items[3] as any).swatch.background).toBe('#6B7280')
    expect(categorySplitVMs(makeSummary())).toEqual({ label: '', items: [] })
  })

  it('a row chip: the counted word in its colour; a single category without the word; none for nothing', () => {
    const cats = SPLIT.map((c) => ({ key: c.key, label: c.label, colour: c.colour }))
    expect(rowCategory({ category: 'tint', categories: ['tint'] }, cats, false)).toMatchObject({
      show: true,
      label: 'Tint',
    })
    expect(rowCategory({ category: 'mixed', categories: ['wash', 'tint'] }, cats, false).label).toBe('Mixed')
    expect(rowCategory({ category: undefined, categories: ['wash'] }, cats, false).label).toBe('Wash')
    expect(rowCategory({ category: null, categories: [] }, cats, false).show).toBe(false)
    expect(rowCategory({ category: '_none', categories: [] }, cats, false).show).toBe(false)
  })
})

describe('payments categories (live template)', () => {
  async function world(withCategories: boolean) {
    resetIds()
    const d = makeDetail({ label: 'INV-20579', client: 'Chloe Bennett' })
    const port = stubPort()
    port.details.set(d.id, d)
    port.rows = [makeRow(d, withCategories ? { categories: ['wash', 'tint'], category: 'mixed' } : {})]
    for (const r of ['today', '7d', '30d', 'mtd'])
      port.summaries.set(r, makeSummary(withCategories ? ({ byCategory: SPLIT } as any) : {}))
    const l = makeLive(makeSession({ role: 'mgmt' }), port)
    for (let i = 0; i < 3; i++) {
      l.vals()
      await l.settle()
    }
    return l
  }

  it('renders the split under the KPIs and the chip in the Items cell', async () => {
    const l = await world(true)
    const v = l.vals()
    expect(v.live.hasCatSplit).toBe(true)
    expect(v.rows[0].cat).toMatchObject({ show: true, label: 'Mixed' })
    const html = renderToStaticMarkup(render(v, { name: 'payments' }))
    expect(html).toContain('By category · ')
    expect(html).toContain('1 invoice · $275 open')
    expect(html).toMatch(/>Mixed<\/span>/)
  })

  it('without the fields nothing new shows', async () => {
    const l = await world(false)
    const v = l.vals()
    expect(v.live.hasCatSplit).toBe(false)
    expect(v.rows[0].cat.show).toBe(false)
    const html = renderToStaticMarkup(render(v, { name: 'payments' }))
    expect(html).not.toContain('By category')
  })

  it('a person who cannot see payments gets neither', async () => {
    const l = makeLive(makeSession({ role: 'crew' }), stubPort())
    expect(l.vals().live.hasCatSplit).toBe(false)
  })
})
