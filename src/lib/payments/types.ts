// Shapes of the Payments screen's ledger model. Amounts are dollars as floating point numbers, exactly as the design
// computes them (the API speaks integer cents; the conversion belongs to the live data adapter, not to these formulas).

export type EventType = 'pay' | 'adjust' | 'refund' | 'credit_issue' | 'credit_apply'
export type RefundStatus = 'pending' | 'done' | 'denied'
export type RefundDest = 'card' | 'credit' | 'cash'

export interface LineItem {
  name: string
  price: number
}

export interface LedgerEvent {
  type: EventType
  amt: number
  /** Display stamp: "Today 10:36 AM", "Yesterday 4:40 PM", "Jun 11 · 9:12 AM". */
  t?: string
  by?: string
  byRole?: string
  method?: string
  dest?: RefundDest
  reason?: string
  note?: string
  expiry?: string
  status?: RefundStatus
  deposit?: boolean
  approvedBy?: string
}

export interface Invoice {
  id: string
  /** Day offset from the screen's anchor day (0 = today, -1 = yesterday). */
  off: number
  time: string
  client: string
  vehicle: string
  staff: string
  items: LineItem[]
  tip: number
  canceled: boolean
  events: LedgerEvent[]
}

export type InvoiceStatus =
  'Paid' | 'Unpaid' | 'Partially paid' | 'Refunded' | 'Canceled · refunded' | 'Partially refunded'

export interface InvoiceCalc {
  items: number
  adj: number
  sub: number
  tax: number
  total: number
  paid: number
  paidOrig: number
  creditApplied: number
  refunded: number
  pending: LedgerEvent[]
  balance: number
  refundable: number
  toOrigMax: number
  issued: number
  status: InvoiceStatus
  net: number
}

export interface InvoiceCalcRow {
  t: Invoice
  c: InvoiceCalc
}

export type RangeKey = 'today' | '7d' | '30d' | 'mtd'
export type FilterKey = 'all' | 'unpaid' | 'refunds' | 'adjusted' | 'credits'
export type SheetKind = 'refund' | 'adjust' | 'credit' | 'collect' | 'apply'
export type LimitKind = 'refund' | 'adjust' | 'credit'
export type Theme = 'light' | 'dark'

export interface RoleDef {
  id: string
  name: string
}

/** The roles bundle Settings writes to localStorage['oasis-roles'] and Payments reads. */
export interface RolesConfig {
  roles: RoleDef[]
  perms: Record<string, Record<string, number | undefined>>
  limits: Record<string, Record<string, number | null | undefined>>
}

/** The calendar day that "today" means on screen (month is 0-based like Date). */
export interface LocalDay {
  y: number
  m: number
  d: number
}

export type StyleObject = Record<string, string | number>
