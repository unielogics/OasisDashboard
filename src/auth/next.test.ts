import { describe, expect, it } from 'vitest'
import { nextAfterLogin } from './next'

describe('nextAfterLogin: the next path keeps the fragment the redirect carried', () => {
  it('puts the fragment of the login page back on the next path', () => {
    expect(nextAfterLogin('/settings', '#emergency')).toBe('/settings#emergency')
    expect(nextAfterLogin('/payments?range=7d', '#x')).toBe('/payments?range=7d#x')
  })

  it('a missing next lands on the default page, with the fragment', () => {
    expect(nextAfterLogin(undefined, '#emergency')).toBe('/operations#emergency')
    expect(nextAfterLogin(undefined, '')).toBe('/operations')
  })

  it('a next that names its own fragment wins over the page fragment', () => {
    expect(nextAfterLogin('/settings#emergency', '#hours')).toBe('/settings#emergency')
  })

  it('drops an empty or odd fragment and never lets one rescue an unsafe next', () => {
    expect(nextAfterLogin('/settings', '#')).toBe('/settings')
    expect(nextAfterLogin('/settings', '#a b')).toBe('/settings')
    expect(nextAfterLogin('/settings', '#"><script>')).toBe('/settings')
    expect(nextAfterLogin('/settings', null)).toBe('/settings')
    expect(nextAfterLogin('https://evil.test', '#emergency')).toBe('/operations#emergency')
    expect(nextAfterLogin('//evil.test', '#x')).toBe('/operations#x')
  })
})
