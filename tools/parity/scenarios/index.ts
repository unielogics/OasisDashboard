import { SCREENS, THEMES, type Screen, type Theme } from '../config'
import { operationsScenarios } from './operations'
import { paymentsScenarios } from './payments'
import { settingsScenarios } from './settings'
import type { Scenario } from './types'

export const ALL_SCENARIOS: readonly Scenario[] = [
  ...operationsScenarios,
  ...paymentsScenarios,
  ...settingsScenarios,
]

export function validateScenarios(list: readonly Scenario[]): void {
  const seen = new Set<string>()
  for (const s of list) {
    if (!(SCREENS as readonly string[]).includes(s.screen))
      throw new Error(`scenario ${s.id}: unknown screen ${s.screen}`)
    if (!/^[a-z0-9][a-z0-9-]*$/.test(s.id)) throw new Error(`scenario id "${s.id}" must be kebab-case`)
    const key = `${s.screen}/${s.id}`
    if (seen.has(key)) throw new Error(`duplicate scenario ${key}`)
    seen.add(key)
    const steps = new Set<string>(['initial'])
    for (const st of s.steps) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(st.id))
        throw new Error(`${key}: step id "${st.id}" must be kebab-case`)
      if (steps.has(st.id)) throw new Error(`${key}: duplicate step id "${st.id}"`)
      steps.add(st.id)
    }
  }
}

export interface ScenarioFilter {
  screen?: Screen
  scenario?: string
  tag?: string
}

export function selectScenarios(
  filter: ScenarioFilter = {},
  list: readonly Scenario[] = ALL_SCENARIOS,
): Scenario[] {
  return list.filter(
    (s) =>
      (!filter.screen || s.screen === filter.screen) &&
      (!filter.scenario || s.id === filter.scenario) &&
      (!filter.tag || (s.tags ?? []).includes(filter.tag)),
  )
}

export function themesOf(s: Scenario, only?: Theme): readonly Theme[] {
  const themes = s.themes ?? THEMES
  return only ? themes.filter((t) => t === only) : themes
}
