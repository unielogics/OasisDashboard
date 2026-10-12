import { describe, expect, it } from 'vitest'
import {
  changedCells,
  emptyCells,
  feeBody,
  feeDraft,
  fromLine,
  isRangeRow,
  notSetText,
  parseWhole,
  rowDraft,
  sizeInUseMessage,
  sizeKeyFromLabel,
  sizeProblem,
  sortSizes,
  staleRowMessage,
  wholeMoney,
  wholeText,
} from './sizes'
import type { PriceRowItem, VehicleClassItem } from './sizes'

const size = (key: string, label: string, sort: number, active = true): VehicleClassItem => ({
  key,
  label,
  sort,
  active,
  version: 1,
})
const SIZES = [
  size('compact_car', 'Compact car', 10),
  size('large_car', 'Large car', 20),
  size('compact_suv', 'Compact SUV', 30),
  size('large_suv', 'Large SUV', 40),
  size('truck', 'Truck', 50),
]
const ON = SIZES.filter((s) => s.active)
const row = (cells: PriceRowItem['cells'], over: Partial<PriceRowItem> = {}): PriceRowItem => ({
  serviceId: 's1',
  version: 3,
  cells,
  fromCents: cells.length ? Math.min(...cells.map((c) => c.cents)) : 0,
  missing: 5 - cells.length,
  ...over,
})

describe('vehicle sizes', () => {
  it('sorts by size order, then key', () => {
    expect(sortSizes([size('b', 'B', 20), size('c', 'C', 10), size('a', 'A', 20)]).map((s) => s.key)).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('a new size gets its key from the name; names are checked as the server would', () => {
    expect(sizeKeyFromLabel('Large SUV')).toBe('large_suv')
    expect(sizeKeyFromLabel('3-row SUV')).toBe('row_suv')
    expect(sizeProblem('', 'x', SIZES)).toBe('Give the size a name.')
    expect(sizeProblem('x'.repeat(41), 'x', SIZES)).toBe('The name is at most 40 characters.')
    expect(sizeProblem('123', '', SIZES)).toBe('Start the name with a letter.')
    expect(sizeProblem('Truck', 'truck', SIZES)).toBe('There is already a size with that name.')
    expect(sizeProblem('large suv', 'other', SIZES)).toBe('There is already a size with that name.')
    expect(sizeProblem('Minivan', 'minivan', SIZES)).toBeNull()
    // a rename: its own name is fine, another size's name is not
    expect(sizeProblem('Truck', null, SIZES, 'truck')).toBeNull()
    expect(sizeProblem('Compact car', null, SIZES, 'truck')).toBe('There is already a size with that name.')
  })

  it('a size in use says what uses it and to turn it off instead', () => {
    expect(sizeInUseMessage('Compact car', { key: 'compact_car', prices: 9, tierPrices: 1, vehicles: 3 })).toBe(
      'Compact car is in use (9 prices, 1 membership price, 3 vehicles), so it can’t be removed. Turn it off instead.',
    )
    expect(sizeInUseMessage('Truck', {})).toBe('Truck is in use, so it can’t be removed. Turn it off instead.')
  })
})

describe('whole dollars', () => {
  it('shows whole dollars rounded half up and reads only whole dollars', () => {
    expect(wholeText(4000)).toBe('40')
    expect(wholeText(4550)).toBe('46')
    expect(wholeText(4549)).toBe('45')
    expect(wholeText(null)).toBe('')
    expect(wholeMoney(125049)).toBe('$1,250')
    expect(wholeMoney(12950)).toBe('$130')
    expect(parseWhole('$1,250')).toBe(125000)
    expect(parseWhole(' 40 ')).toBe(4000)
    expect(parseWhole('')).toBeNull()
    expect(parseWhole('40.50')).toBeUndefined()
    expect(parseWhole('-4')).toBeUndefined()
    expect(parseWhole('forty')).toBeUndefined()
  })
})

describe('the price grid', () => {
  const base = row([
    { class: 'compact_car', cents: 4000, maxCents: null },
    { class: 'truck', cents: 6550, maxCents: null },
  ])

  it('a row shows a box per size on screen, whole dollars, empty when not set', () => {
    expect(rowDraft(base, ON)).toEqual({
      compact_car: { from: '40', to: '' },
      large_car: { from: '', to: '' },
      compact_suv: { from: '', to: '' },
      large_suv: { from: '', to: '' },
      truck: { from: '66', to: '' },
    })
    expect(emptyCells(rowDraft(base, ON), ON)).toBe(3)
    expect(notSetText(3)).toBe('3 prices not set')
    expect(notSetText(1)).toBe('1 price not set')
    expect(notSetText(0)).toBe('')
  })

  it('only changed cells are sent; an untouched cell keeps its cents on the server; empty clears', () => {
    const b = rowDraft(base, ON)
    const d = { ...b, large_car: { from: '50', to: '' }, compact_car: { from: '', to: '' } }
    expect(changedCells(d, b, ON, 'Signature')).toEqual({
      ok: true,
      value: [
        { class: 'compact_car', cents: null, maxCents: null },
        { class: 'large_car', cents: 5000, maxCents: null },
      ],
    })
    expect(changedCells(b, b, ON, 'Signature')).toEqual({ ok: true, value: [] })
  })

  it('refuses what the server would, naming the service and the size', () => {
    const b = rowDraft(base, ON)
    const bad = (cell: { from: string; to: string }) => changedCells({ ...b, large_suv: cell }, b, ON, 'Carbon tint')
    expect(bad({ from: '40.5', to: '' })).toMatchObject({
      ok: false,
      message: 'Carbon tint · Large SUV: enter whole dollars, like 40.',
    })
    expect(bad({ from: '', to: '300' })).toMatchObject({ message: 'Carbon tint · Large SUV: set the price before the “up to” price.' })
    expect(bad({ from: '300', to: '200' })).toMatchObject({
      message: 'Carbon tint · Large SUV: the “up to” price can’t be below the price.',
    })
    expect(bad({ from: '100001', to: '' })).toMatchObject({ message: 'Carbon tint · Large SUV: prices go up to $100,000.' })
    expect(bad({ from: '229', to: '359' })).toEqual({
      ok: true,
      value: [{ class: 'large_suv', cents: 22900, maxCents: 35900 }],
    })
  })

  it('tint rows and rows with a range show from–to boxes', () => {
    expect(isRangeRow('tint', undefined)).toBe(true)
    expect(isRangeRow('wash', base)).toBe(false)
    expect(isRangeRow('wash', row([{ class: 'truck', cents: 100, maxCents: 200 }]))).toBe(true)
  })

  it('the Catalog line: starting price and sizes not set; no price yet; quote only', () => {
    expect(fromLine(base, false, 4000, SIZES)).toBe('from $40 · 3 sizes not set')
    expect(fromLine(row(SIZES.map((s) => ({ class: s.key, cents: 4000, maxCents: null }))), false, 4000, SIZES)).toBe(
      'from $40',
    )
    expect(fromLine(row([]), false, 5400, SIZES)).toBe('No prices yet · books at $54')
    expect(fromLine(undefined, false, 0, SIZES)).toBe('No prices yet')
    expect(fromLine(base, true, 0, SIZES)).toBe('Quote only')
    // a turned-off size neither counts as missing nor as set
    const off = SIZES.map((s) => (s.key === 'truck' ? { ...s, active: false } : s))
    expect(fromLine(base, false, 4000, off)).toBe('from $40 · 3 sizes not set')
  })

  it('a stale row names the service', () => {
    expect(staleRowMessage('Signature Hand Wash')).toBe(
      'Someone else changed the prices of Signature Hand Wash meanwhile, so nothing was saved. Their change is on screen now with your edits kept: check and save again.',
    )
    expect(staleRowMessage(null)).toMatch(/^Someone else changed these prices meanwhile/)
  })
})

describe('the booking fee', () => {
  it('whole dollars from $0 to $1,000, collected at the counter or by link, with the version', () => {
    const d = feeDraft({ cents: 2500, collect: 'counter', version: 4 })
    expect(d).toEqual({ amount: '25', collect: 'counter' })
    expect(feeBody({ amount: '30', collect: 'link' }, 4)).toEqual({
      ok: true,
      value: { cents: 3000, collect: 'link', version: 4 },
    })
    expect(feeBody({ amount: '0', collect: 'counter' }, 0)).toMatchObject({ ok: true, value: { cents: 0 } })
    expect(feeBody({ amount: '', collect: 'counter' }, 0)).toMatchObject({ ok: false })
    expect(feeBody({ amount: '25.50', collect: 'counter' }, 0)).toMatchObject({ ok: false })
    expect(feeBody({ amount: '1001', collect: 'counter' }, 0)).toMatchObject({
      ok: false,
      message: 'The fee goes up to $1,000.',
    })
  })
})
