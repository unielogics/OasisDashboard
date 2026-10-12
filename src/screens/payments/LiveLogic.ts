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
  applyTargets,
  bannerStyle,
  chipStyle,
  collectTenders,
  failedRefundLine,
  inFlightText,
  parseInvoiceNo,
  paymentLine,
  paymentMeta,
  processorOf,
  toMatchBanner,
} from '@/lib/payments/square'
import { toastForError, toastText } from '@/data/toast'
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
      sqOpen: false,
      sqFocus: null,
      sqReasons: {},
      sqBusy: null,
      moveFor: null,
      moveTo: '',
      moveError: '',
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
    }
    if (this.unmounted) return
    if (res.ok) {
      act.renew()
      // DV-802: a Square link the server made (pay links off) stays on screen with Copy; a texted personal link never shows
      const link =
        req.kind === 'collect' && processorOf(d) === 'square'
          ? ((res.data as CollectResult).paymentLink?.url ?? null)
          : null
      if (link) this.setState({ busy: false, urlError: null, sentLink: link })
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
    })
  }

  setF(p: Partial<LiveSheetForm>): void {
    this.setState((s) => ({ f: { ...s.f, ...p }, urlError: null }))
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
      closeSheet: () => this.setState({ sheet: null, busy: false, urlError: null, sentLink: null }),
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
        // DV-802: Square reader / Cash / Payment link once Square takes card money
        payMethods: collectTenders(processorOf(det)).map((k) => ({
          label: k,
          onClick: () => this.setF({ method: k }),
          style: seg(f.method === k),
        })),
      }
    }
    if (sk === 'apply') sh = { title: 'Apply store credit', sub: det.client }
    const req = calc.request
    // DV-802: the Square link the server made stays on screen with Copy; the button then closes the sheet
    const sent = sk === 'collect' ? this.state.sentLink : null
    if (sent)
      return {
        ...sh,
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
        permText: 'Link texted. It is for exactly ' + money(det.calc.balance) + '.',
        permStyle: permBoxStyle(true),
        submitStyle: submitStyle(false, sk),
      }
    return {
      ...sh,
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
