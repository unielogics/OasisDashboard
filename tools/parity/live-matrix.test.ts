import { describe, expect, it } from 'vitest'
import { cellLabel, classifyStep, formatMatrix, matrixOf } from './live-matrix'
import { CHECK_NAMES, type CheckName, type CheckResult, type StepResult, type UnitResult } from './types'

const check = (name: CheckName, over: Partial<CheckResult> = {}): CheckResult => ({
  check: name,
  ok: true,
  rawDiffs: 0,
  diffs: 0,
  allowed: 0,
  artifacts: [],
  sample: [],
  ...over,
})

const step = (id: string, over: Partial<Record<CheckName, Partial<CheckResult>>> = {}): StepResult => ({
  step: id,
  ok: true,
  checks: Object.fromEntries(CHECK_NAMES.map((c) => [c, check(c, over[c])])) as Record<
    CheckName,
    CheckResult
  >,
  htmlHash: 'h',
  pngHash: 'p',
})

const unit = (steps: StepResult[], extra: Partial<UnitResult> = {}): UnitResult => ({
  screen: 'payments',
  scenario: 'initial',
  theme: 'light',
  ok: true,
  steps,
  allowlistProblems: [],
  distinctStates: 1,
  durationMs: 1,
  ...extra,
})

describe('live matrix', () => {
  it('classifies a clean step, an allow-listed step and an unresolved step', () => {
    expect(classifyStep(step('a')).kind).toBe('zero')
    const listed = classifyStep(step('b', { dom: { allowed: 4, rawDiffs: 4 }, pixels: { allowed: 8000 } }))
    expect(listed).toMatchObject({ kind: 'allowed', allowed: 5, unresolved: 0 })
    const bad = classifyStep(
      step('c', { vals: { diffs: 2, ok: false }, pixels: { diffs: 900, sample: [{} as never] } }),
    )
    expect(bad).toMatchObject({ kind: 'unresolved', unresolved: 3 })
  })

  it('counts a pixel mismatch no mask covers as at least one difference', () => {
    expect(classifyStep(step('d', { pixels: { diffs: 5, sample: [] } })).unresolved).toBe(1)
  })

  it('summarises per cell and renders the table', () => {
    const cells = matrixOf([
      unit([step('initial'), step('x', { dom: { allowed: 2 } })]),
      unit([step('initial', { dom: { diffs: 1, ok: false } })], { theme: 'dark' }),
      unit([], { scenario: 'boom', error: 'Error: no page\n  at x' }),
    ])
    expect(cells.map(cellLabel)).toEqual(['allow-listed 2', 'unresolved 1', 'ERROR'])
    expect(cells[0]).toMatchObject({ steps: 2, zero: 1, allowedSteps: 1 })
    const table = formatMatrix(cells)
    expect(table).toContain('| payments / initial | 2 | allow-listed 2 | unresolved 1 |')
    expect(table).toContain(
      '3 runs, 3 steps: 1 zero, 1 allow-listed (2 differences), 1 unresolved steps (2 differences)',
    )
  })
})
