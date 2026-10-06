// @vitest-environment jsdom
// What the compiled template needs from the view model, and that the screen no longer evaluates source text.
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import bindings from '@generated/settings.bindings.json'
import { atPath, makePair } from './testkit'

const dir = __dirname
const read = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8')

beforeAll(() => {
  process.env.TZ = 'America/New_York'
  vi.useFakeTimers({ now: new Date('2026-06-13T10:36:00-04:00') })
  localStorage.clear()
})
afterAll(() => vi.useRealTimers())

describe('Settings screen wiring', () => {
  it('does not import the loader, the logic source or evaluate text', () => {
    for (const f of fs
      .readdirSync(dir)
      .filter((x) => /\.tsx?$/.test(x) && !/\.test\.tsx?$/.test(x) && x !== 'testkit.ts')) {
      expect(read(f), f).not.toMatch(/loadLogic|logicSource|settings\.logic|new Function|\beval\s*\(/)
    }
    expect(read('Screen.tsx')).toContain('createSettingsLogic')
  })

  it('Logic.ts and data.ts have no bare clock, random or localStorage (the fixtures own those)', () => {
    for (const f of ['Logic.ts', 'data.ts']) {
      const code = read(f).replace(/^\s*\/\/.*$/gm, '')
      expect(code, f).not.toMatch(/Date\.now\(|new Date\(\)|Math\.random|localStorage/)
    }
  })

  it('renderVals provides every root the compiled template binds, and handlers are functions', () => {
    const p = makePair()
    // open the drawer and the add-closure form so their roots exist
    p.port.state = { ...p.port.state, adding: true, section: 'closures' }
    p.port.openEmp(p.port.state.employees[4])
    const vals = p.port.renderVals()
    for (const root of bindings.roots) expect(vals, root).toHaveProperty(root)
    // "dr.effGroups[].rows[].allow": every element of every nested list carries the handler
    const check = (node: unknown, parts: string[], h: string): void => {
      const [head, ...rest] = parts
      if (!rest.length) return void expect(typeof atPath(node, head!.replace(/^\./, '')), h).toBe('function')
      const list = atPath(node, head!.replace(/^\./, ''))
      if (Array.isArray(list)) for (const item of list) check(item, rest, h)
    }
    for (const h of bindings.handlers) check(vals, h.split('[]'), h)
  })
})
