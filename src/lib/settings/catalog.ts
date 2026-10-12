// Settings → Catalog and Categories (live variant only; ADR 0160 plan A and K, backend api-spec 15.8): the pure half of
// the forms. Since ADR 0170 a service's prices are set per vehicle size (lib/settings/sizes.ts, Prices by size) and the
// membership tiers in Memberships (lib/settings/tiers.ts); Catalog keeps the website fields. Nothing here talks to the
// API or keeps state.
// The server is the judge of every rule (422 with the field); these helpers only shape what is sent and say early what
// the server would refuse anyway, in its words.

export type VipInclusion = 'included' | 'allowance' | 'none'

/**
 * A catalog service as GET /catalog sends it (the fields the forms read). `memberPriceCents`, `guestPriceCents`,
 * `vipInclusion` and `vipNote` are the stored pre-size values (ADR 0170): read only, no longer shown.
 */
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
  quoteOnly: boolean
  visibleOnline: boolean
  sort: number
}

/** PUT /catalog/services/:id: the website fields only. Prices are set per vehicle size (ADR 0170, Prices by size). */
export interface ServiceBody {
  category: string
  publicName: string | null
  description: string | null
  quoteOnly: boolean
  visibleOnline: boolean
  sort: number
  version: number
}

export type Checked<T> = { ok: true; value: T } | { ok: false; field: string; message: string }

/** The server's limits (api-spec 15.8): texts, perks, links and categories. */
export const LIMITS = {
  publicName: 80,
  description: 1000,
  perks: 12,
  perk: 120,
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

export function serviceDraft(s: CatalogItem): ServiceDraft {
  return {
    category: s.category,
    publicName: s.publicName ?? '',
    description: s.description ?? '',
    quoteOnly: s.quoteOnly,
    visibleOnline: s.visibleOnline,
    sort: s.sort,
  }
}

export const sameDraft = <T>(a: T, b: T): boolean => JSON.stringify(a) === JSON.stringify(b)

const blankToNull = (t: string): string | null => (t.trim() === '' ? null : t.trim())

/** The PUT body of a service's website fields, or the first thing the server would refuse. */
export function serviceBody(d: ServiceDraft, version: number): Checked<ServiceBody> {
  if (d.publicName.trim().length > LIMITS.publicName)
    return { ok: false, field: 'publicName', message: `The website name is at most ${LIMITS.publicName} characters.` }
  if (d.description.trim().length > LIMITS.description)
    return {
      ok: false,
      field: 'description',
      message: `The description is at most ${LIMITS.description} characters.`,
    }
  return {
    ok: true,
    value: {
      category: d.category,
      publicName: blankToNull(d.publicName),
      description: blankToNull(d.description),
      quoteOnly: d.quoteOnly,
      visibleOnline: d.visibleOnline,
      sort: d.sort,
      version,
    },
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
