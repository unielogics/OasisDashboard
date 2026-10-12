// Vehicle sizes, member % off and membership coverage as both live screens word them (ADR 0170). Pure text helpers: the
// amounts are the server's (integer cents), nothing here prices anything.
import { formatCentsCompact } from './money'

/** "10%" for 1000 basis points, "12.5%" for 1250. */
export const pctText = (bp: number): string => `${Number((bp / 100).toFixed(2))}%`

/** "10% member price" for a line the member % off priced; '' when no % off applied. */
export const memberPctText = (bp: number | null | undefined): string =>
  bp && bp > 0 ? pctText(bp) + ' member price' : ''

/** The sub-label of an invoice line: its size and the member % off ("Large SUV · 10% member price"); '' for neither. */
export function lineSub(classLabel: string | null | undefined, discountBp: number | null | undefined): string {
  return [classLabel || '', memberPctText(discountBp)].filter(Boolean).join(' · ')
}

/** A line's name with its sub-label after a middle dot ("Signature Hand Wash · Large SUV"). */
export function lineLabel(
  name: string,
  classLabel: string | null | undefined,
  discountBp: number | null | undefined,
): string {
  const sub = lineSub(classLabel, discountBp)
  return sub ? name + ' · ' + sub : name
}

export interface CoverageAmounts {
  coveredCents: number
  differenceCents: number
}

/** "Covered $40 · $20 size difference due"; "Covered $40" when the plan covers the whole line. */
export function coverageText(c: CoverageAmounts, fmt: (cents: number) => string = formatCentsCompact): string {
  return (
    'Covered ' +
    fmt(c.coveredCents) +
    (c.differenceCents > 0 ? ' · ' + fmt(c.differenceCents) + ' size difference due' : '')
  )
}

/** The coverage line of one service, with the plan size when the server names it. */
export function coverageLine(
  c: CoverageAmounts & { serviceName: string; planClassLabel: string | null },
  fmt: (cents: number) => string = formatCentsCompact,
): string {
  return c.serviceName + ' · ' + coverageText(c, fmt) + (c.planClassLabel ? ' (' + c.planClassLabel + ' plan)' : '')
}

/** Who said a car's size, in a few words ("set by staff"). */
export function sizeSourceText(source: string | null | undefined): string {
  switch (source) {
    case 'staff':
      return 'set by staff'
    case 'client':
      return 'from the client'
    case 'ai':
      return 'from Oasis AI'
    case 'legacy':
      return 'from the old vehicle type'
    default:
      return ''
  }
}
