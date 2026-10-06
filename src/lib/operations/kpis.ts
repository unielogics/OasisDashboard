// The seven KPI tiles of the Command Center. They are always computed over the whole day 0 and 1 set: search and
// range filters never touch them.
import { balance, money, total } from './pricing'
import type { Appt } from './types'

export interface Kpi {
  label: string
  value: string
  sub: string
  accent: string
}

/** Texts the design hard-codes; the live stage replaces them with computed values. */
export interface KpiPlaceholders {
  booked: string
  bayTimeFree: string
  bayTimeSub: string
}

export const DESIGN_KPI_PLACEHOLDERS: KpiPlaceholders = {
  booked: '12 booked',
  bayTimeFree: '3.5h',
  bayTimeSub: 'today',
}

export const KPI_ACCENTS = ['var(--accent)', '#C2740B', '#0E9E6E', '#C2410C', '#2563EB', '#7A3B8A', '#0D9488']

export function buildKpis(all: readonly Appt[], ph: KpiPlaceholders = DESIGN_KPI_PLACEHOLDERS): Kpi[] {
  const day0 = all.filter((a) => a.day === 0)
  const active = all.filter((a) => a.status === 'cleaning')
  const ready = all.filter((a) => a.status === 'completed' && a.pickup !== 'collected')
  const unpaid = all.filter(
    (a) => a.day === 0 && a.pay !== 'paid' && !['canceled', 'noshow'].includes(a.status),
  )
  const unpaidSum = unpaid.reduce((t, a) => t + balance(a), 0)
  const members = day0.filter((a) => a.member)
  const revenue = day0.filter((a) => a.pay === 'paid').reduce((t, a) => t + total(a).grand, 0)
  const acc = KPI_ACCENTS
  return [
    { label: 'Appointments 24h', value: String(all.length), sub: ph.booked, accent: acc[0]! },
    { label: 'Active jobs', value: String(active.length), sub: 'in bays', accent: acc[1]! },
    {
      label: 'Ready for pickup',
      value: String(ready.length),
      sub: ready.length ? 'notify' : 'clear',
      accent: acc[2]!,
    },
    { label: 'Pending payments', value: String(unpaid.length), sub: money(unpaidSum), accent: acc[3]! },
    { label: 'Bay time free', value: ph.bayTimeFree, sub: ph.bayTimeSub, accent: acc[4]! },
    { label: 'Members today', value: String(members.length), sub: 'of ' + day0.length, accent: acc[5]! },
    { label: 'Revenue today', value: money(revenue), sub: 'paid', accent: acc[6]! },
  ]
}
