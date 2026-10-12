// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// Settings → Memberships (live only, ADR 0170, DV-324) on the view model with the fake API: the tier list with each tier's
// starting price and state, the editor saved whole with the version (name, colour, on, public, VIP booking, % off with
// its example, max cars, perks, inclusions by kind with the services they cover), order at once, add and remove (a sold
// tier says to turn it off), and the tier × size monthly grid saved with each tier's priceVersion (a 412 names the tier),
// with the Square state read only; no request without set.services.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { atPath } from '../testkit'
import { makeExtrasLogic } from './extras-testkit'

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
const open = async (logic: any): Promise<any> => {
  logic.setState({ section: 'memberships' })
  await vi.waitFor(() => expect(vals(logic).live.secMemberships).toBe(true))
  return vals(logic).live.mem
}
const writes = (calls: any[][], name: string) => calls.filter((c) => c[0] === name)

describe('Settings → Memberships: tiers', () => {
  it('the list with each tier’s starting price and state; the first one is open in the editor', async () => {
    const t = makeExtrasLogic()
    call(t.logic, 'live.goMemberships')
    expect(vals(t.logic).secTitle).toBe('Memberships')
    const mem = await open(t.logic)
    expect(mem.list.map((x: any) => [x.name, x.sub])).toEqual([
      ['Gold', 'from $129/mo · on the website'],
      ['VIP', 'no price yet · not sold online until priced · VIP booking'],
    ])
    expect(mem.t).toMatchObject({
      title: 'Gold',
      sub: 'Key gold · was premium · not sold yet · Square: not synced yet',
      name: 'Gold',
      colour: '#8A6D3B',
      discount: '0',
      maxCars: '',
      perks: '4 hand washes a month\nMember prices on everything',
      canRemove: true,
      dirty: false,
    })
    expect(mem.t.discountHint).toBe('No % off: members pay the regular price for what their plan does not include.')
    expect(mem.t.toggles.map((x: any) => [x.label, x.track.background])).toEqual([
      ['On', 'var(--accent)'],
      ['On the website', 'var(--accent)'],
      ['VIP booking', 'var(--line)'],
    ])
    const inc = mem.t.inclusions[0]
    expect(inc.label).toBe('Hand washes')
    expect(inc.kinds.map((k: any) => [k.label, k.style.background])).toEqual([
      ['Per month', 'var(--accent)'],
      ['Unlimited', 'transparent'],
      ['Every wash', 'transparent'],
    ])
    expect(inc).toMatchObject({ showCount: true, count: '4' })
    expect(inc.summary).toBe('Hand washes: 4 a month · Signature Hand Wash, Exterior Hand Wash')
    expect(inc.services.map((s: any) => s.label)).toEqual([
      'Signature Hand Wash',
      'Exterior Hand Wash',
      'Carbon window tint',
      'Rim powder coating',
      'Hand wax',
    ])
    expect(inc.services.filter((s: any) => s.style.background === 'var(--accentSoft)')).toHaveLength(2)
    call(t.logic, 'live.mem.list.1.onClick')
    expect(vals(t.logic).live.mem.t).toMatchObject({
      title: 'VIP',
      sub: 'Key vip · was executive · sold: can be turned off, not removed · Square: not synced yet',
      discount: '10',
      maxCars: '2',
      canRemove: false,
    })
    expect(vals(t.logic).live.mem.t.inclusions[0]).toMatchObject({ showCount: false, summary: 'Hand wax: every wash · Hand wax' })
  })

  it('the editor is a draft until Save; the PUT is the whole tier with its version and the inclusions by kind', async () => {
    const t = makeExtrasLogic()
    await open(t.logic)
    call(t.logic, 'live.mem.t.setName', 'Gold Club')
    call(t.logic, 'live.mem.t.swatches.1.onClick')
    call(t.logic, 'live.mem.t.toggles.2.toggle')
    call(t.logic, 'live.mem.t.setDiscount', '10')
    expect(vals(t.logic).live.mem.t.discountHint).toBe(
      'Members pay 10% less on what their plan does not include: Signature Hand Wash $40 costs them $36. The size difference gets no % off.',
    )
    call(t.logic, 'live.mem.t.setMaxCars', '3')
    call(t.logic, 'live.mem.t.setPerks', 'Unlimited hand washes\n\nMember prices')
    call(t.logic, 'live.mem.t.inclusions.0.kinds.1.onClick')
    call(t.logic, 'live.mem.t.inclusions.0.services.1.onClick')
    call(t.logic, 'live.mem.t.addInclusion')
    call(t.logic, 'live.mem.t.inclusions.1.setLabel', 'Hand wax')
    call(t.logic, 'live.mem.t.inclusions.1.setCount', '2')
    call(t.logic, 'live.mem.t.inclusions.1.services.4.onClick')
    call(t.logic, 'live.mem.t.inclusions.1.toggleAuto')
    const v = vals(t.logic).live.mem
    expect(v.list[0]).toMatchObject({ name: 'Gold Club', sub: 'from $129/mo · on the website · unsaved' })
    expect(v.t.inclusions[1].summary).toBe('Hand wax: 2 a month · Hand wax')
    expect(writes(t.calls, 'saveTier')).toHaveLength(0)
    call(t.logic, 'live.mem.t.save')
    await vi.waitFor(() => expect(writes(t.calls, 'saveTier')).toHaveLength(1))
    expect(writes(t.calls, 'saveTier')[0]!.slice(1, 3)).toEqual([
      'gold',
      {
        name: 'Gold Club',
        // the second swatch offered (the first is the tier's own colour)
        colour: '#1FB6FF',
        sort: 30,
        active: true,
        public: true,
        vipBooking: true,
        memberDiscountBp: 1000,
        maxVehicles: 3,
        perks: ['Unlimited hand washes', 'Member prices'],
        checkoutUrl: null,
        inclusions: [
          {
            id: 'inc-gold-wash',
            label: 'Hand washes',
            mode: 'per_cycle',
            perCycle: null,
            autoApply: true,
            active: true,
            serviceIds: ['p-sig'],
          },
          { label: 'Hand wax', mode: 'per_cycle', perCycle: 2, autoApply: false, active: true, serviceIds: ['a-wax'] },
        ],
        version: 3,
      },
    ])
    await vi.waitFor(() => expect(t.flashes).toContain('Saved the Gold Club tier'))
    await vi.waitFor(() => expect(vals(t.logic).live.mem.t.dirty).toBe(false))
  })

  it('what the server would refuse is said before sending; Discard shows the saved tier', async () => {
    const t = makeExtrasLogic()
    await open(t.logic)
    call(t.logic, 'live.mem.t.setDiscount', '120')
    call(t.logic, 'live.mem.t.save')
    expect(vals(t.logic).live.mem.t.error).toBe('Enter the member % off from 0 to 100, like 10 or 12.5.')
    expect(vals(t.logic).live.mem.t.discountHint).toMatch(/^Enter the % off/)
    call(t.logic, 'live.mem.t.setDiscount', '5')
    call(t.logic, 'live.mem.t.inclusions.0.services.0.onClick')
    call(t.logic, 'live.mem.t.inclusions.0.services.1.onClick')
    call(t.logic, 'live.mem.t.save')
    expect(vals(t.logic).live.mem.t.error).toBe('Hand washes: pick at least one service it covers.')
    call(t.logic, 'live.mem.t.inclusions.0.remove')
    expect(vals(t.logic).live.mem.t.noInclusions).toBe(true)
    expect(writes(t.calls, 'saveTier')).toHaveLength(0)
    call(t.logic, 'live.mem.t.discard')
    expect(vals(t.logic).live.mem.t).toMatchObject({ discount: '0', dirty: false, error: '', noInclusions: false })
  })

  it('order is sent at once (each tier whole with its new order); a sold tier cannot be removed, an unsold one can', async () => {
    const t = makeExtrasLogic()
    await open(t.logic)
    call(t.logic, 'live.mem.t.down')
    await vi.waitFor(() => expect(writes(t.calls, 'saveTier')).toHaveLength(2))
    expect(writes(t.calls, 'saveTier').map((c) => [c[1], (c[2] as any).sort, (c[2] as any).version])).toEqual([
      ['gold', 40, 3],
      ['vip', 30, 2],
    ])
    expect((writes(t.calls, 'saveTier')[0]![2] as any).inclusions[0].id).toBe('inc-gold-wash')
    await vi.waitFor(() => expect(vals(t.logic).live.mem.list.map((x: any) => x.name)).toEqual(['VIP', 'Gold']))
    // no tier was picked, so the first one (now VIP) is open
    expect(vals(t.logic).live.mem.t.title).toBe('VIP')
    call(t.logic, 'live.mem.list.1.onClick')
    call(t.logic, 'live.mem.t.remove')
    await vi.waitFor(() => expect(t.flashes).toContain('Removed the Gold tier'))
    expect(writes(t.calls, 'deleteTier')[0]!.slice(1, 3)).toEqual(['gold', 4])
    await vi.waitFor(() => expect(vals(t.logic).live.mem.list).toHaveLength(1))
    expect(vals(t.logic).live.mem.t).toMatchObject({ title: 'VIP', canRemove: false })
  })

  it('add: the key from the name (an old key counts as taken), off the website, then it is the one open', async () => {
    const t = makeExtrasLogic()
    await open(t.logic)
    call(t.logic, 'live.mem.add.start')
    call(t.logic, 'live.mem.add.setName', 'Premium')
    call(t.logic, 'live.mem.add.save')
    expect(vals(t.logic).live.mem.add.error).toBe('There is already a tier with that name.')
    call(t.logic, 'live.mem.add.setName', 'Platinum')
    call(t.logic, 'live.mem.add.swatches.2.onClick')
    expect(vals(t.logic).live.mem.add.keyLine).toBe('Key: platinum (set once, never changes)')
    call(t.logic, 'live.mem.add.onKey', '', 'Enter')
    await vi.waitFor(() => expect(writes(t.calls, 'createTier')).toHaveLength(1))
    expect(writes(t.calls, 'createTier')[0]![1]).toEqual({
      key: 'platinum',
      name: 'Platinum',
      colour: '#2EE59D',
      sort: 50,
      active: true,
      public: false,
      vipBooking: false,
      memberDiscountBp: 0,
      maxVehicles: null,
      perks: [],
      checkoutUrl: null,
      inclusions: [],
    })
    await vi.waitFor(() => expect(t.flashes).toContain('Added the Platinum tier · set what it includes and its prices'))
    await vi.waitFor(() => expect(vals(t.logic).live.mem.t.title).toBe('Platinum'))
    expect(vals(t.logic).live.mem.list[2].sub).toBe('no price yet · staff only')
  })

  it('without set.services the editor and the grid refuse with the toast and nothing is sent', async () => {
    const t = makeExtrasLogic('support')
    await open(t.logic)
    call(t.logic, 'live.mem.t.setName', 'x')
    call(t.logic, 'live.mem.t.toggles.0.toggle')
    call(t.logic, 'live.mem.grid.rows.0.cells.0.set', '1')
    call(t.logic, 'live.mem.t.down')
    call(t.logic, 'live.mem.add.start')
    expect(t.flashes).toContain('Your role can’t edit packages and checklists')
    expect(vals(t.logic).live.mem.t.dirty).toBe(false)
    expect(t.calls.filter((c) => /^save|^create|^update|^delete/.test(c[0] as string))).toEqual([])
  })
})

describe('Settings → Memberships: monthly prices by plan size', () => {
  it('rows are tiers, columns the sizes that are on; whole dollars; the Square state of each price, read only', async () => {
    const t = makeExtrasLogic()
    const mem = await open(t.logic)
    expect(mem.grid.heads.map((h: any) => h.label)).toEqual(['Compact car', 'Large car', 'Compact SUV', 'Large SUV'])
    expect(mem.grid.rows.map((r: any) => [r.name, r.sub])).toEqual([
      ['Gold', 'Price version 2'],
      ['VIP', 'Price version 1'],
    ])
    expect(mem.grid.rows[0].cells.map((c: any) => [c.value, c.state])).toEqual([
      ['129', 'Not synced yet'],
      ['', 'No price'],
      ['', 'No price'],
      ['', 'No price'],
    ])
    expect(mem.grid.note).toMatch(/members keep the price they joined at/)
  })

  it('one Save sends the changed tiers with their priceVersion; the version moves; members keep theirs (said)', async () => {
    const t = makeExtrasLogic()
    await open(t.logic)
    call(t.logic, 'live.mem.grid.rows.0.cells.0.set', '139')
    call(t.logic, 'live.mem.grid.rows.1.cells.2.set', '199')
    expect(vals(t.logic).live.mem.grid).toMatchObject({ dirty: true, dirtyText: '2 tiers changed' })
    call(t.logic, 'live.mem.grid.save')
    await vi.waitFor(() => expect(writes(t.calls, 'saveTierPrices')).toHaveLength(1))
    expect(writes(t.calls, 'saveTierPrices')[0]![1]).toEqual({
      rows: [
        { tierKey: 'gold', priceVersion: 2, cells: [{ class: 'compact_car', monthlyCents: 13900 }] },
        { tierKey: 'vip', priceVersion: 1, cells: [{ class: 'compact_suv', monthlyCents: 19900 }] },
      ],
    })
    await vi.waitFor(() =>
      expect(t.flashes).toContain('Monthly prices saved · 2 tiers · members keep the price they joined at'),
    )
    await vi.waitFor(() => expect(vals(t.logic).live.mem.grid.rows[0].sub).toBe('Price version 3'))
    expect(vals(t.logic).live.mem.grid.rows[0].cells[0]).toMatchObject({ value: '139', state: 'Not synced yet' })
    expect(vals(t.logic).live.mem.list[1].sub).toBe('from $199/mo · on the website · VIP booking')
  })

  it('a draft open while a size is turned on shows the monthly price that size kept; Save does not clear it', async () => {
    const t = makeExtrasLogic()
    t.cat.tiers[0].prices.push({
      class: 'truck',
      monthlyCents: 19900,
      priceVersion: 2,
      effectiveFrom: '2026-10-12T14:00:00.000Z',
      squareState: 'pending',
    })
    await open(t.logic)
    call(t.logic, 'live.mem.grid.rows.0.cells.0.set', '139')
    t.logic.setState({ section: 'sizes' })
    await vi.waitFor(() => expect(vals(t.logic).live.secSizes).toBe(true))
    call(t.logic, 'live.sizes.rows.4.toggle')
    await vi.waitFor(() => expect(t.flashes).toContain('Truck is on'))
    await open(t.logic)
    await vi.waitFor(() => expect(vals(t.logic).live.mem.grid.heads).toHaveLength(5))
    const gold = vals(t.logic).live.mem.grid.rows[0]
    expect(gold.cells.map((c: any) => c.value)).toEqual(['139', '', '', '', '199'])
    expect(gold.cells[4].style.background).toBe('var(--panel)')
    expect(gold.sub).toBe('Price version 2 · unsaved')
    call(t.logic, 'live.mem.grid.save')
    await vi.waitFor(() => expect(writes(t.calls, 'saveTierPrices')).toHaveLength(1))
    expect(writes(t.calls, 'saveTierPrices')[0]![1]).toEqual({
      rows: [{ tierKey: 'gold', priceVersion: 2, cells: [{ class: 'compact_car', monthlyCents: 13900 }] }],
    })
    expect(t.cat.tiers[0].prices.find((p: any) => p.class === 'truck').monthlyCents).toBe(19900)
  })

  it('a size turned off while its monthly price is edited: the edit is kept, the row says so, Save sends it', async () => {
    const t = makeExtrasLogic()
    await open(t.logic)
    call(t.logic, 'live.mem.grid.rows.0.cells.1.set', '149')
    t.logic.setState({ section: 'sizes' })
    await vi.waitFor(() => expect(vals(t.logic).live.secSizes).toBe(true))
    call(t.logic, 'live.sizes.rows.1.toggle')
    await vi.waitFor(() => expect(t.flashes).toContain('Large car is off · not offered, its prices are kept'))
    await open(t.logic)
    await vi.waitFor(() => expect(vals(t.logic).live.mem.grid.heads).toHaveLength(3))
    expect(vals(t.logic).live.mem.grid.rows[0].sub).toBe('Price version 2 · unsaved · also changed: Large car (off)')
    call(t.logic, 'live.mem.grid.save')
    await vi.waitFor(() => expect(writes(t.calls, 'saveTierPrices')).toHaveLength(1))
    expect(writes(t.calls, 'saveTierPrices')[0]![1]).toEqual({
      rows: [{ tierKey: 'gold', priceVersion: 2, cells: [{ class: 'large_car', monthlyCents: 14900 }] }],
    })
  })

  it('a refused cell is named before sending; a 412 names the tier, reads again and keeps the edits', async () => {
    const t = makeExtrasLogic()
    await open(t.logic)
    call(t.logic, 'live.mem.grid.rows.0.cells.1.set', '149.99')
    call(t.logic, 'live.mem.grid.save')
    expect(vals(t.logic).live.mem.grid.error).toBe('Gold · Large car: enter whole dollars a month, like 129.')
    call(t.logic, 'live.mem.grid.rows.0.cells.1.set', '149')
    t.cat.tiers[0].priceVersion = 5
    call(t.logic, 'live.mem.grid.save')
    await vi.waitFor(() =>
      expect(vals(t.logic).live.mem.grid.error).toMatch(/^Someone else changed the Gold prices meanwhile, so nothing was saved/),
    )
    await vi.waitFor(() => expect(vals(t.logic).live.mem.grid.rows[0].sub).toMatch(/^Price version 5 · changed meanwhile/))
    expect(vals(t.logic).live.mem.grid.rows[0].cells[1].value).toBe('149')
    call(t.logic, 'live.mem.grid.save')
    await vi.waitFor(() => expect(writes(t.calls, 'saveTierPrices')).toHaveLength(2))
    expect(writes(t.calls, 'saveTierPrices')[1]![1].rows[0].priceVersion).toBe(5)
  })
})
