// Procedural calendar counts of the Operations design (seeded PRNG + weekday table). The fixture data port serves
// them; the live build gets real counts from GET /calendar/summary instead.
import { DESIGN_BASE, dateFor } from './dates'
import type { CivilDate } from './dates'

/** Operations rng(seed): mulberry32 returning floats in [0, 1). */
export function rng(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

const BASE_COUNTS = [4, 6, 6, 7, 7, 9, 10]

/** Operations dayCount(o, inf): appointments generated for a day offset; `reduced` (a closure with reduced hours) halves it. */
export function dayCount(
  o: number,
  reduced: boolean,
  base: CivilDate = DESIGN_BASE,
): { n: number; rnd: () => number } {
  const d = dateFor(o, base)
  const rnd = rng(o * 7919 + 104729)
  let n = Math.max(2, BASE_COUNTS[d.getDay()]! + Math.floor(rnd() * 4) - 1)
  if (reduced) n = Math.ceil(n / 2)
  return { n, rnd }
}
