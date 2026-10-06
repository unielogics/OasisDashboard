// New dashboard code reads the wall clock in exactly one place (src/lib/clock.ts) and never uses Math.random:
// everything else asks serverNow() or takes the instant as an argument. (The backend enforces its version in lint.)
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..', '..')
const dirs = ['src/lib', 'src/data', 'src/auth', 'src/components/auth']
const allowed = new Set(['src/lib/clock.ts'])

function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(rel))
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts'))
      out.push(rel)
  }
  return out
}

describe('time and randomness discipline in the new code paths', () => {
  const files = dirs.flatMap(walk)
  it('scans a meaningful set of files', () => expect(files.length).toBeGreaterThan(30))
  it('has no bare Date.now(), new Date() or Math.random() outside the offset clock', () => {
    const bad: string[] = []
    for (const f of files) {
      if (allowed.has(f)) continue
      const src = fs
        .readFileSync(path.join(root, f), 'utf8')
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
      if (/\bDate\.now\s*\(/.test(src)) bad.push(`${f}: Date.now()`)
      if (/\bnew Date\s*\(\s*\)/.test(src)) bad.push(`${f}: new Date()`)
      if (/\bMath\.random\s*\(/.test(src)) bad.push(`${f}: Math.random()`)
    }
    expect(bad).toEqual([])
  })
})
