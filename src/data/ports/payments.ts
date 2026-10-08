// The Payments region of the data port: DTOs of the ledger API (backend api-spec section 21; the Zod response models in
// src/modules/payments/http/schemas.ts are the source) and the live implementation over the ApiClient. Every amount is
// an integer number of cents; the server also sends the labels the design derives (statusLabel, atLabel, date, time).
import type { ApiClient } from '../http/client'
import type { CommandOptions, Cursor } from './types'

export type PaymentRange = 'today' | '7d' | '30d' | 'mtd'
export type InvoiceFilter = 'all' | 'unpaid' | 'refunds' | 'adjusted' | 'credits'

export interface InvoiceQuery {
  range: PaymentRange
  filter?: InvoiceFilter
  q?: string
}

export type ApiInvoiceStatus =
  | 'paid'
  | 'unpaid'
  | 'partially_paid'
  | 'partially_refunded'
  | 'refunded'
  | 'canceled'
  | 'canceled_kept'
  | 'canceled_refunded'

export type LedgerType = 'pay' | 'adjust' | 'refund' | 'credit_issue' | 'credit_apply' | 'void'
export type RefundStatus = 'pending' | 'done' | 'denied'
export type ProcessorState = 'na' | 'awaiting_processor' | 'confirmed' | 'failed'
export type MethodKind = 'card' | 'apple_pay' | 'cash' | 'store_credit' | 'other'

export interface PendingApproval {
  eventId: string
  invoiceId: string
  invoiceNo: number
  label: string
  client: string
  amountCents: number
  dest: string | null
  method: string | null
  reason: string | null
  note: string | null
  requestedBy: string | null
  requestedByRole: string | null
  requestedAt: string
  atLabel: string
  bizDate: string
}

export interface PaymentsSummary {
  range: { key: PaymentRange; from: string; to: string; label: string }
  kpis: {
    grossSales: number
    netRevenue: number
    refunds: number
    adjustments: number
    creditsIssued: number
    outstanding: number
    counts: {
      invoices: number
      refunded: number
      adjusted: number
      creditInvoices: number
      creditClients: number
      openBalances: number
    }
  }
  chart: {
    granularity: 'hour' | 'day'
    buckets: Array<{
      key: string | number
      label: string
      title: string
      netCents: number
      lossCents: number
    }>
    maxCents: number
  }
  byMethod: { card: number; applePay: number; cash: number; storeCredit: number; other: number }
  filterCounts: Record<InvoiceFilter, number>
  pendingApprovals: { count: number; text: string; first: PendingApproval | null; all: PendingApproval[] }
  awaitingProcessor: { count: number; cents: number }
}

export interface InvoiceListRow {
  id: string
  invoiceNo: number
  label: string
  bizDate: string
  date: string
  time: string
  client: string
  vehicle: string
  staff: string
  items: { first: string; more: number }
  totalCents: number
  paidCents: number
  balanceCents: number
  status: ApiInvoiceStatus
  statusLabel: string
  refundPending: boolean
  /** Card money recorded by staff and not yet confirmed in Squarespace (a refund wins over a payment). */
  awaiting: 'payment' | 'refund' | null
  adjusted: boolean
}

export interface InvoiceCalc {
  items: number
  adj: number
  sub: number
  tax: number
  tip: number
  total: number
  paidOrig: number
  creditApplied: number
  paid: number
  refunded: number
  refOrig: number
  pendingAmt: number
  pendingN: number
  issued: number
  balance: number
  refundable: number
  toOrigMax: number
  net: number
  overpaid: number
  status: ApiInvoiceStatus
}

export interface LedgerEvent {
  id: string
  seq: number
  type: LedgerType
  status: RefundStatus
  amountCents: number
  method: string | null
  methodKind: MethodKind | null
  brand: string | null
  last4: string | null
  dest: 'card' | 'credit' | 'cash' | null
  deposit: boolean
  reason: string | null
  note: string | null
  expiry: 'none' | 'd30' | 'd90' | null
  expiryLabel: string | null
  expiresAt: string | null
  itemIds: string[]
  parentEventId: string | null
  voidsEventId: string | null
  voided: boolean
  by: string | null
  byRole: string | null
  approvedBy: string | null
  deniedBy: string | null
  at: string
  atLabel: string
  resolvedAt: string | null
  source: 'oasis' | 'squarespace' | 'system' | 'seed'
  processorState: ProcessorState
  awaitingProcessor: boolean
  processorRef: string | null
  sqspOrderId: string | null
  needsReview: boolean
  canApprove: boolean
  approveBlock: 'permission' | 'limit' | 'self' | null
}

export interface InvoiceItem {
  id: string
  position: number
  kind: 'package' | 'addon'
  name: string
  priceCents: number
  refunded: boolean
}

export interface InvoiceDetail {
  id: string
  invoiceNo: number
  label: string
  appointmentId: string | null
  customerId: string
  client: string
  vehicle: string
  staff: string
  occurredAt: string
  bizDate: string
  when: string
  status: ApiInvoiceStatus
  statusLabel: string
  refundPending: boolean
  canceled: boolean
  cancelReason: 'canceled' | 'no_show' | null
  taxBp: number
  tipCents: number
  paymentLinkUrl: string | null
  awaitingProcessorCount: number
  version: number
  items: InvoiceItem[]
  adjustments: Array<{
    eventId: string
    kind: 'discount' | 'surcharge'
    reason: string | null
    note: string | null
    amountCents: number
  }>
  calc: InvoiceCalc
  /**
   * The refund command's caps after done and pending refunds: a refund to card checks `cardCents` then `totalCents`, to cash
   * `totalCents` then `otherCents`, to store credit `totalCents` (backend detail.ts RefundCapsDto).
   */
  refundCaps: { cardCents: number; otherCents: number; totalCents: number }
  clientCredit: { balanceCents: number; nextExpiry: { at: string; cents: number } | null }
  /** Newest first. */
  ledger: LedgerEvent[]
  caller: {
    canCollect: boolean
    canRefund: boolean
    canAdjust: boolean
    canCredit: boolean
    canVoid: boolean
    refundLimitCents: number | null
    adjustLimitCents: number | null
    creditLimitCents: number | null
  } | null
}

export type DeliveryState = 'queued' | 'skipped_opt_out' | 'no_contact' | string

export interface PaymentLinkInfo {
  id: string
  url: string
  expectedCents: number
  purpose: 'balance' | 'deposit'
  sms: DeliveryState
}

export interface EventResult {
  event: LedgerEvent
  invoice: InvoiceDetail
}
export interface AdjustResult {
  event: LedgerEvent
  settlement: LedgerEvent | null
  invoice: InvoiceDetail
}
export interface CollectResult {
  event?: LedgerEvent
  paymentLink?: PaymentLinkInfo
  invoice: InvoiceDetail
}
export interface ReceiptResult {
  sms: DeliveryState
  email: DeliveryState
  invoice: InvoiceDetail
}

export interface CollectInput {
  method: 'card' | 'cash' | 'payment_link'
  /** payment_link: the Squarespace checkout or invoice URL (else the one already attached). */
  url?: string
}
export interface RefundInput {
  mode: 'full' | 'items' | 'custom'
  itemIds?: string[]
  amountCents?: number
  dest: 'card' | 'credit' | 'cash'
  reason?: string
  note?: string | null
}
export interface AdjustInput {
  kind: 'discount' | 'surcharge'
  unit: '$' | '%'
  /** Cents for `$`; basis points of the items subtotal for `%` (1000 = 10%). */
  value: number
  reason?: string
  note?: string | null
  settle?: 'credit' | 'card'
}
export interface CreditInput {
  amountCents: number
  reason?: string
  note?: string | null
  expiry: 'none' | 'd30' | 'd90' | 'No expiry' | '30 days' | '90 days'
}

export interface CsvDownload {
  body: Blob
  /** `oasis-invoices_{from}_{to}.csv`, as the server names it. */
  filename: string
}

export interface PaymentsPort {
  summary(range: PaymentRange): Promise<PaymentsSummary>
  /** Follows keyset cursors until the list is complete (the design has no pagination). */
  invoices(q: InvoiceQuery): Promise<InvoiceListRow[]>
  invoicePage(q: InvoiceQuery, cursor?: string): Promise<Cursor<InvoiceListRow>>
  invoice(id: string): Promise<InvoiceDetail>
  collect(id: string, input: CollectInput, o?: CommandOptions): Promise<CollectResult>
  applyCredit(id: string, o?: CommandOptions): Promise<EventResult>
  refund(id: string, input: RefundInput, o?: CommandOptions): Promise<EventResult>
  approveRefund(id: string, eventId: string, o?: CommandOptions): Promise<EventResult>
  denyRefund(id: string, eventId: string, o?: CommandOptions): Promise<EventResult>
  adjust(id: string, input: AdjustInput, o?: CommandOptions): Promise<AdjustResult>
  issueCredit(id: string, input: CreditInput, o?: CommandOptions): Promise<EventResult>
  voidPayment(id: string, eventId: string, o?: CommandOptions): Promise<EventResult>
  sendReceipt(id: string, o?: CommandOptions): Promise<ReceiptResult>
  confirmProcessor(eventId: string, o?: CommandOptions): Promise<EventResult>
  /** GET /payments/export.csv with the active range, filter and search. */
  exportCsv(q: InvoiceQuery): Promise<CsvDownload>
}

const enc = encodeURIComponent
/** 40 pages of 500 is the CSV export's own ceiling (20,000 rows); a list that long is a bug, not a list. */
const MAX_PAGES = 40

export function csvFilename(range: { from: string; to: string }): string {
  return `oasis-invoices_${range.from}_${range.to}.csv`
}

export function createLivePaymentsPort(c: ApiClient): PaymentsPort {
  const port: PaymentsPort = {
    summary: (range) => c.get('/payments/summary', { query: { range } }),
    invoicePage: (q, cursor) =>
      c.get<Cursor<InvoiceListRow>>('/payments/invoices', {
        query: {
          range: q.range,
          filter: q.filter && q.filter !== 'all' ? q.filter : undefined,
          q: q.q?.trim() || undefined,
          cursor,
          limit: 500,
        },
      }),
    async invoices(q) {
      const out: InvoiceListRow[] = []
      let cursor: string | undefined
      for (let page = 0; page < MAX_PAGES; page++) {
        const r = await port.invoicePage(q, cursor)
        out.push(...r.items)
        if (!r.nextCursor) break
        cursor = r.nextCursor
      }
      return out
    },
    invoice: (id) => c.get(`/invoices/${enc(id)}`),
    collect: (id, input, o) => c.post(`/invoices/${enc(id)}/payments`, input, o),
    applyCredit: (id, o) => c.post(`/invoices/${enc(id)}/credit-applications`, {}, o),
    refund: (id, input, o) => c.post(`/invoices/${enc(id)}/refunds`, input, o),
    approveRefund: (id, eventId, o) => c.post(`/invoices/${enc(id)}/refunds/${enc(eventId)}/approve`, {}, o),
    denyRefund: (id, eventId, o) => c.post(`/invoices/${enc(id)}/refunds/${enc(eventId)}/deny`, {}, o),
    adjust: (id, input, o) => c.post(`/invoices/${enc(id)}/adjustments`, input, o),
    issueCredit: (id, input, o) => c.post(`/invoices/${enc(id)}/credits`, input, o),
    voidPayment: (id, eventId, o) => c.post(`/invoices/${enc(id)}/void`, { eventId }, o),
    sendReceipt: (id, o) => c.post(`/invoices/${enc(id)}/receipt`, {}, o),
    confirmProcessor: (eventId, o) => c.post(`/ledger-events/${enc(eventId)}/confirm-processor`, {}, o),
    async exportCsv(q) {
      const query = {
        range: q.range,
        filter: q.filter && q.filter !== 'all' ? q.filter : undefined,
        q: q.q?.trim() || undefined,
      }
      const [body, summary] = await Promise.all([
        c.get<Blob>('/payments/export.csv', { query, responseType: 'blob' }),
        port.summary(q.range),
      ])
      return { body, filename: csvFilename(summary.range) }
    },
  }
  return port
}
