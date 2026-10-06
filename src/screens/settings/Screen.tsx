import render, { meta } from '@generated/settings'
import { logicSource } from '@generated/settings.logic'
import { screenCss } from '@generated/settings.styles'
import { createScreen } from '@/dc/createScreen'

export default createScreen({ meta, render, logicSource, screenCss })
