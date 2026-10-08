// parity-live: the parity harness pointed at the LIVE dashboard (real API, real Postgres, frozen clock) instead of the
// fixture build. The original bundle stays the oracle on its own fixture state. Each screen runs against its own stack,
// seeded with exactly the profiles the registry (tools/parity/live-registry.ts) declares. See docs/parity-live.md.
//
//   pnpm live:up --name lpops --api-port 4064 --web-port 3264 --profile design,parity-ops --freeze 2026-06-13T10:36:00-04:00
//   pnpm live:up --name lppay --api-port 4065 --web-port 3265 --profile design,parity-pay --freeze 2026-06-13T10:36:00-04:00
//   pnpm live:up --name lpset --api-port 4066 --web-port 3266 --profile design,parity-ops --freeze 2026-06-13T10:36:00-04:00
//   pnpm parity:live --screen payments --scenario initial --theme light
//   pnpm parity:live:all
import '../tools/parity/env'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { loadAllowlist } from '../tools/parity/allowlist'
import { launchBrowser } from '../tools/parity/browser'
import { ALLOWLIST_FILE, SCREENS, isScreen, isTheme, type Screen } from '../tools/parity/config'
import { formatSummary, runHarness, type HarnessResult } from '../tools/parity/harness'
import { LIVE_USER } from '../tools/parity/live'
import {
  LIVE_ALLOWLIST_FILE,
  LIVE_FREEZE,
  LIVE_REPORTS_DIR,
  StackError,
  screenStack,
} from '../tools/parity/live-config'
import { formatMatrix, formatSkipped, formatUsage, matrixOf, mergeResults } from '../tools/parity/live-matrix'
import { LIVE_SCREENS, liveScreens, liveSkipReason, liveUpCommand } from '../tools/parity/live-registry'
import { ALL_SCENARIOS, selectScenarios } from '../tools/parity/scenarios'

const HELP = `pnpm parity:live [options]

  --screen <operations|payments|settings>   limit to one live screen (default: every live screen)
  --scenario <id>       limit to one scenario id (see --list)
  --theme <light|dark>
  --stack <name>        with --screen: run against this stack instead of the screen's own (registry); it must still be
                        frozen at the design's instant and seeded with exactly the screen's profiles
  --user <email>        who signs in (default ${LIVE_USER}, the design's "Rafael M.")
  --all                 every scenario of every live screen, both themes, each screen on its own stack (parity:live:all)
  --out <dir>           artifact root (default parity-reports/live)
  --list                list the live scenarios, the stacks, the left-out scenarios and the pending screens, and exit

Stacks (each built for its own API, seeded with exactly these profiles):
${SCREENS.map((s) => `  ${s.padEnd(10)} ${liveUpCommand(s, LIVE_FREEZE)}`).join('\n')}
`

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      stack: { type: 'string' },
      screen: { type: 'string' },
      scenario: { type: 'string' },
      theme: { type: 'string' },
      user: { type: 'string', default: LIVE_USER },
      all: { type: 'boolean', default: false },
      out: { type: 'string' },
      list: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  })
  if (values.help) {
    console.log(HELP)
    return 0
  }
  if (values.screen && !isScreen(values.screen))
    throw new Error(`--screen must be one of ${SCREENS.join(', ')}`)
  if (values.theme && !isTheme(values.theme)) throw new Error('--theme must be light or dark')
  if (values.list) {
    for (const s of ALL_SCENARIOS) {
      const reg = LIVE_SCREENS[s.screen]
      const skip = liveSkipReason(s.screen, s.id)
      const state = reg.status === 'pending' ? 'pending' : skip ? 'left out' : `live on ${reg.stack}`
      console.log(
        `${s.screen.padEnd(10)} ${s.id.padEnd(22)} ${state.padEnd(14)} ${s.steps.length + 1} steps  ${s.title}${skip ? `\n${' '.repeat(34)}(${skip})` : ''}`,
      )
    }
    return 0
  }
  if (!values.all && !values.screen && !values.scenario) {
    console.error('Nothing selected. Pass --screen/--scenario, or --all (pnpm parity:live:all).\n')
    console.error(HELP)
    return 2
  }
  if (values.stack && !values.screen) {
    console.error('--stack needs --screen: every screen has its own stack (see --help)')
    return 2
  }
  if (values.screen && LIVE_SCREENS[values.screen as Screen].status === 'pending') {
    console.error(
      `${values.screen} is not live yet (registry: ${LIVE_SCREENS[values.screen as Screen].note})`,
    )
    return 2
  }
  const live = new Set<Screen>(liveScreens())
  const selected = selectScenarios({
    screen: values.screen as Screen | undefined,
    scenario: values.scenario,
  }).filter((s) => live.has(s.screen))
  const skipped = selected.filter((s) => liveSkipReason(s.screen, s.id))
  const scenarios = selected.filter((s) => !liveSkipReason(s.screen, s.id))
  if (!scenarios.length) {
    console.error(
      skipped.length
        ? `the selected scenario is left out of the live run: ${skipped.map((s) => `${s.screen}/${s.id}: ${liveSkipReason(s.screen, s.id)}`).join('; ')}`
        : 'no live scenario matches the filter (see --list)',
    )
    return 2
  }
  const screens = SCREENS.filter((sc) => scenarios.some((s) => s.screen === sc))

  // every stack is checked before the first browser starts, and every problem is named at once
  const targets = new Map<Screen, ReturnType<typeof screenStack>>()
  const problems: string[] = []
  for (const screen of screens) {
    try {
      targets.set(screen, screenStack(screen, values.user!, values.stack))
    } catch (err) {
      if (!(err instanceof StackError)) throw err
      problems.push(err.message)
    }
  }
  if (problems.length) {
    console.error(`parity:live cannot run:\n${problems.join('\n')}`)
    return 2
  }

  const allowlist = [...loadAllowlist(ALLOWLIST_FILE), ...loadAllowlist(LIVE_ALLOWLIST_FILE)]
  const outDir = values.out ?? LIVE_REPORTS_DIR
  const browser = await launchBrowser()
  const results: HarnessResult[] = []
  try {
    for (const screen of screens) {
      const target = targets.get(screen)!
      console.log(`== ${screen} on stack ${target.name} (${target.webUrl})`)
      results.push(
        await runHarness({
          scenarios: scenarios.filter((s) => s.screen === screen),
          theme: values.theme as 'light' | 'dark' | undefined,
          port: { kind: 'live', target },
          origPort: 0,
          browser,
          // a partial run cannot tell a stale allow-list entry from one that shows in a scenario that was not selected
          staleCheck: values.all,
          allowlist,
          outDir,
        }),
      )
    }
  } finally {
    await browser.close()
  }
  const result = mergeResults(results, outDir)
  const cells = matrixOf(result.units)
  const liveEntries = loadAllowlist(LIVE_ALLOWLIST_FILE)
  const left = skipped.map((s) => ({
    screen: s.screen,
    scenario: s.id,
    reason: liveSkipReason(s.screen, s.id)!,
  }))
  fs.writeFileSync(
    path.join(outDir, 'matrix.json'),
    JSON.stringify({ cells, skipped: left, usage: result.usage, swaps: result.swaps }, null, 1) + '\n',
  )
  fs.writeFileSync(
    path.join(outDir, 'summary.json'),
    JSON.stringify(
      {
        ok: result.ok,
        stacks: Object.fromEntries([...targets].map(([s, t]) => [s, t.name])),
        units: result.units.map((u) => ({
          screen: u.screen,
          scenario: u.scenario,
          theme: u.theme,
          ok: u.ok,
          steps: u.steps.length,
          failedSteps: u.steps.filter((s) => !s.ok).map((s) => s.step),
          error: u.error?.split('\n')[0],
          durationMs: u.durationMs,
        })),
        skipped: left,
        allowlistProblems: result.problems,
        usage: result.usage,
        swaps: result.swaps,
      },
      null,
      1,
    ) + '\n',
  )
  console.log('\n' + formatSummary(result))
  console.log('\n' + formatMatrix(cells))
  if (left.length) console.log('\n' + formatSkipped(left))
  console.log('\n' + formatUsage(liveEntries, result))
  return result.ok ? 0 : 1
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  },
)
