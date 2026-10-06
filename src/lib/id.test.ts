import { describe, expect, it } from 'vitest'
import { newIdempotencyKey, randomUnit, randomUuid } from './id'

describe('ids', () => {
  it('generates UUID v4 strings, all different', () => {
    const keys = new Set(Array.from({ length: 200 }, () => newIdempotencyKey()))
    expect(keys.size).toBe(200)
    for (const k of keys)
      expect(k).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(randomUuid()).toMatch(/^[0-9a-f-]{36}$/)
  })
  it('randomUnit is in [0, 1)', () => {
    for (let i = 0; i < 500; i++) {
      const r = randomUnit()
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThan(1)
    }
  })
})
