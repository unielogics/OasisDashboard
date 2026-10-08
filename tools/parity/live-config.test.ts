import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ROOT } from './config'
import { LIVE_FREEZE, stackProblems, type StackFile } from './live-config'

const made: string[] = []
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true })
})

/** A stack file as live-stack writes it, with its dashboard build marker (made for `builtFor`). */
function stack(over: Partial<StackFile> = {}, builtFor: string | null = 'http://127.0.0.1:4065'): StackFile {
  const name = over.name ?? 'cfgtest'
  const distDir = path.join('.next-live', 'stacks', `${name}-${made.length}`)
  made.push(distDir)
  fs.mkdirSync(path.join(ROOT, distDir), { recursive: true })
  if (builtFor)
    fs.writeFileSync(path.join(ROOT, distDir, 'oasis-stack.json'), JSON.stringify({ apiUrl: builtFor }))
  return {
    name,
    schema: `e2e_${name}`,
    webUrl: 'http://127.0.0.1:3265',
    apiUrl: 'http://127.0.0.1:4065',
    frozen: LIVE_FREEZE,
    devPassword: 'x',
    profiles: ['parity-pay', 'design'],
    distDir,
    ...over,
  }
}

describe('stackProblems: a screen runs only on a stack seeded and built for it', () => {
  it('accepts the screen’s own profiles in any order, frozen at the design’s instant', () => {
    expect(stackProblems('payments', stack(), 'lppay')).toEqual([])
    expect(stackProblems('payments', stack({ frozen: '2026-06-13T14:36:00Z' }), 'lppay')).toEqual([])
  })

  it('names a missing stack with the command that starts it', () => {
    const [p] = stackProblems('operations', undefined, 'lpops')
    expect(p).toContain('no live stack "lpops"')
    expect(p).toContain(
      'pnpm live:up --name lpops --api-port 4064 --web-port 3264 --profile design,parity-ops',
    )
  })

  it('refuses a stack seeded with another screen’s profile too (parity-ops on the Payments stack)', () => {
    const out = stackProblems(
      'payments',
      stack({ profiles: ['design', 'parity-ops', 'parity-pay'] }),
      'lppay',
    )
    expect(out[0]).toMatch(
      /seeded with design,parity-ops,parity-pay, the screen needs exactly design,parity-pay/,
    )
    expect(stackProblems('payments', stack({ profiles: ['design'] }), 'lppay')[0]).toMatch(/needs exactly/)
  })

  it('refuses a stack that is not frozen, or frozen at another instant', () => {
    expect(stackProblems('payments', stack({ frozen: null }), 'lppay')[0]).toMatch(/not frozen/)
    expect(stackProblems('payments', stack({ frozen: '2026-06-14T10:36:00-04:00' }), 'lppay')[0]).toMatch(
      /frozen at 2026-06-14/,
    )
  })

  it('refuses a dashboard built for another API, or not built, or from a stack without per-stack builds', () => {
    expect(stackProblems('payments', stack({}, 'http://127.0.0.1:4064'), 'lppay')[0]).toMatch(
      /built for http:\/\/127.0.0.1:4064, not for its API http:\/\/127.0.0.1:4065/,
    )
    expect(stackProblems('payments', stack({}, null), 'lppay')[0]).toMatch(/nothing \(no build\)/)
    expect(stackProblems('payments', stack({ distDir: undefined }), 'lppay')[0]).toMatch(
      /without per-stack builds/,
    )
  })
})
