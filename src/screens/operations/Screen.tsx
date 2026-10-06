import render, { meta } from '@generated/operations'
import { screenCss } from '@generated/operations.styles'
import { DCHost } from '@/dc/DCHost'
import { ScreenStyle } from '@/dc/ScreenStyle'
import type { DCLogicCtor } from '@/dc/types'
import { OperationsLogic } from './Logic'

// The typed view model replaces the original class: nothing here evaluates the design's logic source at runtime.
export default function OperationsScreen() {
  return (
    <>
      <ScreenStyle id={meta.screen} css={screenCss} />
      <DCHost meta={meta} Logic={OperationsLogic as unknown as DCLogicCtor} render={render} />
    </>
  )
}
