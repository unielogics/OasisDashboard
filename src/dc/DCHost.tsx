/* eslint-disable @typescript-eslint/no-explicit-any */
import { Component, createRef } from 'react'
import type { ReactNode } from 'react'
import { DCLogic } from './DCLogic'
import type { DCHostLike } from './DCLogic'
import { PARITY, markParityReady, registerParityHost } from './parity'
import type { DCLogicCtor, DCRender, DCRenderCtx, ScreenMeta } from './types'

export interface DCHostProps {
  meta: Pick<ScreenMeta, 'name' | 'screen'>
  Logic: DCLogicCtor
  render: DCRender
  /** What the dc runtime calls the "user props" (data-props defaults + overrides). Empty for all three designs. */
  userProps?: Record<string, unknown>
}

interface DCHostState {
  __v: number
  __err: string | null
}

const EMPTY: Record<string, unknown> = {}

const msgOf = (e: unknown): string => (e instanceof Error && e.message ? e.message : String(e))

/**
 * Class-component host for one compiled dc screen, a port of the runtime's StreamableComponent.
 * Renders <div id="dc-root"><div class="sc-host" data-sc-name=...>{template}</div></div> so the DOM under #dc-root
 * is the one the original bundle produces (the original uses #dc-root itself as the React root container).
 */
export class DCHost extends Component<DCHostProps, DCHostState> implements DCHostLike {
  logic: DCLogic
  private readonly ctx: DCRenderCtx
  private readonly rootRef = createRef<HTMLDivElement>()
  private ctorError: string | null = null

  static getDerivedStateFromError(e: unknown): Partial<DCHostState> {
    return { __err: msgOf(e) }
  }

  constructor(props: DCHostProps) {
    super(props)
    this.state = { __v: 0, __err: null }
    this.ctx = { name: props.meta.name }
    try {
      this.logic = new props.Logic(props.userProps ?? EMPTY)
    } catch (e) {
      console.error(e)
      this.ctorError = `${props.meta.name}: ${msgOf(e)}`
      this.logic = new DCLogic(props.userProps ?? EMPTY)
    }
    this.logic.__host = this
    if (PARITY) {
      registerParityHost(props.meta.screen, () => ({
        ...(this.props.userProps ?? EMPTY),
        ...(this.logic.renderVals() || {}),
      }))
    }
  }

  /** Synchronous like the original: state is replaced right now, only the re-render is a React bump. */
  __setLogicState(update: object | ((prev: any) => object), cb?: () => void): void {
    const prev = this.logic.state
    const patch = typeof update === 'function' ? update(prev) : update
    this.logic.state = { ...prev, ...patch }
    this.setState((s) => ({ __v: s.__v + 1 }), cb)
  }

  componentDidCatch(e: unknown, info: { componentStack?: string | null }): void {
    console.error(`[oasis] render error in <${this.props.meta.name}>:`, e, info?.componentStack || '')
  }

  componentDidMount(): void {
    try {
      this.logic.componentDidMount()
    } catch (e) {
      console.error(e)
    }
    if (PARITY) markParityReady(this.rootRef.current)
  }

  componentDidUpdate(prevProps: DCHostProps): void {
    this.logic.props = this.props.userProps ?? EMPTY
    try {
      this.logic.componentDidUpdate(prevProps.userProps ?? EMPTY)
    } catch (e) {
      console.error(e)
    }
  }

  componentWillUnmount(): void {
    try {
      this.logic.componentWillUnmount()
    } catch (e) {
      console.error(e)
    }
  }

  render(): ReactNode {
    const { meta, render } = this.props
    const userProps = this.props.userProps ?? EMPTY
    let body: ReactNode = null
    let failure = this.state.__err || this.ctorError
    if (!failure) {
      this.logic.props = userProps
      let vals: Record<string, any> | null = null
      try {
        vals = { ...userProps, ...(this.logic.renderVals() || {}) }
      } catch (e) {
        console.error(e)
        failure = `${meta.name}.renderVals(): ${msgOf(e)}`
      }
      if (vals) {
        // A throwing template would take the whole root down (an error boundary only catches descendants).
        try {
          body = render(vals, this.ctx)
        } catch (e) {
          console.error(e)
          failure = `${meta.name}: ${msgOf(e)}`
        }
      }
    }
    if (failure) body = <ErrorCard text={failure} />
    return (
      <div id="dc-root" ref={this.rootRef}>
        <div className="sc-host" data-sc-name={meta.name}>
          {body}
        </div>
      </div>
    )
  }
}

function ErrorCard({ text }: { text: string }) {
  return (
    <div
      role="alert"
      style={{
        margin: 24,
        padding: '16px 18px',
        maxWidth: 560,
        border: '1px solid #e2e0d7',
        borderRadius: 12,
        background: '#ffffff',
        color: '#18211e',
        font: '600 13px/1.5 system-ui, sans-serif',
      }}
    >
      This screen failed to load. Reload the page; if it keeps happening, tell an administrator.
      <div style={{ marginTop: 8, color: '#5c645f', fontWeight: 500 }}>{text}</div>
    </div>
  )
}
