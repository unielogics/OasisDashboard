import * as React from 'react'
import { DCLogic } from './DCLogic'
import type { DCLogicCtor } from './types'

/**
 * Evaluates an original logic script exactly like the dc runtime (evalDcLogic): DCLogic, StreamableLogic and
 * React are free variables of the script, the script declares `class Component extends DCLogic`.
 * Needs `unsafe-eval` in the CSP until the classes are ported to typed view-model modules.
 */
export function loadLogic(src: string, name = 'logic'): DCLogicCtor {
  const fn = new Function(
    'DCLogic',
    'StreamableLogic',
    'React',
    src + '\n;return (typeof Component!=="undefined"&&Component)||undefined;',
  )
  const Component = fn(DCLogic, DCLogic, React) as DCLogicCtor | undefined
  if (!Component) throw new Error(`${name}: script did not define a Component class`)
  return Component
}
