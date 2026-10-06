import { describe, expect, it } from 'vitest'
import { formatCents, formatCentsCompact, taxCents } from './money'

describe('formatCents', () => {
  it('formats integer cents with U+2212 for negatives', () => {
    expect(formatCents(0)).toBe('$0.00')
    expect(formatCents(5)).toBe('$0.05')
    expect(formatCents(12900)).toBe('$129.00')
    expect(formatCents(123456789)).toBe('$1,234,567.89')
    expect(formatCents(-1250)).toBe('−$12.50')
    expect(formatCents(-1)).toBe('−$0.01')
  })
  it('rejects non-integers instead of rounding silently', () => {
    expect(() => formatCents(12.5)).toThrow(RangeError)
    expect(() => formatCents(NaN)).toThrow(RangeError)
  })
  it('compact form shows cents only when not whole dollars (Operations money rule)', () => {
    expect(formatCentsCompact(12900)).toBe('$129')
    expect(formatCentsCompact(129853)).toBe('$1,298.53')
    expect(formatCentsCompact(-4500)).toBe('−$45')
  })
})

describe('taxCents (7% half-up)', () => {
  it('matches the design examples', () => {
    expect(taxCents(12900)).toBe(903)
    expect(taxCents(4500)).toBe(315)
    expect(taxCents(0)).toBe(0)
  })
  it('rounds half up to the cent', () => {
    // 7% of 0.50 = 0.035 -> 0.04 ; of 0.07 = 0.0049 -> 0.00 ; of 0.07+... boundaries
    expect(taxCents(50)).toBe(4)
    expect(taxCents(7)).toBe(0)
    expect(taxCents(8)).toBe(1)
    expect(taxCents(21)).toBe(1) // 1.47 cents
    expect(taxCents(22)).toBe(2) // 1.54 cents
    expect(taxCents(1000, 725)).toBe(73) // 72.5 cents rounds up
  })
  it('agrees with an exact integer reference for every subtotal up to $500', () => {
    for (let c = 0; c <= 50000; c++) {
      // independent formulation: 7% of c cents is c*7/100 cents; round half up on the remainder
      const n = c * 7
      expect(taxCents(c), String(c)).toBe(Math.floor(n / 100) + (n % 100 >= 50 ? 1 : 0))
    }
  })
  it('mirrors for negative adjustments and rejects bad input', () => {
    expect(taxCents(-50)).toBe(-4)
    expect(taxCents(-8)).toBe(-1)
    expect(() => taxCents(1.5)).toThrow(RangeError)
    expect(() => taxCents(100, -1)).toThrow(RangeError)
  })
})
