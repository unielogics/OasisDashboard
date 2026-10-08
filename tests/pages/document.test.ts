import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FONT_PAGES, FONT_PRELOADS, preloadsFonts } from '../../src/pages/_document'

const pagesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'pages')

describe('font preloads', () => {
  it('only the three screens preload the two fonts; the login family, 404, / and /logout do not', () => {
    for (const p of ['/operations', '/payments', '/settings']) expect(preloadsFonts(p), p).toBe(true)
    for (const p of [
      '/login',
      '/forgot',
      '/reset',
      '/invite',
      '/invite/[token]',
      '/logout',
      '/404',
      '/',
      '/_error',
      '/500',
      undefined,
    ])
      expect(preloadsFonts(p), String(p)).toBe(false)
  })

  it('every listed page exists and every preloaded file is served', () => {
    for (const p of FONT_PAGES) {
      const file = p === '/' ? 'index' : p.slice(1)
      expect(
        ['.tsx', '.ts'].some((ext) => fs.existsSync(path.join(pagesDir, file + ext))),
        `${p} has no page file`,
      ).toBe(true)
    }
    for (const f of FONT_PRELOADS)
      expect(fs.existsSync(path.join(pagesDir, '..', '..', 'public', f)), f).toBe(true)
  })
})
