// Emergency closing: the wording of the confirm dialog and preview, and the fixture's "remaining today" list.
import { REASON_TEXT } from './constants'
import { parseT } from '../time'
import type { AffectedRow, Emergency, RemainingRow } from './types'

export function untilText(em: Pick<Emergency, 'dur' | 'until' | 'through'>): string {
  return em.dur === 'today'
    ? 'for the rest of today'
    : em.dur === 'until'
      ? 'until ' + em.until + ' today'
      : 'through ' +
        new Date(em.through + 'T12:00:00').toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
        })
}

/** The `{reason}` wording of the chosen reason; undefined for a reason the design does not list. */
export const reasonText = (reason: string): string | undefined => REASON_TEXT[reason]

/** The customer message as it would read, with the design's sample name and link. */
export function renderPreview(
  em: Pick<Emergency, 'msg' | 'reason' | 'dur' | 'until' | 'through'>,
  sample: { first: string; link: string },
): string {
  return em.msg
    .replace(/\{first\}/g, sample.first)
    .replace(/\{reason\}/g, reasonText(em.reason)!)
    .replace(/\{until\}/g, untilText(em))
    .replace(/\{link\}/g, sample.link)
}

/** The fixture's affected appointments: those before the reopening time, or all of today's remaining. */
export function fixtureAffected(
  remaining: readonly RemainingRow[],
  em: Pick<Emergency, 'dur' | 'until'>,
): AffectedRow[] {
  const list = em.dur === 'until' ? remaining.filter((r) => parseT(r[0]) < parseT(em.until)) : remaining
  return list.map((r) => ({ time: r[0], name: r[1], veh: r[2] }))
}

export function confirmText(
  em: Pick<Emergency, 'notify' | 'pause' | 'reason' | 'dur' | 'until' | 'through'>,
  affectedCount: number,
  fixSingular = false,
): string {
  const customers =
    fixSingular && affectedCount === 1
      ? '1 customer will be messaged'
      : affectedCount + ' customers will be messaged'
  return (
    (em.notify ? customers : 'No customers will be messaged') +
    (em.pause ? ', online booking pauses' : '') +
    ' and the closure shows on the Operations screen. Reason: ' +
    em.reason.toLowerCase() +
    ', ' +
    untilText(em) +
    '.'
  )
}

export const closeSummary = (em: Pick<Emergency, 'reason' | 'pause' | 'dur' | 'until' | 'through'>): string =>
  em.reason + ' · closed ' + untilText(em) + (em.pause ? ' · online booking paused' : '')
