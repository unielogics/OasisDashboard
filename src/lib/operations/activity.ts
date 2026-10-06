// The messages thread and activity log of an appointment: the lazily built history and the lines each command appends.
// Commands take the working copy the class hands to update() and return the changed appointment; nothing is shared.
import { fmtT, parseT } from '../time'
import { initChecks } from './checklist'
import type { ApptStatus, Appt, AddonTasks, LogLine, Message, Services } from './types'
import type { Step } from './status'

type Auto = readonly [log: string, channel: string, message: string | null]

/** ensureActivity(): the thread and log an appointment has when first opened, up to its current status. */
export function buildActivity(
  a: Pick<Appt, 'status' | 'time' | 'dur' | 'veh' | 'cust'>,
  order: readonly ApptStatus[],
): { messages: Message[]; log: LogLine[] } {
  const ci = order.indexOf(a.status)
  const t0 = parseT(a.time)
  const auto: Record<string, Auto> = {
    confirmed: [
      'Confirmation + reminder sent',
      'WhatsApp',
      'Your appointment at Oasis Auto Spa is confirmed for ' + a.time + '. Reply C to confirm.',
    ],
    arrived: ['Arrival logged', 'Internal', null],
    checkedin: [
      'Check-in message sent',
      'WhatsApp',
      'Your ' + a.veh.make + ' has been checked in. We’ll keep you posted.',
    ],
    cleaning: ['In-progress message sent', 'WhatsApp', 'Good news — your vehicle is now being cleaned.'],
    qc: ['Quality inspection started', 'Internal', null],
    ready: ['Ready-for-pickup sent', 'WhatsApp', 'Your vehicle is ready for pickup! See you soon.'],
    paid: ['Receipt sent', 'Email + WhatsApp', 'Payment received — receipt on its way. Thank you!'],
    completed: [
      'Job closed · review request scheduled',
      'Automation',
      'Thanks for visiting Oasis Auto Spa! How did we do? ⭐',
    ],
  }
  const msgs: Message[] = [
    {
      from: 'staff',
      text: 'Hi ' + a.cust.name.split(' ')[0] + ', thanks for booking with Oasis Auto Spa.',
      time: 'Yesterday 4:02 PM',
      channel: 'WhatsApp',
    },
  ]
  const log: LogLine[] = [
    { time: 'Yesterday 4:02 PM', text: 'Booking created · deposit link sent', channel: 'System' },
  ]
  let off = 0
  order.forEach((st, i) => {
    if (i === 0 || i > ci) return
    const a2 = auto[st]
    if (!a2) return
    const tt = st === 'confirmed' ? 'Yesterday 4:12 PM' : fmtT(t0 + off)
    if (st !== 'confirmed') off += Math.max(2, Math.round(a.dur / 6))
    log.push({ time: tt, text: a2[0], channel: a2[1] })
    if (a2[2]) msgs.push({ from: 'system', text: a2[2], time: tt, channel: a2[1] })
  })
  return { messages: msgs, log }
}

/** Fills `messages` and `log` when they are missing; returns the same object. */
export function withActivity(a: Appt, order: readonly ApptStatus[]): Appt {
  if (a.messages && a.log) return a
  const { messages, log } = buildActivity(a, order)
  a.messages = messages
  a.log = log
  return a
}

export interface CommandCtx {
  /** "10:36 AM", read once per command. */
  clock: string
  /** Epoch milliseconds, for `startedAt`. */
  nowMs: number
  order: readonly ApptStatus[]
}

const sys = (text: string, time: string, channel = 'WhatsApp'): Message => ({
  from: 'system',
  text,
  time,
  channel,
})

/** What advance() appends per target status (the thread line is null for the internal note). */
const ADVANCE_AUTO = (a: Pick<Appt, 'time'>): Record<string, Auto> => ({
  confirmed: [
    'Confirmation + reminder sent',
    'WhatsApp',
    'Your appointment is confirmed for ' + a.time + '.',
  ],
  arrived: ['Arrival logged', 'Internal', null],
  cleaning: ['In-progress message sent', 'WhatsApp', 'Your vehicle is now being cleaned.'],
  completed: ['Ready-for-pickup sent', 'WhatsApp', 'Your vehicle is ready for pickup!'],
})

/** advance(): move to the next status (or capture the payment of a completed job) with its log and message lines. */
export function advanceAppt(
  work: Appt,
  step: Step,
  ctx: CommandCtx,
  catalog: { services: Services; addonTasks: AddonTasks },
): Appt {
  const a = withActivity(work, ctx.order)
  a.messages = [...a.messages!]
  a.log = [...a.log!]
  if (step.to === 'pay') {
    a.pay = 'paid'
    a.log.push({ time: ctx.clock, text: 'Payment captured · receipt sent', channel: 'Email + WhatsApp' })
    a.messages.push(sys('Payment received — receipt sent. Thank you!', ctx.clock))
  } else {
    a.status = step.to
    if (step.to === 'cleaning') a.startedAt = ctx.nowMs
    if (step.to === 'completed') {
      a.pickup = a.pickup || 'pending'
      a.notified = true
      a.checks = initChecks(a.svc, a.addons, 1, catalog.services, catalog.addonTasks)
    }
    const x = ADVANCE_AUTO(work)[step.to]
    if (x) {
      a.log.push({ time: ctx.clock, text: x[0], channel: x[1] })
      if (x[2]) a.messages.push({ from: 'system', text: x[2], time: ctx.clock, channel: x[1] })
    }
  }
  return a
}

/** assignToBay(): the car goes into a bay and cleaning starts. */
export function assignBay(work: Appt, num: number, ctx: CommandCtx): Appt {
  const a = withActivity(work, ctx.order)
  a.messages = [...a.messages!]
  a.log = [...a.log!]
  a.bay = num
  a.status = 'cleaning'
  a.startedAt = ctx.nowMs
  a.log.push({ time: ctx.clock, text: 'Assigned to Bay ' + num + ' · cleaning started', channel: 'Internal' })
  a.messages.push(sys('Your ' + a.veh.make + ' is now being cleaned.', ctx.clock))
  return a
}

/** togglePay(): `wasPaid` is the state before the toggle. */
export function togglePayment(work: Appt, wasPaid: boolean, ctx: CommandCtx): Appt {
  const a = withActivity(work, ctx.order)
  a.messages = [...a.messages!]
  a.log = [...a.log!]
  a.pay = wasPaid ? 'unpaid' : 'paid'
  if (!wasPaid) {
    a.log.push({ time: ctx.clock, text: 'Payment captured · receipt sent', channel: 'Email + WhatsApp' })
    a.messages.push(sys('Payment received — receipt sent. Thank you!', ctx.clock))
  } else {
    a.log.push({ time: ctx.clock, text: 'Marked unpaid · balance reopened', channel: 'Internal' })
  }
  return a
}

/** togglePickup(): `wasCollected` is the state before the toggle. */
export function togglePickupState(work: Appt, wasCollected: boolean, ctx: CommandCtx): Appt {
  const a = withActivity(work, ctx.order)
  a.log = [...a.log!]
  a.pickup = wasCollected ? 'pending' : 'collected'
  a.log.push({
    time: ctx.clock,
    text: wasCollected ? 'Pickup reopened' : 'Vehicle released to customer',
    channel: 'Internal',
  })
  return a
}

/** collect(): mark paid from the modal's Payments tab. `ready` never occurs, so the status branch is dead as in the original. */
export function collectPayment(work: Appt, ctx: CommandCtx): Appt {
  const a = withActivity(work, ctx.order)
  a.pay = 'paid'
  if (a.status === 'ready') a.status = 'paid'
  a.messages = [...a.messages!, sys('Payment received — receipt sent. Thank you!', ctx.clock)]
  a.log = [
    ...a.log!,
    { time: ctx.clock, text: 'Payment captured · receipt sent', channel: 'Email + WhatsApp' },
  ]
  return a
}

export function sendStaffMessage(work: Appt, text: string, ctx: CommandCtx): Appt {
  const a = withActivity(work, ctx.order)
  a.messages = [...a.messages!, { from: 'staff', text, time: ctx.clock, channel: 'WhatsApp' }]
  a.log = [...a.log!, { time: ctx.clock, text: 'Staff message sent', channel: 'WhatsApp' }]
  return a
}

/** notify(): the ready-for-pickup text. */
export function notifyReady(work: Appt, ctx: CommandCtx): Appt {
  const a = withActivity(work, ctx.order)
  a.notified = true
  a.messages = [...a.messages!, sys('Your vehicle is ready for pickup!', ctx.clock)]
  a.log = [...a.log!, { time: ctx.clock, text: 'Ready-for-pickup sent', channel: 'WhatsApp' }]
  return a
}

/** reschedule(): the new time, the customer message and the log line; `late` is cleared. */
export function rescheduleAppt(work: Appt, newTime: string, ctx: CommandCtx): Appt {
  const a = withActivity(work, ctx.order)
  a.messages = [
    ...a.messages!,
    sys('Your appointment has been moved to ' + newTime + '. Reply if that doesn’t work.', ctx.clock),
  ]
  a.log = [...a.log!, { time: ctx.clock, text: 'Rescheduled to ' + newTime, channel: 'Internal' }]
  a.time = newTime
  a.late = false
  return a
}

/** prepBay(): internal note only. */
export function prepBayNote(work: Appt, ctx: CommandCtx): Appt {
  const a = withActivity(work, ctx.order)
  a.prepped = true
  a.log = [
    ...a.log!,
    { time: ctx.clock, text: 'Bay ' + (a.bay || '') + ' prepped for arrival', channel: 'Internal' },
  ]
  return a
}

/** simArrive(): geofence check-in with the welcome message. */
export function checkInArrival(work: Appt, ctx: CommandCtx): Appt {
  const a = withActivity(work, ctx.order)
  a.status = 'arrived'
  a.geoIn = ctx.clock
  a.eta = null
  a.late = false
  a.log = [...a.log!, { time: ctx.clock, text: 'Auto check-in · geofence', channel: 'Automation' }]
  a.messages = [
    ...a.messages!,
    sys('Welcome to Oasis! You’re checked in' + (a.bay ? ' — pull into Bay ' + a.bay : '') + '.', ctx.clock),
  ]
  return a
}
