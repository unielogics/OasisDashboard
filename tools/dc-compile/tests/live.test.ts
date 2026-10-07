/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, describe, expect, it } from 'vitest'
import { compileScreens, SCREENS } from '../compile'
import { CompileError } from '../errors'
import { Emitter } from '../emit'
import type { Bindings } from '../emit'
import { LIVE_BRIDGE, withLiveBridge } from '../live-bridge'
import { applyPatches, loadPatchConfig, parseMarkup } from '../patches'
import type { PatchConfig, PatchOp } from '../patches'
import { parseTemplate } from '../parse'
import { LiveChrome } from '../../../src/auth/chrome'
import { makeSession } from '../../../src/auth/test-fixtures'
import { root } from './original-runtime'
import { buildVals } from './vals'

const tmpDir = path.join(root, 'tools/dc-compile/tests/.tmp-snippets/live')
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

const opts = { root, variant: 'prod' as const, tplIds: false, allowComplexExpr: false }
const text = (v: string | Buffer | undefined): string => (Buffer.isBuffer(v) ? v.toString('utf8') : (v ?? ''))
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8')

const cfg = (ops: PatchOp[]): PatchConfig => ({ hrefMap: {}, copyEntries: [], ops, sha: '' })
const fresh = (html: string) => parseTemplate(html).nodes
const emit = (nodes: ReturnType<typeof fresh>): string =>
  new Emitter({ screen: 't', tplIds: false, allowComplexExpr: false }).emit(nodes, [], {
    screen: 't',
    name: 'T',
    variant: 'live',
    tplCount: 0,
  }).tsx
const body = (tsx: string) => tsx.slice(tsx.indexOf('<>'))
const exit3 = (fn: () => unknown, re?: RegExp) => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(CompileError)
    expect((e as CompileError).exit).toBe(3)
    if (re) expect((e as CompileError).message).toMatch(re)
    return
  }
  throw new Error('expected a patch guard failure (exit 3)')
}

describe('patch ops: insert-after, insert-before, wrap (goldens)', () => {
  const html = '<header>H</header><main><b>one</b><i>two</i></main>'

  it('insert-after splices parsed markup after the target, at the right level', () => {
    const nodes = fresh(html)
    applyPatches(
      nodes,
      cfg([{ op: 'insert-after', tpl: 0, expectTag: 'header', html: '<p>added {{= live.x }}</p>' }]),
      't',
    )
    const out = body(emit(nodes))
    expect(out.indexOf('<header>')).toBeLessThan(out.indexOf('<p>'))
    expect(out.indexOf('<p>')).toBeLessThan(out.indexOf('<main>'))
    expect(out).toContain('{$v.live?.x}')
    expect(out).not.toContain('sc-interp')
  })

  it('insert-before and insert-after inside an element keep sibling order', () => {
    const nodes = fresh(html)
    applyPatches(
      nodes,
      cfg([
        { op: 'insert-before', tpl: 2, expectTag: 'b', html: '<u>first</u>' },
        { op: 'insert-after', tpl: 3, expectTag: 'i', html: '<s>last</s>' },
      ]),
      't',
    )
    const out = body(emit(nodes))
    const order = ['<u>', '<b>', '<i>', '<s>'].map((t) => out.indexOf(t))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(order.every((i) => i > 0)).toBe(true)
  })

  it('wrap puts the target where the single <sc-slot> is, including inside nested markup', () => {
    const nodes = fresh(html)
    applyPatches(
      nodes,
      cfg([
        {
          op: 'wrap',
          tpl: 2,
          expectTag: 'b',
          html: '<div class="w"><section><sc-slot></sc-slot></section><em>after</em></div>',
        },
      ]),
      't',
    )
    const out = body(emit(nodes))
    expect(out).toMatch(/<div className="w">\s*<section>\s*<b>/)
    expect(out.indexOf('<b>')).toBeLessThan(out.indexOf('<em>'))
    expect(out).not.toContain('sc-slot')
  })

  it('wrap keeps the target element (and its own bindings) intact', () => {
    const nodes = fresh('<div sc-camel-on-click="{{ go }}">X</div>')
    applyPatches(nodes, cfg([{ op: 'wrap', tpl: 0, html: '<div><sc-slot></sc-slot></div>' }]), 't')
    expect(emit(nodes)).toContain('onClick={$v.go}')
  })

  it('synthetic nodes carry no data-dc-tpl, original nodes keep their source ids', () => {
    const nodes = fresh(html)
    applyPatches(nodes, cfg([{ op: 'insert-after', tpl: 0, html: '<p>x</p>' }]), 't')
    const tsx = new Emitter({ screen: 't', tplIds: true, allowComplexExpr: false }).emit(nodes, [], {
      screen: 't',
      name: 'T',
      variant: 'live',
      tplCount: 4,
    }).tsx
    expect(tsx).toContain('data-dc-tpl="0"')
    expect(tsx).toContain('data-dc-tpl="1"')
    expect(tsx).toMatch(/<p>\s*\{"x"\}/)
  })

  it('guards: wrong tag, wrong text, missing target, empty markup and bad slot counts all fail with exit 3', () => {
    const run = (op: any) => () => applyPatches(fresh(html), cfg([op]), 't')
    exit3(run({ op: 'insert-after', tpl: 0, expectTag: 'div', html: '<p>x</p>' }), /expected <div>/)
    exit3(
      run({ op: 'insert-after', tpl: 0, expectTextStarts: 'Nope', html: '<p>x</p>' }),
      /does not start with/,
    )
    exit3(run({ op: 'insert-after', tpl: 99, html: '<p>x</p>' }), /does not exist/)
    exit3(run({ op: 'insert-after', tpl: 0, html: '   ' }), /empty/)
    exit3(run({ op: 'insert-after', tpl: 0 }), /needs html/)
    exit3(run({ op: 'wrap', tpl: 2, html: '<div></div>' }), /exactly one/)
    exit3(
      run({ op: 'wrap', tpl: 2, html: '<div><sc-slot></sc-slot><sc-slot></sc-slot></div>' }),
      /exactly one/,
    )
    exit3(
      run({ op: 'wrap', tpl: 2, expectTextStarts: 'two', html: '<div><sc-slot></sc-slot></div>' }),
      /does not start with/,
    )
  })

  it('markup may not contain a helmet and every synthetic text node may use {{= }}', () => {
    exit3(() => parseMarkup('<helmet><style></style></helmet>', 'w'), /helmet/)
    const nodes = parseMarkup('<p>{{= a.b }}</p>', 'w')
    const p = nodes[0] as any
    expect(p.tpl).toBe(-1)
    expect(p.children[0].allowRaw).toBe(true)
  })

  it('raw {{= }} is rejected in the ORIGINAL template text (only patch markup may use it)', () => {
    expect(() => emit(fresh('<p>{{= a.b }}</p>'))).toThrow()
  })
})

describe('live patch files and partials', () => {
  const mkRoot = (files: Record<string, string>): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-live-'))
    fs.mkdirSync(path.join(dir, 'design-patches/live/partials'), { recursive: true })
    for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, 'design-patches', f), c)
    return dir
  }

  it('prod and parity never read design-patches/live; live appends its ops after the base ops', () => {
    const dir = mkRoot({
      'operations.patch.json': JSON.stringify({ ops: [{ op: 'remove', tpl: 5 }] }),
      'live/operations.patch.json': JSON.stringify({ ops: [{ op: 'remove', tpl: 6 }] }),
    })
    try {
      expect(loadPatchConfig(dir, 'operations', 'prod').ops.map((o) => o.tpl)).toEqual([5])
      expect(loadPatchConfig(dir, 'operations', 'parity').ops.map((o) => o.tpl)).toEqual([5])
      expect(loadPatchConfig(dir, 'operations', 'live').ops.map((o) => o.tpl)).toEqual([5, 6])
      expect(loadPatchConfig(dir, 'operations', 'live').sha).not.toBe(
        loadPatchConfig(dir, 'operations', 'prod').sha,
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('htmlFile loads a partial, expands @include recursively, and the content is part of the patch sha', () => {
    const dir = mkRoot({
      'live/payments.patch.json': JSON.stringify({
        ops: [{ op: 'insert-after', tpl: 0, htmlFile: 'outer.html' }],
      }),
      'live/partials/outer.html': '<div>outer @include(inner.html)</div>\n',
      'live/partials/inner.html': '<b>inner</b>\n',
    })
    try {
      const a = loadPatchConfig(dir, 'payments', 'live')
      expect((a.ops[0] as any).html).toBe('<div>outer <b>inner</b></div>\n')
      expect((a.ops[0] as any).htmlFile).toBeUndefined()
      fs.writeFileSync(path.join(dir, 'design-patches/live/partials/inner.html'), '<b>changed</b>\n')
      expect(loadPatchConfig(dir, 'payments', 'live').sha).not.toBe(a.sha)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects a missing partial, a self-including partial, a path-like name and html together with htmlFile (exit 3)', () => {
    const base = (op: object, partials: Record<string, string> = {}) => {
      const files: Record<string, string> = { 'live/settings.patch.json': JSON.stringify({ ops: [op] }) }
      for (const [k, v] of Object.entries(partials)) files['live/partials/' + k] = v
      return mkRoot(files)
    }
    const dirs: string[] = []
    try {
      let d = base({ op: 'insert-after', tpl: 0, htmlFile: 'nope.html' })
      dirs.push(d)
      exit3(() => loadPatchConfig(d, 'settings', 'live'), /does not exist/)
      d = base(
        { op: 'insert-after', tpl: 0, htmlFile: 'loop.html' },
        { 'loop.html': 'x @include(loop.html)' },
      )
      dirs.push(d)
      exit3(() => loadPatchConfig(d, 'settings', 'live'), /includes itself/)
      d = base({ op: 'insert-after', tpl: 0, htmlFile: '../secret' })
      dirs.push(d)
      exit3(() => loadPatchConfig(d, 'settings', 'live'), /plain file name/)
      d = base({ op: 'insert-after', tpl: 0, html: '<p/>', htmlFile: 'a.html' }, { 'a.html': '<p/>' })
      dirs.push(d)
      exit3(() => loadPatchConfig(d, 'settings', 'live'), /not both/)
    } finally {
      for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
    }
  })
})

describe('live variant of the three screens', () => {
  const prod = compileScreens(SCREENS, opts)
  const live = compileScreens(SCREENS, { ...opts, variant: 'live' })

  it('is deterministic and prod output is untouched by the live files', () => {
    const again = compileScreens(SCREENS, { ...opts, variant: 'live' })
    for (const s of SCREENS)
      for (const [f, d] of Object.entries(live.perScreen[s]!))
        expect(text(again.perScreen[s]![f]), `${s}/${f}`).toBe(text(d))
    for (const s of SCREENS) {
      for (const [f, d] of Object.entries(prod.perScreen[s]!)) expect(read('src/generated', f)).toBe(text(d))
      expect(text(prod.perScreen[s]![`${s}.tsx`])).not.toContain('live?.')
      expect(text(prod.perScreen[s]![`${s}.logic.ts`])).not.toContain('__oasisLive')
    }
  })

  it('the header says variant:live and the generated meta carries it', () => {
    for (const s of SCREENS) {
      const tsx = text(live.perScreen[s]![`${s}.tsx`])
      expect(tsx).toContain('variant:live')
      expect(tsx).toContain('"variant":"live"')
    }
  })

  // The Payments wave adds Squarespace states that its live view model owns (DV-214, DV-215); nothing else may leave live.*.
  const PAYMENTS_OWN =
    /^(d\.ledger\[\]\.(awaiting|confirm|confirmStyle|confirmNote)|sh\.(needsUrl|urlRaw|setUrl|hasUrlError|urlError))$/

  it('only the chip, view-as and bar bindings differ: every live binding is under live.*', () => {
    for (const s of SCREENS) {
      const p = JSON.parse(text(prod.perScreen[s]![`${s}.bindings.json`])) as Bindings
      const l = JSON.parse(text(live.perScreen[s]![`${s}.bindings.json`])) as Bindings
      const added = l.paths.filter((x) => !p.paths.includes(x))
      expect(added.length, s).toBeGreaterThan(5)
      for (const a of added)
        expect(a, s).toMatch(
          s === 'payments'
            ? new RegExp(`${/^live\.|^r\.(name|lim|style|onClick)$/.source}|${PAYMENTS_OWN.source}`)
            : /^live\.|^r\.(name|lim|style|onClick)$/,
        )
      expect(l.roots).toContain('live')
    }
  })

  it('every screen gets the user chip bindings, the sign-out menu and the view-as bar; only Payments gets Preview-as', () => {
    for (const s of SCREENS) {
      const tsx = text(live.perScreen[s]![`${s}.tsx`])
      for (const b of [
        'live?.user?.initials',
        'live?.user?.short',
        'live?.user?.roleTitle',
        'live?.user?.name',
        'live?.user?.email',
        'live?.menu?.toggle',
        'live?.menu?.signOut',
        'live?.menu?.open',
        'live?.viewAs?.active',
        'live?.viewAs?.exit',
        'live?.viewAs?.label',
      ])
        expect(tsx, `${s} ${b}`).toContain(b)
      expect(tsx.includes('live?.canViewAs'), s).toBe(s === 'payments')
      expect(tsx).not.toContain('Rafael M.')
      expect(tsx).not.toMatch(/>\s*\{?"RM"\}?\s*</)
    }
  })

  it('appends the bridge exactly once to each logic source and leaves the original text before it unchanged', () => {
    for (const s of SCREENS) {
      const src = text(live.perScreen[s]![`${s}.logic.ts`])
      const logic = JSON.parse(src.slice(src.indexOf('= ') + 2)) as string
      const orig = read('design/extracted', s, 'logic.original.js')
      expect(logic.startsWith(orig.replace(/\s*$/, '\n'))).toBe(true)
      expect(logic.endsWith(LIVE_BRIDGE)).toBe(true)
      expect(logic.split('__oasisLive').length - 1).toBe(1)
    }
  })

  it('the live template changes parse back into the screen the designs have (Payments: nav and theme stay)', () => {
    const tsx = text(live.perScreen.payments!['payments.tsx'])
    expect(tsx).toContain('href="/operations"')
    expect(tsx).toContain('onClick={$v.toggleTheme}')
  })

  for (const s of SCREENS) {
    it(`${s}: renders with real session values, the menu closed and open, and the view-as bar`, async () => {
      fs.mkdirSync(tmpDir, { recursive: true })
      const file = path.join(tmpDir, `${s}.live.tsx`)
      fs.writeFileSync(file, text(live.perScreen[s]![`${s}.tsx`]))
      const mod = await import(/* @vite-ignore */ file)
      const bindings = JSON.parse(text(live.perScreen[s]![`${s}.bindings.json`])) as Bindings
      const render = (chrome: LiveChrome, mode: 'truthy' | 'falsy' = 'falsy') => {
        const vals = buildVals(bindings, mode)
        vals.live = chrome.vals()
        return renderToStaticMarkup(mod.default(vals, { name: s }))
      }

      const sup = new LiveChrome()
      sup.setSession(makeSession({ role: 'super' }))
      const closed = render(sup)
      expect(closed).toContain('>RM<')
      expect(closed).toContain('Rafael M.')
      expect(closed).toContain('Super Admin')
      expect(closed).not.toContain('Sign out')
      expect(closed).not.toContain('Viewing as')
      expect(closed.includes('Preview as'), `${s} preview`).toBe(s === 'payments')
      expect(closed).toContain('data-live-menu="user"')

      sup.toggleUserMenu()
      const open = render(sup)
      expect(open).toContain('Sign out')
      expect(open).toContain('rafael@oasis.test')
      expect(open).toContain('Rafael Mendes')

      const mgmt = new LiveChrome()
      mgmt.setSession(makeSession({ role: 'mgmt' }))
      expect(render(mgmt)).not.toContain('Preview as')

      const viewing = new LiveChrome()
      viewing.setSession(
        makeSession({
          role: 'super',
          roles: [{ id: 'role-crew', key: 'crew', name: 'Crew' }],
          displayRole: 'Crew',
          viewAs: {
            active: true,
            canViewAs: true,
            roleId: 'role-crew',
            roleName: 'Crew',
            options: makeSession({ role: 'super' }).viewAs.options,
          },
        }),
      )
      const bar = render(viewing)
      expect(bar).toContain('Viewing as')
      expect(bar).toContain('>Crew<')
      expect(bar).toContain('Exit')
    })
  }

  it('Payments Preview-as menu lists the session roles, highlights the viewed one and uses the design wording', async () => {
    fs.mkdirSync(tmpDir, { recursive: true })
    const file = path.join(tmpDir, 'payments.menu.tsx')
    fs.writeFileSync(file, text(live.perScreen.payments!['payments.tsx']))
    const mod = await import(/* @vite-ignore */ file)
    const bindings = JSON.parse(text(live.perScreen.payments!['payments.bindings.json'])) as Bindings
    const chrome = new LiveChrome()
    chrome.setSession(makeSession({ role: 'super' }))
    chrome.toggleViewAsMenu()
    const vals = buildVals(bindings, 'falsy')
    vals.live = chrome.vals()
    const html = renderToStaticMarkup(mod.default(vals, { name: 'payments' }))
    expect(html).toContain('Limits come from Settings')
    for (const n of ['Super Admin', 'Management', 'Crew']) expect(html).toContain(`>${n}<`)
    expect(html).toContain('refunds no limit')
    expect(html).toContain('refunds ≤ $1000')
    expect(html).toContain('refunds ≤ $25')
    // not viewing anyone: the locked (Super Admin) entry is the selected one
    expect(html).toContain('background:var(--accentSoft)')
  })

  it('guards: a changed template fails the build (exit 3) instead of silently drifting', () => {
    const real = loadPatchConfig(root, 'operations', 'live')
    const html = read('design/extracted/operations/template.html')
    for (const [from, to] of [
      ['>RM</div>', '>RN</div>'],
      ['Rafael M.', 'Rafael N.'],
      ['>Manager</div>', '>Mgr</div>'],
      ['gap:9px;padding:4px 12px 4px 4px', 'gap:9px;padding:4px 12px 4px 5px'],
    ] as const) {
      expect(html).toContain(from)
      exit3(() => applyPatches(parseTemplate(html.replace(from, to)).nodes, real, 'operations'))
    }
    const rp = loadPatchConfig(root, 'payments', 'live')
    const ph = read('design/extracted/payments/template.html')
    for (const [from, to] of [
      ['toggleRoleMenu', 'toggleRoleMenu2'],
      ['list="{{ roleOpts }}"', 'list="{{ roleOptz }}"'],
      ['value="{{ roleMenu }}"', 'value="{{ roleMenuX }}"'],
    ] as const) {
      expect(ph).toContain(from)
      exit3(() => applyPatches(parseTemplate(ph.replace(from, to)).nodes, rp, 'payments'))
    }
  })

  it('bridge anchors: a logic source without renderVals, toggleTheme or theme fails the build (exit 3)', () => {
    const orig = read('design/extracted/settings/logic.original.js')
    expect(() => withLiveBridge(orig, 'settings')).not.toThrow()
    exit3(() => withLiveBridge(orig.replace('toggleTheme:', 'toggleTheme2:'), 'settings'), /toggleTheme/)
    exit3(
      () => withLiveBridge(orig.replace(/theme:s\.theme/, 'theme:s.th'), 'settings'),
      /theme in renderVals/,
    )
    exit3(
      () =>
        withLiveBridge(
          orig.replace('renderVals() {', 'renderVals2() {').replace('renderVals(){', 'renderVals2(){'),
          'settings',
        ),
      /renderVals/,
    )
    exit3(() => withLiveBridge('class Other {}', 'settings'), /class Component/)
  })
})

describe('CLI --variant=live', () => {
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ['--import', 'tsx', 'tools/dc-compile/index.ts', ...args], {
      cwd: root,
      encoding: 'utf8',
    })

  it('writes the live output into --out only, exit 0; dc:check of the prod output is unaffected', () => {
    const dir = path.join(tmpDir, 'cli')
    const r = run('--screen', 'payments', '--variant=live', '--out', path.relative(root, dir))
    expect(r.status, r.stderr).toBe(0)
    expect(fs.readFileSync(path.join(dir, 'payments.tsx'), 'utf8')).toContain('live?.viewAs')
    expect(fs.existsSync(path.join(dir, 'operations.tsx'))).toBe(false)
    const check = run('--screen', 'all', '--check')
    expect(check.status, check.stderr).toBe(0)
  })

  it('--variant=live --check against the (missing) output dir exits 1', () => {
    const r = run(
      '--screen',
      'settings',
      '--variant=live',
      '--check',
      '--out',
      'tools/dc-compile/tests/.tmp-snippets/live/nothing',
    )
    expect(r.status).toBe(1)
  })
})
