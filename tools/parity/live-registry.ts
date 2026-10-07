import type { Screen } from './config'

export interface LiveScreen {
  /** `live`: the screen runs on the real API and is part of parity:live:all. `pending`: not converted yet, listed only. */
  status: 'live' | 'pending'
  /** seed profiles of the stack that mirror the design's fixture state for this screen */
  profiles: string[]
  note: string
}

export const LIVE_SCREENS: Record<Screen, LiveScreen> = {
  payments: {
    status: 'live',
    profiles: ['design', 'parity-pay'],
    note: 'the 105-invoice set of the design (backend db/seeds parity-pay)',
  },
  settings: {
    status: 'live',
    profiles: ['design'],
    note: 'the design seed (hours, closures, staff, roles, VIP, packages)',
  },
  operations: {
    status: 'pending',
    profiles: ['design', 'parity-ops'],
    note: 'typed view model on fixtures, not live yet (docs/screens-operations.md); registered here so the matrix lists it',
  },
}

export const liveScreens = (): Screen[] =>
  (Object.keys(LIVE_SCREENS) as Screen[]).filter((s) => LIVE_SCREENS[s].status === 'live')
