// Service categories as the live screens show them (ADR 0160, plan K): a chip in the category's colour on board cards,
// the appointment file header and Payments rows, the board filter, the per-category KPI counts and the Payments split.
// The server says which categories a visit holds (`categories`, in the categories' order) and the one word it counts
// under (`category`: a category, `mixed`, `addons` for add-ons alone, null for none); this file only turns keys into
// labels and styles. Pure: no state, no clock.
import { hexA, lighten } from './color'
import type { StyleObject } from './color'

/** A category as the catalog keeps it (Settings → Categories). `colour` is #RRGGBB, null for `mixed` and `_none`. */
export interface CategoryInfo {
  key: string
  label: string
  colour: string | null
  active?: boolean
}

/** The word `visitCategory()` returns for a visit with two or more categories other than add-ons. */
export const MIXED = 'mixed'
/** The key the server uses for "no category" in a split. */
export const NONE = '_none'
/** The neutral of the chips that have no colour of their own (mixed, none, a category the list does not know). */
export const NEUTRAL = '#6B7280'

const HEX = /^#[0-9a-f]{6}$/i

/** A key the list does not know reads as itself with a capital (`tint_film` becomes `Tint film`). */
export function keyLabel(key: string): string {
  const t = key.replace(/_/g, ' ').trim()
  return t ? t[0]!.toUpperCase() + t.slice(1) : key
}

export function categoryLabel(key: string, cats: readonly CategoryInfo[]): string {
  const hit = cats.find((c) => c.key === key)
  if (hit) return hit.label
  if (key === MIXED) return 'Mixed'
  if (key === NONE) return 'No category'
  return keyLabel(key)
}

export function categoryColour(key: string, cats: readonly CategoryInfo[]): string {
  const c = cats.find((x) => x.key === key)?.colour
  return c && HEX.test(c) ? c : NEUTRAL
}

export type ChipSize = 'card' | 'file' | 'row'

/** WCAG relative luminance of a #RRGGBB colour (0 black .. 1 white). */
export function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!
}

/** Blend a #RRGGBB colour toward black by `t` (0..1). */
export function darken(hex: string, t: number): string {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - t)))
  return `rgb(${r},${g},${b})`
}

/**
 * The chip's text colour: the category's own colour when it reads on the theme's panel, else a darker (light theme) or
 * lighter (dark theme) shade of it. The default categories are bright (#7FD6FF), which would vanish on white.
 */
export function chipInk(colour: string, dark: boolean): string {
  const l = luminance(colour)
  if (dark) return l < 0.3 ? lighten(colour) : colour
  return l > 0.3 ? darken(colour, l > 0.55 ? 0.55 : 0.4) : colour
}

/** The chip: the member badge's shape (Operations) in the category's colour, readable in both themes. */
export function categoryChipStyle(colour: string, dark: boolean, size: ChipSize): StyleObject {
  const c = HEX.test(colour) ? colour : NEUTRAL
  return {
    display: 'inline-flex',
    alignItems: 'center',
    flex: 'none',
    fontSize: size === 'file' ? '11px' : size === 'row' ? '10.5px' : '10px',
    fontWeight: 800,
    padding: size === 'file' ? '3px 9px' : size === 'row' ? '3px 7px' : '2px 7px',
    borderRadius: size === 'file' ? '7px' : '6px',
    background: hexA(c, dark ? 0.2 : 0.14),
    color: chipInk(c, dark),
    whiteSpace: 'nowrap',
    letterSpacing: '0.02em',
  }
}

export interface CategoryChip {
  key: string
  label: string
  style: StyleObject
}

/** One chip per category of a visit, in the server's order; an unknown key gets the neutral colour and its own name. */
export function categoryChips(
  keys: readonly string[] | null | undefined,
  cats: readonly CategoryInfo[],
  dark: boolean,
  size: ChipSize,
): CategoryChip[] {
  const seen = new Set<string>()
  const out: CategoryChip[] = []
  for (const k of keys ?? []) {
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push({
      key: k,
      label: categoryLabel(k, cats),
      style: categoryChipStyle(categoryColour(k, cats), dark, size),
    })
  }
  return out
}

/** A small round swatch in the category's colour (the KPI counts, the Payments split, the Settings list). */
export function swatchStyle(colour: string | null, size = 9): StyleObject {
  return {
    flex: 'none',
    width: size + 'px',
    height: size + 'px',
    borderRadius: size >= 14 ? '5px' : '3px',
    background: colour && HEX.test(colour) ? colour : NEUTRAL,
  }
}

/**
 * Does a visit pass the board filter? `all` passes everything; `mixed` takes the visits that count as mixed; a category
 * takes every visit holding it (a wash with a tint shows under Wash and under Tint, as its chips say).
 */
export function matchesCategory(
  filter: string,
  visit: { categories?: readonly string[] | null; category?: string | null },
): boolean {
  if (filter === 'all') return true
  if (filter === MIXED) return visit.category === MIXED
  return (visit.categories ?? []).includes(filter) || visit.category === filter
}
