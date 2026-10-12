// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// Settings → Vehicle sizes and Prices by size, with the booking fee (live only, ADR 0170, DV-322, DV-323, DV-325) on the
// view model with the fake API: sizes in size order with their use, rename as a draft, order / on-off / remove at once
// (a size in use says what uses it), a new size's key from its name; the grid by category × active size in whole
// dollars, tint rows from–to, "N prices not set", one Save with only the changed rows and cells and each row's version,
// a 412 naming the row and rebasing; the booking fee with its version; no request without set.services.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { STALE_ACTION_MESSAGE } from '@/lib/settings/drafts'
import { atPath } from '../testkit'
import { makeExtrasLogic, validation } from './extras-testkit'

beforeAll(() => {
  process.env.TZ = 'America/New_York'
})
beforeEach(() => {
  vi.useRealTimers()
  location.hash = ''
})
afterEach(() => vi.restoreAllMocks())

const vals = (logic: any): any => logic.renderVals()
const call = (logic: any, path: string, value = '', key = ''): void => {
  const fn = atPath(vals(logic), path)
  expect(typeof fn, `no handler at ${path}`).toBe('function')
  fn({ target: { value }, key })
}
const open = async (logic: any, section: 'sizes' | 'prices'): Promise<any> => {
  logic.setState({ section })
  const key = section === 'sizes' ? 'secSizes' : 'secPrices'
  await vi.waitFor(() => expect(vals(logic).live[key]).toBe(true))
  return vals(logic).live
}
const writes = (calls: any[][], name: string) => calls.filter((c) => c[0] === name)

describe('Settings → Vehicle sizes', () => {
  it('one nav button opens Prices by size; tabs switch to Memberships and Vehicle sizes; the nav stays lit on all three', async () => {
    const t = makeExtrasLogic()
    expect(vals(t.logic).live.pricingTabs.show).toBe(false)
    call(t.logic, 'live.goPrices')
    await open(t.logic, 'prices')
    const tabs = vals(t.logic).live.pricingTabs
    expect(tabs.show).toBe(true)
    expect(tabs.tabs.map((x: any) => [x.label, x.style.background])).toEqual([
      ['Prices by size', 'var(--accent)'],
      ['Memberships', 'transparent'],
      ['Vehicle sizes', 'transparent'],
    ])
    const lit = vals(t.logic).live.xnav.pricing.background
    call(t.logic, 'live.pricingTabs.tabs.1.onClick')
    expect(vals(t.logic).secTitle).toBe('Memberships')
    expect(vals(t.logic).live.xnav.pricing.background).toBe(lit)
    call(t.logic, 'live.pricingTabs.tabs.2.onClick')
    expect(vals(t.logic).secTitle).toBe('Vehicle sizes')
    expect(vals(t.logic).live.xnav.pricing.background).toBe(lit)
    expect(vals(t.logic).live.xnav.catalog.background).not.toBe(lit)
  })

  it('one row per size in size order with what it prices and whether it is on', async () => {
    const t = makeExtrasLogic()
    call(t.logic, 'live.goSizes')
    expect(vals(t.logic).secTitle).toBe('Vehicle sizes')
    const live = await open(t.logic, 'sizes')
    expect(live.sizes.rows.map((r: any) => r.label)).toEqual([
      'Compact car',
      'Large car',
      'Compact SUV',
      'Large SUV',
      'Truck',
    ])
    expect(live.sizes.rows[0].keyLine).toBe('Key compact_car · 3 services priced')
    expect(live.sizes.rows[1].keyLine).toBe('Key large_car · 0 services priced')
    expect(live.sizes.rows[4].keyLine).toBe('Key truck · 1 service priced · off: not offered, its prices are kept')
    expect(live.sizes.add.canAdd).toBe(true)
    expect(t.calls.filter((c) => c[0] === 'catalog')).toHaveLength(1)
  })

  it('a rename is a draft saved with its version; Enter saves; a taken name is refused before sending', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'sizes')
    call(t.logic, 'live.sizes.rows.1.setLabel', 'compact suv')
    call(t.logic, 'live.sizes.rows.1.save')
    expect(vals(t.logic).live.sizes.rows[1].error).toBe('There is already a size with that name.')
    expect(writes(t.calls, 'updateVehicleClass')).toHaveLength(0)
    call(t.logic, 'live.sizes.rows.1.setLabel', 'Sedan')
    expect(vals(t.logic).live.sizes.rows[1]).toMatchObject({ dirty: true, error: '' })
    call(t.logic, 'live.sizes.rows.1.onKey', '', 'Enter')
    await vi.waitFor(() => expect(writes(t.calls, 'updateVehicleClass')).toHaveLength(1))
    expect(writes(t.calls, 'updateVehicleClass')[0]!.slice(1, 3)).toEqual(['large_car', { label: 'Sedan', version: 1 }])
    await vi.waitFor(() => expect(t.flashes).toContain('Saved Sedan'))
    await vi.waitFor(() => expect(vals(t.logic).live.sizes.rows[1]).toMatchObject({ label: 'Sedan', dirty: false }))
  })

  it('on/off and order are sent at once; a 412 there says to try again', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'sizes')
    call(t.logic, 'live.sizes.rows.4.toggle')
    await vi.waitFor(() => expect(writes(t.calls, 'updateVehicleClass')).toHaveLength(1))
    expect(writes(t.calls, 'updateVehicleClass')[0]![2]).toEqual({ active: true, version: 2 })
    await vi.waitFor(() => expect(t.flashes).toContain('Truck is on'))
    call(t.logic, 'live.sizes.rows.1.down')
    await vi.waitFor(() => expect(writes(t.calls, 'updateVehicleClass')).toHaveLength(3))
    expect(writes(t.calls, 'updateVehicleClass').slice(1).map((c) => [c[1], (c[2] as any).sort])).toEqual([
      ['large_car', 30],
      ['compact_suv', 20],
    ])
    await vi.waitFor(() => expect(vals(t.logic).live.sizes.rows[1].label).toBe('Compact SUV'))
    t.cat.vehicleClasses[0].version = 7
    call(t.logic, 'live.sizes.rows.0.toggle')
    await vi.waitFor(() => expect(vals(t.logic).live.sizes.rows[0].error).toBe(STALE_ACTION_MESSAGE))
  })

  it('remove: an unused size goes; a size in use says what uses it and to turn it off instead', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'sizes')
    call(t.logic, 'live.sizes.rows.0.remove')
    await vi.waitFor(() =>
      expect(vals(t.logic).live.sizes.rows[0].error).toBe(
        'Compact car is in use (3 prices), so it can’t be removed. Turn it off instead.',
      ),
    )
    call(t.logic, 'live.sizes.rows.1.remove')
    await vi.waitFor(() => expect(t.flashes).toContain('Removed Large car'))
    expect(writes(t.calls, 'deleteVehicleClass').map((c) => c.slice(1, 3))).toEqual([
      ['compact_car', 1],
      ['large_car', 1],
    ])
    await vi.waitFor(() => expect(vals(t.logic).live.sizes.rows).toHaveLength(4))
  })

  it('add: the key comes from the name, set once; refused names say why; the new size goes last', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'sizes')
    call(t.logic, 'live.sizes.add.start')
    call(t.logic, 'live.sizes.add.setLabel', 'Large car')
    call(t.logic, 'live.sizes.add.save')
    expect(vals(t.logic).live.sizes.add.error).toBe('There is already a size with that name.')
    call(t.logic, 'live.sizes.add.setLabel', 'Minivan')
    expect(vals(t.logic).live.sizes.add.keyLine).toBe('Key: minivan (set once, never changes)')
    t.fail.set('createVehicleClass', validation('The shop can have at most 12 vehicle sizes', 'key'))
    call(t.logic, 'live.sizes.add.onKey', '', 'Enter')
    await vi.waitFor(() => expect(vals(t.logic).live.sizes.add.error).toBe('The shop can have at most 12 vehicle sizes'))
    t.fail.delete('createVehicleClass')
    call(t.logic, 'live.sizes.add.save')
    await vi.waitFor(() => expect(t.flashes).toContain('Added Minivan · set its prices in Prices by size'))
    expect(writes(t.calls, 'createVehicleClass').at(-1)![1]).toEqual({ key: 'minivan', label: 'Minivan', sort: 60 })
    await vi.waitFor(() => expect(vals(t.logic).live.sizes.rows.at(-1).label).toBe('Minivan'))
    expect(vals(t.logic).live.sizes.add.open).toBe(false)
  })

  it('without set.services every change is refused with the toast and nothing is sent', async () => {
    const t = makeExtrasLogic('support')
    await open(t.logic, 'sizes')
    call(t.logic, 'live.sizes.rows.0.setLabel', 'x')
    call(t.logic, 'live.sizes.rows.0.toggle')
    call(t.logic, 'live.sizes.rows.0.remove')
    call(t.logic, 'live.sizes.add.start')
    expect(t.flashes).toContain('Your role can’t edit packages and checklists')
    expect(vals(t.logic).live.sizes.rows[0].label).toBe('Compact car')
    expect(t.calls.filter((c) => /^save|^create|^update|^delete/.test(c[0] as string))).toEqual([])
  })
})

describe('Settings → Prices by size', () => {
  it('rows by category, columns the sizes that are on, whole dollars, — for not set, tint from–to, the banner', async () => {
    const t = makeExtrasLogic()
    const live = (await open(t.logic, 'prices')).prices
    expect(live.heads.map((h: any) => h.label)).toEqual(['Compact car', 'Large car', 'Compact SUV', 'Large SUV'])
    expect(live.headStyle.gridTemplateColumns).toBe('minmax(170px,1.5fr) repeat(4,minmax(84px,1fr))')
    expect(live.groups.map((g: any) => [g.label, g.rows.map((r: any) => r.name)])).toEqual([
      ['Wash', ['Signature Hand Wash', 'Exterior Hand Wash']],
      ['Add-ons', ['Hand wax']],
      ['Tint', ['Carbon window tint']],
      ['Quote', ['Rim powder coating']],
    ])
    const sig = live.groups[0].rows[0]
    expect(sig.sub).toBe('Package · from $40')
    expect(sig.cells.map((c: any) => c.from)).toEqual(['40', '', '50', ''])
    expect(sig.cells.every((c: any) => c.single && !c.range)).toBe(true)
    const tint = live.groups[2].rows[0]
    expect(tint.sub).toBe('Package · from $275 · from–to')
    expect(tint.cells[0]).toMatchObject({ range: true, from: '275', to: '359', label: 'Carbon window tint · Compact car' })
    expect(live.groups[3].rows[0].sub).toBe('Package · quote only: no price online')
    // Signature 2 + Exterior 4 + wax 3 + tint 3; the quote-only row does not count
    expect(live).toMatchObject({ hasMissing: true, missing: '12 prices not set', dirty: false })
  })

  it('typing is a draft; the count follows; one Save sends only the changed rows and cells with their versions', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'prices')
    call(t.logic, 'live.prices.groups.0.rows.0.cells.1.setFrom', '45')
    call(t.logic, 'live.prices.groups.0.rows.0.cells.2.setFrom', '')
    call(t.logic, 'live.prices.groups.2.rows.0.cells.3.setFrom', '329')
    call(t.logic, 'live.prices.groups.2.rows.0.cells.3.setTo', '429')
    let v = vals(t.logic).live.prices
    expect(v).toMatchObject({ dirty: true, dirtyText: '2 services changed', missing: '11 prices not set' })
    expect(v.groups[0].rows[0].sub).toBe('Package · from $40 · unsaved')
    expect(v.groups[0].rows[0].cells[1].style.background).toBe('var(--accentSoft)')
    expect(v.groups[0].rows[0].cells[0].style.background).toBe('var(--panel)')
    call(t.logic, 'live.prices.save')
    await vi.waitFor(() => expect(writes(t.calls, 'savePrices')).toHaveLength(1))
    expect(writes(t.calls, 'savePrices')[0]![1]).toEqual({
      rows: [
        {
          serviceId: 'p-sig',
          version: 3,
          cells: [
            { class: 'large_car', cents: 4500, maxCents: null },
            { class: 'compact_suv', cents: null, maxCents: null },
          ],
        },
        { serviceId: 'p-carbon', version: 1, cells: [{ class: 'large_suv', cents: 32900, maxCents: 42900 }] },
      ],
    })
    await vi.waitFor(() => expect(t.flashes).toContain('Prices saved · 2 services · 11 prices not set'))
    await vi.waitFor(() => expect(vals(t.logic).live.prices.dirty).toBe(false))
    v = vals(t.logic).live.prices
    expect(v.groups[0].rows[0].cells.map((c: any) => c.from)).toEqual(['40', '45', '', ''])
    // the inactive Truck price of Signature was not touched
    expect(t.cat.prices[0].cells.find((c: any) => c.class === 'truck')).toEqual({ class: 'truck', cents: 7000, maxCents: null })
  })

  it('what the server would refuse is said before sending, naming the service and size; Discard drops every row', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'prices')
    call(t.logic, 'live.prices.groups.0.rows.1.cells.0.setFrom', '38.50')
    call(t.logic, 'live.prices.save')
    expect(vals(t.logic).live.prices.error).toBe('Exterior Hand Wash · Compact car: enter whole dollars, like 40.')
    call(t.logic, 'live.prices.groups.0.rows.1.cells.0.setFrom', '38')
    call(t.logic, 'live.prices.groups.2.rows.0.cells.0.setTo', '200')
    call(t.logic, 'live.prices.save')
    expect(vals(t.logic).live.prices.error).toBe(
      'Carbon window tint · Compact car: the “up to” price can’t be below the price.',
    )
    expect(writes(t.calls, 'savePrices')).toHaveLength(0)
    call(t.logic, 'live.prices.discard')
    expect(vals(t.logic).live.prices).toMatchObject({ dirty: false, missing: '12 prices not set', error: '' })
  })

  it('a 412 names the row someone else changed; the copy is read again, their price shows, mine stay; Save again works', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'prices')
    call(t.logic, 'live.prices.groups.0.rows.0.cells.1.setFrom', '45')
    call(t.logic, 'live.prices.groups.1.rows.0.cells.1.setFrom', '35')
    // someone else priced Signature's Large SUV meanwhile
    t.cat.prices[0].cells.push({ class: 'large_suv', cents: 6000, maxCents: null })
    t.cat.prices[0].version = 4
    t.cat.packages[0].version = 4
    call(t.logic, 'live.prices.save')
    await vi.waitFor(() =>
      expect(vals(t.logic).live.prices.error).toBe(
        'Someone else changed the prices of Signature Hand Wash meanwhile, so nothing was saved. Their change is on screen now with your edits kept: check and save again.',
      ),
    )
    await vi.waitFor(() => expect(vals(t.logic).live.prices.groups[0].rows[0].cells[3].from).toBe('60'))
    const v = vals(t.logic).live.prices
    expect(v.groups[0].rows[0].cells[1].from).toBe('45')
    expect(v.groups[0].rows[0].sub).toMatch(/changed meanwhile/)
    expect(v.groups[1].rows[0].cells[1].from).toBe('35')
    expect(t.cat.addons[0].version).toBe(1)
    call(t.logic, 'live.prices.save')
    await vi.waitFor(() => expect(writes(t.calls, 'savePrices')).toHaveLength(2))
    expect(writes(t.calls, 'savePrices')[1]![1].rows.map((r: any) => [r.serviceId, r.version])).toEqual([
      ['p-sig', 4],
      ['a-wax', 1],
    ])
    await vi.waitFor(() => expect(vals(t.logic).live.prices).toMatchObject({ dirty: false, error: '' }))
  })

  it('the booking fee: whole dollars and how it is collected, saved with its version', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'prices')
    const fee = vals(t.logic).live.prices.fee
    expect(fee).toMatchObject({ amount: '25', dirty: false })
    expect(fee.opts.map((o: any) => o.label)).toEqual(['At the counter', 'By payment link'])
    expect(fee.sub).toMatch(/toward the visit/)
    call(t.logic, 'live.prices.fee.setAmount', '1500')
    call(t.logic, 'live.prices.fee.save')
    expect(vals(t.logic).live.prices.fee.error).toBe('The fee goes up to $1,000.')
    call(t.logic, 'live.prices.fee.setAmount', '30')
    call(t.logic, 'live.prices.fee.opts.1.onClick')
    call(t.logic, 'live.prices.fee.save')
    await vi.waitFor(() => expect(writes(t.calls, 'saveGuestFee')).toHaveLength(1))
    expect(writes(t.calls, 'saveGuestFee')[0]![1]).toEqual({ cents: 3000, collect: 'link', version: 0 })
    await vi.waitFor(() => expect(t.flashes).toContain('Booking fee saved · $30, by payment link'))
    await vi.waitFor(() => expect(vals(t.logic).live.prices.fee).toMatchObject({ amount: '30', dirty: false }))
  })

  it('without set.services typing is refused with the toast and nothing is sent', async () => {
    const t = makeExtrasLogic('support')
    await open(t.logic, 'prices')
    call(t.logic, 'live.prices.groups.0.rows.0.cells.1.setFrom', '45')
    call(t.logic, 'live.prices.fee.setAmount', '1')
    expect(t.flashes).toContain('Your role can’t edit packages and checklists')
    expect(vals(t.logic).live.prices.dirty).toBe(false)
    expect(t.calls.filter((c) => /^save|^create|^update|^delete/.test(c[0] as string))).toEqual([])
  })
})
