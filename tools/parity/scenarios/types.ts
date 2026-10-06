import type { Actions } from '../drivers'
import type { Screen, Theme } from '../config'

export interface ScenarioStep {
  /** unique inside the scenario; becomes the artifact folder name */
  id: string
  title?: string
  /** performed identically on both pages; omit for a pure re-snapshot */
  run?: (a: Actions) => Promise<void>
  /** compare the full computed-style set (default: only the automatic "initial" step does) */
  full?: boolean
}

export interface Scenario {
  /** unique per screen, kebab-case */
  id: string
  screen: Screen
  title: string
  /** URL hash to load with (for example "emergency" on settings) */
  hash?: string
  /** both themes by default */
  themes?: readonly Theme[]
  /** enable touch emulation (hasTouch) on both pages */
  touch?: boolean
  tags?: readonly string[]
  /** the harness always snapshots an "initial" step first, right after load; these run after it */
  steps: readonly ScenarioStep[]
}
