import type { Screen } from './config'

export interface LiveScreen {
  /** `live`: the screen runs on the real API and is part of parity:live:all. `pending`: not converted yet, listed only. */
  status: 'live' | 'pending'
  /**
   * The seed profiles of the screen's stack, exactly (order does not matter): the data that mirrors the design's fixture
   * state for this screen. A stack seeded with more or fewer profiles is refused, because another screen's seed changes
   * what this one shows (parity-ops puts twelve invoices on the design day, which the Payments design does not have).
   */
  profiles: string[]
  /** the stack (`pnpm live:up --name <stack>`) the screen runs against unless --stack says otherwise */
  stack: string
  /** the ports the documented `live:up` command gives that stack (docs/parity-live.md) */
  ports: { api: number; web: number }
  /** scenarios of the catalogue that the live run leaves out, each with the reason (they are listed, never silently dropped) */
  skip?: Record<string, string>
  note: string
}

const WRITES =
  'the gesture writes through the real API (assign-bay or advance), so the stack would no longer hold the design state for the next run; pnpm e2e:operations --phase write covers the command'

export const LIVE_SCREENS: Record<Screen, LiveScreen> = {
  payments: {
    status: 'live',
    profiles: ['design', 'parity-pay'],
    stack: 'lppay',
    ports: { api: 4065, web: 3265 },
    note: 'the 105-invoice set of the design (backend db/seeds parity-pay)',
  },
  settings: {
    status: 'live',
    profiles: ['design', 'parity-ops'],
    stack: 'lpset',
    ports: { api: 4066, web: 3266 },
    note: 'the design seed (hours, closures, staff, roles, VIP, packages) and the Operations day: the emergency preview lists the six customers left today',
  },
  operations: {
    status: 'live',
    profiles: ['design', 'parity-ops'],
    stack: 'lpops',
    ports: { api: 4064, web: 3264 },
    skip: {
      'touch-long-press-drag': WRITES,
      'touch-swipe-advance': WRITES,
      'mouse-drag-to-bay': WRITES,
    },
    note: 'the design seed and the design day of the Command Center (parity-ops: eleven appointments, their invoices, members and texts)',
  },
}

export const liveScreens = (): Screen[] =>
  (Object.keys(LIVE_SCREENS) as Screen[]).filter((s) => LIVE_SCREENS[s].status === 'live')

/** The reason a scenario is left out of the live run, or undefined when it runs. */
export const liveSkipReason = (screen: Screen, scenario: string): string | undefined =>
  LIVE_SCREENS[screen].skip?.[scenario]

/** `pnpm live:up` for a screen's stack, as the error messages and the docs print it. */
export function liveUpCommand(screen: Screen, freeze: string): string {
  const s = LIVE_SCREENS[screen]
  return `pnpm live:up --name ${s.stack} --api-port ${s.ports.api} --web-port ${s.ports.web} --profile ${s.profiles.join(',')} --freeze ${freeze} --backend <backend checkout>`
}
