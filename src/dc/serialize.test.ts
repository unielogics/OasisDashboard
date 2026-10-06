import { createElement, Fragment, createRef } from 'react'
import { describe, expect, it } from 'vitest'
import { serializeVals } from './serialize'

describe('serializeVals', () => {
  it('turns functions into "[fn]" and keeps scalars', () => {
    expect(serializeVals({ a: () => 1, b: 'x', c: 2, d: true, e: null, f: [1, () => 2] })).toEqual({
      a: '[fn]',
      b: 'x',
      c: 2,
      d: true,
      e: null,
      f: [1, '[fn]'],
    })
  })

  it('keeps style-object key order', () => {
    const out = serializeVals({ s: { zIndex: 1, color: 'red', background: 'blue' } }) as { s: object }
    expect(JSON.stringify(out.s)).toBe('{"zIndex":1,"color":"red","background":"blue"}')
  })

  it('serialises React elements to a stable form', () => {
    const el = createElement(
      'span',
      { className: 'a', key: 'k', onClick: () => {} },
      'hi',
      createElement('b', null, 'x'),
    )
    expect(serializeVals({ el })).toEqual({
      el: {
        $el: 'span',
        key: 'k',
        props: { className: 'a', onClick: '[fn]' },
        children: ['hi', { $el: 'b', key: null, props: {}, children: ['x'] }],
      },
    })
    expect(serializeVals(createElement(Fragment, null, 'a'))).toEqual({
      $el: 'Fragment',
      key: null,
      props: {},
      children: ['a'],
    })
    expect(serializeVals(createElement('span', { dangerouslySetInnerHTML: { __html: '<svg/>' } }))).toEqual({
      $el: 'span',
      key: null,
      props: { dangerouslySetInnerHTML: { __html: '<svg/>' } },
      children: [],
    })
    function Cmp() {
      return null
    }
    expect((serializeVals(createElement(Cmp)) as { $el: string }).$el).toBe('[component Cmp]')
  })

  it('serialises refs, dates, maps, sets, symbols and cycles', () => {
    const cyc: Record<string, unknown> = { a: 1 }
    cyc.self = cyc
    expect(
      serializeVals({
        ref: createRef(),
        d: new Date('2026-06-13T14:36:00Z'),
        m: new Map([['k', 1]]),
        s: new Set([1]),
        sym: Symbol('x'),
        cyc,
        shared: [cyc.a, cyc.a],
      }),
    ).toEqual({
      ref: '[ref]',
      d: { $date: '2026-06-13T14:36:00.000Z' },
      m: { $map: [['k', 1]] },
      s: { $set: [1] },
      sym: 'Symbol(x)',
      cyc: { a: 1, self: '[circular]' },
      shared: [1, 1],
    })
  })

  it('is JSON.stringify-safe for a nested renderVals-like object', () => {
    const vals = {
      rows: [{ label: 'a', onClick: () => {}, style: { color: 'red' }, icon: createElement('i') }],
    }
    expect(() => JSON.stringify(serializeVals(vals))).not.toThrow()
  })
})
