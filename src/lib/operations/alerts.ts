// "Needs attention" alerts, derived from the appointments in the order the design pushes them.
import { parseT } from '../time'
import { isLate } from './status'
import type { Appt } from './types'

export type AlertTone = 'red' | 'amber' | 'blue' | 'green' | 'violet'

/** What the alert's button does; the class turns it into a closure. */
export type AlertAction =
  | { kind: 'togglePickup'; id: string }
  | { kind: 'flash'; title: string; desc: string }
  | { kind: 'select'; id: string }
  | { kind: 'advance'; id: string }
  | { kind: 'prepBay'; id: string }

export interface AlertSpec {
  tone: AlertTone
  glyph: string
  title: string
  desc: string
  actionLabel: string
  action: AlertAction
  id: string
  /** 1 for a VIP appointment: VIP alerts sort first. */
  pri: 0 | 1
}

/**
 * buildAlerts(): the per-appointment rules in design order (ready for pickup, late, no bay, arriving soon, unconfirmed,
 * special instructions), then geofence ETAs and check-ins, then the member-credit upsell; finally a stable sort that
 * puts VIP alerts first. `nowMin` is the frozen "now" in minutes since midnight of day 0.
 */
export function buildAlerts(
  appts: readonly Appt[],
  nowMin: number,
  byId: (id: string) => Appt | undefined,
): AlertSpec[] {
  const alerts: AlertSpec[] = []
  const mk = (
    tone: AlertTone,
    glyph: string,
    title: string,
    desc: string,
    actionLabel: string,
    action: AlertAction,
    id: string,
  ) => {
    const found = id ? byId(id) : undefined
    alerts.push({ tone, glyph, title, desc, actionLabel, action, id, pri: found && found.vip ? 1 : 0 })
  }
  const abs = (a: Appt) => a.day * 1440 + parseT(a.time)
  appts.forEach((a) => {
    if (a.status === 'completed' && a.pickup !== 'collected')
      mk(
        'green',
        '↑',
        'Ready for pickup',
        `${a.cust.name}'s ${a.veh.make} is done` + (a.pay !== 'paid' ? ' · payment due' : ''),
        'Mark picked up',
        { kind: 'togglePickup', id: a.id },
        a.id,
      )
    if (isLate(a))
      mk(
        'red',
        '!',
        `Running late · ${a.cust.name}`,
        `${a.time} ${a.veh.make} ${a.veh.model} — no arrival logged`,
        'Message customer',
        { kind: 'flash', title: 'Reminder sent', desc: 'WhatsApp to ' + a.cust.name },
        a.id,
      )
    if (a.bay === null && a.status !== 'completed')
      mk(
        'amber',
        '◳',
        'Needs bay assignment',
        `${a.cust.name} · ${a.svc}`,
        'Assign bay',
        { kind: 'select', id: a.id },
        a.id,
      )
    if (a.status === 'confirmed' && !a.eta && abs(a) - nowMin > 0 && abs(a) - nowMin <= 15)
      mk(
        'blue',
        '→',
        'Arriving soon',
        `${a.cust.name} in ${abs(a) - nowMin} min · ${a.veh.make} ${a.veh.model}`,
        'Prep bay ' + (a.bay || '—'),
        { kind: 'flash', title: 'Bay prepped', desc: 'Ready for ' + a.cust.name },
        a.id,
      )
    if (a.status === 'booked')
      mk(
        'amber',
        '?',
        'Unconfirmed',
        `${a.cust.name} · ${a.time} hasn't confirmed`,
        'Send reminder',
        { kind: 'advance', id: a.id },
        a.id,
      )
    if (a.special)
      mk(
        'violet',
        '★',
        'Special instructions',
        `${a.cust.name}: ${a.special.slice(0, 46)}…`,
        'View file',
        { kind: 'select', id: a.id },
        a.id,
      )
  })
  appts.forEach((a) => {
    if (a.eta && ['confirmed', 'booked'].includes(a.status))
      mk(
        a.vip ? 'violet' : 'blue',
        '◎',
        (a.vip ? 'VIP arriving in ' : 'Arriving in ') + a.eta + ' min · ' + a.cust.name,
        'Geofence ETA · ' + a.veh.make + ' ' + a.veh.model + (a.bay ? ' · Bay ' + a.bay : ''),
        a.prepped ? 'Bay ready ✓' : 'Prep bay ' + (a.bay || '—'),
        { kind: 'prepBay', id: a.id },
        a.id,
      )
    if (a.geoIn && a.status === 'arrived')
      mk(
        'green',
        '✓',
        'Auto checked in · ' + a.cust.name,
        'Geofence at ' + a.geoIn + ' · vehicle in the lot',
        'Start cleaning',
        { kind: 'advance', id: a.id },
        a.id,
      )
  })
  const pm = appts.find((a) => a.member === 'Premium' && a.status === 'completed' && a.pay !== 'paid')
  if (pm)
    mk(
      'blue',
      '◆',
      'Member credit available',
      `${pm.cust.name} has 1 unused Premium credit this cycle`,
      'Apply credit',
      { kind: 'flash', title: 'Credit applied', desc: '1 Premium credit redeemed' },
      pm.id,
    )
  alerts.sort((x, y) => (y.pri || 0) - (x.pri || 0))
  return alerts
}
