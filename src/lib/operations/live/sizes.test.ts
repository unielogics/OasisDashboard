// Vehicle sizes on the live Operations screen (ADR 0170, DV-807..DV-813), pure: size chips, the price preview of the
// booking sheet from the server's quote, the file's size and coverage words, the deposit of a canceled visit, the
// household, and the booking and quote requests the sheet sends.
import { describe, expect, it } from 'vitest'
import type { AppointmentFile, MembershipView, QuoteRes } from '@/data/ports/operations'
import { SIZES } from '@/screens/operations/live-testkit'
import { bookingRequest, emptyForm, quoteRequest } from './newAppt'
import {
  activeSizes,
  carSizeText,
  confirmBadgeText,
  coverageLines,
  depositState,
  fileHasSizes,
  householdOf,
  itemLabelOf,
  planSizeText,
  quoteVM,
  sizeChipVMs,
  tenderLabel,
  visitSizeText,
} from './sizes'

const sizes = activeSizes(SIZES)

function file(over: Partial<AppointmentFile> = {}): AppointmentFile {
  return {
    priceBasis: 'class',
    vehicleClass: 'large_suv',
    vehicleClassLabel: 'Large SUV',
    needsSizeConfirm: false,
    needsPriceConfirm: false,
    classConfirmedAt: null,
    vehicle: {
      id: 'v1',
      year: 2021,
      make: 'Ford',
      model: 'Expedition',
      color: null,
      plate: null,
      vehicleClass: 'large_suv',
      vehicleClassSource: 'staff',
    },
    invoice: null,
    ...over,
  } as unknown as AppointmentFile
}

describe('sizes', () => {
  it('the sizes that are on, smallest first; a turned-off size is not offered', () => {
    const v = { vehicleClasses: [...SIZES.vehicleClasses].reverse().map((c) => ({ ...c, active: c.key !== 'truck' })) }
    expect(activeSizes(v).map((s) => s.key)).toEqual(['compact_car', 'large_car', 'compact_suv', 'large_suv'])
    expect(activeSizes(undefined)).toEqual([])
  })
  it('chips: one per size, then "Not sure" when the size may stay unknown; the picked one is on', () => {
    const picked: Array<string | null> = []
    const chips = sizeChipVMs(sizes, 'compact_suv', (k) => picked.push(k), { allowUnknown: true })
    expect(chips.map((c) => c.label)).toEqual(['Compact car', 'Large car', 'Compact SUV', 'Large SUV', 'Truck', 'Not sure'])
    expect(chips.map((c) => c.on)).toEqual([false, false, true, false, false, false])
    ;(chips[5]!.pick as () => void)()
    ;(chips[0]!.pick as () => void)()
    expect(picked).toEqual([null, 'compact_car'])
    expect((chips[2]!.style as any).background).toBe('var(--accent)')
    expect(sizeChipVMs(sizes, null, () => {}, { allowUnknown: false })).toHaveLength(5)
  })
})

describe('the booking sheet (DV-807)', () => {
  it('books the picked customer’s car by id with the size; a typed car is sent as before', () => {
    const f = { ...emptyForm(), serviceId: 's1', slot: '2026-06-13T18:30:00.000Z', customerId: 'c1', vehicleId: 'v1', vehicle: '2021 Ford Expedition', vehicleClass: 'large_suv' }
    const body = bookingRequest(f, false)
    expect(body.vehicleId).toBe('v1')
    expect(body.vehicle).toBeUndefined()
    expect(body.vehicleClass).toBe('large_suv')
    const typed = bookingRequest({ ...f, customerId: null, name: 'Dana', phone: '3055550171', vehicleId: null, vehicleClass: null }, true)
    expect(typed.vehicleId).toBeUndefined()
    expect(typed.vehicleClass).toBeUndefined()
    expect(typed.vehicle).toEqual({ year: 2021, make: 'Ford', model: 'Expedition', plate: null })
    expect(quoteRequest(f)).toEqual({ serviceId: 's1', customerId: 'c1', vehicleId: 'v1', vehicleClass: 'large_suv' })
    expect(quoteRequest({ ...f, customerId: null })).toEqual({ serviceId: 's1', vehicleClass: 'large_suv' })
    expect(quoteRequest({ ...f, serviceId: null })).toBeNull()
  })

  it('the preview shows the server’s lines: regular price, member % off, what the plan covers and what is due', () => {
    const q: QuoteRes = {
      pricing: {
        vehicleClass: 'large_suv',
        vehicleClassLabel: 'Large SUV',
        basis: 'class',
        needsSizeConfirm: false,
        needsPriceConfirm: false,
        member: true,
        confirmAtShop: false,
        totals: { listCents: 8500, discountCents: 200, coveredCents: 4000, dueCents: 4300 },
      },
      member: { tierName: 'Gold', planClass: 'compact_car', planClassLabel: 'Compact car', discountBp: 1000, household: false },
      lines: [
        { serviceId: 's1', name: 'Signature Hand Wash', kind: 'package', listCents: 6000, listMaxCents: null, chargeCents: 6000, memberDiscountCents: 0, discountBp: 0, basis: 'class', coverage: { label: 'Wash', coveredCents: 4000, differenceCents: 2000, planClassLabel: 'Compact car' }, dueCents: 2000 },
        { serviceId: 's2', name: 'Wax', kind: 'addon', listCents: 2500, listMaxCents: null, chargeCents: 2300, memberDiscountCents: 200, discountBp: 1000, basis: 'class', coverage: null, dueCents: 2300 },
      ],
    }
    const v = quoteVM(q)
    expect(v.hasQuote).toBe(true)
    expect(v.quoteTitle).toBe('Price · Large SUV')
    expect((v.quoteLines as any[]).map((l) => [l.label, l.value])).toEqual([
      ['Signature Hand Wash', '$60'],
      ['Included · $20 size difference due', '– $40'],
      ['+ Wax', '$25'],
      ['Gold 10% off', '– $2'],
    ])
    expect(v.quoteTotal).toBe('$43')
    expect(v.quoteTotalLabel).toBe('Due at the shop (before tax)')
    expect(v.quoteNote).toBe('Gold member · Compact car plan')
  })

  it('an unknown size: the starting price and a note to confirm it at the shop; a tint range reads from–to', () => {
    const q = {
      pricing: { vehicleClass: null, vehicleClassLabel: null, basis: 'unknown_class', needsSizeConfirm: true, needsPriceConfirm: false, member: false, confirmAtShop: true, totals: { listCents: 4000, discountCents: 0, coveredCents: 0, dueCents: 4000 } },
      member: null,
      lines: [{ serviceId: 's1', name: 'Window Tint', kind: 'package', listCents: 19900, listMaxCents: 34950, chargeCents: 19900, memberDiscountCents: 0, discountBp: 0, basis: 'unknown_class', coverage: null, dueCents: 19900 }],
    } as unknown as QuoteRes
    const v = quoteVM(q)
    expect(v.quoteTitle).toBe('Price')
    expect((v.quoteLines as any[])[0].value).toBe('$199–$349.50')
    expect(v.quoteTotalLabel).toBe('Total before tax')
    expect(v.quoteNote).toBe('Size not set: starting price. Confirm the size at the shop.')
    expect(quoteVM(undefined).hasQuote).toBe(false)
  })
})

describe('the appointment file (DV-808, DV-810, DV-811)', () => {
  it('a visit booked before sizes shows no size row', () => {
    expect(fileHasSizes(file({ priceBasis: 'legacy', vehicleClass: null }))).toBe(false)
    expect(fileHasSizes(file({ priceBasis: 'legacy' }))).toBe(true)
    expect(fileHasSizes(file({ priceBasis: 'unknown_class', vehicleClass: null }))).toBe(true)
  })
  it('the size, the badge and the car on file', () => {
    expect(visitSizeText(file(), sizes)).toBe('Large SUV')
    const unknown = file({ vehicleClass: null, vehicleClassLabel: null, needsSizeConfirm: true, priceBasis: 'unknown_class' })
    expect(visitSizeText(unknown, sizes)).toBe('Not set · priced at the starting price')
    expect(confirmBadgeText(unknown)).toBe('Confirm size')
    expect(confirmBadgeText(file({ needsPriceConfirm: true }))).toBe('Confirm price')
    expect(visitSizeText(file({ needsPriceConfirm: true }), sizes)).toBe('Large SUV · no price yet (starting price)')
    expect(confirmBadgeText(file())).toBe('')
    expect(carSizeText(file(), sizes)).toBe('This car on file: Large SUV · set by staff')
    expect(carSizeText(file({ vehicle: { ...file().vehicle!, vehicleClass: null, vehicleClassSource: null } }), sizes)).toBe(
      'This car has no size on file',
    )
    expect(carSizeText(file({ vehicle: null }), sizes)).toBe('')
  })
  it('coverage lines, line labels and the deposit of a canceled visit', () => {
    const inv = {
      coverage: [{ serviceName: 'Signature Hand Wash', coveredCents: 4000, lineCents: 6000, differenceCents: 2000, planClassLabel: 'Compact car' }],
      paidCents: 2500,
      status: 'canceled_kept',
    } as unknown as AppointmentFile['invoice']
    expect(coverageLines({ invoice: inv })).toEqual([
      'Signature Hand Wash · Covered $40 · $20 size difference due (Compact car plan)',
    ])
    expect(coverageLines({ invoice: null })).toEqual([])
    expect(itemLabelOf({ name: 'Wax', classLabel: 'Truck', discountBp: 1000 })).toBe('Wax · Truck · 10% member price')
    expect(itemLabelOf({ name: 'Wax' })).toBe('Wax')
    expect(depositState(inv)).toEqual({ label: 'Deposit kept (canceled)', value: '$25' })
    expect(depositState({ ...inv!, status: 'canceled_refunded' })).toEqual({ label: 'Deposit refunded', value: '$25' })
    expect(depositState({ ...inv!, status: 'partially_paid' })).toBeNull()
    expect(depositState({ ...inv!, paidCents: 0 })).toBeNull()
  })
  it('the processor words of the Payments tab', () => {
    expect(tenderLabel('card', 'square')).toBe('Square reader')
    expect(tenderLabel('card', 'squarespace')).toBe('Card')
    expect(tenderLabel('cash', 'square')).toBe('Cash')
  })
})

describe('the household (DV-813)', () => {
  it('plan size, members and the shared case', () => {
    const view = {
      customerId: 'c1',
      membership: { id: 'm1', planClass: 'compact_car', planClassLabel: 'Compact car', household: [{ customerId: 'c2', name: 'Ana Alvarez', addedAt: '' }] },
      sharedFrom: null,
    } as unknown as MembershipView
    const h = householdOf(view)
    expect(h).toEqual({ show: true, membershipId: 'm1', planSize: 'Compact car', sharedFrom: null, members: [{ customerId: 'c2', name: 'Ana Alvarez' }] })
    expect(planSizeText(h.planSize)).toBe('Compact car · a larger car pays the size difference at the shop')
    expect(householdOf({ ...view, sharedFrom: { customerId: 'c0', name: 'Maria Alvarez' } } as any).sharedFrom).toBe('Maria Alvarez')
    expect(householdOf({ membership: null } as any).show).toBe(false)
    expect(householdOf(undefined).show).toBe(false)
  })
})
