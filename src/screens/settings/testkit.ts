/* eslint-disable @typescript-eslint/no-explicit-any */
// Shared helpers for the tests that run the ORIGINAL class (design/extracted/settings/logic.original.js, evaluated by
// the screens' own loader) side by side with the typed view model.
import fs from 'node:fs'
import path from 'node:path'
import { DCLogic } from '@/dc/DCLogic'
import type { DCHostLike } from '@/dc/DCLogic'
import { loadLogic } from '@/dc/loadLogic'
import { serializeVals } from '@/dc/serialize'
import { createSettingsLogic } from './Logic'
import { FixtureData } from './fixtures'
import type { SettingsData } from './data'

const root = path.resolve(__dirname, '..', '..', '..')

export const originalSource = fs.readFileSync(
  path.join(root, 'design/extracted/settings/logic.original.js'),
  'utf8',
)

/** A host that behaves like DCHost.__setLogicState: patch applied now, re-render counted. */
export function attach(logic: DCLogic): { renders: () => number; forced: () => number } {
  let renders = 0
  let forced = 0
  const host: DCHostLike = {
    __setLogicState(update, cb) {
      const prev = logic.state
      const patch = typeof update === 'function' ? update(prev) : update
      logic.state = { ...prev, ...patch }
      renders++
      cb?.()
    },
    forceUpdate() {
      forced++
    },
  }
  logic.__host = host
  return { renders: () => renders, forced: () => forced }
}

export interface Pair {
  orig: any
  port: any
}

/** An original instance and a port instance, both hosted, built from the same localStorage and clock. */
export function makePair(data: SettingsData = new FixtureData()): Pair {
  const Orig = loadLogic(originalSource, 'settings')
  const orig = new Orig({}) as any
  const port = new (createSettingsLogic(data))({}) as any
  attach(orig)
  attach(port)
  return { orig, port }
}

export const serial = (logic: DCLogic): unknown => serializeVals(logic.renderVals())

/** First difference between two serialised values, including object key ORDER, as a readable path; null when equal. */
export function firstDiff(a: unknown, b: unknown, at = '$'): string | null {
  if (a === b) return null
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    return `${at}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${at}: array vs object`
  if (Array.isArray(a)) {
    const bb = b as unknown[]
    if (a.length !== bb.length) return `${at}.length: ${a.length} !== ${bb.length}`
    for (let i = 0; i < a.length; i++) {
      const d = firstDiff(a[i], bb[i], `${at}[${i}]`)
      if (d) return d
    }
    return null
  }
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  if (ka.join('\u0000') !== kb.join('\u0000')) return `${at}: keys [${ka.join(',')}] !== [${kb.join(',')}]`
  for (const k of ka) {
    const d = firstDiff((a as any)[k], (b as any)[k], `${at}.${k}`)
    if (d) return d
  }
  return null
}

/** Paths of every function in a renderVals() object ("hourRows[3].toggle", "dr.fields[0].set"). */
export function handlerPaths(vals: unknown, at = ''): string[] {
  if (typeof vals === 'function') return [at]
  if (vals === null || typeof vals !== 'object') return []
  if (Array.isArray(vals)) return vals.flatMap((v, i) => handlerPaths(v, `${at}[${i}]`))
  return Object.entries(vals).flatMap(([k, v]) => handlerPaths(v, at ? `${at}.${k}` : k))
}

export function atPath(vals: any, p: string): any {
  let cur = vals
  for (const part of p.match(/[^.[\]]+/g) || []) {
    if (cur === null || cur === undefined) return undefined
    cur = cur[part]
  }
  return cur
}

/** Deterministic pseudo-random sequence (mulberry32) so failures reproduce. */
export function seeded(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}
