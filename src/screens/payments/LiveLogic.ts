// The Payments view model of the LIVE variant. It renders the same template as the fixture class (Logic.ts) from the
// ledger API instead of a local event list: every money figure on screen is the server's (review B13), the class keeps
// only UI state (range, filter, search, selection, the open sheet and its form). Reads go through the QueryStore (SSE
// invalidates the `payments` family, the screen re-reads), money actions through command() with the Idempotency-Key of
// the sheet that opened (never optimistic: the submit keeps its disabled style while the request is in flight).
// docs/screens-payments-live.md has the provenance table (which roots come from which endpoint) and the DV-2xx list.
import { categoryInfoOfSummary, categorySplitVMs, rowCategory } from '@/lib/payments/categories'
import type { QueryClient } from '@tanstack/react-query'
import { DCLogic } from '@/dc/DCLogic'
import type { DCLogicCtor } from '@/dc/types'
import type { LiveChrome } from '@/auth/chrome'
import { can, limit } from '@/auth/session-model'
import type { Session } from '@/auth/session-model'
import { deniedTitle } from '@/auth/permissions'
import { Action, command } from '@/data/command'
import type { CommandResult } from '@/data/command'
import { ApiError } from '@/data/http/problem'
import { getDataPort } from '@/data/default-port'
import { getQueryClient, qk } from '@/data/query'
import { QueryStore } from '@/data/query-store'
import type {
  CardCharge,
  CardChargeResult,
  CollectResult,
  CsvDownload,
  InvoiceDetail,
  InvoiceListRow,
  PaymentsPort,
  PaymentsSummary,
  Reconciliation,
  SquareIgnoreReason,
  SquarePaymentToMatch,
} from '@/data/ports/payments'
import {
  IGNORE_REASONS,
  applyButtonStyle,
  WAITING_FOR_SQUARE_TEXT,
  applyTargets,
  bannerStyle,
  cardChargeToast,
  chipStyle,
  collectTenderList,
  declinedText,
  failedRefundLine,
  inFlightText,
  parseInvoiceNo,
  paymentLine,
  paymentMeta,
  processorOf,
  sentLinkText,
  toMatchBanner,
} from '@/lib/payments/square'
import { toastForError, toastText } from '@/data/toast'
import { serverNow } from '@/lib/clock'
import { DEFAULT_TZ, businessToday } from '@/lib/tz'
import {
  NOT_CHARGED_CONFIRM,
  NOT_CHARGED_LABEL,
  chargeFeeText,
  feeChargeToast,
  feeLineStyle,
  feeRows,
  isWaitingCharge,
  notChargedNote,
  notChargedToast,
} from '@/lib/operations/live/billing'
import { invoicePill } from '@/lib/color'
import {
  FILTERS,
  NO_PERMS,
  RANGE_BUTTONS,
  actionSpecs,
  adjustToast,
  applyToast,
  approveButtonStyle,
  approveToast,
  barViews,
  bigNumberViews,
  chip,
  collectToast,
  confirmToast,
  divHalfUp,
  creditLineText,
  creditToast,
  csvToast,
  defaultTender,
  filterChipStyle,
  filterCountStyle,
  filterCountText,
  headerView,
  itemBoxStyle,
  itemRowStyle,
  kpiViews,
  liveLedgerEntries,
  lineViews,
  liveSheetCalc,
  liveSheetForm,
  methodViews,
  money,
  pendingText,
  permBoxStyle,
  rangeButtonStyle,
  rangeCovering,
  receiptToast,
  refundToast,
  rowStyle,
  rowView,
  saveBlob,
  seg,
  submitStyle,
  unitSeg,
  adjustValueLabel,
} from '@/lib/payments'
import type {
  FilterKey,
  LivePerms,
  LiveSheetForm,
  RangeKey,
  SheetKind,
  SheetRequest,
  Theme,
} from '@/lib/payments'

export interface LiveState {
  theme: Theme
  range: RangeKey
  filter: FilterKey
  query: string
  /** The invoice shown in the detail panel; null = the first row of the table. */
  selId: string | null
  sheet: SheetKind | null
  f: LiveSheetForm
  toast: string | null
  /** A sheet submit is in flight. */
  busy: boolean
  /** Server text shown under the payment-link input (host allow-list, link required). */
  urlError: string | null
  /** DV-802: a Square payment link the server made (pay links off: the plain square.link URL), shown with Copy. */
  sentLink: string | null
  /** The note under that link: texted, or why it was not (the client opted out or has no phone). */
  sentNote: string
  /** That link was texted to the client. */
  sentTexted: boolean
  /** DV-805: the "Square payments to match" sheet is open. */
  sqOpen: boolean
  /** DV-804: the staff Square reader entry the sheet was opened for (its amount is matched first). */
  sqFocus: string | null
  /** DV-805: the reason chosen per payment before "Set aside". */
  sqReasons: Record<string, SquareIgnoreReason>
  /** A queue command in flight (the payment id). */
  sqBusy: string | null
  /** DV-804: the Square payment whose "Move to another invoice" box is open (its ledger event id), the text and the error. */
  moveFor: string | null
  moveTo: string
  moveError: string
  /**
   * DV-901: the saved-card charge of the Collect sheet: declined (Square's reason) or waiting for Square (202, with the
   * charge, which DV-910's Not charged may close).
   */
  cardState: { kind: 'declined' | 'waiting'; text: string; charge?: CardCharge } | null
  /** DV-904: the fee of a canceled visit whose charge asks first, the fee being waived and the reason typed. */
  feeConfirm: string | null
  feeWaive: string | null
  waiveReason: string
  /** A fee command in flight. */
  feeBusy: boolean
  /** DV-910: the waiting charge whose "Not charged (checked Square)" asks first, a request in flight, and the server's
   * words for a refused one (per charge: "Square may still be answering this charge. …"). */
  ncConfirm: string | null
  ncBusy: boolean
  ncNotes: Record<string, string>
}

export interface LiveDeps {
  port: PaymentsPort
  queryClient: QueryClient
  store: QueryStore
  chrome(): LiveChrome | null
  loadTheme(): Theme
  saveTheme(t: Theme): void
  download(file: CsvDownload): void
  /** Copies a text to the clipboard (the Square link of DV-802). */
  copy(text: string): Promise<void>
  /** Opens a checked Square receipt page in a new tab, without an opener (DV-902). */
  openUrl(url: string): void
}

type Vals = Record<string, unknown>
type InputEvent = { target: { value: string } }

const TOAST_MS = 3000
const THEME_KEY = 'oasis-theme'
const LINK_CODES = new Set(['PAYMENT_LINK_HOST', 'PAYMENT_LINK_REQUIRED'])

export function defaultLiveDeps(): LiveDeps {
  const queryClient = getQueryClient()
  return {
    port: getDataPort().payments,
    queryClient,
    store: new QueryStore(queryClient),
    chrome: () => (typeof window !== 'undefined' && window.__oasisLive) || null,
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
    download: (f) => saveBlob(f.body, f.filename),
    copy: async (text) => {
      await navigator.clipboard.writeText(text)
    },
    openUrl: (url) => {
      window.open(url, '_blank', 'noopener,noreferrer')
    },
  }
}

/** The permissions the screen gates on, from the session (the server enforces the same rules). */
export function permsOf(s: Session | null): LivePerms {
  if (!s) return NO_PERMS
  const lim = (kind: 'refund' | 'adjust' | 'credit') => {
    const l = limit(s, kind)
    return { has: l.has, maxCents: l.maxCents }
  }
  return {
    roleLabel: s.roles.map((r) => r.name).join(' + ') || s.roleTitle,
    canCollect: can(s, 'pay.collect'),
    canReceipt: can(s, 'msg.send') || can(s, 'pay.collect'),
    refund: lim('refund'),
    adjust: lim('adjust'),
    credit: lim('credit'),
  }
}

export class LivePaymentsLogic extends DCLogic<LiveState> {
  readonly deps: LiveDeps
  private toastTimer: ReturnType<typeof setTimeout> | undefined
  private offs: Array<() => void> = []
  private sheetAction = new Action()
  private actions = new Map<string, Action>()
  private reported = new WeakSet<object>()
  private lastRows: { range: RangeKey; rows: InvoiceListRow[] } | null = null
  private sessionStamp = ''
  private exporting = false
  private shownId: string | null = null
  private unmounted = false

  constructor(props: Record<string, unknown> | undefined, deps: LiveDeps) {
    super(props)
    this.deps = deps
    this.state = {
      theme: deps.loadTheme(),
      range: '7d',
      filter: 'all',
      query: '',
      selId: null,
      sheet: null,
      f: liveSheetForm(),
      toast: null,
      busy: false,
      urlError: null,
      sentLink: null,
      sentNote: '',
      sentTexted: false,
      sqOpen: false,
      sqFocus: null,
      sqReasons: {},
      sqBusy: null,
      moveFor: null,
      moveTo: '',
      moveError: '',
      cardState: null,
      feeConfirm: null,
      feeWaive: null,
      waiveReason: '',
      feeBusy: false,
      ncConfirm: null,
      ncBusy: false,
      ncNotes: {},
    }
  }

  // ---- plumbing ------------------------------------------------------------------------------------------------

  private session(): Session | null {
    return this.deps.chrome()?.getSession() ?? null
  }

  flash(t: string): void {
    this.setState({ toast: t })
    clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => this.setState({ toast: null }), TOAST_MS)
  }

  private actionFor(name: string): Action {
    let a = this.actions.get(name)
    if (!a) this.actions.set(name, (a = new Action()))
    return a
  }

  private stamp(): string {
    const s = this.session()
    return s ? `${s.rbacVersion}|${s.viewAs.active ? s.viewAs.roleId : ''}` : ''
  }

  /** A role change or view-as flips what every read answers (canApprove, caller): refetch the family, close the sheet. */
  private onSession(): void {
    const stamp = this.stamp()
    if (stamp === this.sessionStamp) return
    const first = this.sessionStamp === ''
    this.sessionStamp = stamp
    if (first) return
    void this.deps.queryClient.invalidateQueries({ queryKey: qk.payments() })
    if (this.state.sheet) this.setState({ sheet: null, busy: false })
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
        c.subscribeToasts((t) => this.flash(toastText(t))),
      )
    }
    this.offs.push(this.deps.store.subscribe(() => this.forceUpdate()))
  }

  componentWillUnmount(): void {
    this.unmounted = true
    for (const off of this.offs.splice(0)) off()
    this.deps.store.dispose()
    clearTimeout(this.toastTimer)
  }

  // ---- reads ---------------------------------------------------------------------------------------------------

  private reportRead(key: readonly unknown[]): void {
    if (this.deps.store.status(key) !== 'error') return
    const err = this.deps.store.error(key)
    if (!err || typeof err !== 'object' || this.reported.has(err)) return
    this.reported.add(err)
    if (err instanceof ApiError && (err.isUnauthenticated || err.kind === 'aborted')) return
    const t = toastText(toastForError(err))
    // never set state while rendering
    setTimeout(() => {
      if (!this.unmounted) this.flash(t)
    }, 0)
  }

  private readSummary(range: RangeKey): PaymentsSummary | undefined {
    const key = qk.payments('summary', range)
    const v = this.deps.store.read(key, () => this.deps.port.summary(range))
    if (v === undefined) this.reportRead(key)
    return v
  }

  private readRows(range: RangeKey, filter: FilterKey, query: string): InvoiceListRow[] | undefined {
    const q = query.trim()
    const key = qk.payments('invoices', range, filter, q)
    const rows = this.deps.store.read(key, () => this.deps.port.invoices({ range, filter, q }))
    if (rows === undefined) {
      this.reportRead(key)
      // keep the previous list on screen while the next one loads (typing in the search box), same range only
      return this.lastRows?.range === range ? this.lastRows.rows : undefined
    }
    this.lastRows = { range, rows }
    return rows
  }

  private readDetail(id: string): InvoiceDetail | undefined {
    const key = qk.payments('invoice', id)
    const v = this.deps.store.read(key, () => this.deps.port.invoice(id))
    if (v === undefined) this.reportRead(key)
    return v
  }

  /** DV-805: the Square payments a person has to match (the banner and the sheet). An older server: none. */
  private readToMatch(): SquarePaymentToMatch[] | undefined {
    const key = qk.payments('square', 'unmatched')
    const v = this.deps.store.read(key, () => this.deps.port.squareToMatch(), { staleTimeMs: 30_000 })
    return v?.items
  }

  /**
   * DV-904: the fees of a canceled visit's invoice (GET /invoices/:id/card-charges), read quietly; DV-910: also an open
   * invoice Square takes card money on that still owes, for a balance charge waiting for Square (Not charged closes it).
   */
  private readCharges(d: InvoiceDetail): CardCharge[] | undefined {
    const fees = d.canceled && !!d.appointmentId
    const waiting = !d.canceled && processorOf(d) === 'square' && d.calc.balance > 0
    if (!fees && !waiting) return undefined
    const v = this.deps.store.read(qk.payments('charges', d.id), () => this.deps.port.invoiceCharges(d.id), {
      staleTimeMs: 30_000,
    })
    return v?.items
  }

  /** DV-806: the reconciliation's Square section, read only while the sheet is open. */
  private readRecon(): Reconciliation | undefined {
    return this.deps.store.read(qk.payments('square', 'recon'), () => this.deps.port.reconciliation(), {
      staleTimeMs: 30_000,
    })
  }

  // ---- commands ------------------------------------------------------------------------------------------------

  private store(inv: { id: string } & Partial<InvoiceDetail>): void {
    // the response of a command is the server's refreshed invoice: show it at once (the family refetch follows)
    this.deps.queryClient.setQueryData(qk.payments('invoice', inv.id), inv)
  }

  private run<T extends { invoice?: InvoiceDetail | null }>(
    action: Action,
    request: (idem: string) => Promise<T>,
    onOk: (r: T) => string,
    denyLabel: string,
  ): Promise<CommandResult<T>> {
    return command<T>({
      key: qk.payments(),
      idempotencyKey: action.key,
      queryClient: this.deps.queryClient,
      denyLabel,
      request,
      onOk: (r) => {
        if (r.invoice) this.store(r.invoice)
        return { title: onOk(r) }
      },
    })
  }

  private async submitSheet(
    sk: SheetKind,
    d: InvoiceDetail,
    req: SheetRequest,
    perms: LivePerms,
  ): Promise<void> {
    if (this.state.busy) return
    const verbs: Record<SheetRequest['kind'], string | null> = {
      refund: perms.refund.has ? null : deniedTitle('pay.refund'),
      adjust: perms.adjust.has ? null : deniedTitle('pay.adjust'),
      credit: perms.credit.has ? null : deniedTitle('pay.credit'),
      collect: perms.canCollect ? null : deniedTitle('pay.collect'),
      card_charge: perms.canCollect ? null : deniedTitle('pay.collect'),
      apply: perms.canCollect ? null : deniedTitle('pay.collect'),
    }
    const denied = verbs[req.kind]
    if (denied) {
      this.flash(denied)
      return
    }
    const port = this.deps.port
    const act = this.sheetAction
    const o = (idem: string) => ({ idempotencyKey: idem })
    this.setState({ busy: true, urlError: null })
    let res: CommandResult<unknown>
    switch (req.kind) {
      case 'refund':
        res = await this.run(act, (i) => port.refund(d.id, req.input, o(i)), refundToast, 'issue refunds')
        break
      case 'adjust':
        res = await this.run(
          act,
          (i) => port.adjust(d.id, req.input, o(i)),
          (r) => adjustToast(req.input.kind, r),
          'adjust invoices',
        )
        break
      case 'credit':
        res = await this.run(
          act,
          (i) => port.issueCredit(d.id, req.input, o(i)),
          (r) => creditToast(r, d.client),
          'issue credits',
        )
        break
      case 'collect':
        res = await this.run(
          act,
          (i) => port.collect(d.id, req.input, o(i)),
          (r) => collectToast(r, d.client),
          'collect payments',
        )
        break
      case 'apply':
        res = await this.run(act, (i) => port.applyCredit(d.id, o(i)), applyToast, 'collect payments')
        break
      case 'card_charge':
        // DV-901: the server charges the card the client said yes to; a decline keeps the sheet (the same key again is a
        // new attempt on the same charge), a charge Square has not answered yet stays on screen as waiting
        res = await this.run(
          act,
          (i) => port.chargeCard(d.id, req.input, o(i)),
          (r) => cardChargeToast(r.charge),
          'collect payments',
        )
        break
    }
    if (this.unmounted) return
    if (req.kind === 'card_charge') {
      if (res.ok) {
        act.renew()
        const charge = (res.data as CardChargeResult).charge
        const waiting = charge.state === 'unknown'
        this.setState({
          busy: false,
          sheet: waiting ? 'collect' : null,
          cardState: waiting ? { kind: 'waiting', text: WAITING_FOR_SQUARE_TEXT, charge } : null,
        })
      } else {
        const e = res.error
        this.setState((st) => ({
          busy: false,
          f: { ...st.f, cardOk: false },
          cardState:
            e.code === 'CARD_DECLINED'
              ? { kind: 'declined', text: declinedText(d.client.split(' ')[0]!, e.detail) }
              : st.cardState,
        }))
      }
      return
    }
    if (res.ok) {
      act.renew()
      // DV-802: a Square link the server made (pay links off) stays on screen with Copy; a texted personal link never shows
      const pl = req.kind === 'collect' && processorOf(d) === 'square' ? (res.data as CollectResult).paymentLink : undefined
      const link = pl?.url ?? null
      if (link && pl)
        this.setState({
          busy: false,
          urlError: null,
          sentLink: link,
          sentNote: sentLinkText(pl.sms, d.client, pl.expectedCents),
          sentTexted: pl.sms === 'queued',
        })
      else this.setState({ busy: false, sheet: null, urlError: null })
      return
    }
    const e = res.error
    this.setState({
      busy: false,
      urlError: sk === 'collect' && LINK_CODES.has(e.code ?? '') ? e.detail || e.title : null,
    })
  }

  private approve(d: InvoiceDetail, id: string): void {
    const e = d.ledger.find((x) => x.id === id)
    if (!e) return
    if (!e.canApprove) {
      this.flash(
        e.approveBlock === 'self'
          ? 'You can’t approve a refund you requested. Ask another approver.'
          : 'Your role can’t approve ' + money(e.amountCents),
      )
      return
    }
    const act = this.actionFor('approve:' + id)
    void this.run(
      act,
      (i) => this.deps.port.approveRefund(d.id, id, { idempotencyKey: i }),
      approveToast,
      'approve refunds',
    ).then((r) => {
      if (r.ok) act.renew()
    })
  }

  private deny(d: InvoiceDetail, id: string, perms: LivePerms): void {
    if (!perms.refund.has) {
      this.flash(deniedTitle('pay.refund'))
      return
    }
    const act = this.actionFor('deny:' + id)
    void this.run(
      act,
      (i) => this.deps.port.denyRefund(d.id, id, { idempotencyKey: i }),
      () => 'Refund request denied',
      'issue refunds',
    ).then((r) => {
      if (r.ok) act.renew()
    })
  }

  private confirm(id: string, type: string, perms: LivePerms): void {
    if (type === 'refund' ? !perms.refund.has : !perms.canCollect) {
      this.flash(deniedTitle(type === 'refund' ? 'pay.refund' : 'pay.collect'))
      return
    }
    const act = this.actionFor('confirm:' + id)
    void this.run(
      act,
      (i) => this.deps.port.confirmProcessor(id, { idempotencyKey: i }),
      confirmToast,
      type === 'refund' ? 'issue refunds' : 'collect payments',
    ).then((r) => {
      if (r.ok) act.renew()
    })
  }

  private receipt(d: InvoiceDetail, perms: LivePerms): void {
    if (!perms.canReceipt) {
      this.flash(deniedTitle('msg.send'))
      return
    }
    const act = this.actionFor('receipt:' + d.id)
    void this.run(
      act,
      (i) => this.deps.port.sendReceipt(d.id, { idempotencyKey: i }),
      (r) => receiptToast(r, d.client),
      'send messages',
    ).then((r) => {
      if (r.ok) act.renew()
    })
  }

  // ---- Square (DV-804, DV-805) -----------------------------------------------------------------------------------

  private async sqApply(
    p: SquarePaymentToMatch,
    target: { invoiceId: string; confirmEventId: string | null; label: string },
    perms: LivePerms,
  ): Promise<void> {
    if (!perms.canCollect) {
      this.flash(deniedTitle('pay.collect'))
      return
    }
    if (this.state.sqBusy) return
    const act = this.actionFor('sq-apply:' + p.paymentId)
    this.setState({ sqBusy: p.paymentId })
    const r = await this.run(
      act,
      (i) =>
        this.deps.port.squareApply(
          p.paymentId,
          { invoiceId: target.invoiceId, confirmEventId: target.confirmEventId },
          { idempotencyKey: i },
        ),
      () =>
        (target.confirmEventId ? 'Square reader payment confirmed · ' : 'Recorded on ' + target.label.split(' · ')[0] + ' · ') +
        money(p.totalCents),
      'collect payments',
    )
    if (this.unmounted) return
    if (r.ok) act.renew()
    this.setState({ sqBusy: null })
  }

  private async sqIgnore(p: SquarePaymentToMatch, perms: LivePerms): Promise<void> {
    if (!perms.canCollect) {
      this.flash(deniedTitle('pay.collect'))
      return
    }
    const reason = this.state.sqReasons[p.paymentId]
    if (!reason) {
      this.flash('Pick a reason first')
      return
    }
    if (this.state.sqBusy) return
    const act = this.actionFor('sq-ignore:' + p.paymentId)
    this.setState({ sqBusy: p.paymentId })
    const r = await this.run(
      act,
      (i) => this.deps.port.squareIgnore(p.paymentId, { reason }, { idempotencyKey: i }),
      () => 'Set aside · ' + money(p.totalCents),
      'collect payments',
    )
    if (this.unmounted) return
    if (r.ok) act.renew()
    this.setState({ sqBusy: null })
  }

  /** "Move to another invoice": finds the invoice by its number, then the server voids it here and records it there. */
  private async sqMove(d: InvoiceDetail, eventId: string): Promise<void> {
    if (!can(this.session(), 'pay.void')) {
      this.flash(deniedTitle('pay.void'))
      return
    }
    const e = d.ledger.find((x) => x.id === eventId)
    const no = parseInvoiceNo(this.state.moveTo)
    if (!e?.processorRef) return
    if (no === null) {
      this.setState({ moveError: 'Type the invoice number, like INV-20640.' })
      return
    }
    if (no === d.invoiceNo) {
      this.setState({ moveError: 'It is already on this invoice.' })
      return
    }
    if (this.state.sqBusy) return
    const label = 'INV-' + String(no).padStart(5, '0')
    this.setState({ sqBusy: e.processorRef, moveError: '' })
    let target: InvoiceListRow | undefined
    try {
      const page = await this.deps.port.invoicePage({ range: '30d', q: label })
      target = page.items.find((x) => x.invoiceNo === no)
    } catch (err) {
      this.flash(toastText(toastForError(err)))
    }
    if (this.unmounted) return
    if (!target) {
      this.setState({ sqBusy: null, moveError: 'No invoice ' + label + ' in the last 30 days.' })
      return
    }
    const act = this.actionFor('sq-move:' + e.processorRef + ':' + target.id)
    const r = await this.run(
      act,
      (i) => this.deps.port.squareReassign(e.processorRef!, target!.id, { idempotencyKey: i }),
      () => 'Moved to ' + label + ' · ' + money(e.amountCents),
      'void payments',
    )
    if (this.unmounted) return
    if (r.ok) {
      act.renew()
      this.setState({ sqBusy: null, moveFor: null, moveTo: '', moveError: '', selId: target.id })
    } else this.setState({ sqBusy: null })
  }

  /** DV-904: charge a canceled visit's proposed (or declined) fee on its saved card, after the confirm. */
  private async chargeFee(d: InvoiceDetail, c: CardCharge, perms: LivePerms): Promise<void> {
    if (!perms.canCollect) {
      this.flash(deniedTitle('pay.collect'))
      return
    }
    if (this.state.feeBusy || !d.appointmentId) return
    const act = this.actionFor('fee-charge:' + c.id)
    this.setState({ feeBusy: true })
    const r = await this.run(
      act,
      (i) => this.deps.port.chargeFee(d.appointmentId!, c.id, { idempotencyKey: i }),
      (res) => feeChargeToast(res.charge).title + ' · ' + feeChargeToast(res.charge).desc,
      'collect payments',
    )
    if (this.unmounted) return
    if (r.ok) act.renew()
    this.setState({ feeBusy: false, feeConfirm: null })
  }

  private async waiveFee(d: InvoiceDetail, c: CardCharge, perms: LivePerms): Promise<void> {
    if (!perms.canCollect) {
      this.flash(deniedTitle('pay.collect'))
      return
    }
    const why = this.state.waiveReason.trim()
    if (why.length < 2) {
      this.flash('Say why first')
      return
    }
    if (this.state.feeBusy || !d.appointmentId) return
    const act = this.actionFor('fee-waive:' + c.id)
    this.setState({ feeBusy: true })
    const r = await this.run(
      act,
      (i) => this.deps.port.waiveFee(d.appointmentId!, c.id, why, { idempotencyKey: i }),
      () => 'Fee waived · nothing is charged',
      'collect payments',
    )
    if (this.unmounted) return
    if (r.ok) act.renew()
    this.setState(r.ok ? { feeBusy: false, feeWaive: null, waiveReason: '' } : { feeBusy: false })
  }

  /**
   * DV-910: "Not charged (checked Square)", after the confirm: the server looks the payment up at Square. Found: recorded
   * (the toast says so); none: the charge closes as not charged (a balance: the invoice can be collected again, the Collect
   * sheet that waited on it shows the server's words; a fee: charge it again or waive it). A refusal (Square may still be
   * answering, already handled, Square not answering) is the server's toast and stays on the row in its words.
   */
  private async notCharged(invoiceId: string, c: CardCharge, perms: LivePerms): Promise<void> {
    if (!perms.canCollect) {
      this.flash(deniedTitle('pay.collect'))
      return
    }
    if (this.state.ncBusy) return
    const act = this.actionFor('not-charged:' + c.id)
    this.setState({ ncBusy: true })
    const r = await this.run(
      act,
      (i) => this.deps.port.notCharged(invoiceId, c.id, { idempotencyKey: i }),
      (res) => toastText(notChargedToast(res.charge)),
      'collect payments',
    )
    if (this.unmounted) return
    if (r.ok) {
      act.renew()
      const ch = r.data.charge
      this.setState((st) => {
        const ncNotes = { ...st.ncNotes }
        delete ncNotes[c.id]
        const inSheet = st.cardState?.kind === 'waiting' && st.cardState.charge?.id === c.id
        if (!inSheet) return { ncBusy: false, ncConfirm: null, ncNotes }
        // the Collect sheet that waited on this charge: recorded, it closes; closed as not charged, it is the Collect
        // sheet again with the server's words, the client's OK asked again
        return ch.state === 'charged'
          ? { ncBusy: false, ncConfirm: null, ncNotes, sheet: null, cardState: null }
          : {
              ncBusy: false,
              ncConfirm: null,
              ncNotes,
              f: { ...st.f, cardOk: false },
              cardState: { kind: 'declined', text: ch.error?.trim() || 'Nothing was charged.' },
            }
      })
      return
    }
    const note = notChargedNote(r.error)
    this.setState((st) => ({
      ncBusy: false,
      ncConfirm: null,
      ncNotes: note ? { ...st.ncNotes, [c.id]: note } : st.ncNotes,
    }))
  }

  private async exportCsv(rowCount: number): Promise<void> {
    if (this.exporting) return
    this.exporting = true
    try {
      const { range, filter, query } = this.state
      const file = await this.deps.port.exportCsv({ range, filter, q: query })
      this.deps.download(file)
      this.flash(csvToast(rowCount))
    } catch (e) {
      this.flash(toastText(toastForError(e)))
    } finally {
      this.exporting = false
    }
  }

  openSheet(kind: SheetKind, d: InvoiceDetail | undefined, preset?: Partial<LiveSheetForm>): void {
    this.sheetAction = new Action()
    this.setState({
      sheet: kind,
      f: liveSheetForm({ method: defaultTender(d), ...(preset ?? {}) }, d?.paymentLinkUrl),
      busy: false,
      urlError: null,
      sentLink: null,
      cardState: null,
      ncConfirm: null,
    })
  }

  setF(p: Partial<LiveSheetForm>): void {
    this.setState((s) => ({ f: { ...s.f, ...p }, urlError: null }))
  }

  /** Another tender: the saved card's OK and its last answer start over. */
  private pickTender(method: string): void {
    this.setState((s) => ({ f: { ...s.f, method, cardOk: false }, urlError: null, cardState: null }))
  }

  // ---- the template's values -----------------------------------------------------------------------------------

  renderVals(): Vals {
    const s = this.state
    const chrome = this.deps.chrome()
    const session = chrome?.getSession() ?? null
    const perms = permsOf(session)
    const canView = can(session, 'pay.reports')
    const unlocked = canView

    const summary = unlocked ? this.readSummary(s.range) : undefined
    const rowsData = unlocked ? this.readRows(s.range, s.filter, s.query) : undefined
    // Nothing is selected until the first click: the panel opens on the newest invoice of the list, then keeps showing
    // that invoice whatever the range, filter or search does to the table (the design's selection is sticky too), and
    // does not go blank when the table is empty.
    const selId = s.selId ?? this.shownId ?? rowsData?.[0]?.id ?? null
    this.shownId = selId
    const detail = unlocked && selId ? this.readDetail(selId) : undefined
    const today = summary?.range.to ?? null

    const filters = FILTERS.map(({ key, label }) => {
      const on = s.filter === key
      return {
        label,
        count: filterCountText(summary, key),
        onClick: () => this.setState({ filter: key }),
        style: filterChipStyle(on),
        countStyle: filterCountStyle(on),
      }
    })
    const cats = categoryInfoOfSummary(summary)
    const rows = (rowsData ?? []).map((r) => ({
      ...rowView(r),
      // DV-224: the visit's category chip in the Items cell
      cat: rowCategory(r, cats, s.theme === 'dark'),
      onClick: () => this.setState({ selId: r.id }),
      style: rowStyle(r.id === selId),
    }))
    const first = summary?.pendingApprovals.first ?? null

    const d = detail ? this.detailVals(detail, perms) : emptyDetail()

    let sh: Vals = {}
    const sk = s.sheet
    if (sk && detail) sh = this.sheetVals(sk, detail, perms)
    // DV-805: the Square payments to match (the banner reads the queue; the sheet also reads the reconciliation)
    const toMatch = unlocked ? this.readToMatch() : undefined
    const sq = this.squareVals(toMatch, s.sqOpen ? this.readRecon() : undefined, detail, perms)

    const vals: Vals = {
      theme: s.theme,
      toggleTheme: () => {
        const prev = this.state.theme
        const next: Theme = prev === 'dark' ? 'light' : 'dark'
        this.deps.saveTheme(next)
        this.setState({ theme: next })
        chrome?.themeChanged(next, prev)
      },
      roleName: chrome?.vals().viewAs.label ?? '',
      roleMenu: false,
      toggleRoleMenu: () => {},
      roleOpts: [],
      locked: !canView,
      unlocked,
      ranges: RANGE_BUTTONS.map(([k, l]) => ({
        label: l,
        onClick: () => this.setState({ range: k }),
        style: rangeButtonStyle(s.range === k),
      })),
      rangeLabel: summary?.range.label ?? '',
      exportCsv: () => void this.exportCsv(rows.length),
      kpis: kpiViews(summary),
      bars: barViews(summary),
      methods: methodViews(summary),
      filters,
      rows,
      noRows: rowsData !== undefined && rows.length === 0,
      query: s.query,
      onQuery: (e: InputEvent) => this.setState({ query: e.target.value }),
      hasPending: (summary?.pendingApprovals.count ?? 0) > 0,
      pendingText: pendingText(summary),
      // DV-219: Review also clears the filter and the search, or the invoice would stay hidden behind them
      openPending: () => {
        if (!first || !today) return
        this.setState((st) => ({
          selId: first.invoiceId,
          range: rangeCovering(st.range, today, first.bizDate),
          filter: 'all',
          query: '',
        }))
      },
      d,
      sheetOpen: !!sk && !!detail,
      sh,
      closeSheet: () =>
        this.setState({
          sheet: null,
          busy: false,
          urlError: null,
          sentLink: null,
          cardState: null,
          ncConfirm: null,
        }),
      stop: (e: { stopPropagation(): void }) => e.stopPropagation(),
      toast: s.toast,
    }
    // DV-225: the summary split by category, under the KPI tiles
    const split = categorySplitVMs(summary)
    vals.live = {
      ...(chrome ? chrome.vals() : {}),
      hasCatSplit: unlocked && split.items.length > 0,
      catSplitLabel: split.label,
      catSplit: split.items,
      ...sq,
      ...this.feeVals(detail, perms, session?.businessTz ?? DEFAULT_TZ),
    }
    if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') !== s.theme)
      document.documentElement.setAttribute('data-theme', s.theme)
    return vals
  }

  /**
   * DV-805/DV-806: the banner over the table and the "Square payments to match" sheet (under `live.*`: the design has
   * neither). Each payment lists where it may go (the server's candidates, then the invoice open on screen), the reasons
   * to set it aside, and the sheet ends with the card refunds Square refused and the refunds on their way.
   */
  private squareVals(
    items: SquarePaymentToMatch[] | undefined,
    recon: Reconciliation | undefined,
    open: InvoiceDetail | undefined,
    perms: LivePerms,
  ): Vals {
    const s = this.state
    const list = items ?? []
    const focus = s.sqFocus ? open?.ledger.find((e) => e.id === s.sqFocus) : undefined
    // the entry the sheet was opened for: payments of its amount first
    const ordered = focus
      ? [...list].sort(
          (a, b) => Number(b.amountCents === focus.amountCents) - Number(a.amountCents === focus.amountCents),
        )
      : list
    const close = () => this.setState({ sqOpen: false, sqFocus: null })
    const failed = recon?.square?.failedRefunds ?? []
    return {
      sqHasBanner: list.length > 0,
      sqBanner: toMatchBanner(list),
      sqBannerStyle: bannerStyle,
      sqReview: () => this.setState({ sqOpen: true, sqFocus: null }),
      sqOpen: s.sqOpen,
      sqClose: close,
      sqStop: (e: { stopPropagation(): void }) => e.stopPropagation(),
      sqSub: focus
        ? 'Pick the Square payment for the ' + money(focus.amountCents) + ' reader entry on ' + (open?.label ?? '')
        : 'Counter payments Oasis could not match on its own. Nothing here is counted until you apply it.',
      sqEmpty: list.length === 0,
      sqEmptyText: 'Every Square payment is matched.',
      sqItems: ordered.map((p) => {
        const busy = s.sqBusy === p.paymentId
        const targets = applyTargets(p, open)
        const reason = s.sqReasons[p.paymentId] ?? null
        return {
          line: paymentLine(p),
          meta: paymentMeta(p),
          hasTargets: targets.length > 0,
          noTargets: targets.length === 0,
          targets: targets.map((t) => ({
            label: t.label,
            sub: t.sub,
            apply: () => void this.sqApply(p, t, perms),
            style: applyButtonStyle(perms.canCollect && !busy),
            text: busy ? 'Saving…' : 'Apply',
          })),
          reasons: IGNORE_REASONS.map(([k, label]) => ({
            label,
            onClick: () => this.setState((st) => ({ sqReasons: { ...st.sqReasons, [p.paymentId]: k } })),
            style: chipStyle(reason === k),
          })),
          ignore: () => void this.sqIgnore(p, perms),
          ignoreStyle: applyButtonStyle(perms.canCollect && !!reason && !busy),
        }
      }),
      sqHasFailed: failed.length > 0,
      sqFailed: failed.map((r) => ({
        ...failedRefundLine(r),
        open: () => this.setState({ selId: r.invoiceId, sqOpen: false, sqFocus: null }),
      })),
      sqInFlight: inFlightText(recon),
      sqHasInFlight: !!inFlightText(recon),
    }
  }

  /**
   * DV-904: the no-show or late-cancel fee of a canceled visit, under the invoice's actions (`live.fee*`): the same rows as
   * the appointment file's, so a fee the client's own late cancel proposed is found where the canceled invoice is. DV-910:
   * a balance charge of the invoice waiting for Square is listed there too, and every waiting row offers `pay.collect`
   * "Not charged (checked Square)" (a confirm first).
   */
  private feeVals(det: InvoiceDetail | undefined, perms: LivePerms, tz: string): Vals {
    const s = this.state
    const charges = det ? this.readCharges(det) : undefined
    const today = businessToday(serverNow(), tz)
    const rows = feeRows(charges, tz, today)
    const byId = new Map((charges ?? []).map((c) => [c.id, c]))
    return {
      feeShow: !!det && rows.length > 0,
      feeRows: rows.map((r) => ({
        ...r,
        ...this.notChargedVals(det, r.waiting ? byId.get(r.id) : undefined, perms),
        lineStyle: feeLineStyle(r.tone),
        charge: () => {
          if (!perms.canCollect) return this.flash(deniedTitle('pay.collect'))
          this.setState({ feeConfirm: r.id, feeWaive: null })
        },
        waive: () => {
          if (!perms.canCollect) return this.flash(deniedTitle('pay.collect'))
          this.setState({ feeWaive: r.id, feeConfirm: null, waiveReason: '' })
        },
        confirming: s.feeConfirm === r.id && r.canDecide,
        confirmText: chargeFeeText(r),
        confirm: () => det && void this.chargeFee(det, byId.get(r.id)!, perms),
        waiving: s.feeWaive === r.id && r.canDecide,
        reason: s.feeWaive === r.id ? s.waiveReason : '',
        setReason: (e: InputEvent) => this.setState({ waiveReason: e.target.value }),
        waiveConfirm: () => det && void this.waiveFee(det, byId.get(r.id)!, perms),
        back: () => this.setState({ feeConfirm: null, feeWaive: null }),
      })),
      feeButtonStyle: approveButtonStyle(perms.canCollect && !s.feeBusy),
      feeConfirmBtnStyle: approveButtonStyle(!s.feeBusy),
      ncButtonStyle: approveButtonStyle(!s.ncBusy),
    }
  }

  /**
   * DV-910: the "Not charged (checked Square)" keys of a charge waiting for Square (a row under the invoice's actions, or the
   * Collect sheet that waited on it): shown only with `pay.collect` and an invoice to close it on; a confirm first; the
   * server's words for a refused one under it.
   */
  private notChargedVals(det: InvoiceDetail | undefined, c: CardCharge | undefined, perms: LivePerms): Vals {
    const s = this.state
    const invoiceId = c ? (c.invoiceId ?? det?.id ?? null) : null
    const show = !!c && !!invoiceId && perms.canCollect && isWaitingCharge(c)
    const note = c ? (s.ncNotes[c.id] ?? '') : ''
    return {
      ncShow: show,
      ncLabel: NOT_CHARGED_LABEL,
      ncOpen: () => {
        if (!show || !c) return
        this.setState({ ncConfirm: c.id, feeConfirm: null, feeWaive: null })
      },
      ncConfirming: show && s.ncConfirm === c?.id,
      ncText: NOT_CHARGED_CONFIRM,
      ncConfirm: () => {
        if (show && c && invoiceId) void this.notCharged(invoiceId, c, perms)
      },
      ncBack: () => this.setState({ ncConfirm: null }),
      ncSubmitLabel: s.ncBusy ? 'Checking Square…' : 'Not charged',
      ncHasNote: show && !!note,
      ncNote: show ? note : '',
    }
  }

  private detailVals(det: InvoiceDetail, perms: LivePerms): Vals {
    const s = this.state
    const ledger = liveLedgerEntries(det, perms).map((en) => {
      const id = en.event.id
      const moving = s.moveFor === id
      return {
        ...en.view,
        approve: () => this.approve(det, id),
        deny: () => this.deny(det, id, perms),
        confirm: () => this.confirm(id, en.event.type, perms),
        // DV-804: a waiting Square reader entry opens the queue on its amount
        sqMatchOpen: () => {
          if (!perms.canCollect) {
            this.flash(deniedTitle('pay.collect'))
            return
          }
          this.setState({ sqOpen: true, sqFocus: id })
        },
        // DV-804: a Square payment recorded on the wrong invoice moves to the right one (pay.void)
        sqMoveOpen: moving,
        sqMoveToggle: () => {
          if (!moving && !can(this.session(), 'pay.void')) {
            this.flash(deniedTitle('pay.void'))
            return
          }
          this.setState({ moveFor: moving ? null : id, moveTo: '', moveError: '' })
        },
        sqMoveLabel: moving ? 'Keep it here' : 'Wrong invoice? Move it',
        sqMoveValue: moving ? s.moveTo : '',
        sqMoveInput: (e: InputEvent) => this.setState({ moveTo: e.target.value, moveError: '' }),
        sqMoveSubmit: () => void this.sqMove(det, id),
        sqMoveError: moving ? s.moveError : '',
        sqHasMoveError: moving && !!s.moveError,
        sqMoveStyle: approveButtonStyle(!s.sqBusy),
        // DV-902: Square's receipt page, opened without an opener
        sqReceiptOpen: () => {
          if (en.view.sqReceiptUrl) this.deps.openUrl(en.view.sqReceiptUrl)
        },
      }
    })
    return {
      ...headerView(det),
      big: bigNumberViews(det),
      lines: lineViews(det),
      actions: actionSpecs(det, perms).map((a) => ({
        label: a.label,
        onClick:
          a.kind === 'receipt'
            ? () => this.receipt(det, perms)
            : () => this.openSheet(a.kind as SheetKind, det),
        disabled: !a.ok,
        why: a.why,
        style: a.style,
      })),
      ledger,
      creditLine: creditLineText(det),
    }
  }

  private sheetVals(sk: SheetKind, det: InvoiceDetail, perms: LivePerms): Vals {
    const f = this.state.f
    const calc = liveSheetCalc({ kind: sk, f, d: det, p: perms })
    const busy = this.state.busy
    const blocked = calc.blocked || busy
    let sh: Vals = {}
    if (sk === 'refund') {
      const items = det.items.map((it, i) => ({ it, i })).filter((x) => !x.it.refunded)
      sh = {
        isRefund: true,
        title: 'Refund',
        sub: det.label + ' · ' + det.client,
        modes: (
          [
            ['full', 'Full'],
            ['items', 'By item'],
            ['custom', 'Custom'],
          ] as const
        ).map(([k, l]) => ({ label: l, onClick: () => this.setF({ mode: k }), style: seg(f.mode === k) })),
        byItems: f.mode === 'items',
        byCustom: f.mode === 'custom',
        itemRows: items.map(({ it, i }) => {
          const on = f.items.includes(i)
          return {
            label: it.name,
            value: moneyCentsWithTax(it.priceCents, det.taxBp),
            on,
            onClick: () => this.setF({ items: on ? f.items.filter((x) => x !== i) : [...f.items, i] }),
            style: itemRowStyle(on),
            box: itemBoxStyle(on),
          }
        }),
        dests: (
          [
            ['card', 'Original payment'],
            ['credit', 'Store credit'],
            ['cash', 'Cash'],
          ] as const
        ).map(([k, l]) => ({ label: l, onClick: () => this.setF({ dest: k }), style: seg(f.dest === k) })),
      }
    }
    if (sk === 'adjust') {
      sh = {
        isAdjust: true,
        title: 'Adjust invoice',
        sub: det.label + ' · applied before tax',
        kinds: (
          [
            ['discount', 'Discount'],
            ['surcharge', 'Surcharge'],
          ] as const
        ).map(([k, l]) => ({
          label: l,
          onClick: () => this.setF({ kind: k, reason: null }),
          style: seg(f.kind === k),
        })),
        units: (
          [
            ['$', '$'],
            ['%', '%'],
          ] as const
        ).map(([k, l]) => ({
          label: l,
          onClick: () => this.setF({ unit: k }),
          style: unitSeg(f.unit === k),
        })),
        valueLabel: adjustValueLabel(f),
        showSettle: calc.showSettle,
        settleLabel: 'Invoice is already paid — return the difference as',
        settles: (
          [
            ['credit', 'Store credit'],
            ['card', 'Refund to card'],
          ] as const
        ).map(([k, l]) => ({
          label: l,
          onClick: () => this.setF({ settle: k }),
          style: seg(f.settle === k),
        })),
      }
    }
    if (sk === 'credit') {
      sh = {
        isCredit: true,
        title: 'Issue account credit',
        sub: det.client + ' · linked to ' + det.label,
        expiries: ['No expiry', '90 days', '30 days'].map((k) => ({
          label: k,
          onClick: () => this.setF({ expiry: k }),
          style: seg(f.expiry === k),
        })),
      }
    }
    if (sk === 'collect') {
      sh = {
        isCollect: true,
        title: 'Collect payment',
        sub: det.label + ' · ' + det.client,
        // DV-802: Square reader / Cash / Payment link once Square takes card money; DV-901: Saved card when the server
        // names a usable card
        payMethods: collectTenderList(det.processing).map((k) => ({
          label: k,
          onClick: () => this.pickTender(k),
          style: seg(f.method === k),
        })),
      }
    }
    if (sk === 'apply') sh = { title: 'Apply store credit', sub: det.client }
    const req = calc.request
    const cs = sk === 'collect' ? this.state.cardState : null
    // DV-910: a charge Square did not answer may be closed from the sheet that waited on it, once Square shows no payment
    const nc = this.notChargedVals(det, cs?.kind === 'waiting' ? cs.charge : undefined, perms)
    // DV-901: the saved card's step: the client's OK (a tick box with the amount and the card), then the server's answer
    const sc: Vals = {
      scShow: !!calc.savedCard && cs?.kind !== 'waiting',
      scOk: f.cardOk,
      scOkText: calc.savedCard?.okText ?? '',
      scToggle: () => this.setState((st) => ({ f: { ...st.f, cardOk: !st.f.cardOk }, cardState: null })),
      scBoxStyle: itemBoxStyle(f.cardOk),
      scRowStyle: { ...itemRowStyle(f.cardOk), width: '100%', textAlign: 'left' },
      scDeclined: cs?.kind === 'declined',
      scDeclineText: cs?.kind === 'declined' ? cs.text : '',
      scWaiting: cs?.kind === 'waiting',
      scWaitingText: cs?.kind === 'waiting' ? cs.text : '',
      scNcShow: nc.ncShow,
      scNcLabel: nc.ncLabel,
      scNcOpen: nc.ncOpen,
      scNcConfirming: nc.ncConfirming,
      scNcText: nc.ncText,
      scNcConfirm: nc.ncConfirm,
      scNcBack: nc.ncBack,
      scNcSubmitLabel: nc.ncSubmitLabel,
      scNcHasNote: nc.ncHasNote,
      scNcNote: nc.ncNote,
      scNcBtnStyle: approveButtonStyle(!this.state.ncBusy),
    }
    if (cs?.kind === 'waiting')
      return {
        ...sh,
        ...sc,
        hasSentLink: false,
        sentLink: '',
        copyLink: () => undefined,
        needsUrl: false,
        urlRaw: '',
        setUrl: () => undefined,
        urlError: '',
        hasUrlError: false,
        summary: calc.summary,
        blocked: false,
        submit: () => this.setState({ sheet: null, cardState: null, ncConfirm: null }),
        submitLabel: 'Done',
        hasReasons: false,
        amountRaw: '',
        note: '',
        setAmount: () => undefined,
        setNote: () => undefined,
        reasons: [],
        permText: 'Square has not answered yet. You can close this: the invoice updates by itself.',
        permStyle: permBoxStyle(false),
        submitStyle: submitStyle(false, sk),
      }
    // DV-802: the Square link the server made stays on screen with Copy; the button then closes the sheet
    const sent = sk === 'collect' ? this.state.sentLink : null
    if (sent)
      return {
        ...sh,
        ...sc,
        needsUrl: false,
        urlRaw: '',
        setUrl: () => undefined,
        urlError: '',
        hasUrlError: false,
        hasSentLink: true,
        sentLink: sent,
        copyLink: () => {
          this.deps.copy(sent).then(
            () => this.flash('Link copied'),
            () => this.flash('Copy did not work · select the link and copy it'),
          )
        },
        summary: calc.summary,
        blocked: false,
        submit: () => this.setState({ sheet: null, sentLink: null }),
        submitLabel: 'Done',
        hasReasons: false,
        amountRaw: '',
        note: '',
        setAmount: () => undefined,
        setNote: () => undefined,
        reasons: [],
        // F2: says whether the link was texted (the client may have opted out or have no phone)
        permText: this.state.sentNote,
        permStyle: permBoxStyle(this.state.sentTexted),
        submitStyle: submitStyle(false, sk),
      }
    return {
      ...sh,
      ...sc,
      hasSentLink: false,
      sentLink: '',
      copyLink: () => undefined,
      needsUrl: calc.needsUrl,
      urlRaw: f.url,
      setUrl: (e: InputEvent) => this.setF({ url: e.target.value }),
      urlError: this.state.urlError ?? '',
      hasUrlError: !!this.state.urlError,
      summary: calc.summary,
      blocked,
      submit: () => {
        if (req && !blocked) void this.submitSheet(sk, det, req, perms)
      },
      submitLabel: calc.submitLabel,
      hasReasons: calc.reasons.length > 0,
      amountRaw: f.amount,
      note: f.note,
      setAmount: (e: InputEvent) => this.setF({ amount: e.target.value }),
      setNote: (e: InputEvent) => this.setF({ note: e.target.value }),
      reasons: calc.reasons.map((r) => ({
        label: r,
        onClick: () => this.setF({ reason: r }),
        style: chip(calc.reason === r),
      })),
      permText: calc.permText,
      permStyle: permBoxStyle(calc.permOk),
      submitStyle: submitStyle(blocked, sk),
    }
  }
}

/** Refund-by-item row value: the item's price with the invoice's tax (what the server refunds for that line). */
const moneyCentsWithTax = (priceCents: number, taxBp: number): string =>
  money(divHalfUp(priceCents * (10_000 + taxBp), 10_000))

function emptyDetail(): Vals {
  return {
    id: '',
    when: '',
    client: '',
    vehicle: '',
    staff: '',
    status: '',
    statusStyle: invoicePill(''),
    big: [],
    lines: [],
    actions: [],
    ledger: [],
    creditLine: '',
  }
}

/** The constructor DCHost instantiates: the live view model bound to its dependencies. */
export function createLivePaymentsLogic(make: () => LiveDeps = defaultLiveDeps): DCLogicCtor {
  return class extends LivePaymentsLogic {
    constructor(props?: Record<string, unknown>) {
      super(props, make())
    }
  }
}
