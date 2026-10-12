// Settings → Vehicle sizes and Prices by size (live variant only; ADR 0170, backend api-spec 15.9; DV-322, DV-323): the
// pure half of the forms. Prices travel as integer cents and are typed as whole dollars; the grid shows whole dollars
// rounded half up. Nothing here talks to the API or keeps state. The server is the judge of every rule (422 with the
// field); these helpers only shape what is sent and say early what the server would refuse anyway, in plain words.
import { keyFromLabel } from './catalog'
import type { Checked } from './catalog'

/** A vehicle size as GET /catalog sends it. */
export interface VehicleClassItem {
  key: string
  label: string
  sort: number
  active: boolean
  version: number
}

/** One price of a service at a size (`maxCents`: an "up to" price, a range, tint). */
export interface PriceCell {
  class: string
  cents: number
  maxCents: number | null
}

/** One row of the grid as GET /catalog sends it: the service's cells, its version, starting price and missing count. */
export interface PriceRowItem {
  serviceId: string
  version: number
  cells: PriceCell[]
  fromCents: number
  missing: number
}

/** The server's limits (api-spec 15.9, 15.10). */
export const SIZE_LIMITS = {
  label: 40,
  sizes: 12,
  maxPriceCents: 10_000_000,
  maxFeeCents: 100_000,
} as const

/** Sizes in size order (smallest first), as the server lists them. */
export const sortSizes = <T extends Pick<VehicleClassItem, 'sort' | 'key'>>(list: readonly T[]): T[] =>
  [...list].sort((a, b) => a.sort - b.sort || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

/** The key a new size gets from its name ("Large SUV" -> large_suv); set once, never changes. */
export const sizeKeyFromLabel = keyFromLabel

/** What the server would refuse about a size's name (and, for a new one, its key), in plain words; null when fine. */
export function sizeProblem(
  label: string,
  key: string | null,
  sizes: readonly VehicleClassItem[],
  selfKey: string | null = null,
): string | null {
  const t = label.trim()
  if (t === '') return 'Give the size a name.'
  if (t.length > SIZE_LIMITS.label) return `The name is at most ${SIZE_LIMITS.label} characters.`
  if (key !== null) {
    if (key === '') return 'Start the name with a letter.'
    if (sizes.some((s) => s.key === key)) return 'There is already a size with that name.'
  }
  if (sizes.some((s) => s.key !== selfKey && s.label.trim().toLowerCase() === t.toLowerCase()))
    return 'There is already a size with that name.'
  return null
}

const plural = (n: number, one: string, many: string): string => n + ' ' + (n === 1 ? one : many)

/** 409 CLASS_IN_USE in plain words from the counts the server sends (`meta`). */
export function sizeInUseMessage(label: string, meta: Record<string, unknown>): string {
  const n = (k: string): number => (typeof meta[k] === 'number' ? (meta[k] as number) : 0)
  const parts = [
    n('prices') && plural(n('prices'), 'price', 'prices'),
    n('tierPrices') && plural(n('tierPrices'), 'membership price', 'membership prices'),
    n('memberships') && plural(n('memberships'), 'membership', 'memberships'),
    n('checkouts') && plural(n('checkouts'), 'membership sign-up', 'membership sign-ups'),
    n('creditEvents') && plural(n('creditEvents'), 'member credit', 'member credits'),
    n('appointments') && plural(n('appointments'), 'visit', 'visits'),
    n('vehicles') && plural(n('vehicles'), 'vehicle', 'vehicles'),
  ].filter(Boolean) as string[]
  return (
    label +
    ' is in use' +
    (parts.length ? ' (' + parts.join(', ') + ')' : '') +
    ', so it can’t be removed. Turn it off instead.'
  )
}

// ---- whole dollars ---------------------------------------------------------------------------------------------------

/** Cents as whole dollars, rounded half up: 4000 -> "40", 4550 -> "46", 1250000 -> "12500"; null -> "". */
export function wholeText(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return ''
  return String(Math.floor((cents + 50) / 100))
}

/** "$" + whole dollars with thousands separators, rounded half up: 4000 -> "$40", 125049 -> "$1,250". */
export function wholeMoney(cents: number): string {
  return '$' + Math.floor((cents + 50) / 100).toLocaleString('en-US')
}

/** Typed whole dollars to cents: "40", "$40", "1,250". "" is null (not set); anything else (cents, letters) undefined. */
export function parseWhole(text: string): number | null | undefined {
  const t = text.replace(/[\s$,]/g, '')
  if (t === '') return null
  if (!/^\d{1,7}$/.test(t)) return undefined
  return Number(t) * 100
}

// ---- the price grid --------------------------------------------------------------------------------------------------

/** The boxes of one cell as typed: the price and, in a range row, the "up to" price. */
export interface CellDraft {
  from: string
  to: string
}

/** One service's row of the grid as typed, by size key (only the sizes on screen). */
export type RowDraft = Record<string, CellDraft>

/** The row's boxes from the server's cells, for the given sizes (whole dollars). */
export function rowDraft(row: PriceRowItem | undefined, sizes: readonly VehicleClassItem[]): RowDraft {
  const out: RowDraft = {}
  for (const s of sizes) {
    const c = row?.cells.find((x) => x.class === s.key)
    out[s.key] = { from: wholeText(c?.cents), to: wholeText(c?.maxCents) }
  }
  return out
}

/** A row shows "from–to" boxes when its service is a tint or one of its prices already is a range. */
export const isRangeRow = (category: string, row: PriceRowItem | undefined): boolean =>
  category === 'tint' || !!row?.cells.some((c) => c.maxCents !== null)

export interface SentCell {
  class: string
  cents: number | null
  maxCents: number | null
}

/**
 * The cells of one row that changed against the server's copy (`base`), as PUT /catalog/prices takes them, or the
 * first thing the server would refuse. A cell left as the server sent it is not sent (the server keeps it, cents and
 * all); an emptied cell clears the price ("not set").
 */
export function changedCells(
  d: RowDraft,
  base: RowDraft,
  sizes: readonly VehicleClassItem[],
  where: string,
): Checked<SentCell[]> {
  const out: SentCell[] = []
  for (const s of sizes) {
    const c = d[s.key] ?? { from: '', to: '' }
    const b = base[s.key] ?? { from: '', to: '' }
    if (c.from.trim() === b.from.trim() && c.to.trim() === b.to.trim()) continue
    const at = where + ' · ' + s.label
    const from = parseWhole(c.from)
    const to = parseWhole(c.to)
    if (from === undefined || to === undefined)
      return { ok: false, field: s.key, message: `${at}: enter whole dollars, like 40.` }
    if (from === null && to !== null)
      return { ok: false, field: s.key, message: `${at}: set the price before the “up to” price.` }
    if ((from ?? 0) > SIZE_LIMITS.maxPriceCents || (to ?? 0) > SIZE_LIMITS.maxPriceCents)
      return { ok: false, field: s.key, message: `${at}: prices go up to $100,000.` }
    if (from !== null && to !== null && to < from)
      return { ok: false, field: s.key, message: `${at}: the “up to” price can’t be below the price.` }
    out.push({ class: s.key, cents: from, maxCents: from === null ? null : to })
  }
  return { ok: true, value: out }
}

/** How many boxes of a row are empty (not set) among the sizes on screen. */
export const emptyCells = (d: RowDraft, sizes: readonly VehicleClassItem[]): number =>
  sizes.filter((s) => (d[s.key]?.from ?? '').trim() === '').length

/** "1 price not set", "12 prices not set"; "" when every price is set. */
export const notSetText = (n: number): string => (n ? plural(n, 'price', 'prices') + ' not set' : '')

/**
 * The line of a service in Catalog: its starting price and how many sizes have no price ("from $40 · 4 sizes not set").
 * A service without any price at an active size still books at its base price until it gets one.
 */
export function fromLine(
  row: PriceRowItem | undefined,
  quoteOnly: boolean,
  priceCents: number,
  sizes: readonly VehicleClassItem[],
): string {
  if (quoteOnly) return 'Quote only'
  const active = sizes.filter((s) => s.active)
  const set = active.filter((s) => row?.cells.some((c) => c.class === s.key)).length
  if (!set) return 'No prices yet' + (priceCents ? ' · books at ' + wholeMoney(priceCents) : '')
  const missing = active.length - set
  return 'from ' + wholeMoney(row!.fromCents) + (missing ? ' · ' + plural(missing, 'size', 'sizes') + ' not set' : '')
}

/** A 412 on the grid in plain words: which service changed meanwhile (the server names the row). */
export function staleRowMessage(name: string | null): string {
  return (
    (name ? 'Someone else changed the prices of ' + name : 'Someone else changed these prices') +
    ' meanwhile, so nothing was saved. Their change is on screen now with your edits kept: check and save again.'
  )
}

// ---- the booking fee -------------------------------------------------------------------------------------------------

export type FeeCollect = 'counter' | 'link'

export interface GuestFeeView {
  cents: number
  collect: FeeCollect
  version: number
}

export interface FeeDraft {
  amount: string
  collect: FeeCollect
}

export const feeDraft = (f: GuestFeeView): FeeDraft => ({ amount: wholeText(f.cents), collect: f.collect })

/** PUT /catalog/guest-fee: whole dollars from $0 to $1,000, how it is collected, the version it was edited from. */
export function feeBody(d: FeeDraft, version: number): Checked<{ cents: number; collect: FeeCollect; version: number }> {
  const cents = parseWhole(d.amount)
  if (cents === undefined || cents === null)
    return { ok: false, field: 'amount', message: 'Enter the fee in whole dollars, like 25 (0 for none).' }
  if (cents > SIZE_LIMITS.maxFeeCents) return { ok: false, field: 'amount', message: 'The fee goes up to $1,000.' }
  return { ok: true, value: { cents, collect: d.collect, version } }
}
