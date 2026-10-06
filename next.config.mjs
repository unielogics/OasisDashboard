import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const parity = process.env.NEXT_PUBLIC_PARITY === '1'
// The live variant: compiler output with the live patches, the session gate and the realtime stream (pnpm build:live).
const live = process.env.NEXT_PUBLIC_VARIANT === 'live'
// Where /api/* is proxied to in dev and in the live variant's `next start` (production serves /api from the reverse proxy).
const apiOrigin = process.env.API_ORIGIN || (live ? 'http://localhost:4000' : '')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The original runtime has no StrictMode; double-mounting would also double the cc tick and gesture listeners.
  reactStrictMode: false,
  poweredByHeader: false,
  // Always define the flag so production builds inline '' and drop the parity hook as dead code.
  env: { NEXT_PUBLIC_PARITY: parity ? '1' : '', NEXT_PUBLIC_VARIANT: live ? 'live' : '' },
  // gzip would buffer the SSE stream when it passes through a rewrite.
  ...(live ? { compress: false, experimental: { proxyTimeout: 3_600_000 } } : {}),
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
