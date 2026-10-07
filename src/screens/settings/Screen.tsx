import render, { meta } from '@generated/settings'
import { screenCss } from '@generated/settings.styles'
import { liveChrome } from '@/auth/chrome'
import { LIVE } from '@/data/env'
import { getDataPort } from '@/data/default-port'
import { getQueryClient } from '@/data/query'
import { DCHost } from '@/dc/DCHost'
import { ScreenStyle } from '@/dc/ScreenStyle'
import { FixtureData } from './fixtures'
import { LiveData } from './live/LiveData'
import { createSettingsLogic } from './Logic'
import type { SettingsData } from './data'

// The typed view model replaces the original class: nothing here evaluates the design's logic source at runtime.
// The default and parity builds run on the design's own data; only the live variant talks to the API.
const data: SettingsData = LIVE
  ? new LiveData({
      api: getDataPort().settings,
      qc: getQueryClient(),
      session: () => liveChrome.getSession(),
    })
  : new FixtureData()
const Logic = createSettingsLogic(data)

export default function SettingsScreen() {
  return (
    <>
      <ScreenStyle id={meta.screen} css={screenCss} />
      <DCHost meta={meta} Logic={Logic} render={render} />
    </>
  )
}
