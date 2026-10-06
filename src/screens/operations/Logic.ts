/* eslint-disable @typescript-eslint/no-explicit-any */
// The Operations (Command Center) view model: a typed port of the `Component` class in
// design/extracted/operations/logic.original.js. It behaves identically (the parity harness and Logic.diff.test.ts
// hold it to that): synchronous setState, a 1 s tick, the pointer gesture engine with its imperative style writes,
// `elementFromPoint` drop targets, the window keyboard handler, and a renderVals() whose keys, order and values match
// the original's. What changed is where things live: fixtures, localStorage and the clock sit behind `OperationsData`
// (data.ts); the pure formulas are in src/lib/operations (unit and differential tested). docs/screens-operations.md
// maps every method to the original.
import * as React from 'react'
import type { LiveChrome } from '@/auth/chrome'
import { DCLogic } from '@/dc/DCLogic'
import { hexA, lighten, statusMeta } from '@/lib/color'
import { clockLabel, fmtT, parseT } from '@/lib/time'
import {
  ADVANCE_FALLBACK_TITLE,
  ADVANCE_TOASTS,
  DOW,
  LONG_PRESS_MS,
  MONTHS,
  ORDER,
  advanceAppt,
  arrivalsOf,
  assignBay,
  balance,
  bayProgress,
  buildAlerts,
  buildKpis,
  calendarSwipe,
  canDrag,
  checkInArrival,
  checklistFor,
  checklistProgress,
  clickSuppressed,
  collectPayment,
  countFor,
  dateFor,
  dayHeading,
  decideMove,
  generateDay,
  ghostTransform,
  groupTimeline,
  hintFor,
  hourLabel,
  hydrateSeed,
  infoFor,
  inFacility,
  initChecks,
  isLate,
  iso,
  memberMeta,
  money,
  monthGrid,
  navOffset,
  nextForBay,
  nextStep,
  notifyReady,
  occupantOf,
  offFor,
  prepBayNote,
  queueOf,
  rescheduleAppt,
  rowRange,
  absMin,
  selectPool,
  sendStaffMessage,
  sectionKeys,
  setChecks,
  sortPool,
  swipeOutcome,
  swipeTransform,
  togglePayment,
  togglePickupState,
  total,
  upcoming,
  weekHeading,
  withActivity,
} from '@/lib/operations'
import type {
  AddonCatalog,
  AddonTasks,
  Appt,
  ApptStatus,
  CalMode,
  Closure,
  DayHours,
  Emergency,
  GestureCtx,
  HistoryDef,
  RangeName,
  Services,
  Style,
  Theme,
  VehicleDef,
  ViewName,
} from '@/lib/operations'
import type { AlertAction, AlertSpec, Step } from '@/lib/operations'
import type { CommandCtx } from '@/lib/operations/activity'
import type { Pools } from '@/lib/operations/calendar'
import type { OperationsData } from './data'
import { FixtureData } from './fixtures'

/** True in the live build, where the class talks to the session chrome the way the compiler's bridge does for the other screens. */
const LIVE = process.env.NEXT_PUBLIC_VARIANT === 'live'
const chrome = (): LiveChrome | null => (typeof window !== 'undefined' && window.__oasisLive) || null

export interface Toast {
  title: string
  desc?: string
}

export interface Ghost {
  name: string
  vehicle: string
  hint: string
}

/** `this.state`, in the original's key order. */
export interface OpsState {
  NOW: number
  ORDER: readonly ApptStatus[]
  services: Services
  ADDONS: AddonCatalog
  theme: Theme
  view: ViewName
  search: string
  range: RangeName
  appts: Appt[]
  selectedId: string | null
  modalTab: string
  newOpen: boolean
  newTitle: string
  pickedService: string
  pickedSlot: string
  tick: number
  toast: Toast | null
  dragId: string | null
  dropTarget: string | null
  ghost: Ghost | null
  calMode: CalMode
  calOffset: number
  calAppts: Appt[]
  hours: DayHours[] | null
  closures: Closure[] | null
  emergency: Emergency | null
}

/** The slice of a pointer event the gesture engine reads (a React synthetic event satisfies it). */
export interface GestureEvent {
  button: number
  clientX: number
  clientY: number
  pointerType: string
  currentTarget: EventTarget & HTMLElement
}

interface Gesture {
  id: string
  a: Appt
  ctx: GestureCtx
  x0: number
  y0: number
  x: number
  y: number
  touch: boolean
  el: HTMLElement
  mode: 'drag' | 'swipe' | null
  can: boolean
  timer?: ReturnType<typeof setTimeout>
}

type VM = Record<string, any>

const CHROME_TONES = (dark: boolean) => ({
  red: { c: '#C2410C', bg: dark ? 'rgba(194,65,12,.14)' : '#FBEAE0' },
  amber: { c: '#B07908', bg: dark ? 'rgba(176,121,8,.14)' : '#FAF0D8' },
  blue: { c: '#2563EB', bg: dark ? 'rgba(37,99,235,.14)' : '#E5EEFD' },
  green: { c: '#0E9E6E', bg: dark ? 'rgba(14,158,110,.14)' : '#DCF1E8' },
  violet: { c: '#7A3B8A', bg: dark ? 'rgba(122,59,138,.16)' : '#F0E3F4' },
})

const TEMPLATES: ReadonlyArray<readonly [label: string, text: string]> = [
  ['Confirmed', 'Your appointment is confirmed. See you soon!'],
  ['We’re ready', 'We’re ready for you — come on in!'],
  ['Checked in', 'Your vehicle has been checked in.'],
  ['Being cleaned', 'Your vehicle is now being cleaned.'],
  ['Ready for pickup', 'Your vehicle is ready for pickup!'],
  ['Approve add-on?', 'We recommend an add-on — would you like to approve it?'],
  ['Payment link', 'Here is your secure payment link.'],
]

const VIEW_ICONS: Record<ViewName, string> = {
  timeline:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  bay: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="8" height="16" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="13" y="4" width="8" height="16" rx="1.5" stroke="currentColor" stroke-width="2"/></svg>',
  staff:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="2"/><path d="M3.5 19a5.5 5.5 0 0111 0M16 6.5a3 3 0 010 5.5M18 13a5 5 0 013 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  calendar:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" stroke-width="2"/><path d="M3 9h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
}

const TAB_ICONS: Record<string, string> = {
  overview:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="13" y="3" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="3" y="13" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="13" y="13" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="2"/></svg>',
  checklist:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 6l2 2 3-3M4 13l2 2 3-3M4 20l2 2 3-3M13 6h7M13 13h7M13 20h7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  addons:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  photos:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="14" rx="2" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="13" r="3" stroke="currentColor" stroke-width="2"/><path d="M8 6l1.5-2h5L16 6" stroke="currentColor" stroke-width="2"/></svg>',
  messages:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 5h16v11H8l-4 4z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  payments:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" stroke-width="2"/><path d="M3 10h18" stroke="currentColor" stroke-width="2"/></svg>',
  membership:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 16.5 7.1 21l.9-5.5-4-3.9 5.5-.8z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  history:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 12a9 9 0 109-9 9 9 0 00-7 3.3M3 4v3h3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 8v4l3 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
}

export class OperationsLogic extends DCLogic<OpsState> {
  // The class fields of the original (fixtures and constants), filled from the data source.
  SERVICES: Services
  ADDONS: AddonCatalog
  ADDON_TASKS: AddonTasks
  HIST: HistoryDef[]
  DEF_HOURS: DayHours[]
  DEF_CLOSURES: Closure[]
  POOL_NAMES: string[]
  POOL_VEH: VehicleDef[]
  BASE: Date
  ghostRef = React.createRef<HTMLDivElement>()

  readonly data: OperationsData

  // Internals the original keeps as ad-hoc properties.
  _t: ReturnType<typeof setInterval> | undefined
  _tt: ReturnType<typeof setTimeout> | undefined
  _key: ((e: KeyboardEvent) => void) | undefined
  _tb: ((e: TouchEvent) => void) | undefined
  _g: Gesture | null = null
  _cs: { x: number; y: number; t: number } | null = null
  _sup = 0
  _gen: Record<number, Appt[]> | undefined
  private __liveOff: (() => void) | null = null

  constructor(props?: Record<string, any>, data: OperationsData = new FixtureData()) {
    super(props)
    this.data = data
    const cat = data.catalog()
    this.SERVICES = cat.services
    this.ADDONS = cat.addons as AddonCatalog
    this.ADDON_TASKS = cat.addonTasks
    this.HIST = data.generatedHistory()
    this.DEF_HOURS = data.defaultHours()
    this.DEF_CLOSURES = data.defaultClosures()
    const pools = data.pools()
    this.POOL_NAMES = pools.names
    this.POOL_VEH = pools.vehicles
    const base = data.today().base
    this.BASE = new Date(base.y, base.m, base.d)
    this.state = this.initialState()
  }

  private initialState(): OpsState {
    const data = this.data
    const NOW = data.today().nowMinutes
    const services = this.SERVICES
    const catalog = { services, addons: this.ADDONS, addonTasks: this.ADDON_TASKS }
    const histPool = data.historyPool()
    const nowMs = data.clock().nowMs()
    const appts = data.seedAppointments().map((a, idx) => hydrateSeed(a, idx, catalog, histPool, nowMs))
    return {
      NOW,
      ORDER,
      services,
      ADDONS: this.ADDONS,
      theme: data.theme(),
      view: 'timeline',
      search: '',
      range: 'next24',
      appts,
      selectedId: null,
      modalTab: 'overview',
      newOpen: false,
      newTitle: 'New Appointment',
      pickedService: 'Premium Hand Wash + Interior',
      pickedSlot: '2:30 PM',
      tick: 0,
      toast: null,
      dragId: null,
      dropTarget: null,
      ghost: null,
      calMode: 'day',
      calOffset: 0,
      calAppts: [],
      hours: data.hours(),
      closures: data.closures(),
      emergency: data.emergency(),
    }
  }

  componentDidMount() {
    if (LIVE) this.liveMount()
    this._t = setInterval(() => this.setState((s) => ({ tick: s.tick + 1 })), 1000)
    this._key = (e: KeyboardEvent) => {
      const tag = ((e.target as HTMLElement | null) && (e.target as HTMLElement).tagName) || ''
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (e.key === 'Escape') (e.target as HTMLElement).blur()
        return
      }
      if (e.key === 'Escape') {
        this.setState({ selectedId: null, newOpen: false })
        return
      }
      if (e.key === '/') {
        e.preventDefault()
        const el = document.getElementById('oa-search')
        if (el) el.focus()
        return
      }
      if (e.key.toLowerCase() === 'n') {
        this.setState({ newOpen: true })
        return
      }
      if (this.state.view === 'calendar' && !this.state.selectedId) {
        if (e.key === 'ArrowLeft') {
          this.calNav(-1)
          return
        }
        if (e.key === 'ArrowRight') {
          this.calNav(1)
          return
        }
        if (e.key.toLowerCase() === 't') {
          this.setState({ calOffset: 0 })
          return
        }
      }
      const sel = this.state.selectedId
      if (sel) {
        const k = e.key.toLowerCase()
        if (k === 'm') this.flash('Message composer opened', 'WhatsApp to ' + this.byId(sel)!.cust.name)
        if (k === 'p') this.setState({ modalTab: 'payments' })
        if (k === 's' || k === 'r') this.advance(sel)
      }
    }
    window.addEventListener('keydown', this._key)
    this._tb = (e: TouchEvent) => {
      if (this._g && this._g.mode) e.preventDefault()
    }
    document.addEventListener('touchmove', this._tb, { passive: false })
  }

  componentWillUnmount() {
    if (this.__liveOff) {
      this.__liveOff()
      this.__liveOff = null
    }
    clearInterval(this._t)
    window.removeEventListener('keydown', this._key!)
    document.removeEventListener('touchmove', this._tb!)
    this.gEnd()
  }

  /** The live build's session chrome (what tools/dc-compile/live-bridge.ts adds to the original classes). */
  private liveMount() {
    const c = chrome()
    if (!c) return
    const offs = [
      c.subscribe(() => this.forceUpdate()),
      c.subscribeToasts((t) => this.flash(t.title, t.desc)),
    ]
    this.__liveOff = () => offs.forEach((off) => off())
  }

  // ---------- clock ----------
  nowMs(): number {
    return this.data.clock().nowMs()
  }
  nowClock(): string {
    const w = this.data.clock().wall()
    return clockLabel(w.hours, w.minutes)
  }
  private cmdCtx(): CommandCtx {
    return { clock: this.nowClock(), nowMs: this.nowMs(), order: this.state.ORDER }
  }
  private get catalog() {
    return { services: this.SERVICES, addons: this.ADDONS, addonTasks: this.ADDON_TASKS }
  }

  // ---------- checklist: package + add-ons ----------
  checklistFor(a: { svc: string; addons?: ReadonlyArray<{ name: string } | string> }) {
    return checklistFor(a as any, this.SERVICES, this.ADDON_TASKS)
  }
  initChecks(svc: string, addons: ReadonlyArray<{ name: string } | string>, fr: number) {
    return initChecks(svc, addons as any, fr, this.SERVICES, this.ADDON_TASKS)
  }
  setFrac(a: Appt, fr: number) {
    a.checks = this.initChecks(a.svc, a.addons, fr)
  }
  prepBay(id: string) {
    const a = this.byId(id)
    if (!a) return
    const ctx = this.cmdCtx()
    this.update(id, (x) => prepBayNote(x, ctx))
    this.flash(
      'Bay ' + (a.bay || '') + ' prepped',
      (a.vip ? 'VIP ' : '') + a.cust.name + ' arrives in ' + a.eta + ' min',
    )
  }
  simArrive(id: string) {
    const a = this.byId(id)
    if (!a) return
    const ctx = this.cmdCtx()
    this.update(id, (x) => checkInArrival(x, ctx))
    this.flash('Checked in automatically', a.cust.name + ' · welcome message sent')
  }
  toggleCheckKey(id: string, key: string) {
    this.update(id, (a) => {
      a.checks = { ...a.checks, [key]: !a.checks[key] }
      return a
    })
  }
  checkAll(id: string, keys: string[], val: boolean, quiet?: boolean) {
    this.update(id, (a) => {
      a.checks = setChecks(a.checks, keys, val)
      return a
    })
    if (!quiet)
      this.flash(
        val ? 'All tasks checked' : 'Checklist cleared',
        keys.length + ' tasks ' + (val ? 'marked done' : 'reset'),
      )
  }
  checkVM(sa: Appt): VM {
    const secs = this.checklistFor(sa)
    const ch = sa.checks || {}
    const dark = this.state.theme === 'dark'
    const all = sectionKeys(secs)
    const { done, total: tot, allDone, pct } = checklistProgress(secs, ch)
    return {
      checkDone: done,
      checkTotal: tot,
      checkPct: pct + '%',
      checkPctLabel: pct + '%',
      checkAllLabel: allDone ? 'Clear all' : 'Check all',
      checkAllToggle: () => this.checkAll(sa.id, all, !allDone),
      checkAllStyle: {
        height: '46px',
        padding: '0 20px',
        borderRadius: '12px',
        fontWeight: 800,
        fontSize: '14px',
        flex: 'none',
        background: allDone ? 'var(--panel2)' : 'var(--accent)',
        color: allDone ? 'var(--ink2)' : '#fff',
        border: allDone ? '1px solid var(--line)' : '1px solid var(--accent)',
      },
      checkSections: secs.map((sc) => {
        const keys = sc.items.map((i) => i.key)
        const d = keys.filter((k) => ch[k]).length
        const full = d === keys.length
        const pk = sc.kind === 'Package'
        return {
          title: sc.title,
          kind: sc.kind,
          countLabel: d + ' / ' + keys.length,
          kindStyle: {
            fontSize: '10.5px',
            fontWeight: 800,
            padding: '4px 8px',
            borderRadius: '6px',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            flex: 'none',
            background: pk ? 'var(--accentSoft)' : hexA('#B07908', dark ? 0.22 : 0.14),
            color: pk ? 'var(--accentInk)' : dark ? lighten('#B07908') : '#8A5A06',
          },
          btnLabel: full ? 'Clear' : 'Check all',
          toggle: () => this.checkAll(sa.id, keys, !full, true),
          items: sc.items.map((it) => {
            const on = !!ch[it.key]
            return {
              label: it.label,
              done: on,
              toggle: () => this.toggleCheckKey(sa.id, it.key),
              rowStyle: {
                display: 'flex',
                alignItems: 'center',
                gap: '13px',
                width: '100%',
                minHeight: '52px',
                textAlign: 'left',
                padding: '12px 15px',
                background: on ? 'var(--accentSoft)' : 'var(--panel)',
                border: '1px solid ' + (on ? 'var(--accentBrd)' : 'var(--line)'),
                borderRadius: '12px',
              },
              boxStyle: {
                width: '24px',
                height: '24px',
                borderRadius: '7px',
                flex: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: on ? 'var(--accent)' : 'transparent',
                border: on ? 'none' : '2px solid var(--ink3)',
              },
              labelStyle: {
                fontSize: '14px',
                fontWeight: 600,
                color: on ? 'var(--ink2)' : 'var(--ink)',
                textDecoration: on ? 'line-through' : 'none',
              },
            }
          }),
        }
      }),
    }
  }

  // ---------- calendar data ----------
  dateFor(o: number): Date {
    const b = this.data.today().base
    return dateFor(o, b)
  }
  offFor(d: Date): number {
    return offFor(d, this.data.today().base)
  }
  iso(d: Date): string {
    return iso(d)
  }
  private schedule() {
    return {
      hours: this.state.hours || this.DEF_HOURS,
      closures: this.state.closures || this.DEF_CLOSURES,
    }
  }
  dayInfo(d: Date) {
    return infoFor(d, this.schedule())
  }
  countFor(o: number): number {
    return countFor(o, this.state.appts, this.data.today().base, this.schedule())
  }
  genDay(o: number): Appt[] {
    const s = this.state
    this._gen = this._gen || {}
    if (!this._gen[o]) {
      const pools: Pools = { names: this.POOL_NAMES, vehicles: this.POOL_VEH }
      this._gen[o] = generateDay(o, this.data.today().base, this.schedule(), this.catalog, pools, this.HIST)
    }
    let out = this._gen[o]!.map((a) => s.calAppts.find((x) => x.id === a.id) || a)
    if (o === 1) out = [...s.appts.filter((a) => a.day === 1), ...out]
    return out
  }
  known(id: string): boolean {
    const s = this.state
    return s.appts.some((x) => x.id === id) || s.calAppts.some((x) => x.id === id)
  }
  materialize(a: Appt) {
    if (!this.known(a.id)) this.setState((st) => ({ calAppts: [...st.calAppts, { ...a }] }))
  }
  openAppt(a: Appt, tab?: string) {
    if (clickSuppressed(this.nowMs(), this._sup)) return
    this.materialize(a)
    this.setState({ selectedId: a.id, modalTab: tab || 'overview' })
  }
  calNav(dir: number) {
    const s = this.state
    this.setState({ calOffset: navOffset(s.calMode, s.calOffset, dir, this.data.today().base) })
  }
  reschedule(a: Appt, hr: number) {
    if (!this.canDrag(a)) {
      this.flash('Can’t move this job', 'It’s already in progress or done')
      return
    }
    const nt = fmtT(hr * 60 + (parseT(a.time) % 60))
    if (nt === a.time) return
    const ctx = this.cmdCtx()
    this.materialize(a)
    this.update(a.id, (x) => rescheduleAppt(x, nt, ctx))
    this.flash('Moved to ' + nt, a.cust.name + ' notified via WhatsApp')
  }

  calVM(): VM {
    const s = this.state
    const off = s.calOffset
    const mode = s.calMode
    const cd = this.dateFor(off)
    const modeBtn = (k: CalMode, l: string) => ({
      label: l,
      onClick: () => this.setState({ calMode: k }),
      style: {
        height: '36px',
        padding: '0 16px',
        borderRadius: '9px',
        fontSize: '13px',
        fontWeight: 700,
        background: mode === k ? 'var(--panel)' : 'transparent',
        color: mode === k ? 'var(--ink)' : 'var(--ink2)',
        boxShadow: mode === k ? 'var(--shadow)' : 'none',
        border: mode === k ? '1px solid var(--line)' : '1px solid transparent',
      },
    })
    let calLabel = ''
    let calSub = ''
    const calRows: VM[] = []
    const calWeek: VM[] = []
    const calMonth: VM[] = []
    let calClosed = false
    let calClosedReason = ''
    const cell = (o: number) => {
      const d = this.dateFor(o)
      const inf = this.dayInfo(d)
      return {
        o,
        d,
        closed: o !== 0 && inf.closed ? inf.closed : null,
        n: o !== 0 && inf.closed ? 0 : this.countFor(o),
      }
    }
    const baseYear = this.data.today().base.y
    if (mode === 'day') {
      const inf = this.dayInfo(cd)
      calLabel = dayHeading(cd, baseYear)
      if (off !== 0 && inf.closed) {
        calClosed = true
        calClosedReason = inf.closed
        calSub = 'Closed'
      } else {
        const list = (off === 0 ? s.appts.filter((a) => a.day === 0) : this.genDay(off))
          .slice()
          .sort((x, y) => parseT(x.time) - parseT(y.time))
        const [h0, h1] = rowRange(inf)
        for (let h = h0; h < h1; h++) {
          const items = list.filter((a) => Math.floor(parseT(a.time) / 60) === h).map((a) => this.cardVM(a))
          const { time, ampm } = hourLabel(h)
          const hov = !!s.dragId && s.dropTarget === 'hr:' + h
          calRows.push({
            time,
            ampm,
            items,
            empty: items.length === 0,
            drop: 'hr:' + h,
            rowStyle: {
              display: 'flex',
              gap: '16px',
              borderTop: '1px solid var(--line2)',
              padding: '11px 8px',
              minHeight: '66px',
              borderRadius: hov ? '12px' : '0',
              background: hov ? 'var(--accentSoft)' : 'transparent',
              outline: hov ? '2px dashed var(--accent)' : 'none',
              transition: 'background .12s ease',
            },
          })
        }
        calSub =
          (off === 0 ? 'Today · ' : '') +
          list.length +
          ' appointment' +
          (list.length === 1 ? '' : 's') +
          ' · ' +
          (inf.note ? inf.note + ' · ' : '') +
          fmtT(h0 * 60) +
          ' – ' +
          fmtT(h1 * 60)
      }
    } else if (mode === 'week') {
      const start = off - cd.getDay()
      const e0 = this.dateFor(start)
      const e1 = this.dateFor(start + 6)
      let tot = 0
      calLabel = weekHeading(e0, e1)
      for (let i = 0; i < 7; i++) {
        const c = cell(start + i)
        tot += c.n
        const isT = c.o === 0
        calWeek.push({
          dow: DOW[i],
          num: String(c.d.getDate()),
          count: String(c.n),
          countLabel: c.n === 1 ? 'appointment' : 'appointments',
          open: !c.closed,
          closed: !!c.closed,
          reason: c.closed || '',
          isToday: isT,
          onClick: () => this.setState({ calMode: 'day', calOffset: c.o }),
          style: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            textAlign: 'left',
            padding: '16px',
            borderRadius: '16px',
            minHeight: '190px',
            background: c.closed ? 'var(--panel3)' : isT ? 'var(--accentSoft)' : 'var(--panel2)',
            border: '1px solid ' + (isT ? 'var(--accentBrd)' : 'var(--line)'),
            touchAction: 'manipulation',
          },
        })
      }
      calSub = tot + ' appointments this week · tap a day to open it'
    } else {
      const { y, m, firstOffset: fo, lead, cells } = monthGrid(cd, this.data.today().base)
      let tot = 0
      calLabel = MONTHS[m] + ' ' + y
      for (let i = 0; i < cells; i++) {
        const c = cell(fo - lead + i)
        const inM = c.d.getMonth() === m
        if (inM) tot += c.n
        const isT = c.o === 0
        calMonth.push({
          num: String(c.d.getDate()),
          showCount: !c.closed && c.n > 0,
          countLabel: c.n + (c.n === 1 ? ' appt' : ' appts'),
          closed: !!c.closed && inM,
          reason: c.closed || '',
          onClick: () => this.setState({ calMode: 'day', calOffset: c.o }),
          numStyle: {
            width: '28px',
            height: '28px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            fontSize: '13px',
            background: isT ? 'var(--accent)' : 'transparent',
            color: isT ? '#fff' : inM ? 'var(--ink)' : 'var(--ink3)',
          },
          pillStyle: {
            fontSize: '12px',
            fontWeight: 800,
            padding: '4px 9px',
            borderRadius: '8px',
            background: inM ? 'var(--accentSoft)' : 'var(--panel3)',
            color: inM ? 'var(--accentInk)' : 'var(--ink3)',
          },
          style: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            padding: '8px 9px 10px',
            borderRadius: '12px',
            textAlign: 'left',
            minHeight: '72px',
            background: c.closed && inM ? 'var(--panel3)' : inM ? 'var(--panel2)' : 'transparent',
            border: '1px solid ' + (isT ? 'var(--accentBrd)' : inM ? 'var(--line)' : 'var(--line2)'),
            opacity: inM ? 1 : 0.55,
            touchAction: 'manipulation',
          },
        })
      }
      calSub = tot + ' appointments in ' + MONTHS[m] + ' · tap a date to open it'
    }
    return {
      calLabel,
      calSub,
      calRows,
      calWeek,
      calMonth,
      calClosed,
      calClosedReason,
      calHint:
        mode === 'day' ? 'Drag or long-press to reschedule · swipe for next day' : 'Swipe or use ← → to move',
      calModes: [modeBtn('day', 'Day'), modeBtn('week', 'Week'), modeBtn('month', 'Month')],
      calDow: DOW,
      calIsDay: mode === 'day',
      calIsWeek: mode === 'week',
      calIsMonth: mode === 'month',
      calPrev: () => this.calNav(-1),
      calNext: () => this.calNav(1),
      calToday: () => this.setState({ calOffset: 0 }),
      calSwipeStart: (e: GestureEvent) => {
        if (e.pointerType === 'mouse') return
        this._cs = { x: e.clientX, y: e.clientY, t: this.nowMs() }
      },
      calSwipeEnd: (e: GestureEvent) => {
        const c = this._cs
        this._cs = null
        if (!c || (this._g && this._g.mode === 'drag')) return
        const dir = calendarSwipe(e.clientX - c.x, e.clientY - c.y, this.nowMs() - c.t)
        if (dir !== 0) {
          this._sup = this.nowMs()
          this.calNav(dir)
        }
      },
    }
  }

  // ---------- touch / pointer gestures ----------
  canDrag(a: Appt): boolean {
    return canDrag(a)
  }
  gStart(e: GestureEvent, a: Appt, ctx: GestureCtx) {
    if (e.button > 0) return
    this.gEnd()
    const g: Gesture = {
      id: a.id,
      a,
      ctx,
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      touch: e.pointerType !== 'mouse',
      el: e.currentTarget,
      mode: null,
      can: this.canDrag(a),
    }
    this._g = g
    if (g.touch && g.can)
      g.timer = setTimeout(() => {
        if (this._g === g && !g.mode) this.beginDrag(g)
      }, LONG_PRESS_MS)
    window.addEventListener('pointermove', this._gm)
    window.addEventListener('pointerup', this._gu)
    window.addEventListener('pointercancel', this._gc)
  }
  _gm = (e: PointerEvent) => {
    const g = this._g
    if (!g) return
    g.x = e.clientX
    g.y = e.clientY
    const dx = g.x - g.x0
    const dy = g.y - g.y0
    if (!g.mode) {
      const { decision, cancelTimer } = decideMove({ touch: g.touch, can: g.can, ctx: g.ctx, dx, dy })
      if (cancelTimer) clearTimeout(g.timer)
      if (!g.touch) {
        if (decision === 'begin-drag') this.beginDrag(g)
        return
      }
      if (decision === 'swipe') g.mode = 'swipe'
      else if (decision === 'end') {
        this.gEnd()
        return
      }
    }
    if (g.mode === 'drag') {
      this.moveGhost()
      this.hoverTarget()
    } else if (g.mode === 'swipe') {
      g.el.style.transition = 'none'
      g.el.style.transform = swipeTransform(dx)
    }
  }
  _gu = () => {
    const g = this._g
    if (!g) return
    if (g.mode === 'drag') {
      const t = this.state.dropTarget
      this._sup = this.nowMs()
      this.gEnd()
      if (t) this.dropOn(g, t)
    } else if (g.mode === 'swipe') {
      const dx = g.x - g.x0
      this._sup = this.nowMs()
      g.el.style.transition = 'transform .22s ease'
      g.el.style.transform = ''
      this.gEnd()
      const out = swipeOutcome(dx)
      if (out === 'advance') this.advance(g.id)
      else if (out === 'messages') this.setState({ selectedId: g.id, modalTab: 'messages' })
    } else this.gEnd()
  }
  _gc = () => {
    const g = this._g
    if (g && g.mode === 'swipe') {
      g.el.style.transition = 'transform .22s ease'
      g.el.style.transform = ''
    }
    this.gEnd()
  }
  gEnd() {
    const g = this._g
    if (g) clearTimeout(g.timer)
    this._g = null
    window.removeEventListener('pointermove', this._gm)
    window.removeEventListener('pointerup', this._gu)
    window.removeEventListener('pointercancel', this._gc)
    document.body.style.userSelect = ''
    if (this.state.dragId) this.setState({ dragId: null, dropTarget: null })
  }
  beginDrag(g: Gesture) {
    g.mode = 'drag'
    document.body.style.userSelect = 'none'
    try {
      if (navigator.vibrate) navigator.vibrate(12)
    } catch {
      /* vibration is optional */
    }
    this.setState(
      {
        dragId: g.id,
        dropTarget: null,
        ghost: {
          name: g.a.cust.name,
          vehicle: g.a.veh.year + ' ' + g.a.veh.make + ' ' + g.a.veh.model,
          hint: g.ctx === 'cal' ? 'Drop on a new time' : 'Drop on an open bay',
        },
      },
      () => this.moveGhost(),
    )
  }
  moveGhost() {
    const g = this._g
    const el = this.ghostRef.current
    if (g && el) el.style.transform = ghostTransform(g.x, g.y)
  }
  hoverTarget() {
    const g = this._g!
    const el = document.elementFromPoint(g.x, g.y)
    const t = el && el.closest ? el.closest('[data-drop]') : null
    const v = t ? t.getAttribute('data-drop') : null
    if (v !== this.state.dropTarget) this.setState({ dropTarget: v })
  }
  dropOn(g: Gesture, t: string) {
    const [k, v] = t.split(':')
    if (k === 'bay') this.assignToBay(g.id, +v!)
    else if (k === 'hr') this.reschedule(this.byId(g.id) || g.a, +v!)
  }

  // ---------- helpers ----------
  byId(id: string): Appt | undefined {
    return this.state.appts.find((a) => a.id === id) || this.state.calAppts.find((a) => a.id === id)
  }
  money(n: number): string {
    return money(n)
  }
  parseT(s: string): number {
    return parseT(s)
  }
  fmtT(mins: number): string {
    return fmtT(mins)
  }
  absMin(a: Appt): number {
    return absMin(a, parseT)
  }
  stMeta(s: string) {
    return statusMeta(s)
  }
  hexA(hex: string, a: number): string {
    return hexA(hex, a)
  }
  isLate(a: Appt): boolean {
    return isLate(a)
  }
  inFacility(a: Appt): boolean {
    return inFacility(a)
  }
  total(a: Appt) {
    return total(a)
  }
  balance(a: Appt): number {
    return balance(a)
  }
  memberMeta(m: string | null) {
    return memberMeta(m)
  }
  nextStep(a: Appt): Step | null {
    return nextStep(a)
  }

  // ---------- activity (lazy) ----------
  ensureActivity(a: Appt): Appt {
    return withActivity(a, this.state.ORDER)
  }

  // ---------- mutations ----------
  update(id: string, fn: (a: Appt) => Appt) {
    this.setState((s) =>
      s.appts.some((a) => a.id === id)
        ? { appts: s.appts.map((a) => (a.id === id ? fn({ ...a }) : a)) }
        : { calAppts: s.calAppts.map((a) => (a.id === id ? fn({ ...a }) : a)) },
    )
  }
  flash(title: string, desc?: string) {
    this.setState({ toast: { title, desc } })
    clearTimeout(this._tt)
    this._tt = setTimeout(() => this.setState({ toast: null }), 3200)
  }

  advance(id: string) {
    const a = this.byId(id)
    if (!a) return
    const step = this.nextStep(a)
    if (!step) return
    const ctx = this.cmdCtx()
    this.update(id, (x) => advanceAppt(x, step, ctx, this.catalog))
    const t = ADVANCE_TOASTS[step.to]
    this.flash(t ? t[0] : ADVANCE_FALLBACK_TITLE, t ? t[1] : '')
  }

  assignToBay(id: string | null, num: number) {
    if (!id) return
    const a = this.byId(id)
    if (!a) return
    if (this.inFacility(a)) {
      this.flash('Already in a bay', 'That vehicle is in Bay ' + a.bay)
      return
    }
    const occ = this.state.appts.find((x) => x.bay === num && this.inFacility(x))
    if (occ) {
      this.flash('Bay ' + num + ' is busy', 'Finish ' + occ.cust.name.split(' ')[0] + '’s vehicle first')
      return
    }
    const ctx = this.cmdCtx()
    this.update(id, (x) => assignBay(x, num, ctx))
    this.flash('Moved to Bay ' + num, a.cust.name + ' · cleaning started')
  }
  togglePay(id: string) {
    const a = this.byId(id)
    if (!a) return
    const now = a.pay === 'paid'
    const ctx = this.cmdCtx()
    this.update(id, (x) => togglePayment(x, now, ctx))
    this.flash(
      now ? 'Marked unpaid' : 'Payment collected',
      now ? 'Balance reopened' : 'Receipt sent to customer',
    )
  }
  togglePickup(id: string) {
    const a = this.byId(id)
    if (!a) return
    const now = a.pickup === 'collected'
    const ctx = this.cmdCtx()
    this.update(id, (x) => togglePickupState(x, now, ctx))
    this.flash(
      now ? 'Pickup reopened' : 'Vehicle picked up',
      now ? 'Back to ready for pickup' : 'Released to ' + a.cust.name.split(' ')[0],
    )
  }

  toggleAddon(id: string, name: string, price: number) {
    this.update(id, (a) => {
      const has = a.addons.find((x) => x.name === name)
      a.addons = has ? a.addons.filter((x) => x.name !== name) : [...a.addons, { name, price }]
      return a
    })
    this.flash(
      'Invoice + checklist updated',
      (this.byId(id)!.addons.find((x) => x.name === name) ? 'Removed ' : 'Added ') + name,
    )
  }
  collect(id: string) {
    const ctx = this.cmdCtx()
    this.update(id, (a) => collectPayment(a, ctx))
    this.flash('Payment collected', 'Receipt sent to customer')
  }
  sendTemplate(id: string, text: string) {
    const ctx = this.cmdCtx()
    this.update(id, (a) => sendStaffMessage(a, text, ctx))
    this.flash('Message sent', 'Delivered via WhatsApp')
  }
  notify(id: string) {
    const ctx = this.cmdCtx()
    this.update(id, (a) => notifyReady(a, ctx))
    this.flash('Customer notified', 'Ready-for-pickup sent via WhatsApp')
  }

  // ---------- view models ----------
  badgeStyle(c: string): Style {
    return {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px',
      padding: '3px 9px',
      borderRadius: '7px',
      fontSize: '11px',
      fontWeight: 800,
      whiteSpace: 'nowrap',
      background: hexA(c, this.state.theme === 'dark' ? 0.18 : 0.12),
      color: this.state.theme === 'dark' ? lighten(c) : c,
      letterSpacing: '0.01em',
    }
  }
  lighten(hex: string): string {
    return lighten(hex)
  }

  cardVM(a: Appt): VM {
    const meta = this.stMeta(a.status)
    const late = this.isLate(a)
    const c = late ? '#C2410C' : meta.c
    const mm = this.memberMeta(a.member)
    const step = this.nextStep(a)
    const bal = this.balance(a)
    const dark = this.state.theme === 'dark'
    return {
      id: a.id,
      name: a.cust.name,
      vehicleLine: `${a.veh.year} ${a.veh.make} ${a.veh.model} · ${a.veh.color}`,
      short: `${a.veh.make} ${a.veh.model}`,
      service: a.svc,
      time: a.time,
      statusColor: c,
      badgeLabel: late ? 'Late' : meta.l,
      badgeStyle: this.badgeStyle(c),
      vip: !!a.vip,
      member: !!a.member,
      memberLabel: a.member ? a.member.split(' ')[0] : '',
      memberPlain: a.member || 'Non-member',
      memberStyle: mm
        ? {
            fontSize: '10px',
            fontWeight: 800,
            padding: '2px 7px',
            borderRadius: '6px',
            background: dark ? hexA(mm.c, 0.2) : mm.bg,
            color: dark ? lighten(mm.c) : mm.c,
            textTransform: 'uppercase',
            letterSpacing: '0.03em',
          }
        : {},
      bayLabel: a.bay ? 'Bay ' + a.bay : 'No bay',
      durLabel: 'Est. ' + a.dur + ' min',
      payLabel:
        a.pay === 'paid'
          ? 'Paid'
          : a.pay === 'deposit'
            ? 'Deposit · ' + this.money(bal) + ' due'
            : this.money(bal) + ' due',
      payStyle: {
        fontSize: '11.5px',
        fontWeight: 800,
        color: a.pay === 'paid' ? (dark ? '#5FC9A6' : '#0D9488') : '#C2410C',
      },
      hasNotes: a.special || (a.notes && !a.notes.startsWith('No special')),
      hasPhotos: a.photos.before + a.photos.after > 0,
      hasAddons: a.addons.length > 0,
      addonCount: a.addons.length,
      iconWrap: { display: 'inline-flex', alignItems: 'center', gap: '6px' },
      nextLabel: step ? step.label : 'Completed',
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
        cursor: this.canDrag(a) ? 'grab' : 'pointer',
        transition: 'transform .12s ease',
        touchAction: 'pan-y',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        opacity: this.state.dragId === a.id ? 0.45 : 1,
      },
      railStyle: {
        position: 'absolute',
        left: 0,
        top: '10px',
        bottom: '10px',
        width: '4px',
        borderRadius: '4px',
        background: c,
      },
      chipStyle: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '9px',
        minHeight: '44px',
        padding: '8px 14px',
        background: 'var(--panel2)',
        border: '1px solid var(--line)',
        borderLeft: '3px solid ' + c,
        borderRadius: '11px',
        touchAction: 'pan-y',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        cursor: this.canDrag(a) ? 'grab' : 'pointer',
        opacity: this.state.dragId === a.id ? 0.45 : 1,
      },
      onPointerDown: (e: GestureEvent) => this.gStart(e, a, 'tl'),
      onQDown: (e: GestureEvent) => this.gStart(e, a, 'q'),
      onCalDown: (e: GestureEvent) => this.gStart(e, a, 'cal'),
      open: () => this.openAppt(a),
      doNext: () => this.advance(a.id),
    }
  }

  private alertVM(spec: AlertSpec, dark: boolean): VM {
    const tn = CHROME_TONES(dark)[spec.tone]
    const run = (act: AlertAction) => () => {
      switch (act.kind) {
        case 'togglePickup':
          return this.togglePickup(act.id)
        case 'flash':
          return this.flash(act.title, act.desc)
        case 'select':
          return this.setState({ selectedId: act.id, modalTab: 'overview' })
        case 'advance':
          return this.advance(act.id)
        case 'prepBay':
          return this.prepBay(act.id)
      }
    }
    const id = spec.id
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
      glyph: spec.glyph,
      title: spec.title,
      desc: spec.desc,
      actionLabel: spec.actionLabel,
      actionStyle: {
        height: '38px',
        padding: '0 15px',
        background: tn.c,
        color: '#fff',
        borderRadius: '10px',
        fontWeight: 700,
        fontSize: '12.5px',
      },
      action: run(spec.action),
      pri: spec.pri,
      open: () => (id ? this.setState({ selectedId: id, modalTab: 'overview' }) : null),
    }
  }

  renderVals(): VM {
    const s = this.state
    const dark = s.theme === 'dark'
    // range/search filter
    const pool = selectPool(s.appts, s.search, s.range)
    const sorted = sortPool(pool)

    // KPIs (always full day-0/1 set, not filtered)
    const kpis = buildKpis(s.appts, this.data.display().kpi)

    // timeline groups (upcoming only: in-bay cars live in the Bays column, finished cars in Completed)
    const tlList = upcoming(sorted)
    const groups = groupTimeline(tlList).map((g) => ({
      key: g.key,
      day: g.day,
      time: g.time,
      ampm: g.ampm,
      items: g.items.map((a) => this.cardVM(a)),
      dividerLabel: g.dividerLabel,
      dividerStyle: g.showDivider
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

    // bays
    const bayVM = (num: number): VM => {
      const occ = occupantOf(s.appts, num)
      if (!occ) {
        const next = nextForBay(sorted, num)
        return {
          name: 'Bay ' + num,
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
          nextUp: next ? 'Next: ' + next.cust.name + ' · ' + next.time : 'No vehicles queued',
          drop: 'bay:' + num,
          shellStyle: {
            background: 'var(--panel)',
            border:
              '1px solid ' +
              (s.dragId && s.dropTarget === 'bay:' + num
                ? 'var(--accent)'
                : s.dragId
                  ? 'var(--accentBrd)'
                  : 'var(--line)'),
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
            border:
              '2px dashed ' +
              (s.dragId && s.dropTarget === 'bay:' + num
                ? 'var(--accent)'
                : s.dragId
                  ? 'var(--accentBrd)'
                  : 'transparent'),
            background: s.dragId && s.dropTarget === 'bay:' + num ? 'var(--accentSoft)' : 'transparent',
            transition: 'all .12s ease',
          },
          assign: () =>
            next
              ? this.setState({ selectedId: next.id, modalTab: 'overview' })
              : this.flash('Nothing queued', 'No vehicles waiting for Bay ' + num),
        }
      }
      const meta = this.stMeta(occ.status)
      const step = this.nextStep(occ)
      const showProg = occ.status === 'cleaning'
      const { elapMin, elapSec, pct, etaMin } = bayProgress(occ, this.nowMs())
      return {
        name: 'Bay ' + num,
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
        badgeStyle: this.badgeStyle(meta.c),
        vehicle: `${occ.veh.year} ${occ.veh.make} ${occ.veh.model}`,
        customer: occ.cust.name,
        plate: occ.veh.plate,
        service: occ.svc,
        statusColor: meta.c,
        worker: occ.staff,
        workerInitials: occ.staff
          .split(' ')
          .map((w) => w[0])
          .join(''),
        showProgress: showProg,
        elapsed: showProg ? `${elapMin}:${String(elapSec).padStart(2, '0')}` : '—',
        eta: this.fmtT(etaMin),
        progressStyle: {
          height: '100%',
          width: pct + '%',
          background: meta.c,
          borderRadius: '6px',
          transition: 'width 1s linear',
        },
        progressLabel: Math.round(pct) + '% complete',
        durLabel: occ.dur + ' min',
        drop: 'bay:' + num,
        shellStyle: {
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          borderLeft: '4px solid ' + meta.c,
          borderRadius: '20px',
          padding: '20px',
          boxShadow: 'var(--shadow)',
          outline: s.dragId && s.dropTarget === 'bay:' + num ? '2px dashed #C2410C' : 'none',
        },
        nextLabel: step ? step.label : 'Completed',
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
        open: () => this.setState({ selectedId: occ.id, modalTab: 'overview' }),
        doNext: () => this.advance(occ.id),
      }
    }
    const bays = [bayVM(1), bayVM(2)]
    const arrivals = arrivalsOf(s.appts).map((a) => ({
      title: (a.vip ? 'VIP arriving in ' : 'Arriving in ') + a.eta + ' min · ' + a.cust.name,
      desc:
        'Geofence ETA · ' +
        a.veh.year +
        ' ' +
        a.veh.make +
        ' ' +
        a.veh.model +
        ' · ' +
        a.svc.split(' + ')[0] +
        (a.bay ? ' · Bay ' + a.bay : ''),
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
      prepLabel: a.prepped ? 'Bay ' + (a.bay || '') + ' ready ✓' : 'Prep Bay ' + (a.bay || '—'),
      prepStyle: {
        height: '44px',
        padding: '0 14px',
        borderRadius: '11px',
        fontWeight: 800,
        fontSize: '12.5px',
        background: a.prepped ? 'var(--accentSoft)' : a.vip ? '#7A3B8A' : 'var(--accent)',
        color: a.prepped ? 'var(--accentInk)' : '#fff',
      },
      prep: () => this.prepBay(a.id),
      arrive: () => this.simArrive(a.id),
    }))
    const inFac = s.appts.filter((a) => this.inFacility(a)).length

    // queue (bay view)
    const queue = queueOf(sorted).map((a) => this.cardVM(a))

    // completed / pickup column (column 3)
    const completedList = sorted.filter((a) => a.status === 'completed')
    const completedJobs = completedList.map((a) => {
      const paid = a.pay === 'paid'
      const collected = a.pickup === 'collected'
      const accent = collected && paid ? '#0E9E6E' : !paid ? '#C2410C' : '#B07908'
      const chip = (active: boolean, c: string): Style => ({
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
      return {
        id: a.id,
        name: a.cust.name,
        vehicleLine: `${a.veh.year} ${a.veh.make} ${a.veh.model} · ${a.veh.color}`,
        service: a.svc,
        time: a.time,
        accent,
        shellStyle: {
          position: 'relative',
          padding: '14px 15px 14px 18px',
          background: 'var(--panel2)',
          border: '1px solid var(--line)',
          borderRadius: '15px',
        },
        payChipLabel: paid ? 'Paid' : 'Unpaid · collect',
        payChipStyle: chip(!paid, '#C2410C'),
        pickupChipLabel: collected ? 'Picked up' : 'Needs pickup',
        pickupChipStyle: chip(!collected, '#0E7A63'),
        togglePay: () => this.togglePay(a.id),
        togglePickup: () => this.togglePickup(a.id),
        open: () => this.setState({ selectedId: a.id, modalTab: 'overview' }),
      }
    })
    const completedCount = completedJobs.length

    // alerts
    const alerts = buildAlerts(s.appts, s.NOW, (id) => this.byId(id)).map((spec) => this.alertVM(spec, dark))

    // staff columns
    const staffNames = ['Marco R.', 'Lena K.', 'Sofia D.', 'Unassigned']
    const roles: Record<string, string> = {
      'Marco R.': 'Lead Detailer',
      'Lena K.': 'Detailer',
      'Sofia D.': 'Front Desk',
      Unassigned: 'Queue',
    }
    const avatarColors: Record<string, string> = {
      'Marco R.': '#2563EB',
      'Lena K.': '#0E9E6E',
      'Sofia D.': '#7A3B8A',
      Unassigned: '#6B7280',
    }
    const staffCols = staffNames.map((nm) => {
      const jobs = sorted.filter((a) => a.staff === nm).map((a) => this.cardVM(a))
      return {
        name: nm === 'Unassigned' ? 'Unassigned' : nm,
        role: roles[nm],
        initials:
          nm === 'Unassigned'
            ? '—'
            : nm
                .split(' ')
                .map((w) => w[0])
                .join(''),
        avatarStyle: {
          width: '40px',
          height: '40px',
          borderRadius: '12px',
          background: hexA(avatarColors[nm]!, dark ? 0.22 : 0.14),
          color: dark ? lighten(avatarColors[nm]!) : avatarColors[nm],
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
    })

    const cal = this.calVM()

    // range + view tabs
    const ranges: ReadonlyArray<readonly [RangeName, string]> = [
      ['next24', 'Next 24h'],
      ['today', 'Today'],
      ['tomorrow', 'Tomorrow'],
      ['week', 'Week'],
    ]
    const rangeTabs = ranges.map(([k, l]) => ({
      label: l,
      onClick: () => this.setState({ range: k }),
      style: {
        height: '36px',
        padding: '0 14px',
        borderRadius: '10px',
        fontSize: '13px',
        fontWeight: 700,
        background: s.range === k ? 'var(--accent)' : 'transparent',
        color: s.range === k ? '#fff' : 'var(--ink2)',
        whiteSpace: 'nowrap',
      },
    }))
    const renderIcon = (svg: string) =>
      React.createElement('span', { dangerouslySetInnerHTML: { __html: svg } })
    const views: ReadonlyArray<readonly [ViewName, string]> = [
      ['timeline', 'Timeline'],
      ['bay', 'Bay Board'],
      ['staff', 'Staff'],
      ['calendar', 'Calendar'],
    ]
    const viewTabs = views.map(([k, l]) => ({
      label: l,
      icon: renderIcon(VIEW_ICONS[k]),
      onClick: () => this.setState({ view: k }),
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        height: '40px',
        padding: '0 18px',
        borderRadius: '11px',
        fontSize: '13.5px',
        fontWeight: 700,
        background: s.view === k ? 'var(--panel2)' : 'transparent',
        color: s.view === k ? 'var(--ink)' : 'var(--ink2)',
        border: s.view === k ? '1px solid var(--line)' : '1px solid transparent',
      },
    }))

    // selected modal VM
    const sa = s.selectedId ? this.byId(s.selectedId) : null
    let sel: VM | null = null
    if (sa) {
      this.ensureActivity(sa)
      sel = this.selVM(sa, dark, renderIcon)
    }

    const newServices = Object.keys(s.services)
      .slice(0, 5)
      .map((name) => ({
        name,
        dur: 'Est. ' + s.services[name]!.dur + ' min',
        price: this.money(s.services[name]!.price),
        pick: () => this.setState({ pickedService: name }),
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '13px 15px',
          borderRadius: '12px',
          background: s.pickedService === name ? 'var(--accentSoft)' : 'var(--panel)',
          border: '1px solid ' + (s.pickedService === name ? 'var(--accentBrd)' : 'var(--line)'),
        },
      }))
    const { slotTimes, blocked, vipHeld } = this.data.availability()
    const newSlots = slotTimes.map((t) => {
      const off = blocked.includes(t)
      const held = vipHeld.includes(t)
      return {
        label: held ? t + ' · VIP' : t,
        pick: () =>
          off
            ? this.flash('Slot unavailable', 'Would overbook a bay — override required')
            : held
              ? this.flash(
                  'Held for VIP clients',
                  'Releases to everyone 48h before · VIP clients can book it now',
                )
              : this.setState({ pickedSlot: t }),
        style: {
          height: '42px',
          borderRadius: '11px',
          fontSize: '13px',
          fontWeight: 700,
          cursor: off ? 'not-allowed' : 'pointer',
          background: off ? 'var(--panel3)' : s.pickedSlot === t ? 'var(--accent)' : 'var(--panel)',
          color: off ? 'var(--ink3)' : s.pickedSlot === t ? '#fff' : 'var(--ink)',
          border: '1px solid ' + (s.pickedSlot === t && !off ? 'var(--accent)' : 'var(--line)'),
          opacity: off ? 0.6 : 1,
        },
      }
    })

    const vals: VM = {
      theme: s.theme,
      isDark: dark,
      isLight: !dark,
      toggleTheme: () => {
        const t: Theme = dark ? 'light' : 'dark'
        this.data.saveTheme(t)
        this.setState({ theme: t })
      },
      showRange: s.view !== 'calendar',
      dragging: !!s.dragId,
      ghostRef: this.ghostRef,
      ghostName: s.ghost ? s.ghost.name : '',
      ghostVehicle: s.ghost ? s.ghost.vehicle : '',
      ghostHint: s.ghost ? s.ghost.hint : '',
      preventCtx: (e: { preventDefault(): void }) => e.preventDefault(),
      emergencyOn: !!(s.emergency && s.emergency.active),
      emergencyText: s.emergency && s.emergency.summary ? s.emergency.summary : '',
      view: s.view,
      isTimeline: s.view === 'timeline',
      isBay: s.view === 'bay',
      isStaff: s.view === 'staff',
      isCalendar: s.view === 'calendar',
      search: s.search,
      onSearch: (e: { target: { value: string } }) => this.setState({ search: e.target.value }),
      rangeTabs,
      viewTabs,
      openNew: () => this.setState({ newOpen: true, newTitle: 'New Appointment' }),
      openWalkin: () => this.setState({ newOpen: true, newTitle: 'Walk-in Booking' }),
      closeNew: () => this.setState({ newOpen: false }),
      newOpen: s.newOpen,
      newTitle: s.newTitle,
      newServices,
      newSlots,
      createAppt: () => {
        this.setState({ newOpen: false })
        this.flash('Appointment booked', s.pickedService + ' · ' + s.pickedSlot)
      },
      kpis,
      groups,
      apptCount: tlList.length,
      bays,
      arrivals,
      inFacilityLabel: inFac + ' in facility',
      completedJobs,
      completedCount,
      noCompleted: completedJobs.length === 0,
      queue,
      alerts,
      alertCount: alerts.length,
      staffCols,
      ...cal,
      clockLabel: 'Live · ' + this.nowClock(),
      dateLabel: this.data.today().dateLabel,
      modalOpen: !!sa,
      sel,
      closeModal: () => this.setState({ selectedId: null }),
      stop: (e: { stopPropagation(): void }) => e.stopPropagation(),
      toast: s.toast,
      toastTitle: s.toast ? s.toast.title : '',
      toastDesc: s.toast ? s.toast.desc : '',
    }
    return LIVE ? this.withLive(vals) : vals
  }

  /** The live build's additions (tools/dc-compile/live-bridge.ts does the same to the other screens). */
  private withLive(v: VM): VM {
    const c = chrome()
    v.live = c ? c.vals() : {}
    if (typeof v.toggleTheme === 'function') {
      const toggle = v.toggleTheme as () => void
      v.toggleTheme = () => {
        const prev = this.state.theme
        const r = toggle()
        const next = this.state.theme
        if (c && next !== prev) c.themeChanged(next, prev)
        return r
      }
    }
    if (
      typeof document !== 'undefined' &&
      (v.theme === 'light' || v.theme === 'dark') &&
      document.documentElement.getAttribute('data-theme') !== v.theme
    ) {
      document.documentElement.setAttribute('data-theme', v.theme)
    }
    return v
  }

  /** The appointment file (`sel`): header, stage tracker, the eight tabs, totals and the action bar. */
  private selVM(sa: Appt, dark: boolean, renderIcon: (svg: string) => React.ReactElement): VM {
    const s = this.state
    const meta = this.stMeta(sa.status)
    const mm = this.memberMeta(sa.member)
    const step = this.nextStep(sa)
    const t = this.total(sa)
    const bal = this.balance(sa)
    const order = s.ORDER
    const stageLabels: Record<string, string> = {
      booked: 'Booked',
      confirmed: 'Confirmed',
      arrived: 'Arrived',
      cleaning: 'In Wash',
      completed: 'Done',
    }
    const curIdx = order.indexOf(sa.status)
    const stages = order.map((st, i) => {
      const done = i < curIdx
      const cur = i === curIdx
      return {
        label: stageLabels[st],
        mark: done ? '✓' : String(i + 1),
        dotStyle: {
          width: '30px',
          height: '30px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 800,
          fontSize: '12px',
          background: cur ? 'var(--accent)' : done ? 'var(--accentSoft)' : 'var(--panel3)',
          color: cur ? '#fff' : done ? 'var(--accentInk)' : 'var(--ink3)',
          border: cur ? '2px solid var(--accent)' : 'none',
        },
        labelStyle: {
          fontSize: '10.5px',
          fontWeight: 700,
          textAlign: 'center',
          color: cur || done ? 'var(--ink)' : 'var(--ink3)',
        },
        lineStyle: {
          width: '18px',
          height: '2px',
          background: i < order.length - 1 ? (i < curIdx ? 'var(--accent)' : 'var(--line)') : 'transparent',
        },
      }
    })
    const ckv = this.checkVM(sa)
    const checkDone = ckv.checkDone
    const checkTotal = ckv.checkTotal
    const tabDefs: ReadonlyArray<readonly [string, string, string | number | null]> = [
      ['overview', 'Overview', null],
      ['checklist', 'Checklist', checkDone + '/' + checkTotal],
      ['addons', 'Add-ons', sa.addons.length || null],
      ['photos', 'Photos', null],
      ['messages', 'Messages', sa.messages!.length],
      ['payments', 'Payments', null],
      ['membership', 'Membership', null],
      ['history', 'History', null],
    ]
    const tabs = tabDefs.map(([k, l, cnt]) => ({
      label: l,
      count: cnt,
      icon: renderIcon(TAB_ICONS[k]!),
      countStyle: {
        minWidth: '20px',
        height: '20px',
        padding: '0 6px',
        borderRadius: '7px',
        background: s.modalTab === k ? 'var(--accent)' : 'var(--panel3)',
        color: s.modalTab === k ? '#fff' : 'var(--ink3)',
        fontSize: '11px',
        fontWeight: 800,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      },
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '11px',
        height: '44px',
        padding: '0 14px',
        borderRadius: '12px',
        fontSize: '14px',
        fontWeight: 700,
        background: s.modalTab === k ? 'var(--accentSoft)' : 'transparent',
        color: s.modalTab === k ? 'var(--accentInk)' : 'var(--ink2)',
      },
      onClick: () => this.setState({ modalTab: k }),
    }))

    const payRows = [
      { label: sa.svc, val: this.money(t.sub - t.addon), kind: 'item' },
      ...sa.addons.map((x) => ({ label: '+ ' + x.name, val: this.money(x.price), kind: 'addon' })),
      ...(t.tip ? [{ label: 'Tip', val: this.money(t.tip), kind: 'item' }] : []),
      { label: 'Tax (7%)', val: this.money(t.tax), kind: 'item' },
      { label: 'Total', val: this.money(t.grand), kind: 'total' },
      ...(sa.pay === 'deposit'
        ? [{ label: 'Deposit paid', val: '– ' + this.money(sa.deposit!), kind: 'paid' }]
        : []),
    ].map((r) => ({
      label: r.label,
      val: r.val,
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: r.kind === 'total' ? '14px 0 6px' : '8px 0',
        borderTop: r.kind === 'total' ? '1px solid var(--line)' : 'none',
        marginTop: r.kind === 'total' ? '6px' : '0',
      },
      labelStyle: {
        fontSize: r.kind === 'total' ? '15px' : '13.5px',
        fontWeight: r.kind === 'total' ? 800 : 600,
        color: r.kind === 'addon' ? 'var(--accentInk)' : r.kind === 'paid' ? '#0E9E6E' : 'var(--ink2)',
      },
      valStyle: {
        fontSize: r.kind === 'total' ? '18px' : '14px',
        fontWeight: r.kind === 'total' ? 800 : 700,
        color: r.kind === 'paid' ? '#0E9E6E' : 'var(--ink)',
        fontFamily: r.kind === 'total' ? "'Bricolage Grotesque',sans-serif" : 'inherit',
      },
    }))

    const display = this.data.display()
    const perksByPlan = display.perksByPlan
    const planKey = sa.member ? sa.member.split(' ')[0]! : null
    const planTint =
      (
        { Essential: '#5E7A52', Premium: '#8A6D3B', Executive: '#3B5A8A', Exotic: '#7A3B8A' } as Record<
          string,
          string
        >
      )[planKey as string] || '#8A6D3B'

    return {
      id: sa.id,
      name: sa.cust.name,
      initials: sa.cust.name
        .split(' ')
        .map((w) => w[0])
        .join('')
        .slice(0, 2),
      vehicle: `${sa.veh.year} ${sa.veh.make} ${sa.veh.model}`,
      vehicleLine: `${sa.veh.year} ${sa.veh.make} ${sa.veh.model} · ${sa.veh.color}`,
      color: sa.veh.color,
      plate: sa.veh.plate,
      phone: sa.cust.phone,
      when: (sa.day === 1 ? 'Tomorrow ' : 'Today ') + sa.time + ' · ' + sa.svc.split(' + ')[0],
      time: sa.time,
      service: sa.svc,
      durLabel: sa.dur + ' min',
      bayLabel: sa.bay ? 'Bay ' + sa.bay : 'Unassigned',
      worker: sa.staff,
      badgeLabel: this.isLate(sa) ? 'Late' : meta.l,
      badgeStyle: this.badgeStyle(this.isLate(sa) ? '#C2410C' : meta.c),
      member: !!sa.member,
      noMember: !sa.member,
      memberLabel: sa.member ? sa.member.split(' ')[0] : '',
      memberPlain: sa.member || 'Non-member',
      memberStyle: mm
        ? {
            fontSize: '11px',
            fontWeight: 800,
            padding: '3px 9px',
            borderRadius: '7px',
            background: dark ? hexA(mm.c, 0.2) : mm.bg,
            color: dark ? lighten(mm.c) : mm.c,
            textTransform: 'uppercase',
            letterSpacing: '0.03em',
          }
        : {},
      vip: !!sa.vip,
      notes: sa.notes,
      special: sa.special,
      payLabel:
        sa.pay === 'paid'
          ? 'Paid in full'
          : sa.pay === 'deposit'
            ? 'Deposit · ' + this.money(bal) + ' due'
            : this.money(bal) + ' due',
      payColor: sa.pay === 'paid' ? (dark ? '#5FC9A6' : '#0D9488') : '#C2410C',
      stages,
      // tabs
      tabs,
      tabOverview: s.modalTab === 'overview',
      tabChecklist: s.modalTab === 'checklist',
      tabAddons: s.modalTab === 'addons',
      tabPhotos: s.modalTab === 'photos',
      tabMessages: s.modalTab === 'messages',
      tabPayments: s.modalTab === 'payments',
      tabMembership: s.modalTab === 'membership',
      tabHistory: s.modalTab === 'history',
      ...ckv,
      // addons
      addonTotal: this.money(t.addon),
      addonCatalog: s.ADDONS.map(([name, price]) => {
        const on = !!sa.addons.find((x) => x.name === name)
        return {
          name,
          price: this.money(price),
          on,
          toggle: () => this.toggleAddon(sa.id, name, price),
          rowStyle: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '13px 15px',
            background: on ? 'var(--accentSoft)' : 'var(--panel)',
            border: '1px solid ' + (on ? 'var(--accentBrd)' : 'var(--line)'),
            borderRadius: '12px',
          },
          boxStyle: {
            width: '22px',
            height: '22px',
            borderRadius: '7px',
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: on ? 'var(--accent)' : 'transparent',
            border: on ? 'none' : '2px solid var(--ink3)',
          },
        }
      }),
      // photos
      photoSections: [
        {
          title: 'Arrival',
          count: sa.photos.arrival + ' photos',
          tag: 'Captured',
          tagStyle: this.tagS(dark, '#0E9E6E'),
          slots: this.slots(sa.photos.arrival),
        },
        {
          title: 'Before',
          count: sa.photos.before + ' photos',
          tag: sa.photos.before ? 'Captured' : 'Pending',
          tagStyle: this.tagS(dark, sa.photos.before ? '#0E9E6E' : '#6B7280'),
          slots: this.slots(sa.photos.before),
        },
        {
          title: 'After',
          count: sa.photos.after + ' photos',
          tag: sa.photos.after ? 'Captured' : 'Pending',
          tagStyle: this.tagS(dark, sa.photos.after ? '#0E9E6E' : '#6B7280'),
          slots: this.slots(sa.photos.after),
        },
        {
          title: 'Damage / Issues',
          count: sa.photos.issue + ' notes',
          tag: sa.photos.issue ? 'Flagged' : 'None',
          tagStyle: this.tagS(dark, sa.photos.issue ? '#C2410C' : '#6B7280'),
          slots: this.slots(sa.photos.issue),
        },
      ],
      // messages
      messages: sa.messages!.map((m) => {
        const out = m.from === 'staff' || m.from === 'system'
        return {
          text: m.text,
          time: m.time,
          channelTag: m.from === 'system' ? 'Automated · ' + m.channel : m.from === 'staff' ? null : null,
          rowStyle: { display: 'flex', justifyContent: out ? 'flex-end' : 'flex-start' },
          bubbleStyle: {
            maxWidth: '78%',
            padding: '11px 14px',
            borderRadius: out ? '15px 15px 4px 15px' : '15px 15px 15px 4px',
            background: m.from === 'system' ? 'var(--accentSoft)' : out ? 'var(--accent)' : 'var(--panel)',
            color: m.from === 'system' ? 'var(--accentInk)' : out ? '#fff' : 'var(--ink)',
            border: out && m.from !== 'system' ? 'none' : '1px solid var(--line)',
          },
          tagStyle: {
            fontSize: '10px',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            opacity: 0.7,
            marginBottom: '4px',
          },
          timeStyle: { fontSize: '10.5px', fontWeight: 600, marginTop: '5px', opacity: 0.65 },
        }
      }),
      templates: TEMPLATES.map(([label, text]) => ({ label, send: () => this.sendTemplate(sa.id, text) })),
      // payments
      payRows,
      payStatusLabel:
        sa.pay === 'paid' ? 'Paid in full' : sa.pay === 'deposit' ? 'Balance due' : 'Awaiting payment',
      payBig: sa.pay === 'paid' ? this.money(t.grand) : this.money(bal),
      payMethod: sa.pay === 'paid' ? display.payMethodOnFile : display.payMethodNone,
      payCardStyle: {
        padding: '20px',
        borderRadius: '16px',
        background: sa.pay === 'paid' ? 'var(--accentSoft)' : 'var(--ink)',
        color: sa.pay === 'paid' ? 'var(--accentInk)' : 'var(--bg)',
      },
      showCollect: sa.pay !== 'paid',
      isPaid: sa.pay === 'paid',
      collect: () => this.collect(sa.id),
      sendLink: () => this.flash('Payment link sent', 'Secure link via WhatsApp'),
      // membership
      memberCardStyle: {
        padding: '24px',
        borderRadius: '18px',
        background: `linear-gradient(135deg, ${planTint}, ${hexA(planTint, 0.78)})`,
        color: '#fff',
        boxShadow: '0 12px 30px ' + hexA(planTint, 0.35),
      },
      renewDate: display.renewDate,
      creditsLeft: planKey === 'Executive' || planKey === 'Exotic' ? '∞' : String(1),
      creditsUsed: String(planKey === 'Premium' ? 1 : 0),
      memberMonths: String(8 + (sa.visits % 6)),
      perks: perksByPlan[planKey as string] || [],
      riskStyle: {
        padding: '16px',
        borderRadius: '14px',
        background: sa.visits > 6 ? 'var(--accentSoft)' : '#FBEAE0',
        color: sa.visits > 6 ? 'var(--accentInk)' : '#C2410C',
      },
      riskLabel: sa.visits > 6 ? 'Loyal · low risk' : 'Watch · 1 missed visit',
      riskDesc:
        sa.visits > 6 ? 'Consistent monthly usage — strong retention' : 'Down from 3 to 1 visit last month',
      // history
      history: sa.history,
      visitCount: String(sa.visits),
      lifetimeSpend: this.money(sa.visits * display.lifetimePerVisit),
      avgFreq: display.avgFreq,
      // actions
      nextLabel: step ? step.label : '',
      hasNext: !!step,
      done: !step,
      nextHint: step ? this.hintFor(sa, step) : 'Job complete — closed and archived',
      doNext: () => this.advance(sa.id),
      quickMsg: () => {
        this.setState({ modalTab: 'messages' })
      },
    }
  }

  hintFor(a: Appt, step: Step): string {
    return hintFor(a, step)
  }
  tagS(dark: boolean, c: string): Style {
    return {
      fontSize: '11px',
      fontWeight: 800,
      padding: '3px 9px',
      borderRadius: '7px',
      background: hexA(c, dark ? 0.2 : 0.13),
      color: dark ? lighten(c) : c,
      textTransform: 'uppercase',
      letterSpacing: '0.03em',
    }
  }
  slots(n: number): VM[] {
    const out: VM[] = []
    for (let i = 0; i < 3; i++) {
      if (i < n)
        out.push({
          icon: true,
          style: {
            aspectRatio: '4/3',
            borderRadius: '11px',
            background: 'var(--panel3)',
            border: '1px solid var(--line)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          },
        })
      else {
        out.push({
          add: true,
          style: {
            aspectRatio: '4/3',
            borderRadius: '11px',
            background: 'var(--panel)',
            border: '1.5px dashed var(--line)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          },
        })
        break
      }
    }
    return out
  }
}

export default OperationsLogic
