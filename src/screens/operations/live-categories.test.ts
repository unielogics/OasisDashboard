// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// Categories on the live Operations board (ADR 0160 plan K, DV-422..DV-424): chips in the categories' colours on the
// timeline and staff cards and in the file header, today's per-category counts under the KPI tiles (the server's
// categoryCounts, whatever the window or the search) and the board filter (a wash with a tint shows under both).
import { describe, expect, it } from 'vitest'
import { categoryCountVMs, categoryInfoOf } from '@/lib/operations/live/categories'
import { groupVMs } from '@/lib/operations/live/board'
import type { OpsSnapshot } from '@/data/ports/operations'
import { FILES, clone, fixtures, makeLive, stubPort } from './live-testkit'

const COUNTS = {
  bizDate: '2026-06-13',
  total: 7,
  items: [
    { key: 'wash', label: 'Wash', colour: '#1FB6FF', count: 4 },
    { key: 'addons', label: 'Add-ons', colour: '#7FD6FF', count: 0 },
    { key: 'tint', label: 'Tint', colour: '#2EE59D', count: 1 },
    { key: 'detail', label: 'Detail', colour: '#FFB547', count: 1 },
    { key: 'quote', label: 'Quote', colour: '#8C97A1', count: 0 },
    { key: 'mixed', label: 'Mixed', colour: null, count: 1 },
  ],
}

/** The captured board with categories: the first card a wash with a tint (mixed), the second a tint, the rest washes. */
function categorized(): OpsSnapshot {
  const s = clone(fixtures.snapshot) as any
  let n = 0
  for (const g of s.timeline.groups)
    for (const c of g.items) {
      const kind = n++
      c.categories = kind === 0 ? ['wash', 'tint'] : kind === 1 ? ['tint'] : ['wash', 'addons']
      c.category = kind === 0 ? 'mixed' : kind === 1 ? 'tint' : 'wash'
    }
  for (const col of s.staff)
    for (const c of col.jobs) {
      c.categories = ['detail']
      c.category = 'detail'
    }
  s.categoryCounts = COUNTS
  return s
}

const ui = (over: Record<string, unknown> = {}) => ({
  dark: false,
  dragId: null,
  dropTarget: null,
  nowMs: Date.parse('2026-06-13T14:36:00Z'),
  tz: 'America/New_York',
  cats: categoryInfoOf({ categoryCounts: COUNTS } as any),
  ...over,
})
const cards = (groups: any[]) => groups.flatMap((g) => g.items)

describe('board categories (pure)', () => {
  it('cards carry one chip per category in the category colour; mixed and unknown keys take the neutral', () => {
    const groups = groupVMs(categorized(), ui() as any, {} as any)
    const first = cards(groups)[0]
    expect(first.cats.map((c: any) => c.label)).toEqual(['Wash', 'Tint'])
    expect(first.cats[0].style.background).toBe('rgba(31,182,255,0.14)')
    expect(first.hasCats).toBe(true)
    const none = groupVMs(clone(fixtures.snapshot) as any, ui() as any, {} as any)
    expect(cards(none)[0].cats).toEqual([])
    expect(cards(none)[0].hasCats).toBe(false)
  })

  it('the filter keeps the cards holding the category (mixed by its word) and moves a dropped day divider on', () => {
    const snap = categorized()
    const all = cards(groupVMs(snap, ui() as any, {} as any))
    const tint = groupVMs(snap, ui({ catFilter: 'tint' }) as any, {} as any)
    expect(cards(tint).map((c: any) => c.id)).toEqual(all.slice(0, 2).map((c: any) => c.id))
    expect(cards(groupVMs(snap, ui({ catFilter: 'mixed' }) as any, {} as any))).toHaveLength(1)
    expect(cards(groupVMs(snap, ui({ catFilter: 'quote' }) as any, {} as any))).toHaveLength(0)
    const wash: any[] = groupVMs(snap, ui({ catFilter: 'wash' }) as any, {} as any)
    expect(cards(wash)).toHaveLength(all.length - 1)
    // every shown day still starts with its divider
    const days = new Set<string>()
    for (const g of wash) {
      if (!days.has(g.day)) expect(g.dividerLabel, g.key).toBeTruthy()
      days.add(g.day)
    }
  })

  it('counts: the label, All, every category with its count, mixed without a colour of its own', () => {
    const c = categoryCountVMs(COUNTS)
    expect(c.label).toBe('Today by category · 7 jobs')
    expect(c.items.map((i: any) => (i.label + ' ' + i.count).trim())).toEqual([
      'All',
      'Wash 4',
      'Add-ons 0',
      'Tint 1',
      'Detail 1',
      'Quote 0',
      'Mixed 1',
    ])
    expect((c.items[6] as any).swatch.background).toBe('#6B7280')
    expect(categoryCountVMs({ ...COUNTS, total: 1 }).label).toBe('Today by category · 1 job')
    expect(categoryCountVMs(undefined)).toEqual({ label: '', items: [] })
  })

  it('the counts are the board filter: the chosen one filled, a second click goes back to All', () => {
    const picked: string[] = []
    const f = categoryCountVMs(COUNTS, 'tint', (k) => picked.push(k)).items as any[]
    expect(f[3].style.background).toBe('var(--accentSoft)')
    expect(f[0].style.background).toBe('var(--panel)')
    expect(f[3].title).toBe('Show only Tint on the board')
    f[3].onClick()
    f[1].onClick()
    f[0].onClick()
    expect(picked).toEqual(['all', 'wash', 'all'])
    expect((categoryCountVMs(COUNTS, 'gone').items[0] as any).style.background).toBe('var(--accentSoft)')
  })
})

describe('board categories (view model)', () => {
  it('live values: counts under the KPIs that filter the timeline and staff columns, chips in the file header', async () => {
    const port = stubPort()
    port.snap = categorized()
    const l = makeLive(undefined, port)
    l.vals()
    await l.settle()
    let v = l.vals()
    expect(v.live.hasCatCounts).toBe(true)
    expect(v.live.catCountsLabel).toBe('Today by category · 7 jobs')
    const before = v.apptCount
    const allCards = cards(v.groups).length
    // filter: Tint
    v.live.catCounts[3].onClick()
    v = l.vals()
    expect(cards(v.groups)).toHaveLength(2)
    expect(v.apptCount).toBe(2)
    expect(before).not.toBe(2)
    expect(v.staffCols.every((c: any) => c.jobs.length === 0)).toBe(true)
    expect(v.live.catCounts[3].style.background).toBe('var(--accentSoft)')
    v.live.catCounts[3].onClick()
    expect(cards(l.vals().groups).length).toBe(allCards)
    // the file header
    const f = clone(FILES.late) as any
    f.categories = ['wash', 'tint']
    f.category = 'mixed'
    port.files.set(f.id, f)
    l.logic.select(f.id, 'overview')
    l.vals()
    await l.settle()
    v = l.vals()
    expect(v.sel.cats.map((c: any) => c.label)).toEqual(['Wash', 'Tint'])
    expect(v.sel.cats[0].style.fontSize).toBe('11px')
  })

  it('a filter on a category that is no longer listed shows the whole board', async () => {
    const port = stubPort()
    port.snap = categorized()
    const l = makeLive(undefined, port)
    l.vals()
    await l.settle()
    const all = cards(l.vals().groups).length
    l.logic.setState({ catFilter: 'polish' } as any)
    expect(cards(l.vals().groups)).toHaveLength(all)
    expect(l.vals().live.catCounts[0].style.background).toBe('var(--accentSoft)')
  })

  it('an older server without categories: no counts (so no filter), no chips', async () => {
    const l = makeLive()
    l.vals()
    await l.settle()
    const v = l.vals()
    expect(v.live.hasCatCounts).toBe(false)
    expect(v.live.catCounts).toEqual([])
    expect(cards(v.groups)[0].cats).toEqual([])
  })
})
