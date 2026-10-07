// parity-live: the parity harness pointed at the LIVE dashboard (real API, real Postgres, frozen clock) instead of the
// fixture build. The original bundle stays the oracle on its own fixture state. See docs/parity-live.md.
//
//   pnpm live:up --name lparity --api-port 4024 --web-port 3224 --profile design,parity-pay --freeze 2026-06-13T10:36:00-04:00
//   pnpm parity:live --stack lparity --screen payments --scenario initial --theme light
//   pnpm parity:live:all --stack lparity
//   pnpm live:down --name lparity --drop
import '../tools/parity/env'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { loadAllowlist } from '../tools/parity/allowlist'
import { ALLOWLIST_FILE, SCREENS, isScreen, isTheme, type Screen } from '../tools/parity/config'
import { formatSummary, runHarness } from '../tools/parity/harness'
import { LIVE_USER } from '../tools/parity/live'
import {
  LIVE_ALLOWLIST_FILE,
  LIVE_REPORTS_DIR,
  loadStackTarget,
  stackProfiles,
} from '../tools/parity/live-config'
import { formatMatrix, formatUsage, matrixOf } from '../tools/parity/live-matrix'
import { LIVE_SCREENS, liveScreens } from '../tools/parity/live-registry'
import { ALL_SCENARIOS, selectScenarios } from '../tools/parity/scenarios'

const HELP = `pnpm parity:live [options]

  --stack <name>        the stack from pnpm live:up (default lparity); it must be frozen at the design's instant
  --screen <payments|settings>   limit to one live screen (default: every live screen)
  --scenario <id>       limit to one scenario id (see --list)
  --theme <light|dark>
  --user <email>        who signs in (default ${LIVE_USER}, the design's "Rafael M.")
  --all                 every scenario of every live screen, both themes (parity:live:all)
  --out <dir>           artifact root (default parity-reports/live)
  --list                list the live scenarios, the pending screens and exit
`

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      stack: { type: 'string', default: 'lparity' },
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
      const live = LIVE_SCREENS[s.screen].status === 'live'
      console.log(
        `${s.screen.padEnd(10)} ${s.id.padEnd(22)} ${live ? 'live   ' : 'pending'} ${s.steps.length + 1} steps  ${s.title}`,
      )
    }
    return 0
  }
  if (!values.all && !values.screen && !values.scenario) {
    console.error('Nothing selected. Pass --screen/--scenario, or --all (pnpm parity:live:all).\n')
    console.error(HELP)
    return 2
  }
  if (values.screen && LIVE_SCREENS[values.screen as Screen].status === 'pending') {
    console.error(
      `${values.screen} is not live yet (registry: ${LIVE_SCREENS[values.screen as Screen].note})`,
    )
    return 2
  }
  const live = new Set<Screen>(liveScreens())
  const scenarios = selectScenarios({
    screen: values.screen as Screen | undefined,
    scenario: values.scenario,
  }).filter((s) => live.has(s.screen))
  if (!scenarios.length) {
    console.error('no live scenario matches the filter (see --list)')
    return 2
  }
  const target = loadStackTarget(values.stack!, values.user!)
  const have = new Set(stackProfiles(values.stack!))
  for (const screen of new Set(scenarios.map((s) => s.screen)))
    for (const p of LIVE_SCREENS[screen].profiles)
      if (!have.has(p))
        throw new Error(`stack "${values.stack}" lacks the seed profile "${p}" that ${screen} needs`)
  const allowlist = [...loadAllowlist(ALLOWLIST_FILE), ...loadAllowlist(LIVE_ALLOWLIST_FILE)]
  const outDir = values.out ?? LIVE_REPORTS_DIR
  const result = await runHarness({
    scenarios,
    theme: values.theme as 'light' | 'dark' | undefined,
    port: { kind: 'live', target },
    origPort: 0,
    // a partial run cannot tell a stale allow-list entry from one that shows in a scenario that was not selected
    staleCheck: values.all,
    allowlist,
    outDir,
  })
  const cells = matrixOf(result.units)
  const liveEntries = loadAllowlist(LIVE_ALLOWLIST_FILE)
  fs.writeFileSync(
    path.join(outDir, 'matrix.json'),
    JSON.stringify({ cells, usage: result.usage, swaps: result.swaps }, null, 1) + '\n',
  )
  console.log('\n' + formatSummary(result))
  console.log('\n' + formatMatrix(cells))
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
