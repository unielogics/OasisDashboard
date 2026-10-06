import { cssToObj, kebabToCamel } from '../../src/dc/css'
import { CompileError } from './errors'
import { parsePath, splitInterp, wholeBinding } from './grammar'
import type { PathExpr } from './grammar'
import { CAMEL_ATTR } from './parse'
import type { ElNode, Node, TextNode } from './parse'

export interface EmitOptions {
  screen: string
  /** Stamp data-dc-tpl="N" (source element index) on every emitted element. */
  tplIds: boolean
  /** Emit R(scope, "src") for expressions outside the strict grammar instead of failing. */
  allowComplexExpr: boolean
}

export interface Bindings {
  screen: string
  roots: string[]
  /** Paths used as an sc-for list (loop scope shown as `list[]`). */
  lists: string[]
  /** Paths used as an sc-if condition. */
  conds: string[]
  /** Paths bound to event handlers or refs (functions / ref objects, never rendered). */
  handlers: string[]
  /** Every path the template reads, roots and loop-scoped dotted paths (`bays[].name`), digits as `[0]`. */
  paths: string[]
}

const EVENT_MAP: Record<string, string> = {
  onclick: 'onClick',
  onchange: 'onChange',
  oninput: 'onInput',
  onsubmit: 'onSubmit',
  onkeydown: 'onKeyDown',
  onkeyup: 'onKeyUp',
  onkeypress: 'onKeyPress',
  onmousedown: 'onMouseDown',
  onmouseup: 'onMouseUp',
  onmouseenter: 'onMouseEnter',
  onmouseleave: 'onMouseLeave',
  onfocus: 'onFocus',
  onblur: 'onBlur',
  ondoubleclick: 'onDoubleClick',
  oncontextmenu: 'onContextMenu',
  onmousemove: 'onMouseMove',
  onmouseover: 'onMouseOver',
  onmouseout: 'onMouseOut',
  onpointerdown: 'onPointerDown',
  onpointerup: 'onPointerUp',
  onpointermove: 'onPointerMove',
  onpointerenter: 'onPointerEnter',
  onpointerleave: 'onPointerLeave',
  onpointercancel: 'onPointerCancel',
  onpointerover: 'onPointerOver',
  onpointerout: 'onPointerOut',
  ongotpointercapture: 'onGotPointerCapture',
  onlostpointercapture: 'onLostPointerCapture',
  ontouchstart: 'onTouchStart',
  ontouchend: 'onTouchEnd',
  ontouchmove: 'onTouchMove',
  ontouchcancel: 'onTouchCancel',
  ondragstart: 'onDragStart',
  ondragend: 'onDragEnd',
  ondragenter: 'onDragEnter',
  ondragleave: 'onDragLeave',
  ondragover: 'onDragOver',
  onanimationstart: 'onAnimationStart',
  onanimationend: 'onAnimationEnd',
  onanimationiteration: 'onAnimationIteration',
  ontransitionend: 'onTransitionEnd',
}

/** Hyphenated / lowercase source attributes whose React prop name differs. Each pair yields the same DOM attribute. */
const ATTR_RENAME: Record<string, string> = {
  'stroke-width': 'strokeWidth',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'stroke-dasharray': 'strokeDasharray',
  'stroke-dashoffset': 'strokeDashoffset',
  'stroke-miterlimit': 'strokeMiterlimit',
  'stroke-opacity': 'strokeOpacity',
  'fill-opacity': 'fillOpacity',
  'fill-rule': 'fillRule',
  'clip-rule': 'clipRule',
  'text-anchor': 'textAnchor',
  inputmode: 'inputMode',
  tabindex: 'tabIndex',
  maxlength: 'maxLength',
  minlength: 'minLength',
  readonly: 'readOnly',
  autocomplete: 'autoComplete',
  autofocus: 'autoFocus',
  colspan: 'colSpan',
  rowspan: 'rowSpan',
  spellcheck: 'spellCheck',
  contenteditable: 'contentEditable',
  crossorigin: 'crossOrigin',
  enterkeyhint: 'enterKeyHint',
}

/** Props React types as number; the DOM attribute is identical for "3" and 3. */
const NUMERIC_PROPS = new Set([
  'rows',
  'cols',
  'size',
  'span',
  'tabIndex',
  'maxLength',
  'minLength',
  'colSpan',
  'rowSpan',
])

const VOID_TAGS = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '))
const FORM_TAGS = new Set(['input', 'textarea', 'select'])
const IDENT_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const JSX_ATTR_NAME = /^[A-Za-z_$][A-Za-z0-9_$-]*$/
const UNSAFE_IN_JSX_STRING = /["&\\{}<>\n\r]/
const isSafeJsxString = (s: string): boolean =>
  !UNSAFE_IN_JSX_STRING.test(s) &&
  !s.includes(String.fromCharCode(0x2028)) &&
  !s.includes(String.fromCharCode(0x2029))

interface Loop {
  as: string
  item: string
  idx: string
  /** binding path of one element of the list, e.g. "bays[]" */
  itemPath: string | null
}

const indentOf = (n: number): string => '  '.repeat(n)

export class Emitter {
  private readonly styleNames = new Map<string, string>()
  private readonly styleDecls: string[] = []
  private readonly roots = new Set<string>()
  private readonly lists = new Set<string>()
  private readonly paths = new Set<string>()
  private readonly conds = new Set<string>()
  private readonly handlers = new Set<string>()
  private used = { Fragment: false, css: false, I: false, asArray: false, m: false, NOOP: false, R: false }

  constructor(private readonly opts: EmitOptions) {}

  private fail(msg: string): never {
    throw new CompileError(`${this.opts.screen}: ${msg}`)
  }

  // ---- expressions -------------------------------------------------------------------------------------------------
  private lookup(scope: Loop[], root: string): Loop | undefined {
    for (let i = scope.length - 1; i >= 0; i--) if (scope[i]!.as === root) return scope[i]
    return undefined
  }

  /** Resolves a strict-grammar path to code and records the binding. Returns null when it is not a plain path. */
  private pathCode(src: string, scope: Loop[], record = true): string | null {
    const p: PathExpr | null = parsePath(src)
    if (!p) return null
    const loop = this.lookup(scope, p.root)
    let base: string
    let bpath: string | null
    if (loop) {
      base = loop.item
      bpath = loop.itemPath
    } else if (p.root === '$index' && scope.length) {
      return scope[scope.length - 1]!.idx + (p.segs.length ? this.segCode(p.segs) : '')
    } else {
      base = `$v.${p.root}`
      bpath = p.root
      if (record) this.roots.add(p.root)
    }
    if (record && bpath !== null) {
      this.paths.add(bpath + p.segs.map((s) => (/^\d+$/.test(s) ? `[${s}]` : `.${s}`)).join(''))
    }
    return base + this.segCode(p.segs)
  }

  private segCode(segs: string[]): string {
    return segs.map((s) => (/^\d+$/.test(s) ? `?.[${s}]` : `?.${s}`)).join('')
  }

  private bindingPath(src: string, scope: Loop[]): string | null {
    const p = parsePath(src)
    if (!p) return null
    const loop = this.lookup(scope, p.root)
    const head = loop ? loop.itemPath : p.root
    if (head === null || (p.root === '$index' && !loop)) return null
    return head + p.segs.map((s) => (/^\d+$/.test(s) ? `[${s}]` : `.${s}`)).join('')
  }

  /** Expression code for a binding source. */
  private expr(src: string, scope: Loop[], where: string): string {
    const code = this.pathCode(src, scope)
    if (code !== null) return code
    if (!this.opts.allowComplexExpr) {
      this.fail(
        `${where}: expression ${JSON.stringify(src.trim())} is outside the strict grammar IDENT(.IDENT|.DIGITS)* (use --allow-complex-expr to emit a resolve() call)`,
      )
    }
    this.used.R = true
    const entries = scope.map((l) => `${JSON.stringify(l.as)}: ${l.item}, $index: ${l.idx}`)
    const sc = scope.length ? `{ ...$v, ${entries.join(', ')} }` : '$v'
    return `R(${sc}, ${JSON.stringify(src.trim())})`
  }

  // ---- styles ------------------------------------------------------------------------------------------------------
  private styleConst(css: string): string {
    const obj = cssToObj(css)
    const keys = Object.keys(obj)
    // integer-like keys would be reordered by JS; CSS property names never are
    const canon = JSON.stringify(keys.map((k) => [k, obj[k]]))
    let name = this.styleNames.get(canon)
    if (!name) {
      name = `S${this.styleNames.size}`
      this.styleNames.set(canon, name)
      const body = keys
        .map((k) => `${IDENT_KEY.test(k) ? k : JSON.stringify(k)}: ${JSON.stringify(obj[k])}`)
        .join(', ')
      this.styleDecls.push(`const ${name} = Object.freeze({ ${body} }) as CSSProperties`)
    }
    return name
  }

  private tpl(raw: string, scope: Loop[], where: string): string {
    const parts = splitInterp(raw)
    let out = '`'
    parts.forEach((p, i) => {
      if (i & 1) {
        this.used.m = true
        out += '${m(' + this.expr(p, scope, where) + ')}'
      } else {
        out += p.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
      }
    })
    return out + '`'
  }

  // ---- attributes --------------------------------------------------------------------------------------------------
  private attrs(el: ElNode, scope: Loop[]): string[] {
    const out: string[] = []
    if (this.opts.tplIds && el.tpl >= 0) out.push(`data-dc-tpl="${el.tpl}"`)
    let boundForm = false
    let hasOnChange = false
    for (const { name, value } of el.attrs) {
      if (name === 'sc-name' || name === 'data-dc-tpl') continue
      let key = name
      if (key.startsWith(CAMEL_ATTR)) key = kebabToCamel(key.slice(CAMEL_ATTR.length))
      if (key === 'hint-size' || key.startsWith('hint-')) continue
      const where = `<${el.tag}> tpl ${el.tpl} attribute ${name}`
      if (key.startsWith('style-')) this.fail(`${where}: style-<pseudo> attributes are not supported`)
      let isEvent = false
      if (key === 'class') key = 'className'
      else if (key === 'for') key = 'htmlFor'
      else if (key.startsWith('on')) {
        if (key.length < 3) this.fail(`${where}: invalid event attribute`)
        key = EVENT_MAP[key] || 'on' + key[2]!.toUpperCase() + key.slice(3)
        isEvent = true
      } else if (ATTR_RENAME[key]) key = ATTR_RENAME[key]!
      else if (key.includes('-') && !key.startsWith('data-') && !key.startsWith('aria-')) {
        this.fail(`${where}: unknown hyphenated attribute (add it to ATTR_RENAME if React renames it)`)
      }
      if (!JSX_ATTR_NAME.test(key)) this.fail(`${where}: cannot emit attribute name ${JSON.stringify(key)}`)
      if (key === 'onChange') hasOnChange = true

      const whole = wholeBinding(value, where)
      let code: string
      if (key === 'style') {
        if (whole !== null) {
          this.used.css = true
          code = `{css(${this.expr(whole, scope, where)})}`
        } else if (value.includes('{{')) {
          this.used.css = true
          code = `{css(${this.tpl(value, scope, where)})}`
        } else {
          code = `{${this.styleConst(value)}}`
        }
      } else if (whole !== null) {
        const e = this.expr(whole, scope, where)
        if (isEvent || key === 'ref') {
          const bp = this.bindingPath(whole, scope)
          if (bp !== null) this.handlers.add(bp)
        }
        if (key === 'value' || key === 'checked') {
          if (FORM_TAGS.has(el.tag)) boundForm = true
          code = `{${e} === undefined ? ${key === 'checked' ? 'false' : '""'} : ${e}}`
        } else code = `{${e}}`
      } else if (value.includes('{{')) {
        if (isEvent || key === 'ref') this.fail(`${where}: handlers and refs must be a whole {{ }} binding`)
        code = `{${this.tpl(value, scope, where)}}`
      } else {
        if (isEvent || key === 'ref') this.fail(`${where}: handlers and refs must be a whole {{ }} binding`)
        if (NUMERIC_PROPS.has(key) && /^\d+$/.test(value)) code = `{${value}}`
        else if (isSafeJsxString(value)) code = JSON.stringify(value)
        else code = `{${JSON.stringify(value)}}`
      }
      out.push(`${key}=${code}`)
    }
    if (boundForm && !hasOnChange) {
      this.used.NOOP = true
      out.push('onChange={NOOP}')
    }
    return out
  }

  // ---- nodes -------------------------------------------------------------------------------------------------------
  private text(node: TextNode, scope: Loop[], ind: number): string[] {
    const v = node.value
    const pad = indentOf(ind)
    if (!v.includes('{{')) {
      if (!v.trim() && !v.includes(' ')) return []
      return [`${pad}{${JSON.stringify(v)}}`]
    }
    const parts = splitInterp(v)
    const lines: string[] = [`${pad}<>`]
    parts.forEach((p, i) => {
      if (i & 1) {
        if (node.allowRaw && p.startsWith('=')) {
          const e = this.pathCode(p.slice(1), scope)
          if (e === null) this.fail(`raw interpolation {{${p}}} must be a plain path`)
          lines.push(`${pad}  {${e}}`)
          return
        }
        const e = this.expr(p, scope, 'text')
        this.used.I = true
        lines.push(`${pad}  {I(${e}, ${JSON.stringify(p.trim())}, $h)}`)
      } else if (p !== '') {
        lines.push(`${pad}  {${JSON.stringify(p)}}`)
      }
    })
    lines.push(`${pad}</>`)
    return lines
  }

  private children(nodes: Node[], scope: Loop[], ind: number): string[] {
    const out: string[] = []
    for (const n of nodes) out.push(...this.node(n, scope, ind))
    return out
  }

  private node(n: Node, scope: Loop[], ind: number): string[] {
    if (n.kind === 'text') return this.text(n, scope, ind)
    const pad = indentOf(ind)
    switch (n.tag) {
      case 'sc-helmet':
        return []
      case 'sc-if': {
        const raw = n.attrs.find((a) => a.name === 'value')?.value ?? ''
        const whole = wholeBinding(raw, `sc-if tpl ${n.tpl}`)
        let cond: string
        if (whole !== null) {
          cond = this.expr(whole, scope, `sc-if tpl ${n.tpl}`)
          const bp = this.bindingPath(whole, scope)
          if (bp !== null) this.conds.add(bp)
        } else if (raw.includes('{{')) this.fail(`sc-if tpl ${n.tpl}: value must be a single {{ }} binding`)
        else cond = raw ? 'true' : 'false'
        const kids = this.children(n.children, scope, ind + 1)
        if (!kids.length) return [`${pad}{${cond} ? <></> : null}`]
        return [
          `${pad}{${cond} ? (`,
          `${pad}  <>`,
          ...kids.map((l) => '  ' + l),
          `${pad}  </>`,
          `${pad}) : null}`,
        ]
      }
      case 'sc-for': {
        const raw = n.attrs.find((a) => a.name === 'list')?.value ?? ''
        const as = n.attrs.find((a) => a.name === 'as')?.value || 'item'
        if (!IDENT_KEY.test(as)) this.fail(`sc-for tpl ${n.tpl}: invalid as="${as}"`)
        const whole = wholeBinding(raw, `sc-for tpl ${n.tpl}`)
        if (whole === null) this.fail(`sc-for tpl ${n.tpl}: list must be a single {{ }} binding`)
        const listCode = this.expr(whole, scope, `sc-for tpl ${n.tpl}`)
        const lp = this.bindingPath(whole, scope)
        if (lp !== null) this.lists.add(lp)
        const depth = scope.length + 1
        const loop: Loop = {
          as,
          item: `$L${depth}_${as}`,
          idx: `$I${depth}`,
          itemPath: lp === null ? null : lp + '[]',
        }
        this.used.asArray = true
        this.used.Fragment = true
        const kids = this.children(n.children, [...scope, loop], ind + 2)
        return [
          `${pad}{asArray(${listCode}, ${JSON.stringify(whole.trim())}, $h).map((${loop.item}, ${loop.idx}) => (`,
          `${pad}  <Fragment key={${loop.idx}}>`,
          ...kids,
          `${pad}  </Fragment>`,
          `${pad}))}`,
        ]
      }
      case 'x-import':
      case 'dc-import':
      case 'sc-else':
        return this.fail(`<${n.tag}> is not supported`)
    }
    const attrs = this.attrs(n, scope)
    const open = `<${n.tag}${attrs.length ? ' ' + attrs.join(' ') : ''}`
    const kids = this.children(n.children, scope, ind + 1)
    if (VOID_TAGS.has(n.tag)) {
      if (n.children.length) this.fail(`void element <${n.tag}> has children`)
      return [`${pad}${open} />`]
    }
    if (!kids.length) return [`${pad}${open} />`]
    return [`${pad}${open}>`, ...kids, `${pad}</${n.tag}>`]
  }

  // ---- file --------------------------------------------------------------------------------------------------------
  emit(
    nodes: Node[],
    header: string[],
    meta: { screen: string; name: string; variant: string; tplCount: number },
  ): { tsx: string; bindings: Bindings } {
    const body = this.children(nodes, [], 3)
    const rt = ['asArray', 'css', 'I', 'm', 'NOOP', 'R'].filter((k) => this.used[k as keyof typeof this.used])
    const lines: string[] = [...header, '/* eslint-disable */']
    const reactTypes = this.styleDecls.length ? 'CSSProperties, ReactElement' : 'ReactElement'
    lines.push(this.used.Fragment ? "import { Fragment } from 'react'" : '')
    lines.push(`import type { ${reactTypes} } from 'react'`)
    if (rt.length) lines.push(`import { ${rt.join(', ')} } from '@/dc/runtime'`)
    lines.push("import type { DCRenderCtx } from '@/dc/types'", '')
    if (this.styleDecls.length) lines.push(...this.styleDecls, '')
    lines.push(`export const meta = ${JSON.stringify(meta)} as const`, '')
    lines.push(
      'export default function render($v: Record<string, any>, $h: DCRenderCtx): ReactElement {',
      '  return (',
      '    <>',
      ...body,
      '    </>',
      '  )',
      '}',
      '',
    )
    return {
      tsx: lines.join('\n').replace(/\n{3,}/g, '\n\n'),
      bindings: {
        screen: this.opts.screen,
        roots: [...this.roots].sort(),
        lists: [...this.lists].sort(),
        conds: [...this.conds].sort(),
        handlers: [...this.handlers].sort(),
        paths: [...this.paths].sort(),
      },
    }
  }
}
