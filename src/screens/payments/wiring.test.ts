// @vitest-environment jsdom
// What the compiled template needs from the view model, and that the screen no longer evaluates source text.
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import bindings from '@generated/payments.bindings.json'
import { atPath, makePair } from './testkit'

const dir = __dirname
const read = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8')

beforeAll(() => {
  process.env.TZ = 'America/New_York'
  vi.useFakeTimers({ now: new Date('2026-06-13T10:36:00-04:00') })
  localStorage.clear()
})
afterAll(() => vi.useRealTimers())

describe('Payments screen wiring', () => {
  it('does not import the loader, the logic source or evaluate text', () => {
    for (const f of fs
      .readdirSync(dir)
      .filter((x) => /\.tsx?$/.test(x) && !/\.test\.tsx?$/.test(x) && x !== 'testkit.ts')) {
      const src = read(f)
      expect(src, f).not.toMatch(/loadLogic|logicSource|payments\.logic|new Function|\beval\s*\(/)
    }
    expect(read('Screen.tsx')).toContain('createPaymentsLogic')
  })

  it('the non-test sources (and src/lib/payments) have no bare clock, random or localStorage outside the fixtures', () => {
    for (const f of ['Logic.ts', 'data.ts'])
      expect(read(f), f).not.toMatch(/Date\.now\(|new Date\(\)|Math\.random|localStorage/)
  })

  it('renderVals provides every root the compiled template binds, and handlers are functions', () => {
    const p = makePair()
    // open a sheet so the sheet roots exist, on an invoice with a pending refund so the ledger handlers exist
    p.port.state = {
      ...p.port.state,
      selId: 'INV-20579',
      sheet: 'refund',
      f: { mode: 'full', items: [], dest: 'card', reason: null, note: '', amount: '' },
    }
    const vals = p.port.renderVals()
    for (const root of bindings.roots) expect(vals, root).toHaveProperty(root)
    for (const h of bindings.handlers) {
      const parts = h.split('[]')
      if (parts.length === 1) {
        expect(typeof atPath(vals, h), h).toBe('function')
        continue
      }
      const list = atPath(vals, parts[0]!)
      if (Array.isArray(list) && list.length) {
        for (const item of list) expect(typeof atPath(item, parts[1]!.replace(/^\./, '')), h).toBe('function')
      }
    }
  })
})
