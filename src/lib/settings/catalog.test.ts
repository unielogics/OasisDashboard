import { describe, expect, it } from 'vitest'
import {
  autoGuestCents,
  categoryProblem,
  checkoutUrlProblem,
  dollarsText,
  guestHint,
  keyFromLabel,
  money,
  normalizeColour,
  parseDollars,
  planBody,
  planDraft,
  sameDraft,
  serviceBody,
  serviceDraft,
  serviceMeta,
  tintBody,
  tintDraft,
  tintKey,
} from './catalog'
import type { CatalogItem, CatalogPlanItem, TintMatrixView } from './catalog'

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

  it('the guest price the server derives: member + markup, half up to whole dollars (the website rule)', () => {
    expect(autoGuestCents(4500, 20)).toBe(5400)
    expect(autoGuestCents(3900, 20)).toBe(4700) // 46.8 -> 47
    expect(autoGuestCents(3200, 20)).toBe(3800) // 38.4 -> 38
    expect(autoGuestCents(1250, 20)).toBe(1500) // 15.0
    expect(autoGuestCents(1000, 25)).toBe(1300) // 12.5 -> 13 (half up)
  })
})

describe('service website fields', () => {
  it('draft from the DTO and the PUT body back, with the version', () => {
    const d = serviceDraft(signature)
    expect(d).toMatchObject({ member: '45', guest: '', publicName: 'Signature Hand Wash', sort: 10 })
    const b = serviceBody({ ...d, guest: '54', publicName: '  ' }, 3)
    expect(b).toEqual({
      ok: true,
      value: {
        category: 'wash',
        publicName: null,
        description: 'Hand wash, interior wipe-down',
        memberPriceCents: 4500,
        guestPriceCents: 5400,
        vipInclusion: 'none',
        vipNote: null,
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
    expect(serviceBody({ ...d, member: '4x' }, 1)).toMatchObject({ ok: false, field: 'member' })
    expect(serviceBody({ ...d, member: '', guest: '50' }, 1)).toMatchObject({ ok: false, field: 'guest' })
    expect(serviceBody({ ...d, guest: '40' }, 1)).toMatchObject({
      ok: false,
      message: 'The guest price can’t be lower than the member price.',
    })
    expect(serviceBody({ ...d, vipInclusion: 'allowance', vipNote: ' ' }, 1)).toMatchObject({
      ok: false,
      field: 'vipNote',
    })
    expect(serviceBody({ ...d, publicName: 'x'.repeat(81) }, 1)).toMatchObject({ ok: false, field: 'publicName' })
    expect(serviceBody({ ...d, member: '200000' }, 1)).toMatchObject({ ok: false, field: 'member' })
  })

  it('a VIP note is dropped when the service is not included for VIPs', () => {
    const d = { ...serviceDraft(signature), vipInclusion: 'none' as const, vipNote: 'left over' }
    const b = serviceBody(d, 1)
    expect(b.ok && b.value.vipNote).toBeNull()
  })

  it('meta line and the guest hint', () => {
    expect(serviceMeta(signature)).toBe('Booking charges $54 · 45 min')
    expect(serviceMeta({ ...signature, quoteOnly: true })).toBe('Quote only · 45 min')
    // no member price: the server leaves the booking charge at its last price (pricing.ts bookingPriceOf is null)
    expect(serviceMeta({ ...signature, memberPriceCents: null, guestPriceCents: null })).toBe(
      'Booking charges $54, its last price: a member price here changes it · 45 min',
    )
    expect(
      serviceMeta({
        ...signature,
        memberPriceCents: null,
        effective: { ...signature.effective, tintFilm: 'carbon' },
      }),
    ).toBe('Booking charges $54 · 45 min · priced by the tint table')
    const d = serviceDraft(signature)
    expect(guestHint(d, signature, 20)).toBe('Empty: guests pay $54 (member price + 20%).')
    expect(guestHint({ ...d, guest: '60' }, signature, 20)).toBe('Guests pay this price.')
    expect(guestHint({ ...d, member: '' }, signature, 20)).toBe('No member price: the website shows no price.')
    expect(
      guestHint(d, { ...signature, effective: { ...signature.effective, tintFilm: 'carbon' } }, 20),
    ).toMatch(/tint table/)
  })
})

describe('plans', () => {
  const gold: CatalogPlanItem = {
    key: 'premium',
    name: 'Premium',
    active: true,
    publicLabel: 'Gold',
    monthlyPriceCents: 9900,
    perks: ['4 hand washes a month', 'Member prices'],
    checkoutUrl: 'https://oasis.squarespace.com/checkout/gold',
    websiteTier: 'gold',
    version: 2,
  }

  it('perks are one per line; blanks and repeats dropped', () => {
    const d = planDraft(gold)
    expect(d.perks).toBe('4 hand washes a month\nMember prices')
    const b = planBody({ ...d, perks: 'A\n\n  A \nB', monthly: '109' }, 2)
    expect(b).toEqual({
      ok: true,
      value: {
        publicLabel: 'Gold',
        monthlyPriceCents: 10900,
        perks: ['A', 'B'],
        checkoutUrl: 'https://oasis.squarespace.com/checkout/gold',
        version: 2,
      },
    })
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
    expect(planBody({ ...planDraft(gold), checkoutUrl: 'https://x.com' }, 1)).toMatchObject({
      ok: false,
      field: 'checkoutUrl',
    })
  })

  it('at most 12 perks of 120 characters', () => {
    const many = Array.from({ length: 13 }, (_, i) => 'Perk ' + i).join('\n')
    expect(planBody({ ...planDraft(gold), perks: many }, 1)).toMatchObject({ ok: false, field: 'perks' })
    expect(planBody({ ...planDraft(gold), perks: 'x'.repeat(121) }, 1)).toMatchObject({ ok: false })
  })
})

describe('tint table', () => {
  const m: TintMatrixView = {
    vehicleTypes: [
      { key: 'sedan_coupe', label: 'Sedan / coupe' },
      { key: 'suv_crossover', label: 'SUV / crossover' },
    ],
    films: [{ key: 'carbon', label: 'Carbon', vlt: [5, 20, 35] }],
    prices: [
      {
        vehicle: 'sedan_coupe',
        film: 'carbon',
        memberMinCents: 22900,
        memberMaxCents: 29900,
        guestMinCents: 27500,
        guestMaxCents: 35900,
      },
    ],
    version: 4,
  }

  it('round trip; an empty pair stays unpriced', () => {
    const d = tintDraft(m)
    expect(d[tintKey('sedan_coupe', 'carbon')]).toEqual({
      memberMin: '229',
      memberMax: '299',
      guestMin: '275',
      guestMax: '359',
    })
    expect(d[tintKey('suv_crossover', 'carbon')]).toEqual({ memberMin: '', memberMax: '', guestMin: '', guestMax: '' })
    expect(tintBody(d, m)).toEqual({
      ok: true,
      value: { vehicleTypes: m.vehicleTypes, films: m.films, prices: m.prices, version: 4 },
    })
  })

  it('a half-filled pair or a range ending below its start is refused with the row named', () => {
    const d = tintDraft(m)
    d[tintKey('suv_crossover', 'carbon')] = { memberMin: '259', memberMax: '', guestMin: '', guestMax: '' }
    expect(tintBody(d, m)).toMatchObject({ ok: false, message: 'SUV / crossover · Carbon: fill all four prices, like 229.' })
    d[tintKey('suv_crossover', 'carbon')] = { memberMin: '259', memberMax: '200', guestMin: '300', guestMax: '320' }
    expect(tintBody(d, m)).toMatchObject({ ok: false, message: /can’t end below/ })
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
