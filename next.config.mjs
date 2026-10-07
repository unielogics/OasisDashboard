import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const parity = process.env.NEXT_PUBLIC_PARITY === '1'
// The live variant: compiler output with the live patches, the session gate and the realtime stream (pnpm build:live).
const live = process.env.NEXT_PUBLIC_VARIANT === 'live'
// Where /api/* is proxied to in dev and in the live variant's `next start` (production serves /api from the reverse proxy).
const apiOrigin = process.env.API_ORIGIN || (live ? 'http://localhost:4000' : '')

// sha256 of THEME_BOOT_SCRIPT (src/data/theme.ts), the one inline script in <head>; tests/security/headers.test.ts keeps it honest.
const THEME_BOOT_HASH = "'sha256-9MsNuNwyacr2obYRjJrqV45OiBr0T8lr2IffKfXJ9j8='"

/**
 * Response headers of the pages. The strict CSP is for the live variant in production only: the fixture and parity builds
 * evaluate the original logic scripts with new Function (they need unsafe-eval) and `next dev` needs eval and inline scripts.
 * The live bundles contain no eval or new Function. style-src keeps 'unsafe-inline' because the designs style by attribute and
 * the screens inject their stylesheet; scripts get no unsafe-inline. Photos come from presigned S3 URLs.
 */
function securityHeaders() {
  const production = process.env.NODE_ENV === 'production'
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${THEME_BOOT_HASH}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://*.amazonaws.com",
    "font-src 'self' data:",
    "connect-src 'self' https://*.amazonaws.com",
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
  env: { NEXT_PUBLIC_PARITY: parity ? '1' : '', NEXT_PUBLIC_VARIANT: live ? 'live' : '' },
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
      ...(apiOrigin ? [{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }] : []),
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
