// The Operations (Command Center) view model of the LIVE variant. It renders the same compiled template as the fixture
// class (Logic.ts, untouched for the parity build) from the real API: the board, calendar, appointment file, messages
// and availability are the server's, read through the QueryStore (SSE invalidates the `ops`, `messages` and `payments`
// families and the screen re-reads); the class keeps only UI state (view, range, search, selection, tab, the new
// appointment form, the composer), the gesture engine and the 1 s tick. Every command goes through OpsCommands
// (permission check, Idempotency-Key, the server's toast). docs/screens-operations-live.md has the provenance table.
import * as React from 'react'
import type { QueryClient } from '@tanstack/react-query'
import type { LiveChrome } from '@/auth/chrome'
import { can } from '@/auth/session-model'
import type { Session } from '@/auth/session-model'
import { Action } from '@/data/command'
import { ApiError } from '@/data/http/problem'
import { getDataPort } from '@/data/default-port'
import { getQueryClient, qk } from '@/data/query'
import { QueryStore } from '@/data/query-store'
import type {
  AppointmentFile,
  Availability,
  CalendarDay,
  CalendarSummary,
  CustomerHit,
  CustomerHits,
  FilePhoto,
  MembershipView,
  OperationsPort,
  OpsAlert,
  OpsBay,
  OpsCard,
  OpsSnapshot,
  OpsWindow,
  ServiceCatalog,
  Thread,
} from '@/data/ports/operations'
import type { PaymentsPort } from '@/data/ports/payments'
import { toastForError } from '@/data/toast'
import { serverNow } from '@/lib/clock'
import { DOW_LONG, MONTHS } from '@/lib/dates'
import {
  DEFAULT_TZ,
  addDays,
  businessClock,
  businessToday,
  dateHeading,
  parseIso,
  zonedInstant,
} from '@/lib/tz'
import { parseT } from '@/lib/time'
import type { DCLogicCtor } from '@/dc/types'
import { DCLogic } from '@/dc/DCLogic'
import {
  calendarSwipe,
  clickSuppressed,
  decideMove,
  ghostTransform,
  LONG_PRESS_MS,
  swipeOutcome,
  swipeTransform,
} from '@/lib/operations/gesture'
import type { GestureCtx } from '@/lib/operations/gesture'
import type { CalMode, RangeName, Theme, ViewName } from '@/lib/operations/types'
import {
  alertVM,
  arrivalVM,
  bayVM,
  cardVM,
  completedVM,
  groupVMs,
  kpiVMs,
  staffVM,
} from '@/lib/operations/live/board'
import type { BoardUi, GestureEvent } from '@/lib/operations/live/board'
import { calVM, navigate, summaryRange } from '@/lib/operations/live/calendar'
import type { CalHandlers } from '@/lib/operations/live/calendar'
import { fileVM } from '@/lib/operations/live/file'
import type { FileHandlers, FileUi } from '@/lib/operations/live/file'
import {
  bookingRequest,
  checkForm,
  digits,
  emptyForm,
  hitVMs,
  inputStyle,
  serviceVMs,
  slotNote,
  slotVMs,
  smsDotStyle,
  smsToggleStyle,
} from '@/lib/operations/live/newAppt'
import type { NewForm } from '@/lib/operations/live/newAppt'
import { OpsCommands } from './live/commands'

const THEME_KEY = 'oasis-theme'
const TENDER_KEY = 'oasis-last-tender'
const TOAST_MS = 3200
/** A read counts as fresh this long; SSE invalidation refetches sooner, this is the safety net while the stream is down. */
const FRESH_MS = 60_000
const SEARCH_DEBOUNCE_MS = 200
const THUMB_KEEP_MS = 8 * 60_000

type VM = Record<string, unknown>

export interface Toast {
  title: string
  desc?: string
}

export interface LiveState {
  theme: Theme
  view: ViewName
  search: string
  range: RangeName
  selectedId: string | null
  modalTab: string
  newOpen: boolean
  newTitle: string
  tick: number
  toast: Toast | null
  dragId: string | null
  dropTarget: string | null
  ghost: { name: string; vehicle: string; hint: string } | null
  calMode: CalMode
  /** The date shown in the Calendar; null = today. */
  calDate: string | null
  form: NewForm
  composer: string
  payTender: 'card' | 'cash'
  payLinkOpen: boolean
  payLinkUrl: string
  payLinkError: string
  /** Names of requests in flight that the UI reflects (photo categories, 'send'). */
  busy: string[]
}

export interface LiveOpsDeps {
  port: OperationsPort
  payments: PaymentsPort
  queryClient: QueryClient
  store: QueryStore
  chrome(): LiveChrome | null
  now(): number
  loadTheme(): Theme
  saveTheme(t: Theme): void
  loadTender(): 'card' | 'cash'
  saveTender(t: 'card' | 'cash'): void
}

export function defaultLiveOpsDeps(): LiveOpsDeps {
  const queryClient = getQueryClient()
  const port = getDataPort()
  return {
    port: port.operations,
    payments: port.payments,
    queryClient,
    store: new QueryStore(queryClient),
    chrome: () => (typeof window !== 'undefined' && window.__oasisLive) || null,
    now: () => serverNow(),
    loadTheme: () => {
      try {
        return (localStorage.getItem(THEME_KEY) || 'light') as Theme
      } catch {
        return 'light'
      }
    },
    saveTheme: (t) => {
      try {
        localStorage.setItem(THEME_KEY, t)
      } catch {
        // storage unavailable: the theme still applies for this page view
      }
    },
    loadTender: () => {
      try {
        return localStorage.getItem(TENDER_KEY) === 'cash' ? 'cash' : 'card'
      } catch {
        return 'card'
      }
    },
    saveTender: (t) => {
      try {
        localStorage.setItem(TENDER_KEY, t)
      } catch {
        // a per-viewer convenience only
      }
    },
  }
}

interface Gesture {
  id: string
  card: OpsCard
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

const VIEW_ICONS: Record<ViewName, string> = {
  timeline:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  bay: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="8" height="16" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="13" y="4" width="8" height="16" rx="1.5" stroke="currentColor" stroke-width="2"/></svg>',
  staff:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="2"/><path d="M3.5 19a5.5 5.5 0 0111 0M16 6.5a3 3 0 010 5.5M18 13a5 5 0 013 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  calendar:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" stroke-width="2"/><path d="M3 9h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
}

const WINDOW_OF: Record<RangeName, OpsWindow> = {
  next24: 'next24',
  today: 'today',
  tomorrow: 'tomorrow',
  week: 'week',
}

const FIRST_NAME = (name: string): string => name.split(' ')[0] ?? name

export class LiveOperationsLogic extends DCLogic<LiveState> {
  readonly deps: LiveOpsDeps
  readonly cmd: OpsCommands
  ghostRef = React.createRef<HTMLDivElement>()

  private offs: Array<() => void> = []
  private tickTimer: ReturnType<typeof setInterval> | undefined
  private toastTimer: ReturnType<typeof setTimeout> | undefined
  private searchTimer: ReturnType<typeof setTimeout> | undefined
  private custTimer: ReturnType<typeof setTimeout> | undefined
  private keyHandler: ((e: KeyboardEvent) => void) | undefined
  private touchGuard: ((e: TouchEvent) => void) | undefined
  private visHandler: (() => void) | undefined
  private gesture: Gesture | null = null
  private calSwipe: { x: number; y: number; t: number } | null = null
  private suppressedAt = 0
  private unmounted = false
  private sessionStamp = ''
  private reported = new WeakSet<object>()
  private lastSnap: OpsSnapshot | undefined
  private lastCalDay: { date: string; day: CalendarDay } | undefined
  private lastSummary: { key: string; summary: CalendarSummary } | undefined
  private lastSlots: { key: string; data: Availability } | undefined
  private lastHits: CustomerHit[] = []
  private searchQ = ''
  private custQ = ''
  private bookAction = new Action()
  private thumbs = new Map<string, { url: string; at: number }>()
  private markedRead = new Set<string>()
  private sending = false

  constructor(props: Record<string, unknown> | undefined, deps: LiveOpsDeps) {
    super(props)
    this.deps = deps
    this.cmd = new OpsCommands({
      port: deps.port,
      payments: deps.payments,
      queryClient: deps.queryClient,
      session: () => this.session(),
      flash: (title, desc) => this.flash(title, desc),
      now: () => deps.now(),
      tz: () => this.tz(),
    })
    this.state = {
      theme: deps.loadTheme(),
      view: 'timeline',
      search: '',
      range: 'next24',
      selectedId: null,
      modalTab: 'overview',
      newOpen: false,
      newTitle: 'New Appointment',
      tick: 0,
      toast: null,
      dragId: null,
      dropTarget: null,
      ghost: null,
      calMode: 'day',
      calDate: null,
      form: emptyForm(),
      composer: '',
      payTender: deps.loadTender(),
      payLinkOpen: false,
      payLinkUrl: '',
      payLinkError: '',
      busy: [],
    }
  }

  // ---- plumbing ------------------------------------------------------------------------------------------------------

  private session(): Session | null {
    return this.deps.chrome()?.getSession() ?? null
  }
  private tz(): string {
    return this.session()?.businessTz ?? DEFAULT_TZ
  }
  private can = (key: Parameters<typeof can>[1]): boolean => can(this.session(), key)
  private today(): string {
    return businessToday(this.deps.now(), this.tz())
  }

  flash(title: string, desc?: string): void {
    this.setState({ toast: { title, desc } })
    clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => this.setState({ toast: null }), TOAST_MS)
  }

  private stamp(): string {
    const s = this.session()
    return s ? `${s.rbacVersion}|${s.viewAs.active ? s.viewAs.roleId : ''}` : ''
  }

  /** A role change or view-as flips what every read answers (contact masking, what is allowed): refetch, close sheets. */
  private onSession(): void {
    const stamp = this.stamp()
    if (stamp === this.sessionStamp) return
    const first = this.sessionStamp === ''
    this.sessionStamp = stamp
    if (first) return
    void this.deps.queryClient.invalidateQueries({ queryKey: qk.ops() })
    void this.deps.queryClient.invalidateQueries({ queryKey: qk.messages() })
    this.markedRead.clear()
    if (this.state.newOpen) this.setState({ newOpen: false })
  }

  componentDidMount(): void {
    this.unmounted = false
    this.sessionStamp = this.stamp()
    const c = this.deps.chrome()
    if (c) {
      this.offs.push(
        c.subscribe(() => {
          this.onSession()
          this.forceUpdate()
        }),
        c.subscribeToasts((t) => this.flash(t.title, t.desc)),
      )
    }
    this.offs.push(this.deps.store.subscribe(() => this.forceUpdate()))
    this.tickTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      this.setState((s) => ({ tick: s.tick + 1 }))
    }, 1000)
    if (typeof document !== 'undefined') {
      // the tick sleeps while the tab is hidden; one catch-up render when it comes back
      this.visHandler = () => {
        if (!document.hidden) this.setState((s) => ({ tick: s.tick + 1 }))
      }
      document.addEventListener('visibilitychange', this.visHandler)
    }
    this.keyHandler = (e: KeyboardEvent) => this.onKey(e)
    window.addEventListener('keydown', this.keyHandler)
    this.touchGuard = (e: TouchEvent) => {
      if (this.gesture && this.gesture.mode) e.preventDefault()
    }
    document.addEventListener('touchmove', this.touchGuard, { passive: false })
  }

  componentWillUnmount(): void {
    this.unmounted = true
    for (const off of this.offs.splice(0)) off()
    this.deps.store.dispose()
    clearInterval(this.tickTimer)
    clearTimeout(this.toastTimer)
    clearTimeout(this.searchTimer)
    clearTimeout(this.custTimer)
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler)
    if (this.touchGuard) document.removeEventListener('touchmove', this.touchGuard)
    if (this.visHandler) document.removeEventListener('visibilitychange', this.visHandler)
    this.gEnd()
  }

  // ---- keyboard ------------------------------------------------------------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    const tag = ((e.target as HTMLElement | null) && (e.target as HTMLElement).tagName) || ''
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      if (e.key === 'Escape') (e.target as HTMLElement).blur()
      return
    }
    // D3: Ctrl/Cmd/Alt shortcuts belong to the browser (Ctrl+R used to advance the open job and reload the page)
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const s = this.state
    if (e.key === 'Escape') {
      this.setState({ selectedId: null, newOpen: false })
      return
    }
    if (e.key === '/') {
      e.preventDefault()
      document.getElementById('oa-search')?.focus()
      return
    }
    if (e.key.toLowerCase() === 'n') {
      this.openNew('New Appointment')
      return
    }
    if (s.view === 'calendar' && !s.selectedId) {
      if (e.key === 'ArrowLeft') return this.calNav(-1)
      if (e.key === 'ArrowRight') return this.calNav(1)
      if (e.key.toLowerCase() === 't') return void this.setState({ calDate: null })
    }
    const sel = s.selectedId
    if (!sel) return
    const k = e.key.toLowerCase()
    const f = this.fileOf(sel)
    if (k === 'm') {
      this.setTab('messages')
      this.flash('Message composer opened', 'SMS to ' + (f?.customer.name ?? 'the customer'))
    }
    if (k === 'p') this.setTab('payments')
    if ((k === 's' || k === 'r') && f) void this.advanceFile(f)
  }

  // ---- reads ---------------------------------------------------------------------------------------------------------

  private reportRead(key: readonly unknown[]): void {
    if (this.deps.store.status(key) !== 'error') return
    const err = this.deps.store.error(key)
    if (!err || typeof err !== 'object' || this.reported.has(err)) return
    this.reported.add(err)
    if (err instanceof ApiError && (err.isUnauthenticated || err.kind === 'aborted')) return
    const t = toastForError(err)
    // never set state while rendering
    setTimeout(() => {
      if (!this.unmounted) this.flash(t.title, t.desc)
    }, 0)
  }

  private read<T>(key: readonly unknown[], fetcher: () => Promise<T>, staleTimeMs = FRESH_MS): T | undefined {
    const v = this.deps.store.read(key, fetcher, { staleTimeMs })
    if (v === undefined) this.reportRead(key)
    return v
  }

  private snapshot(): OpsSnapshot | undefined {
    const { range } = this.state
    const q = this.searchQ
    const v = this.read(qk.ops('snapshot', WINDOW_OF[range], q), () =>
      this.deps.port.snapshot({ window: WINDOW_OF[range], q }),
    )
    if (v) this.lastSnap = v
    return v ?? this.lastSnap
  }

  /** The file of an appointment, from the cache (a read starts the fetch when it is not there yet). */
  private fileOf(id: string): AppointmentFile | undefined {
    return this.read(qk.ops('file', id), () => this.deps.port.appointment(id))
  }

  private threadOf(id: string): Thread | undefined {
    return this.read(qk.messages('thread', id), () => this.deps.port.thread(id))
  }

  private membershipOf(customerId: string): MembershipView | undefined {
    return this.read(qk.ops('membership', customerId), () => this.deps.port.membership(customerId))
  }

  private catalog(): ServiceCatalog | undefined {
    return this.read(qk.ops('catalog'), () => this.deps.port.catalog(), 10 * 60_000)
  }

  private calendarDate(): string {
    return this.state.calDate ?? this.today()
  }

  // ---- selection and navigation -------------------------------------------------------------------------------------

  /** Opens an appointment's file; ignores the click that follows a drag or swipe (450 ms). */
  openAppt(id: string, tab?: string): void {
    if (clickSuppressed(this.deps.now(), this.suppressedAt)) return
    this.select(id, tab)
  }

  select(id: string, tab = 'overview'): void {
    if (!this.can('cli.view')) {
      this.cmd.allow('cli.view')
      return
    }
    this.setState({ selectedId: id, modalTab: tab, composer: '', payLinkOpen: false, payLinkError: '' })
    this.afterTab(tab, id)
  }

  setTab(tab: string): void {
    this.setState({ modalTab: tab })
    if (this.state.selectedId) this.afterTab(tab, this.state.selectedId)
  }

  /** Entering the Messages tab marks the customer's replies read (when the role may send). */
  private afterTab(tab: string, id: string): void {
    if (tab !== 'messages') return
    const t = this.deps.store.read(qk.messages('thread', id), () => this.deps.port.thread(id), {
      staleTimeMs: FRESH_MS,
    })
    this.markReadIfNeeded(t, id)
  }

  private markReadIfNeeded(t: Thread | undefined, id: string): void {
    if (!t || t.unread <= 0 || !t.customer || this.markedRead.has(id)) return
    if (!this.can('msg.send')) return
    this.markedRead.add(id)
    void this.cmd.markRead(t.customer.id).then((ok) => {
      if (!ok) this.markedRead.delete(id)
    })
  }

  private calNav(dir: number): void {
    this.setState({ calDate: navigate(this.state.calMode, this.calendarDate(), dir) })
  }

  private openNew(title: string): void {
    this.bookAction = new Action()
    this.setState({ newOpen: true, newTitle: title, form: emptyForm() })
  }

  // ---- gestures (the design's engine: timings and thresholds unchanged) --------------------------------------------------

  private canDrag(c: OpsCard): boolean {
    return c.canDrag
  }

  gStart(e: GestureEvent, card: OpsCard, ctx: GestureCtx): void {
    if (e.button > 0) return
    this.gEnd()
    const g: Gesture = {
      id: card.id,
      card,
      ctx,
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      touch: e.pointerType !== 'mouse',
      el: e.currentTarget,
      mode: null,
      can: this.canDrag(card),
    }
    this.gesture = g
    // the file is read on pointer-down so it opens at once on click
    void this.deps.queryClient.prefetchQuery({
      queryKey: qk.ops('file', card.id),
      queryFn: () => this.deps.port.appointment(card.id),
      staleTime: 5_000,
    })
    if (g.touch && g.can)
      g.timer = setTimeout(() => {
        if (this.gesture === g && !g.mode) this.beginDrag(g)
      }, LONG_PRESS_MS)
    window.addEventListener('pointermove', this.onMove)
    window.addEventListener('pointerup', this.onUp)
    window.addEventListener('pointercancel', this.onCancel)
  }

  private onMove = (e: PointerEvent): void => {
    const g = this.gesture
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

  private onUp = (): void => {
    const g = this.gesture
    if (!g) return
    if (g.mode === 'drag') {
      const t = this.state.dropTarget
      this.suppressedAt = this.deps.now()
      this.gEnd()
      if (t) this.dropOn(g, t)
    } else if (g.mode === 'swipe') {
      const dx = g.x - g.x0
      this.suppressedAt = this.deps.now()
      g.el.style.transition = 'transform .22s ease'
      g.el.style.transform = ''
      this.gEnd()
      const out = swipeOutcome(dx)
      if (out === 'advance') void this.advanceCard(g.card)
      else if (out === 'messages') this.select(g.id, 'messages')
    } else this.gEnd()
  }

  private onCancel = (): void => {
    const g = this.gesture
    if (g && g.mode === 'swipe') {
      g.el.style.transition = 'transform .22s ease'
      g.el.style.transform = ''
    }
    this.gEnd()
  }

  gEnd(): void {
    const g = this.gesture
    if (g) clearTimeout(g.timer)
    this.gesture = null
    window.removeEventListener('pointermove', this.onMove)
    window.removeEventListener('pointerup', this.onUp)
    window.removeEventListener('pointercancel', this.onCancel)
    if (typeof document !== 'undefined') document.body.style.userSelect = ''
    if (this.state.dragId) this.setState({ dragId: null, dropTarget: null })
  }

  private beginDrag(g: Gesture): void {
    g.mode = 'drag'
    document.body.style.userSelect = 'none'
    try {
      if (navigator.vibrate) navigator.vibrate(12)
    } catch {
      // vibration is optional
    }
    const v = g.card.vehicle
    this.setState(
      {
        dragId: g.id,
        dropTarget: null,
        ghost: {
          name: g.card.customer.name,
          vehicle: [v?.year, v?.make, v?.model].filter(Boolean).join(' '),
          hint: g.ctx === 'cal' ? 'Drop on a new time' : 'Drop on an open bay',
        },
      },
      () => this.moveGhost(),
    )
  }

  private moveGhost(): void {
    const g = this.gesture
    const el = this.ghostRef.current
    if (g && el) el.style.transform = ghostTransform(g.x, g.y)
  }

  private hoverTarget(): void {
    const g = this.gesture!
    const el = document.elementFromPoint(g.x, g.y)
    const t = el && el.closest ? el.closest('[data-drop]') : null
    const v = t ? t.getAttribute('data-drop') : null
    if (v !== this.state.dropTarget) this.setState({ dropTarget: v })
  }

  private dropOn(g: Gesture, t: string): void {
    const [k, v] = t.split(':')
    if (k === 'bay') void this.assignToBay(g.card, Number(v))
    else if (k === 'hr') void this.rescheduleTo(g.card, Number(v))
  }

  // ---- commands the view model composes ------------------------------------------------------------------------------

  private async advanceCard(c: OpsCard): Promise<void> {
    if (c.next.step === 'collect') {
      this.select(c.id, 'payments')
      return
    }
    await this.cmd.advance({ id: c.id, status: c.status, step: c.next.step })
  }

  private async advanceFile(f: AppointmentFile): Promise<void> {
    if (f.next.step === 'collect') {
      this.setTab('payments')
      return
    }
    await this.cmd.advance({ id: f.id, status: f.status, step: f.next.step })
  }

  private async assignToBay(c: OpsCard, num: number): Promise<void> {
    const bay = this.snapshot()?.bays.find((b) => b.number === num)
    if (!bay) return
    await this.cmd.assignBay(c.id, bay.id)
  }

  /** Dropping on an hour row keeps the minutes of the booking and moves the hour; the server checks capacity and hours. */
  private async rescheduleTo(c: OpsCard, hour: number): Promise<void> {
    if (!c.canDrag) {
      this.flash('Can’t move this job', 'It’s already in progress or done')
      return
    }
    const minutes = parseT(c.time) % 60
    if (Math.floor(parseT(c.time) / 60) === hour) return
    const start = new Date(zonedInstant(c.bizDate, hour * 60 + minutes, this.tz())).toISOString()
    await this.cmd.reschedule(c.id, start)
  }

  private async togglePay(c: OpsCard): Promise<void> {
    if (c.pay.kind === 'paid') {
      await this.cmd.unpay(c.id)
      return
    }
    // money moves from the Payments tab, where the tender is chosen
    this.select(c.id, 'payments')
  }

  private async togglePickup(c: OpsCard): Promise<void> {
    await this.cmd.setPickup(c.id, c.pickupState === 'collected' ? 'pending' : 'collected')
  }

  private async alertAction(a: OpsAlert): Promise<void> {
    const id = a.action.appointmentId
    switch (a.action.type) {
      case 'mark_picked_up':
        if (id) await this.cmd.setPickup(id, 'collected')
        return
      case 'message_customer':
        if (id) this.select(id, 'messages')
        return
      case 'prep_bay':
        if (id) await this.cmd.prepBay(id)
        return
      case 'send_reminder':
        if (id) await this.sendKey(id, 'confirm_request', 'Reminder')
        return
      case 'start_cleaning': {
        if (id) {
          const f = this.fileOf(id) ?? (await this.deps.port.appointment(id))
          await this.cmd.advance({ id, status: f.status, step: 'start' })
        }
        return
      }
      case 'mark_arrived':
        if (id) await this.cmd.arrive(id)
        return
      case 'apply_credit':
        if (id) await this.cmd.applyPerk(id)
        return
      default:
        // assign_bay, view_file, open
        this.alertOpen(a)
    }
  }

  /** Opens what an alert is about: a reply opens the Messages tab, money waiting on Squarespace the Payments tab. */
  private alertOpen(a: OpsAlert): void {
    const id = a.appointmentId ?? a.action.appointmentId
    if (!id) {
      // device and sync alerts have no appointment: say what they say
      this.flash(a.title, a.desc)
      return
    }
    this.select(
      id,
      a.kind === 'new_reply' ? 'messages' : a.kind === 'awaiting_processor' ? 'payments' : 'overview',
    )
  }

  private async sendKey(id: string, templateKey: string, label: string): Promise<void> {
    const f = this.fileOf(id) ?? (await this.deps.port.appointment(id))
    const r = await this.cmd.sendMessage(id, { templateKey }, FIRST_NAME(f.customer.name))
    if (r?.ok) this.flash(label + ' sent', 'SMS to ' + f.customer.name)
  }

  private async sendQuick(f: AppointmentFile, key: string, label: string): Promise<void> {
    // a finished job's "Ready for pickup" is the real notify-ready command (it also stamps the job)
    if (key === 'qr_ready_pickup' && f.status === 'completed') {
      await this.cmd.notifyReady(f.id)
      return
    }
    void label
    await this.runSend(f, { templateKey: key })
  }

  private async runSend(f: AppointmentFile, input: { text?: string; templateKey?: string }): Promise<void> {
    if (this.sending) return
    this.sending = true
    this.setState({ busy: [...this.state.busy, 'send'] })
    try {
      const r = await this.cmd.sendMessage(f.id, input, FIRST_NAME(f.customer.name))
      if (r?.ok && input.text !== undefined) this.setState({ composer: '' })
    } finally {
      this.sending = false
      this.setState({ busy: this.state.busy.filter((b) => b !== 'send') })
    }
  }

  private sendComposer(f: AppointmentFile): void {
    const text = this.state.composer.trim()
    if (!text) return
    void this.runSend(f, { text })
  }

  private async markPaid(f: AppointmentFile): Promise<void> {
    if (!f.invoice) {
      this.flash('No invoice', 'This job has no invoice to collect')
      return
    }
    const tender = this.state.payTender
    const ok = await this.cmd.collect(f.invoice.invoiceId, tender, { first: FIRST_NAME(f.customer.name) })
    if (ok) this.deps.saveTender(tender)
  }

  private async submitLink(f: AppointmentFile): Promise<void> {
    if (!f.invoice) return
    const r = await this.cmd.sendLink(f.invoice.invoiceId, this.state.payLinkUrl)
    if (r.ok) this.setState({ payLinkOpen: false, payLinkUrl: '', payLinkError: '' })
    else if (r.error) this.setState({ payLinkError: r.error.detail || r.error.title })
  }

  /** The form with the package and slot the sheet shows as selected (the design pre-selects both). */
  private effectiveForm(): NewForm {
    const { form: f, newTitle } = this.state
    const walkIn = newTitle === 'Walk-in Booking'
    const qc = this.deps.queryClient
    const catalog = qc.getQueryData<ServiceCatalog>(qk.ops('catalog'))
    const serviceId = f.serviceId ?? defaultServiceId(catalog)
    let slot = f.slot
    if (!slot && !walkIn && serviceId) {
      const date = f.date ?? this.today()
      const av = qc.getQueryData<Availability>(qk.ops('availability', date, serviceId, f.customerId ?? ''))
      slot = av?.slots.find((x) => x.state === 'available')?.start ?? null
    }
    return { ...f, serviceId, slot }
  }

  private async book(): Promise<void> {
    const { newTitle } = this.state
    const form = this.effectiveForm()
    const walkIn = newTitle === 'Walk-in Booking'
    const problem = checkForm(form, walkIn)
    if (problem) {
      this.flash(problem.title, problem.desc)
      return
    }
    if (this.sending) return
    this.sending = true
    this.setState({ busy: [...this.state.busy, 'book'] })
    try {
      const r = await this.cmd.book(bookingRequest(form, walkIn), this.bookAction)
      if (r?.ok) this.setState({ newOpen: false, form: emptyForm() })
    } finally {
      this.sending = false
      this.setState({ busy: this.state.busy.filter((b) => b !== 'book') })
    }
  }

  private setForm(patch: Partial<NewForm>): void {
    this.setState((s) => ({ form: { ...s.form, ...patch } }))
  }

  private searchCustomers(q: string): void {
    clearTimeout(this.custTimer)
    this.custTimer = setTimeout(() => {
      this.custQ = q
      this.forceUpdate()
    }, SEARCH_DEBOUNCE_MS)
  }

  private pickHit(h: CustomerHit): void {
    const v = h.vehicles[0]
    this.setForm({
      customerId: h.id,
      name: h.fullName,
      phone: h.phone ?? '',
      vehicle: v ? [v.year, v.make, v.model].filter(Boolean).join(' ') : '',
      plate: v?.plate ?? '',
    })
    this.custQ = ''
    this.lastHits = []
  }

  private thumb(p: FilePhoto): string {
    const hit = this.thumbs.get(p.id)
    const now = this.deps.now()
    if (hit && now - hit.at < THUMB_KEEP_MS) return hit.url
    const url = p.thumbUrl || p.url || ''
    this.thumbs.set(p.id, { url, at: now })
    return url
  }

  // ---- the template's values -----------------------------------------------------------------------------------------

  renderVals(): VM {
    const s = this.state
    const dark = s.theme === 'dark'
    const chrome = this.deps.chrome()
    this.onSession()
    const nowMs = this.deps.now()
    const tz = this.tz()
    const today = businessToday(nowMs, tz)
    const ui: BoardUi = { dark, dragId: s.dragId, dropTarget: s.dropTarget, nowMs, tz }

    const snap = this.snapshot()
    const bh = this.boardHandlers()

    // calendar reads follow the view
    const calendar = s.view === 'calendar' ? this.calendarVals(today, ui) : {}

    const groups = snap ? groupVMs(snap, ui, bh) : []
    const bays = snap ? snap.bays.map((b) => bayVM(b, ui, bh)) : []
    const arrivals = snap ? snap.arrivals.map((a) => arrivalVM(a, ui, bh)) : []
    const completedJobs = snap ? snap.completed.items.map((c) => completedVM(c, ui, bh)) : []
    const queue = snap ? snap.queue.map((c) => cardVM(c, ui, bh)) : []
    const alerts = snap ? snap.alerts.map((a) => alertVM(a, dark, bh)) : []
    const staffCols = snap ? snap.staff.map((c) => staffVM(c, ui, bh)) : []

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

    // the open file
    let sel: VM | null = null
    let modalOpen = false
    if (s.selectedId) {
      const f = this.fileOf(s.selectedId)
      if (f) {
        modalOpen = true
        const thread = this.threadOf(f.id)
        if (s.modalTab === 'messages') this.markReadIfNeeded(thread, f.id)
        const mem = this.membershipOf(f.customer.id)
        sel = this.fileVals(f, thread, mem, ui, today, renderIcon)
      }
    }

    const nf = this.newVals(today)
    const emergency = snap?.emergency
    const vals: VM = {
      theme: s.theme,
      isDark: dark,
      isLight: !dark,
      toggleTheme: () => {
        const prev = this.state.theme
        const next: Theme = prev === 'dark' ? 'light' : 'dark'
        this.deps.saveTheme(next)
        this.setState({ theme: next })
        chrome?.themeChanged(next, prev)
      },
      showRange: s.view !== 'calendar',
      dragging: !!s.dragId,
      ghostRef: this.ghostRef,
      ghostName: s.ghost ? s.ghost.name : '',
      ghostVehicle: s.ghost ? s.ghost.vehicle : '',
      ghostHint: s.ghost ? s.ghost.hint : '',
      preventCtx: (e: { preventDefault(): void }) => e.preventDefault(),
      emergencyOn: !!emergency?.active,
      emergencyText: emergency?.summary ?? '',
      view: s.view,
      isTimeline: s.view === 'timeline',
      isBay: s.view === 'bay',
      isStaff: s.view === 'staff',
      isCalendar: s.view === 'calendar',
      search: s.search,
      onSearch: (e: { target: { value: string } }) => this.onSearch(e.target.value),
      rangeTabs,
      viewTabs,
      openNew: () => this.openNew('New Appointment'),
      openWalkin: () => this.openNew('Walk-in Booking'),
      closeNew: () => this.setState({ newOpen: false }),
      newOpen: s.newOpen,
      newTitle: s.newTitle,
      newServices: nf.services,
      newSlots: nf.slots,
      createAppt: () => void this.book(),
      kpis: snap ? kpiVMs(snap.kpis) : placeholderKpis(),
      groups,
      apptCount: snap?.timeline.count ?? 0,
      bays,
      arrivals,
      inFacilityLabel: snap?.inFacilityLabel ?? '0 in facility',
      completedJobs,
      completedCount: snap?.completed.count ?? 0,
      noCompleted: completedJobs.length === 0,
      queue,
      alerts,
      alertCount: alerts.length,
      staffCols,
      ...calendar,
      clockLabel: 'Live · ' + businessClock(nowMs, tz),
      dateLabel: dateHeading(today),
      modalOpen,
      sel,
      closeModal: () => this.setState({ selectedId: null }),
      stop: (e: { stopPropagation(): void }) => e.stopPropagation(),
      toast: s.toast,
      toastTitle: s.toast ? s.toast.title : '',
      toastDesc: s.toast ? (s.toast.desc ?? '') : '',
      nf: nf.form,
      loading: !snap,
    }
    // calendar roots the template reads even outside the Calendar view
    for (const k of CAL_DEFAULTS) if (!(k in vals)) vals[k] = CAL_EMPTY[k]
    vals.live = chrome ? chrome.vals() : {}
    if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') !== s.theme)
      document.documentElement.setAttribute('data-theme', s.theme)
    return vals
  }

  private onSearch(v: string): void {
    this.setState({ search: v })
    clearTimeout(this.searchTimer)
    this.searchTimer = setTimeout(() => {
      this.searchQ = v.trim()
      this.forceUpdate()
    }, SEARCH_DEBOUNCE_MS)
  }

  private boardHandlers(): CalHandlers {
    return {
      open: (id, tab) => this.openAppt(id, tab),
      select: (id, tab) => this.select(id, tab),
      advance: (c) => void this.advanceCard(c),
      down: (e, c, ctx) => this.gStart(e, c, ctx),
      prepBay: (id) => void this.cmd.prepBay(id),
      arrive: (id) => void this.cmd.arrive(id),
      assignNext: (b: OpsBay) => {
        if (b.nextUpAppointmentId) this.select(b.nextUpAppointmentId)
        else this.flash('Nothing queued', 'No vehicles waiting for ' + b.name)
      },
      togglePay: (c) => void this.togglePay(c),
      togglePickup: (c) => void this.togglePickup(c),
      alertAction: (a) => void this.alertAction(a),
      alertOpen: (a) => this.alertOpen(a),
      setMode: (mode) => this.setState({ calMode: mode }),
      goTo: (date) => this.setState({ calMode: 'day', calDate: date }),
      nav: (dir) => this.calNav(dir),
      goToday: () => this.setState({ calDate: null }),
      swipeStart: (e) => {
        if (e.pointerType === 'mouse') return
        this.calSwipe = { x: e.clientX, y: e.clientY, t: this.deps.now() }
      },
      swipeEnd: (e) => {
        const c = this.calSwipe
        this.calSwipe = null
        if (!c || (this.gesture && this.gesture.mode === 'drag')) return
        const dir = calendarSwipe(e.clientX - c.x, e.clientY - c.y, this.deps.now() - c.t)
        if (dir !== 0) {
          this.suppressedAt = this.deps.now()
          this.calNav(dir)
        }
      },
    }
  }

  private calendarVals(today: string, ui: BoardUi): VM {
    const { calMode } = this.state
    const date = this.calendarDate()
    let day: CalendarDay | undefined
    let summary: CalendarSummary | undefined
    if (calMode === 'day') {
      day = this.read(qk.ops('calendar', 'day', date), () => this.deps.port.calendarDay(date))
      if (day) this.lastCalDay = { date, day }
      else day = this.lastCalDay?.day
    } else {
      const r = summaryRange(calMode, date)
      const key = r.from + '|' + r.to
      summary = this.read(qk.ops('calendar', 'summary', r.from, r.to), () =>
        this.deps.port.calendarSummary(r.from, r.to),
      )
      if (summary) this.lastSummary = { key, summary }
      else summary = this.lastSummary?.summary
    }
    return calVM({ mode: calMode, date, today, day, summary, ui }, this.boardHandlers())
  }

  private fileVals(
    f: AppointmentFile,
    thread: Thread | undefined,
    mem: MembershipView | undefined,
    ui: BoardUi,
    today: string,
    renderIcon: (svg: string) => unknown,
  ): VM {
    const s = this.state
    const fui: FileUi = {
      dark: ui.dark,
      today,
      tomorrow: addDays(today, 1),
      tz: ui.tz,
      tab: s.modalTab,
      composer: s.composer,
      payTender: s.payTender,
      payLinkOpen: s.payLinkOpen,
      payLinkUrl: s.payLinkUrl,
      payLinkError: s.payLinkError,
      can: {
        collect: this.can('pay.collect'),
        message: this.can('msg.send'),
        checklist: this.can('jobs.checklist'),
        member: this.can('cli.member'),
      },
      busy: new Set(s.busy),
      sending: s.busy.includes('send'),
    }
    const h: FileHandlers = {
      setTab: (t) => this.setTab(t),
      advance: () => void this.advanceFile(f),
      toggleItem: (id, done) => void this.cmd.checklistItem(f.id, id, done),
      bulk: (ids, done, quiet) => void this.cmd.checklistBulk(f.id, ids, done, quiet),
      toggleAddon: (serviceId, _name, on) => void this.cmd.setAddon(f.id, serviceId, on),
      sendQuick: (key, label) => void this.sendQuick(f, key, label),
      setComposer: (t) => this.setState({ composer: t }),
      sendComposer: () => this.sendComposer(f),
      markPaid: () => void this.markPaid(f),
      toggleLink: () => {
        if (!this.cmd.allow('pay.collect')) return
        this.setState({ payLinkOpen: !this.state.payLinkOpen, payLinkError: '' })
      },
      setLinkUrl: (u) => this.setState({ payLinkUrl: u, payLinkError: '' }),
      sendLink: () => void this.submitLink(f),
      setTender: (t) => {
        if (this.can('pay.collect')) this.setState({ payTender: t })
      },
      applyCredit: () => void this.cmd.applyPerk(f.id),
      quickMsg: () => this.setTab('messages'),
      upload: (cat, file) => {
        this.setState({ busy: [...this.state.busy, cat] })
        void this.cmd
          .uploadPhoto(f.id, cat, file)
          .finally(() => this.setState({ busy: this.state.busy.filter((b) => b !== cat) }))
      },
      thumb: (p) => this.thumb(p),
    }
    return fileVM(f, thread, mem, fui, h, renderIcon)
  }

  private newVals(today: string): { services: VM[]; slots: VM[]; form: VM } {
    const s = this.state
    const catalog = s.newOpen ? this.catalog() : undefined
    const f = this.effectiveForm()
    const walkIn = s.newTitle === 'Walk-in Booking'
    const date = f.date ?? today
    let slots: VM[] = []
    let note = 'Greyed slots would overbook a bay — manager override required'
    if (s.newOpen && f.serviceId && !walkIn) {
      const key = qk.ops('availability', date, f.serviceId, f.customerId ?? '')
      const av = this.read(key, () =>
        this.deps.port.availability({ date, serviceId: f.serviceId!, customerId: f.customerId ?? undefined }),
      )
      if (av) this.lastSlots = { key: key.join('|'), data: av }
      const data = av ?? this.lastSlots?.data
      if (data) {
        slots = slotVMs(
          data.slots,
          f.slot,
          { canOverride: this.can('sched.override'), releaseHours: data.releaseHours },
          {
            flash: (t, d) => this.flash(t, d),
            pick: (c) =>
              this.setForm({
                slot: c.slot.start,
                override: c.override,
                overrideReason: c.override ? f.overrideReason : '',
              }),
          },
        )
        note = slotNote(date, data.slots, data.closed ? (data.reason ?? 'Closed') : null)
      }
    }
    // customer search: by the name being typed, or the phone digits
    const q = f.customerId
      ? ''
      : f.name.trim().length >= 2
        ? f.name.trim()
        : digits(f.phone).length >= 4
          ? digits(f.phone)
          : ''
    if (s.newOpen && q && this.custQ === q && this.can('cli.view')) {
      const hits = this.read<CustomerHits>(qk.ops('customers', q), () => this.deps.port.customers(q), 30_000)
      if (hits) this.lastHits = hits.items
    } else if (!q) this.lastHits = []
    const hits = hitVMs(this.lastHits, (h) => this.pickHit(h))
    if (s.newOpen && q && this.custQ !== q) this.searchCustomers(q)
    const form: VM = {
      name: f.name,
      setName: (e: { target: { value: string } }) => this.setForm({ name: e.target.value, customerId: null }),
      phone: f.phone,
      setPhone: (e: { target: { value: string } }) =>
        this.setForm({ phone: e.target.value, customerId: null }),
      vehicle: f.vehicle,
      setVehicle: (e: { target: { value: string } }) => this.setForm({ vehicle: e.target.value }),
      plate: f.plate,
      setPlate: (e: { target: { value: string } }) => this.setForm({ plate: e.target.value }),
      inputStyle,
      phoneStyle: { ...inputStyle, flex: 1, width: 'auto', minWidth: 0 },
      sms: f.smsOptIn,
      smsStyle: smsToggleStyle(f.smsOptIn),
      smsDot: smsDotStyle(f.smsOptIn),
      toggleSms: () => this.setForm({ smsOptIn: !f.smsOptIn }),
      hits,
      hasHits: hits.length > 0,
      isWalkin: walkIn,
      showSlots: !walkIn,
      dateLabel: dayLabel(date, today),
      prevDate: () =>
        this.setForm({ date: date > today ? addDays(date, -1) : date, slot: null, override: false }),
      nextDate: () => this.setForm({ date: addDays(date, 1), slot: null, override: false }),
      canPrev: date > today,
      note,
      override: f.override,
      overrideReason: f.overrideReason,
      setOverrideReason: (e: { target: { value: string } }) =>
        this.setForm({ overrideReason: e.target.value }),
      busy: s.busy.includes('book'),
      submitLabel: s.busy.includes('book') ? 'Booking…' : walkIn ? 'Check in walk-in' : 'Book Appointment',
    }
    return {
      services: serviceVMs(catalog, f.serviceId, (id) =>
        this.setForm({ serviceId: id, slot: null, override: false }),
      ),
      slots,
      form,
    }
  }
}

/** The package the sheet starts on: the design's default, else the first. */
function defaultServiceId(catalog: ServiceCatalog | undefined): string | null {
  const pk = catalog?.packages ?? []
  return (pk.find((p) => p.name === 'Premium Hand Wash + Interior') ?? pk[0])?.id ?? null
}

/** "Saturday, June 13" with Today / Tomorrow in front. */
function dayLabel(date: string, today: string): string {
  const [y, m, d] = parseIso(date)
  const base = `${DOW_LONG[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${MONTHS[m - 1]} ${d}`
  return date === today ? 'Today · ' + base : date === addDays(today, 1) ? 'Tomorrow · ' + base : base
}

const KPI_LABELS = [
  'Appointments 24h',
  'Active jobs',
  'Ready for pickup',
  'Pending payments',
  'Bay time free',
  'Members today',
  'Revenue today',
]
const KPI_ACCENTS = ['var(--accent)', '#C2740B', '#0E9E6E', '#C2410C', '#2563EB', '#7A3B8A', '#0D9488']
const placeholderKpis = (): VM[] =>
  KPI_LABELS.map((label, i) => ({ label, value: '—', sub: '', accent: KPI_ACCENTS[i] }))

const CAL_EMPTY: Record<string, unknown> = {
  calLabel: '',
  calSub: '',
  calRows: [],
  calWeek: [],
  calMonth: [],
  calClosed: false,
  calClosedReason: '',
  calHint: '',
  calModes: [],
  calDow: [],
  calIsDay: true,
  calIsWeek: false,
  calIsMonth: false,
  calPrev: () => undefined,
  calNext: () => undefined,
  calToday: () => undefined,
  calSwipeStart: () => undefined,
  calSwipeEnd: () => undefined,
}
const CAL_DEFAULTS = Object.keys(CAL_EMPTY)

/** The constructor DCHost instantiates: the live view model bound to its dependencies. */
export function createLiveOperationsLogic(make: () => LiveOpsDeps = defaultLiveOpsDeps): DCLogicCtor {
  return class extends LiveOperationsLogic {
    constructor(props?: Record<string, unknown>) {
      super(props, make())
    }
  }
}
