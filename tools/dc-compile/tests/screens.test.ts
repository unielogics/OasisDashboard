/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, describe, expect, it } from 'vitest'
import { compileScreens, fullPageCss, SCREENS } from '../compile'
import type { CompileAll, ScreenId } from '../compile'
import type { Bindings } from '../emit'
import { loadPatchConfig, applyPatches, applyCopyToTree } from '../patches'
import { parseTemplate } from '../parse'
import { interpret } from './reference'
import { root } from './original-runtime'
import { buildVals } from './vals'
import type { Mode } from './vals'

const opts = { root, variant: 'prod' as const, tplIds: false, allowComplexExpr: false }
const tmpDir = path.join(root, 'tools/dc-compile/tests/.tmp-snippets')
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

const prod: CompileAll = compileScreens(SCREENS, opts)
const parity: CompileAll = compileScreens(SCREENS, { ...opts, variant: 'parity' })
const text = (v: string | Buffer | undefined): string => (Buffer.isBuffer(v) ? v.toString('utf8') : (v ?? ''))
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8')

describe('compile all three screens', () => {
  it('is deterministic: compiling twice gives identical bytes', () => {
    const again = compileScreens(SCREENS, opts)
    for (const s of SCREENS) {
      for (const [file, data] of Object.entries(prod.perScreen[s]!)) {
        expect(text(again.perScreen[s]![file]), `${s}/${file}`).toBe(text(data))
      }
    }
    expect(Object.keys(again.shared)).toEqual(Object.keys(prod.shared))
    for (const [file, data] of Object.entries(prod.shared)) {
      expect(Buffer.from(again.shared[file]!).equals(Buffer.from(data)), file).toBe(true)
    }
  })

  it('matches the committed output (same check as pnpm dc:check)', () => {
    for (const s of SCREENS) {
      for (const [file, data] of Object.entries(prod.perScreen[s]!)) {
        expect(read('src/generated', file), `src/generated/${file}`).toBe(text(data))
      }
    }
    for (const [file, data] of Object.entries(prod.shared)) {
      expect(fs.readFileSync(path.join(root, file)).equals(Buffer.from(data)), file).toBe(true)
    }
  })

  it('numbers elements like the runtime stamp(): tplCount equals an independent tag count', () => {
    for (const s of SCREENS) {
      const html = read('design/extracted', s, 'template.html')
      const tags = html
        .replace(/<style>[\s\S]*?<\/style>/g, '<style></style>')
        .match(/<[A-Za-z][A-Za-z0-9-]*/g)!.length
      expect(prod.tplCounts[s], s).toBe(tags)
    }
  })

  it('emits data-dc-tpl on every emitted element in the parity variant, numbered from the source', () => {
    for (const s of SCREENS) {
      const html = read('design/extracted', s, 'template.html')
      const control = (html.match(/<sc-if[\s>]/g) ?? []).length + (html.match(/<sc-for[\s>]/g) ?? []).length
      const helmetSubtree = 5 // helmet, 2 x link, 2 x style
      const tsx = text(parity.perScreen[s]!['' + s + '.tsx'])
      const ids = [...tsx.matchAll(/data-dc-tpl="(\d+)"/g)].map((m) => Number(m[1]))
      expect(ids.length, s).toBe(parity.tplCounts[s]! - control - helmetSubtree)
      expect(new Set(ids).size, s).toBe(ids.length)
      expect(Math.max(...ids), s).toBeLessThan(parity.tplCounts[s]!)
      expect(text(prod.perScreen[s]![`${s}.tsx`])).not.toContain('data-dc-tpl')
    }
  })

  it('never emits helmet, sc-* elements or raw {{ }} markers', () => {
    for (const s of SCREENS) {
      const tsx = text(prod.perScreen[s]![`${s}.tsx`])
      expect(tsx).not.toMatch(/<\/?sc-/)
      expect(tsx).not.toMatch(/helmet/i)
      expect(tsx).not.toContain('{{')
    }
  })
})

describe('css, fonts and logic modules', () => {
  it('screen CSS is the helmet global CSS verbatim, with FULL_PAGE_CSS in front for payments and settings', () => {
    const full = fullPageCss(root)
    expect(full).toBe('html,body{height:100%;margin:0}#dc-root,#dc-root>.sc-host{height:100%}')
    for (const s of SCREENS) {
      const global = read('design/extracted', s, 'helmet.global.css')
      const css = text(prod.perScreen[s]![`${s}.screen.css`])
      if (s === 'operations') expect(css).toBe(global)
      else expect(css).toBe(full + '\n' + global)
      expect(text(prod.perScreen[s]![`${s}.styles.ts`])).toContain(JSON.stringify(css))
    }
  })

  it('fonts.css keeps every @font-face block and family name, with urls rewritten to /fonts/<file>.woff2', () => {
    const css = text(prod.shared['src/styles/fonts.css'])
    const original = read('design/extracted/operations/helmet.fonts.css')
    expect(css.match(/@font-face/g)).toHaveLength(42)
    expect(css.replace(/url\("\/fonts\/[a-z-]+\.woff2"\)/g, 'URL')).toBe(
      original.replace(/url\("[0-9a-f-]{36}"\)/g, 'URL'),
    )
    expect(css).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)
    for (const family of ["'Manrope'", "'Bricolage Grotesque'"])
      expect(css).toContain(`font-family: ${family}`)
    const files = new Set([...css.matchAll(/url\("\/fonts\/([a-z-]+\.woff2)"\)/g)].map((m) => m[1]!))
    expect(files.size).toBe(9)
    for (const f of files) {
      expect(
        fs
          .readFileSync(path.join(root, 'public/fonts', f))
          .equals(fs.readFileSync(path.join(root, 'design/extracted/fonts', f))),
      ).toBe(true)
    }
  })

  it('exports the original logic script byte-for-byte as a JSON string (no copy-map entries yet)', async () => {
    for (const s of SCREENS) {
      const mod = await import(/* @vite-ignore */ path.join(root, 'src/generated', `${s}.logic.ts`))
      expect(mod.logicSource).toBe(read('design/extracted', s, 'logic.original.js'))
    }
  })
})

describe('bindings', () => {
  it('lists every root identifier and loop-scoped dotted path', () => {
    for (const s of SCREENS) {
      const b = JSON.parse(text(prod.perScreen[s]![`${s}.bindings.json`])) as Bindings
      expect(b.screen).toBe(s)
      expect(b.roots.length).toBeGreaterThan(20)
      expect(b.roots).toEqual([...b.roots].sort())
      for (const r of b.roots)
        expect(b.paths.some((p) => p === r || p.startsWith(r + '.') || p.startsWith(r + '['))).toBe(true)
      for (const l of b.lists) expect(b.paths).toContain(l)
      expect(b.paths.some((p) => p.includes('[]'))).toBe(true)
    }
    const set = JSON.parse(text(prod.perScreen.settings![`settings.bindings.json`])) as Bindings
    expect(set.lists).toContain('dr.effGroups[].rows')
  })
})

describe('compiled screens vs the original runtime rules', () => {
  const modes: Mode[] = ['truthy', 'falsy', 'empty']
  for (const s of SCREENS) {
    for (const variant of ['prod', 'parity'] as const) {
      it(`${s} (${variant}): renders without exceptions and equals the reference interpreter in all vals modes`, async () => {
        const out = (variant === 'prod' ? prod : parity).perScreen[s]!
        fs.mkdirSync(tmpDir, { recursive: true })
        const file = path.join(tmpDir, `${s}.${variant}.tsx`)
        fs.writeFileSync(file, text(out[`${s}.tsx`]))
        const mod = await import(/* @vite-ignore */ file)

        const cfg = loadPatchConfig(root, s)
        const { nodes } = parseTemplate(read('design/extracted', s, 'template.html'))
        applyPatches(nodes, cfg, s)
        applyCopyToTree(nodes, cfg.copyEntries)
        const bindings = JSON.parse(text(out[`${s}.bindings.json`])) as Bindings

        const markups = new Set<string>()
        for (const mode of modes) {
          const vals = buildVals(bindings, mode)
          // React's server renderer writes the prop name as given; browsers lowercase it, so compare lowercased.
          const norm = (h: string) => h.replace(/ inputMode=/g, ' inputmode=')
          const ours = norm(renderToStaticMarkup(mod.default(vals, { name: s })))
          const ref = norm(renderToStaticMarkup(interpret(nodes, vals, variant === 'parity') as any))
          expect(ours.length).toBeGreaterThan(1000)
          expect(ours === ref, `${s} ${variant} ${mode}`).toBe(true)
          markups.add(ours)
        }
        expect(markups.size).toBe(3)
      })
    }
  }
})

describe('typecheck of the compiler output', () => {
  it(
    'compiles cleanly under the project tsconfig (strict), prod and parity variants',
    { timeout: 180_000 },
    () => {
      const cfg = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile)
      const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, root)
      const options: ts.CompilerOptions = {
        ...parsed.options,
        noEmit: true,
        incremental: false,
        tsBuildInfoFile: undefined,
        plugins: undefined,
      }
      const virtual = new Map<string, string>()
      for (const s of SCREENS) {
        for (const [name, v] of [
          ['prod', prod],
          ['parity', parity],
        ] as const) {
          for (const f of [`${s}.tsx`, `${s}.logic.ts`, `${s}.styles.ts`]) {
            virtual.set(path.join(root, '.virtual', name, f), text(v.perScreen[s]![f]))
          }
        }
      }
      const host = ts.createCompilerHost(options)
      const { fileExists, readFile, getSourceFile } = host
      host.fileExists = (f) => virtual.has(f) || fileExists.call(host, f)
      host.readFile = (f) => virtual.get(f) ?? readFile.call(host, f)
      host.getSourceFile = (f, lang, onErr, create) =>
        virtual.has(f)
          ? ts.createSourceFile(f, virtual.get(f)!, lang)
          : getSourceFile.call(host, f, lang, onErr, create)
      const program = ts.createProgram([...virtual.keys()], options, host)
      const diags = ts.getPreEmitDiagnostics(program).map((d) => {
        const pos = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : null
        return `${d.file ? path.relative(root, d.file.fileName) : ''}${pos ? `:${pos.line + 1}` : ''} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`
      })
      expect(diags).toEqual([])
    },
  )
})

describe('CLI', () => {
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ['--import', 'tsx', 'tools/dc-compile/index.ts', ...args], {
      cwd: root,
      encoding: 'utf8',
    })

  it('--check passes on the committed output, exit 0', () => {
    const r = run('--screen', 'all', '--check')
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toContain('dc:check OK')
  })

  it('--check exits 1 when an output differs', () => {
    const dir = path.join(tmpDir, 'out')
    fs.mkdirSync(dir, { recursive: true })
    const r = run('--screen', 'payments', '--check', '--out', path.relative(root, dir))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('missing')
  })

  it('exits 2 for bad arguments and unknown screens', () => {
    expect(run('--screen', 'nope').status).toBe(2)
    expect(run('--variant=staging').status).toBe(2)
    expect(run('--bogus').status).toBe(2)
  })

  it('--out with --variant=parity writes the data-dc-tpl variant into that directory only', () => {
    const dir = path.join(tmpDir, 'parity-out')
    const r = run('--screen', 'settings', '--variant=parity', '--out', path.relative(root, dir))
    expect(r.status, r.stderr).toBe(0)
    expect(fs.readFileSync(path.join(dir, 'settings.tsx'), 'utf8')).toMatch(/data-dc-tpl="5"/)
    expect(fs.existsSync(path.join(dir, 'operations.tsx'))).toBe(false)
  })
})

export type { ScreenId }
