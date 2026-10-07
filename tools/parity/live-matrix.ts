import type { Screen, Theme } from './config'
import { CHECK_NAMES, type StepResult, type UnitResult } from './types'

export interface StepClass {
  step: string
  kind: 'zero' | 'allowed' | 'unresolved'
  allowed: number
  unresolved: number
}

export interface MatrixCell {
  screen: Screen
  scenario: string
  theme: Theme
  steps: number
  zero: number
  allowedSteps: number
  allowed: number
  unresolvedSteps: number
  unresolved: number
  error?: string
}

/**
 * Differences left (`unresolved`) and differences excused (`allowed`) on one step. A pixel mask hides thousands of
 * pixels but is one listed difference, so the pixel check counts 1 when a mask was used and 0 otherwise; a pixel
 * mismatch that no mask covers counts as 1 unresolved difference per cluster of the report.
 */
export function classifyStep(s: StepResult): StepClass {
  let allowed = 0
  let unresolved = 0
  for (const c of CHECK_NAMES) {
    const r = s.checks[c]
    if (c === 'pixels') {
      allowed += r.allowed > 0 ? 1 : 0
      unresolved += r.diffs > 0 ? Math.max(1, r.sample.length) : 0
    } else {
      allowed += r.allowed
      unresolved += r.diffs
    }
  }
  return {
    step: s.step,
    kind: unresolved > 0 ? 'unresolved' : allowed > 0 ? 'allowed' : 'zero',
    allowed,
    unresolved,
  }
}

export function matrixOf(units: readonly UnitResult[]): MatrixCell[] {
  return units.map((u) => {
    const cls = u.steps.map(classifyStep)
    return {
      screen: u.screen,
      scenario: u.scenario,
      theme: u.theme,
      steps: u.steps.length,
      zero: cls.filter((c) => c.kind === 'zero').length,
      allowedSteps: cls.filter((c) => c.kind === 'allowed').length,
      allowed: cls.reduce((n, c) => n + c.allowed, 0),
      unresolvedSteps: cls.filter((c) => c.kind === 'unresolved').length,
      unresolved: cls.reduce((n, c) => n + c.unresolved, 0) + (u.error ? 1 : 0),
      error: u.error?.split('\n')[0],
    }
  })
}

/** "zero" when every step is clean, "allow-listed N" when only listed differences remain, else "unresolved N". */
export function cellLabel(c: MatrixCell): string {
  if (c.error) return `ERROR`
  if (c.unresolved > 0) return `unresolved ${c.unresolved}`
  if (c.allowed > 0) return `allow-listed ${c.allowed}`
  return 'zero'
}

export function formatMatrix(cells: readonly MatrixCell[]): string {
  const rows = new Map<string, Partial<Record<Theme, MatrixCell>>>()
  for (const c of cells) {
    const k = `${c.screen} / ${c.scenario}`
    rows.set(k, { ...rows.get(k), [c.theme]: c })
  }
  const lines = ['| screen / scenario | steps | light | dark |', '| --- | --- | --- | --- |']
  for (const [k, v] of rows) {
    const steps = v.light?.steps ?? v.dark?.steps ?? 0
    lines.push(
      `| ${k} | ${steps} | ${v.light ? cellLabel(v.light) : 'n/a'} | ${v.dark ? cellLabel(v.dark) : 'n/a'} |`,
    )
  }
  const t = (f: (c: MatrixCell) => number) => cells.reduce((n, c) => n + f(c), 0)
  lines.push(
    '',
    `${cells.length} runs, ${t((c) => c.steps)} steps: ${t((c) => c.zero)} zero, ${t((c) => c.allowedSteps)} allow-listed (${t((c) => c.allowed)} differences), ${t((c) => c.unresolvedSteps)} unresolved steps (${t((c) => c.unresolved)} differences)`,
  )
  return lines.join('\n')
}
