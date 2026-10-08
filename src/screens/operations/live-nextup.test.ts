// A free bay's "Next" line follows the range tab and the search (the design builds it from the filtered list); found by the
// live parity run on Tomorrow, where the server's range-blind nextUp named today's car.
import { describe, expect, it } from 'vitest'
import { withWindowNextUp } from './LiveLogic'
import { clone, fixtures } from './live-testkit'

const snap = () => clone(fixtures.snapshot)
const bay2 = () => snap().bays.find((b) => b.number === 2)!

describe('withWindowNextUp', () => {
  it('on the default window it names what the server names', () => {
    const b = bay2()
    const w = withWindowNextUp(b, snap())
    expect(w.nextUp).toBe(b.nextUp)
    expect(w.nextUpAppointmentId).toBe(b.nextUpAppointmentId)
  })

  it('on Tomorrow it names tomorrow’s first car for that bay, and the Next button opens that one', () => {
    const s = snap()
    s.timeline.groups = s.timeline.groups.filter((g) => g.key.startsWith('2026-06-14'))
    const first = s.timeline.groups.flatMap((g) => g.items).find((c) => c.bay?.number === 2)!
    expect(first).toBeTruthy()
    const w = withWindowNextUp(bay2(), s)
    expect(w.nextUp).toBe(`Next: ${first.customer.name} · ${first.time}`)
    expect(w.nextUpAppointmentId).toBe(first.id)
    expect(w.nextUp).not.toBe(bay2().nextUp)
  })

  it('with nothing planned for the bay in the shown list it says No vehicles queued', () => {
    const s = snap()
    s.timeline.groups = []
    expect(withWindowNextUp(bay2(), s)).toMatchObject({
      nextUp: 'No vehicles queued',
      nextUpAppointmentId: null,
    })
  })
})
