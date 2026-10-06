// VIP program and arrival: ordering of the holds and the "what happens" explainer.
import { parseT } from '../time'
import type { Arrival, Hold } from './types'

/** Monday-first, then by time. */
export const sortHolds = (holds: Hold[]): Hold[] =>
  [...holds].sort((a, b) => ((a.d + 6) % 7) - ((b.d + 6) % 7) || parseT(a.t) - parseT(b.t))

export function arrivalSteps(ar: Arrival): { n: string; title: string; desc: string }[] {
  return [
    {
      n: '1',
      title: ar.prepAt + ' min out',
      desc: 'Operations gets an “Arriving” alert with a Prep bay button. VIPs show in purple at the top.',
    },
    {
      n: '2',
      title: 'Within ' + ar.radius + ' m',
      desc:
        (ar.autoArrive
          ? 'Checked in automatically and the job moves to Arrived. '
          : 'Staff confirm the check-in. ') + (ar.welcome ? 'Customer gets a welcome message.' : ''),
    },
    {
      n: '3',
      title: 'Ready to start',
      desc: 'Crew sees “Auto checked in” with a Start cleaning button.',
    },
  ]
}
