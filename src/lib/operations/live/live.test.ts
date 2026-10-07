/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest'
import type { AppointmentFile } from '@/data/ports/operations'
import { dateAt, monthGrid, navigate, offsetOf, summaryRange, weekdayOf } from './calendar'
import { deliveryText, nextHint, smsChip, smsSegments, whenLabel } from './file'
import { opsMoney, plural } from './fmt'
import { bookingRequest, checkForm, emptyForm, parseVehicle, slotChoice } from './newAppt'
import { applyChecklist } from './optimistic'

describe('parseVehicle', () => {
  it.each([
    ['2022 Tesla Model 3', { year: 2022, make: 'Tesla', model: 'Model 3' }],
    ['  2019   Subaru Outback ', { year: 2019, make: 'Subaru', model: 'Outback' }],
    ['Tesla Model Y', { year: null, make: 'Tesla', model: 'Model Y' }],
    ['Jeep', { year: null, make: 'Jeep', model: null }],
    ['2020', { year: 2020, make: null, model: null }],
    ['', { year: null, make: null, model: null }],
    ['1850 Ford T', { year: null, make: '1850', model: 'Ford T' }],
  ])('%s', (text, want) => expect(parseVehicle(text as string)).toEqual(want))
})

describe('the booking form', () => {
  const base = {
    ...emptyForm(),
    serviceId: 's1',
    name: 'Dana',
    phone: '(305) 555-0171',
    slot: '2026-06-13T18:30:00.000Z',
  }
  it('asks for what is missing, in order', () => {
    expect(checkForm({ ...base, serviceId: null }, false)?.title).toBe('Pick a package')
    expect(checkForm({ ...base, name: ' ' }, false)?.title).toBe('Add the customer’s name')
    expect(checkForm({ ...base, phone: '305-555' }, false)?.title).toBe('Add a phone number')
    expect(checkForm({ ...base, slot: null }, false)?.title).toBe('Pick a time')
    expect(checkForm({ ...base, slot: null }, true)).toBeNull()
    expect(checkForm({ ...base, override: true }, false)?.title).toBe('Reason required')
    expect(checkForm({ ...base, override: true, overrideReason: 'Regular' }, false)).toBeNull()
    expect(checkForm({ ...base, name: '', phone: '', customerId: 'c1' }, false)).toBeNull()
  })
  it('builds the body for a new customer, a found customer, a walk-in and an override', () => {
    expect(bookingRequest({ ...base, vehicle: '2022 Tesla Model 3', plate: 'dw-2022' }, false)).toEqual({
      customer: { name: 'Dana', phone: '(305) 555-0171', smsOptIn: true },
      serviceId: 's1',
      source: 'dashboard',
      vehicle: { year: 2022, make: 'Tesla', model: 'Model 3', plate: 'DW-2022' },
      start: '2026-06-13T18:30:00.000Z',
    })
    expect(bookingRequest({ ...base, customerId: 'c1', smsOptIn: false }, false).customer).toEqual({
      id: 'c1',
    })
    const w = bookingRequest(base, true)
    expect(w).toMatchObject({ walkIn: true, source: 'walk_in' })
    expect(w.start).toBeUndefined()
    expect(bookingRequest({ ...base, override: true, overrideReason: ' VIP ' }, false).override).toEqual({
      reason: 'VIP',
    })
    expect(bookingRequest({ ...base, smsOptIn: false }, false).customer).toMatchObject({ smsOptIn: false })
    expect(bookingRequest(base, false).vehicle).toBeUndefined()
  })
  it("a slot: free, overridable with the permission, or refused with the design's words", () => {
    const slot = (state: string, overridable = false) =>
      ({ state, overridable, reason: 'Outside opening hours', start: 's', time: '9:00 AM' }) as any
    expect(slotChoice(slot('available'), false, 48)).toMatchObject({ override: false, why: null })
    expect(slotChoice(slot('blocked', true), true, 48)).toMatchObject({ override: true, why: null })
    expect(slotChoice(slot('blocked', true), false, 48).why).toEqual({
      title: 'Slot unavailable',
      desc: 'Would overbook a bay — override required',
    })
    expect(slotChoice(slot('vip_held'), false, 48).why).toEqual({
      title: 'Held for VIP clients',
      desc: 'Releases to everyone 48h before · VIP clients can book it now',
    })
    expect(slotChoice(slot('cutoff'), true, 48).why).toEqual({
      title: 'Slot unavailable',
      desc: 'Outside opening hours',
    })
  })
})

describe('sms segments', () => {
  it('GSM-7 counts 160 then 153 per part; typographic characters are normalised first', () => {
    expect(smsSegments('')).toEqual({ chars: 0, parts: 0, unicode: false })
    expect(smsSegments('x'.repeat(160))).toEqual({ chars: 160, parts: 1, unicode: false })
    expect(smsSegments('x'.repeat(161))).toEqual({ chars: 161, parts: 2, unicode: false })
    expect(smsSegments('x'.repeat(306)).parts).toBe(2)
    expect(smsSegments('x'.repeat(307)).parts).toBe(3)
    expect(smsSegments('We’re ready — “come on in”…').unicode).toBe(false)
  })
  it('a character outside GSM-7 makes the whole text Unicode (70 / 67)', () => {
    expect(smsSegments('Nice ⭐')).toEqual({ chars: 6, parts: 1, unicode: true })
    expect(smsSegments('é'.repeat(70) + '⭐').parts).toBe(2)
    expect(smsSegments('[ok]').chars).toBe(6)
  })
})

describe('calendar dates', () => {
  it('weekdays, offsets and navigation', () => {
    expect(weekdayOf('2026-06-13')).toBe(6)
    expect(dateAt('2026-06-13', -13)).toBe('2026-05-31')
    expect(offsetOf('2026-06-13', '2026-07-04')).toBe(21)
    expect(navigate('day', '2026-06-13', 1)).toBe('2026-06-14')
    expect(navigate('week', '2026-06-13', -1)).toBe('2026-06-06')
    expect(navigate('month', '2026-06-13', 1)).toBe('2026-07-01')
    expect(navigate('month', '2026-01-20', -1)).toBe('2025-12-01')
  })
  it('the ranges a view needs from the server', () => {
    expect(summaryRange('day', '2026-06-13')).toEqual({ from: '2026-06-13', to: '2026-06-13' })
    expect(summaryRange('week', '2026-06-13')).toEqual({ from: '2026-06-07', to: '2026-06-13' })
    expect(summaryRange('month', '2026-06-13')).toEqual({ from: '2026-05-31', to: '2026-07-04' })
    expect(monthGrid('2026-02-10')).toMatchObject({ first: '2026-02-01', cells: 28 })
    expect(monthGrid('2026-08-10')).toMatchObject({ first: '2026-07-26', cells: 42 })
    // never more than the 70 days /calendar/summary accepts
    for (let m = 1; m <= 12; m++) {
      const r = summaryRange('month', `2026-${String(m).padStart(2, '0')}-15`)
      expect(offsetOf(r.from, r.to) + 1).toBeLessThanOrEqual(42)
    }
  })
})

describe('labels', () => {
  it('money shows cents only when not whole', () => {
    expect(opsMoney(16500)).toBe('$165')
    expect(opsMoney(16478)).toBe('$164.78')
    expect(opsMoney(129853)).toBe('$1,298.53')
    expect(plural(1, 'task')).toBe('1 task')
    expect(plural(2, 'appointment')).toBe('2 appointments')
  })
  it('the hint under the primary button, by step', () => {
    expect(nextHint('collect', 4815)).toBe('Collect $48.15 before release')
    expect(nextHint(null, 0)).toBe('Job complete — closed and archived')
    expect(nextHint('start', 0)).toBe('Drag the card onto an open bay, or start the wash here')
  })
  it('the day word of the file header', () => {
    const f = {
      overview: {
        bizDate: '2026-06-14',
        time: '9:00 AM',
        dateLabel: 'Sunday, June 14',
        service: { name: 'Express Hand Wash' },
      },
    } as AppointmentFile
    expect(whenLabel(f, '2026-06-13', '2026-06-14')).toBe('Tomorrow 9:00 AM · Express Hand Wash')
    expect(whenLabel(f, '2026-06-14', '2026-06-15')).toBe('Today 9:00 AM · Express Hand Wash')
    expect(whenLabel(f, '2026-06-10', '2026-06-11')).toBe('Sunday, June 14 9:00 AM · Express Hand Wash')
  })
  it('delivery text on outbound bubbles only', () => {
    const o = (status: string) => deliveryText({ direction: 'out', from: 'staff', status } as any)
    expect(['queued', 'sending', 'sent', 'delivered', 'failed', 'expired', 'canceled'].map(o)).toEqual([
      ' · Queued',
      ' · Sending',
      ' · Sent',
      ' · Delivered',
      ' · Failed',
      ' · Expired',
      ' · Canceled',
    ])
    expect(deliveryText({ direction: 'in', from: 'customer', status: 'received' } as any)).toBe('')
  })
  it('the chip beside the phone number', () => {
    expect(smsChip({ smsOptedIn: true, smsOptedOut: false } as any)).toEqual({
      label: 'SMS opted-in',
      on: true,
    })
    expect(smsChip({ smsOptedIn: true, smsOptedOut: true } as any)).toEqual({
      label: 'SMS opted-out',
      on: false,
    })
    expect(smsChip({ smsOptedIn: false, smsOptedOut: false } as any)).toEqual({
      label: 'SMS not opted in',
      on: false,
    })
  })
})

describe('applyChecklist', () => {
  const file = {
    checklist: {
      done: 1,
      total: 3,
      pct: 33,
      allDone: false,
      sections: [
        {
          kind: 'package',
          title: 'P',
          addonId: null,
          done: 1,
          total: 2,
          allDone: false,
          items: [
            { id: 'a', label: 'a', done: true, position: 0 },
            { id: 'b', label: 'b', done: false, position: 1 },
          ],
        },
        {
          kind: 'addon',
          title: 'A',
          addonId: 'x',
          done: 0,
          total: 1,
          allDone: false,
          items: [{ id: 'c', label: 'c', done: false, position: 2 }],
        },
      ],
    },
  } as unknown as AppointmentFile
  it('ticks and recounts every level without touching the original', () => {
    const next = applyChecklist(file, ['b'], true)
    expect(next.checklist).toMatchObject({ done: 2, total: 3, pct: 67, allDone: false })
    expect(next.checklist.sections[0]).toMatchObject({ done: 2, allDone: true })
    expect(file.checklist.done).toBe(1)
    const all = applyChecklist(file, ['a', 'b', 'c'], true)
    expect(all.checklist).toMatchObject({ done: 3, pct: 100, allDone: true })
    expect(applyChecklist(all, ['a', 'b', 'c'], false).checklist).toMatchObject({
      done: 0,
      pct: 0,
      allDone: false,
    })
  })
})
