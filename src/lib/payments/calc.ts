import { r2 } from '../money'
import type { Invoice, InvoiceCalc, InvoiceStatus } from './types'

export const TAX = 0.07

/** The invoice arithmetic of the Payments design (calc()), copied expression for expression. */
export function calcInvoice(tx: Invoice): InvoiceCalc {
  const items = tx.items.reduce((a, x) => a + x.price, 0)
  const ev = tx.events
  const adj = ev.filter((e) => e.type === 'adjust').reduce((a, e) => a + e.amt, 0)
  const sub = items + adj
  const tax = r2(sub * TAX)
  const total = r2(sub + tax + tx.tip)
  const paidOrig = ev.filter((e) => e.type === 'pay').reduce((a, e) => a + e.amt, 0)
  const creditApplied = ev.filter((e) => e.type === 'credit_apply').reduce((a, e) => a + e.amt, 0)
  const paid = r2(paidOrig + creditApplied)
  const refs = ev.filter((e) => e.type === 'refund' && e.status === 'done')
  const refunded = r2(refs.reduce((a, e) => a + e.amt, 0))
  const refOrig = r2(refs.filter((e) => e.dest !== 'credit').reduce((a, e) => a + e.amt, 0))
  const pending = ev.filter((e) => e.type === 'refund' && e.status === 'pending')
  const balance = tx.canceled ? 0 : Math.max(0, r2(total - paid))
  const refundable = Math.max(0, r2(paid - refunded - pending.reduce((a, e) => a + e.amt, 0)))
  const toOrigMax = Math.max(0, r2(paidOrig - refOrig))
  const issued = ev.filter((e) => e.type === 'credit_issue').reduce((a, e) => a + e.amt, 0)
  let status: InvoiceStatus = 'Paid'
  if (tx.canceled && refunded >= paid) status = 'Canceled · refunded'
  else if (refunded > 0 && refunded >= paid - 0.01) status = 'Refunded'
  else if (paid === 0) status = 'Unpaid'
  else if (balance > 0) status = 'Partially paid'
  else if (refunded > 0) status = 'Partially refunded'
  return {
    items,
    adj,
    sub,
    tax,
    total,
    paid,
    paidOrig,
    creditApplied,
    refunded,
    pending,
    balance,
    refundable,
    toOrigMax,
    issued,
    status,
    net: r2(items + adj - refunded / (1 + TAX)),
  }
}

/** Store credit a client holds across the given invoices: issued, plus refunds sent to credit, minus applied. */
export function clientCredit(txs: readonly Invoice[], name: string): number {
  let b = 0
  txs
    .filter((t) => t.client === name)
    .forEach((t) =>
      t.events.forEach((e) => {
        if (e.type === 'credit_issue') b += e.amt
        if (e.type === 'refund' && e.status === 'done' && e.dest === 'credit') b += e.amt
        if (e.type === 'credit_apply') b -= e.amt
      }),
    )
  return r2(b)
}
