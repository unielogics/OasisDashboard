// Colour helpers and status colour maps reproduced from the design logic classes.

export type StyleObject = Record<string, string | number>

/** "#2563EB", 0.14 -> "rgba(37,99,235,0.14)". Operations hexA(). */
export function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16),
    g = parseInt(h.slice(2, 4), 16),
    b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

/** Blend a #RRGGBB colour 45% toward white. Operations lighten(). */
export function lighten(hex: string): string {
  const h = hex.replace('#', '')
  let r = parseInt(h.slice(0, 2), 16),
    g = parseInt(h.slice(2, 4), 16),
    b = parseInt(h.slice(4, 6), 16)
  r = Math.round(r + (255 - r) * 0.45)
  g = Math.round(g + (255 - g) * 0.45)
  b = Math.round(b + (255 - b) * 0.45)
  return `rgb(${r},${g},${b})`
}

export type AppointmentStatus =
  'booked' | 'confirmed' | 'arrived' | 'cleaning' | 'completed' | 'canceled' | 'noshow'

export interface StatusMeta {
  /** Label shown on cards and tags. */
  l: string
  /** Status colour (hex). */
  c: string
}

/** Operations stMeta(): label and colour per appointment status; unknown statuses show their own key in grey. */
export function statusMeta(s: string): StatusMeta {
  const map: Record<string, StatusMeta> = {
    booked: { l: 'Booked', c: '#6B7280' },
    confirmed: { l: 'Confirmed', c: '#2563EB' },
    arrived: { l: 'Arrived', c: '#7C3AED' },
    cleaning: { l: 'In Wash', c: '#C2740B' },
    completed: { l: 'Completed', c: '#0E9E6E' },
    canceled: { l: 'Canceled', c: '#9F1239' },
    noshow: { l: 'No-Show', c: '#B91C1C' },
  }
  return (Object.prototype.hasOwnProperty.call(map, s) ? map[s] : undefined) ?? { l: s, c: '#6B7280' }
}

export type InvoiceStatus =
  'Paid' | 'Unpaid' | 'Partially paid' | 'Refunded' | 'Canceled · refunded' | 'Partially refunded'

/** Payments pill(): style object of the status pill; unknown statuses use the neutral pair. */
export function invoicePill(st: string): StyleObject {
  const map: Record<string, [string, string]> = {
    Paid: ['var(--accentSoft)', 'var(--accentInk)'],
    Unpaid: ['var(--redSoft)', 'var(--red)'],
    'Partially paid': ['var(--amberSoft)', 'var(--amber)'],
    Refunded: ['var(--panel3)', 'var(--ink2)'],
    'Canceled · refunded': ['var(--panel3)', 'var(--ink2)'],
    'Partially refunded': ['var(--amberSoft)', 'var(--amber)'],
  }
  const m = (Object.prototype.hasOwnProperty.call(map, st) ? map[st] : undefined) ?? [
    'var(--panel3)',
    'var(--ink2)',
  ]
  return {
    fontSize: '11px',
    fontWeight: 800,
    padding: '4px 9px',
    borderRadius: '7px',
    background: m[0],
    color: m[1],
    whiteSpace: 'nowrap',
  }
}

export type EmployeeStatus = 'active' | 'invited' | 'inactive'

/** Settings employee status label ("Active", "Invite sent", "Inactive"). */
export const employeeStatusLabel = (st: string): string =>
  st === 'active' ? 'Active' : st === 'invited' ? 'Invite sent' : 'Inactive'

/** Settings employee status pill style (the inline object in the employees list). */
export function employeeStatusStyle(st: string): StyleObject {
  return {
    width: '96px',
    textAlign: 'center',
    fontSize: '11.5px',
    fontWeight: 800,
    padding: '5px 9px',
    borderRadius: '8px',
    background:
      st === 'active' ? 'var(--accentSoft)' : st === 'invited' ? 'rgba(194,116,11,.14)' : 'var(--panel3)',
    color: st === 'active' ? 'var(--accentInk)' : st === 'invited' ? '#B45309' : 'var(--ink3)',
  }
}
