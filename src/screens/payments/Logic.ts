// Typed view model of the Payments screen: a port of the design's `class Component extends DCLogic`
// (design/extracted/payments/logic.original.js) with identical renderVals() output, key order and setState semantics.
// The data it starts from comes through PaymentsData, every formula lives in src/lib/payments, and what stays here is
// the wiring: state, handlers, toast timer, theme and the live-variant chrome. docs/screens-payments.md maps each
// member to its original.
import { DCLogic } from '@/dc/DCLogic'
import type { DCLogicCtor } from '@/dc/types'
import { LIVE } from '@/data/env'
import type { LiveChrome } from '@/auth/chrome'
import { moneyCents, moneyWhole0, r2 } from '@/lib/money'
import { invoicePill } from '@/lib/color'
import {
  FILTERS,
  RANGE_BUTTONS,
  RANGE_WINDOWS,
  bigNumbers,
  calcInvoice,
  calcSheet,
  canViewReports,
  chartBars,
  chip,
  clientCredit,
  creditLine,
  dateOf,
  defaultSheetForm,
  detailHeader,
  filterChipStyle,
  filterCount,
  filterCountStyle,
  fmtDate,
  invoiceActions,
  invoiceLines,
  invoiceRowView,
  invoicesInRange,
  itemBoxStyle,
  itemRefundValue,
  itemRowStyle,
  kpiCards,
  ledgerEntries,
  limitFor,
  methodBars,
  pendingApprovals,
  permBoxStyle,
  rangeButtonStyle,
  rangeForPending,
  roleMenuLimit,
  roleName,
  roleOptionStyle,
  rowStyle,
  seg,
  submitStyle,
  unitSeg,
  visibleInvoices,
  adjustValueLabel,
} from '@/lib/payments'
import type {
  FilterKey,
  Invoice,
  InvoiceCalc,
  LedgerEvent,
  LimitKind,
  RangeKey,
  RolesConfig,
  SheetForm,
  SheetKind,
  StyleObject,
  Theme,
} from '@/lib/payments'
import type { PaymentsData } from './data'

export interface PaymentsState {
  theme: Theme
  rc: RolesConfig
  role: string
  roleMenu: boolean
  txs: Invoice[]
  range: RangeKey
  filter: FilterKey
  query: string
  selId: string
  sheet: SheetKind | null
  f: SheetForm
  toast: string | null
}

type Vals = Record<string, unknown>
type InputEvent = { target: { value: string } }

const TOAST_MS = 3000

export class PaymentsLogic extends DCLogic<PaymentsState> {
  readonly data: PaymentsData
  private toastTimer: ReturnType<typeof setTimeout> | undefined
  private liveOff: (() => void) | null = null

  constructor(props: Record<string, unknown> | undefined, data: PaymentsData) {
    super(props)
    this.data = data
    const seed = data.seed()
    this.state = {
      theme: seed.theme,
      rc: seed.roles,
      role: seed.role,
      roleMenu: false,
      txs: seed.invoices,
      range: '7d',
      filter: 'all',
      query: '',
      selId: seed.selectedId,
      sheet: null,
      f: {} as SheetForm,
      toast: null,
    }
  }

  r2(n: number): number {
    return r2(n)
  }
  money(n: number): string {
    return moneyCents(n)
  }
  money0(n: number): string {
    return moneyWhole0(n)
  }
  calc(tx: Invoice): InvoiceCalc {
    return calcInvoice(tx)
  }
  clientCredit(name: string): number {
    return clientCredit(this.state.txs, name)
  }
  lim(kind: LimitKind, role?: string) {
    return limitFor(this.state.rc, role || this.state.role, kind)
  }
  roleName(id: string): string {
    return roleName(this.state.rc, id)
  }
  nowT(): string {
    return this.data.stampNow()
  }
  flash(t: string): void {
    this.setState({ toast: t })
    clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => this.setState({ toast: null }), TOAST_MS)
  }
  addEvent(id: string, ev: Omit<LedgerEvent, 't' | 'by'> & Partial<Pick<LedgerEvent, 't' | 'by'>>): void {
    this.setState((s) => ({
      txs: s.txs.map((t) =>
        t.id === id ? { ...t, events: [...t.events, { t: this.nowT(), by: 'Rafael M.', ...ev }] } : t,
      ),
    }))
  }
  dateOf(off: number): Date {
    return dateOf(this.data.today, off)
  }
  fmtDate(off: number): string {
    return fmtDate(this.data.today, off)
  }
  pill(st: string): StyleObject {
    return invoicePill(st)
  }
  seg(on: boolean): StyleObject {
    return seg(on)
  }
  chip(on: boolean): StyleObject {
    return chip(on)
  }
  openSheet(kind: SheetKind, preset?: Partial<SheetForm>): void {
    this.setState({ sheet: kind, f: defaultSheetForm(preset) })
  }
  setF(p: Partial<SheetForm>): void {
    this.setState((s) => ({ f: { ...s.f, ...p } }))
  }

  private chrome(): LiveChrome | null {
    return (LIVE && typeof window !== 'undefined' && window.__oasisLive) || null
  }

  componentDidMount(): void {
    const c = this.chrome()
    if (c) {
      const offs = [
        c.subscribe(() => this.forceUpdate()),
        c.subscribeToasts((t) => this.flash(t.desc ? t.title + ' · ' + t.desc : t.title)),
      ]
      this.liveOff = () => offs.forEach((off) => off())
    }
  }

  componentWillUnmount(): void {
    if (this.liveOff) {
      this.liveOff()
      this.liveOff = null
    }
    clearTimeout(this.toastTimer)
  }

  renderVals(): Vals {
    const s = this.state
    const dark = s.theme === 'dark'
    const canView = canViewReports(s.rc, s.role)
    const anchor = this.data.today
    const inR = invoicesInRange(s.txs, RANGE_WINDOWS[s.range])
    const kpis = kpiCards(inR)
    const bars = chartBars(inR, s.range, anchor)
    const methods = methodBars(inR)
    const filters = FILTERS.map(({ key, label }) => {
      const on = s.filter === key
      return {
        label,
        count: String(filterCount(inR, key)),
        onClick: () => this.setState({ filter: key }),
        style: filterChipStyle(on),
        countStyle: filterCountStyle(on),
      }
    })
    const rows = visibleInvoices(inR, s.filter, s.query).map((x) => ({
      ...invoiceRowView(x, anchor),
      onClick: () => this.setState({ selId: x.t.id }),
      style: rowStyle(x.t.id === s.selId),
    }))
    const allPending = pendingApprovals(s.txs)

    const tx = s.txs.find((t) => t.id === s.selId) || s.txs[0]!
    const c = calcInvoice(tx)
    const credit = clientCredit(s.txs, tx.client)
    const actions = invoiceActions(tx, c, credit, s.rc, s.role).map((a) => {
      const kind = a.kind
      return {
        label: a.label,
        onClick:
          kind === 'receipt'
            ? () => this.flash('Receipt sent to ' + tx.client + ' via WhatsApp + email')
            : () => this.openSheet(kind),
        disabled: !a.ok,
        why: a.why,
        style: a.style,
      }
    })
    const ledger = ledgerEntries(tx, s.rc, s.role)
      .map(({ view, canApprove, index: i, event: e }) => ({
        ...view,
        approve: () => {
          if (!canApprove) {
            this.flash('Your role can’t approve ' + this.money(e.amt))
            return
          }
          this.setState((st) => ({
            txs: st.txs.map((t) =>
              t.id !== tx.id
                ? t
                : {
                    ...t,
                    events: t.events.map((x, j) =>
                      j === i
                        ? { ...x, status: 'done', approvedBy: 'Rafael M. · ' + this.roleName(s.role) }
                        : x,
                    ),
                  },
            ),
          }))
          this.flash(
            'Refund approved · ' +
              this.money(e.amt) +
              ' to ' +
              (e.dest === 'credit' ? 'store credit' : e.method),
          )
        },
        deny: () => {
          this.setState((st) => ({
            txs: st.txs.map((t) =>
              t.id !== tx.id
                ? t
                : { ...t, events: t.events.map((x, j) => (j === i ? { ...x, status: 'denied' } : x)) },
            ),
          }))
          this.flash('Refund request denied')
        },
      }))
      .reverse()
    const d = {
      ...detailHeader(tx, c, anchor),
      big: bigNumbers(c),
      lines: invoiceLines(tx, c),
      actions,
      ledger,
      creditLine: creditLine(tx, credit),
    }

    const f = s.f
    const sk = s.sheet
    let sh: Vals = {}
    if (sk) {
      const calc = calcSheet({ kind: sk, f, tx, c, credit, rc: s.rc, role: s.role })
      const plan = calc.plan
      const submit = () => {
        if (!plan) return
        plan.events.forEach((ev) => this.addEvent(tx.id, ev))
        this.setState({ sheet: null })
        this.flash(plan.toast)
      }
      if (sk === 'refund') {
        sh = {
          isRefund: true,
          title: 'Refund',
          sub: tx.id + ' · ' + tx.client,
          modes: (
            [
              ['full', 'Full'],
              ['items', 'By item'],
              ['custom', 'Custom'],
            ] as const
          ).map(([k, l]) => ({ label: l, onClick: () => this.setF({ mode: k }), style: seg(f.mode === k) })),
          byItems: f.mode === 'items',
          byCustom: f.mode === 'custom',
          itemRows: tx.items.map((it, i) => {
            const on = f.items.includes(i)
            return {
              label: it.name,
              value: itemRefundValue(it.price),
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
          sub: tx.id + ' · applied before tax',
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
          sub: tx.client + ' · linked to ' + tx.id,
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
          sub: tx.id + ' · ' + tx.client,
          payMethods: ['Card on file', 'Cash', 'Payment link'].map((k) => ({
            label: k,
            onClick: () => this.setF({ method: k }),
            style: seg(f.method === k),
          })),
        }
      }
      if (sk === 'apply') sh = { title: 'Apply store credit', sub: tx.client }
      sh = {
        ...sh,
        summary: calc.summary,
        blocked: calc.blocked,
        submit,
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
        submitStyle: submitStyle(calc.blocked, sk),
      }
    }

    const base = () => {
      const t: Theme = dark ? 'light' : 'dark'
      this.data.saveTheme(t)
      this.setState({ theme: t })
    }
    const chrome = this.chrome()
    const toggleTheme = chrome
      ? () => {
          const prev = this.state.theme
          base()
          const next = this.state.theme
          if (next !== prev) chrome.themeChanged(next, prev)
        }
      : base

    const vals: Vals = {
      theme: s.theme,
      toggleTheme,
      roleName: this.roleName(s.role),
      roleMenu: s.roleMenu,
      toggleRoleMenu: () => this.setState({ roleMenu: !s.roleMenu }),
      roleOpts: s.rc.roles.map((r) => ({
        name: r.name,
        lim: roleMenuLimit(s.rc, r.id),
        onClick: () => this.setState({ role: r.id, roleMenu: false }),
        style: roleOptionStyle(s.role === r.id),
      })),
      locked: !canView,
      unlocked: canView,
      ranges: RANGE_BUTTONS.map(([k, l]) => ({
        label: l,
        onClick: () => this.setState({ range: k }),
        style: rangeButtonStyle(s.range === k),
      })),
      rangeLabel: this.data.rangeLabels[s.range],
      exportCsv: () => this.flash('CSV export started · ' + inR.length + ' invoices'),
      kpis,
      bars,
      methods,
      filters,
      rows,
      noRows: rows.length === 0,
      query: s.query,
      onQuery: (e: InputEvent) => this.setState({ query: e.target.value }),
      hasPending: allPending.length > 0,
      pendingText: allPending.length
        ? allPending.length +
          ' refund awaiting approval — ' +
          this.money(allPending[0]!.e.amt) +
          ' · ' +
          allPending[0]!.t.client +
          ' · requested by ' +
          allPending[0]!.e.by
        : '',
      openPending: () => {
        const p = allPending[0]
        if (p) this.setState({ selId: p.t.id, range: rangeForPending(s.range, p.t.off) })
      },
      d,
      sheetOpen: !!sk,
      sh,
      closeSheet: () => this.setState({ sheet: null }),
      stop: (e: { stopPropagation(): void }) => e.stopPropagation(),
      toast: s.toast,
    }
    if (LIVE) {
      vals.live = chrome ? chrome.vals() : {}
      if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') !== s.theme)
        document.documentElement.setAttribute('data-theme', s.theme)
    }
    return vals
  }
}

/** The constructor DCHost instantiates: the view model bound to its data source. */
export function createPaymentsLogic(data: PaymentsData): DCLogicCtor {
  return class extends PaymentsLogic {
    constructor(props?: Record<string, unknown>) {
      super(props, data)
    }
  }
}
