import { moneyCents, moneyWhole0 } from '../money'
import { TAX } from './calc'
import { fmtDate } from './dates'
import { displayPill, displayStatus } from './filters'
import { limitFor, canCollectPayments } from './limits'
import { actionStyle, approveButtonStyle, ledgerDotStyle, lineStyles } from './styles'
import type { LineKind } from './styles'
import type {
  Invoice,
  InvoiceCalc,
  LedgerEvent,
  LocalDay,
  RolesConfig,
  SheetKind,
  StyleObject,
} from './types'

export interface LineView {
  label: string
  value: string
  style: StyleObject
  labelStyle: StyleObject
  valStyle: StyleObject
}

const line = (label: string, value: string, kind?: LineKind): LineView => ({
  label,
  value,
  ...lineStyles(kind),
})

/** The invoice breakdown under the detail header: items, adjustments, tax, tip, total, credit, paid, refunded. */
export function invoiceLines(tx: Invoice, c: InvoiceCalc): LineView[] {
  return [
    ...tx.items.map((i) => line(i.name, moneyCents(i.price))),
    ...tx.events
      .filter((e) => e.type === 'adjust')
      .map((e) =>
        line(
          (e.amt < 0 ? 'Discount · ' : 'Surcharge · ') + e.reason,
          moneyCents(e.amt),
          e.amt < 0 ? 'neg' : null,
        ),
      ),
    line('Tax (7%)', moneyCents(c.tax)),
    ...(tx.tip ? [line('Tip', moneyCents(tx.tip))] : []),
    line('Total', moneyCents(c.total), 'total'),
    ...(c.creditApplied ? [line('Store credit applied', moneyCents(-c.creditApplied), 'pos')] : []),
    line('Paid', moneyCents(c.paidOrig)),
    ...(c.refunded ? [line('Refunded', moneyCents(-c.refunded), 'neg')] : []),
  ]
}

export interface BigNumber {
  label: string
  value: string
  color: string
}

export function bigNumbers(c: InvoiceCalc): BigNumber[] {
  return [
    { label: 'Total', value: moneyCents(c.total), color: 'var(--ink)' },
    { label: 'Collected', value: moneyCents(c.paid - c.refunded), color: 'var(--accentInk)' },
    c.balance > 0
      ? { label: 'Balance due', value: moneyCents(c.balance), color: 'var(--red)' }
      : { label: 'Refundable', value: moneyCents(c.refundable), color: 'var(--ink)' },
  ]
}

export type ActionKind = SheetKind | 'receipt'

export interface ActionSpec {
  kind: ActionKind
  label: string
  ok: boolean
  why: string
  primary: boolean
  style: StyleObject
}

const action = (kind: ActionKind, label: string, ok: boolean, why: string, primary = false): ActionSpec => ({
  kind,
  label,
  ok,
  why: ok ? '' : why,
  primary,
  style: actionStyle(ok, primary),
})

/** The invoice action buttons in display order, with their enabled state and the reason a disabled one gives. */
export function invoiceActions(
  tx: Invoice,
  c: InvoiceCalc,
  credit: number,
  rc: RolesConfig,
  role: string,
): ActionSpec[] {
  const rf = limitFor(rc, role, 'refund')
  const ad = limitFor(rc, role, 'adjust')
  const cr = limitFor(rc, role, 'credit')
  const canCollect = canCollectPayments(rc, role)
  const actions: ActionSpec[] = []
  if (c.balance > 0)
    actions.push(
      action('collect', 'Collect ' + moneyCents(c.balance), canCollect, 'Role can’t collect payments', true),
    )
  if (c.balance > 0 && credit > 0)
    actions.push(
      action(
        'apply',
        'Apply ' + moneyCents(Math.min(credit, c.balance)) + ' credit',
        canCollect,
        'Role can’t collect payments',
      ),
    )
  actions.push(
    action(
      'refund',
      'Refund',
      rf.has && c.refundable > 0,
      rf.has ? 'Nothing left to refund' : 'Role can’t issue refunds',
    ),
  )
  actions.push(action('adjust', 'Adjust', ad.has && !tx.canceled, 'Role can’t adjust invoices'))
  actions.push(action('credit', 'Issue credit', cr.has, 'Role can’t issue credits'))
  actions.push(action('receipt', 'Send receipt', true, ''))
  return actions
}

const GLYPH: Record<string, string> = {
  pay: '$',
  adjust: '±',
  refund: '↩',
  credit_issue: '+',
  credit_apply: '◆',
}

export interface LedgerView {
  glyph: string | undefined
  title: string | undefined
  meta: string
  amt: string
  amtColor: string
  dot: StyleObject
  pending: boolean
  approveNote: string
  approveStyle: StyleObject
}

export interface LedgerEntry {
  view: LedgerView
  canApprove: boolean
  index: number
  event: LedgerEvent
}

/** One ledger row per event, oldest first (the screen reverses them). */
export function ledgerEntries(tx: Invoice, rc: RolesConfig, role: string): LedgerEntry[] {
  return tx.events.map((e, i) => {
    const pend = e.type === 'refund' && e.status === 'pending'
    const den = e.status === 'denied'
    const col =
      e.type === 'refund'
        ? 'var(--red)'
        : e.type === 'adjust'
          ? e.amt < 0
            ? 'var(--red)'
            : 'var(--ink)'
          : e.type === 'credit_issue' || e.type === 'credit_apply'
            ? 'var(--amber)'
            : 'var(--accentInk)'
    const title = {
      pay: e.deposit ? 'Deposit · ' + e.method : 'Payment · ' + e.method,
      adjust: (e.amt < 0 ? 'Discount' : 'Surcharge') + ' · ' + e.reason,
      refund:
        (pend ? 'Refund requested' : den ? 'Refund denied' : 'Refund') +
        ' · ' +
        (e.dest === 'credit' ? 'to store credit' : e.dest === 'cash' ? 'cash' : e.method),
      credit_issue: 'Credit issued · ' + e.reason,
      credit_apply: 'Store credit applied',
    }[e.type]
    const meta = [
      e.t,
      e.by ? e.by + (e.byRole ? ' (' + e.byRole + ')' : '') : null,
      e.type === 'refund' && e.reason ? e.reason : null,
      e.note,
      e.expiry ? 'Expires: ' + e.expiry : null,
      e.approvedBy ? 'Approved by ' + e.approvedBy : null,
    ]
      .filter(Boolean)
      .join(' · ')
    const ap = limitFor(rc, role, 'refund')
    const canApprove = ap.has && ap.max >= e.amt
    return {
      canApprove,
      index: i,
      event: e,
      view: {
        glyph: GLYPH[e.type],
        title,
        meta,
        amt:
          (e.type === 'pay' || e.type === 'credit_apply'
            ? ''
            : e.type === 'refund'
              ? '−'
              : e.type === 'credit_issue'
                ? '+'
                : '') + moneyCents(Math.abs(e.amt)).replace('−', e.type === 'adjust' && e.amt < 0 ? '−' : ''),
        amtColor: den ? 'var(--ink3)' : col,
        dot: ledgerDotStyle(pend, col),
        pending: pend,
        approveNote: canApprove
          ? 'You can approve up to ' + (ap.max === Infinity ? 'any amount' : moneyWhole0(ap.max)) + '.'
          : 'Needs a role with a refund limit of at least ' + moneyWhole0(e.amt) + '.',
        approveStyle: approveButtonStyle(canApprove),
      },
    }
  })
}

export interface DetailHeader {
  id: string
  when: string
  client: string
  vehicle: string
  staff: string
  status: string
  statusStyle: StyleObject
}

export function detailHeader(tx: Invoice, c: InvoiceCalc, anchor: LocalDay): DetailHeader {
  return {
    id: tx.id,
    when: fmtDate(anchor, tx.off) + ' ' + tx.time,
    client: tx.client,
    vehicle: tx.vehicle,
    staff: tx.staff,
    status: displayStatus(c),
    statusStyle: displayPill(c),
  }
}

export const creditLine = (tx: Invoice, credit: number): string =>
  credit > 0 ? tx.client.split(' ')[0] + ' has ' + moneyCents(credit) + ' in store credit' : ''

/** Refund-by-item row value: the item's price with tax. */
export const itemRefundValue = (price: number): string => moneyCents(price * (1 + TAX))
