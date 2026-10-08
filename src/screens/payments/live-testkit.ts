// Test helpers for the live Payments screen: builders for the ledger API's DTOs (the calc is computed with the cents
// twin, so a built invoice is internally consistent) and a stub PaymentsPort that records its calls. Not shipped.
import { QueryClient } from '@tanstack/react-query'
import { LiveChrome } from '@/auth/chrome'
import type { Session } from '@/auth/session-model'
import { QueryStore } from '@/data/query-store'
import type {
  AdjustResult,
  CollectResult,
  EventResult,
  InvoiceDetail,
  InvoiceListRow,
  LedgerEvent,
  PaymentsPort,
  PaymentsSummary,
  ReceiptResult,
} from '@/data/ports/payments'
import { calcCents } from '@/lib/payments'
import type { CentsEvent } from '@/lib/payments'
import { attach } from './testkit'
import { LivePaymentsLogic } from './LiveLogic'
import type { LiveDeps } from './LiveLogic'

let seq = 0
export const resetIds = (): void => void (seq = 0)

export function makeEvent(
  over: Partial<LedgerEvent> & Pick<LedgerEvent, 'type' | 'amountCents'>,
): LedgerEvent {
  seq++
  return {
    id: `ev-${seq}`,
    seq,
    status: 'done',
    method: null,
    methodKind: null,
    brand: null,
    last4: null,
    dest: null,
    deposit: false,
    reason: null,
    note: null,
    expiry: null,
    expiryLabel: null,
    expiresAt: null,
    itemIds: [],
    parentEventId: null,
    voidsEventId: null,
    voided: false,
    by: 'Rafael M.',
    byRole: 'Management',
    approvedBy: null,
    deniedBy: null,
    at: '2026-06-13T14:00:00.000Z',
    atLabel: 'Today 10:00 AM',
    resolvedAt: null,
    source: 'oasis',
    processorState: 'na',
    awaitingProcessor: false,
    processorRef: null,
    sqspOrderId: null,
    needsReview: false,
    canApprove: false,
    approveBlock: null,
    ...over,
  }
}

export interface DetailSpec {
  label?: string
  client?: string
  items?: Array<{ name: string; priceCents: number; refunded?: boolean }>
  /** Oldest first; the builder reverses them like the server does. */
  events?: LedgerEvent[]
  tipCents?: number
  canceled?: boolean
  taxBp?: number
  creditCents?: number
  paymentLinkUrl?: string | null
  refundCaps?: InvoiceDetail['refundCaps']
}

/**
 * The server's originalRefundCap (backend payments/repository.ts) over built events: money paid by anything but store
 * credit (voids taken back out) less the card and cash refunds done or pending; the card cap counts card and wallet money
 * and card refunds only.
 */
export function refundCapsOf(events: readonly LedgerEvent[], refundable: number): InvoiceDetail['refundCaps'] {
  const byId = new Map(events.map((e) => [e.id, e]))
  const isCard = (e: LedgerEvent) => {
    const kind = e.methodKind ?? (e.voidsEventId ? byId.get(e.voidsEventId)?.methodKind : null)
    return kind === 'card' || kind === 'apple_pay'
  }
  const live = (e: LedgerEvent) => e.type === 'refund' && (e.status === 'done' || e.status === 'pending')
  let orig = 0
  let card = 0
  for (const e of events) {
    const signed = e.type === 'pay' ? e.amountCents : e.type === 'void' ? -e.amountCents : 0
    orig += signed
    if (isCard(e)) card += signed
    if (live(e) && e.dest !== 'credit') orig -= e.amountCents
    if (live(e) && e.dest === 'card') card -= e.amountCents
  }
  return {
    cardCents: Math.max(0, Math.min(orig, card)),
    otherCents: Math.max(0, orig),
    totalCents: refundable,
  }
}

export function makeDetail(spec: DetailSpec = {}): InvoiceDetail {
  const items = spec.items ?? [{ name: 'Executive Detail', priceCents: 26000 }]
  const events = spec.events ?? []
  const taxBp = spec.taxBp ?? 700
  const cevents: CentsEvent[] = events.map((e) => ({
    type: e.type,
    amountCents: e.amountCents,
    status: e.type === 'refund' ? e.status : undefined,
    dest: e.dest,
  }))
  const calc = calcCents({
    itemPrices: items.map((i) => i.priceCents),
    events: cevents,
    taxBp,
    tipCents: spec.tipCents ?? 0,
    canceled: spec.canceled ?? false,
  })
  const label = spec.label ?? 'INV-20603'
  const pending = events.filter((e) => e.type === 'refund' && e.status === 'pending')
  const awaiting = events.filter((e) => e.awaitingProcessor).length
  const statusLabels: Record<string, string> = {
    paid: 'Paid',
    unpaid: 'Unpaid',
    partially_paid: 'Partially paid',
    partially_refunded: 'Partially refunded',
    refunded: 'Refunded',
    canceled: 'Canceled',
    canceled_kept: 'Canceled · deposit kept',
    canceled_refunded: 'Canceled · refunded',
  }
  return {
    id: 'uuid-' + label,
    invoiceNo: Number(label.replace(/\D/g, '')),
    label,
    appointmentId: null,
    customerId: 'cust-1',
    client: spec.client ?? 'Liam Chen',
    vehicle: '2020 BMW M340i',
    staff: 'Marco R.',
    occurredAt: '2026-06-13T14:31:00.000Z',
    bizDate: '2026-06-13',
    when: 'Today 10:31 AM',
    status: calc.status,
    statusLabel: pending.length ? 'Refund pending' : statusLabels[calc.status]!,
    refundPending: pending.length > 0,
    canceled: spec.canceled ?? false,
    cancelReason: spec.canceled ? 'canceled' : null,
    taxBp,
    tipCents: spec.tipCents ?? 0,
    paymentLinkUrl: spec.paymentLinkUrl ?? null,
    awaitingProcessorCount: awaiting,
    version: 1,
    items: items.map((it, i) => ({
      id: `item-${label}-${i}`,
      position: i,
      kind: i === 0 ? 'package' : 'addon',
      name: it.name,
      priceCents: it.priceCents,
      refunded: it.refunded ?? false,
    })),
    adjustments: events
      .filter((e) => e.type === 'adjust')
      .map((e) => ({
        eventId: e.id,
        kind: e.amountCents < 0 ? 'discount' : 'surcharge',
        reason: e.reason,
        note: e.note,
        amountCents: e.amountCents,
      })),
    calc,
    refundCaps: spec.refundCaps ?? refundCapsOf(events, calc.refundable),
    clientCredit: { balanceCents: spec.creditCents ?? 0, nextExpiry: null },
    ledger: [...events].reverse(),
    caller: null,
  }
}

export function makeRow(d: InvoiceDetail, over: Partial<InvoiceListRow> = {}): InvoiceListRow {
  return {
    id: d.id,
    invoiceNo: d.invoiceNo,
    label: d.label,
    bizDate: d.bizDate,
    date: 'Today',
    time: '10:31 AM',
    client: d.client,
    vehicle: d.vehicle,
    staff: d.staff,
    items: { first: d.items[0]!.name, more: d.items.length - 1 },
    totalCents: d.calc.total,
    paidCents: d.calc.paid,
    balanceCents: d.calc.balance,
    status: d.status,
    statusLabel: d.statusLabel,
    refundPending: d.refundPending,
    awaiting: null,
    adjusted: d.calc.adj !== 0,
    ...over,
  }
}

export function makeSummary(over: Partial<PaymentsSummary> = {}): PaymentsSummary {
  return {
    range: { key: '7d', from: '2026-06-07', to: '2026-06-13', label: 'Jun 7 – Jun 13' },
    kpis: {
      grossSales: 716600,
      netRevenue: 706927,
      refunds: 8745,
      adjustments: -1500,
      creditsIssued: 2500,
      outstanding: 50673,
      counts: {
        invoices: 32,
        refunded: 2,
        adjusted: 4,
        creditInvoices: 1,
        creditClients: 1,
        openBalances: 3,
      },
    },
    chart: {
      granularity: 'day',
      buckets: [
        { key: '2026-06-12', label: 'F 12', title: 'Fri Jun 12 2026', netCents: 92800, lossCents: 0 },
        { key: '2026-06-13', label: 'S 13', title: 'Sat Jun 13 2026', netCents: 187800, lossCents: 2500 },
      ],
      maxCents: 190300,
    },
    byMethod: { card: 473910, applePay: 167494, cash: 57140, storeCredit: 2500, other: 0 },
    filterCounts: { all: 32, unpaid: 3, refunds: 3, adjusted: 4, credits: 2 },
    pendingApprovals: { count: 0, text: '', first: null, all: [] },
    awaitingProcessor: { count: 0, cents: 0 },
    ...over,
  }
}

export interface StubPort extends PaymentsPort {
  calls: Array<{ op: string; args: unknown[]; key?: string }>
  /** Next answer of a command, or an error to throw. */
  next: Record<string, unknown>
  details: Map<string, InvoiceDetail>
  summaries: Map<string, PaymentsSummary>
  rows: InvoiceListRow[]
  /** Resolve pending commands manually. */
  gate: { release: (() => void) | null; hold: boolean }
}

export function stubPort(): StubPort {
  const calls: StubPort['calls'] = []
  const p: StubPort = {
    calls,
    next: {},
    details: new Map(),
    summaries: new Map(),
    rows: [],
    gate: { release: null, hold: false },
    async summary(range) {
      calls.push({ op: 'summary', args: [range] })
      return p.summaries.get(range) ?? makeSummary()
    },
    async invoices(q) {
      calls.push({ op: 'invoices', args: [q] })
      const needle = q.q?.trim().toLowerCase()
      return p.rows.filter(
        (r) => !needle || (r.label + ' ' + r.client + ' ' + r.vehicle).toLowerCase().includes(needle),
      )
    },
    async invoicePage() {
      throw new Error('not used')
    },
    async invoice(id) {
      calls.push({ op: 'invoice', args: [id] })
      const d = p.details.get(id)
      if (!d) throw new Error('no such invoice ' + id)
      return d
    },
    collect: (id, input, o) => cmd<CollectResult>('collect', [id, input], o),
    applyCredit: (id, o) => cmd<EventResult>('applyCredit', [id], o),
    refund: (id, input, o) => cmd<EventResult>('refund', [id, input], o),
    approveRefund: (id, eid, o) => cmd<EventResult>('approveRefund', [id, eid], o),
    denyRefund: (id, eid, o) => cmd<EventResult>('denyRefund', [id, eid], o),
    adjust: (id, input, o) => cmd<AdjustResult>('adjust', [id, input], o),
    issueCredit: (id, input, o) => cmd<EventResult>('issueCredit', [id, input], o),
    voidPayment: (id, eid, o) => cmd<EventResult>('voidPayment', [id, eid], o),
    sendReceipt: (id, o) => cmd<ReceiptResult>('sendReceipt', [id], o),
    confirmProcessor: (eid, o) => cmd<EventResult>('confirmProcessor', [eid], o),
    async exportCsv(q) {
      calls.push({ op: 'exportCsv', args: [q] })
      return { body: new Blob(['Invoice\r\n']), filename: 'oasis-invoices_2026-06-07_2026-06-13.csv' }
    },
  }
  async function cmd<T>(op: string, args: unknown[], o?: { idempotencyKey?: string }): Promise<T> {
    calls.push({ op, args, key: o?.idempotencyKey })
    if (p.gate.hold) await new Promise<void>((r) => (p.gate.release = r))
    const out = p.next[op]
    if (out instanceof Error) throw out
    return out as T
  }
  return p
}

export function makeChrome(session: Session): LiveChrome {
  const c = new LiveChrome()
  c.setSession(session)
  return c
}

export interface Live {
  logic: LivePaymentsLogic
  port: StubPort
  chrome: LiveChrome
  qc: QueryClient
  downloads: Array<{ filename: string }>
  themes: string[]
  /** Settle queued microtasks and the store's frame scheduling. */
  settle(): Promise<void>
  vals(): Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
}

export function makeLive(session: Session, port: StubPort = stubPort()): Live {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  const store = new QueryStore(qc, { schedule: (fn) => queueMicrotask(fn) })
  const chrome = makeChrome(session)
  const downloads: Live['downloads'] = []
  const themes: string[] = []
  const deps: LiveDeps = {
    port,
    queryClient: qc,
    store,
    chrome: () => chrome,
    loadTheme: () => 'light',
    saveTheme: (t) => void themes.push(t),
    download: (f) => void downloads.push({ filename: f.filename }),
  }
  const logic = new LivePaymentsLogic({}, deps)
  attach(logic)
  logic.componentDidMount()
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0))
  }
  return { logic, port, chrome, qc, downloads, themes, settle, vals: () => logic.renderVals() }
}
