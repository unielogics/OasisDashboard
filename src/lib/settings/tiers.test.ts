import { describe, expect, it } from 'vitest'
import {
  changedTierCells,
  discountHint,
  inclusionCountText,
  memberCents,
  newInclusion,
  newTierBody,
  newTierProblem,
  parsePercent,
  percentText,
  squareStateText,
  staleTierMessage,
  tierBody,
  tierBodyOf,
  tierDraft,
  tierKeyFromName,
  tierPriceDraft,
  tierSub,
} from './tiers'
import type { TierItem } from './tiers'
import type { VehicleClassItem } from './sizes'

const SIZES: VehicleClassItem[] = [
  { key: 'compact_car', label: 'Compact car', sort: 10, active: true, version: 1 },
  { key: 'large_car', label: 'Large car', sort: 20, active: true, version: 1 },
  { key: 'truck', label: 'Truck', sort: 50, active: true, version: 1 },
]

const gold: TierItem = {
  key: 'gold',
  name: 'Gold',
  colour: '#8A6D3B',
  bgColour: '#F1EDE7',
  sort: 30,
  active: true,
  public: true,
  vipBooking: false,
  memberDiscountBp: 1000,
  maxVehicles: null,
  perks: ['4 hand washes a month', 'Member prices on everything'],
  checkoutUrl: null,
  legacyKey: 'premium',
  priceVersion: 2,
  version: 5,
  squarePlanId: null,
  inclusions: [
    {
      id: 'inc-1',
      label: 'Hand washes',
      mode: 'per_cycle',
      perCycle: 4,
      autoApply: true,
      active: true,
      serviceIds: ['p-sig', 'p-ext'],
    },
    { id: 'inc-2', label: 'Tire shine', mode: 'every_visit', perCycle: null, autoApply: false, active: true, serviceIds: ['a-tire'] },
    { id: 'inc-3', label: 'Old rule', mode: 'per_cycle', perCycle: null, autoApply: true, active: false, serviceIds: ['p-sig'] },
  ],
  prices: [{ class: 'compact_car', monthlyCents: 12900, priceVersion: 2, effectiveFrom: '2026-10-12T00:00:00Z', squareState: 'pending' }],
  fromMonthlyCents: 12900,
  sold: false,
}

describe('member % off', () => {
  it('basis points <-> the % typed', () => {
    expect(percentText(1000)).toBe('10')
    expect(percentText(1250)).toBe('12.5')
    expect(percentText(1205)).toBe('12.05')
    expect(percentText(0)).toBe('0')
    expect(parsePercent('10')).toBe(1000)
    expect(parsePercent('12.5 %')).toBe(1250)
    expect(parsePercent('')).toBe(0)
    expect(parsePercent('100')).toBe(10_000)
    expect(parsePercent('101')).toBeUndefined()
    expect(parsePercent('1.234')).toBeUndefined()
    expect(parsePercent('ten')).toBeUndefined()
  })

  it('the member price is computed like the server: whole dollars, half up, never above the price', () => {
    expect(memberCents(4000, 1000)).toBe(3600)
    expect(memberCents(4500, 1000)).toBe(4100) // 40.50 -> 41
    expect(memberCents(4400, 1000)).toBe(4000) // 39.60 -> 40
    expect(memberCents(4000, 0)).toBe(4000)
    expect(memberCents(4050, 0)).toBe(4050)
    expect(memberCents(4000, 10_000)).toBe(0)
  })

  it('the hint under the box says what a sample costs members', () => {
    expect(discountHint(1000, { name: 'Signature Hand Wash', cents: 4000 })).toBe(
      'Members pay 10% less on what their plan does not include: Signature Hand Wash $40 costs them $36. The size difference gets no % off.',
    )
    expect(discountHint(0, null)).toMatch(/^No % off/)
    expect(discountHint(undefined, null)).toMatch(/^Enter the % off/)
  })
})

describe('the tier editor', () => {
  it('a draft reads the tier; an unchanged draft is the same tier again', () => {
    const d = tierDraft(gold)
    expect(d).toMatchObject({ name: 'Gold', discount: '10', maxCars: '', perks: '4 hand washes a month\nMember prices on everything' })
    expect(d.inclusions.map((i) => [i.kind, i.count])).toEqual([
      ['count', '4'],
      ['every_visit', ''],
      ['unlimited', ''],
    ])
    const b = tierBody(d, gold, 5)
    expect(b).toEqual({ ok: true, value: { ...tierBodyOf(gold, {}), colour: '#8A6D3B' } })
  })

  it('the PUT body: % to basis points, cars, perks, inclusions by kind, new ones without an id', () => {
    const d = tierDraft(gold)
    d.discount = '12.5'
    d.maxCars = '3'
    d.perks = ' a \n\n b \n a '
    d.inclusions[0] = { ...d.inclusions[0]!, kind: 'unlimited' }
    d.inclusions.push({ ...newInclusion(), label: 'Interior', count: '2', serviceIds: ['p-int', 'p-int'] })
    const b = tierBody(d, gold, 6)
    expect(b.ok).toBe(true)
    if (!b.ok) return
    expect(b.value).toMatchObject({ memberDiscountBp: 1250, maxVehicles: 3, perks: ['a', 'b'], version: 6, sort: 30 })
    expect(b.value.inclusions[0]).toMatchObject({ id: 'inc-1', mode: 'per_cycle', perCycle: null })
    expect(b.value.inclusions[1]).toMatchObject({ id: 'inc-2', mode: 'every_visit', perCycle: null })
    expect(b.value.inclusions[3]).toEqual({
      label: 'Interior',
      mode: 'per_cycle',
      perCycle: 2,
      autoApply: true,
      active: true,
      serviceIds: ['p-int'],
    })
  })

  it('says what the server would refuse', () => {
    const bad = (patch: Partial<ReturnType<typeof tierDraft>>) => tierBody({ ...tierDraft(gold), ...patch }, gold, 5)
    expect(bad({ name: ' ' })).toMatchObject({ ok: false, message: 'Give the tier a name.' })
    expect(bad({ colour: 'gold' })).toMatchObject({ ok: false, field: 'colour' })
    expect(bad({ discount: '150' })).toMatchObject({ ok: false, field: 'discount' })
    expect(bad({ maxCars: '0' })).toMatchObject({ ok: false, field: 'maxCars' })
    expect(bad({ maxCars: '21' })).toMatchObject({ ok: false, field: 'maxCars' })
    expect(bad({ checkoutUrl: 'http://x.com' })).toMatchObject({ ok: false, field: 'checkoutUrl' })
    expect(bad({ inclusions: [{ ...newInclusion(), label: 'Washes', serviceIds: [] }] })).toMatchObject({
      ok: false,
      message: 'Washes: pick at least one service it covers.',
    })
    expect(bad({ inclusions: [{ ...newInclusion(), label: 'Washes', count: '0', serviceIds: ['x'] }] })).toMatchObject({
      message: 'Washes: enter how many a month, from 1 to 100.',
    })
    expect(bad({ inclusions: [{ ...newInclusion(), serviceIds: ['x'] }] })).toMatchObject({
      message: 'Inclusion 1: give it a name, like “Hand washes”.',
    })
  })

  it('order and on/off re-send the server copy whole with one change', () => {
    expect(tierBodyOf(gold, { sort: 40 })).toMatchObject({ sort: 40, version: 5, name: 'Gold' })
    expect(tierBodyOf(gold, { active: false }).inclusions).toHaveLength(3)
  })

  it('a new tier: key from the name, after the last one, off the website, checked first', () => {
    expect(tierKeyFromName('Platinum Plus')).toBe('platinum_plus')
    expect(newTierBody('platinum', ' Platinum ', '#123abc', [gold])).toEqual({
      key: 'platinum',
      name: 'Platinum',
      colour: '#123ABC',
      sort: 40,
      active: true,
      public: false,
      vipBooking: false,
      memberDiscountBp: 0,
      maxVehicles: null,
      perks: [],
      checkoutUrl: null,
      inclusions: [],
    })
    expect(newTierProblem('Gold', '#123ABC', 'gold', [gold])).toBe('There is already a tier with that name.')
    expect(newTierProblem('Premium', '#123ABC', 'premium', [gold])).toBe('There is already a tier with that name.')
    expect(newTierProblem('', '#123ABC', '', [gold])).toBe('Give the tier a name.')
    expect(newTierProblem('Silver', 'x', 'silver', [gold])).toMatch(/colour/)
    expect(newTierProblem('Silver', '#123ABC', 'silver', [gold])).toBeNull()
  })

  it('list lines, inclusion counts and Square states in plain words', () => {
    expect(tierSub(gold, false)).toBe('from $129/mo · on the website')
    expect(tierSub({ ...gold, fromMonthlyCents: null, vipBooking: true }, true)).toBe(
      'no price yet · not sold online until priced · VIP booking · unsaved',
    )
    expect(tierSub({ ...gold, active: false }, false)).toBe('from $129/mo · off')
    expect(tierSub({ ...gold, public: false }, false)).toBe('from $129/mo · staff only')
    expect(inclusionCountText({ kind: 'count', count: '4' })).toBe('4 a month')
    expect(inclusionCountText({ kind: 'unlimited', count: '' })).toBe('unlimited')
    expect(inclusionCountText({ kind: 'every_visit', count: '' })).toBe('every wash')
    expect(squareStateText('pending')).toBe('Not synced yet')
    expect(squareStateText(undefined)).toBe('Not synced yet')
    expect(squareStateText('synced')).toBe('On Square')
    expect(squareStateText('failed')).toBe('Square sync failed')
  })
})

describe('the monthly price grid', () => {
  it('whole dollars per size; only changed cells are sent; empty clears; a stale tier is named', () => {
    const base = tierPriceDraft(gold, SIZES)
    expect(base).toEqual({ compact_car: '129', large_car: '', truck: '' })
    expect(changedTierCells({ ...base, large_car: '149', compact_car: '' }, base, SIZES, 'Gold')).toEqual({
      ok: true,
      value: [
        { class: 'compact_car', monthlyCents: null },
        { class: 'large_car', monthlyCents: 14900 },
      ],
    })
    expect(changedTierCells({ ...base, truck: '9.99' }, base, SIZES, 'Gold')).toMatchObject({
      ok: false,
      message: 'Gold · Truck: enter whole dollars a month, like 129.',
    })
    // a size missing from an older draft is not sent: its kept monthly price stays
    const older: Record<string, string> = { ...base, compact_car: '139' }
    delete older.truck
    expect(changedTierCells(older, { ...base, truck: '199' }, SIZES, 'Gold')).toEqual({
      ok: true,
      value: [{ class: 'compact_car', monthlyCents: 13900 }],
    })
    expect(staleTierMessage('Gold')).toMatch(/^Someone else changed the Gold prices meanwhile, so nothing was saved/)
  })
})
