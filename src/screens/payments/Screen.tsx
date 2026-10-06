import render, { meta } from '@generated/payments'
import { screenCss } from '@generated/payments.styles'
import { DCHost } from '@/dc/DCHost'
import { ScreenStyle } from '@/dc/ScreenStyle'
import { LIVE } from '@/data/env'
import { FixtureData } from './fixtures'
import { createPaymentsLogic } from './Logic'
import { createLivePaymentsLogic } from './LiveLogic'

// The live variant renders the ledger API through its own view model; every other build runs the fixture class.
const Logic = LIVE ? createLivePaymentsLogic() : createPaymentsLogic(new FixtureData())

export default function PaymentsScreen() {
  return (
    <>
      <ScreenStyle id={meta.screen} css={screenCss} />
      <DCHost meta={meta} Logic={Logic} render={render} />
    </>
  )
}
