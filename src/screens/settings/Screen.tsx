import render, { meta } from '@generated/settings'
import { screenCss } from '@generated/settings.styles'
import { DCHost } from '@/dc/DCHost'
import { ScreenStyle } from '@/dc/ScreenStyle'
import { FixtureData } from './fixtures'
import { createSettingsLogic } from './Logic'

// The typed view model replaces the original class: nothing here evaluates the design's logic source at runtime.
const Logic = createSettingsLogic(new FixtureData())

export default function SettingsScreen() {
  return (
    <>
      <ScreenStyle id={meta.screen} css={screenCss} />
      <DCHost meta={meta} Logic={Logic} render={render} />
    </>
  )
}
