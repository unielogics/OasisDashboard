import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const parity = process.env.NEXT_PUBLIC_PARITY === '1'
// The live variant: compiler output with the live patches, the session gate and the realtime stream (pnpm build:live).
const live = process.env.NEXT_PUBLIC_VARIANT === 'live'
// Where /api/* and /dev-storage/* are proxied to, ONLY when API_ORIGIN is set (live stacks, the fake API, `next dev`).
// Production builds leave it unset: nginx serves /api itself, and a Next rewrite there would be a second, case-insensitive
// path to the API (/API/v1/openapi.json) that skips nginx's deny rules and request limits.
const apiOrigin = (process.env.API_ORIGIN ?? '').trim()
// host[:port] for OASIS_PUBLIC_HOSTS (declared before the parse below runs at load time)
const HOST_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
const HOST_RE = new RegExp(`^(?=[^:]{1,253}(?::|$))${HOST_LABEL}(?:\\.${HOST_LABEL})*(?::\\d{1,5})?$`)

// Build-time allowlists from the deploy kit (docs/security-headers.md); a malformed value fails the build.
const photosOrigins = parsePhotosOrigins(process.env.OASIS_PHOTOS_ORIGINS)
const publicHosts = parsePublicHosts(process.env.OASIS_PUBLIC_HOSTS)

/**
 * OASIS_PHOTOS_ORIGINS: comma-separated https origins of the photos bucket (presigned GET and POST URLs), for the CSP's
 * img-src and connect-src. Strict: https only, an exact origin (no wildcard, path, query, credentials), no empty entries.
 * Empty or unset means none: the fs storage simulator serves photos from this origin (/dev-storage).
 * @param {string | undefined} raw
 * @returns {string[]}
 */
export function parsePhotosOrigins(raw) {
  if (raw === undefined || raw.trim() === '') return []
  const out = []
  for (const part of raw.split(',')) {
    const entry = part.trim()
    const bad = (why) => new Error(`OASIS_PHOTOS_ORIGINS: ${JSON.stringify(entry)} ${why}`)
    if (!entry) throw bad('is an empty entry')
    if (entry.includes('*')) throw bad('has a wildcard; list each bucket origin')
    let url
    try {
      url = new URL(entry)
    } catch {
      throw bad('is not a URL')
    }
    if (url.protocol !== 'https:') throw bad('is not https')
    if (url.origin !== entry.replace(/\/$/, '') || url.username || url.password)
      throw bad('is not a bare origin (https://host[:port], no path, query or credentials)')
    if (!out.includes(url.origin)) out.push(url.origin)
  }
  return out
}

/**
 * OASIS_PUBLIC_HOSTS: comma-separated host[:port] values the sign-in redirect may point to (src/middleware.ts); the first is
 * the fallback for any other Host. Lower-cased; no scheme, path, wildcard or empty entries. Unset means any well-formed host.
 * @param {string | undefined} raw
 * @returns {string[]}
 */
export function parsePublicHosts(raw) {
  if (raw === undefined || raw.trim() === '') return []
  const out = []
  for (const part of raw.split(',')) {
    const entry = part.trim().toLowerCase()
    if (!HOST_RE.test(entry))
      throw new Error(
        `OASIS_PUBLIC_HOSTS: ${JSON.stringify(part.trim())} is not a host[:port] (no scheme, path or wildcard)`,
      )
    if (!out.includes(entry)) out.push(entry)
  }
  return out
}

// sha256 of THEME_BOOT_SCRIPT (src/data/theme.ts), the one inline script in <head>; tests/security/headers.test.ts keeps it honest.
const THEME_BOOT_HASH = "'sha256-9MsNuNwyacr2obYRjJrqV45OiBr0T8lr2IffKfXJ9j8='"

/**
 * Response headers of the pages. The strict CSP is for the live variant in production only: the fixture and parity builds
 * evaluate the original logic scripts with new Function (they need unsafe-eval) and `next dev` needs eval and inline scripts.
 * The live bundles contain no eval or new Function. style-src keeps 'unsafe-inline' because the designs style by attribute and
 * the screens inject their stylesheet; scripts get no unsafe-inline. Photos come from presigned S3 URLs on the bucket origins in
 * OASIS_PHOTOS_ORIGINS (nothing else on amazonaws.com), or from this origin (/dev-storage) with the fs storage simulator.
 */
function securityHeaders() {
  const production = process.env.NODE_ENV === 'production'
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${THEME_BOOT_HASH}`,
    "style-src 'self' 'unsafe-inline'",
    ["img-src 'self' data: blob:", ...photosOrigins].join(' '),
    "font-src 'self' data:",
    ["connect-src 'self'", ...photosOrigins].join(' '),
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
  const list = [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()' },
    { key: 'Strict-Transport-Security', value: 'max-age=15552000' },
    ...(production && live ? [{ key: 'Content-Security-Policy', value: csp }] : []),
  ]
  return list
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The original runtime has no StrictMode; double-mounting would also double the cc tick and gesture listeners.
  reactStrictMode: false,
  poweredByHeader: false,
  // Always define the flag so production builds inline '' and drop the parity hook as dead code.
  // OASIS_PUBLIC_HOSTS is inlined so the middleware's redirect allowlist is fixed at build time (validated above).
  env: {
    NEXT_PUBLIC_PARITY: parity ? '1' : '',
    NEXT_PUBLIC_VARIANT: live ? 'live' : '',
    OASIS_PUBLIC_HOSTS: publicHosts.join(','),
  },
  // gzip would buffer the SSE stream when it passes through a rewrite.
  ...(live ? { compress: false, experimental: { proxyTimeout: 3_600_000 } } : {}),
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders() }]
  },
  async rewrites() {
    return [
      // Reset links arrive as /reset/<token> or /reset-password?token=<token> (backend notifications); one page serves both.
      { source: '/reset/:token', destination: '/reset?token=:token' },
      { source: '/reset-password', destination: '/reset' },
      ...(apiOrigin
        ? [
            { source: '/api/:path*', destination: `${apiOrigin}/api/:path*` },
            // the API's simulator object store (STORAGE_PROVIDER=fs, never production) is served from this origin too, so
            // photos stay same-origin under the CSP and reachable through a tunnel or proxy; production uses presigned S3 URLs
            { source: '/dev-storage/:path*', destination: `${apiOrigin}/dev-storage/:path*` },
          ]
        : []),
    ]
  },
  // Parity builds go to their own directory (deploys refuse to ship .next-parity).
  distDir: process.env.DIST_DIR || '.next',
  // ESLint runs as its own step (pnpm lint).
  eslint: { ignoreDuringBuilds: true },
  webpack(config, { webpack }) {
    // @generated -> committed compiler output; parity builds use the data-dc-tpl variant in .generated-parity.
    // A resolve alias would lose against the tsconfig `paths` entry (needed for tsc), so rewrite the request itself.
    const generated = path.join(
      root,
      parity ? '.generated-parity' : live ? '.generated-live' : 'src/generated',
    )
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^@generated\//, (resource) => {
        resource.request = resource.request.replace(/^@generated/, generated)
      }),
    )
    return config
  },
}

export default nextConfig
