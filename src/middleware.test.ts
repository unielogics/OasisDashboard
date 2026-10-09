// Next requires absolute redirect URLs from middleware, and behind nginx req.url is the internal https://localhost:3200/...:
// the redirect must use the host the visitor used (X-Forwarded-Host from nginx, else Host), never the server's own address.
import { describe, expect, it, vi } from 'vitest'

vi.stubEnv('NEXT_PUBLIC_VARIANT', 'live')
const { middleware } = await import('./middleware')
const { NextRequest } = await import('next/server')

const behindNginx = (path: string) =>
  new NextRequest(`https://localhost:3200${path}`, {
    headers: {
      host: 'app.oasisautospanj.com',
      'x-forwarded-host': 'app.oasisautospanj.com',
      'x-forwarded-proto': 'https',
    },
  })

describe('middleware redirects', () => {
  it('behind nginx: an absolute URL on the public host, never localhost', () => {
    const res = middleware(behindNginx('/settings?tab=x'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'https://app.oasisautospanj.com/login?next=%2Fsettings%3Ftab%3Dx',
    )
  })
  it('without a proxy: the Host the browser used (a live stack on a tailnet address)', () => {
    const res = middleware(
      new NextRequest('http://localhost:3223/payments', { headers: { host: '100.93.119.123:3223' } }),
    )
    expect(res.headers.get('location')).toBe('http://100.93.119.123:3223/login?next=%2Fpayments')
  })
})
