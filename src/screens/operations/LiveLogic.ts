// The Operations (Command Center) view model of the LIVE variant. It renders the same compiled template as the fixture
// class (Logic.ts, untouched for the parity build) from the real API: the board, calendar, appointment file, messages
// and availability are the server's, read through the QueryStore (SSE invalidates the `ops`, `messages` and `payments`
// families and the screen re-reads); the class keeps only UI state (view, range, search, selection, tab, the new
// appointment form, the composer), the gesture engine and the 1 s tick. Every command goes through OpsCommands
// (permission check, Idempotency-Key, the server's toast). docs/screens-operations-live.md has the provenance table.
import * as React from 'react'
import type { QueryClient } from '@tanstack/react-query'
import type { LiveChrome } from '@/auth/chrome'
import { carOf } from '@/auth/kiosk-picker'
import { can, isKiosk } from '@/auth/session-model'
import type { Session } from '@/auth/session-model'
import { Action } from '@/data/command'
import { ApiError } from '@/data/http/problem'
import { getDataPort } from '@/data/default-port'
import { getQueryClient, qk } from '@/data/query'
import { QueryStore } from '@/data/query-store'
import type {
  AppointmentFile,
  Availability,
  CustomerCards,
  FeeCharges,
  TierList,
  CalendarDay,
  CalendarSummary,
  ClientIdentity,
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
  QuoteReq,
  QuoteRes,
  ServiceCatalog,
  Thread,
  VehicleClasses,
} from '@/data/ports/operations'
import type { InvoiceDetail } from '@/data/ports/payments'
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
import { aiThreadLine, alertTab, identityVM } from '@/lib/operations/live/assistant'
import { categoryCountVMs, categoryInfoOf } from '@/lib/operations/live/categories'
import { categoryChips } from '@/lib/categories'
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
import { quoteRequest } from '@/lib/operations/live/newAppt'
import {
  activeSizes,
  carSizeText,
  confirmBadgeStyle,
  confirmBadgeText,
  coverageLines,
  depositFactsOf,
  fileHasSizes,
  hasServerDeposit,
  householdOf,
  planSizeText,
  quoteVM,
  sizeChipStyle,
  sizeChipVMs,
  sizeLabel,
  visitSizeText,
} from '@/lib/operations/live/sizes'
import type { ProcessorName, SizeOption } from '@/lib/operations/live/sizes'
import {
  actionButtonStyle,
  billingBlock,
  canCloseVisit,
  cancelText,
  cardRows,
  cardsShown,
  changeChoice,
  chargeFeeText,
  closedText,
  confirmBoxStyle,
  feeLineStyle,
  feeRows,
  isClosedVisit,
  NOT_CHARGED_CONFIRM,
  NOT_CHARGED_LABEL,
  noShowText,
  plainButtonStyle,
  removeCardText,
  toneStyle,
} from '@/lib/operations/live/billing'
import type { BillingActionKey } from '@/lib/operations/live/billing'
import { OpsCommands } from './live/commands'
import type { WhoAsk } from './live/commands'

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
  /** Names of requests in flight that the UI reflects (photo categories, 'send', 'pin'). */
  busy: string[]
  /** The Overview's "Clear PIN?" confirmation is open (ADR 0160). */
  pinConfirm: boolean
  /** The board's category filter: `all`, a category key or `mixed` (DV-423). */
  catFilter: string
  /** The file's "Change size" chips are open (DV-808). */
  sizeOpen: boolean
  /** The file's car-size chips are open (DV-808). */
  carSizeOpen: boolean
  /** The Membership tab's "Add to household" search text (DV-813). */
  hhQuery: string
  /** DV-903: the saved card whose "Remove" asks first. */
  cardConfirm: string | null
  /** DV-904: the visit's cancel or no-show confirmation, the cancel reason. */
  visitConfirm: 'cancel' | 'no_show' | null
  cancelReason: string
  /** DV-904: the fee whose charge asks first, the fee being waived and the reason typed. */
  feeConfirm: string | null
  feeWaive: string | null
  waiveReason: string
  /** DV-910: the fee waiting for Square whose "Not charged (checked Square)" asks first, and the server's words for a
   * refused one (per charge). */
  ncConfirm: string | null
  ncNotes: Record<string, string>
  /** DV-907: the billing action that asks first, and the "Change tier or size" chooser. */
  billConfirm: string | null
  changeOpen: boolean
  changeTier: string | null
  changeSize: string | null
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

/** The picker's question for a car step, naming the car ("Who’s starting Maria’s Camry?"). */
function stepTitle(step: OpsCard['next']['step'], car: string): string | undefined {
  switch (step) {
    case 'confirm':
      return 'Who’s confirming ' + car + '?'
    case 'arrive':
      return 'Who’s checking in ' + car + '?'
    case 'start':
      return 'Who’s starting ' + car + '?'
    case 'complete':
      return 'Who finished ' + car + '?'
    default:
      return undefined
  }
}

/** The file's card, visit, fee and billing confirmations, closed when another file opens. */
const FILE_WALLET_RESET = {
  cardConfirm: null,
  visitConfirm: null,
  cancelReason: '',
  feeConfirm: null,
  feeWaive: null,
  waiveReason: '',
  ncConfirm: null,
  ncNotes: {},
  billConfirm: null,
  changeOpen: false,
  changeTier: null,
  changeSize: null,
} as const

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
  /** thumbnail URLs that failed to load: their slots show the design's tile */
  private brokenThumbs = new Set<string>()
  /** The file whose open read the client's identity again (Overview's Website PIN cell). */
  private identityReadFor: string | null = null
  private markedRead = new Set<string>()
  private sending = false
  /** F3: the processor a collect answered (its invoice's `processing`), for roles that cannot read the invoice. */
  private learnedProcessor: ProcessorName | null = null

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
      learnProcessor: (p) => {
        this.learnedProcessor = p
      },
      // kiosk mode (ADR 0180, DV-1005): the employee picker; a signed-in person is never asked
      who: (ask) => this.whoAsk(ask),
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
      pinConfirm: false,
      catFilter: 'all',
      sizeOpen: false,
      carSizeOpen: false,
      hhQuery: '',
      ...FILE_WALLET_RESET,
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
  /** The shop's unlocked kiosk (ADR 0180): writes name the employee who taps. */
  private onKiosk(): boolean {
    return isKiosk(this.session())
  }

  private whoAsk(ask: WhoAsk): Promise<string | null | undefined> {
    const c = this.deps.chrome()
    if (!c || !this.onKiosk()) return Promise.resolve(undefined)
    return c.picker.pick(ask)
  }

  /** The file closes: its sticky name ("As Marco R.") is forgotten (DV-1006). */
  private closeFile(): void {
    this.leaveFile()
    this.setState({ selectedId: null })
  }

  /** Leaving the open file: its sticky name and the name held for an unfinished payment or link go (DV-1006, F1). */
  private leaveFile(): void {
    this.deps.chrome()?.picker.forget(this.state.selectedId)
    this.cmd.leaveFile()
  }

  /** "As Marco R. · Change" over the composer, the checklist and the add-ons of the open file, on a kiosk (DV-1006). */
  private actingVals(fileId: string | null): VM {
    const c = this.deps.chrome()
    const p = fileId && c && this.onKiosk() ? c.picker.acting(fileId) : null
    return {
      show: !!p,
      text: p ? 'As ' + p.name : '',
      change: () => {
        if (fileId && c) void c.picker.change(fileId)
      },
    }
  }
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
    // a text in or out, a delivery state or a STOP (all `messages` events) also changes what the open file shows: its
    // message count, the unread dot and the customer's SMS chip
    this.offs.push(
      this.deps.queryClient.getQueryCache().subscribe((e) => {
        if (e.type !== 'updated' || e.action.type !== 'invalidate' || e.query.queryKey[0] !== 'messages')
          return
        const id = this.state.selectedId
        if (id) void this.deps.queryClient.invalidateQueries({ queryKey: qk.ops('file', id) })
      }),
    )
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
      if (this.state.newOpen) this.cmd.closeFlow(this.bookAction)
      this.leaveFile()
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

  /**
   * The client's website PIN and 30-day trust for the Overview cell. Read quietly: the cell is an addition, so a failed
   * read shows nothing rather than a toast (the file looks as it always did).
   */
  private identityOf(customerId: string): ClientIdentity | undefined {
    const key = qk.ops('identity', customerId)
    const fetch = () => this.deps.port.identity(customerId)
    // a PIN set or a number verified on a link page announces nothing on the stream: read it again each time a file opens
    const opened = this.state.selectedId
    if (opened && this.identityReadFor !== opened && this.deps.queryClient.getQueryData(key) !== undefined) {
      this.identityReadFor = opened
      void this.deps.store.refetch(key, fetch)
    }
    if (opened) this.identityReadFor = opened
    return this.deps.store.read(key, fetch, { staleTimeMs: FRESH_MS })
  }

  private membershipOf(customerId: string): MembershipView | undefined {
    return this.read(qk.ops('membership', customerId), () => this.deps.port.membership(customerId))
  }

  /** The shop's vehicle sizes that are on (read quietly: an older server has none and the sheet looks as designed). */
  private sizes(): SizeOption[] {
    const v = this.deps.store.read<VehicleClasses>(qk.ops('sizes'), () => this.deps.port.vehicleClasses(), {
      staleTimeMs: 10 * 60_000,
    })
    return activeSizes(v)
  }

  /** The booking sheet's price preview (quietly: a role without sched.edit or an older server shows none). */
  private quote(req: QuoteReq | null): QuoteRes | undefined {
    if (!req || !this.can('sched.edit')) return undefined
    const key = qk.ops('quote', req.serviceId, req.customerId ?? '', req.vehicleId ?? '', req.vehicleClass ?? '')
    return this.deps.store.read(key, () => this.deps.port.quote(req), { staleTimeMs: 30_000 })
  }

  /** The invoice detail of the Payments port, read while the file's Payments tab is open (pay.reports only). */
  private invoiceDetail(invoiceId: string | undefined): InvoiceDetail | undefined {
    if (!invoiceId || this.state.modalTab !== 'payments' || !this.can('pay.reports')) return undefined
    return this.deps.store.read<InvoiceDetail>(
      qk.payments('invoice', invoiceId),
      () => this.deps.payments.invoice(invoiceId),
      { staleTimeMs: FRESH_MS },
    )
  }

  /**
   * Who takes card money on this invoice (ADR 0171): the file's own invoice summary says so for every role since wave Q3
   * (DV-905); a server before it: the invoice detail (pay.reports, Payments tab open), else what a collect answered earlier
   * in this session (its invoice carries `processing`; the setting is the server's, the same for every invoice), else
   * Squarespace, the design's words.
   */
  private processorOf(f: Pick<AppointmentFile, 'invoice'>): ProcessorName {
    const inv = f.invoice
    if (inv?.processing) return inv.processing.processor
    return this.invoiceDetail(inv?.invoiceId)?.processing?.processor ?? this.learnedProcessor ?? 'squarespace'
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
    this.identityReadFor = null
    if (this.state.selectedId && this.state.selectedId !== id) this.leaveFile()
    this.setState({
      selectedId: id,
      modalTab: tab,
      composer: '',
      payLinkOpen: false,
      payLinkError: '',
      pinConfirm: false,
      sizeOpen: false,
      carSizeOpen: false,
      hhQuery: '',
      ...FILE_WALLET_RESET,
    })
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
    await this.cmd.advance(
      { id: c.id, status: c.status, step: c.next.step },
      stepTitle(c.next.step, carOf(c.customer.name, c.vehicleShort)),
    )
  }

  private async advanceFile(f: AppointmentFile): Promise<void> {
    if (f.next.step === 'collect') {
      this.setTab('payments')
      return
    }
    await this.cmd.advance(
      { id: f.id, status: f.status, step: f.next.step },
      stepTitle(f.next.step, carOf(f.customer.name, [f.vehicle?.make, f.vehicle?.model].filter(Boolean).join(' '))),
    )
  }

  private async assignToBay(c: OpsCard, num: number): Promise<void> {
    const bay = this.snapshot()?.bays.find((b) => b.number === num)
    if (!bay) return
    await this.cmd.assignBay(
      c.id,
      bay.id,
      'Who’s putting ' + carOf(c.customer.name, c.vehicleShort) + ' in ' + bay.name + '?',
    )
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
    this.select(id, alertTab(a.kind))
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
    const ok = await this.cmd.collect(f.invoice.invoiceId, tender, {
      first: FIRST_NAME(f.customer.name),
      processor: this.processorOf(f),
    })
    if (ok) this.deps.saveTender(tender)
  }

  private async submitLink(f: AppointmentFile): Promise<void> {
    if (!f.invoice) return
    // DV-809: with Square there is no URL to paste: the server makes the link (or texts the client's own pay page)
    const url = this.processorOf(f) === 'square' ? '' : this.state.payLinkUrl
    const r = await this.cmd.sendLink(f.invoice.invoiceId, url)
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
      // a walk-in takes the next slot of the grid: when no bay is free there, a manager may fit it in with a reason
      else if (r && walkIn && r.error.code === 'SLOT_UNAVAILABLE' && this.can('sched.override'))
        this.setForm({ override: true })
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
    // the car's size on file is the sheet's default (a size since turned off is not offered: "Not sure")
    const onFile = v?.vehicleClass ?? null
    const active = this.sizes().some((x) => x.key === onFile)
    this.setForm({
      customerId: h.id,
      name: h.fullName,
      phone: h.phone ?? '',
      vehicle: v ? [v.year, v.make, v.model].filter(Boolean).join(' ') : '',
      plate: v?.plate ?? '',
      vehicleId: v?.id ?? null,
      vehicleClass: active ? onFile : null,
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
    const snap = this.snapshot()
    // a filter on a category the board no longer lists (turned off meanwhile) shows everything
    const catFilter =
      s.catFilter !== 'all' && snap?.categoryCounts?.items.some((i) => i.key === s.catFilter)
        ? s.catFilter
        : 'all'
    const ui: BoardUi = {
      dark,
      dragId: s.dragId,
      dropTarget: s.dropTarget,
      nowMs,
      tz,
      cats: categoryInfoOf(snap),
      catFilter,
    }

    const bh = this.boardHandlers()

    // calendar reads follow the view
    const calendar = s.view === 'calendar' ? this.calendarVals(today, ui) : {}

    const groups = snap ? groupVMs(snap, ui, bh) : []
    const bays = snap ? snap.bays.map((b) => bayVM(withWindowNextUp(b, snap), ui, bh)) : []
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
      closeNew: () => {
        this.cmd.closeFlow(this.bookAction)
        this.setState({ newOpen: false })
      },
      newOpen: s.newOpen,
      newTitle: s.newTitle,
      newServices: nf.services,
      newSlots: nf.slots,
      createAppt: () => void this.book(),
      kpis: snap ? kpiVMs(snap.kpis) : placeholderKpis(),
      groups,
      apptCount: snap
        ? catFilter === 'all'
          ? snap.timeline.count
          : groups.reduce((n, g) => n + (g.items as unknown[]).length, 0)
        : 0,
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
      closeModal: () => this.closeFile(),
      stop: (e: { stopPropagation(): void }) => e.stopPropagation(),
      toast: s.toast,
      toastTitle: s.toast ? s.toast.title : '',
      toastDesc: s.toast ? (s.toast.desc ?? '') : '',
      nf: nf.form,
      loading: !snap,
    }
    // calendar roots the template reads even outside the Calendar view
    for (const k of CAL_DEFAULTS) if (!(k in vals)) vals[k] = CAL_EMPTY[k]
    vals.live = {
      ...(chrome ? chrome.vals() : {}),
      ...this.categoryVals(snap, catFilter),
      acting: this.actingVals(modalOpen ? s.selectedId : null),
    }
    if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') !== s.theme)
      document.documentElement.setAttribute('data-theme', s.theme)
    return vals
  }

  /** Today's per-category counts under the KPI tiles, which are also the board's category filter (live.*; DV-423, DV-424). */
  private categoryVals(snap: OpsSnapshot | undefined, current: string): VM {
    const counts = categoryCountVMs(snap?.categoryCounts, current, (k) => this.setState({ catFilter: k }))
    return {
      hasCatCounts: counts.items.length > 0,
      catCountsLabel: counts.label,
      catCounts: counts.items,
    }
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
      processor: this.processorOf(f),
      // a server before wave Q3 has no deposit state on the file: the ledger of the invoice says it (pay.reports)
      depositFacts: hasServerDeposit(f.invoice) ? undefined : depositFactsOf(this.invoiceDetail(f.invoice?.invoiceId)),
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
      thumbFailed: (url) => {
        if (this.brokenThumbs.has(url)) return
        this.brokenThumbs.add(url)
        this.setState({})
      },
      isThumbBroken: (url) => this.brokenThumbs.has(url),
    }
    const identity = s.modalTab === 'overview' ? this.identityOf(f.customer.id) : undefined
    const line = aiThreadLine(thread, this.deps.now(), ui.tz, today)
    return {
      ...fileVM(f, thread, mem, fui, h, renderIcon),
      // the visit's category chips in the header (DV-422), coloured like the board's
      cats: categoryChips(f.categories, ui.cats ?? [], ui.dark, 'file'),
      ...identityVM(
        identity,
        {
          dark: ui.dark,
          tz: ui.tz,
          today,
          first: FIRST_NAME(f.customer.name),
          confirming: s.pinConfirm,
          busy: s.busy.includes('pin'),
        },
        {
          clear: () => {
            if (this.cmd.allow('cli.edit')) this.setState({ pinConfirm: true })
          },
          confirm: () => void this.clearPin(f),
          cancel: () => this.setState({ pinConfirm: false }),
        },
      ),
      aiLineShow: line.show,
      aiLineText: line.text,
      aiLineSub: line.sub,
      ...this.sizeFileVals(f, mem, ui.dark),
      ...this.walletVals(f, mem, ui.tz, today),
    }
  }

  /**
   * The file's sizes, coverage and household (ADR 0170; DV-808, DV-810, DV-813): the size row of the Overview ("Change
   * size" prices the visit again, the car's size on file can be set alone), the "Confirm size" badge, the coverage lines,
   * and on the Membership tab the plan size and the household. A visit booked before sizes shows none of it.
   */
  private sizeFileVals(f: AppointmentFile, mem: MembershipView | undefined, dark: boolean): VM {
    const s = this.state
    const sizes = this.sizes()
    const busySize = s.busy.includes('size')
    const busyCar = s.busy.includes('car-size')
    const show = fileHasSizes(f) && sizes.length > 0
    const badge = confirmBadgeText(f)
    const closed = f.status === 'canceled' || f.status === 'no_show'
    const cov = coverageLines(f)
    const hh = householdOf(mem)
    const canMember = this.can('cli.member')
    // add to household: the customer search of the booking sheet, by name or phone
    const q = s.hhQuery.trim()
    let hits: CustomerHit[] = []
    if (hh.show && !hh.sharedFrom && q.length >= 2 && this.can('cli.view')) {
      const r = this.deps.store.read<CustomerHits>(qk.ops('customers', q), () => this.deps.port.customers(q), {
        staleTimeMs: 30_000,
      })
      const taken = new Set([f.customer.id, ...hh.members.map((m) => m.customerId)])
      hits = (r?.items ?? []).filter((h) => !taken.has(h.id)).slice(0, 5)
    }
    return {
      sizeShow: show,
      sizeText: visitSizeText(f, sizes),
      sizeBadgeShow: show && !!badge,
      sizeBadge: badge,
      sizeBadgeStyle: confirmBadgeStyle(dark),
      sizeCanChange: show && !closed,
      sizeToggle: () => {
        if (!this.cmd.allow('sched.edit')) return
        this.setState({ sizeOpen: !this.state.sizeOpen, carSizeOpen: false })
      },
      sizeToggleLabel: s.sizeOpen ? 'Cancel' : f.vehicleClass ? (badge ? 'Confirm size' : 'Change size') : 'Set size',
      sizeOpen: show && s.sizeOpen,
      sizeChips: sizeChipVMs(sizes, f.vehicleClass, (k) => k && void this.changeSize(f, k), {
        allowUnknown: false,
        disabled: busySize,
      }),
      sizeNote: 'The visit is priced again at the size you pick, and this car keeps that size on file.',
      carShow: show && !!f.vehicle,
      carText: carSizeText(f, sizes),
      carToggle: () => {
        if (!this.cmd.allow('cli.edit')) return
        this.setState({ carSizeOpen: !this.state.carSizeOpen, sizeOpen: false })
      },
      carToggleLabel: s.carSizeOpen ? 'Cancel' : 'Edit',
      carOpen: show && s.carSizeOpen,
      carChips: sizeChipVMs(
        sizes,
        f.vehicle?.vehicleClass ?? null,
        (k) => void this.changeCarSize(f, k, sizes),
        { allowUnknown: true, disabled: busyCar },
      ),
      carNote: 'Only the car on file changes. This visit keeps its price.',
      covShow: cov.length > 0,
      covLines: cov.map((text) => ({ text })),
      // Membership tab: plan size and household
      hhShow: hh.show,
      hhPlanSize: planSizeText(hh.planSize),
      hasPlanSize: !!hh.planSize,
      hhShared: !!hh.sharedFrom,
      hhSharedText: hh.sharedFrom ? 'Shares ' + hh.sharedFrom + '’s membership' : '',
      hhMembers: hh.members.map((m) => ({
        name: m.name,
        remove: () => {
          if (!hh.membershipId) return
          void this.cmd.removeHousehold(hh.membershipId, m.customerId, m.name)
        },
      })),
      hhHasMembers: hh.members.length > 0,
      hhEmpty: hh.members.length === 0 && !hh.sharedFrom,
      hhCanAdd: !hh.sharedFrom,
      hhQuery: s.hhQuery,
      setHhQuery: (e: { target: { value: string } }) => {
        if (!canMember) {
          this.cmd.allow('cli.member')
          return
        }
        this.setState({ hhQuery: e.target.value })
      },
      hhHits: hits.map((h) => ({
        name: h.fullName,
        sub: h.phone ?? '',
        add: () => {
          if (!hh.membershipId) return
          void this.cmd.addHousehold(hh.membershipId, h.id, h.fullName).then((ok) => {
            if (ok) this.setState({ hhQuery: '' })
          })
        },
      })),
      hhHasHits: hits.length > 0,
      hhInputStyle: { ...inputStyle, height: '42px', fontSize: '13px' },
    }
  }

  /**
   * Cards on file (Overview, DV-903), the visit's cancel / no-show and the fee the server proposed after them (Overview,
   * DV-904), and the Membership tab's billing block of a membership billed by Square (DV-907). Each read is quiet (an
   * older server or a role that may not read it shows nothing) and each block shows only when the server has something
   * to say, so a file with today's defaults looks as before (the visit's two buttons aside).
   */
  private walletVals(f: AppointmentFile, mem: MembershipView | undefined, tz: string, today: string): VM {
    const s = this.state
    const dark = s.theme === 'dark'
    const first = FIRST_NAME(f.customer.name)
    const busy = (k: string) => s.busy.includes(k)
    const track = (k: string, p: Promise<unknown>) => {
      this.setState({ busy: [...this.state.busy, k] })
      void p.finally(() => this.setState({ busy: this.state.busy.filter((b) => b !== k) }))
    }

    // ---- cards on file (Overview)
    const overview = s.modalTab === 'overview'
    const cards =
      overview && this.can('cli.view')
        ? this.deps.store.read<CustomerCards>(qk.ops('cards', f.customer.id), () => this.deps.port.cards(f.customer.id), {
            staleTimeMs: FRESH_MS,
          })
        : undefined
    const rows = cardRows(cards, tz, today)
    const cardVals: VM = {
      cdShow: overview && cardsShown(cards),
      cdRows: rows.map((r) => ({
        ...r,
        remove: () => {
          if (this.cmd.allow('cli.edit')) this.setState({ cardConfirm: r.id })
        },
        confirming: s.cardConfirm === r.id,
        confirmText: removeCardText(first, r.label),
        confirm: () => {
          if (busy('card')) return
          track(
            'card',
            this.cmd.removeCard(f.customer.id, r.id, r.label).then((ok) => ok && this.setState({ cardConfirm: null })),
          )
        },
        keep: () => this.setState({ cardConfirm: null }),
      })),
      cdEmpty: rows.length === 0,
      cdEmptyText: 'No card saved yet. Text ' + first + ' a secure link to save one.',
      cdCanLink: !!cards?.charge,
      cdLinkLabel: busy('card-link') ? 'Texting…' : 'Text card link',
      cdLink: () => {
        if (busy('card-link')) return
        track('card-link', this.cmd.cardLink(f.customer.id, first))
      },
      cdButtonStyle: plainButtonStyle(),
      cdConfirmStyle: confirmBoxStyle(dark, 'red'),
      cdConfirmBtnStyle: actionButtonStyle('danger', busy('card')),
    }

    // ---- the visit: cancel / no-show, then the fee (Overview). Only once Square takes card money (the fees are charged
    // on a saved Square card): with today's defaults (Squarespace) nothing new shows. Cancel / No-show only for
    // sched.cancel; a closed visit's card only when it has fees to show.
    const open = canCloseVisit(f)
    const closed = isClosedVisit(f)
    const squareOn = this.processorOf(f) === 'square'
    const fees =
      // not on the kiosk: charging, waiving and "Not charged" are a manager's (DV-1007)
      overview && closed && squareOn && !this.onKiosk() && (this.can('pay.collect') || this.can('sched.cancel'))
        ? this.deps.store.read<FeeCharges>(qk.ops('fees', f.id), () => this.deps.port.feeCharges(f.id), {
            staleTimeMs: FRESH_MS,
          })
        : undefined
    const feeVMs = feeRows(fees?.items, tz, today)
    const reason = s.cancelReason.trim()
    const visitVals: VM = {
      vsShow: overview && squareOn && ((open && this.can('sched.cancel')) || (closed && feeVMs.length > 0)),
      vsCanClose: open,
      vsClosed: closed,
      vsClosedText: closedText(f),
      vsCancel: () => {
        if (this.cmd.allow('sched.cancel')) this.setState({ visitConfirm: 'cancel', cancelReason: '' })
      },
      vsNoShow: () => {
        if (this.cmd.allow('sched.cancel')) this.setState({ visitConfirm: 'no_show' })
      },
      vsCancelling: open && s.visitConfirm === 'cancel',
      vsNoShowing: open && s.visitConfirm === 'no_show',
      vsCancelText: cancelText(first),
      vsNoShowText: noShowText(first),
      vsReason: s.cancelReason,
      vsSetReason: (e: { target: { value: string } }) => this.setState({ cancelReason: e.target.value }),
      vsConfirmCancel: () => {
        if (busy('visit')) return
        if (!reason) {
          this.flash('Say why first', 'The reason is kept with the visit')
          return
        }
        track('visit', this.cmd.cancelVisit(f.id, reason).then((r) => r && this.setState({ visitConfirm: null })))
      },
      vsConfirmNoShow: () => {
        if (busy('visit')) return
        track('visit', this.cmd.noShow(f.id).then((r) => r && this.setState({ visitConfirm: null })))
      },
      vsKeep: () => this.setState({ visitConfirm: null }),
      vsButtonStyle: plainButtonStyle(),
      vsConfirmStyle: confirmBoxStyle(dark, 'red'),
      vsConfirmBtnStyle: actionButtonStyle('danger', busy('visit')),
      vsInputStyle: { ...inputStyle, height: '42px', fontSize: '13px', marginTop: '10px' },
      feeRows: feeVMs.map((r) => ({
        ...r,
        lineStyle: feeLineStyle(r.tone),
        charge: () => {
          if (this.cmd.allow('pay.collect')) this.setState({ feeConfirm: r.id, feeWaive: null })
        },
        waive: () => {
          if (this.cmd.allow('pay.collect')) this.setState({ feeWaive: r.id, feeConfirm: null, waiveReason: '' })
        },
        confirming: s.feeConfirm === r.id && r.canDecide,
        confirmText: chargeFeeText(r),
        confirm: () => {
          if (busy('fee')) return
          track('fee', this.cmd.chargeFee(f.id, r.id).then(() => this.setState({ feeConfirm: null })))
        },
        waiving: s.feeWaive === r.id && r.canDecide,
        reason: s.feeWaive === r.id ? s.waiveReason : '',
        setReason: (e: { target: { value: string } }) => this.setState({ waiveReason: e.target.value }),
        waiveConfirm: () => {
          if (busy('fee')) return
          const why = this.state.waiveReason.trim()
          if (why.length < 2) {
            this.flash('Say why first', 'The reason is kept with the fee')
            return
          }
          track('fee', this.cmd.waiveFee(f.id, r.id, why).then((ok) => ok && this.setState({ feeWaive: null, waiveReason: '' })))
        },
        back: () => this.setState({ feeConfirm: null, feeWaive: null }),
        // DV-910: a fee waiting for Square: "Not charged (checked Square)" (pay.collect only), a confirm first, the server's
        // words for a refused one under it
        ...(() => {
          const show = r.waiting && !!r.invoiceId && this.can('pay.collect')
          const note = show ? (s.ncNotes[r.id] ?? '') : ''
          return {
            ncShow: show,
            ncLabel: NOT_CHARGED_LABEL,
            ncOpen: () => {
              if (show && this.cmd.allow('pay.collect'))
                this.setState({ ncConfirm: r.id, feeConfirm: null, feeWaive: null })
            },
            ncConfirming: show && s.ncConfirm === r.id,
            ncText: NOT_CHARGED_CONFIRM,
            ncConfirm: () => {
              if (!show || !r.invoiceId || busy('not-charged')) return
              track(
                'not-charged',
                this.cmd.notCharged(f.id, r.invoiceId, r.id).then((res) =>
                  this.setState((st) => {
                    const ncNotes = { ...st.ncNotes }
                    if (res.ok || !res.note) delete ncNotes[r.id]
                    else ncNotes[r.id] = res.note
                    return { ncConfirm: null, ncNotes }
                  }),
                ),
              )
            },
            ncBack: () => this.setState({ ncConfirm: null }),
            ncSubmitLabel: busy('not-charged') ? 'Checking Square…' : 'Not charged',
            ncHasNote: !!note,
            ncNote: note,
          }
        })(),
      })),
      feeHas: feeVMs.length > 0,
      feeConfirmStyle: confirmBoxStyle(dark, 'accent'),
      feeConfirmBtnStyle: actionButtonStyle('primary', busy('fee')),
      ncConfirmBtnStyle: actionButtonStyle('primary', busy('not-charged')),
    }

    // ---- the billing block (Membership tab)
    const block = s.modalTab === 'membership' ? billingBlock(mem, { tz, today }) : billingBlock(undefined, { tz, today })
    const m = mem?.membership
    const tiers =
      block.show && s.changeOpen
        ? this.deps.store.read<TierList>(qk.ops('tiers'), () => this.deps.port.tiers(), { staleTimeMs: 10 * 60_000 })
        : undefined
    const choice = m
      ? changeChoice(tiers?.tiers, this.sizes(), { planKey: m.plan.key, planClass: m.planClass }, { tier: s.changeTier, size: s.changeSize })
      : null
    const act = (key: BillingActionKey, change?: { planKey: string; planClass?: string }) => {
      if (!m || busy('billing')) return
      track(
        'billing',
        this.cmd.billing(m.id, mem!.customerId, key, first, change).then((ok) => {
          if (ok) this.setState({ billConfirm: null, changeOpen: false, changeTier: null, changeSize: null })
        }),
      )
    }
    const confirmOf = block.buttons.find((b) => b.key === s.billConfirm)
    const billingVals: VM = {
      blShow: block.show,
      blTitle: block.title,
      blStatus: block.status.value,
      blStatusStyle: toneStyle(block.status.tone),
      blLines: block.lines.map((l) => ({ label: l.label, value: l.value, style: toneStyle(l.tone) })),
      blNotes: block.notes.map((text) => ({ text })),
      blHasNotes: block.notes.length > 0,
      blButtons: block.buttons.map((b) => ({
        label: b.label,
        style: plainButtonStyle(busy('billing')),
        onClick: () => {
          if (!this.cmd.allow(b.key === 'refund-last' ? 'pay.refund' : 'cli.member')) return
          if (b.key === 'change') this.setState({ changeOpen: true, billConfirm: null, changeTier: null, changeSize: null })
          else if (b.confirm) this.setState({ billConfirm: b.key, changeOpen: false })
          else act(b.key)
        },
      })),
      blConfirming: !!confirmOf,
      blConfirmText: confirmOf?.confirm ?? '',
      blConfirmLabel: confirmOf?.label ?? '',
      blConfirm: () => confirmOf && act(confirmOf.key),
      blKeep: () => this.setState({ billConfirm: null }),
      blConfirmStyle: confirmBoxStyle(dark, confirmOf?.danger ? 'red' : 'accent'),
      blConfirmBtnStyle: actionButtonStyle(confirmOf?.danger ? 'danger' : 'primary', busy('billing')),
      blChangeOpen: block.show && s.changeOpen,
      blTiers: (choice?.tiers ?? []).map((t) => ({
        label: t.label,
        style: sizeChipStyle(t.on),
        onClick: () => this.setState({ changeTier: t.key, changeSize: null }),
      })),
      blSizes: (choice?.sizes ?? []).map((z) => ({
        label: z.label + ' · ' + z.price,
        style: sizeChipStyle(z.on),
        onClick: () => this.setState({ changeSize: z.key }),
      })),
      blChangeSummary: choice?.summary ?? '',
      blChangeLoading: block.show && s.changeOpen && !tiers,
      blChangeConfirm: () => {
        if (!choice?.ready || !m) return
        act('change', { planKey: s.changeTier ?? m.plan.key, planClass: s.changeSize ?? m.planClass })
      },
      blChangeCancel: () => this.setState({ changeOpen: false, changeTier: null, changeSize: null }),
      blChangeBtnStyle: actionButtonStyle('primary', busy('billing') || !choice?.ready),
      blChangeBoxStyle: confirmBoxStyle(dark, 'accent'),
    }
    return { ...cardVals, ...visitVals, ...billingVals }
  }

  /** "Change size" (DV-808): the server prices the visit again; the chips close when it answered. */
  private async changeSize(f: AppointmentFile, key: string): Promise<void> {
    if (this.state.busy.includes('size')) return
    // the same size again only confirms a price the shop still had to confirm; otherwise there is nothing to change
    if (key === f.vehicleClass && !f.needsSizeConfirm && !f.needsPriceConfirm) {
      this.setState({ sizeOpen: false })
      return
    }
    this.setState({ busy: [...this.state.busy, 'size'] })
    try {
      const ok = await this.cmd.setVisitSize(f.id, key, f.version)
      if (ok) this.setState({ sizeOpen: false })
    } finally {
      this.setState({ busy: this.state.busy.filter((b) => b !== 'size') })
    }
  }

  /** The car's size on file only (DV-808): for a closed visit, or a car whose size on file is wrong. */
  private async changeCarSize(f: AppointmentFile, key: string | null, sizes: readonly SizeOption[]): Promise<void> {
    const v = f.vehicle
    if (!v || this.state.busy.includes('car-size')) return
    this.setState({ busy: [...this.state.busy, 'car-size'] })
    try {
      const ok = await this.cmd.setVehicleSize(
        f.customer.id,
        v.id,
        key,
        key ? (sizeLabel(sizes, key) ?? key) : 'No size on file',
      )
      if (ok) this.setState({ carSizeOpen: false })
    } finally {
      this.setState({ busy: this.state.busy.filter((b) => b !== 'car-size') })
    }
  }

  /** Clear PIN, after the cell's confirmation: the server ends the PIN, the links, the sessions and the trust. */
  private async clearPin(f: AppointmentFile): Promise<void> {
    if (this.state.busy.includes('pin')) return
    this.setState({ busy: [...this.state.busy, 'pin'] })
    try {
      const ok = await this.cmd.clearPin(f.customer.id, FIRST_NAME(f.customer.name))
      if (ok) this.setState({ pinConfirm: false })
    } finally {
      this.setState({ busy: this.state.busy.filter((b) => b !== 'pin') })
    }
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
    const sizes = s.newOpen ? this.sizes() : []
    const sizeVals: VM = {
      hasSizes: sizes.length > 0,
      sizes: sizeChipVMs(sizes, f.vehicleClass, (k) => this.setForm({ vehicleClass: k }), { allowUnknown: true }),
      sizeNote: f.vehicleClass
        ? ''
        : 'Not sure: priced at the starting price, then confirm the size at the shop.',
      hasSizeNote: !f.vehicleClass,
      ...quoteVM(s.newOpen ? this.quote(quoteRequest(f)) : undefined),
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
      setVehicle: (e: { target: { value: string } }) => this.setForm({ vehicle: e.target.value, vehicleId: null }),
      plate: f.plate,
      setPlate: (e: { target: { value: string } }) => this.setForm({ plate: e.target.value, vehicleId: null }),
      // DV-807: the size chips (the car's size on file preselected) and the server's price for that size
      ...sizeVals,
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
      walkReason: walkIn && f.override,
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

/**
 * A free bay's "Next" line follows the range tab and the search like the rest of the board, as in the design: the first
 * appointment of the shown timeline (upcoming, not in a bay, not done) planned for that bay. The server's own nextUp
 * ignores the range, so on Tomorrow it named today's car.
 */
export function withWindowNextUp(b: OpsBay, snap: Pick<OpsSnapshot, 'timeline'>): OpsBay {
  for (const g of snap.timeline.groups)
    for (const c of g.items)
      if (c.bay?.number === b.number)
        return { ...b, nextUp: `Next: ${c.customer.name} · ${c.time}`, nextUpAppointmentId: c.id }
  return { ...b, nextUp: 'No vehicles queued', nextUpAppointmentId: null }
}
