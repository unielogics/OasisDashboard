// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { logicSource as operations } from '@generated/operations.logic'
import { logicSource as payments } from '@generated/payments.logic'
import { logicSource as settings } from '@generated/settings.logic'
import { loadLogic } from './loadLogic'

const root = path.resolve(__dirname, '..', '..')
const sources = { operations, payments, settings } as const

beforeAll(() => {
  process.env.TZ = 'America/New_York'
  vi.useFakeTimers({ now: new Date('2026-06-13T10:36:00-04:00') })
})
afterAll(() => vi.useRealTimers())

const tokens = (p: string): string[] =>
  [...p.matchAll(/\[(\d*)\]|([A-Za-z_$][A-Za-z0-9_$]*)/g)].map((m) =>
    m[2] !== undefined ? m[2] : `[${m[1]}]`,
  )

/** Values the path reaches in vals (fans out over lists). Empty when it is not reachable. */
function reach(vals: any, p: string): unknown[] {
  let cur: unknown[] = [vals]
  for (const t of tokens(p)) {
    const next: unknown[] = []
    for (const c of cur) {
      if (t === '[]') {
        if (Array.isArray(c)) next.push(...c)
      } else if (/^\[\d+\]$/.test(t)) {
        const i = Number(t.slice(1, -1))
        if (Array.isArray(c) && c[i] !== undefined) next.push(c[i])
      } else if (c !== null && typeof c === 'object' && t in (c as object)) next.push((c as any)[t])
    }
    cur = next
    if (!cur.length) return []
  }
  return cur
}

/**
 * Bindings contract: the original logic's renderVals() on its in-class fixtures provides every root identifier and
 * every root-level list of the compiled template. Leaf paths under panels that are closed by default (sel, sh, dr)
 * are only reachable by driving the UI, which the parity harness does.
 */
describe('renderVals() provides what the compiled templates read', () => {
  for (const screen of ['operations', 'payments', 'settings'] as const) {
    it(screen, () => {
      const Logic = loadLogic(sources[screen], screen)
      const vals = new Logic({}).renderVals()
      const b = JSON.parse(
        fs.readFileSync(path.join(root, 'src/generated', `${screen}.bindings.json`), 'utf8'),
      ) as {
        roots: string[]
        lists: string[]
        paths: string[]
      }
      expect(b.roots.filter((r) => !(r in vals))).toEqual([])
      for (const l of b.lists) {
        const hits = reach(vals, l)
        // Nested lists live under objects that are null while their panel is closed (sel, sh, dr) or under lists
        // that may be empty, so only root-level lists must exist; whatever is reachable must be an array.
        if (!l.includes('.') && !l.includes('[')) expect(hits.length, `list ${l} is not provided`).toBe(1)
        expect(
          hits.every((h) => Array.isArray(h)),
          `list ${l} is not an array`,
        ).toBe(true)
      }
    })
  }
})
