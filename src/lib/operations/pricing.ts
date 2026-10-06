// Pricing as the Operations design computes it: whole dollars, tax rounded per appointment with Math.round on a float.
// This is deliberately NOT the cents model (lib/money.taxCents); it changes only in the live wiring stage, when
// the invoice totals come from the server.
import { moneyWhole } from '../money'
import type { Appt } from './types'

export const TAX_RATE = 0.07

export interface Totals {
  sub: number
  addon: number
  credit: number
  tax: number
  tip: number
  grand: number
}

type Priced = Pick<Appt, 'addons' | 'price' | 'member' | 'tip'>

/** total(a): the member credit expression is always 0 for valid prices (`Math.min(price, 0)`), kept as written. */
export function total(a: Priced): Totals {
  const addon = (a.addons || []).reduce((s, x) => s + x.price, 0)
  const sub = a.price + addon
  const credit = a.member ? Math.min(a.price, a.member === 'Exotic' ? 0 : 0) : 0
  const tax = Math.round((sub - credit) * TAX_RATE)
  return { sub, addon, credit, tax, tip: a.tip || 0, grand: sub - credit + tax + (a.tip || 0) }
}

/** balance(a): what is still owed (a deposit is subtracted from the grand total, tip included). */
export function balance(a: Priced & Pick<Appt, 'pay' | 'deposit'>): number {
  const t = total(a)
  if (a.pay === 'paid') return 0
  if (a.pay === 'deposit') return t.grand - (a.deposit || 0)
  return t.grand
}

export const money = moneyWhole
