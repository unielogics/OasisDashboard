/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { renderToStaticMarkup } from 'react-dom/server'
import { Emitter } from '../emit'
import type { Bindings, EmitOptions } from '../emit'
import { parseTemplate } from '../parse'
import { interpret } from './reference'
import { root } from './original-runtime'

export function compileSnippet(
  html: string,
  opts: Partial<EmitOptions> = {},
): { tsx: string; bindings: Bindings } {
  const { nodes, tplCount } = parseTemplate(html)
  const em = new Emitter({ screen: 't', tplIds: false, allowComplexExpr: false, ...opts })
  return em.emit(nodes, ['// test'], { screen: 't', name: 'T', variant: 'prod', tplCount })
}

/** Just the JSX body of the emitted render function, for readable assertions. */
export function bodyOf(tsx: string): string {
  const a = tsx.indexOf('    <>\n')
  const b = tsx.lastIndexOf('    </>')
  return tsx
    .slice(a + 8, b)
    .split('\n')
    .map((l) => l.replace(/^ {6}/, ''))
    .join('\n')
    .trim()
}

const tmpDir = path.join(root, 'tools/dc-compile/tests/.tmp-snippets')

/** Compiles a snippet, runs the emitted module and renders it with the given vals. */
export async function renderSnippet(
  html: string,
  vals: Record<string, unknown>,
  opts: Partial<EmitOptions> = {},
): Promise<string> {
  const { tsx } = compileSnippet(html, opts)
  fs.mkdirSync(tmpDir, { recursive: true })
  const file = path.join(tmpDir, `s${crypto.createHash('sha1').update(tsx).digest('hex').slice(0, 12)}.tsx`)
  fs.writeFileSync(file, tsx)
  const mod = await import(/* @vite-ignore */ file)
  return renderToStaticMarkup(mod.default(vals, { name: 'T' }))
}

/** The original runtime's rendering of the same snippet. */
export function referenceMarkup(html: string, vals: Record<string, unknown>, tplIds = false): string {
  return renderToStaticMarkup(interpret(parseTemplate(html).nodes, vals, tplIds) as any)
}
