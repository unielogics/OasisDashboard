// Settings → Billing & integrations → "Square item library" (live variant only; ADR 0172, backend api-spec 30.14; DEVIATIONS
// DV-911), the Prices by size sync dots (DV-912) and the Catalog's "archived in Square" word (DV-913), pure: the server's
// state in plain words. The server decides everything (what is on Square, the tax check, the preview); these helpers only
// word it. Nothing here talks to the API or keeps state.
import type { SquareItemsRes, SquareItemsSyncRes } from '@/data/ports/settings-api'
import type { Line } from './billing'

export type ItemsView = SquareItemsRes
export type TaxCheck = NonNullable<SquareItemsRes['taxCheck']>
export type ItemsPreview = NonNullable<SquareItemsRes['preview']>

const plural = (n: number, one: string, many: string): string => n + ' ' + (n === 1 ? one : many)

/** Where the item sync stands: on (it writes), watch only (Square writes off: previews only), or off. */
export function itemsHeadline(v: Pick<ItemsView, 'mode'>): { text: string; tone: Line['tone'] } {
  if (v.mode === 'on') return { text: 'On · Oasis services and prices are kept in step with Square', tone: 'green' }
  if (v.mode === 'preview')
    return { text: 'Watch only · Square writes are off, so nothing is made in Square', tone: 'amber' }
  return { text: 'Off · the item sync is switched off on the server', tone: 'ink' }
}

/** What the button does in this mode. */
export function syncNote(v: Pick<ItemsView, 'mode'>): string {
  return v.mode === 'on'
    ? 'Sync now sends price changes at once. It also runs by itself every 5 minutes, and checks everything at 4:40 AM.'
    : 'Sync now only reads Square and shows what the sync would do. Nothing is written.'
}

/**
 * The tax line: the check's own words (the server writes them plainly), coloured by what it means for the sync: green when
 * Oasis items carry a tax at Oasis's rate, amber when Oasis's own tax was edited in Square (the next sync puts it back),
 * neutral when the sync will add Oasis's own, red when the sync is paused (no match, several, or Square did not answer).
 */
export function taxLine(t: TaxCheck | null): { text: string; tone: Line['tone'] } {
  if (!t) return { text: 'Not checked yet. Sync now or Test connection checks it.', tone: 'ink' }
  if (t.status === 'ok') return { text: t.detail, tone: t.ownChanged.length ? 'amber' : 'green' }
  if (t.status === 'create') return { text: t.detail, tone: 'ink' }
  if (t.status === 'error') return { text: 'Couldn’t check Square’s tax: ' + t.detail, tone: 'red' }
  return { text: t.detail, tone: 'red' }
}

/** The CalculateOrder sample of the check ("All 9 sample totals match Square to the cent"), when it ran. */
export function roundingLine(t: TaxCheck | null): { text: string; tone: Line['tone'] } | null {
  const r = t?.rounding
  if (!r || r.checked === 0) return null
  const d = r.detail.charAt(0).toUpperCase() + r.detail.slice(1)
  return { text: d, tone: r.differ === 0 ? 'green' : 'amber' }
}

/** One row per Square tax the shop has (Oasis's own excluded): its rate and why it does or does not fit. */
export function candidateRows(
  t: TaxCheck | null,
  picked: string | null,
): Array<{ id: string; text: string; tone: Line['tone']; canUse: boolean; inUse: boolean }> {
  if (!t) return []
  return t.candidates.map((c) => {
    const inUse = c.id === picked || (t.status === 'ok' && !t.own && c.id === t.taxId)
    return {
      id: c.id,
      text:
        '“' +
        c.name +
        '” ' +
        (c.percentage === null ? '(no rate)' : c.percentage + '%') +
        ' · ' +
        (c.matches ? (inUse ? 'used for Oasis items' : 'matches Oasis') : (c.problem ?? 'does not match Oasis')),
      tone: c.matches ? 'green' : 'ink',
      canUse: c.matches && !inUse,
      inUse,
    }
  })
}

/** Which Square tax Oasis items carry, as the person picked it (PUT …/items/tax). */
export function taxModeText(v: Pick<ItemsView, 'taxMode'>, t: TaxCheck | null): string {
  if (v.taxMode === 'create') return 'Oasis items carry Oasis’s own tax “Sales tax”.'
  if (v.taxMode === 'adopt')
    return 'Oasis items carry the Square tax picked here' + (t?.taxName ? ': “' + t.taxName + '”.' : '.')
  return 'Automatic: the one Square tax at Oasis’s rate, or Oasis’s own when the shop has none.'
}

/** "On Square 17 · Waiting 2 · Failed 1 · Archived 3 · Not sold 2"; only the counts that are not zero, On Square always. */
export function countsText(c: ItemsView['counts']): string {
  return [
    'On Square ' + c.onSquare,
    c.waiting ? 'Waiting ' + c.waiting : null,
    c.failed ? 'Failed ' + c.failed : null,
    c.archived ? 'Archived ' + c.archived : null,
    c.notSold ? 'Not sold ' + c.notSold : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * The counts mean something once Oasis has items in Square: while the sync is on, or when items made earlier are there
 * (the sync switched off since). In watch-only mode every service would read "waiting": the preview says it instead.
 */
export const showCounts = (v: Pick<ItemsView, 'mode' | 'counts'>): boolean =>
  v.mode === 'on' || v.counts.onSquare + v.counts.failed + v.counts.archived > 0

const TAX_PLAN: Record<ItemsPreview['tax'], string> = {
  create: 'adds Oasis’s own “Sales tax”',
  update: 'updates Oasis’s Square tax',
  adopt: 'uses the shop’s Square tax',
  none: 'leaves the tax as it is',
  blocked: 'is paused: Square’s tax doesn’t match Oasis',
}

/** The last read-only preview in plain words: "Would make 19 items with 87 prices and 4 categories; …". */
export function previewText(p: ItemsPreview): string {
  const make =
    p.create > 0
      ? 'Would make ' +
        plural(p.create, 'item', 'items') +
        ' with ' +
        plural(p.createPrices, 'price', 'prices') +
        (p.categories ? ' and ' + plural(p.categories, 'category', 'categories') : '')
      : 'Would make nothing new'
  const rest = [
    p.update ? 'update ' + p.update : null,
    p.archive ? 'archive ' + p.archive : null,
    p.unchanged ? p.unchanged + ' already the same' : null,
    p.skipped ? plural(p.skipped, 'service', 'services') + ' not sold (off, quote only or no price)' : null,
  ].filter(Boolean)
  return make + (rest.length ? '; ' + rest.join(', ') : '') + '. The tax: ' + TAX_PLAN[p.tax] + '.'
}

/** The toast of "Sync now", from the server's answer. */
export function itemsSyncToast(r: SquareItemsSyncRes): string {
  if (r.status === 'skipped') return 'Not synced: ' + (r.reason ?? 'the item sync is off')
  if (r.status === 'blocked') return 'Not synced: ' + (r.reason ?? 'Square’s tax doesn’t match Oasis')
  if (r.status === 'preview')
    return r.preview ? 'Preview · ' + previewText(r.preview) : 'Preview · ' + (r.reason ?? 'nothing to show')
  const parts = [
    r.created ? r.created + ' made' : null,
    r.updated ? r.updated + ' updated' : null,
    r.archived ? r.archived + ' archived' : null,
    r.recreated ? r.recreated + ' made again' : null,
    r.adopted ? r.adopted + ' found again' : null,
    r.restored ? r.restored + ' put back' : null,
    r.failed ? r.failed + ' failed' : null,
  ].filter(Boolean)
  return 'Synced with Square' + (parts.length ? ' · ' + parts.join(' · ') : ' · nothing to change')
}

/** The toast of "Archive Oasis items in Square". */
export function archiveToast(r: { archived: number; alreadyArchived: number; failed: number }): string {
  const parts = [
    plural(r.archived, 'item', 'items') + ' archived in Square',
    r.alreadyArchived ? r.alreadyArchived + ' already archived' : null,
    r.failed ? r.failed + ' failed' : null,
  ].filter(Boolean)
  return parts.join(' · ')
}

// ---- Prices by size (DV-912) and the Catalog list (DV-913) ------------------------------------------------------------

/** GET /catalog's price row `square` block: present only while the item sync is on, for set.services holders. */
export interface PriceRowSquare {
  state: 'synced' | 'pending' | 'failed' | 'archived' | 'not_sold'
  cells: Record<string, 'synced' | 'pending' | 'failed' | 'hidden'>
  error: string | null
}

const CELL_WORDS: Record<PriceRowSquare['cells'][string], { title: string; colour: string }> = {
  synced: { title: 'On Square', colour: '#0E9E6E' },
  pending: { title: 'Waiting for Square (the next sync sends it)', colour: '#FFB547' },
  failed: { title: 'Square sync failed', colour: '#C2410C' },
  hidden: { title: 'Hidden in Square', colour: 'var(--ink3)' },
}

/**
 * The dot of one price cell: null when the server sends no state for that size (the sync is off, or Oasis does not sell
 * the service at that size). A failed cell's title carries the server's reason.
 */
export function cellDot(sq: PriceRowSquare | undefined, sizeKey: string): { title: string; colour: string } | null {
  const st = sq?.cells[sizeKey]
  if (!sq || !st) return null
  const w = CELL_WORDS[st]
  return { title: st === 'failed' && sq.error ? w.title + ': ' + sq.error : w.title, colour: w.colour }
}

/** The service's Square state as a few words for the row's line (also covers a service sold at one price, key ""). */
export function rowSquareText(sq: PriceRowSquare | undefined): string {
  if (!sq) return ''
  switch (sq.state) {
    case 'synced':
      return 'on Square'
    case 'pending':
      return 'waiting for Square'
    case 'failed':
      return 'Square sync failed'
    case 'archived':
      return 'archived in Square'
    default:
      return 'not on Square'
  }
}
