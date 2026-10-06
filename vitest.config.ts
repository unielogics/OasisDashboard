import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const dir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@generated': path.resolve(dir, 'src/generated'),
      '@': path.resolve(dir, 'src'),
    },
  },
  test: {
    // Real timers, sockets and a shared 2-vCPU box: a few SSE/reconnect tests need more than vitest's 5 s default.
    testTimeout: 20_000,
    exclude: [
      '**/node_modules/**',
      '.next/**',
      '.next-parity/**',
      '.generated-parity/**',
      '.generated-live/**',
      '.next-live/**',
      'design/**',
      'parity-reports/**',
    ],
  },
})
