import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const parity = process.env.NEXT_PUBLIC_PARITY === '1'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The original runtime has no StrictMode; double-mounting would also double the cc tick and gesture listeners.
  reactStrictMode: false,
  poweredByHeader: false,
  // Always define the flag so production builds inline '' and drop the parity hook as dead code.
  env: { NEXT_PUBLIC_PARITY: parity ? '1' : '' },
  // Parity builds go to their own directory (deploys refuse to ship .next-parity).
  distDir: process.env.DIST_DIR || '.next',
  // ESLint runs as its own step (pnpm lint).
  eslint: { ignoreDuringBuilds: true },
  webpack(config, { webpack }) {
    // @generated -> committed compiler output; parity builds use the data-dc-tpl variant in .generated-parity.
    // A resolve alias would lose against the tsconfig `paths` entry (needed for tsc), so rewrite the request itself.
    const generated = path.join(root, parity ? '.generated-parity' : 'src/generated')
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^@generated\//, (resource) => {
        resource.request = resource.request.replace(/^@generated/, generated)
      }),
    )
    return config
  },
}

export default nextConfig
