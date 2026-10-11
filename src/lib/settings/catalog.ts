// Settings → Catalog and Categories (live variant only; ADR 0160 plan A and K, backend api-spec 15.8): the pure half of
// the forms. Prices travel as integer cents and are typed as dollars; nothing here talks to the API or keeps state.
// The server is the judge of every rule (422 with the field); these helpers only shape what is sent and say early what
// the server would refuse anyway, in its words.

export type VipInclusion = 'included' | 'allowance' | 'none'

/** A catalog service as GET /catalog sends it (the fields the forms read). */
export interface CatalogItem {
  id: string
  kind: 'package' | 'addon'
  name: string
  active: boolean
  category: string
  publicName: string | null
  description: string | null
  memberPriceCents: number | null
  guestPriceCents: number | null
  vipInclusion: VipInclusion
  vipNote: string | null
  quoteOnly: boolean
  visibleOnline: boolean
  sort: number
  priceCents: number
  durationMin: number
  tags: string[]
  effective: { memberPriceCents: number; guestPriceCents: number; tintFilm: string | null }
  version: number
}

export interface ServiceDraft {
  category: string
  publicName: string
  description: string
  member: string
  guest: string
  vipInclusion: VipInclusion
  vipNote: string
  quoteOnly: boolean
  visibleOnline: boolean
  sort: number
}

export interface ServiceBody {
  category: string
  publicName: string | null
  description: string | null
  memberPriceCents: number | null
  guestPriceCents: number | null
  vipInclusion: VipInclusion
  vipNote: string | null
  quoteOnly: boolean
  visibleOnline: boolean
  sort: number
  version: number
}

export type Checked<T> = { ok: true; value: T } | { ok: false; field: string; message: string }

/** The server's limits (api-spec 15.8): texts, prices and perks. */
export const LIMITS = {
  publicName: 80,
  description: 1000,
  vipNote: 200,
  maxPriceCents: 10_000_000,
  perks: 12,
  perk: 120,
  planLabel: 40,
  url: 2048,
  categoryLabel: 40,
  categories: 20,
} as const

/** Cents as the dollars a person types: 4500 -> "45", 4550 -> "45.50"; null -> "". */
export function dollarsText(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return ''
  const whole = Math.trunc(cents / 100)
  const frac = Math.abs(cents % 100)
  return frac ? `${whole}.${String(frac).padStart(2, '0')}` : String(whole)
}

/** "$" + dollars with thousands separators; cents only when not whole ("$45", "$1,250", "$45.50"). */
export function money(cents: number): string {
  const sign = cents < 0 ? '−' : ''
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100).toLocaleString('en-US')
  const frac = abs % 100
  return sign + '$' + whole + (frac ? '.' + String(frac).padStart(2, '0') : '')
}

/**
 * Typed dollars to cents: "45", "$45", "45.5", "1,250.00". "" is null (no price). Anything else (letters, three
 * decimals, a minus) is undefined: the form says "Enter a price like 45 or 45.50".
 */
export function parseDollars(text: string): number | null | undefined {
  const t = text.replace(/[\s$,]/g, '')
  if (t === '') return null
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(t)
  if (!m) return undefined
  return Number(m[1]) * 100 + (m[2] ? Number(m[2].padEnd(2, '0')) : 0)
}

/** The guest price the server derives from a member price: member × (100 + markup) / 100, half up to whole dollars. */
export function autoGuestCents(memberCents: number, markupPct: number): number {
  return Math.floor((memberCents * (100 + markupPct)) / 10_000 + 0.5) * 100
}

export function serviceDraft(s: CatalogItem): ServiceDraft {
  return {
    category: s.category,
    publicName: s.publicName ?? '',
    description: s.description ?? '',
    member: dollarsText(s.memberPriceCents),
    guest: dollarsText(s.guestPriceCents),
    vipInclusion: s.vipInclusion,
    vipNote: s.vipNote ?? '',
    quoteOnly: s.quoteOnly,
    visibleOnline: s.visibleOnline,
    sort: s.sort,
  }
}

export const sameDraft = <T>(a: T, b: T): boolean => JSON.stringify(a) === JSON.stringify(b)

const blankToNull = (t: string): string | null => (t.trim() === '' ? null : t.trim())

/** The PUT body of a service's website fields, or the first thing the server would refuse. */
export function serviceBody(d: ServiceDraft, version: number): Checked<ServiceBody> {
  const member = parseDollars(d.member)
  if (member === undefined) return { ok: false, field: 'member', message: 'Enter the member price like 45 or 45.50.' }
  const guest = parseDollars(d.guest)
  if (guest === undefined) return { ok: false, field: 'guest', message: 'Enter the guest price like 54 or 54.50.' }
  if ((member ?? 0) > LIMITS.maxPriceCents || (guest ?? 0) > LIMITS.maxPriceCents)
    return { ok: false, field: 'member', message: 'Prices go up to $100,000.' }
  if (guest !== null && member === null)
    return { ok: false, field: 'guest', message: 'Set a member price first: the guest price goes with it.' }
  if (guest !== null && member !== null && guest < member)
    return { ok: false, field: 'guest', message: 'The guest price can’t be lower than the member price.' }
  if (d.publicName.trim().length > LIMITS.publicName)
    return { ok: false, field: 'publicName', message: `The website name is at most ${LIMITS.publicName} characters.` }
  if (d.description.trim().length > LIMITS.description)
    return {
      ok: false,
      field: 'description',
      message: `The description is at most ${LIMITS.description} characters.`,
    }
  if (d.vipInclusion === 'allowance' && d.vipNote.trim() === '')
    return { ok: false, field: 'vipNote', message: 'Say how much VIP members get, like “2× a month”.' }
  if (d.vipNote.trim().length > LIMITS.vipNote)
    return { ok: false, field: 'vipNote', message: `The VIP note is at most ${LIMITS.vipNote} characters.` }
  return {
    ok: true,
    value: {
      category: d.category,
      publicName: blankToNull(d.publicName),
      description: blankToNull(d.description),
      memberPriceCents: member,
      guestPriceCents: guest,
      vipInclusion: d.vipInclusion,
      vipNote: d.vipInclusion === 'none' ? null : blankToNull(d.vipNote),
      quoteOnly: d.quoteOnly,
      visibleOnline: d.visibleOnline,
      sort: d.sort,
      version,
    },
  }
}

/**
 * The meta line of the selected service: what a booking charges today and how long it takes. Without a member price (and
 * no tint film) the server keeps the booking charge at its last price (backend catalog/pricing.ts bookingPriceOf), so the
 * line says that a member price is what changes it.
 */
export function serviceMeta(s: CatalogItem): string {
  const kept = s.memberPriceCents === null && !s.effective.tintFilm
  const parts = [
    s.quoteOnly
      ? 'Quote only'
      : 'Booking charges ' + money(s.priceCents) + (kept ? ', its last price: a member price here changes it' : ''),
    s.durationMin + ' min',
  ]
  if (s.effective.tintFilm) parts.push('priced by the tint table')
  return parts.join(' · ')
}

/** The line under the guest box: what the website shows when the box is empty. */
export function guestHint(d: ServiceDraft, s: CatalogItem, markupPct: number): string {
  if (s.effective.tintFilm) return 'Tint is priced by the window tint table below.'
  const member = parseDollars(d.member)
  if (d.quoteOnly) return 'Quote only: the website shows no price.'
  if (member === undefined || member === null) return 'No member price: the website shows no price.'
  if (d.guest.trim() === '')
    return `Empty: guests pay ${money(autoGuestCents(member, markupPct))} (member price + ${markupPct}%).`
  return 'Guests pay this price.'
}

// ---- plans --------------------------------------------------------------------------------------------------------

export interface CatalogPlanItem {
  key: string
  name: string
  active: boolean
  publicLabel: string | null
  monthlyPriceCents: number | null
  perks: string[]
  checkoutUrl: string | null
  websiteTier: 'gold' | 'vip' | null
  version: number
}

export interface PlanDraft {
  publicLabel: string
  monthly: string
  perks: string
  checkoutUrl: string
}

export interface PlanBody {
  publicLabel: string | null
  monthlyPriceCents: number | null
  perks: string[]
  checkoutUrl: string | null
  version: number
}

export function planDraft(p: CatalogPlanItem): PlanDraft {
  return {
    publicLabel: p.publicLabel ?? '',
    monthly: dollarsText(p.monthlyPriceCents),
    perks: p.perks.join('\n'),
    checkoutUrl: p.checkoutUrl ?? '',
  }
}

/** A Squarespace checkout link as the server takes it: https on squarespace.com or a subdomain, no user, no port. */
export function checkoutUrlProblem(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  let u: URL
  try {
    u = new URL(t)
  } catch {
    return 'Paste the full Squarespace checkout link, starting with https://'
  }
  const host = u.hostname.toLowerCase()
  if (u.protocol !== 'https:' || u.username || u.password || u.port)
    return 'The checkout link must be a plain https:// link.'
  if (host !== 'squarespace.com' && !host.endsWith('.squarespace.com'))
    return 'The checkout link must be on squarespace.com.'
  if (t.length > LIMITS.url) return 'That link is too long.'
  return null
}

export function planBody(d: PlanDraft, version: number): Checked<PlanBody> {
  const monthly = parseDollars(d.monthly)
  if (monthly === undefined)
    return { ok: false, field: 'monthly', message: 'Enter the monthly price like 99 or 99.50.' }
  const perks = [...new Set(d.perks.split('\n').map((x) => x.trim()).filter(Boolean))]
  if (perks.length > LIMITS.perks) return { ok: false, field: 'perks', message: `At most ${LIMITS.perks} perks.` }
  if (perks.some((p) => p.length > LIMITS.perk))
    return { ok: false, field: 'perks', message: `Each perk is at most ${LIMITS.perk} characters.` }
  if (d.publicLabel.trim().length > LIMITS.planLabel)
    return { ok: false, field: 'publicLabel', message: `The label is at most ${LIMITS.planLabel} characters.` }
  const urlProblem = checkoutUrlProblem(d.checkoutUrl)
  if (urlProblem) return { ok: false, field: 'checkoutUrl', message: urlProblem }
  return {
    ok: true,
    value: {
      publicLabel: blankToNull(d.publicLabel),
      monthlyPriceCents: monthly,
      perks,
      checkoutUrl: blankToNull(d.checkoutUrl),
      version,
    },
  }
}

// ---- tint table ------------------------------------------------------------------------------------------------------

export interface TintPriceRow {
  vehicle: string
  film: string
  memberMinCents: number
  memberMaxCents: number
  guestMinCents: number
  guestMaxCents: number
}

export interface TintMatrixView {
  vehicleTypes: { key: string; label: string }[]
  films: { key: string; label: string; vlt: number[] }[]
  prices: TintPriceRow[]
  version: number
}

/** The four boxes of one vehicle × film row, as typed. */
export interface TintCellDraft {
  memberMin: string
  memberMax: string
  guestMin: string
  guestMax: string
}

export type TintDraft = Record<string, TintCellDraft>

export const tintKey = (vehicle: string, film: string): string => vehicle + '|' + film

export function tintDraft(m: TintMatrixView): TintDraft {
  const out: TintDraft = {}
  for (const v of m.vehicleTypes)
    for (const f of m.films) {
      const p = m.prices.find((x) => x.vehicle === v.key && x.film === f.key)
      out[tintKey(v.key, f.key)] = {
        memberMin: dollarsText(p?.memberMinCents),
        memberMax: dollarsText(p?.memberMaxCents),
        guestMin: dollarsText(p?.guestMinCents),
        guestMax: dollarsText(p?.guestMaxCents),
      }
    }
  return out
}

/**
 * The whole matrix for the PUT (types and films unchanged). A pair left entirely empty is not priced (dropped); a pair
 * with some boxes filled needs all four, and no range may end below its start.
 */
export function tintBody(d: TintDraft, m: TintMatrixView): Checked<Omit<TintMatrixView, 'version'> & { version: number }> {
  const prices: TintPriceRow[] = []
  for (const v of m.vehicleTypes)
    for (const f of m.films) {
      const c = d[tintKey(v.key, f.key)]
      if (!c) continue
      const boxes = [c.memberMin, c.memberMax, c.guestMin, c.guestMax]
      if (boxes.every((b) => b.trim() === '')) continue
      const where = `${v.label} · ${f.label}`
      const cents = boxes.map(parseDollars)
      if (cents.some((x) => x === undefined || x === null))
        return { ok: false, field: 'tint', message: `${where}: fill all four prices, like 229.` }
      const [mMin, mMax, gMin, gMax] = cents as number[]
      if (mMax! < mMin! || gMax! < gMin!)
        return { ok: false, field: 'tint', message: `${where}: a range can’t end below where it starts.` }
      prices.push({
        vehicle: v.key,
        film: f.key,
        memberMinCents: mMin!,
        memberMaxCents: mMax!,
        guestMinCents: gMin!,
        guestMaxCents: gMax!,
      })
    }
  return {
    ok: true,
    value: { vehicleTypes: m.vehicleTypes, films: m.films, prices, version: m.version },
  }
}

// ---- categories --------------------------------------------------------------------------------------------------------

export interface CatalogCategoryItem {
  key: string
  label: string
  colour: string
  sort: number
  active: boolean
  builtin: boolean
  version: number
}

/** The colours offered as swatches (the five default categories' and three of the designs' accents); any #RRGGBB can be typed. */
export const CATEGORY_SWATCHES = [
  '#1FB6FF',
  '#7FD6FF',
  '#2EE59D',
  '#FFB547',
  '#8C97A1',
  '#0E7A63',
  '#7A3B8A',
  '#C2410C',
] as const

export const HEX_COLOUR = /^#[0-9A-Fa-f]{6}$/

/** "#abc123" -> "#ABC123"; "abc123" gets its "#"; anything else stays as typed (the form says what is wrong). */
export function normalizeColour(raw: string): string {
  const t = raw.trim()
  const withHash = t.startsWith('#') ? t : '#' + t
  return HEX_COLOUR.test(withHash) ? withHash.toUpperCase() : t
}

/** The key a new category gets from its name: lowercase letters, digits and underscores, starting with a letter. */
export function keyFromLabel(label: string): string {
  const k = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/, '')
    .slice(0, 32)
    .replace(/_+$/, '')
  return k
}

export function categoryProblem(
  label: string,
  colour: string,
  key: string | null,
  taken: readonly string[],
): string | null {
  if (label.trim() === '') return 'Give the category a name.'
  if (label.trim().length > LIMITS.categoryLabel)
    return `The name is at most ${LIMITS.categoryLabel} characters.`
  if (!HEX_COLOUR.test(normalizeColour(colour))) return 'Pick a colour or type one like #0E7A63.'
  if (key !== null) {
    if (key === '') return 'Start the name with a letter.'
    if (key === 'mixed') return '“Mixed” is the word for a visit with two categories; pick another name.'
    if (taken.includes(key)) return 'There is already a category with that name.'
  }
  return null
}
