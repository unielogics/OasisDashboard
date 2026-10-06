/* eslint-disable @typescript-eslint/no-explicit-any */
// Stable, JSON-safe form of a renderVals() result for the parity harness (window.__oasisParity.getVals()).
// Self-contained on purpose (no imports): the harness may stringify this function and run it inside the page that
// hosts the ORIGINAL bundle so that both sides serialise with identical code.
//
//   function                       -> "[fn]"
//   React element                  -> { $el: <tag | "Fragment" | "[component Name]">, key, props, children[] [, ref: "[ref]"] }
//   createRef()-style { current }  -> "[ref]"
//   DOM node                       -> "[node]"
//   repeated object on the path    -> "[circular]"
//   Date -> { $date: iso }, Map -> { $map: [[k, v]...] }, Set -> { $set: [v...] }, RegExp/symbol/bigint -> string
// Plain objects keep their own-key insertion order (style objects: key order matters), undefined values are kept
// as undefined (JSON.stringify then drops them, in arrays they become null).

export function serializeVals(root: unknown): unknown {
  const REACT_ELEMENT = Symbol.for('react.element')
  const REACT_FRAGMENT = Symbol.for('react.fragment')
  const path: object[] = []
  const walk = (v: any): any => {
    if (v === null || v === undefined) return v
    const t = typeof v
    if (t === 'function') return '[fn]'
    if (t === 'symbol') return String(v)
    if (t === 'bigint') return String(v) + 'n'
    if (t !== 'object') return v
    if (typeof Node !== 'undefined' && v instanceof Node) return '[node]'
    if (path.includes(v)) return '[circular]'
    path.push(v)
    try {
      if (v.$$typeof === REACT_ELEMENT) {
        const { children, ...props } = v.props ?? {}
        const type =
          typeof v.type === 'string'
            ? v.type
            : v.type === REACT_FRAGMENT
              ? 'Fragment'
              : `[component ${v.type?.displayName || v.type?.name || '?'}]`
        const kids = children === undefined ? [] : Array.isArray(children) ? children : [children]
        const out: Record<string, any> = {
          $el: type,
          key: v.key ?? null,
          props: walk(props),
          children: kids.map(walk),
        }
        if (v.ref) out.ref = '[ref]'
        return out
      }
      if (Array.isArray(v)) return v.map(walk)
      if (v instanceof Date) return { $date: Number.isNaN(v.getTime()) ? null : v.toISOString() }
      if (v instanceof RegExp) return String(v)
      if (v instanceof Map) return { $map: [...v.entries()].map(([k, x]) => [walk(k), walk(x)]) }
      if (v instanceof Set) return { $set: [...v.values()].map(walk) }
      const keys = Object.keys(v)
      if (keys.length === 1 && keys[0] === 'current') return '[ref]'
      const out: Record<string, any> = {}
      for (const k of keys) out[k] = walk(v[k])
      return out
    } finally {
      path.pop()
    }
  }
  return walk(root)
}
