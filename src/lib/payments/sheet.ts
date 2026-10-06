import { moneyCents, r2 } from '../money'
import { TAX } from './calc'
import { limitFor, limitText, roleName } from './limits'
import type { Invoice, InvoiceCalc, LedgerEvent, RefundDest, RolesConfig, SheetKind } from './types'

export interface SheetForm {
  mode: 'full' | 'items' | 'custom'
  items: number[]
  dest: RefundDest
  reason: string | null
  note: string
  amount: string
  kind: 'discount' | 'surcharge'
  unit: '$' | '%'
  settle: 'credit' | 'card'
  expiry: string
  method: string
}

export const defaultSheetForm = (preset?: Partial<SheetForm>): SheetForm => ({
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
  ...(preset || {}),
})

export const REFUND_REASONS = [
  'Service issue',
  'Customer canceled',
  'Duplicate charge',
  'Pricing error',
  'Goodwill',
  'Add-on not performed',
]
export const DISCOUNT_REASONS = ['Service recovery', 'Loyalty', 'Price match', 'Manager discretion']
export const SURCHARGE_REASONS = ['Extra soil surcharge', 'Pet hair surcharge', 'Oversize vehicle']
export const CREDIT_REASONS = [
  'Service recovery',
  'Referral reward',
  'Weather closure',
  'Goodwill',
  'Promotion',
]

export function reasonsFor(kind: SheetKind, f: Pick<SheetForm, 'kind'>): string[] {
  const table: Partial<Record<SheetKind, string[]>> = {
    refund: REFUND_REASONS,
    adjust: f.kind === 'discount' ? DISCOUNT_REASONS : SURCHARGE_REASONS,
    credit: CREDIT_REASONS,
  }
  return table[kind] || []
}

/** The amount field's text as a number: digits and dots only, anything unparseable is 0. */
export const parseAmount = (raw: unknown): number => parseFloat(String(raw).replace(/[^0-9.]/g, '')) || 0

export interface SummaryRow {
  label: string
  value: string
  color: string
}

/** What submitting the sheet does: the ledger events to append, then the toast. */
export interface SheetPlan {
  events: Array<Omit<LedgerEvent, 't' | 'by'>>
  toast: string
}

export interface SheetCalc {
  reasons: string[]
  reason: string
  summary: SummaryRow[]
  blocked: boolean
  permText: string
  permOk: boolean
  submitLabel: string
  /** null when the submit is a no-op (blocked). */
  plan: SheetPlan | null
  /** Adjust only: the invoice is already paid and the discount leaves an overpayment to settle. */
  showSettle: boolean
}

export interface SheetInput {
  kind: SheetKind
  f: SheetForm
  tx: Invoice
  c: InvoiceCalc
  credit: number
  rc: RolesConfig
  role: string
}

const firstName = (client: string): string => client.split(' ')[0]!

/**
 * Everything a sheet shows and does, computed from the form and the invoice. The permission wording, the limits and
 * the amounts are the design's; the live screen swaps the totals for server values and keeps the wording.
 */
export function calcSheet({ kind: sk, f, tx, c, credit, rc, role }: SheetInput): SheetCalc {
  const reasons = reasonsFor(sk, f)
  const reason = f.reason && reasons.includes(f.reason) ? f.reason : reasons[0]!
  const amt = parseAmount(f.amount)
  const rf = limitFor(rc, role, 'refund')
  const ad = limitFor(rc, role, 'adjust')
  const cr = limitFor(rc, role, 'credit')
  const roleLabel = roleName(rc, role)
  let summary: SummaryRow[] = []
  let blocked = false
  let permText = ''
  let permOk = true
  let submitLabel = ''
  let plan: SheetPlan | null = null
  let showSettle = false

  if (sk === 'refund') {
    let val = 0
    if (f.mode === 'full') val = c.refundable
    else if (f.mode === 'items')
      val = Math.min(c.refundable, r2(f.items.reduce((a, i) => a + tx.items[i]!.price, 0) * (1 + TAX)))
    else val = amt
    const origOk = f.dest !== 'card' || val <= c.toOrigMax + 0.001
    const over = val > rf.max
    blocked = val <= 0 || val > c.refundable + 0.001 || !origOk
    summary = [
      { label: 'Refundable', value: moneyCents(c.refundable), color: 'var(--ink)' },
      { label: 'This refund', value: moneyCents(val), color: 'var(--red)' },
      { label: 'Collected after', value: moneyCents(c.paid - c.refunded - val), color: 'var(--accentInk)' },
    ]
    if (f.dest === 'credit')
      summary.push({
        label: firstName(tx.client) + '’s credit after',
        value: moneyCents(credit + val),
        color: 'var(--amber)',
      })
    permText = !origOk
      ? 'Only ' + moneyCents(c.toOrigMax) + ' was paid by card — refund the rest to store credit.'
      : val > c.refundable + 0.001
        ? 'More than the refundable amount.'
        : over
          ? 'Over your ' + limitText(rf) + ' as ' + roleLabel + '. This will be sent for approval.'
          : 'Within your ' + limitText(rf) + ' as ' + roleLabel + '.'
    permOk = !blocked && !over
    submitLabel = over && !blocked ? 'Request approval · ' + moneyCents(val) : 'Refund ' + moneyCents(val)
    const card = tx.events.find((e) => e.type === 'pay')
    const method =
      f.dest === 'credit' ? 'Store credit' : f.dest === 'cash' ? 'Cash' : card ? card.method! : 'Card'
    if (!blocked)
      plan = {
        events: [
          {
            type: 'refund',
            amt: r2(val),
            dest: f.dest,
            method,
            reason,
            note: f.note,
            byRole: roleLabel,
            status: over ? 'pending' : 'done',
          },
        ],
        toast: over
          ? 'Sent for approval · ' + moneyCents(val)
          : 'Refunded ' + moneyCents(val) + (f.dest === 'credit' ? ' to store credit' : ' to ' + method),
      }
  }

  if (sk === 'adjust') {
    const pre = f.unit === '%' ? r2((c.items * amt) / 100) : amt
    const signed = f.kind === 'discount' ? -pre : pre
    const newSub = c.sub + signed
    const newTotal = r2(newSub * (1 + TAX) + tx.tip)
    const diff = r2(c.paid - c.refunded - newTotal)
    const over = pre > ad.max
    blocked = pre <= 0 || newSub < 0 || over
    summary = [
      { label: 'Current total', value: moneyCents(c.total), color: 'var(--ink)' },
      {
        label: (f.kind === 'discount' ? 'Discount' : 'Surcharge') + ' (pre-tax)',
        value: moneyCents(signed),
        color: f.kind === 'discount' ? 'var(--red)' : 'var(--ink)',
      },
      { label: 'New total', value: moneyCents(newTotal), color: 'var(--accentInk)' },
    ]
    if (diff > 0.005 && c.paid > 0)
      summary.push({
        label: 'Overpaid — returned as ' + (f.settle === 'credit' ? 'store credit' : 'card refund'),
        value: moneyCents(diff),
        color: 'var(--amber)',
      })
    if (diff < -0.005)
      summary.push({ label: 'New balance due', value: moneyCents(-diff), color: 'var(--red)' })
    permText = over
      ? 'Over your ' + limitText(ad) + ' as ' + roleLabel + '. Ask Management or a Super Admin.'
      : newSub < 0
        ? 'Discount is larger than the invoice.'
        : 'Within your ' + limitText(ad) + ' as ' + roleLabel + '.'
    permOk = !blocked
    submitLabel = 'Apply ' + (f.kind === 'discount' ? 'discount' : 'surcharge')
    showSettle = f.kind === 'discount' && c.paid > 0 && diff > 0.005
    const card = tx.events.find((e) => e.type === 'pay')
    if (!blocked) {
      const events: SheetPlan['events'] = [{ type: 'adjust', amt: r2(signed), reason, note: f.note }]
      if (diff > 0.005 && c.paid > 0)
        events.push({
          type: 'refund',
          amt: diff,
          dest: f.settle === 'credit' ? 'credit' : 'card',
          method: f.settle === 'credit' ? 'Store credit' : card ? card.method! : 'Card',
          reason: 'Adjustment settlement',
          status: 'done',
        })
      plan = {
        events,
        toast:
          (f.kind === 'discount' ? 'Discount' : 'Surcharge') + ' applied · new total ' + moneyCents(newTotal),
      }
    }
  }

  if (sk === 'credit') {
    const over = amt > cr.max
    blocked = amt <= 0 || over
    summary = [
      { label: 'Current credit', value: moneyCents(credit), color: 'var(--ink)' },
      { label: 'Issuing', value: '+' + moneyCents(amt), color: 'var(--amber)' },
      { label: 'New balance', value: moneyCents(credit + amt), color: 'var(--accentInk)' },
    ]
    permText = over
      ? 'Over your ' + limitText(cr) + ' as ' + roleLabel + '.'
      : 'Within your ' + limitText(cr) + ' as ' + roleLabel + '. Credit can be applied to any future invoice.'
    permOk = !blocked
    submitLabel = 'Issue ' + moneyCents(amt) + ' credit'
    if (!blocked)
      plan = {
        events: [{ type: 'credit_issue', amt: r2(amt), reason, note: f.note, expiry: f.expiry }],
        toast: moneyCents(amt) + ' credit issued to ' + tx.client,
      }
  }

  if (sk === 'collect') {
    summary = [{ label: 'Balance due', value: moneyCents(c.balance), color: 'var(--red)' }]
    permText = 'Receipt goes out by WhatsApp and email.'
    permOk = true
    submitLabel = 'Collect ' + moneyCents(c.balance)
    plan =
      f.method === 'Payment link'
        ? { events: [], toast: 'Payment link sent to ' + tx.client }
        : {
            events: [{ type: 'pay', amt: c.balance, method: f.method === 'Cash' ? 'Cash' : 'Visa ••4421' }],
            toast: 'Collected ' + moneyCents(c.balance),
          }
  }

  if (sk === 'apply') {
    const use = Math.min(credit, c.balance)
    summary = [
      { label: 'Available credit', value: moneyCents(credit), color: 'var(--amber)' },
      { label: 'Applying', value: moneyCents(use), color: 'var(--accentInk)' },
      { label: 'Balance after', value: moneyCents(c.balance - use), color: 'var(--red)' },
    ]
    permText = 'Store credit is used as a payment on this invoice.'
    permOk = true
    submitLabel = 'Apply ' + moneyCents(use)
    plan = {
      events: [{ type: 'credit_apply', amt: use, method: 'Store credit' }],
      toast: moneyCents(use) + ' credit applied',
    }
  }

  return { reasons, reason, summary, blocked, permText, permOk, submitLabel, plan, showSettle }
}

export const adjustValueLabel = (f: Pick<SheetForm, 'unit'>): string =>
  f.unit === '%' ? 'Percent of services' : 'Amount ($)'
