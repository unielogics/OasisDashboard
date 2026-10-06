import render, { meta } from '@generated/payments'
import { screenCss } from '@generated/payments.styles'
import { DCHost } from '@/dc/DCHost'
import { ScreenStyle } from '@/dc/ScreenStyle'
import { FixtureData } from './fixtures'
import { createPaymentsLogic } from './Logic'

const Logic = createPaymentsLogic(new FixtureData())

export default function PaymentsScreen() {
  return (
    <>
      <ScreenStyle id={meta.screen} css={screenCss} />
      <DCHost meta={meta} Logic={Logic} render={render} />
    </>
  )
}
