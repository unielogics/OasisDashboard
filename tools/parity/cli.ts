import './env'
import fs from 'node:fs'
import { parseArgs } from 'node:util'
import {
  CONSOLE_BASELINE_FILE,
  DEFAULT_PORT_URL,
  REPORTS_DIR,
  SCREENS,
  isScreen,
  isTheme,
  type Screen,
} from './config'
import { launchBrowser } from './browser'
import { OriginalDriver } from './drivers'
import { formatSummary, runHarness, loadConsoleBaseline } from './harness'
import { ALL_SCENARIOS, selectScenarios, themesOf } from './scenarios'
import { startOriginalServer } from './serve-original'
import { normalizeConsole } from './diff-console'

const HELP = `pnpm parity [options]

  --screen <operations|payments|settings>   limit to one screen (default: all)
  --scenario <id>                            limit to one scenario id (see --list)
  --theme <light|dark>                       limit to one theme (default: both)
  --tag <tag>                                limit to scenarios carrying a tag (for example smoke)
  --all                                      every scenario on every screen (what parity:all runs)
  --port-url <url>                           where the port runs (default ${DEFAULT_PORT_URL})
  --against-original                         dry run: use a second copy of the ORIGINAL as the port
  --out <dir>                                artifact root (default parity-reports)
  --list                                     list the scenarios and exit
  --update-console-baseline                  record the original's console warnings as the baseline and exit
  -h, --help
`

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      screen: { type: 'string' },
      scenario: { type: 'string' },
      theme: { type: 'string' },
      tag: { type: 'string' },
      all: { type: 'boolean', default: false },
      'port-url': { type: 'string' },
      'against-original': { type: 'boolean', default: false },
      out: { type: 'string' },
      list: { type: 'boolean', default: false },
      'update-console-baseline': { type: 'boolean', default: false },
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
  const filter = { screen: values.screen as Screen | undefined, scenario: values.scenario, tag: values.tag }
  if (
    !values.all &&
    !filter.screen &&
    !filter.scenario &&
    !filter.tag &&
    !values.list &&
    !values['update-console-baseline']
  ) {
    console.error('Nothing selected. Pass --screen/--scenario/--tag, or --all (pnpm parity:all).\n')
    console.error(HELP)
    return 2
  }
  const scenarios = selectScenarios(filter)
  if (values.list) {
    for (const s of ALL_SCENARIOS)
      console.log(
        `${s.screen.padEnd(10)} ${s.id.padEnd(22)} ${(s.tags ?? []).join(',').padEnd(8)} ${s.steps.length + 1} steps  ${s.title}`,
      )
    return 0
  }
  if (!scenarios.length) {
    console.error('no scenario matches the filter (see --list)')
    return 2
  }
  if (values['update-console-baseline']) return updateConsoleBaseline(scenarios, values.theme)
  const result = await runHarness({
    scenarios,
    theme: values.theme as 'light' | 'dark' | undefined,
    port: values['against-original']
      ? { kind: 'original' }
      : { kind: 'url', url: values['port-url'] ?? DEFAULT_PORT_URL },
    outDir: values.out ?? REPORTS_DIR,
  })
  console.log('\n' + formatSummary(result))
  return result.ok ? 0 : 1
}

async function updateConsoleBaseline(
  scenarios: ReturnType<typeof selectScenarios>,
  theme?: string,
): Promise<number> {
  const server = await startOriginalServer()
  const browser = await launchBrowser()
  const baseline = loadConsoleBaseline()
  const found: Record<string, Set<string>> = {}
  try {
    for (const sc of scenarios) {
      for (const t of themesOf(sc, theme === 'light' || theme === 'dark' ? theme : undefined)) {
        const d = new OriginalDriver(browser, server)
        await d.open({ screen: sc.screen, theme: t, hash: sc.hash, touch: sc.touch })
        for (const step of sc.steps) await step.run?.(d.actions)
        const snap = await d.snapshot(false)
        for (const m of snap.console) (found[sc.screen] ??= new Set()).add(normalizeConsole(m))
        await d.close()
      }
    }
  } finally {
    await browser.close()
    await server.close()
  }
  const next: Record<string, string[]> = {}
  for (const screen of SCREENS)
    next[screen] = [...new Set([...(baseline[screen] ?? []), ...(found[screen] ?? [])])].sort()
  fs.writeFileSync(CONSOLE_BASELINE_FILE, JSON.stringify(next, null, 2) + '\n')
  console.log(
    `wrote ${CONSOLE_BASELINE_FILE}: ${JSON.stringify(Object.fromEntries(Object.entries(next).map(([k, v]) => [k, v.length])))}`,
  )
  return 0
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  },
)
