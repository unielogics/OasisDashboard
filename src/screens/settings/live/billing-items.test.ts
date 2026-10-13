// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// Settings → Billing & integrations, wave K3 (live only): the "Sales tax" form (ADR 0173, DV-914) and the "Square item
// library" block (ADR 0172, DV-911) on the view model with the fake API, and the live template rendering them; the sync
// dots of Prices by size (DV-912) and the Catalog's "archived in Square" (DV-913). With the server's defaults (Square
// writes off, the item sync off) nothing is written at Square and Prices by size and the Catalog read as before.
import fs from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { compileScreens } from '../../../../tools/dc-compile/compile'
import { root } from '../../../../tools/dc-compile/tests/original-runtime'
import { atPath } from '../testkit'
import { makeExtrasLogic, stale, taxCheckFixture } from './extras-testkit'

const tmp = path.join(root, 'tools/dc-compile/tests/.tmp-snippets/settings-billing-items-render')
const text = (v: string | Buffer | undefined): string => (Buffer.isBuffer(v) ? v.toString('utf8') : (v ?? ''))
let render: (vals: any, ctx: { name: string }) => any

beforeAll(async () => {
  process.env.TZ = 'America/New_York'
  const out = compileScreens(['settings'], { root, variant: 'live', tplIds: false, allowComplexExpr: false })
  const dir = path.join(tmp, 'gen')
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, buf] of Object.entries(out.perScreen.settings!))
    fs.writeFileSync(path.join(dir, name), text(buf))
  render = (await import(/* @vite-ignore */ path.join(dir, 'settings.tsx'))).default
})
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))
beforeEach(() => {
  vi.useRealTimers()
  location.hash = ''
})
afterEach(() => vi.restoreAllMocks())

const vals = (logic: any): any => logic.renderVals()
const html = (logic: any) => renderToStaticMarkup(render(vals(logic), { name: 'settings' }))
const call = (logic: any, p: string, value = ''): void => {
  const fn = atPath(vals(logic), p)
  expect(typeof fn, `no handler at ${p}`).toBe('function')
  fn({ target: { value }, key: '' })
}
const writes = (calls: any[][], name: string) => calls.filter((c) => c[0] === name)
const openBilling = async (logic: any): Promise<any> => {
  logic.setState({ section: 'billing' })
  await vi.waitFor(() => expect(vals(logic).live.secBilling).toBe(true))
  await vi.waitFor(() => expect(vals(logic).live.bill.items.has).toBe(true))
  return vals(logic).live.bill
}

describe('Sales tax (ADR 0173, DV-914)', () => {
  it('shows the rate new invoices are made with and how they round, read from GET /settings/billing', async () => {
    const t = makeExtrasLogic('super')
    const b = await openBilling(t.logic)
    expect(b.tax).toMatchObject({
      percent: '7',
      rounding: 'Rounded half up, once per invoice.',
      dirty: false,
      hasError: false,
    })
    expect(b.tax.sub).toBe(
      'New invoices are made at this rate. Each invoice keeps the rate it was made with. Prices are before tax.',
    )
    const page = html(t.logic)
    expect(page).toContain('Sales tax')
    expect(page).toContain('Rounded half up, once per invoice.')
  })

  it('a typed rate is a draft; a rate the server would refuse is said before sending; Save sends it with the version, never the rounding', async () => {
    const t = makeExtrasLogic('super')
    await openBilling(t.logic)
    call(t.logic, 'live.bill.tax.setPercent', '6.6255')
    expect(vals(t.logic).live.bill.tax.dirty).toBe(true)
    call(t.logic, 'live.bill.tax.save')
    await vi.waitFor(() =>
      expect(vals(t.logic).live.bill.tax.error).toBe(
        'Use a percentage from 0 to 100 with up to three decimals, such as 6.625',
      ),
    )
    expect(writes(t.calls, 'saveSalesTax')).toHaveLength(0)
    expect(html(t.logic)).toContain('Use a percentage from 0 to 100 with up to three decimals, such as 6.625')
    call(t.logic, 'live.bill.tax.setPercent', '6.625')
    expect(vals(t.logic).live.bill.tax.hasError).toBe(false)
    call(t.logic, 'live.bill.tax.save')
    await vi.waitFor(() => expect(writes(t.calls, 'saveSalesTax')).toHaveLength(1))
    // always with Square's rounding: the Square item sync waits for it (K4 review tax:H2)
    expect(writes(t.calls, 'saveSalesTax')[0]![1]).toEqual({ percent: '6.625', rounding: 'half_even', version: 0 })
    await vi.waitFor(() => expect(t.flashes).toContain('Sales tax saved · 6.625%, rounded like Square'))
    await vi.waitFor(() => expect(vals(t.logic).live.bill.tax).toMatchObject({ percent: '6.625', dirty: false }))
  })

  it('a half-typed rate stays as typed; typing the saved text back is no change; Discard drops the draft', async () => {
    const t = makeExtrasLogic('super')
    await openBilling(t.logic)
    call(t.logic, 'live.bill.tax.setPercent', '7.')
    expect(vals(t.logic).live.bill.tax).toMatchObject({ percent: '7.', dirty: true })
    call(t.logic, 'live.bill.tax.setPercent', '7')
    expect(vals(t.logic).live.bill.tax.dirty).toBe(false)
    call(t.logic, 'live.bill.tax.setPercent', '8')
    expect(vals(t.logic).live.bill.tax).toMatchObject({ percent: '8', dirty: true })
    call(t.logic, 'live.bill.tax.discard')
    expect(vals(t.logic).live.bill.tax).toMatchObject({ percent: '7', dirty: false })
  })

  it('a 412 keeps the edit and says someone else saved meanwhile; a rounding set at the rollout reads “like Square”', async () => {
    const t = makeExtrasLogic('super')
    t.bill.salesTax = { percent: '6.625', rateDbp: 6625, label: '6.625%', rounding: 'half_even', version: 2 }
    await openBilling(t.logic)
    expect(vals(t.logic).live.bill.tax.rounding).toBe(
      'Rounded like Square (half cents to the even cent), once per invoice.',
    )
    t.fail.set('saveSalesTax', stale())
    call(t.logic, 'live.bill.tax.setPercent', '7')
    call(t.logic, 'live.bill.tax.save')
    await vi.waitFor(() => expect(vals(t.logic).live.bill.tax.error).toMatch(/^Someone else saved a change meanwhile/))
    expect(vals(t.logic).live.bill.tax.percent).toBe('7')
  })

  it('without set.billing nothing is read and nothing is sent', async () => {
    const t = makeExtrasLogic('mgmt')
    t.logic.setState({ section: 'billing' })
    await vi.waitFor(() => expect(vals(t.logic).live.secLocked).toBe(true))
    expect(writes(t.calls, 'squareItems')).toHaveLength(0)
    expect(writes(t.calls, 'billing')).toHaveLength(0)
  })
})

describe('Square item library (ADR 0172, DV-911)', () => {
  it('with the defaults: watch only, the tax not checked yet, no counts, Sync now; “How payments run” names the switch', async () => {
    const t = makeExtrasLogic('super')
    const b = await openBilling(t.logic)
    expect(b.items).toMatchObject({
      headline: 'Watch only · Square writes are off, so nothing is made in Square',
      tax: 'Not checked yet. Sync now or Test connection checks it.',
      hasCounts: false,
      runs: 'Not synced yet',
      hasPreview: false,
      hasFailures: false,
      canArchive: false,
      syncLabel: 'Sync now',
      note: 'Sync now only reads Square and shows what the sync would do. Nothing is written.',
      taxMode: 'Automatic: the one Square tax at Oasis’s rate, or Oasis’s own when the shop has none.',
    })
    expect(b.switches.map((l: any) => l.label + ': ' + l.value)).toContain('Square item library: Off')
    expect(writes(t.calls, 'squareItems')).toHaveLength(1)
    const page = html(t.logic)
    for (const s of ['Square item library', 'Watch only', 'Sync now', 'Square tax', 'Automatic', 'Oasis’s own tax'])
      expect(page, s).toContain(s)
    expect(page).not.toContain('Archive Oasis items in Square')
  })

  it('Sync now while watch only: the preview and the tax check, read again from the server', async () => {
    const t = makeExtrasLogic('super')
    await openBilling(t.logic)
    call(t.logic, 'live.bill.items.sync')
    await vi.waitFor(() => expect(writes(t.calls, 'syncSquareItems')).toHaveLength(1))
    await vi.waitFor(() =>
      expect(t.flashes).toContain(
        'Preview · Would make 5 items with 14 prices and 3 categories; 1 service not sold (off, quote only or no price). The tax: uses the shop’s Square tax.',
      ),
    )
    await vi.waitFor(() => expect(vals(t.logic).live.bill.items.hasPreview).toBe(true))
    const iv = vals(t.logic).live.bill.items
    expect(iv.preview).toBe(
      'Preview Jun 13, 10:36 AM: Would make 5 items with 14 prices and 3 categories; 1 service not sold (off, quote only or no price). The tax: uses the shop’s Square tax.',
    )
    expect(iv.tax).toBe('Square tax “NJ Sales Tax” is 6.625%, the same as Oasis')
    expect(iv.taxStyle.color).toBe('#0E9E6E')
    expect(iv.rounding).toBe('All 9 sample totals match Square to the cent')
    expect(iv.runs).toBe('Not synced yet · tax checked Jun 13, 10:36 AM')
    expect(iv.candidates.map((c: any) => [c.text, c.canUse])).toEqual([
      ['“NJ Sales Tax” 6.625% · used for Oasis items', false],
    ])
    expect(writes(t.calls, 'squareItems').length).toBeGreaterThan(1)
    expect(html(t.logic)).toContain('All 9 sample totals match Square to the cent')
  })

  it('with the sync on: counts, the last runs, failures, what Square changed; a paused tax shows the shop’s taxes to pick from', async () => {
    const t = makeExtrasLogic('super')
    Object.assign(t.items, {
      mode: 'on',
      writesEnabled: true,
      itemsSyncEnabled: true,
      counts: { onSquare: 17, waiting: 1, failed: 1, archived: 2, notSold: 1 },
      lastSyncAt: '2026-06-13T14:32:00.000Z',
      lastDriftAt: '2026-06-13T08:40:00.000Z',
      taxCheckedAt: '2026-06-13T14:32:00.000Z',
      failures: [{ serviceId: 'p-ext', service: 'Exterior Hand Wash', error: 'Square refused the price' }],
      taxCheck: taxCheckFixture({
        status: 'blocked',
        taxId: null,
        taxName: null,
        detail: 'Several Square taxes are 6.625% (NJ Sales Tax 6.625%, State 6.625%): pick the one Oasis items use',
        candidates: [
          { id: 'TAX-NJ', name: 'NJ Sales Tax', percentage: '6.625', matches: true, problem: null },
          { id: 'TAX-ST', name: 'State', percentage: '6.625', matches: true, problem: null },
        ],
        rounding: undefined,
      }),
    })
    const b = await openBilling(t.logic)
    expect(b.items).toMatchObject({
      headline: 'On · Oasis services and prices are kept in step with Square',
      hasCounts: true,
      counts: 'On Square 17 · Waiting 1 · Failed 1 · Archived 2 · Not sold 1',
      runs: 'Last sync Jun 13, 10:32 AM · full check Jun 13, 4:40 AM · tax checked Jun 13, 10:32 AM',
      hasFailures: true,
      hasRounding: false,
    })
    expect(b.items.failures).toEqual([{ text: 'Exterior Hand Wash: Square refused the price' }])
    expect(b.items.taxStyle.color).toBe('#C2410C')
    expect(b.items.candidates.map((c: any) => c.canUse)).toEqual([true, true])
    const page = html(t.logic)
    expect(page).toContain('Not on Square yet:')
    expect(page).toContain('Use this tax')
    // pick one: PUT …/items/tax with the state's version; then it reads as the tax in use
    b.items.candidates[1].use()
    await vi.waitFor(() => expect(writes(t.calls, 'setSquareItemsTax')).toHaveLength(1))
    expect(writes(t.calls, 'setSquareItemsTax')[0]![1]).toEqual({ mode: 'adopt', squareTaxId: 'TAX-ST', version: 0 })
    await vi.waitFor(() => expect(t.flashes).toContain('Square tax picked · applies at the next sync'))
    await vi.waitFor(() =>
      expect(vals(t.logic).live.bill.items.candidates.map((c: any) => c.text)).toEqual([
        '“NJ Sales Tax” 6.625% · matches Oasis',
        '“State” 6.625% · used for Oasis items',
      ]),
    )
    // back to automatic
    vals(t.logic).live.bill.items.taxModes[0].onClick()
    await vi.waitFor(() => expect(writes(t.calls, 'setSquareItemsTax')).toHaveLength(2))
    expect(writes(t.calls, 'setSquareItemsTax')[1]![1]).toEqual({ mode: 'auto', version: 1 })
  })

  it('a sync run’s answer: what Square changed and what failed stay under the block', async () => {
    const t = makeExtrasLogic('super')
    Object.assign(t.items, { mode: 'on', writesEnabled: true, itemsSyncEnabled: true })
    t.api.syncSquareItems = async (...a: any[]) => {
      t.calls.push(['syncSquareItems', ...a])
      return {
        status: 'done',
        mode: 'on',
        tax: taxCheckFixture(),
        created: 0,
        updated: 1,
        archived: 0,
        recreated: 0,
        adopted: 0,
        restored: 1,
        failed: 1,
        categoriesCreated: 0,
        taxCreated: 0,
        taxUpdated: 0,
        failures: ['Exterior Hand Wash: Square refused the price'],
        changedInSquare: ['Signature Hand Wash · Large SUV was $45 in Square; Oasis charges $40. Oasis set it back.'],
        reported: [],
      }
    }
    await openBilling(t.logic)
    call(t.logic, 'live.bill.items.sync')
    await vi.waitFor(() => expect(t.flashes).toContain('Synced with Square · 1 updated · 1 put back · 1 failed'))
    const iv = vals(t.logic).live.bill.items
    expect(iv.changed).toEqual([
      { text: 'Changed in Square: Signature Hand Wash · Large SUV was $45 in Square; Oasis charges $40. Oasis set it back.' },
    ])
    expect(iv.runFailures).toEqual([{ text: 'Exterior Hand Wash: Square refused the price' }])
  })

  it('archive all only where the server allows it (writes on, the sync off), and only after asking', async () => {
    const t = makeExtrasLogic('super')
    Object.assign(t.items, {
      mode: 'off',
      writesEnabled: true,
      counts: { onSquare: 3, waiting: 0, failed: 0, archived: 1, notSold: 0 },
    })
    await openBilling(t.logic)
    expect(vals(t.logic).live.bill.items).toMatchObject({ canArchive: true, archiveAsk: false })
    expect(html(t.logic)).toContain('Archive Oasis items in Square')
    call(t.logic, 'live.bill.items.archiveStart')
    expect(vals(t.logic).live.bill.items.archiveAsk).toBe(true)
    expect(html(t.logic)).toContain('Archive every Oasis item in Square?')
    expect(writes(t.calls, 'archiveSquareItems')).toHaveLength(0)
    call(t.logic, 'live.bill.items.archiveCancel')
    expect(vals(t.logic).live.bill.items.archiveAsk).toBe(false)
    call(t.logic, 'live.bill.items.archiveStart')
    call(t.logic, 'live.bill.items.archive')
    await vi.waitFor(() => expect(writes(t.calls, 'archiveSquareItems')).toHaveLength(1))
    await vi.waitFor(() => expect(t.flashes).toContain('3 items archived in Square · 1 already archived'))
  })

  it('the block says when the item library cannot be read, and reads it again on Try again', async () => {
    const t = makeExtrasLogic('super')
    t.fail.set('squareItems', new Error('offline') as any)
    t.logic.setState({ section: 'billing' })
    await vi.waitFor(() => expect(vals(t.logic).live.bill.items.failed).toBe(true))
    expect(html(t.logic)).toContain('Couldn’t read the item library.')
    const reads = writes(t.calls, 'squareItems').length
    t.fail.delete('squareItems')
    call(t.logic, 'live.bill.items.retry')
    await vi.waitFor(() => expect(writes(t.calls, 'squareItems').length).toBeGreaterThan(reads))
    await vi.waitFor(() => expect(vals(t.logic).live.bill.items.has).toBe(true))
  })

  it('Test connection’s tax check reads “Sales tax”', async () => {
    const t = makeExtrasLogic('super')
    const test = t.api.testSquare
    t.api.testSquare = async (...a: any[]) => {
      const r: any = await test(...a)
      r.checks.push({ key: 'tax', ok: true, detail: 'Square tax “NJ Sales Tax” is 6.625%, the same as Oasis' })
      return r
    }
    await openBilling(t.logic)
    call(t.logic, 'live.bill.test')
    await vi.waitFor(() => expect(vals(t.logic).live.bill.sqChecks).toHaveLength(5))
    expect(vals(t.logic).live.bill.sqChecks[4]).toMatchObject({
      label: 'Sales tax',
      value: 'OK · Square tax “NJ Sales Tax” is 6.625%, the same as Oasis',
    })
  })
})

describe('Prices by size and the Catalog while the item sync is on (DV-912, DV-913)', () => {
  const openPrices = async (logic: any): Promise<any> => {
    logic.setState({ section: 'prices' })
    await vi.waitFor(() => expect(vals(logic).live.secPrices).toBe(true))
    return vals(logic).live.prices
  }

  it('with the sync off the server sends no state: no dot, the rows read as before', async () => {
    const t = makeExtrasLogic('super')
    const p = await openPrices(t.logic)
    const sig = p.groups[0].rows[0]
    expect(sig.sub).toBe('Package · from $40')
    expect(sig.cells.every((c: any) => c.hasDot === false)).toBe(true)
    expect(html(t.logic)).not.toMatch(/title="(On Square|Waiting for Square)/)
  })

  it('a dot per size with its state, the failure as its tooltip; the row names the item’s state', async () => {
    const t = makeExtrasLogic('super')
    const sig = t.cat.prices.find((r: any) => r.serviceId === 'p-sig')
    sig.square = {
      state: 'failed',
      cells: { compact_car: 'synced', large_car: 'pending', compact_suv: 'failed', large_suv: 'synced' },
      error: 'Square refused the price',
    }
    t.cat.prices.find((r: any) => r.serviceId === 'p-ext').square = { state: 'synced', cells: { '': 'synced' }, error: null }
    t.cat.prices.find((r: any) => r.serviceId === 'p-rim').square = { state: 'not_sold', cells: {}, error: null }
    const p = await openPrices(t.logic)
    const row = p.groups[0].rows[0]
    expect(row.sub).toBe('Package · from $40 · Square sync failed')
    expect(row.cells.map((c: any) => [c.hasDot, c.dotTitle, c.dotStyle.background])).toEqual([
      [true, 'On Square', '#0E9E6E'],
      [true, 'Waiting for Square (the next sync sends it)', '#FFB547'],
      [true, 'Square sync failed: Square refused the price', '#C2410C'],
      [true, 'On Square', '#0E9E6E'],
    ])
    // sold at one price (key ""): the row says it, no size has a dot
    const ext = p.groups[0].rows[1]
    expect(ext.sub).toMatch(/· on Square$/)
    expect(ext.cells.every((c: any) => !c.hasDot)).toBe(true)
    expect(row.cells[0].dotStyle).toMatchObject({ position: 'absolute', top: '5px', right: '5px' })
    // a quote-only service is never sold in Square: its line already says why
    expect(p.groups[3].rows[0].sub).toBe('Package · quote only: no price online')
    const page = html(t.logic)
    expect(page).toContain('title="Square sync failed: Square refused the price"')
    expect(page).toContain('title="Waiting for Square (the next sync sends it)"')
  })

  it('the Catalog list says when Oasis archived a service in Square', async () => {
    const t = makeExtrasLogic('super')
    t.cat.prices.find((r: any) => r.serviceId === 'p-rim').square = { state: 'archived', cells: {}, error: null }
    t.logic.setState({ section: 'catalog' })
    await vi.waitFor(() => expect(vals(t.logic).live.secCatalog).toBe(true))
    expect(vals(t.logic).live.cat.list.map((x: any) => x.sub)).toEqual([
      'Wash · from $40 · 2 sizes not set',
      'Wash · No prices yet · books at $38',
      'Tint · from $275 · 3 sizes not set',
      'Quote · quote only · archived in Square',
    ])
  })
})
