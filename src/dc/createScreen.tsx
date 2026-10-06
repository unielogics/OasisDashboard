import { DCHost } from './DCHost'
import { ScreenStyle } from './ScreenStyle'
import { loadLogic } from './loadLogic'
import type { DCRender, ScreenMeta } from './types'

export interface ScreenParts {
  meta: ScreenMeta
  render: DCRender
  logicSource: string
  screenCss: string
}

/** Wires one compiled screen: its CSS, the evaluated original logic class and the host. */
export function createScreen({ meta, render, logicSource, screenCss }: ScreenParts) {
  const Logic = loadLogic(logicSource, meta.name)
  return function Screen() {
    return (
      <>
        <ScreenStyle id={meta.screen} css={screenCss} />
        <DCHost meta={meta} Logic={Logic} render={render} />
      </>
    )
  }
}
