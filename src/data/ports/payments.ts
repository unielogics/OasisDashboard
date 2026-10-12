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
  /** The range's invoices split by visit category (ADR 0160 plan K); absent from an older server. */
  byCategory?: CategorySplit[]
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
  /** The visit's category keys (ADR 0160 plan K): the appointment's, else those of the invoiced services. */
  categories?: string[]
  /** The one word the invoice counts under: a category, `mixed`, `addons` for add-ons alone, null for none. */
  category?: string | null
}

/** One entry of the summary's split by visit category (each invoice once; the entries add up to the KPIs). */
export interface CategorySplit {
  key: string
  label: string
  /** #RRGGBB; null for `mixed` and `_none`. */
  colour: string | null
  count: number
  grossCents: number
  netCents: number
  outstandingCents: number
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
  source: 'oasis' | 'squarespace' | 'square' | 'system' | 'seed'
  processorState: ProcessorState
  awaitingProcessor: boolean
  /** The Square payment or refund id of a Square entry; the Squarespace transaction of a Squarespace one. */
  processorRef: string | null
  sqspOrderId: string | null
  /** Who took (or is to take) the card money: squarespace, square, or null (cash, credit, nothing yet). ADR 0171; absent from an older server. */
  processor?: Processor | null
  /** The Square order of a Square payment (a link's order, a POS order). */
  processorOrderId?: string | null
  needsReview: boolean
  canApprove: boolean
  approveBlock: 'permission' | 'limit' | 'self' | null
}

export type Processor = 'squarespace' | 'square'

export interface InvoiceItem {
  id: string
  position: number
  kind: 'package' | 'addon'
  name: string
  priceCents: number
  refunded: boolean
  /** The regular price at the visit's size (ADR 0170); null on a line priced before sizes. Absent from an older server. */
  listCents?: number | null
  /** The member % off applied, in basis points (null before sizes). */
  discountBp?: number | null
  /** list - price: the member % off in cents. */
  memberDiscountCents?: number
  /** The size the line is priced at ("Large SUV"); null when unknown or not priced by size. */
  classLabel?: string | null
}

/** A membership's coverage of one line (ADR 0170): "Covered $40 · $20 size difference due". */
export interface CoverageLine {
  serviceName: string
  coveredCents: number
  lineCents: number
  differenceCents: number
  planClassLabel: string | null
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
  /**
   * Who takes new card money (PAYMENT_PROCESSOR, ADR 0171) and whether "Open Square POS" is on. Absent from an older
   * server: today's Squarespace screen.
   */
  processing?: { processor: Processor; squarePosAppSwitch: boolean }
  version: number
  items: InvoiceItem[]
  adjustments: Array<{
    eventId: string
    kind: 'discount' | 'surcharge'
    reason: string | null
    note: string | null
    amountCents: number
    /** The membership's coverage of a line; null for any other adjustment (ADR 0170). Absent from an older server. */
    coverage?: CoverageLine | null
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
  /** null for the client's personal pay link (never shown: it is a secret texted to the client). */
  url: string | null
  expectedCents: number
  purpose: 'balance' | 'deposit'
  sms: DeliveryState
  /** squarespace, square, or personal (the client's own pay page); absent from an older server. */
  provider?: string
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
  /**
   * payment_link before the Square cutover: the Squarespace checkout or invoice URL (else the one already attached). The
   * server ignores it once Square is the processor (it makes the link itself).
   */
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

// ---- Square (ADR 0171, api-spec 30.7) ------------------------------------------------------------------------------

export interface SquareCandidate {
  invoiceId: string
  invoiceNo: number
  client: string
  balanceCents: number
  /** The staff card entry of the same amount on that invoice: applying confirms it. */
  awaitingEventId: string | null
  score: number
  why: string[]
}

/** One Square payment waiting for a person (GET /payments/square/unmatched, the reconciliation's square section). */
export interface SquarePaymentToMatch {
  paymentId: string
  /** pending: the matcher has not decided yet (counter payments wait a little). */
  matchState: 'pending' | 'unmatched'
  classification: string | null
  /** The sale, tip excluded. */
  amountCents: number
  tipCents: number
  totalCents: number
  refundedCents: number
  /** "Visa ••4242", "Cash", "Square". */
  method: string
  sourceType: string | null
  brand: string | null
  last4: string | null
  note: string | null
  receiptNumber: string | null
  product: string | null
  createdAt: string
  ageMinutes: number
  /** Best first (at most 5). */
  candidates: SquareCandidate[]
}

export type SquareIgnoreReason = 'not_oasis_sale' | 'duplicate' | 'test' | 'other'

export interface SquareDecided {
  paymentId: string
  matchState: 'matched' | 'ignored'
  invoiceId: string | null
  eventId: string | null
  invoice: InvoiceDetail | null
}

export interface SquareFailedRefund {
  eventId: string
  invoiceId: string
  label: string
  client: string
  amountCents: number
  occurredAt: string
  /** What Square did give back (still counted as refunded, as its own refund row). */
  refundedCents: number
  /** What did not go back to the card and is not on its way: give it back another way. */
  uncoveredCents: number
  errors: string[]
}

/** GET /payments/reconciliation: only the parts the screen shows (the Square section). */
export interface Reconciliation {
  square?: {
    paymentsToMatch: SquarePaymentToMatch[]
    failedRefunds: SquareFailedRefund[]
    refundsInFlight: number
  }
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
  /** GET /payments/square/unmatched (pay.reports): the Square payments a person has to match, oldest first. */
  squareToMatch(): Promise<{ items: SquarePaymentToMatch[] }>
  /** POST /payments/square/:paymentId/apply (pay.collect): record it on an invoice, or confirm a staff card entry there. */
  squareApply(
    paymentId: string,
    input: { invoiceId: string; confirmEventId?: string | null },
    o?: CommandOptions,
  ): Promise<SquareDecided>
  /** POST /payments/square/:paymentId/ignore (pay.collect): set it aside; nothing is written to the ledger. */
  squareIgnore(
    paymentId: string,
    input: { reason: SquareIgnoreReason; note?: string | null },
    o?: CommandOptions,
  ): Promise<SquareDecided>
  /** POST /payments/square/:paymentId/reassign (pay.void): move a matched payment to the right invoice. */
  squareReassign(paymentId: string, toInvoiceId: string, o?: CommandOptions): Promise<SquareDecided>
  /** GET /payments/reconciliation (pay.reports): the screen reads its Square section. */
  reconciliation(): Promise<Reconciliation>
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
    squareToMatch: () => c.get('/payments/square/unmatched'),
    squareApply: (paymentId, input, o) => c.post(`/payments/square/${enc(paymentId)}/apply`, input, o),
    squareIgnore: (paymentId, input, o) => c.post(`/payments/square/${enc(paymentId)}/ignore`, input, o),
    squareReassign: (paymentId, toInvoiceId, o) =>
      c.post(`/payments/square/${enc(paymentId)}/reassign`, { toInvoiceId }, o),
    reconciliation: () => c.get('/payments/reconciliation'),
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
