import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { CompileError } from './errors'
import { parsePath, splitInterp } from './grammar'
import { textOf, walkEls } from './parse'
import type { ElNode, Node } from './parse'

export interface CopyEntry {
  id: string
  screen: string
  scope: 'template' | 'logic'
  from: string
  to: string
  /** Exact number of occurrences that must be replaced; anything else fails the build (exit 3). */
  count: number
}

export type PatchOp =
  | { op: 'replace-text'; tpl: number; expectTag?: string; expect: string; with: string }
  | { op: 'rewrite-href'; tpl: number; expectTag?: string; expect: string; to: string }
  | { op: 'set-attr'; tpl: number; expectTag?: string; name: string; expect: string | null; value: string }
  | { op: 'wrap-if'; tpl: number; expectTag?: string; expectTextStarts?: string; cond: string }
  | { op: 'remove'; tpl: number; expectTag?: string; expectTextStarts?: string }

export interface PatchConfig {
  hrefMap: Record<string, string>
  copyEntries: CopyEntry[]
  ops: PatchOp[]
  /** sha256 over the raw bytes of the three patch files that apply to this screen. */
  sha: string
}

const guard = (ok: boolean, msg: string): void => {
  if (!ok) throw new CompileError('patch guard failed: ' + msg, 3)
}

interface JsonFile {
  map?: Record<string, string>
  entries?: CopyEntry[]
  ops?: PatchOp[]
}

const readJson = (file: string): { raw: string; json: JsonFile } => {
  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{}'
  return { raw, json: JSON.parse(raw) as JsonFile }
}

export function loadPatchConfig(root: string, screen: string): PatchConfig {
  const dir = path.join(root, 'design-patches')
  const href = readJson(path.join(dir, 'href-map.json'))
  const copy = readJson(path.join(dir, 'copy-map.json'))
  const own = readJson(path.join(dir, `${screen}.patch.json`))
  const h = crypto.createHash('sha256')
  h.update(href.raw).update('\0').update(copy.raw).update('\0').update(own.raw)
  const entries = (copy.json.entries ?? []).filter((e) => e.screen === screen)
  return {
    hrefMap: href.json.map ?? {},
    copyEntries: entries,
    ops: own.json.ops ?? [],
    sha: h.digest('hex'),
  }
}

/** Replace `from` by `to`, requiring exactly `count` occurrences. Returns the new text. */
export function applyCopy(text: string, entries: CopyEntry[], scope: 'template' | 'logic'): string {
  for (const e of entries) {
    if (e.scope !== scope) continue
    const n = text.split(e.from).length - 1
    guard(
      n === e.count,
      `copy-map ${e.id} (${scope}): expected ${e.count} occurrence(s) of ${JSON.stringify(e.from)}, found ${n}`,
    )
    text = text.split(e.from).join(e.to)
  }
  return text
}

/** Applies the screen patch ops and the href map to the parsed tree (tplIds already assigned, so ops use source ids). */
export function applyPatches(nodes: Node[], cfg: PatchConfig, screen: string): Node[] {
  const byTpl = new Map<number, { el: ElNode; parent: ElNode | null }>()
  walkEls(nodes, (el, parent) => byTpl.set(el.tpl, { el, parent }))
  const siblings = (parent: ElNode | null): Node[] => (parent ? parent.children : nodes)

  for (const op of cfg.ops) {
    const hit = byTpl.get(op.tpl)
    guard(!!hit, `${screen}: ${op.op} targets tpl ${op.tpl} which does not exist`)
    const { el, parent } = hit!
    const where = `${screen} ${op.op} tpl ${op.tpl}`
    if (op.expectTag !== undefined)
      guard(el.tag === op.expectTag, `${where}: expected <${op.expectTag}>, found <${el.tag}>`)
    switch (op.op) {
      case 'replace-text': {
        guard(
          el.children.length === 1 && el.children[0]!.kind === 'text',
          `${where}: element must hold a single text node`,
        )
        const t = el.children[0] as Extract<Node, { kind: 'text' }>
        guard(
          t.value === op.expect,
          `${where}: expected text ${JSON.stringify(op.expect)}, found ${JSON.stringify(t.value)}`,
        )
        t.value = op.with
        t.allowRaw = true
        break
      }
      case 'rewrite-href': {
        const a = el.attrs.find((x) => x.name === 'href')
        guard(
          !!a && a.value === op.expect,
          `${where}: expected href ${JSON.stringify(op.expect)}, found ${JSON.stringify(a?.value)}`,
        )
        a!.value = op.to
        break
      }
      case 'set-attr': {
        const a = el.attrs.find((x) => x.name === op.name)
        guard(
          (a?.value ?? null) === op.expect,
          `${where}: expected ${op.name}=${JSON.stringify(op.expect)}, found ${JSON.stringify(a?.value ?? null)}`,
        )
        if (a) a.value = op.value
        else el.attrs.push({ name: op.name, value: op.value })
        break
      }
      case 'wrap-if': {
        if (op.expectTextStarts !== undefined) {
          guard(
            textOf(el.children).trimStart().startsWith(op.expectTextStarts),
            `${where}: text does not start with ${JSON.stringify(op.expectTextStarts)}`,
          )
        }
        guard(!!parsePath(op.cond), `${where}: cond ${JSON.stringify(op.cond)} must be a plain path`)
        const list = siblings(parent)
        const i = list.indexOf(el)
        const wrapper: ElNode = {
          kind: 'el',
          tag: 'sc-if',
          tpl: -1,
          attrs: [{ name: 'value', value: `{{ ${op.cond} }}` }],
          children: [el],
        }
        list[i] = wrapper
        break
      }
      case 'remove': {
        if (op.expectTextStarts !== undefined) {
          guard(
            textOf(el.children).trimStart().startsWith(op.expectTextStarts),
            `${where}: text does not start with ${JSON.stringify(op.expectTextStarts)}`,
          )
        }
        const list = siblings(parent)
        list.splice(list.indexOf(el), 1)
        break
      }
    }
  }

  // Cross-design navigation: hrefs are .dc.html file names in the designs and routes in the port.
  walkEls(nodes, (el) => {
    for (const a of el.attrs) {
      if (a.name !== 'href') continue
      if (Object.prototype.hasOwnProperty.call(cfg.hrefMap, a.value)) {
        a.value = cfg.hrefMap[a.value]!
      } else {
        guard(
          !/\.dc\.html/i.test(a.value),
          `${screen}: href ${JSON.stringify(a.value)} points at a design file but is not in href-map.json`,
        )
      }
    }
  })
  return nodes
}

/** Applies fn to the static parts of an interpolated string, leaving every {{ expr }} untouched. */
const mapStatic = (value: string, fn: (s: string) => string): string =>
  splitInterp(value)
    .map((p, i) => (i & 1 ? `{{${p}}}` : fn(p)))
    .join('')

/**
 * Applies the copy map to static text and static attribute values (static parts of interpolated strings
 * included; bound values are logic output and are handled by the logic-scope entries).
 */
export function applyCopyToTree(nodes: Node[], entries: CopyEntry[]): void {
  const tpl = entries.filter((e) => e.scope === 'template')
  if (!tpl.length) return
  const strings: { get(): string; set(v: string): void }[] = []
  const visit = (list: Node[]) => {
    for (const n of list) {
      if (n.kind === 'text') {
        strings.push({ get: () => n.value, set: (v) => (n.value = v) })
      } else {
        for (const a of n.attrs) {
          if (!a.name.startsWith('sc-camel-on-') && a.name !== 'style') {
            strings.push({ get: () => a.value, set: (v) => (a.value = v) })
          }
        }
        visit(n.children)
      }
    }
  }
  visit(nodes)
  for (const e of tpl) {
    let total = 0
    for (const s of strings) mapStatic(s.get(), (p) => ((total += p.split(e.from).length - 1), p))
    guard(
      total === e.count,
      `copy-map ${e.id} (template): expected ${e.count} occurrence(s) of ${JSON.stringify(e.from)}, found ${total}`,
    )
    for (const s of strings) s.set(mapStatic(s.get(), (p) => p.split(e.from).join(e.to)))
  }
}
