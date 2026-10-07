import fs from 'node:fs'
import path from 'node:path'
import type { Browser } from '@playwright/test'
import {
  AllowlistError,
  AllowlistTracker,
  checkAllowlistScopes,
  loadAllowlist,
  swapsFor,
  type AllowEntry,
} from './allowlist'
import { launchBrowser } from './browser'
import {
  ALLOWLIST_FILE,
  CONSOLE_BASELINE_FILE,
  DEFAULT_ORIGINAL_PORT,
  REPORTS_DIR,
  SCREENS,
  TOLERANCES_FILE,
  type Screen,
  type Theme,
} from './config'
import { OriginalDriver, PortDriver, type Driver } from './drivers'
import { LiveDriver, type LiveTarget } from './live'
import { runUnit, type RunContext } from './runner'
import { ALL_SCENARIOS, selectScenarios, themesOf, validateScenarios, type ScenarioFilter } from './scenarios'
import type { Scenario } from './scenarios/types'
import { startOriginalServer, type OriginalServer, type ServeOptions } from './serve-original'
import { loadTolerances, type Tolerances } from './tolerances'
import type { UnitResult } from './types'

export type PortTarget =
  | { kind: 'url'; url: string }
  /** the live dashboard build served against a real API stack (docs/parity-live.md) */
  | { kind: 'live'; target: LiveTarget }
  /** serve another original bundle (optionally mutated) and use it as the "port": self-tests and dry runs */
  | { kind: 'original'; serve?: ServeOptions }

export interface HarnessOptions {
  scenarios?: readonly Scenario[]
  filter?: ScenarioFilter
  theme?: Theme
  port: PortTarget
  allowlist?: readonly AllowEntry[]
  tolerances?: Tolerances
  consoleBaseline?: Partial<Record<Screen, string[]>>
  outDir?: string
  browser?: Browser
  origPort?: number
  log?: (line: string) => void
  /**
   * `false` skips the run-level "entry never matched anything" check (a partial run cannot tell a stale entry from one
   * that only shows in a scenario that was not selected). Per-step min/max checks always apply.
   */
  staleCheck?: boolean
  /** live mode only */
  floatNoise?: { relative: number }
}

export interface HarnessResult {
  ok: boolean
  units: UnitResult[]
  problems: string[]
  outDir: string
  /** diff-side entries: differences matched and steps applied */
  usage: Array<{ id: string; matched: number; steps: number }>
  /** pre-render swaps applied to the originals, per screen */
  swaps: Array<{ screen: Screen; id: string; found: number }>
}

export function loadConsoleBaseline(file = CONSOLE_BASELINE_FILE): Partial<Record<Screen, string[]>> {
  if (!fs.existsSync(file)) return {}
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Record<Screen, string[]>>
}

export async function checkPortReachable(baseUrl: string): Promise<void> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/settings`, { signal: AbortSignal.timeout(8000) })
    if (res.status >= 500) throw new Error(`HTTP ${res.status}`)
  } catch (err) {
    throw new Error(
      `the port is not reachable at ${baseUrl} (${err instanceof Error ? err.message : String(err)}). ` +
        'Build and start it first: NEXT_PUBLIC_PARITY=1 pnpm build && pnpm exec next start -p 3100 -H 127.0.0.1',
    )
  }
}

export async function checkLiveReachable(t: LiveTarget): Promise<void> {
  for (const [what, url] of [
    ['dashboard', `${t.webUrl.replace(/\/$/, '')}/login`],
    ['API', `${t.apiUrl.replace(/\/$/, '')}/readyz`],
  ] as const) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`)
    } catch (err) {
      throw new Error(
        `the live ${what} is not reachable at ${url} (${err instanceof Error ? err.message : String(err)}). ` +
          `Start the stack first: pnpm live:up --name ${t.name} --freeze ${t.frozen} ...`,
      )
    }
  }
}

export async function runHarness(opts: HarnessOptions): Promise<HarnessResult> {
  const scenarios = opts.scenarios ?? selectScenarios(opts.filter)
  validateScenarios(scenarios)
  const allowlist = opts.allowlist ?? loadAllowlist(ALLOWLIST_FILE)
  const scopeProblems = checkAllowlistScopes(allowlist, ALL_SCENARIOS)
  if (scopeProblems.length)
    throw new AllowlistError(`allowlist scope errors:\n  ${scopeProblems.join('\n  ')}`)
  const tolerances = opts.tolerances ?? loadTolerances(TOLERANCES_FILE)
  const consoleBaseline = opts.consoleBaseline ?? loadConsoleBaseline()
  const outDir = opts.outDir ?? REPORTS_DIR
  const log = opts.log ?? ((l: string) => console.log(l))
  fs.mkdirSync(outDir, { recursive: true })

  const swapsByScreen: Partial<Record<Screen, ReturnType<typeof swapsFor>>> = {}
  for (const screen of SCREENS) swapsByScreen[screen] = swapsFor(allowlist, screen)
  const origServer: OriginalServer = await startOriginalServer({
    swapsByScreen,
    port: opts.origPort ?? DEFAULT_ORIGINAL_PORT,
  })
  let portServer: OriginalServer | undefined
  if (opts.port.kind === 'original') {
    portServer = await startOriginalServer({ port: 0, ...opts.port.serve })
  } else if (opts.port.kind === 'url') {
    await checkPortReachable(opts.port.url)
  } else {
    await checkLiveReachable(opts.port.target)
  }
  const ownBrowser = !opts.browser
  const browser = opts.browser ?? (await launchBrowser())
  const tracker = new AllowlistTracker(allowlist)
  const units: UnitResult[] = []
  try {
    const portTarget = opts.port
    const ctx: RunContext = {
      makeOriginal: (): Driver =>
        new OriginalDriver(browser, origServer, 'orig', { ignoreTpl: portTarget.kind === 'live' }),
      makePort: (): Driver =>
        portTarget.kind === 'url'
          ? new PortDriver(browser, portTarget.url)
          : portTarget.kind === 'live'
            ? new LiveDriver(browser, portTarget.target)
            : new OriginalDriver(browser, portServer!, 'port'),
      allowlist,
      tolerances,
      consoleBaseline,
      tracker,
      floatNoise: opts.floatNoise ?? (opts.port.kind === 'live' ? { relative: 1e-12 } : undefined),
      outDir,
      log,
    }
    for (const scenario of scenarios) {
      for (const theme of themesOf(scenario, opts.theme)) {
        log(`${scenario.screen}/${scenario.id}@${theme}`)
        units.push(await runUnit(ctx, scenario, theme))
      }
    }
  } finally {
    if (ownBrowser) await browser.close()
    await origServer.close()
    await portServer?.close()
  }
  const stepProblems = [...tracker.problems]
  const finished = tracker.finish()
  const problems = opts.staleCheck === false ? stepProblems : finished
  const usage = tracker.usage()
  const swaps = SCREENS.flatMap((screen) =>
    (origServer.swapResults[screen] ?? []).map((r) => ({ screen, id: r.id, found: r.found })),
  )
  const unitFailures = units.filter((u) => !u.ok)
  const ok = unitFailures.length === 0 && problems.length === 0 && units.length > 0
  const summary = {
    ok,
    units: units.map((u) => ({
      screen: u.screen,
      scenario: u.scenario,
      theme: u.theme,
      ok: u.ok,
      steps: u.steps.length,
      failedSteps: u.steps.filter((s) => !s.ok).map((s) => s.step),
      error: u.error?.split('\n')[0],
      durationMs: u.durationMs,
    })),
    allowlistProblems: problems,
    usage,
    swaps,
  }
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 1) + '\n')
  return { ok, units, problems, outDir, usage, swaps }
}

export function formatSummary(r: HarnessResult): string {
  const lines: string[] = []
  const steps = r.units.reduce((n, u) => n + u.steps.length, 0)
  const badSteps = r.units.reduce((n, u) => n + u.steps.filter((s) => !s.ok).length, 0)
  lines.push(
    `${r.ok ? 'PASS' : 'FAIL'}  ${r.units.length} runs, ${steps} steps, ${badSteps} failing steps, ${r.problems.length} allow-list problems`,
  )
  for (const u of r.units.filter((x) => !x.ok)) {
    lines.push(`  ${u.screen}/${u.scenario}@${u.theme}${u.error ? ` ERROR: ${u.error.split('\n')[0]}` : ''}`)
    for (const s of u.steps.filter((x) => !x.ok)) {
      const detail = Object.values(s.checks)
        .filter((c) => !c.ok)
        .map((c) => `${c.check}=${c.diffs}`)
        .join(' ')
      lines.push(`    ${s.step}: ${detail}`)
    }
  }
  for (const p of r.problems) lines.push(`  allowlist: ${p}`)
  lines.push(
    `artifacts: ${path.relative(process.cwd(), r.outDir) || '.'}/<screen>/<scenario>/<theme>/<step>/`,
  )
  return lines.join('\n')
}
