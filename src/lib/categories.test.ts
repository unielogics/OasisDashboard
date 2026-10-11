import { describe, expect, it } from 'vitest'
import {
  NEUTRAL,
  categoryChipStyle,
  categoryChips,
  chipInk,
  darken,
  luminance,
  categoryColour,
  categoryLabel,
  keyLabel,
  matchesCategory,
  swatchStyle,
} from './categories'

const cats = [
  { key: 'wash', label: 'Wash', colour: '#0E7A63', active: true },
  { key: 'tint', label: 'Tint', colour: '#2563EB', active: true },
  { key: 'mixed', label: 'Mixed', colour: null },
]

describe('categories', () => {
  it('labels: the list first, then mixed / none, then the key itself', () => {
    expect(categoryLabel('tint', cats)).toBe('Tint')
    expect(categoryLabel('mixed', [])).toBe('Mixed')
    expect(categoryLabel('_none', [])).toBe('No category')
    expect(categoryLabel('paint_care', cats)).toBe('Paint care')
    expect(keyLabel('')).toBe('')
  })

  it('colours: a list colour when it is a hex, else the neutral', () => {
    expect(categoryColour('tint', cats)).toBe('#2563EB')
    expect(categoryColour('mixed', cats)).toBe(NEUTRAL)
    expect(categoryColour('nope', cats)).toBe(NEUTRAL)
    expect(categoryColour('x', [{ key: 'x', label: 'X', colour: 'red' }])).toBe(NEUTRAL)
  })

  it('chips follow the server order, drop repeats and blanks, and differ by theme', () => {
    const light = categoryChips(['tint', 'wash', 'tint', ''], cats, false, 'card')
    expect(light.map((c) => c.label)).toEqual(['Tint', 'Wash'])
    expect(light[0]!.style.background).toBe('rgba(37,99,235,0.14)')
    expect(light[0]!.style.color).toBe('#2563EB')
    const dark = categoryChips(['tint'], cats, true, 'file')
    expect(dark[0]!.style.background).toBe('rgba(37,99,235,0.2)')
    expect(dark[0]!.style.color).toMatch(/^rgb\(/)
    expect(dark[0]!.style.fontSize).toBe('11px')
    expect(categoryChips(null, cats, false, 'row')).toEqual([])
  })

  it('a bright colour gets a darker ink on light and keeps itself on dark; a deep one the opposite', () => {
    expect(chipInk('#7FD6FF', false)).toMatch(/^rgb\(/)
    expect(chipInk('#7FD6FF', true)).toBe('#7FD6FF')
    expect(chipInk('#2563EB', false)).toBe('#2563EB')
    expect(chipInk('#2563EB', true)).toMatch(/^rgb\(/)
    expect(luminance('#FFFFFF')).toBeCloseTo(1)
    expect(luminance('#000000')).toBe(0)
    expect(darken('#FFFFFF', 0.5)).toBe('rgb(128,128,128)')
  })

  it('chip and swatch styles never take a colour that is not a hex', () => {
    expect(categoryChipStyle('javascript:x', false, 'row').color).toBe(NEUTRAL)
    expect(swatchStyle(null).background).toBe(NEUTRAL)
    expect(swatchStyle('#C2740B', 16)).toMatchObject({ width: '16px', borderRadius: '5px', background: '#C2740B' })
  })

  it('the board filter: all, mixed by the counted word, a category by the visit holding it', () => {
    const mixed = { categories: ['wash', 'tint'], category: 'mixed' }
    const wash = { categories: ['wash', 'addons'], category: 'wash' }
    expect(matchesCategory('all', { categories: [] })).toBe(true)
    expect(matchesCategory('mixed', mixed)).toBe(true)
    expect(matchesCategory('mixed', wash)).toBe(false)
    expect(matchesCategory('tint', mixed)).toBe(true)
    expect(matchesCategory('tint', wash)).toBe(false)
    expect(matchesCategory('addons', wash)).toBe(true)
    expect(matchesCategory('wash', { categories: null, category: null })).toBe(false)
  })
})
