import { serializeVals } from './serialize'

export interface OasisParity {
  /** Serialised result of the live logic's renderVals() merged over the host props (see serialize.ts). */
  getVals(): unknown
  /** Resolves once the screen is mounted (same moment `#dc-root` gets data-oasis-ready="1"). */
  ready: Promise<void>
  screen: string | null
}

declare global {
  interface Window {
    __oasisParity?: OasisParity
  }
}

/** True in builds made with NEXT_PUBLIC_PARITY=1 (the literal is inlined by Next, so production code drops the branch). */
export const PARITY = process.env.NEXT_PUBLIC_PARITY === '1'

let resolveReady: () => void = () => {}
let currentVals: (() => Record<string, unknown>) | null = null
let currentScreen: string | null = null

if (PARITY && typeof window !== 'undefined' && !window.__oasisParity) {
  const ready = new Promise<void>((r) => {
    resolveReady = r
  })
  window.__oasisParity = {
    ready,
    get screen() {
      return currentScreen
    },
    getVals() {
      if (!currentVals) throw new Error('__oasisParity.getVals(): no screen mounted yet')
      return serializeVals(currentVals())
    },
  }
}

export function registerParityHost(screen: string, vals: () => Record<string, unknown>): void {
  if (!PARITY) return
  currentScreen = screen
  currentVals = vals
}

export function markParityReady(root: HTMLElement | null): void {
  if (!PARITY) return
  root?.setAttribute('data-oasis-ready', '1')
  resolveReady()
}
