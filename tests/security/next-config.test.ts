// Production review M1, L1 and the redirect host allowlist: what next.config.mjs bakes into a build from its environment.
// M1: a Next rewrite of /api/:path* is case-insensitive, so behind nginx /API/v1/openapi.json reached the API through Next and
// skipped nginx's deny rules and limits. The rewrites now exist only when API_ORIGIN is set (live stacks, fake API, dev).
// L1: the CSP allowed any https://*.amazonaws.com; it now allows only the photos bucket origins from OASIS_PHOTOS_ORIGINS.
import { afterEach, describe, expect, it, vi } from 'vitest'

type Rewrite = { source: string; destination: string }
type Rule = { source: string; headers: Array<{ key: string; value: string }> }
interface Mod {
  default: {
    rewrites?: () => Promise<Rewrite[]>
    headers?: () => Promise<Rule[]>
    env?: Record<string, string>
  }
  parsePhotosOrigins: (raw: string | undefined) => string[]
  parsePublicHosts: (raw: string | undefined) => string[]
}

async function load(env: Record<string, string | undefined>): Promise<Mod> {
  vi.resetModules()
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  // @ts-expect-error next.config.mjs is plain JavaScript
  return (await import('../../next.config.mjs')) as Mod
}

const live = { NODE_ENV: 'production', NEXT_PUBLIC_VARIANT: 'live' }

async function csp(env: Record<string, string | undefined>): Promise<Record<string, string[]>> {
  const rules = (await (await load({ ...live, ...env })).default.headers?.()) ?? []
  const value = rules.flatMap((r) => r.headers).find((h) => h.key === 'Content-Security-Policy')?.value ?? ''
  return Object.fromEntries(
    value
      .split(';')
      .map((p) => p.trim().split(/\s+/))
      .filter((p) => p[0])
      .map(([k, ...v]) => [k!, v]),
  )
}

afterEach(() => vi.unstubAllEnvs())

describe('M1: /api and /dev-storage rewrites only with an explicit API_ORIGIN', () => {
  it('a production live build without API_ORIGIN has no API rewrite (nginx serves /api; no /API bypass)', async () => {
    const mod = await load({ ...live, API_ORIGIN: undefined })
    const rewrites = (await mod.default.rewrites?.()) ?? []
    expect(rewrites.map((r) => r.source)).toEqual(['/reset/:token', '/reset-password'])
    expect(JSON.stringify(rewrites)).not.toContain('localhost:4000')
  })
  it('an empty or blank API_ORIGIN counts as unset', async () => {
    for (const v of ['', '   ']) {
      const rewrites = (await (await load({ ...live, API_ORIGIN: v })).default.rewrites?.()) ?? []
      expect(rewrites.some((r) => r.source.startsWith('/api') || r.source.startsWith('/dev-storage'))).toBe(
        false,
      )
    }
  })
  it('a live stack sets API_ORIGIN: /api and /dev-storage go to it', async () => {
    const rewrites =
      (await (await load({ ...live, API_ORIGIN: 'http://127.0.0.1:4091' })).default.rewrites?.()) ?? []
    expect(rewrites).toContainEqual({
      source: '/api/:path*',
      destination: 'http://127.0.0.1:4091/api/:path*',
    })
    expect(rewrites).toContainEqual({
      source: '/dev-storage/:path*',
      destination: 'http://127.0.0.1:4091/dev-storage/:path*',
    })
  })
  it('the fixture build (fake API in dev) also proxies only when told to', async () => {
    const none =
      (await (await load({ NEXT_PUBLIC_VARIANT: '', API_ORIGIN: undefined })).default.rewrites?.()) ?? []
    expect(none.some((r) => r.source === '/api/:path*')).toBe(false)
    const some =
      (await (
        await load({ NEXT_PUBLIC_VARIANT: '', API_ORIGIN: 'http://localhost:4000' })
      ).default.rewrites?.()) ?? []
    expect(some).toContainEqual({ source: '/api/:path*', destination: 'http://localhost:4000/api/:path*' })
  })
})

describe('L1: CSP img-src and connect-src are the photos bucket origins only', () => {
  it('without OASIS_PHOTOS_ORIGINS: same origin (fs storage via /dev-storage), data: and blob: images, nothing on AWS', async () => {
    const d = await csp({ OASIS_PHOTOS_ORIGINS: undefined })
    expect(d['img-src']).toEqual(["'self'", 'data:', 'blob:'])
    expect(d['connect-src']).toEqual(["'self'"])
    expect(JSON.stringify(d)).not.toContain('amazonaws')
    expect(JSON.stringify(d)).not.toContain('*')
  })
  it('with the bucket origins: exactly those, in both directives', async () => {
    const origins =
      'https://oasis-photos-580446611342.s3.amazonaws.com, https://oasis-photos-580446611342.s3.us-east-1.amazonaws.com'
    const d = await csp({ OASIS_PHOTOS_ORIGINS: origins })
    const both = [
      'https://oasis-photos-580446611342.s3.amazonaws.com',
      'https://oasis-photos-580446611342.s3.us-east-1.amazonaws.com',
    ]
    expect(d['img-src']).toEqual(["'self'", 'data:', 'blob:', ...both])
    expect(d['connect-src']).toEqual(["'self'", ...both])
  })
  it('an invalid OASIS_PHOTOS_ORIGINS fails the build (config load) instead of widening the policy', async () => {
    await expect(load({ ...live, OASIS_PHOTOS_ORIGINS: 'https://*.amazonaws.com' })).rejects.toThrow(
      /wildcard/,
    )
  })
})

describe('parsePhotosOrigins (strict)', async () => {
  const { parsePhotosOrigins } = await load({})
  it('accepts bare https origins, trims, drops a trailing slash and duplicates', () => {
    expect(parsePhotosOrigins(undefined)).toEqual([])
    expect(parsePhotosOrigins('  ')).toEqual([])
    expect(
      parsePhotosOrigins(' https://b.s3.amazonaws.com/ ,https://b.s3.amazonaws.com,https://x.example:8443'),
    ).toEqual(['https://b.s3.amazonaws.com', 'https://x.example:8443'])
  })
  it.each([
    ['http://b.s3.amazonaws.com', /not https/],
    ['https://*.amazonaws.com', /wildcard/],
    ['*', /wildcard/],
    ['https://b.s3.amazonaws.com/prod', /bare origin/],
    ['https://b.s3.amazonaws.com?x=1', /bare origin/],
    ['https://u:p@b.s3.amazonaws.com', /bare origin/],
    ['https://B.S3.amazonaws.com', /bare origin/],
    ['https://b.s3.amazonaws.com:443', /bare origin/],
    ['b.s3.amazonaws.com', /not a URL/],
    ['https://a.example,,https://b.example', /empty entry/],
    ['https://a.example, data:', /not https/],
    ["https://a.example 'unsafe-inline'", /not a URL|bare origin/],
    ['https://a.example;script-src *', /wildcard|bare origin/],
  ])('rejects %s', (raw, why) => {
    expect(() => parsePhotosOrigins(raw)).toThrow(why)
  })
})

describe('parsePublicHosts (strict) and the build-time inlining for the middleware', async () => {
  const { parsePublicHosts } = await load({})
  it('accepts host[:port] lists, lower-cased and de-duplicated', () => {
    expect(parsePublicHosts(undefined)).toEqual([])
    expect(parsePublicHosts('App.OasisAutoSpaNJ.com, 100.93.119.123:3240,app.oasisautospanj.com')).toEqual([
      'app.oasisautospanj.com',
      '100.93.119.123:3240',
    ])
  })
  it.each([
    'https://app.oasisautospanj.com',
    'app.oasisautospanj.com/login',
    '*.oasisautospanj.com',
    'app.oasisautospanj.com,',
    'user@app.oasisautospanj.com',
    'app..oasisautospanj.com',
    '-app.oasisautospanj.com',
    'app.oasisautospanj.com:123456',
  ])('rejects %s', (raw) => {
    expect(() => parsePublicHosts(raw)).toThrow(/OASIS_PUBLIC_HOSTS/)
  })
  it('next.config env inlines the validated list (so the middleware allowlist is fixed at build time)', async () => {
    const mod = await load({ ...live, OASIS_PUBLIC_HOSTS: ' App.OasisAutoSpaNJ.com ' })
    expect(mod.default.env?.OASIS_PUBLIC_HOSTS).toBe('app.oasisautospanj.com')
    const none = await load({ ...live, OASIS_PUBLIC_HOSTS: undefined })
    expect(none.default.env?.OASIS_PUBLIC_HOSTS).toBe('')
  })
})
