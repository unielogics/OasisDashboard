// parity-live self-test (about a minute once the browser lock is free): the live mode must FAIL when the seeded data
// is deliberately broken (a price, a label) and PASS again once it is put back. Without this the zero-diff result of
// `pnpm parity:live:all` could come from a harness that cannot see the live screens at all.
//
//   pnpm live:up --name lparity --api-port 4024 --web-port 3224 --profile design,parity-ops,parity-pay --freeze 2026-06-13T10:36:00-04:00 --backend ~/oasis/wt/d10-be
//   pnpm parity:live:selftest --stack lparity --backend ~/oasis/wt/d10-be
//
// Phases: 1 baseline (must pass), 2 four seed changes applied straight to the stack's schema (must fail on the right
// checks of the right screens), 3 changes reverted (must pass again). The changes are reverted even when a phase throws.
import '../tools/parity/env'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { loadAllowlist } from '../tools/parity/allowlist'
import { ALLOWLIST_FILE, REPORTS_DIR, ROOT, type Theme } from '../tools/parity/config'
import { runHarness, type HarnessResult } from '../tools/parity/harness'
import { LIVE_ALLOWLIST_FILE, loadStackTarget } from '../tools/parity/live-config'
import { LIVE_USER } from '../tools/parity/live'
import { clickBtn } from '../tools/parity/scenarios/common'
import { selectScenarios } from '../tools/parity/scenarios'
import type { Scenario } from '../tools/parity/scenarios/types'
import type { CheckName } from '../tools/parity/types'

const { values } = parseArgs({
  options: {
    stack: { type: 'string', default: 'lparity' },
    backend: { type: 'string', default: '~/oasis/backend' },
  },
  strict: true,
})
const expand = (p: string) => p.replace(/^~(?=$|\/)/, os.homedir())
const backend = path.resolve(expand(values.backend!))
const stackFile = path.join(ROOT, '.live-stack', `${values.stack}.json`)
const schema = (JSON.parse(fs.readFileSync(stackFile, 'utf8')) as { schema: string }).schema
if (!/^e2e_[a-z0-9_]+$/.test(schema)) throw new Error(`unexpected schema name ${schema}`)

function dbUrl(): string {
  for (const line of fs.readFileSync(path.join(backend, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^DATABASE_URL=(.*)$/)
    if (m) return m[1]!.replace(/^['"]|['"]$/g, '')
  }
  throw new Error(`${backend}/.env has no DATABASE_URL`)
}

function sql(statement: string): string {
  const r = spawnSync('psql', [dbUrl(), '-v', 'ON_ERROR_STOP=1', '-qtA', '-c', statement], {
    encoding: 'utf8',
  })
  if (r.status !== 0)
    throw new Error(`psql failed: ${(r.stderr ?? '').replace(/postgres(ql)?:\/\/\S+/g, '<url>')}`)
  return r.stdout.trim()
}

const S = schema
interface Change {
  what: string
  apply: string
  revert: string
}

/** Every change is guarded by the value it expects to find, so a second run on a half-reverted stack stops. */
const CHANGES: Change[] = [
  {
    what: 'Payments: a seeded price (the first item of INV-20608 gets $1.00 dearer)',
    apply: `update ${S}.invoice_items set price_cents = price_cents + 100 where position = 0 and invoice_id = (select id from ${S}.invoices where invoice_no = 20608)`,
    revert: `update ${S}.invoice_items set price_cents = price_cents - 100 where position = 0 and invoice_id = (select id from ${S}.invoices where invoice_no = 20608)`,
  },
  {
    what: 'Payments: a seeded label (the client of INV-20608 is renamed)',
    apply: `update ${S}.invoices set client_name = 'Aisha Rahmann' where invoice_no = 20608 and client_name = 'Aisha Rahman'`,
    revert: `update ${S}.invoices set client_name = 'Aisha Rahman' where invoice_no = 20608 and client_name = 'Aisha Rahmann'`,
  },
  {
    what: 'Settings: a seeded price (every package gets $1.00 dearer)',
    apply: `update ${S}.services set price_cents = price_cents + 100 where kind = 'package'`,
    revert: `update ${S}.services set price_cents = price_cents - 100 where kind = 'package'`,
  },
  {
    what: 'Settings: a seeded label (the package Express Hand Wash is renamed)',
    apply: `update ${S}.services set name = 'Express Hand Wash!' where kind = 'package' and name = 'Express Hand Wash'`,
    revert: `update ${S}.services set name = 'Express Hand Wash' where kind = 'package' and name = 'Express Hand Wash!'`,
  },
]

const servicesStep: Scenario = {
  id: 'selftest-services',
  screen: 'settings',
  title: 'open Packages & checklists',
  steps: [clickBtn('section-services', 'Packages & checklists')],
}
const scenarios: Scenario[] = [...selectScenarios({ screen: 'payments', scenario: 'initial' }), servicesStep]

async function phase(name: string, theme: Theme = 'light'): Promise<HarnessResult> {
  console.log(`\n== ${name}`)
  return runHarness({
    scenarios,
    theme,
    port: { kind: 'live', target: loadStackTarget(values.stack!, LIVE_USER) },
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

const applied: Change[] = []
try {
  expectPass('1 baseline', await phase('baseline'))

  for (const c of CHANGES) {
    sql(c.apply)
    applied.push(c)
    console.log(`changed  ${c.what}`)
  }
  const broken = await phase('broken')
  for (const [screen, must] of [
    ['payments', ['dom', 'vals', 'pixels']],
    ['settings', ['dom', 'vals', 'pixels']],
  ] as const) {
    const f = failing(broken, screen)
    console.log(`2 broken ${screen}: failing checks ${[...f].join(', ') || 'none'}`)
    for (const c of must)
      if (!f.has(c)) problems.push(`broken ${screen}: the ${c} check did not notice the changed seed`)
  }
  if (broken.ok) problems.push('broken: the run passed although four seeded values were changed')
} finally {
  for (const c of applied.reverse()) {
    sql(c.revert)
    console.log(`reverted ${c.what}`)
  }
}
expectPass('3 reverted', await phase('reverted'))

if (problems.length) {
  console.error('\nSELF-TEST FAILED\n  ' + problems.join('\n  '))
  process.exit(1)
}
console.log(
  '\nSELF-TEST OK: the live mode fails on a changed price and a renamed label, and passes again after the revert',
)
