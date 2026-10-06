import { describe, expect, it } from 'vitest'
import { ALL_SCENARIOS, selectScenarios, themesOf, validateScenarios } from './index'
import type { Scenario } from './types'

describe('scenario catalogue', () => {
  it('is valid: unique ids per screen and kebab-case step ids', () => {
    expect(() => validateScenarios(ALL_SCENARIOS)).not.toThrow()
  })

  it('covers the required scenarios on every screen', () => {
    const ids = (screen: string) => selectScenarios({ screen: screen as never }).map((s) => s.id)
    for (const screen of ['operations', 'payments', 'settings']) {
      expect(ids(screen)).toContain('initial')
      expect(ids(screen)).toContain('theme-toggle')
    }
    const steps = (screen: string, id: string) =>
      selectScenarios({ screen: screen as never, scenario: id })[0]!.steps.map((s) => s.id)
    expect(steps('settings', 'sections')).toHaveLength(8)
    expect(steps('payments', 'ranges')).toHaveLength(4)
    expect(steps('payments', 'filters')).toHaveLength(5)
    expect(steps('payments', 'refund-sheet')).toContain('open-refund')
    expect(steps('operations', 'view-tabs')).toHaveLength(4)
    expect(steps('operations', 'range-tabs')).toHaveLength(4)
    expect(steps('operations', 'appointment-file')).toHaveLength(9)
    expect(steps('operations', 'new-appointment')).toContain('open-new')
  })

  it('runs every scenario in both themes unless it narrows them', () => {
    expect(themesOf(ALL_SCENARIOS[0]!)).toEqual(['light', 'dark'])
    expect(themesOf(ALL_SCENARIOS[0]!, 'dark')).toEqual(['dark'])
    expect(themesOf({ ...ALL_SCENARIOS[0]!, themes: ['light'] }, 'dark')).toEqual([])
  })

  it('rejects duplicates and malformed ids', () => {
    const s: Scenario = { id: 'x', screen: 'settings', title: 't', steps: [] }
    expect(() => validateScenarios([s, s])).toThrow(/duplicate scenario/)
    expect(() => validateScenarios([{ ...s, id: 'Bad_Id' }])).toThrow(/kebab-case/)
    expect(() => validateScenarios([{ ...s, steps: [{ id: 'initial' }] }])).toThrow(/duplicate step id/)
  })
})
