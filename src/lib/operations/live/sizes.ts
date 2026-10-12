// Vehicle sizes on the live Operations screen (ADR 0170; DEVIATIONS DV-807..DV-812): the size chips of the booking sheet and
// its price preview (POST /appointments/quote), the appointment file's size row ("Change size", "Confirm size", the car's
// size on file), the coverage lines ("Covered $40 · $20 size difference due"), the deposit's state on a canceled visit, the
// membership's plan size and household, and the processor words of the Payments tab. Pure: every price, coverage and
// state is the server's; these builders only word and style them.
import type {
  AppointmentFile,
  MembershipView,
  QuoteRes,
  VehicleClass,
  VehicleClasses,
} from '@/data/ports/operations'
import { hexA, lighten } from '@/lib/color'
import { coverageLine, lineLabel, pctText, sizeSourceText } from '@/lib/sizes'
import type { Style } from '../types'
import { opsMoney } from './fmt'

type VM = Record<string, unknown>

export interface SizeOption {
  key: string
  label: string
}

/** The sizes the shop has on, smallest first. */
export function activeSizes(v: VehicleClasses | undefined): SizeOption[] {
  return (v?.vehicleClasses ?? [])
    .filter((c: VehicleClass) => c.active)
    .slice()
    .sort((a, b) => a.sort - b.sort)
    .map((c) => ({ key: c.key, label: c.label }))
}

/** The label of a size key ("Large SUV"); the key itself for a size no longer listed; null for none. */
export const sizeLabel = (sizes: readonly SizeOption[], key: string | null | undefined): string | null =>
  key ? (sizes.find((s) => s.key === key)?.label ?? key) : null

export const UNKNOWN_SIZE_LABEL = 'Not sure'

/** A size chip: the slot buttons' look at chip height. */
export function sizeChipStyle(on: boolean, disabled = false): Style {
  return {
    height: '36px',
    padding: '0 13px',
    borderRadius: '10px',
    fontSize: '12.5px',
    fontWeight: 700,
    background: on ? 'var(--accent)' : 'var(--panel)',
    color: on ? '#fff' : 'var(--ink)',
    border: '1px solid ' + (on ? 'var(--accent)' : 'var(--line)'),
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}

/**
 * The chips of a size choice: one per size that is on, then "Not sure" (no size: the visit is priced at the smallest
 * size, the starting price, and reads "Confirm size" until staff set it) when `allowUnknown`.
 */
export function sizeChipVMs(
  sizes: readonly SizeOption[],
  picked: string | null,
  pick: (key: string | null) => void,
  o: { allowUnknown: boolean; disabled?: boolean },
): VM[] {
  const out: VM[] = sizes.map((s) => ({
    label: s.label,
    on: picked === s.key,
    pick: () => pick(s.key),
    style: sizeChipStyle(picked === s.key, o.disabled),
  }))
  if (o.allowUnknown)
    out.push({
      label: UNKNOWN_SIZE_LABEL,
      on: picked === null,
      pick: () => pick(null),
      style: sizeChipStyle(picked === null, o.disabled),
    })
  return out
}

// ---- the booking sheet's price preview --------------------------------------------------------------------------------

export interface QuoteLineVM {
  label: string
  value: string
  labelStyle: Style
  valStyle: Style
}

const qLabel = (sub: boolean): Style => ({
  fontSize: sub ? '12px' : '13px',
  fontWeight: sub ? 600 : 700,
  color: sub ? 'var(--ink2)' : 'var(--ink)',
  paddingLeft: sub ? '10px' : '0',
})
const qVal = (sub: boolean, tone: 'ink' | 'green' = 'ink'): Style => ({
  fontSize: sub ? '12px' : '13px',
  fontWeight: 700,
  color: tone === 'green' ? '#0E9E6E' : sub ? 'var(--ink2)' : 'var(--ink)',
  whiteSpace: 'nowrap',
})

const priceText = (cents: number, maxCents: number | null): string =>
  maxCents !== null && maxCents > cents ? opsMoney(cents) + '–' + opsMoney(maxCents) : opsMoney(cents)

/**
 * What the visit will cost, as the server quoted it: each line at its regular price for the size, the member % off and
 * what the membership covers under it, then what is due before tax. The member's plan and the "confirm at the shop" note
 * close it.
 */
export function quoteVM(q: QuoteRes | undefined): VM {
  if (!q || q.lines.length === 0)
    return { hasQuote: false, quoteTitle: '', quoteLines: [], quoteTotal: '', quoteNote: '', hasQuoteNote: false }
  const lines: QuoteLineVM[] = []
  for (const l of q.lines) {
    lines.push({
      label: (l.kind === 'addon' ? '+ ' : '') + l.name,
      value: priceText(l.listCents, l.listMaxCents),
      labelStyle: qLabel(false),
      valStyle: qVal(false),
    })
    if (l.memberDiscountCents > 0)
      lines.push({
        label: (q.member?.tierName ? q.member.tierName + ' ' : 'Member ') + pctText(l.discountBp) + ' off',
        value: '– ' + opsMoney(l.memberDiscountCents),
        labelStyle: qLabel(true),
        valStyle: qVal(true, 'green'),
      })
    if (l.coverage)
      lines.push({
        label:
          'Included · ' +
          (l.coverage.differenceCents > 0
            ? opsMoney(l.coverage.differenceCents) + ' size difference due'
            : 'nothing due'),
        value: '– ' + opsMoney(l.coverage.coveredCents),
        labelStyle: qLabel(true),
        valStyle: qVal(true, 'green'),
      })
  }
  const p = q.pricing
  const notes: string[] = []
  if (q.member)
    notes.push(
      q.member.tierName +
        ' member' +
        (q.member.household ? ' (household)' : '') +
        ' · ' +
        (q.member.planClassLabel ?? q.member.planClass) +
        ' plan',
    )
  if (p.needsSizeConfirm) notes.push('Size not set: starting price. Confirm the size at the shop.')
  else if (p.needsPriceConfirm) notes.push('This size has no price yet: starting price. Confirm the price at the shop.')
  return {
    hasQuote: true,
    quoteTitle: 'Price' + (p.vehicleClassLabel ? ' · ' + p.vehicleClassLabel : ''),
    quoteLines: lines,
    quoteTotal: opsMoney(p.totals.dueCents),
    quoteTotalLabel: p.totals.coveredCents > 0 ? 'Due at the shop (before tax)' : 'Total before tax',
    quoteNote: notes.join(' · '),
    hasQuoteNote: notes.length > 0,
  }
}

// ---- the appointment file -------------------------------------------------------------------------------------------

/** Show the size row: a visit priced by size (a visit booked before sizes shows the design's file unchanged). */
export const fileHasSizes = (f: Pick<AppointmentFile, 'priceBasis' | 'vehicleClass'>): boolean =>
  (f.priceBasis ?? 'legacy') !== 'legacy' || !!f.vehicleClass

/** "Large SUV", "Not set · priced at the starting price" or "Large SUV · no price yet". */
export function visitSizeText(f: AppointmentFile, sizes: readonly SizeOption[]): string {
  const label = f.vehicleClassLabel ?? sizeLabel(sizes, f.vehicleClass)
  if (!label) return 'Not set · priced at the starting price'
  if (f.needsPriceConfirm) return label + ' · no price yet (starting price)'
  return label
}

/** "This car on file: Large SUV · set by staff" / "This car has no size on file"; '' without a car. */
export function carSizeText(f: AppointmentFile, sizes: readonly SizeOption[]): string {
  const v = f.vehicle
  if (!v) return ''
  const label = sizeLabel(sizes, v.vehicleClass)
  if (!label) return 'This car has no size on file'
  const src = sizeSourceText(v.vehicleClassSource)
  return 'This car on file: ' + label + (src ? ' · ' + src : '')
}

/** The badge while staff still have to confirm: "Confirm size" (no size) or "Confirm price" (the size has no price). */
export function confirmBadgeText(f: Pick<AppointmentFile, 'needsSizeConfirm' | 'needsPriceConfirm'>): string {
  return f.needsSizeConfirm ? 'Confirm size' : f.needsPriceConfirm ? 'Confirm price' : ''
}

export function confirmBadgeStyle(dark: boolean): Style {
  const amber = '#C2740B'
  return {
    fontSize: '11px',
    fontWeight: 800,
    padding: '3px 9px',
    borderRadius: '7px',
    background: hexA(amber, dark ? 0.22 : 0.14),
    color: dark ? lighten(amber) : '#8A5A06',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    whiteSpace: 'nowrap',
  }
}

/** The coverage lines of the visit's invoice: "Signature Hand Wash · Covered $40 · $20 size difference due (Compact car plan)". */
export function coverageLines(f: Pick<AppointmentFile, 'invoice'>): string[] {
  return (f.invoice?.coverage ?? []).map((c) => coverageLine(c, opsMoney))
}

/** An invoice item's label with its size and member % off. */
export const itemLabelOf = (it: {
  name: string
  classLabel?: string | null
  discountBp?: number | null
}): string => lineLabel(it.name, it.classLabel, it.discountBp)

/** What the invoice's ledger says about refunds (GET /invoices/:id, pay.reports): the file's summary does not carry it. */
export interface DepositFacts {
  /** Refunds that gave money back (calc.refunded: done and not failed, ADR 0171 D4). */
  refundedCents: number
  /** Card refunds the processor reported failed (they gave nothing back). */
  failedRefundCents: number
}

export function depositFactsOf(
  d: { calc: { refunded: number }; ledger: ReadonlyArray<{ type: string; status: string; voided: boolean; processorState: string; amountCents: number }> } | undefined,
): DepositFacts | undefined {
  if (!d?.calc || !d.ledger) return undefined
  const failed = d.ledger
    .filter((e) => e.type === 'refund' && e.status === 'done' && !e.voided && e.processorState === 'failed')
    .reduce((n, e) => n + e.amountCents, 0)
  return { refundedCents: d.calc.refunded, failedRefundCents: failed }
}

/**
 * The deposit of a canceled visit (D2: a deposit toward the visit, settled by the cancel and no-show rules). "Deposit
 * refunded" when the server says so. Otherwise the summary's paidCents does not subtract refunds (a partial policy refund,
 * a failed Square refund), so the amount kept is only shown from the invoice's ledger (`facts`, pay.reports): kept in
 * full, kept after a partial refund, or a refund that failed. Without it the row only says it was not fully refunded.
 * A paid deposit of an open visit is the design's own "Deposit paid" row; a deposit link still waiting is not in the file
 * (backend gap, see the report).
 */
export function depositState(
  inv: AppointmentFile['invoice'],
  facts?: DepositFacts,
): { label: string; value: string } | null {
  if (!inv || inv.paidCents <= 0) return null
  if (inv.status === 'canceled_refunded') return { label: 'Deposit refunded', value: opsMoney(inv.paidCents) }
  if (inv.status !== 'canceled_kept') return null
  if (!facts) return { label: 'Canceled · deposit not fully refunded', value: '' }
  const kept = Math.max(0, inv.paidCents - facts.refundedCents)
  if (facts.failedRefundCents > 0) return { label: 'Deposit refund failed · not refunded', value: opsMoney(kept) }
  if (facts.refundedCents > 0)
    return { label: 'Deposit kept (canceled) · ' + opsMoney(facts.refundedCents) + ' refunded', value: opsMoney(kept) }
  return { label: 'Deposit kept (canceled)', value: opsMoney(kept) }
}

// ---- the membership tab: plan size and household --------------------------------------------------------------------

export interface HouseholdMember {
  customerId: string
  name: string
}

/** The membership the Membership tab shows: the plan size, the household and who holds it. */
export function householdOf(mem: MembershipView | undefined): {
  show: boolean
  membershipId: string | null
  planSize: string
  sharedFrom: string | null
  members: HouseholdMember[]
} {
  const m = mem?.membership
  if (!m) return { show: false, membershipId: null, planSize: '', sharedFrom: null, members: [] }
  return {
    show: true,
    membershipId: m.id,
    planSize: (m.planClassLabel ?? m.planClass ?? '') || '',
    sharedFrom: mem?.sharedFrom?.name ?? null,
    members: (m.household ?? []).map((h) => ({ customerId: h.customerId, name: h.name })),
  }
}

/** "Compact car · a larger car pays the size difference at the shop". */
export const planSizeText = (planSize: string): string =>
  planSize ? planSize + ' · a larger car pays the size difference at the shop' : ''

// ---- the processor (ADR 0171) ---------------------------------------------------------------------------------------

export type ProcessorName = 'squarespace' | 'square'

export const tenderLabel = (t: 'card' | 'cash', p: ProcessorName): string =>
  t === 'cash' ? 'Cash' : p === 'square' ? 'Square reader' : 'Card'

export const processorWord = (p: ProcessorName): string => (p === 'square' ? 'Square' : 'Squarespace')
