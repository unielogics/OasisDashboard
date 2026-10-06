import type { Diff, JsonValue } from './types'

const clip = (v: unknown): string | undefined => {
  if (v === undefined) return undefined
  const s = typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v)
  return s.length > 240 ? s.slice(0, 237) + '...' : s
}

const isObj = (v: unknown): v is { [k: string]: JsonValue } =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Ordered JSON diff of two serialised renderVals() results. Locators are JSON paths (`kpis[0].sub`). Object key ORDER is
 * compared (style objects are order-sensitive: React diffs and serialises them in key order): a different order is
 * reported as kind "reorder" at the object's path; value differences are kind "value".
 */
export function diffVals(a: JsonValue, b: JsonValue, opts: { limit?: number } = {}): Diff[] {
  const limit = opts.limit ?? 5000
  const out: Diff[] = []
  const push = (d: Diff) => {
    if (out.length < limit) out.push(d)
  }
  const walk = (x: JsonValue | undefined, y: JsonValue | undefined, path: string) => {
    if (out.length >= limit) return
    if (x === undefined || y === undefined) {
      push({ check: 'vals', kind: 'value', loc: path || '$', orig: clip(x), port: clip(y) })
      return
    }
    if (Array.isArray(x) && Array.isArray(y)) {
      const n = Math.max(x.length, y.length)
      for (let i = 0; i < n; i++) walk(x[i], y[i], `${path}[${i}]`)
      return
    }
    if (isObj(x) && isObj(y)) {
      const ka = Object.keys(x)
      const kb = Object.keys(y)
      const common = ka.filter((k) => k in y)
      const commonB = kb.filter((k) => k in x)
      if (common.some((k, i) => k !== commonB[i])) {
        push({
          check: 'vals',
          kind: 'reorder',
          loc: path || '$',
          name: 'keys',
          orig: ka.join(','),
          port: kb.join(','),
        })
      }
      const keys = [...ka, ...kb.filter((k) => !(k in x))]
      for (const k of keys) walk(x[k], y[k], path ? `${path}.${k}` : k)
      return
    }
    if (x !== y || typeof x !== typeof y) {
      push({ check: 'vals', kind: 'value', loc: path || '$', orig: clip(x), port: clip(y) })
    }
  }
  walk(a, b, '')
  return out
}
