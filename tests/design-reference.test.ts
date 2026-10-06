import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

describe('design reference', () => {
  it('original bundles match design/CHECKSUMS.sha256', () => {
    const script = path.resolve(__dirname, '..', 'scripts', 'verify-design.mjs')
    const out = execFileSync('node', [script], { encoding: 'utf8' })
    expect(out).toContain('design:verify OK')
  })
})
