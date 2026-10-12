// Settings → Memberships (live variant only; ADR 0170, backend api-spec 15.10; DV-324): the pure half of the tier editor
// and the monthly price grid. A tier is saved whole (PUT /catalog/tiers/:key with its version); its monthly prices by size
// are saved apart (PUT /catalog/tier-prices with the tier's priceVersion). Nothing here talks to the API or keeps state.
import { HEX_COLOUR, checkoutUrlProblem, keyFromLabel, normalizeColour } from './catalog'
import type { Checked } from './catalog'
import { parseWhole, wholeMoney, wholeText } from './sizes'
import type { VehicleClassItem } from './sizes'

export type InclusionMode = 'per_cycle' | 'every_visit'
export type SquareState = 'pending' | 'synced' | 'failed'

export interface InclusionItem {
  id: string
  label: string
  mode: InclusionMode
  perCycle: number | null
  autoApply: boolean
  active: boolean
  serviceIds: string[]
}

export interface TierPriceItem {
  class: string
  monthlyCents: number
  priceVersion: number
  effectiveFrom: string
  squareState?: SquareState
}

/** A membership tier as GET /catalog sends it. */
export interface TierItem {
  key: string
  name: string
  colour: string
  bgColour: string
  sort: number
  active: boolean
  public: boolean
  vipBooking: boolean
  memberDiscountBp: number
  maxVehicles: number | null
  perks: string[]
  checkoutUrl: string | null
  legacyKey: string | null
  priceVersion: number
  version: number
  squarePlanId?: string | null
  inclusions: InclusionItem[]
  prices: TierPriceItem[]
  fromMonthlyCents: number | null
  sold: boolean
}

/** The server's limits (api-spec 15.10). */
export const TIER_LIMITS = {
  name: 40,
  tiers: 12,
  inclusions: 20,
  inclusionLabel: 80,
  perCycle: 100,
  maxVehicles: 20,
  perks: 12,
  perk: 120,
} as const

/** How an inclusion counts, as the person picks it: N a month, unlimited, or on every wash. */
export type InclusionKind = 'count' | 'unlimited' | 'every_visit'

export interface InclusionDraft {
  /** null: a new inclusion (the server gives it an id). */
  id: string | null
  label: string
  kind: InclusionKind
  count: string
  autoApply: boolean
  active: boolean
  serviceIds: string[]
}

export interface TierDraft {
  name: string
  colour: string
  active: boolean
  public: boolean
  vipBooking: boolean
  /** Member % off as typed ("10", "12.5"). */
  discount: string
  /** Cars on the membership as typed ("" = no limit). */
  maxCars: string
  /** One perk per line. */
  perks: string
  checkoutUrl: string
  inclusions: InclusionDraft[]
}

export interface InclusionBody {
  id?: string
  label: string
  mode: InclusionMode
  perCycle: number | null
  autoApply: boolean
  active: boolean
  serviceIds: string[]
}

export interface TierBody {
  name: string
  colour: string
  sort: number
  active: boolean
  public: boolean
  vipBooking: boolean
  memberDiscountBp: number
  maxVehicles: number | null
  perks: string[]
  checkoutUrl: string | null
  inclusions: InclusionBody[]
  version: number
}

/** Tiers in the server's order. */
export const sortTiers = <T extends Pick<TierItem, 'sort' | 'key'>>(list: readonly T[]): T[] =>
  [...list].sort((a, b) => a.sort - b.sort || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))

/** Basis points as the % a person reads and types: 1000 -> "10", 1250 -> "12.5", 0 -> "0". */
export function percentText(bp: number): string {
  const whole = Math.trunc(bp / 100)
  const frac = bp % 100
  if (!frac) return String(whole)
  return whole + '.' + String(frac).padStart(2, '0').replace(/0$/, '')
}

/** Typed % off to basis points: "10" -> 1000, "12.5%" -> 1250, "" -> 0; anything else (over 100, 3 decimals) undefined. */
export function parsePercent(text: string): number | undefined {
  const t = text.replace(/[\s%]/g, '')
  if (t === '') return 0
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(t)
  if (!m) return undefined
  const bp = Number(m[1]) * 100 + (m[2] ? Number(m[2].padEnd(2, '0')) : 0)
  return bp > 10_000 ? undefined : bp
}

/** The member price the server computes: price × (1 − %), rounded half up to whole dollars (never above the price). */
export function memberCents(cents: number, bp: number): number {
  if (bp <= 0) return cents
  const m = Math.floor((cents * (10_000 - bp) + 500_000) / 1_000_000) * 100
  return Math.min(m, cents)
}

/** The line under the % off box: what a sample price costs members ("A $40 wash costs members $36."). */
export function discountHint(bp: number | undefined, sample: { name: string; cents: number } | null): string {
  if (bp === undefined) return 'Enter the % off like 10 or 12.5 (0 for none).'
  if (bp === 0) return 'No % off: members pay the regular price for what their plan does not include.'
  if (!sample) return 'Members pay ' + percentText(bp) + '% less on what their plan does not include.'
  return (
    'Members pay ' +
    percentText(bp) +
    '% less on what their plan does not include: ' +
    sample.name +
    ' ' +
    wholeMoney(sample.cents) +
    ' costs them ' +
    wholeMoney(memberCents(sample.cents, bp)) +
    '. The size difference gets no % off.'
  )
}

export function inclusionDraft(i: InclusionItem): InclusionDraft {
  return {
    id: i.id,
    label: i.label,
    kind: i.mode === 'every_visit' ? 'every_visit' : i.perCycle === null ? 'unlimited' : 'count',
    count: i.perCycle === null ? '' : String(i.perCycle),
    autoApply: i.autoApply,
    active: i.active,
    serviceIds: [...i.serviceIds],
  }
}

export const newInclusion = (): InclusionDraft => ({
  id: null,
  label: '',
  kind: 'count',
  count: '1',
  autoApply: true,
  active: true,
  serviceIds: [],
})

export function tierDraft(t: TierItem): TierDraft {
  return {
    name: t.name,
    colour: t.colour,
    active: t.active,
    public: t.public,
    vipBooking: t.vipBooking,
    discount: percentText(t.memberDiscountBp),
    maxCars: t.maxVehicles === null ? '' : String(t.maxVehicles),
    perks: t.perks.join('\n'),
    checkoutUrl: t.checkoutUrl ?? '',
    inclusions: t.inclusions.map(inclusionDraft),
  }
}

const blankToNull = (t: string): string | null => (t.trim() === '' ? null : t.trim())

/** The whole tier for PUT /catalog/tiers/:key, or the first thing the server would refuse, in plain words. */
export function tierBody(d: TierDraft, t: Pick<TierItem, 'sort'>, version: number): Checked<TierBody> {
  const name = d.name.trim()
  if (name === '') return { ok: false, field: 'name', message: 'Give the tier a name.' }
  if (name.length > TIER_LIMITS.name)
    return { ok: false, field: 'name', message: `The name is at most ${TIER_LIMITS.name} characters.` }
  const colour = normalizeColour(d.colour)
  if (!HEX_COLOUR.test(colour)) return { ok: false, field: 'colour', message: 'Pick a colour or type one like #8A6D3B.' }
  const bp = parsePercent(d.discount)
  if (bp === undefined)
    return { ok: false, field: 'discount', message: 'Enter the member % off from 0 to 100, like 10 or 12.5.' }
  let maxVehicles: number | null = null
  if (d.maxCars.trim() !== '') {
    const n = /^\d{1,2}$/.test(d.maxCars.trim()) ? Number(d.maxCars.trim()) : NaN
    if (!(n >= 1 && n <= TIER_LIMITS.maxVehicles))
      return { ok: false, field: 'maxCars', message: 'Enter the number of cars from 1 to 20, or leave it empty.' }
    maxVehicles = n
  }
  const perks = [...new Set(d.perks.split('\n').map((x) => x.trim()).filter(Boolean))]
  if (perks.length > TIER_LIMITS.perks)
    return { ok: false, field: 'perks', message: `At most ${TIER_LIMITS.perks} perks.` }
  if (perks.some((p) => p.length > TIER_LIMITS.perk))
    return { ok: false, field: 'perks', message: `Each perk is at most ${TIER_LIMITS.perk} characters.` }
  const urlProblem = checkoutUrlProblem(d.checkoutUrl)
  if (urlProblem) return { ok: false, field: 'checkoutUrl', message: urlProblem }
  if (d.inclusions.length > TIER_LIMITS.inclusions)
    return { ok: false, field: 'inclusions', message: `At most ${TIER_LIMITS.inclusions} inclusions.` }
  const inclusions: InclusionBody[] = []
  for (const [i, inc] of d.inclusions.entries()) {
    const label = inc.label.trim()
    const which = label || 'Inclusion ' + (i + 1)
    if (label === '') return { ok: false, field: `inclusions.${i}`, message: `${which}: give it a name, like “Hand washes”.` }
    if (label.length > TIER_LIMITS.inclusionLabel)
      return { ok: false, field: `inclusions.${i}`, message: `${which}: the name is at most 80 characters.` }
    let perCycle: number | null = null
    if (inc.kind === 'count') {
      const n = /^\d{1,3}$/.test(inc.count.trim()) ? Number(inc.count.trim()) : NaN
      if (!(n >= 1 && n <= TIER_LIMITS.perCycle))
        return { ok: false, field: `inclusions.${i}`, message: `${which}: enter how many a month, from 1 to 100.` }
      perCycle = n
    }
    if (!inc.serviceIds.length)
      return { ok: false, field: `inclusions.${i}`, message: `${which}: pick at least one service it covers.` }
    inclusions.push({
      ...(inc.id ? { id: inc.id } : {}),
      label,
      mode: inc.kind === 'every_visit' ? 'every_visit' : 'per_cycle',
      perCycle,
      autoApply: inc.autoApply,
      active: inc.active,
      serviceIds: [...new Set(inc.serviceIds)],
    })
  }
  return {
    ok: true,
    value: {
      name,
      colour,
      sort: t.sort,
      active: d.active,
      public: d.public,
      vipBooking: d.vipBooking,
      memberDiscountBp: bp,
      maxVehicles,
      perks,
      checkoutUrl: blankToNull(d.checkoutUrl),
      inclusions,
      version,
    },
  }
}

/** A tier as the server has it, re-sent whole with one change (the order or on/off buttons): no draft involved. */
export function tierBodyOf(t: TierItem, patch: Partial<Pick<TierBody, 'sort' | 'active'>>): TierBody {
  return {
    name: t.name,
    colour: t.colour,
    sort: t.sort,
    active: t.active,
    public: t.public,
    vipBooking: t.vipBooking,
    memberDiscountBp: t.memberDiscountBp,
    maxVehicles: t.maxVehicles,
    perks: t.perks,
    checkoutUrl: t.checkoutUrl,
    inclusions: t.inclusions.map((i) => ({
      id: i.id,
      label: i.label,
      mode: i.mode,
      perCycle: i.perCycle,
      autoApply: i.autoApply,
      active: i.active,
      serviceIds: i.serviceIds,
    })),
    version: t.version,
    ...patch,
  }
}

/** What a new tier needs besides its name and colour: off the website, no % off, no inclusions, after the last one. */
export function newTierBody(key: string, name: string, colour: string, tiers: readonly TierItem[]) {
  return {
    key,
    name: name.trim(),
    colour: normalizeColour(colour),
    sort: tiers.reduce((m, t) => Math.max(m, t.sort), 0) + 10,
    active: true,
    public: false,
    vipBooking: false,
    memberDiscountBp: 0,
    maxVehicles: null,
    perks: [],
    checkoutUrl: null,
    inclusions: [],
  }
}

/** The key a new tier gets from its name; set once, never changes. */
export const tierKeyFromName = keyFromLabel

/** What the server would refuse about a new tier's name and key, in plain words; null when fine. */
export function newTierProblem(name: string, colour: string, key: string, tiers: readonly TierItem[]): string | null {
  if (name.trim() === '') return 'Give the tier a name.'
  if (name.trim().length > TIER_LIMITS.name) return `The name is at most ${TIER_LIMITS.name} characters.`
  if (!HEX_COLOUR.test(normalizeColour(colour))) return 'Pick a colour or type one like #8A6D3B.'
  if (key === '') return 'Start the name with a letter.'
  if (tiers.some((t) => t.key === key || t.legacyKey === key)) return 'There is already a tier with that name.'
  if (tiers.length >= TIER_LIMITS.tiers) return `The shop can have at most ${TIER_LIMITS.tiers} tiers.`
  return null
}

/** The line under a tier in the list: its starting price and what is on. */
export function tierSub(t: TierItem, dirty: boolean): string {
  const parts = [t.fromMonthlyCents === null ? 'no price yet' : 'from ' + wholeMoney(t.fromMonthlyCents) + '/mo']
  if (!t.active) parts.push('off')
  else if (t.public) parts.push(t.fromMonthlyCents === null ? 'not sold online until priced' : 'on the website')
  else parts.push('staff only')
  if (t.vipBooking) parts.push('VIP booking')
  if (dirty) parts.push('unsaved')
  return parts.join(' · ')
}

/** How an inclusion reads in a sentence: "2 a month", "unlimited", "every wash". */
export function inclusionCountText(d: Pick<InclusionDraft, 'kind' | 'count'>): string {
  if (d.kind === 'every_visit') return 'every wash'
  if (d.kind === 'unlimited') return 'unlimited'
  return (d.count.trim() || '?') + ' a month'
}

/** A Square sync state in plain words (shown read only; Square billing comes later). */
export function squareStateText(s: SquareState | undefined): string {
  if (s === 'synced') return 'On Square'
  if (s === 'failed') return 'Square sync failed'
  return 'Not synced yet'
}

// ---- the monthly price grid ------------------------------------------------------------------------------------------

/** One tier's monthly prices as typed, by size key (whole dollars); it covers every size, on or off (as RowDraft). */
export type TierPriceDraft = Record<string, string>

export function tierPriceDraft(t: Pick<TierItem, 'prices'>, sizes: readonly VehicleClassItem[]): TierPriceDraft {
  const out: TierPriceDraft = {}
  for (const s of sizes) out[s.key] = wholeText(t.prices.find((p) => p.class === s.key)?.monthlyCents)
  return out
}

/**
 * The cells of one tier that changed, as PUT /catalog/tier-prices takes them, or the first thing the server would refuse.
 * A size the draft has no box for (a draft made before that size existed) is not sent: its kept price stays.
 */
export function changedTierCells(
  d: TierPriceDraft,
  base: TierPriceDraft,
  sizes: readonly VehicleClassItem[],
  where: string,
): Checked<{ class: string; monthlyCents: number | null }[]> {
  const out: { class: string; monthlyCents: number | null }[] = []
  for (const s of sizes) {
    if (!(s.key in d)) continue
    const v = (d[s.key] ?? '').trim()
    if (v === (base[s.key] ?? '').trim()) continue
    const cents = parseWhole(v)
    if (cents === undefined)
      return { ok: false, field: s.key, message: `${where} · ${s.label}: enter whole dollars a month, like 129.` }
    if ((cents ?? 0) > 10_000_000)
      return { ok: false, field: s.key, message: `${where} · ${s.label}: prices go up to $100,000.` }
    out.push({ class: s.key, monthlyCents: cents })
  }
  return { ok: true, value: out }
}

/** A 412 on the monthly grid in plain words: which tier's prices changed meanwhile. */
export function staleTierMessage(name: string | null): string {
  return (
    (name ? 'Someone else changed the ' + name + ' prices' : 'Someone else changed these prices') +
    ' meanwhile, so nothing was saved. Their change is on screen now with your edits kept: check and save again.'
  )
}
