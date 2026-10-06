/* eslint-disable @typescript-eslint/no-explicit-any */
// Throwaway extraction (documented in docs/screens-operations.md): renders the ORIGINAL Command Center bundle in the
// pinned Chromium at the frozen clock, applies each golden scenario through the live logic instance's setState and
// records the projection of its renderVals(). The output is committed; golden.test.ts asserts the port against it.
//
//   export PATH=$HOME/.local/bin:$PATH NODE_OPTIONS=--max-old-space-size=2048
//   pnpm exec tsx tests/operations/extract-golden.ts          # writes tests/fixtures/golden/operations.json
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchBrowser, newParityContext } from '../../tools/parity/browser'
import { startOriginalServer } from '../../tools/parity/serve-original'
import { serializeVals } from '../../tools/parity/vals-serialize'
import { BASELINE, GOLDEN_SCENARIOS, project } from '../../src/screens/operations/golden-project'

const out = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'golden',
  'operations.json',
)

async function main() {
  const server = await startOriginalServer()
  const browser = await launchBrowser()
  try {
    const pc = await newParityContext(browser, {
      theme: 'light',
      allowedOrigins: [server.origin],
      hideBranding: true,
    })
    await pc.page.goto(server.url('operations'), { waitUntil: 'load' })
    await pc.page.waitForSelector('#dc-root .sc-host', { state: 'attached' })
    const results = await pc.page.evaluate(
      ({ scenarios, baseline, ser }) => {
        const serialize = new Function('return ' + ser)() as (v: unknown) => unknown
        const host = document.querySelector('#dc-root .sc-host') as any
        const key = Object.keys(host).find((k) => k.startsWith('__reactFiber$'))!
        let fiber = host[key]
        let logic: any = null
        while (fiber) {
          if (fiber.stateNode && fiber.stateNode.logic) {
            logic = fiber.stateNode.logic
            break
          }
          fiber = fiber.return
        }
        if (!logic) throw new Error('logic instance not found')
        return scenarios.map((s: any) => {
          logic.setState({ ...baseline, ...s.patch })
          return [s.name, JSON.parse(JSON.stringify(serialize(logic.renderVals())))]
        })
      },
      { scenarios: GOLDEN_SCENARIOS, baseline: BASELINE, ser: serializeVals.toString() },
    )
    const sections = new Map(GOLDEN_SCENARIOS.map((s) => [s.name, s.sections]))
    const golden = Object.fromEntries(
      (results as Array<[string, any]>).map(([name, vals]) => [name, project(vals, sections.get(name))]),
    )
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, JSON.stringify(golden) + '\n')
    console.log(`wrote ${Object.keys(golden).length} scenarios to ${path.relative(process.cwd(), out)}`)
  } finally {
    await browser.close()
    await server.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
