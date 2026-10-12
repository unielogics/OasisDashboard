import { describe, expect, it } from 'vitest'
import {
  categoryProblem,
  checkoutUrlProblem,
  dollarsText,
  keyFromLabel,
  money,
  normalizeColour,
  parseDollars,
  sameDraft,
  serviceBody,
  serviceDraft,
} from './catalog'
import type { CatalogItem } from './catalog'

const signature: CatalogItem = {
  id: 's1',
  kind: 'package',
  name: 'Signature Hand Wash',
  active: true,
  category: 'wash',
  publicName: 'Signature Hand Wash',
  description: 'Hand wash, interior wipe-down',
  memberPriceCents: 4500,
  guestPriceCents: null,
  vipInclusion: 'none',
  vipNote: null,
  quoteOnly: false,
  visibleOnline: true,
  sort: 10,
  priceCents: 5400,
  durationMin: 45,
  tags: ['premium'],
  effective: { memberPriceCents: 4500, guestPriceCents: 5400, tintFilm: null },
  version: 3,
}

describe('catalog money', () => {
  it('cents <-> typed dollars', () => {
    expect(dollarsText(4500)).toBe('45')
    expect(dollarsText(4550)).toBe('45.50')
    expect(dollarsText(null)).toBe('')
    expect(parseDollars('$1,250.5')).toBe(125050)
    expect(parseDollars(' 45 ')).toBe(4500)
    expect(parseDollars('')).toBeNull()
    expect(parseDollars('45.123')).toBeUndefined()
    expect(parseDollars('-5')).toBeUndefined()
    expect(parseDollars('abc')).toBeUndefined()
    expect(money(125000)).toBe('$1,250')
    expect(money(4550)).toBe('$45.50')
  })
})

describe('service website fields', () => {
  it('draft from the DTO and the PUT body back, with the version; no price travels (ADR 0170)', () => {
    const d = serviceDraft(signature)
    expect(d).toEqual({
      category: 'wash',
      publicName: 'Signature Hand Wash',
      description: 'Hand wash, interior wipe-down',
      quoteOnly: false,
      visibleOnline: true,
      sort: 10,
    })
    const b = serviceBody({ ...d, publicName: '  ' }, 3)
    expect(b).toEqual({
      ok: true,
      value: {
        category: 'wash',
        publicName: null,
        description: 'Hand wash, interior wipe-down',
        quoteOnly: false,
        visibleOnline: true,
        sort: 10,
        version: 3,
      },
    })
    expect(sameDraft(serviceDraft(signature), d)).toBe(true)
  })

  it('refuses what the server refuses, in plain words', () => {
    const d = serviceDraft(signature)
    expect(serviceBody({ ...d, publicName: 'x'.repeat(81) }, 1)).toMatchObject({ ok: false, field: 'publicName' })
    expect(serviceBody({ ...d, description: 'x'.repeat(1001) }, 1)).toMatchObject({ ok: false, field: 'description' })
  })

  it('checkout links: https on squarespace.com only, no user or port', () => {
    expect(checkoutUrlProblem('')).toBeNull()
    expect(checkoutUrlProblem('https://squarespace.com/x')).toBeNull()
    expect(checkoutUrlProblem('https://shop.squarespace.com/x')).toBeNull()
    expect(checkoutUrlProblem('http://shop.squarespace.com/x')).toMatch(/https/)
    expect(checkoutUrlProblem('https://evil.com/squarespace.com')).toMatch(/squarespace\.com/)
    expect(checkoutUrlProblem('https://squarespace.com.evil.com/')).toMatch(/squarespace\.com/)
    expect(checkoutUrlProblem('https://a:b@shop.squarespace.com/')).toMatch(/plain/)
    expect(checkoutUrlProblem('https://shop.squarespace.com:8443/')).toMatch(/plain/)
    expect(checkoutUrlProblem('not a link')).toMatch(/full/)
  })
})

describe('categories', () => {
  it('keys from names', () => {
    expect(keyFromLabel('Paint correction')).toBe('paint_correction')
    expect(keyFromLabel('  Café Détail!! ')).toBe('cafe_detail')
    expect(keyFromLabel('2-step polish')).toBe('step_polish')
    expect(keyFromLabel('!!!')).toBe('')
    expect(keyFromLabel('x'.repeat(40)).length).toBe(32)
  })

  it('colours are normalised to #RRGGBB', () => {
    expect(normalizeColour('0e7a63')).toBe('#0E7A63')
    expect(normalizeColour(' #abcdef ')).toBe('#ABCDEF')
    expect(normalizeColour('red')).toBe('red')
  })

  it('what a new or edited category needs', () => {
    expect(categoryProblem('', '#0E7A63', 'x', [])).toMatch(/name/)
    expect(categoryProblem('Polish', 'blue', 'polish', [])).toMatch(/colour/)
    expect(categoryProblem('Polish', '#0E7A63', 'polish', ['polish'])).toMatch(/already/)
    expect(categoryProblem('Mixed', '#0E7A63', 'mixed', [])).toMatch(/Mixed/)
    expect(categoryProblem('42', '#0E7A63', '', [])).toMatch(/letter/)
    expect(categoryProblem('Polish', '#0E7A63', null, [])).toBeNull()
    expect(categoryProblem('x'.repeat(41), '#0E7A63', null, [])).toMatch(/40/)
  })
})
