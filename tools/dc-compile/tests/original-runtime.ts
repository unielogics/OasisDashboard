/* eslint-disable @typescript-eslint/no-explicit-any */
// Pulls pieces of the ORIGINAL dc runtime (design/extracted/runtime/dc-runtime.js) out of the bundle so tests can
// compare the port against the real implementation rather than against a re-typed copy.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const src = fs.readFileSync(path.join(root, 'design/extracted/runtime/dc-runtime.js'), 'utf8')

function slice(from: string, to: string): string {
  const a = src.indexOf(from)
  const b = src.indexOf(to, a)
  if (a < 0 || b < 0) throw new Error(`runtime slice ${from}..${to} not found`)
  return src.slice(a, b)
}

export const original = new Function(
  [
    slice('// src/expr.ts', '// src/encode.ts'),
    slice('var EVENT_MAP', 'var ATTRS'),
    slice('function kebabToCamel', 'function compileAttr'),
    'return { resolve, EVENT_MAP, kebabToCamel, cssToObj }',
  ].join('\n'),
)() as {
  resolve(vals: any, src: string): any
  EVENT_MAP: Record<string, string>
  kebabToCamel(s: string): string
  cssToObj(css: string): Record<string, string>
}
