// parity-live self-test (a few minutes once the browser lock is free): the live mode must FAIL when the seeded data is
// deliberately broken (a price, a label) and PASS again once it is put back. Without this the zero-diff result of
// `pnpm parity:live:all` could come from a harness that cannot see the live screens at all.
//
//   the three stacks of docs/parity-live.md (lpops, lppay, lpset), then
//   pnpm parity:live:selftest [--backend ~/oasis/backend]
//
// Phases: 1 baseline on every screen (must pass), 2 six seed changes, one at a time, applied straight to the schema of the
// screen's own stack (each must fail the DOM, renderVals and pixel checks of that screen), 3 everything reverted (must
// pass again). A change is reverted even when its phase throws.
import '../tools/parity/env'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { loadAllowlist } from '../tools/parity/allowlist'
import { ALLOWLIST_FILE, REPORTS_DIR, type Theme } from '../tools/parity/config'
import { runHarness, type HarnessResult } from '../tools/parity/harness'
import { LIVE_USER, type LiveTarget } from '../tools/parity/live'
import { LIVE_ALLOWLIST_FILE, StackError, readStack, screenStack } from '../tools/parity/live-config'
import { LIVE_SCREENS } from '../tools/parity/live-registry'
import { clickBtn } from '../tools/parity/scenarios/common'
import { selectScenarios } from '../tools/parity/scenarios'
import type { Scenario } from '../tools/parity/scenarios/types'
import type { CheckName } from '../tools/parity/types'

const { values } = parseArgs({
  options: {
    // the backend checkout whose .env names the database; default: the one each stack was started from
    backend: { type: 'string' },
  },
  strict: true,
})
const expand = (p: string) => p.replace(/^~(?=$|\/)/, os.homedir())
type Sc = 'operations' | 'payments' | 'settings'
const SCREENS_UNDER_TEST: Sc[] = ['operations', 'payments', 'settings']

const targets = new Map<Sc, LiveTarget>()
const schemas = new Map<Sc, string>()
const backends = new Map<Sc, string>()
{
  const problems: string[] = []
  for (const screen of SCREENS_UNDER_TEST) {
    try {
      targets.set(screen, screenStack(screen, LIVE_USER))
      const file = readStack(LIVE_SCREENS[screen].stack)
      if (!/^e2e_[a-z0-9_]+$/.test(file.schema)) throw new Error(`unexpected schema name ${file.schema}`)
      schemas.set(screen, file.schema)
      const be = values.backend ?? file.backend
      if (!be) throw new Error(`${screen}: pass --backend (the stack file does not name its backend)`)
      backends.set(screen, path.resolve(expand(be)))
    } catch (err) {
      if (!(err instanceof StackError)) throw err
      problems.push(err.message)
    }
  }
  if (problems.length) {
    console.error(`parity:live:selftest cannot run:\n${problems.join('\n')}`)
    process.exit(2)
  }
}

function dbUrl(screen: Sc): string {
  for (const line of fs.readFileSync(path.join(backends.get(screen)!, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^DATABASE_URL=(.*)$/)
    if (m) return m[1]!.replace(/^['"]|['"]$/g, '')
  }
  throw new Error(`${backends.get(screen)}/.env has no DATABASE_URL`)
}

function sql(screen: Sc, statement: string): string {
  const r = spawnSync('psql', [dbUrl(screen), '-v', 'ON_ERROR_STOP=1', '-qtA', '-c', statement], {
    encoding: 'utf8',
  })
  if (r.status !== 0)
    throw new Error(`psql failed: ${(r.stderr ?? '').replace(/postgres(ql)?:\/\/\S+/g, '<url>')}`)
  return r.stdout.trim()
}

interface Change {
  what: string
  screen: Sc
  apply: (S: string) => string
  revert: (S: string) => string
}

/** Marcus Webb's invoice of the design day (the first card of the Operations timeline). */
const MARCUS_INVOICE = (S: string) =>
  `(select i.id from ${S}.invoices i join ${S}.customers c on c.id = i.customer_id where c.full_name in ('Marcus Webb', 'Marcus Webbe') and i.biz_date = '2026-06-13' order by i.invoice_no desc limit 1)`

/** Every change is guarded by the value it expects to find, so a second run on a half-reverted stack stops. */
const CHANGES: Change[] = [
  {
    what: 'Operations: a seeded price (the first item of Marcus Webb’s invoice of the day gets $1.00 dearer)',
    screen: 'operations',
    apply: (S) =>
      `update ${S}.invoice_items set price_cents = price_cents + 100 where position = 0 and invoice_id = ${MARCUS_INVOICE(S)}`,
    revert: (S) =>
      `update ${S}.invoice_items set price_cents = price_cents - 100 where position = 0 and invoice_id = ${MARCUS_INVOICE(S)}`,
  },
  {
    what: 'Operations: a seeded label (the customer Marcus Webb is renamed)',
    screen: 'operations',
    apply: (S) => `update ${S}.customers set full_name = 'Marcus Webbe' where full_name = 'Marcus Webb'`,
    revert: (S) => `update ${S}.customers set full_name = 'Marcus Webb' where full_name = 'Marcus Webbe'`,
  },
  {
    what: 'Payments: a seeded price (the first item of INV-20608 gets $1.00 dearer)',
    screen: 'payments',
    apply: (S) =>
      `update ${S}.invoice_items set price_cents = price_cents + 100 where position = 0 and invoice_id = (select id from ${S}.invoices where invoice_no = 20608)`,
    revert: (S) =>
      `update ${S}.invoice_items set price_cents = price_cents - 100 where position = 0 and invoice_id = (select id from ${S}.invoices where invoice_no = 20608)`,
  },
  {
    what: 'Payments: a seeded label (the client of INV-20608 is renamed)',
    screen: 'payments',
    apply: (S) =>
      `update ${S}.invoices set client_name = 'Aisha Rahmann' where invoice_no = 20608 and client_name = 'Aisha Rahman'`,
    revert: (S) =>
      `update ${S}.invoices set client_name = 'Aisha Rahman' where invoice_no = 20608 and client_name = 'Aisha Rahmann'`,
  },
  {
    what: 'Settings: a seeded price (every package gets $1.00 dearer)',
    screen: 'settings',
    apply: (S) => `update ${S}.services set price_cents = price_cents + 100 where kind = 'package'`,
    revert: (S) => `update ${S}.services set price_cents = price_cents - 100 where kind = 'package'`,
  },
  {
    what: 'Settings: a seeded label (the package Express Hand Wash is renamed)',
    screen: 'settings',
    apply: (S) =>
      `update ${S}.services set name = 'Express Hand Wash!' where kind = 'package' and name = 'Express Hand Wash'`,
    revert: (S) =>
      `update ${S}.services set name = 'Express Hand Wash' where kind = 'package' and name = 'Express Hand Wash!'`,
  },
]

const servicesStep: Scenario = {
  id: 'selftest-services',
  screen: 'settings',
  title: 'open Packages & checklists',
  steps: [clickBtn('section-services', 'Packages & checklists')],
}
const SCENARIOS: Record<Sc, Scenario[]> = {
  operations: selectScenarios({ screen: 'operations', scenario: 'initial' }),
  payments: selectScenarios({ screen: 'payments', scenario: 'initial' }),
  settings: [servicesStep],
}

async function phase(name: string, screen: Sc, theme: Theme = 'light'): Promise<HarnessResult> {
  console.log(`\n== ${name} (${screen} on ${targets.get(screen)!.name})`)
  return runHarness({
    scenarios: SCENARIOS[screen],
    theme,
    port: { kind: 'live', target: targets.get(screen)! },
    allowlist: [...loadAllowlist(ALLOWLIST_FILE), ...loadAllowlist(LIVE_ALLOWLIST_FILE)],
    origPort: 0,
    staleCheck: false,
    outDir: path.join(REPORTS_DIR, 'live-selftest', name.replace(/\W+/g, '-')),
    log: () => {},
  })
}

const failing = (r: HarnessResult, screen: string): Set<CheckName> => {
  const out = new Set<CheckName>()
  for (const u of r.units)
    if (u.screen === screen)
      for (const s of u.steps) for (const c of Object.values(s.checks)) if (!c.ok) out.add(c.check)
  return out
}

const problems: string[] = []
const expectPass = (label: string, r: HarnessResult) => {
  const bad = r.units.flatMap((u) =>
    u.steps.filter((s) => !s.ok).map((s) => `${u.screen}/${u.scenario}/${s.step}`),
  )
  console.log(
    `${label}: ${r.ok ? 'PASS' : 'FAIL'} (${r.units.length} runs, ${bad.length} failing steps${r.units.some((u) => u.error) ? ', run error' : ''})`,
  )
  if (!r.ok)
    problems.push(
      `${label} should pass but fails: ${bad.join(', ') || r.units.map((u) => u.error).join('; ')}`,
    )
}

for (const screen of SCREENS_UNDER_TEST)
  expectPass(`1 baseline ${screen}`, await phase(`baseline-${screen}`, screen))

// 2: each change alone, on the screen it touches, must be seen by the DOM, renderVals and pixel checks
for (const [i, c] of CHANGES.entries()) {
  const S = schemas.get(c.screen)!
  sql(c.screen, c.apply(S))
  try {
    console.log(`changed  ${c.what}`)
    const r = await phase(`broken-${i + 1}`, c.screen)
    const f = failing(r, c.screen)
    console.log(
      `2.${i + 1} ${c.screen}: ${r.ok ? 'PASS' : 'FAIL'}, failing checks: ${[...f].join(', ') || 'none'}`,
    )
    if (r.ok) problems.push(`${c.what}: the run passed although the seed was changed`)
    for (const check of ['dom', 'vals', 'pixels'] as const)
      if (!f.has(check)) problems.push(`${c.what}: the ${check} check did not notice`)
  } finally {
    sql(c.screen, c.revert(S))
    console.log(`reverted ${c.what}`)
  }
}

for (const screen of SCREENS_UNDER_TEST)
  expectPass(`3 reverted ${screen}`, await phase(`reverted-${screen}`, screen))

if (problems.length) {
  console.error('\nSELF-TEST FAILED\n  ' + problems.join('\n  '))
  process.exit(1)
}
console.log(
  '\nSELF-TEST OK: on every screen the live mode fails on a changed price and a renamed label, and passes again after the revert',
)
