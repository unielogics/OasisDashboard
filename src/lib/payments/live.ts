// The live Payments screen's view builders: pure functions from the ledger API's DTOs (integer cents, server-computed
// totals, labels from the server) to the strings, flags and style objects the template binds. Nothing here recomputes a
// balance from raw events: the figures on screen are the server's. The only arithmetic is the sheet PREVIEW (cents.ts).
// Wording is the design's; the places where the live screen differs are tagged DV-2xx (design-patches/DEVIATIONS.md).
import type {
  AdjustInput,
  CollectInput,
  CreditInput,
  InvoiceDetail,
  InvoiceFilter,
  InvoiceListRow,
  LedgerEvent,
  PaymentRange,
  PaymentsSummary,
  RefundInput,
  CollectResult,
  AdjustResult,
  EventResult,
  ReceiptResult,
} from '../../data/ports/payments'
import { invoicePill } from '../color'
import { addDays } from '../tz'
import { adjustPreview, itemsRefundValue, money, money0, parseCents, parsePercentBp, taxLabel } from './cents'
import {
  actionStyle,
  approveButtonStyle,
  ledgerDotStyle,
  lineStyles,
  lossBarStyle,
  methodBarStyle,
  netBarStyle,
} from './styles'
import type { LineKind } from './styles'
import { reasonsFor } from './sheet'
import type { SheetForm } from './sheet'
import type { Bar, Kpi, MethodBar } from './summary'
import type { InvoiceRowView } from './filters'
import type { ActionSpec, BigNumber, LedgerView, LineView } from './invoice'
import type { SheetKind, StyleObject } from './types'

// ---- permissions as the screen sees them (from the session; the server enforces the same) --------------------------

export interface MoneyLimit {
  has: boolean
  /** Per-transaction cap in cents; Infinity = no limit. */
  maxCents: number
}

export interface LivePerms {
  /** The names of the effective roles ("Management + Accounting"; the viewed role under view-as). */
  roleLabel: string
  canCollect: boolean
  /** msg.send or pay.collect: who may send a receipt. */
  canReceipt: boolean
  refund: MoneyLimit
  adjust: MoneyLimit
  credit: MoneyLimit
}

export const NO_PERMS: LivePerms = {
  roleLabel: '',
  canCollect: false,
  canReceipt: false,
  refund: { has: false, maxCents: 0 },
  adjust: { has: false, maxCents: 0 },
  credit: { has: false, maxCents: 0 },
}

/** "no limit" or "$1,000 limit" (the sheets' permission text). */
export const limitLabel = (l: MoneyLimit): string =>
  l.maxCents === Infinity ? 'no limit' : money0(l.maxCents) + ' limit'

/** "1 invoice" / "2 invoices". */
export const plural = (n: number, one: string, many: string = one + 's'): string =>
  n + ' ' + (n === 1 ? one : many)

// ---- summary ------------------------------------------------------------------------------------------------------

const DASH = '—'

/** The six KPI cards. DV-210: singular forms; "Credits issued" counts distinct clients (the label says so). */
export function kpiViews(s: PaymentsSummary | undefined): Kpi[] {
  const k = s?.kpis
  const c = k?.counts
  return [
    {
      label: 'Gross sales',
      value: k ? money0(k.grossSales) : DASH,
      sub: c ? plural(c.invoices, 'invoice') : '',
      color: 'var(--ink)',
    },
    {
      label: 'Net revenue',
      value: k ? money0(k.netRevenue) : DASH,
      sub: 'after refunds & discounts',
      color: 'var(--accentInk)',
    },
    {
      label: 'Refunds',
      value: k ? money0(k.refunds) : DASH,
      sub: c ? c.refunded + ' refunded' : '',
      color: k && k.refunds ? 'var(--red)' : 'var(--ink)',
    },
    {
      label: 'Adjustments',
      value: k ? money0(k.adjustments) : DASH,
      sub: c ? plural(c.adjusted, 'invoice') : '',
      color: 'var(--ink)',
    },
    {
      label: 'Credits issued',
      value: k ? money0(k.creditsIssued) : DASH,
      sub: c ? plural(c.creditClients, 'client') : '',
      color: 'var(--ink)',
    },
    {
      label: 'Outstanding',
      value: k ? money0(k.outstanding) : DASH,
      sub: c ? plural(c.openBalances, 'open balance') : '',
      color: k && k.outstanding ? 'var(--amber)' : 'var(--ink)',
    },
  ]
}

/** Chart bars from the server's buckets (labels and tooltips are the server's, in the business timezone). */
export function barViews(s: PaymentsSummary | undefined): Bar[] {
  if (!s) return []
  const mx = Math.max(1, s.chart.maxCents)
  return s.chart.buckets.map((b) => ({
    label: b.label,
    title: b.title + ' · net ' + money0(b.netCents),
    netStyle: netBarStyle(b.netCents, mx),
    lossStyle: lossBarStyle(b.lossCents, mx),
  }))
}

/** Collected by method. DV-211: an "Other" row appears only when something was collected that way. */
export function methodViews(s: PaymentsSummary | undefined): MethodBar[] {
  const m = s?.byMethod
  const rows: Array<[string, number]> = [
    ['Card', m?.card ?? 0],
    ['Apple Pay', m?.applePay ?? 0],
    ['Cash', m?.cash ?? 0],
    ['Store credit', m?.storeCredit ?? 0],
  ]
  if (m && m.other !== 0) rows.push(['Other', m.other])
  const mx = Math.max(1, ...rows.map(([, v]) => v))
  return rows.map(([label, v]) => ({
    label,
    value: s ? money0(v) : DASH,
    barStyle: methodBarStyle(label, v, mx),
  }))
}

export const filterCountText = (s: PaymentsSummary | undefined, key: InvoiceFilter): string =>
  s ? String(s.filterCounts[key]) : ''

// ---- the invoice table ---------------------------------------------------------------------------------------------

/**
 * The status text of an invoice: the server's label, except that card money still waiting on Squarespace reads
 * "Payment pending" / "Refund pending" (DV-212). An approval-pending refund already says "Refund pending".
 */
export function statusText(r: {
  statusLabel: string
  refundPending: boolean
  awaiting: 'payment' | 'refund' | null
}): string {
  if (r.refundPending) return 'Refund pending'
  if (r.awaiting === 'refund') return 'Refund pending'
  if (r.awaiting === 'payment') return 'Payment pending'
  return r.statusLabel
}

/** Pending states borrow the "Partially paid" amber, as the design does for a pending refund. */
export const statusPill = (text: string, statusLabel: string): StyleObject =>
  text === 'Refund pending' || text === 'Payment pending'
    ? invoicePill('Partially paid')
    : invoicePill(statusLabel)

export function rowView(r: InvoiceListRow): InvoiceRowView {
  const text = statusText(r)
  return {
    id: r.label,
    date: r.date + ' · ' + r.time,
    client: r.client,
    vehicle: r.vehicle,
    items: r.items.first + (r.items.more > 0 ? ' +' + r.items.more : ''),
    total: money(r.totalCents),
    status: text,
    adjusted: r.adjusted,
    statusStyle: statusPill(text, r.statusLabel),
  }
}

/** Which range to show so an invoice of `bizDate` is in the table: the current one when it covers it, else the narrowest. */
export function rangeCovering(current: PaymentRange, today: string, bizDate: string): PaymentRange {
  const first: Record<PaymentRange, string> = {
    today,
    '7d': addDays(today, -6),
    '30d': addDays(today, -29),
    mtd: today.slice(0, 8) + '01',
  }
  const covers = (r: PaymentRange): boolean => bizDate >= first[r] && bizDate <= today
  if (covers(current)) return current
  for (const r of ['7d', 'mtd', '30d'] as const) if (covers(r)) return r
  return '30d'
}

// ---- the detail panel ----------------------------------------------------------------------------------------------

export interface DetailHeaderView {
  id: string
  when: string
  client: string
  vehicle: string
  staff: string
  status: string
  statusStyle: StyleObject
}

export function headerView(d: InvoiceDetail): DetailHeaderView {
  const text = statusText({
    statusLabel: d.statusLabel,
    refundPending: d.refundPending,
    awaiting:
      d.awaitingProcessorCount > 0
        ? d.ledger.some((e) => e.awaitingProcessor && e.type === 'refund')
          ? 'refund'
          : 'payment'
        : null,
  })
  return {
    id: d.label,
    when: d.when,
    client: d.client,
    vehicle: d.vehicle,
    staff: d.staff,
    status: text,
    statusStyle: statusPill(text, d.statusLabel),
  }
}

export function bigNumberViews(d: InvoiceDetail): BigNumber[] {
  const c = d.calc
  return [
    { label: 'Total', value: money(c.total), color: 'var(--ink)' },
    { label: 'Collected', value: money(c.paid - c.refunded), color: 'var(--accentInk)' },
    c.balance > 0
      ? { label: 'Balance due', value: money(c.balance), color: 'var(--red)' }
      : { label: 'Refundable', value: money(c.refundable), color: 'var(--ink)' },
  ]
}

const line = (label: string, value: string, kind?: LineKind): LineView => ({
  label,
  value,
  ...lineStyles(kind),
})

/** The breakdown: items, adjustments, tax (DV-213: the invoice's own rate), tip, total, credit, paid, refunded. */
export function lineViews(d: InvoiceDetail): LineView[] {
  const c = d.calc
  return [
    ...d.items.map((i) => line(i.name, money(i.priceCents))),
    ...d.adjustments.map((a) =>
      line(
        (a.amountCents < 0 ? 'Discount · ' : 'Surcharge · ') + (a.reason ?? ''),
        money(a.amountCents),
        a.amountCents < 0 ? 'neg' : null,
      ),
    ),
    line('Tax (' + taxLabel(d.taxBp) + ')', money(c.tax)),
    ...(c.tip ? [line('Tip', money(c.tip))] : []),
    line('Total', money(c.total), 'total'),
    ...(c.creditApplied ? [line('Store credit applied', money(-c.creditApplied), 'pos')] : []),
    line('Paid', money(c.paidOrig)),
    ...(c.refunded ? [line('Refunded', money(-c.refunded), 'neg')] : []),
  ]
}

export type LiveActionKind = SheetKind | 'receipt'

export interface LiveActionSpec extends Omit<ActionSpec, 'kind'> {
  kind: LiveActionKind
}

const action = (
  kind: LiveActionKind,
  label: string,
  ok: boolean,
  why: string,
  primary = false,
): LiveActionSpec => ({ kind, label, ok, why: ok ? '' : why, primary, style: actionStyle(ok, primary) })

/** The invoice's buttons in display order with the design's disabled reasons (title tooltips). */
export function actionSpecs(d: InvoiceDetail, p: LivePerms): LiveActionSpec[] {
  const c = d.calc
  const credit = d.clientCredit.balanceCents
  const out: LiveActionSpec[] = []
  if (c.balance > 0)
    out.push(
      action('collect', 'Collect ' + money(c.balance), p.canCollect, 'Role can’t collect payments', true),
    )
  if (c.balance > 0 && credit > 0)
    out.push(
      action(
        'apply',
        'Apply ' + money(Math.min(credit, c.balance)) + ' credit',
        p.canCollect,
        'Role can’t collect payments',
      ),
    )
  out.push(
    action(
      'refund',
      'Refund',
      p.refund.has && c.refundable > 0,
      p.refund.has ? 'Nothing left to refund' : 'Role can’t issue refunds',
    ),
  )
  out.push(action('adjust', 'Adjust', p.adjust.has && !d.canceled, 'Role can’t adjust invoices'))
  out.push(action('credit', 'Issue credit', p.credit.has, 'Role can’t issue credits'))
  out.push(action('receipt', 'Send receipt', true, ''))
  return out
}

export const creditLineText = (d: InvoiceDetail): string =>
  d.clientCredit.balanceCents > 0
    ? d.client.split(' ')[0] + ' has ' + money(d.clientCredit.balanceCents) + ' in store credit'
    : ''

const GLYPH: Record<string, string> = {
  pay: '$',
  adjust: '±',
  refund: '↩',
  credit_issue: '+',
  credit_apply: '◆',
  void: '×',
}

export interface LiveLedgerEntry {
  view: LedgerView & {
    /** DV-214: an entry waiting on Squarespace gets a "Confirm in Squarespace" button. */
    awaiting: boolean
    confirmStyle: StyleObject
    confirmNote: string
  }
  event: LedgerEvent
  canApprove: boolean
  /** Can this person confirm the entry (pay.collect for a payment, pay.refund for a refund)? */
  canConfirm: boolean
}

const eventTitle = (e: LedgerEvent): string => {
  const pend = e.type === 'refund' && e.status === 'pending'
  const den = e.status === 'denied'
  switch (e.type) {
    case 'pay':
      return (e.deposit ? 'Deposit · ' : 'Payment · ') + (e.method ?? '')
    case 'adjust':
      return (e.amountCents < 0 ? 'Discount' : 'Surcharge') + ' · ' + (e.reason ?? '')
    case 'refund':
      return (
        (pend ? 'Refund requested' : den ? 'Refund denied' : 'Refund') +
        ' · ' +
        (e.dest === 'credit' ? 'to store credit' : e.dest === 'cash' ? 'cash' : (e.method ?? 'card'))
      )
    case 'credit_issue':
      return 'Credit issued · ' + (e.reason ?? '')
    case 'credit_apply':
      return 'Store credit applied'
    case 'void':
      return 'Payment voided · ' + (e.method ?? '')
  }
}

/** The meta line of an entry: stamp, who, reason, note, expiry, approver. DV-214 appends " · Awaiting Squarespace". */
export function eventMeta(e: LedgerEvent): string {
  return [
    e.atLabel,
    e.by ? e.by + (e.byRole ? ' (' + e.byRole + ')' : '') : null,
    e.type === 'refund' && e.reason ? e.reason : null,
    e.note,
    e.type === 'credit_issue' && e.expiryLabel ? 'Expires: ' + e.expiryLabel : null,
    e.approvedBy ? 'Approved by ' + e.approvedBy : null,
    e.deniedBy ? 'Denied by ' + e.deniedBy : null,
    e.voided ? 'Voided' : null,
    e.awaitingProcessor ? 'Awaiting Squarespace' : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

const amountText = (e: LedgerEvent): string => {
  const abs = money(Math.abs(e.amountCents))
  switch (e.type) {
    case 'refund':
    case 'void':
      return '−' + abs
    case 'credit_issue':
      return '+' + abs
    default:
      return abs
  }
}

export function approveNote(e: LedgerEvent, p: LivePerms): string {
  if (e.approveBlock === 'self') return 'You can’t approve a refund you requested. Ask another approver.'
  if (e.canApprove)
    return (
      'You can approve up to ' +
      (p.refund.maxCents === Infinity ? 'any amount' : money0(p.refund.maxCents)) +
      '.'
    )
  return 'Needs a role with a refund limit of at least ' + money0(e.amountCents) + '.'
}

/** One ledger entry per event, newest first (the server's order). */
export function liveLedgerEntries(d: InvoiceDetail, p: LivePerms): LiveLedgerEntry[] {
  return d.ledger.map((e) => {
    const pend = e.type === 'refund' && e.status === 'pending'
    const den = e.status === 'denied'
    const col =
      e.type === 'refund' || e.type === 'void'
        ? 'var(--red)'
        : e.type === 'adjust'
          ? e.amountCents < 0
            ? 'var(--red)'
            : 'var(--ink)'
          : e.type === 'credit_issue' || e.type === 'credit_apply'
            ? 'var(--amber)'
            : 'var(--accentInk)'
    const canConfirm = e.awaitingProcessor && (e.type === 'refund' ? p.refund.has : p.canCollect)
    return {
      event: e,
      canApprove: e.canApprove,
      canConfirm,
      view: {
        glyph: GLYPH[e.type],
        title: eventTitle(e),
        meta: eventMeta(e),
        amt: amountText(e),
        amtColor: den ? 'var(--ink3)' : col,
        dot: ledgerDotStyle(pend, col),
        pending: pend,
        approveNote: pend ? approveNote(e, p) : '',
        approveStyle: approveButtonStyle(e.canApprove),
        awaiting: e.awaitingProcessor,
        confirmStyle: approveButtonStyle(canConfirm),
        confirmNote: e.awaitingProcessor
          ? canConfirm
            ? 'Mark it done once Squarespace shows it.'
            : e.type === 'refund'
              ? 'Needs a role that can issue refunds.'
              : 'Needs a role that can collect payments.'
          : '',
      },
    }
  })
}

// ---- sheets --------------------------------------------------------------------------------------------------------

export interface LiveSheetForm extends SheetForm {
  /** Collect, "Payment link": the Squarespace checkout or invoice URL (DV-215). */
  url: string
}

export const liveSheetForm = (
  preset?: Partial<LiveSheetForm>,
  attachedUrl?: string | null,
): LiveSheetForm => ({
  mode: 'full',
  items: [],
  dest: 'card',
  reason: null,
  note: '',
  amount: '',
  kind: 'discount',
  unit: '$',
  settle: 'credit',
  expiry: '90 days',
  method: 'Card on file',
  url: attachedUrl ?? '',
  ...(preset ?? {}),
})

export type SheetRequest =
  | { kind: 'refund'; input: RefundInput; over: boolean }
  | { kind: 'adjust'; input: AdjustInput }
  | { kind: 'credit'; input: CreditInput }
  | { kind: 'collect'; input: CollectInput }
  | { kind: 'apply' }

export interface LiveSheetCalc {
  reasons: string[]
  reason: string
  summary: Array<{ label: string; value: string; color: string }>
  blocked: boolean
  permText: string
  permOk: boolean
  submitLabel: string
  showSettle: boolean
  /** The collect sheet shows the URL input (method Payment link). */
  needsUrl: boolean
  /** null while the form is not submittable. */
  request: SheetRequest | null
}

const firstName = (client: string): string => client.split(' ')[0]!
export const methodOfLabel = (label: string): CollectInput['method'] =>
  label === 'Cash' ? 'cash' : label === 'Payment link' ? 'payment_link' : 'card'

/**
 * What the server answers to a refund of `val` cents to `dest`, from the invoice's refundCaps (the refund command's own caps
 * after done and pending refunds), checked in the command's order: card `cardCents` then `totalCents`, cash `totalCents` then
 * `otherCents`, store credit `totalCents`. The texts are the server's problem details. null = the amount is within the caps.
 */
export function refundCapError(
  caps: InvoiceDetail['refundCaps'],
  dest: LiveSheetForm['dest'],
  val: number,
): string | null {
  if (dest === 'card' && val > caps.cardCents)
    return 'Only ' + money(caps.cardCents) + ' was paid by card — refund the rest to store credit.'
  if (val > caps.totalCents) return 'More than the refundable amount.'
  if (dest === 'cash' && val > caps.otherCents)
    return 'Only ' + money(caps.otherCents) + ' was paid by card or cash — refund the rest to store credit.'
  return null
}

/** Everything a sheet shows and sends. Previews use the cents twin; submitting asks the server, which has the last word. */
export function liveSheetCalc(args: {
  kind: SheetKind
  f: LiveSheetForm
  d: InvoiceDetail
  p: LivePerms
}): LiveSheetCalc {
  const { kind: sk, f, d, p } = args
  const c = d.calc
  const credit = d.clientCredit.balanceCents
  const reasons = reasonsFor(sk, f)
  const reason = f.reason && reasons.includes(f.reason) ? f.reason : (reasons[0] ?? '')
  const note = f.note.trim() || null
  const rf = p.refund
  const ad = p.adjust
  const cr = p.credit
  let summary: LiveSheetCalc['summary'] = []
  let blocked = false
  let permText = ''
  let permOk = true
  let submitLabel = ''
  let showSettle = false
  let needsUrl = false
  let request: SheetRequest | null = null

  if (sk === 'refund') {
    const amountCents = parseCents(f.amount)
    const refundableItems = d.items.map((it, i) => ({ it, i })).filter((x) => !x.it.refunded)
    let val: number
    if (f.mode === 'full') val = c.refundable
    else if (f.mode === 'items')
      val = itemsRefundValue(
        f.items.map((i) => d.items[i]?.priceCents ?? 0),
        d.taxBp,
        c.refundable,
      )
    else val = amountCents
    const capError = refundCapError(d.refundCaps, f.dest, val)
    const over = val > rf.maxCents
    const noItems = f.mode === 'items' && f.items.length === 0
    blocked = val <= 0 || !!capError || noItems || (f.mode === 'items' && refundableItems.length === 0)
    summary = [
      { label: 'Refundable', value: money(c.refundable), color: 'var(--ink)' },
      { label: 'This refund', value: money(val), color: 'var(--red)' },
      { label: 'Collected after', value: money(c.paid - c.refunded - val), color: 'var(--accentInk)' },
    ]
    if (f.dest === 'credit')
      summary.push({
        label: firstName(d.client) + '’s credit after',
        value: money(credit + val),
        color: 'var(--amber)',
      })
    permText =
      capError ??
      (over
        ? 'Over your ' + limitLabel(rf) + ' as ' + p.roleLabel + '. This will be sent for approval.'
        : 'Within your ' + limitLabel(rf) + ' as ' + p.roleLabel + '.')
    // DV-216: a card refund is finished in Squarespace.
    if (f.dest === 'card' && !over && !blocked)
      permText += ' Card refunds are completed in Squarespace; confirm it here once done.'
    permOk = !blocked && !over
    submitLabel = over && !blocked ? 'Request approval · ' + money(val) : 'Refund ' + money(val)
    if (!blocked)
      request = {
        kind: 'refund',
        over,
        input: {
          mode: f.mode,
          ...(f.mode === 'items' ? { itemIds: f.items.map((i) => d.items[i]!.id) } : {}),
          ...(f.mode === 'custom' ? { amountCents: val } : {}),
          dest: f.dest,
          reason,
          note,
        },
      }
  }

  if (sk === 'adjust') {
    const value = f.unit === '%' ? parsePercentBp(f.amount) : parseCents(f.amount)
    const pv = adjustPreview(c, d.taxBp, { kind: f.kind, unit: f.unit, value })
    const over = pv.pre > ad.maxCents
    blocked = pv.pre <= 0 || pv.newSub < 0 || over
    summary = [
      { label: 'Current total', value: money(c.total), color: 'var(--ink)' },
      {
        label: (f.kind === 'discount' ? 'Discount' : 'Surcharge') + ' (pre-tax)',
        value: money(pv.signed),
        color: f.kind === 'discount' ? 'var(--red)' : 'var(--ink)',
      },
      { label: 'New total', value: money(pv.newTotal), color: 'var(--accentInk)' },
    ]
    if (pv.diff > 0 && c.paid > 0)
      summary.push({
        label: 'Overpaid — returned as ' + (f.settle === 'credit' ? 'store credit' : 'card refund'),
        value: money(pv.diff),
        color: 'var(--amber)',
      })
    if (pv.diff < 0) summary.push({ label: 'New balance due', value: money(-pv.diff), color: 'var(--red)' })
    permText = over
      ? 'Over your ' + limitLabel(ad) + ' as ' + p.roleLabel + '. Ask Management or a Super Admin.'
      : pv.newSub < 0
        ? 'Discount is larger than the invoice.'
        : 'Within your ' + limitLabel(ad) + ' as ' + p.roleLabel + '.'
    permOk = !blocked
    submitLabel = 'Apply ' + (f.kind === 'discount' ? 'discount' : 'surcharge')
    showSettle = f.kind === 'discount' && c.paid > 0 && pv.diff > 0
    if (!blocked)
      request = {
        kind: 'adjust',
        input: {
          kind: f.kind,
          unit: f.unit,
          value,
          reason,
          note,
          ...(showSettle ? { settle: f.settle } : {}),
        },
      }
  }

  if (sk === 'credit') {
    const amt = parseCents(f.amount)
    const over = amt > cr.maxCents
    blocked = amt <= 0 || over
    summary = [
      { label: 'Current credit', value: money(credit), color: 'var(--ink)' },
      { label: 'Issuing', value: '+' + money(amt), color: 'var(--amber)' },
      { label: 'New balance', value: money(credit + amt), color: 'var(--accentInk)' },
    ]
    permText = over
      ? 'Over your ' + limitLabel(cr) + ' as ' + p.roleLabel + '.'
      : 'Within your ' +
        limitLabel(cr) +
        ' as ' +
        p.roleLabel +
        '. Credit can be applied to any future invoice.'
    permOk = !blocked
    submitLabel = 'Issue ' + money(amt) + ' credit'
    if (!blocked)
      request = {
        kind: 'credit',
        input: { amountCents: amt, reason, note, expiry: f.expiry as CreditInput['expiry'] },
      }
  }

  if (sk === 'collect') {
    const method = methodOfLabel(f.method)
    needsUrl = method === 'payment_link'
    const url = f.url.trim()
    summary = [{ label: 'Balance due', value: money(c.balance), color: 'var(--red)' }]
    blocked = c.balance <= 0 || (needsUrl && !url)
    // DV-217: SMS wording; a link is texted and the payment is recorded when Squarespace confirms it.
    permText = needsUrl
      ? 'The link is texted to the client by SMS. The payment is recorded once Squarespace confirms it.'
      : 'Receipt goes out by SMS and email.'
    permOk = true
    submitLabel = 'Collect ' + money(c.balance)
    if (!blocked) request = { kind: 'collect', input: needsUrl ? { method, url } : { method } }
  }

  if (sk === 'apply') {
    const use = Math.min(credit, c.balance)
    summary = [
      { label: 'Available credit', value: money(credit), color: 'var(--amber)' },
      { label: 'Applying', value: money(use), color: 'var(--accentInk)' },
      { label: 'Balance after', value: money(c.balance - use), color: 'var(--red)' },
    ]
    permText = 'Store credit is used as a payment on this invoice.'
    permOk = true
    blocked = use <= 0
    submitLabel = 'Apply ' + money(use)
    if (!blocked) request = { kind: 'apply' }
  }

  return { reasons, reason, summary, blocked, permText, permOk, submitLabel, showSettle, needsUrl, request }
}

// ---- toasts (after the server answered; the title/detail of a failure come from the server) --------------------------

const refundTarget = (e: LedgerEvent): string =>
  e.dest === 'credit' ? 'store credit' : e.dest === 'cash' ? 'cash' : (e.method ?? 'card')

export function refundToast(r: EventResult): string {
  const e = r.event
  return e.status === 'pending'
    ? 'Sent for approval · ' + money(e.amountCents)
    : 'Refunded ' + money(e.amountCents) + ' to ' + refundTarget(e)
}

export function adjustToast(kind: 'discount' | 'surcharge', r: AdjustResult): string {
  return (
    (kind === 'discount' ? 'Discount' : 'Surcharge') + ' applied · new total ' + money(r.invoice.calc.total)
  )
}

export const creditToast = (r: EventResult, client: string): string =>
  money(r.event.amountCents) + ' credit issued to ' + client

export function collectToast(r: CollectResult, client: string): string {
  if (r.paymentLink) {
    return r.paymentLink.sms === 'queued'
      ? 'Payment link sent to ' + client
      : 'Payment link saved · ' +
          client +
          (r.paymentLink.sms === 'skipped_opt_out' ? ' opted out of SMS' : ' has no phone on file')
  }
  return 'Collected ' + money(r.event?.amountCents ?? 0)
}

export const applyToast = (r: EventResult): string => money(r.event.amountCents) + ' credit applied'

export const approveToast = (r: EventResult): string =>
  'Refund approved · ' + money(r.event.amountCents) + ' to ' + refundTarget(r.event)

/** DV-218: SMS wording, and only the channels that took the message. */
export function receiptToast(r: ReceiptResult, client: string): string {
  const sms = r.sms === 'queued'
  const email = r.email === 'queued'
  if (sms && email) return 'Receipt sent to ' + client + ' via SMS + email'
  if (sms) return 'Receipt sent to ' + client + ' via SMS'
  if (email) return 'Receipt sent to ' + client + ' via email'
  return 'Receipt not sent · ' + client + ' has no SMS or email to reach'
}

export const csvToast = (rows: number): string => 'CSV export started · ' + plural(rows, 'invoice')

export const confirmToast = (r: EventResult): string =>
  (r.event.type === 'refund' ? 'Refund' : 'Payment') +
  ' confirmed in Squarespace · ' +
  money(r.event.amountCents)

/** Banner text: the server's ("2 refunds awaiting approval — $80.00 · Chloe Bennett · requested by Sofia D."). */
export const pendingText = (s: PaymentsSummary | undefined): string =>
  s && s.pendingApprovals.count > 0 ? s.pendingApprovals.text : ''
