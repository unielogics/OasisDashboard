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
