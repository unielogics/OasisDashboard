/* eslint-disable @typescript-eslint/no-explicit-any */
// A direct transliteration of the original runtime's walk* builders (walkText, walkFor, walkIf, walkElement,
// collectProps, compileAttr) over our parsed tree, using the original resolve()/cssToObj(). The compiled screens
// are checked against it: same vals in, same markup out.
import { createElement as h, Fragment, isValidElement } from 'react'
import type { ReactNode } from 'react'
import { CAMEL_ATTR } from '../parse'
import type { ElNode, Node } from '../parse'
import { original } from './original-runtime'

const { resolve, EVENT_MAP, kebabToCamel, cssToObj } = original

function compileAttr(raw: string): (vals: any) => any {
  const whole = raw.match(/^\s*\{\{([\s\S]+?)\}\}\s*$/)
  if (whole) {
    const p = whole[1]!
    return (vals) => resolve(vals, p)
  }
  if (raw.includes('{{')) {
    const parts = raw.split(/\{\{([\s\S]+?)\}\}/g)
    return (vals) => parts.map((s, i) => (i & 1 ? (resolve(vals, s) ?? '') : s)).join('')
  }
  return () => raw
}

type Builder = (vals: any, key: number | string) => ReactNode

function walkChildren(nodes: Node[], tplIds: boolean): Builder[] {
  return nodes.map((n) => walk(n, tplIds)).filter((b): b is Builder => b != null)
}

function walk(n: Node, tplIds: boolean): Builder | null {
  if (n.kind === 'text') return walkText(n.value)
  switch (n.tag) {
    case 'sc-for':
      return walkFor(n, tplIds)
    case 'sc-if':
      return walkIf(n, tplIds)
    case 'sc-helmet':
      return () => null
    default:
      return walkElement(n, tplIds)
  }
}

function walkText(txt: string): Builder | null {
  if (!txt.includes('{{')) {
    if (!txt.trim() && !txt.includes(' ')) return null
    return () => txt
  }
  const parts = txt.split(/\{\{([\s\S]+?)\}\}/g)
  return (vals, key) =>
    h(
      Fragment,
      { key },
      ...parts.map((p, i) => {
        if (!(i & 1)) return p
        const v = resolve(vals, p)
        if (v === undefined) return null
        if (isValidElement(v) || Array.isArray(v)) return h(Fragment, { key: i }, v as ReactNode)
        if (v === null || typeof v === 'boolean') return null
        return h('span', { key: i, className: 'sc-interp' }, String(v))
      }),
    )
}

function walkFor(el: ElNode, tplIds: boolean): Builder {
  const listGet = compileAttr(el.attrs.find((a) => a.name === 'list')?.value || '')
  const asName = el.attrs.find((a) => a.name === 'as')?.value || 'item'
  const kids = walkChildren(el.children, tplIds)
  return (vals, key) => {
    let list = listGet(vals)
    if (!Array.isArray(list)) list = []
    return h(
      Fragment,
      { key },
      list.map((item: unknown, i: number) => {
        const sub = { ...vals, [asName]: item, $index: i }
        return h(
          Fragment,
          { key: i },
          kids.map((b, j) => b(sub, j)),
        )
      }),
    )
  }
}

function walkIf(el: ElNode, tplIds: boolean): Builder {
  const valGet = compileAttr(el.attrs.find((a) => a.name === 'value')?.value || '')
  const kids = walkChildren(el.children, tplIds)
  return (vals, key) =>
    valGet(vals)
      ? h(
          Fragment,
          { key },
          kids.map((b, j) => b(vals, j)),
        )
      : null
}

function walkElement(el: ElNode, tplIds: boolean): Builder {
  const getters: [string, (vals: any) => any][] = []
  for (const { name, value } of el.attrs) {
    if (name === 'sc-name' || name === 'data-dc-tpl') continue
    let key = name
    if (key.startsWith(CAMEL_ATTR)) key = kebabToCamel(key.slice(CAMEL_ATTR.length))
    if (key === 'hint-size') continue
    if (key === 'class') key = 'className'
    else if (key === 'for') key = 'htmlFor'
    else if (key.startsWith('on')) key = EVENT_MAP[key] || 'on' + key[2]!.toUpperCase() + key.slice(3)
    getters.push([key, compileAttr(value)])
  }
  const kids = walkChildren(el.children, tplIds)
  return (vals, key) => {
    const props: Record<string, any> = { key }
    if (tplIds) props['data-dc-tpl'] = String(el.tpl)
    for (const [k, g] of getters) {
      let v = g(vals)
      if (k === 'style' && typeof v === 'string') v = cssToObj(v)
      if ((k === 'value' || k === 'checked') && v === undefined) v = k === 'checked' ? false : ''
      props[k] = v
    }
    return h(el.tag, props, ...kids.map((b, j) => b(vals, j)))
  }
}

/** What the original runtime would render for a parsed template. */
export function interpret(nodes: Node[], vals: Record<string, unknown>, tplIds = false): ReactNode {
  const builders = walkChildren(nodes, tplIds)
  return h(Fragment, null, ...builders.map((b, i) => b(vals, i)))
}
