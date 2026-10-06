/* eslint-disable @typescript-eslint/no-explicit-any */
// Test helpers: load the ORIGINAL Operations class (the oracle) next to the typed view model and drive both the same way.
import fs from 'node:fs'
import path from 'node:path'
import { loadLogic } from '@/dc/loadLogic'
import { serializeVals } from '@/dc/serialize'
import { OperationsLogic } from './Logic'
import { FixtureData } from './fixtures'
import type { OperationsData } from './data'

const root = path.resolve(__dirname, '..', '..', '..')

let source: string | undefined
export const originalSource = (): string =>
  (source ??= fs.readFileSync(path.join(root, 'design/extracted/operations/logic.original.js'), 'utf8'))

export type Ctor = new (props?: any) => any

export const OriginalClass = (): Ctor => loadLogic(originalSource(), 'operations-original') as unknown as Ctor
export const PortClass = (data?: OperationsData): Ctor =>
  class extends OperationsLogic {
    constructor(props?: any) {
      super(props, data ?? new FixtureData())
    }
  } as unknown as Ctor

/** The two implementations under comparison, by label. */
export const implementations = (): Array<[string, Ctor]> => [
  ['original', OriginalClass()],
  ['port', PortClass()],
]

/** A host like DCHost's: setState is synchronous, the re-render callback fires straight away. */
export function attach(logic: any): { forceUpdate: () => void; updates: number } {
  const host = {
    updates: 0,
    __setLogicState(u: any, cb?: () => void) {
      logic.state = { ...logic.state, ...(typeof u === 'function' ? u(logic.state) : u) }
      host.updates++
      if (cb) cb()
    },
    forceUpdate() {
      host.updates++
    },
  }
  logic.__host = host
  return host
}

/** Construct, attach and mount. Call `dispose()` to unmount (removes window listeners and timers). */
export function mount(Ctor: Ctor): { logic: any; dispose: () => void } {
  const logic = new Ctor({})
  attach(logic)
  logic.componentDidMount()
  return { logic, dispose: () => logic.componentWillUnmount() }
}

/** Everything observable: the serialised renderVals() and the JSON of the state. */
export function snap(logic: any): { vals: unknown; state: unknown } {
  return {
    vals: serializeVals(logic.renderVals()),
    state: JSON.parse(JSON.stringify(logic.state)),
  }
}

/** Resolve `a.b.0.c` against the live renderVals() and call it. */
export function call(logic: any, p: string, ...args: any[]): any {
  const vals = logic.renderVals()
  let cur = vals
  for (const k of p.split('.')) cur = cur[k]
  if (typeof cur !== 'function') throw new Error(`${p} is not a function`)
  return cur(...args)
}

export function read(logic: any, p: string): any {
  let cur = logic.renderVals()
  for (const k of p.split('.')) cur = cur?.[k]
  return cur
}

export function pointer(type: string, x: number, y: number): Event {
  return Object.assign(new Event(type, { bubbles: true, cancelable: true }), { clientX: x, clientY: y })
}

export function pointerDownEvent(el: HTMLElement, x: number, y: number, pointerType: 'touch' | 'mouse', button = 0) {
  return { button, clientX: x, clientY: y, pointerType, currentTarget: el }
}
