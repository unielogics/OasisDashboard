// The middleware's redirect must not depend on the address the server sees: behind nginx, req.url is the internal
// https://localhost:3200/..., and an absolute redirect built from it sent the first real visitors to localhost.
import { describe, expect, it, vi } from 'vitest'

vi.stubEnv('NEXT_PUBLIC_VARIANT', 'live')
const { middleware, redirectTo } = await import('./middleware')
const { NextRequest } = await import('next/server')

describe('middleware redirects', () => {
  it('sends a signed-out visitor to /login with a relative Location, whatever host the request says it came to', () => {
    const res = middleware(new NextRequest('https://localhost:3200/settings?tab=x'))
    expect(res.status).toBe(307)
    const location = res.headers.get('location')!
    expect(location.startsWith('/login')).toBe(true)
    expect(location).not.toMatch(/localhost|:\/\//)
    expect(decodeURIComponent(location)).toContain('/settings')
  })
  it('redirectTo keeps the path and query exactly', () => {
    expect(redirectTo('/login?next=%2Foperations').headers.get('location')).toBe('/login?next=%2Foperations')
  })
})
