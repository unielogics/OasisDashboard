import render, { meta } from '@generated/operations'
import { screenCss } from '@generated/operations.styles'
import { DCHost } from '@/dc/DCHost'
import { ScreenStyle } from '@/dc/ScreenStyle'
import type { DCLogicCtor } from '@/dc/types'
import { LIVE } from '@/data/env'
import { OperationsLogic } from './Logic'
import { createLiveOperationsLogic } from './LiveLogic'

// The live variant renders the real API through its own view model (LiveLogic.ts); every other build runs the typed
// fixture class, so the parity bundle is byte for byte what it was. Nothing here evaluates the design's logic source.
const Logic: DCLogicCtor = LIVE ? createLiveOperationsLogic() : (OperationsLogic as unknown as DCLogicCtor)

export default function OperationsScreen() {
  return (
    <>
      <ScreenStyle id={meta.screen} css={screenCss} />
      <DCHost meta={meta} Logic={Logic} render={render} />
    </>
  )
}
