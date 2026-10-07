// The New Appointment / Walk-in sheet on the real booking API: the form model, the "Year / Make / Model" parse, the
// request body, the client-side checks (the server validates everything again) and the slot buttons built from the
// availability engine's answer. The design's eight fixed slots become the day's real slots, bay-aware.
import type { AvailabilitySlot, BookingReq, CustomerHit, ServiceCatalog } from '@/data/ports/operations'
import { hexA } from '@/lib/color'
import type { Style } from '../types'
import { opsMoney } from './fmt'

type VM = Record<string, unknown>

export interface NewForm {
  name: string
  phone: string
  smsOptIn: boolean
  /** "2022 Tesla Model 3" */
  vehicle: string
  plate: string
  serviceId: string | null
  /** The business date being booked; null = today. */
  date: string | null
  /** ISO start of the picked slot. */
  slot: string | null
  /** The slot was blocked and the booker may override it: the reason is then required. */
  override: boolean
  overrideReason: string
  /** An existing customer picked from the search. */
  customerId: string | null
}

export const emptyForm = (): NewForm => ({
  name: '',
  phone: '',
  smsOptIn: true,
  vehicle: '',
  plate: '',
  serviceId: null,
  date: null,
  slot: null,
  override: false,
  overrideReason: '',
  customerId: null,
})

/** "2022 Tesla Model 3" -> year 2022, make Tesla, model "Model 3"; no year keeps everything after the make as the model. */
export function parseVehicle(text: string): {
  year: number | null
  make: string | null
  model: string | null
} {
  const parts = text.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return { year: null, make: null, model: null }
  let year: number | null = null
  const y = /^(19|20)\d{2}$/.exec(parts[0]!)
  if (y) {
    year = Number(parts[0])
    parts.shift()
  }
  const make = parts.shift() ?? null
  return { year, make, model: parts.length ? parts.join(' ') : null }
}

export const digits = (s: string): string => s.replace(/\D/g, '')

export interface FormProblem {
  title: string
  desc: string
}

/** The checks the sheet makes before it calls the API (the design had none: its fields were static). */
export function checkForm(f: NewForm, walkIn: boolean): FormProblem | null {
  if (!f.serviceId) return { title: 'Pick a package', desc: 'Choose a service package for the booking' }
  if (!f.customerId && !f.name.trim())
    return { title: 'Add the customer’s name', desc: 'A full name is needed to book' }
  if (!f.customerId && digits(f.phone).length < 10)
    return { title: 'Add a phone number', desc: 'A 10-digit phone number is needed to text the customer' }
  if (!walkIn && !f.slot) return { title: 'Pick a time', desc: 'Choose one of the available slots' }
  if (f.override && !f.overrideReason.trim())
    return {
      title: 'Reason required',
      desc: walkIn ? 'Say why this walk-in is being fitted in' : 'Say why this slot is being overridden',
    }
  return null
}

export function bookingRequest(f: NewForm, walkIn: boolean): BookingReq {
  const v = parseVehicle(f.vehicle)
  const hasVehicle = !!(v.year || v.make || v.model || f.plate.trim())
  const body: BookingReq = {
    customer: f.customerId
      ? { id: f.customerId }
      : { name: f.name.trim(), phone: f.phone.trim(), smsOptIn: f.smsOptIn },
    serviceId: f.serviceId!,
    source: walkIn ? 'walk_in' : 'dashboard',
  }
  if (hasVehicle)
    body.vehicle = {
      year: v.year,
      make: v.make,
      model: v.model,
      plate: f.plate.trim() ? f.plate.trim().toUpperCase() : null,
    }
  if (walkIn) body.walkIn = true
  else body.start = f.slot!
  if (f.override) body.override = { reason: f.overrideReason.trim() }
  return body
}

/** The first five packages are bookable from the sheet, as designed (review B30 asks for the rest: see DV-402). */
export const SHEET_PACKAGES = 5

export function serviceVMs(
  catalog: ServiceCatalog | undefined,
  pickedId: string | null,
  pick: (id: string) => void,
): VM[] {
  return (catalog?.packages ?? []).slice(0, SHEET_PACKAGES).map((s) => ({
    name: s.name,
    dur: 'Est. ' + s.durationMin + ' min',
    price: opsMoney(s.priceCents),
    pick: () => pick(s.id),
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '13px 15px',
      borderRadius: '12px',
      background: pickedId === s.id ? 'var(--accentSoft)' : 'var(--panel)',
      border: '1px solid ' + (pickedId === s.id ? 'var(--accentBrd)' : 'var(--line)'),
    },
  }))
}

/** Can the slot be taken at all by this person (free, or blocked but overridable and they hold sched.override)? */
export interface SlotChoice {
  slot: AvailabilitySlot
  /** Selecting needs an override reason. */
  override: boolean
  /** Why it cannot be picked ("" = it can). */
  why: { title: string; desc: string } | null
}

export function slotChoice(s: AvailabilitySlot, canOverride: boolean, releaseHours: number): SlotChoice {
  if (s.state === 'available') return { slot: s, override: false, why: null }
  if (s.overridable && canOverride) return { slot: s, override: true, why: null }
  if (s.state === 'vip_held')
    return {
      slot: s,
      override: false,
      why: {
        title: 'Held for VIP clients',
        desc: `Releases to everyone ${releaseHours}h before · VIP clients can book it now`,
      },
    }
  if (s.state === 'blocked')
    return {
      slot: s,
      override: false,
      why: { title: 'Slot unavailable', desc: 'Would overbook a bay — override required' },
    }
  return {
    slot: s,
    override: false,
    why: { title: 'Slot unavailable', desc: s.reason ?? 'That time cannot be booked' },
  }
}

export function slotVMs(
  slots: readonly AvailabilitySlot[],
  pickedStart: string | null,
  o: { canOverride: boolean; releaseHours: number },
  actions: { pick(c: SlotChoice): void; flash(title: string, desc: string): void },
): VM[] {
  return slots
    .filter((s) => s.state !== 'past')
    .map((s) => {
      const c = slotChoice(s, o.canOverride, o.releaseHours)
      const held = s.state === 'vip_held'
      // greyed = would overbook a bay (or closed, cut off): the design's look, whether or not this person can override it
      const off = s.state !== 'available' && !held
      const on = pickedStart === s.start
      const style: Style = {
        height: '42px',
        borderRadius: '11px',
        fontSize: '13px',
        fontWeight: 700,
        cursor: off && !c.override ? 'not-allowed' : 'pointer',
        background: on ? 'var(--accent)' : off ? 'var(--panel3)' : 'var(--panel)',
        color: on ? '#fff' : off ? 'var(--ink3)' : 'var(--ink)',
        border: '1px solid ' + (on ? 'var(--accent)' : 'var(--line)'),
        opacity: off && !on ? 0.6 : 1,
      }
      return {
        label: held ? s.time + ' · VIP' : s.time,
        pick: () => (c.why ? actions.flash(c.why.title, c.why.desc) : actions.pick(c)),
        style,
      }
    })
}

/** The one-line note under the slot grid (tpl 683): says what grey means, or why nothing can be booked. */
export function slotNote(
  date: string,
  slots: readonly AvailabilitySlot[] | undefined,
  closedReason: string | null,
): string {
  if (closedReason) return closedReason
  if (slots && slots.length && slots.every((s) => s.state === 'past')) return 'No slots are left today'
  void date
  return 'Greyed slots would overbook a bay — manager override required'
}

export function hitVMs(hits: readonly CustomerHit[], pick: (h: CustomerHit) => void): VM[] {
  return hits.map((h) => ({
    name: h.fullName,
    sub:
      [h.phone, h.vehicles[0] ? [h.vehicles[0].make, h.vehicles[0].model].filter(Boolean).join(' ') : '']
        .filter(Boolean)
        .join(' · ') || 'No details on file',
    vip: h.vip,
    pick: () => pick(h),
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '10px',
      width: '100%',
      padding: '10px 14px',
      textAlign: 'left',
      borderRadius: '11px',
      background: 'var(--panel)',
      border: '1px solid var(--line)',
    },
  }))
}

/** Styles of the real inputs that replace the sheet's static boxes (same box, an editable text). */
export const inputStyle: Style = {
  width: '100%',
  height: '50px',
  padding: '0 15px',
  background: 'var(--panel)',
  border: '1px solid var(--line)',
  borderRadius: '12px',
  fontSize: '14px',
  color: 'var(--ink)',
  fontWeight: 600,
  fontFamily: 'inherit',
  outline: 'none',
}

export const smsToggleStyle = (on: boolean): Style => ({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: '7px',
  padding: '0 15px',
  background: on ? 'var(--accentSoft)' : 'var(--panel2)',
  border: '1px solid ' + (on ? 'var(--accentBrd)' : 'var(--line)'),
  borderRadius: '12px',
  fontWeight: 700,
  fontSize: '13px',
  color: on ? 'var(--accentInk)' : 'var(--ink3)',
})

export const smsDotStyle = (on: boolean): Style => ({
  width: '8px',
  height: '8px',
  borderRadius: '50%',
  background: on ? '#25D366' : hexA('#6B7280', 0.6),
})
