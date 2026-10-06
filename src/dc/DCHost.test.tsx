// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DCHost } from './DCHost'
import { DCLogic } from './DCLogic'
import { ScreenStyle } from './ScreenStyle'
import type { DCRender } from './types'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const meta = { name: 'Oasis Test', screen: 'settings' } as const
const render: DCRender = (v) => createElement('p', { id: 'out', onClick: v.click }, String(v.msg))

let container: HTMLElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

const mount = (el: any) => act(() => root.render(el))

class Msg extends DCLogic<{ msg: string; n: number }> {
  static last: Msg
  constructor(p?: any) {
    super(p)
    Msg.last = this
  }
  state = { msg: 'hello', n: 0 }
  events: string[] = []
  seen: string[] = []
  componentDidMount() {
    this.events.push('mount')
  }
  componentDidUpdate(prev: any) {
    this.events.push('update:' + JSON.stringify(prev))
  }
  componentWillUnmount() {
    this.events.push('unmount')
  }
  renderVals() {
    this.seen.push(this.state.msg)
    return {
      msg: this.state.msg,
      click: () => {
        this.setState({ msg: 'clicked' })
        this.seen.push('after-setState:' + this.state.msg)
        this.setState((p) => ({ n: p.n + 1 }))
        this.seen.push('n:' + this.state.n)
      },
    }
  }
}

describe('DCHost', () => {
  it('renders #dc-root > div.sc-host[data-sc-name] around the template, nothing else', () => {
    mount(<DCHost meta={meta} Logic={Msg as any} render={render} />)
    const dc = container.firstElementChild!
    expect(dc.id).toBe('dc-root')
    expect(dc.attributes).toHaveLength(1)
    expect(dc.children).toHaveLength(1)
    const host = dc.firstElementChild!
    expect(host.className).toBe('sc-host')
    expect([...host.attributes].map((a) => a.name)).toEqual(['class', 'data-sc-name'])
    expect(host.getAttribute('data-sc-name')).toBe('Oasis Test')
    expect(host.innerHTML).toBe('<p id="out">hello</p>')
  })

  it('setState is synchronous for handlers and re-renders afterwards', () => {
    mount(<DCHost meta={meta} Logic={Msg as any} render={render} />)
    const logic = Msg.last
    act(() => (container.querySelector('#out') as HTMLElement).click())
    expect(logic.seen).toContain('after-setState:clicked')
    expect(logic.seen).toContain('n:1')
    expect(container.querySelector('#out')!.textContent).toBe('clicked')
    expect(logic.state).toEqual({ msg: 'clicked', n: 1 })
  })

  it('forwards didMount, didUpdate (with the previous user props) and willUnmount', () => {
    mount(<DCHost meta={meta} Logic={Msg as any} render={render} userProps={{ a: 1 }} />)
    const logic = Msg.last
    expect(logic.events).toEqual(['mount'])
    mount(<DCHost meta={meta} Logic={Msg as any} render={render} userProps={{ a: 2 }} />)
    expect(logic.events).toEqual(['mount', 'update:{"a":1}'])
    expect(logic.props).toEqual({ a: 2 })
    act(() => root.unmount())
    expect(logic.events).toEqual(['mount', 'update:{"a":1}', 'unmount'])
    root = createRoot(container)
  })

  it('merges user props under renderVals and wires __host before first render', () => {
    class P extends DCLogic {
      renderVals() {
        return { msg: 'from logic' }
      }
    }
    const r: DCRender = (v) => createElement('p', null, `${v.msg}|${v.extra}|${v.other}`)
    mount(
      <DCHost
        meta={meta}
        Logic={P as any}
        render={r}
        userProps={{ msg: 'from props', extra: 'e', other: 'o' }}
      />,
    )
    expect(container.textContent).toBe('from logic|e|o')
  })

  it('catches errors thrown by lifecycle hooks and keeps the screen up', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    class Bad extends Msg {
      componentDidMount() {
        throw new Error('mount boom')
      }
      componentDidUpdate() {
        throw new Error('update boom')
      }
      componentWillUnmount() {
        throw new Error('unmount boom')
      }
    }
    mount(<DCHost meta={meta} Logic={Bad as any} render={render} />)
    act(() => (container.querySelector('#out') as HTMLElement).click())
    expect(container.querySelector('#out')!.textContent).toBe('clicked')
    act(() => root.unmount())
    const messages = err.mock.calls.map((c) => String((c[0] as Error).message))
    expect(messages).toEqual(['mount boom', 'update boom', 'unmount boom'])
    root = createRoot(container)
  })

  it('shows a plain error card when the constructor, renderVals or the template throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    class CtorBad extends DCLogic {
      constructor() {
        super()
        throw new Error('ctor boom')
      }
    }
    mount(<DCHost meta={meta} Logic={CtorBad as any} render={render} />)
    expect(container.querySelector('[role=alert]')!.textContent).toContain('ctor boom')
    expect(container.querySelector('.sc-logic-error')).toBeNull()

    class ValsBad extends DCLogic {
      renderVals(): never {
        throw new Error('vals boom')
      }
    }
    mount(<DCHost key="b" meta={meta} Logic={ValsBad as any} render={render} />)
    expect(container.querySelector('[role=alert]')!.textContent).toContain(
      'Oasis Test.renderVals(): vals boom',
    )

    const boom: DCRender = () => {
      throw new Error('template boom')
    }
    mount(<DCHost key="c" meta={meta} Logic={Msg as any} render={boom} />)
    expect(container.querySelector('[role=alert]')!.textContent).toContain('template boom')
    expect(container.querySelector('#dc-root > .sc-host')).not.toBeNull()
  })
})

describe('ScreenStyle', () => {
  const styles = () => [...document.head.querySelectorAll('style[data-oasis-screen]')]

  it('injects the css verbatim once per screen and removes it after the last unmount', () => {
    const css = '\n  *{box-sizing:border-box;}\n  body{background:var(--bg);}\n'
    mount(
      <>
        <ScreenStyle id="operations" css={css} />
        <ScreenStyle id="operations" css={css} />
      </>,
    )
    expect(styles()).toHaveLength(1)
    expect(styles()[0]!.textContent).toBe(css)
    expect(styles()[0]!.getAttribute('data-oasis-screen')).toBe('operations')
    mount(<ScreenStyle id="operations" css={css} />)
    expect(styles()).toHaveLength(1)
    mount(<ScreenStyle id="payments" css="a{}" />)
    expect(styles().map((s) => s.getAttribute('data-oasis-screen'))).toEqual(['payments'])
    act(() => root.unmount())
    expect(styles()).toHaveLength(0)
    root = createRoot(container)
  })
})
