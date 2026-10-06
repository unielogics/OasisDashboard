import render, { meta } from '@generated/payments'
import { logicSource } from '@generated/payments.logic'
import { screenCss } from '@generated/payments.styles'
import { createScreen } from '@/dc/createScreen'

export default createScreen({ meta, render, logicSource, screenCss })
