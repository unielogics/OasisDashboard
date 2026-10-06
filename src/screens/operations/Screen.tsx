import render, { meta } from '@generated/operations'
import { logicSource } from '@generated/operations.logic'
import { screenCss } from '@generated/operations.styles'
import { createScreen } from '@/dc/createScreen'

export default createScreen({ meta, render, logicSource, screenCss })
