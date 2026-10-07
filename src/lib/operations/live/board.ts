// The board regions of the live Operations screen as template values: timeline cards, bays, arrivals, the pickup column,
// Up Next, staff columns, KPI tiles and Needs Attention. The server sends the facts and the labels (OpsSnapshot); this
// file adds what the design computes in the browser: styles, the ticking bay timers (from the server's ISO start and the
// synced server clock) and the handlers. The style objects equal the fixture class's (Logic.ts): board.test.ts runs both
// on the same appointment and compares them key by key.
import type {
  OpsAlert,
  OpsArrival,
  OpsBay,
  OpsCard,
  OpsKpi,
  OpsSnapshot,
  OpsStaffColumn,
} from '@/data/ports/operations'
import { hexA, lighten } from '@/lib/color'
import { businessClock } from '@/lib/tz'
import { memberMeta } from '../status'
import type { GestureCtx } from '../gesture'
import type { Style } from '../types'
import { KPI_ACCENTS } from '../kpis'
import { firstWord, initialsOf } from './fmt'

type VM = Record<string, unknown>

/** The slice of a pointer event the gesture engine reads (a React synthetic event satisfies it). */
export interface GestureEvent {
  button: number
  clientX: number
  clientY: number
  pointerType: string
  currentTarget: EventTarget & HTMLElement
}

export interface BoardUi {
  dark: boolean
  dragId: string | null
  dropTarget: string | null
  nowMs: number
  tz: string
}

export interface BoardHandlers {
  /** Opens the file from a card (honours the click suppression after a gesture). */
  open(id: string, tab?: string): void
  /** Opens the file from a bay, a column or an alert. */
  select(id: string, tab?: string): void
  advance(card: OpsCard): void
  down(e: GestureEvent, card: OpsCard, ctx: GestureCtx): void
  prepBay(id: string): void
  arrive(id: string): void
  assignNext(bay: OpsBay): void
  togglePay(card: OpsCard): void
  togglePickup(card: OpsCard): void
  alertAction(alert: OpsAlert): void
}

export const LATE_COLOR = '#C2410C'
export const AMBER = '#B07908'

export const TONES = (dark: boolean) => ({
  red: { c: '#C2410C', bg: dark ? 'rgba(194,65,12,.14)' : '#FBEAE0' },
  amber: { c: AMBER, bg: dark ? 'rgba(176,121,8,.14)' : '#FAF0D8' },
  blue: { c: '#2563EB', bg: dark ? 'rgba(37,99,235,.14)' : '#E5EEFD' },
  green: { c: '#0E9E6E', bg: dark ? 'rgba(14,158,110,.14)' : '#DCF1E8' },
  violet: { c: '#7A3B8A', bg: dark ? 'rgba(122,59,138,.16)' : '#F0E3F4' },
})

export function badgeStyle(c: string, dark: boolean): Style {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    padding: '3px 9px',
    borderRadius: '7px',
    fontSize: '11px',
    fontWeight: 800,
    whiteSpace: 'nowrap',
    background: hexA(c, dark ? 0.18 : 0.12),
    color: dark ? lighten(c) : c,
    letterSpacing: '0.01em',
  }
}

/** The colour of a pay label: settled teal, waiting on Squarespace amber, everything open the design's orange. */
export function payColor(kind: OpsCard['pay']['kind'], dark: boolean): string {
  if (kind === 'paid') return dark ? '#5FC9A6' : '#0D9488'
  if (kind === 'pending') return dark ? lighten(AMBER) : AMBER
  if (kind === 'none') return 'var(--ink3)'
  return LATE_COLOR
}

export function memberBadge(plan: string | null, dark: boolean, size: 'card' | 'file'): Style {
  const mm = memberMeta(plan)
  if (!mm) return {}
  return {
    fontSize: size === 'card' ? '10px' : '11px',
    fontWeight: 800,
    padding: size === 'card' ? '2px 7px' : '3px 9px',
    borderRadius: size === 'card' ? '6px' : '7px',
    background: dark ? hexA(mm.c, 0.2) : mm.bg,
    color: dark ? lighten(mm.c) : mm.c,
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  }
}

/** A card the person may move: not in a bay, not done (the server's canDrag). */
export const cardCursor = (c: OpsCard): string => (c.canDrag ? 'grab' : 'pointer')

export function cardVM(c: OpsCard, ui: BoardUi, h: BoardHandlers): VM {
  const color = c.late ? LATE_COLOR : c.badge.color
  const dark = ui.dark
  const dragging = ui.dragId === c.id
  const step = c.next.step
  return {
    id: c.id,
    name: c.customer.name,
    vehicleLine: c.vehicleLine,
    short: c.vehicleShort,
    service: c.service,
    time: c.time,
    statusColor: color,
    badgeLabel: c.badge.label,
    badgeStyle: badgeStyle(color, dark),
    vip: c.vip,
    member: !!c.member,
    memberLabel: c.member ? c.member.label : '',
    memberPlain: c.member ? c.member.plan : 'Non-member',
    memberStyle: memberBadge(c.member?.plan ?? null, dark, 'card'),
    bayLabel: c.bayLabel,
    durLabel: c.durLabel,
    payLabel: c.pay.label,
    payStyle: { fontSize: '11.5px', fontWeight: 800, color: payColor(c.pay.kind, dark) },
    hasNotes: c.hasNotes,
    hasPhotos: c.hasPhotos,
    hasAddons: c.hasAddons,
    addonCount: c.addonCount,
    iconWrap: { display: 'inline-flex', alignItems: 'center', gap: '6px' },
    nextLabel: c.next.label,
    nextColor: step ? (dark ? 'var(--accentInk)' : 'var(--accent)') : 'var(--ink3)',
    nextStyle: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginTop: '10px',
      paddingTop: '10px',
      borderTop: '1px solid var(--line2)',
    },
    cardStyle: {
      position: 'relative',
      zIndex: 1,
      width: '100%',
      textAlign: 'left',
      background: 'var(--panel)',
      border: '1px solid var(--line)',
      borderRadius: '15px',
      padding: '13px 15px 13px 17px',
      boxShadow: 'var(--shadow)',
      cursor: cardCursor(c),
      transition: 'transform .12s ease',
      touchAction: 'pan-y',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      WebkitTouchCallout: 'none',
      opacity: dragging ? 0.45 : 1,
    },
    railStyle: {
      position: 'absolute',
      left: 0,
      top: '10px',
      bottom: '10px',
      width: '4px',
      borderRadius: '4px',
      background: color,
    },
    chipStyle: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '9px',
      minHeight: '44px',
      padding: '8px 14px',
      background: 'var(--panel2)',
      border: '1px solid var(--line)',
      borderLeft: '3px solid ' + color,
      borderRadius: '11px',
      touchAction: 'pan-y',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      WebkitTouchCallout: 'none',
      cursor: cardCursor(c),
      opacity: dragging ? 0.45 : 1,
    },
    onPointerDown: (e: GestureEvent) => h.down(e, c, 'tl'),
    onQDown: (e: GestureEvent) => h.down(e, c, 'q'),
    onCalDown: (e: GestureEvent) => h.down(e, c, 'cal'),
    open: () => h.open(c.id),
    doNext: () => h.advance(c),
  }
}

// ---- timeline -------------------------------------------------------------------------------------------------------

export function groupVMs(snap: OpsSnapshot, ui: BoardUi, h: BoardHandlers): VM[] {
  return snap.timeline.groups.map((g) => ({
    key: g.key,
    day: g.bizDate,
    time: g.time,
    ampm: g.ampm,
    items: g.items.map((c) => cardVM(c, ui, h)),
    dividerLabel: g.divider,
    dividerStyle: g.divider
      ? {
          fontSize: '11px',
          fontWeight: 800,
          color: 'var(--ink3)',
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          padding: '6px 2px 8px',
        }
      : { display: 'none' },
  }))
}

// ---- bays -----------------------------------------------------------------------------------------------------------

/** What the bay timer shows `nowMs` after the car went in: elapsed text, percent and the planned finish. */
export function bayClock(
  o: NonNullable<OpsBay['occupant']>,
  nowMs: number,
  tz: string,
): { elapsed: string; pct: number; eta: string } {
  const started = Date.parse(o.startedAt)
  const elapsedMs = Math.max(0, nowMs - started)
  const min = Math.floor(elapsedMs / 60000)
  const sec = Math.floor(elapsedMs / 1000) % 60
  const dur = o.card.durationMin
  const pct = Math.min(100, (elapsedMs / 60000 / dur) * 100)
  // never earlier than now: an overrunning job's finish keeps moving with the clock
  const eta = Math.max(started + dur * 60000, nowMs)
  return { elapsed: `${min}:${String(sec).padStart(2, '0')}`, pct, eta: businessClock(eta, tz) }
}

export function bayVM(b: OpsBay, ui: BoardUi, h: BoardHandlers): VM {
  const dark = ui.dark
  const drop = 'bay:' + b.number
  const hover = !!ui.dragId && ui.dropTarget === drop
  if (!b.occupant) {
    const unavailable = b.status !== 'active'
    return {
      name: b.name,
      free: true,
      occupied: false,
      tagStyle: {
        padding: '5px 12px',
        borderRadius: '9px',
        background: 'var(--panel2)',
        border: '1px solid var(--line)',
        fontWeight: 800,
        fontSize: '13px',
        color: 'var(--ink2)',
      },
      nextUp: unavailable ? 'Out of service' : b.nextUp,
      drop,
      shellStyle: {
        background: 'var(--panel)',
        border: '1px solid ' + (hover ? 'var(--accent)' : ui.dragId ? 'var(--accentBrd)' : 'var(--line)'),
        borderRadius: '20px',
        padding: '20px',
        boxShadow: 'var(--shadow)',
        transition: 'border-color .12s ease',
      },
      dropZoneStyle: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '30px 0 26px',
        textAlign: 'center',
        borderRadius: '14px',
        border: '2px dashed ' + (hover ? 'var(--accent)' : ui.dragId ? 'var(--accentBrd)' : 'transparent'),
        background: hover ? 'var(--accentSoft)' : 'transparent',
        transition: 'all .12s ease',
      },
      assign: () => h.assignNext(b),
    }
  }
  const occ = b.occupant
  const card = occ.card
  const meta = { l: card.badge.label, c: card.badge.color }
  const showProg = card.status === 'cleaning'
  const clock = bayClock(occ, ui.nowMs, ui.tz)
  return {
    name: b.name,
    occupied: true,
    free: false,
    tagStyle: {
      padding: '5px 12px',
      borderRadius: '9px',
      background: hexA(meta.c, dark ? 0.2 : 0.12),
      color: dark ? lighten(meta.c) : meta.c,
      fontWeight: 800,
      fontSize: '13px',
    },
    badgeLabel: meta.l,
    badgeStyle: badgeStyle(meta.c, dark),
    vehicle: [card.vehicle?.year, card.vehicle?.make, card.vehicle?.model].filter(Boolean).join(' '),
    customer: card.customer.name,
    plate: card.vehicle?.plate ?? '',
    service: card.service,
    statusColor: meta.c,
    worker: occ.worker?.name ?? 'Unassigned',
    workerInitials: occ.worker?.initials ?? '—',
    showProgress: showProg,
    elapsed: showProg ? clock.elapsed : '—',
    eta: clock.eta,
    progressStyle: {
      height: '100%',
      width: clock.pct + '%',
      background: meta.c,
      borderRadius: '6px',
      transition: 'width 1s linear',
    },
    progressLabel: Math.round(clock.pct) + '% complete',
    durLabel: occ.durLabel,
    drop,
    shellStyle: {
      background: 'var(--panel)',
      border: '1px solid var(--line)',
      borderLeft: '4px solid ' + meta.c,
      borderRadius: '20px',
      padding: '20px',
      boxShadow: 'var(--shadow)',
      outline: hover ? '2px dashed ' + LATE_COLOR : 'none',
    },
    nextLabel: card.next.label,
    primaryStyle: {
      flex: 1,
      height: '52px',
      background: 'var(--accent)',
      color: '#fff',
      borderRadius: '13px',
      fontWeight: 800,
      fontSize: '15px',
      boxShadow: '0 8px 18px var(--accentSoft)',
    },
    open: () => h.select(card.id),
    doNext: () => h.advance(card),
  }
}

export function arrivalVM(a: OpsArrival, ui: BoardUi, h: BoardHandlers): VM {
  const dark = ui.dark
  return {
    title: a.title,
    desc: a.desc,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '13px 14px',
      borderRadius: '16px',
      flexWrap: 'wrap',
      background: a.vip ? (dark ? 'rgba(122,59,138,.2)' : '#F3E8F6') : 'var(--panel)',
      border: '1px solid ' + (a.vip ? 'rgba(122,59,138,.4)' : 'var(--line)'),
    },
    dot: {
      width: '10px',
      height: '10px',
      borderRadius: '50%',
      flex: 'none',
      background: a.vip ? '#7A3B8A' : '#2563EB',
    },
    prepLabel: a.prepLabel,
    prepStyle: {
      height: '44px',
      padding: '0 14px',
      borderRadius: '11px',
      fontWeight: 800,
      fontSize: '12.5px',
      background: a.prepped ? 'var(--accentSoft)' : a.vip ? '#7A3B8A' : 'var(--accent)',
      color: a.prepped ? 'var(--accentInk)' : '#fff',
    },
    prep: () => h.prepBay(a.appointmentId),
    arrive: () => h.arrive(a.appointmentId),
  }
}

// ---- pickup column --------------------------------------------------------------------------------------------------

const chip = (active: boolean, c: string, dark: boolean): Style => ({
  height: '34px',
  padding: '0 13px',
  borderRadius: '9px',
  fontWeight: 800,
  fontSize: '12px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  cursor: 'pointer',
  background: active ? hexA(c, dark ? 0.22 : 0.14) : 'var(--panel)',
  color: active ? (dark ? lighten(c) : c) : 'var(--ink3)',
  border: '1px solid ' + (active ? hexA(c, 0.32) : 'var(--line)'),
})

export function completedVM(c: OpsCard, ui: BoardUi, h: BoardHandlers): VM {
  const dark = ui.dark
  const paid = c.pay.kind === 'paid'
  const pending = c.pay.kind === 'pending'
  const collected = c.pickupState === 'collected'
  const accent = collected && paid ? '#0E9E6E' : paid ? AMBER : pending ? AMBER : LATE_COLOR
  return {
    id: c.id,
    name: c.customer.name,
    vehicleLine: c.vehicleLine,
    service: c.service,
    time: c.time,
    accent,
    shellStyle: {
      position: 'relative',
      padding: '14px 15px 14px 18px',
      background: 'var(--panel2)',
      border: '1px solid var(--line)',
      borderRadius: '15px',
    },
    payChipLabel: paid ? 'Paid' : pending ? 'Payment pending' : 'Unpaid · collect',
    payChipStyle: pending ? chip(true, AMBER, dark) : chip(!paid, LATE_COLOR, dark),
    pickupChipLabel: collected ? 'Picked up' : 'Needs pickup',
    pickupChipStyle: chip(!collected, '#0E7A63', dark),
    togglePay: () => h.togglePay(c),
    togglePickup: () => h.togglePickup(c),
    open: () => h.select(c.id),
  }
}

// ---- staff ----------------------------------------------------------------------------------------------------------

const AVATAR_DEFAULT = '#6B7280'

export function staffVM(s: OpsStaffColumn, ui: BoardUi, h: BoardHandlers): VM {
  const color = s.employeeId ? (s.avatarColor ?? AVATAR_DEFAULT) : AVATAR_DEFAULT
  const dark = ui.dark
  const jobs = s.jobs.map((c) => cardVM(c, ui, h))
  return {
    name: s.name,
    role: s.role,
    initials: s.employeeId ? s.initials : '—',
    avatarStyle: {
      width: '40px',
      height: '40px',
      borderRadius: '12px',
      background: hexA(color, dark ? 0.22 : 0.14),
      color: dark ? lighten(color) : color,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 800,
      fontSize: '14px',
      flex: 'none',
    },
    count: jobs.length,
    jobs,
    empty: jobs.length === 0,
  }
}

// ---- KPIs and alerts ------------------------------------------------------------------------------------------------

export const kpiVMs = (kpis: readonly OpsKpi[]): VM[] =>
  kpis.map((k, i) => ({
    label: k.label,
    value: k.value,
    sub: k.sub,
    accent: KPI_ACCENTS[i] ?? KPI_ACCENTS[0]!,
  }))

export function alertVM(a: OpsAlert, dark: boolean, h: BoardHandlers): VM {
  const tn = TONES(dark)[a.tone]
  return {
    shellStyle: {
      padding: '13px 14px',
      background: tn.bg,
      border: '1px solid ' + hexA(tn.c, 0.2),
      borderRadius: '14px',
    },
    iconStyle: {
      width: '34px',
      height: '34px',
      borderRadius: '10px',
      background: hexA(tn.c, dark ? 0.28 : 0.16),
      color: dark ? lighten(tn.c) : tn.c,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontWeight: 800,
      fontSize: '16px',
      flex: 'none',
    },
    glyph: a.glyph,
    title: a.title,
    desc: a.desc,
    actionLabel: a.actionLabel,
    actionStyle: {
      height: '38px',
      padding: '0 15px',
      background: tn.c,
      color: '#fff',
      borderRadius: '10px',
      fontWeight: 700,
      fontSize: '12.5px',
    },
    action: () => h.alertAction(a),
    pri: a.priority,
    open: () => (a.appointmentId ? h.select(a.appointmentId) : undefined),
  }
}

export { firstWord, initialsOf }
