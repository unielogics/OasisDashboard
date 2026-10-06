import { afterEach, describe, expect, it } from 'vitest'
import { getDataPort, setDataPort } from './default-port'
import { getQueryClient } from './query'

afterEach(() => setDataPort(null))

describe('shared singletons', () => {
  it('the default data port is the fixture port outside the live variant, and is created once', () => {
    const a = getDataPort()
    expect(a.kind).toBe('fixture')
    expect(getDataPort()).toBe(a)
  })
  it('setDataPort swaps it (tests, and the live variant wiring)', () => {
    const fake = { kind: 'live' } as never
    setDataPort(fake)
    expect(getDataPort()).toBe(fake)
  })
  it('there is one QueryClient for React and for the logic classes', () => {
    expect(getQueryClient()).toBe(getQueryClient())
  })
})
