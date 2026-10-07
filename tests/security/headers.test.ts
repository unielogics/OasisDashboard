// Adversarial review (rv/sec-dash): the dashboard's own responses. The API sets its security headers (helmet); the Next
// server that serves the pages and the screens' scripts sets none, so the money screens can be framed by any site and
// nothing limits what a script injected into a page could load.
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { THEME_BOOT_SCRIPT } from '@/data/theme'

type Rule = { source: string; headers: Array<{ key: string; value: string }> }

async function headersFor(env: Record<string, string>): Promise<Record<string, string>> {
  vi.resetModules()
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  // @ts-expect-error next.config.mjs is plain JavaScript
  const mod = (await import('../../next.config.mjs')) as { default: { headers?: () => Promise<Rule[]> } }
  const rules = (await mod.default.headers?.()) ?? []
  const everywhere = rules.filter((r) => r.source === '/:path*')
  return Object.fromEntries(everywhere.flatMap((r) => r.headers.map((h) => [h.key.toLowerCase(), h.value])))
}

afterEach(() => vi.unstubAllEnvs())

const sha = (s: string): string => `'sha256-${createHash('sha256').update(s).digest('base64')}'`

describe('SEC-08 dashboard response headers (the live variant, production)', () => {
  const live = { NODE_ENV: 'production', NEXT_PUBLIC_VARIANT: 'live' }

  it('forbids framing, sniffing and referrer leaks on every path', async () => {
    const h = await headersFor(live)
    expect(h['x-frame-options']).toBe('DENY')
    expect(h['x-content-type-options']).toBe('nosniff')
    expect(h['referrer-policy']).toBe('no-referrer')
    expect(h['cross-origin-opener-policy']).toBe('same-origin')
    expect(h['strict-transport-security']).toMatch(/^max-age=\d{7,}/)
    expect(h['permissions-policy']).toMatch(/geolocation=\(\)/)
  })

  it('pins scripts to this origin plus the one inline theme script, with no eval and no framing', async () => {
    const csp = (await headersFor(live))['content-security-policy'] ?? ''
    const d = Object.fromEntries(
      csp
        .split(';')
        .map((p) => p.trim().split(/\s+/))
        .filter((p) => p[0])
        .map(([k, ...v]) => [k, v]),
    )
    expect(d['default-src']).toEqual(["'self'"])
    expect(d['script-src']).toEqual(["'self'", sha(THEME_BOOT_SCRIPT)])
    expect(d['frame-ancestors']).toEqual(["'none'"])
    expect(d['object-src']).toEqual(["'none'"])
    expect(d['base-uri']).toEqual(["'none'"])
    expect(d['form-action']).toEqual(["'self'"])
    expect(d['connect-src']).toContain("'self'")
    expect(csp).not.toContain('unsafe-eval')
    expect(d['script-src']).not.toContain("'unsafe-inline'")
  })

  it('does not break the fixture and parity builds, which evaluate the original logic with new Function', async () => {
    const h = await headersFor({ NODE_ENV: 'production', NEXT_PUBLIC_VARIANT: '' })
    expect(h['content-security-policy']).toBeUndefined()
    expect(h['x-frame-options']).toBe('DENY')
  })

  it('leaves `next dev` alone (it needs eval and inline scripts)', async () => {
    const h = await headersFor({ NODE_ENV: 'development', NEXT_PUBLIC_VARIANT: 'live' })
    expect(h['content-security-policy']).toBeUndefined()
  })
})
