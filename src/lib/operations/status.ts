// Appointment status flow and the small predicates the board, gestures and alerts share.
import { balance, money } from './pricing'
import type { Appt, ApptStatus } from './types'

export const ORDER: readonly ApptStatus[] = ['booked', 'confirmed', 'arrived', 'cleaning', 'completed']

/** Share of the checklist that is pre-ticked per status at hydration time. */
export const FRAC: Partial<Record<ApptStatus, number>> = {
  booked: 0,
  confirmed: 0,
  arrived: 0,
  cleaning: 0.5,
  completed: 1,
}

export type StepTo = 'confirmed' | 'arrived' | 'cleaning' | 'completed' | 'pay'

export interface Step {
  label: string
  to: StepTo
}

type StepSubject = Pick<Appt, 'status' | 'addons' | 'price' | 'member' | 'tip' | 'pay' | 'deposit'>

/** nextStep(a): the primary action of an appointment; a completed one only offers payment while a balance is open. */
export function nextStep(a: StepSubject): Step | null {
  switch (a.status) {
    case 'booked':
      return { label: 'Confirm Appointment', to: 'confirmed' }
    case 'confirmed':
      return { label: 'Mark Arrived', to: 'arrived' }
    case 'arrived':
      return { label: 'Start Cleaning', to: 'cleaning' }
    case 'cleaning':
      return { label: 'Mark Complete', to: 'completed' }
    case 'completed':
      return balance(a) > 0 ? { label: 'Collect Payment', to: 'pay' } : null
    default:
      return null
  }
}

/** The toast shown by advance() for each step: [title, description]. */
export const ADVANCE_TOASTS: Record<StepTo, readonly [string, string]> = {
  confirmed: ['Confirmation sent', 'Reminder via WhatsApp'],
  arrived: ['Marked arrived', 'Internal team notified'],
  cleaning: ['Cleaning started', 'In-progress message sent'],
  completed: ['Job completed', 'Ready-for-pickup sent · moved to pickup'],
  pay: ['Payment collected', 'Receipt sent'],
}

/** advance() falls back to this when a step has no entry (it cannot today). */
export const ADVANCE_FALLBACK_TITLE = 'Updated'

/** The hint under the modal's primary button. */
export function hintFor(a: StepSubject, step: Step): string {
  const m: Record<string, string> = {
    confirmed: 'Customer hasn’t confirmed — send the reminder',
    arrived: 'Mark arrived once the customer pulls in',
    cleaning: 'Drag the card onto an open bay, or start the wash here',
    completed: 'Wash finished — mark complete and move it to pickup',
    pay: 'Collect ' + money(balance(a)) + ' before release',
  }
  return m[step.to] || ''
}

export const inFacility = (a: Pick<Appt, 'status'>): boolean => a.status === 'cleaning'

export const isLate = (a: Pick<Appt, 'late' | 'status'>): boolean =>
  !!a.late && !['arrived', 'cleaning', 'completed'].includes(a.status)

/** A job can be dragged (to a bay or a new hour) until it is in a bay or done. */
export const canDrag = (a: Pick<Appt, 'status'>): boolean => !inFacility(a) && a.status !== 'completed'

/** Minutes from the start of day 0 to the appointment (day offsets count 1440 each). */
export function absMin(a: Pick<Appt, 'day' | 'time'>, parse: (s: string) => number): number {
  return a.day * 1440 + parse(a.time)
}

export interface MemberStyle {
  c: string
  bg: string
}

/** memberMeta(m): badge colours keyed by the first word of the plan name; unknown plans use the Premium pair. */
export function memberMeta(m: string | null): MemberStyle | null {
  if (!m) return null
  const k = m.split(' ')[0]!
  const map: Record<string, MemberStyle> = {
    Essential: { c: '#7A8B73', bg: '#E9EDE4' },
    Premium: { c: '#8A6D3B', bg: '#F2E9D6' },
    Executive: { c: '#3B5A8A', bg: '#E0E8F4' },
    Exotic: { c: '#7A3B8A', bg: '#EEDFF2' },
  }
  return (
    (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : undefined) ?? { c: '#8A6D3B', bg: '#F2E9D6' }
  )
}
