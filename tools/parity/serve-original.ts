import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { DEFAULT_ORIGINAL_PORT, ORIGINAL_DIR, SCREENS, type Screen } from './config'
import {
  applySwaps,
  checkSwapResults,
  extractTemplate,
  replaceTemplate,
  type SwapResult,
  type SwapSpec,
} from './bundle'

export interface ServeOptions {
  /** Listen port. Default 4310; when it is busy the server falls back to an ephemeral port unless `strictPort`. */
  port?: number
  strictPort?: boolean
  /** Directory holding <screen>.bundle.html (default design/original). */
  dir?: string
  /** Pre-render deviation swaps (text and attr). Entries are matched to screens by `swapsByScreen`. */
  swapsByScreen?: Partial<Record<Screen, SwapSpec[]>>
  /** Arbitrary source rewrite applied after the swaps; used by the sensitivity self-test to build a mutated "port". */
  transform?: (screen: Screen, template: string) => string
}

export interface OriginalServer {
  origin: string
  port: number
  /** URL of a screen's page; the path name becomes the dc `data-sc-name` (stripped by the DOM check). */
  url(screen: Screen, hash?: string): string
  swapResults: Record<string, SwapResult[]>
  close(): Promise<void>
}

/** Builds the HTML served for a screen: the untouched bundle unless swaps/transform apply. Throws on stale swaps. */
export function buildBundle(
  screen: Screen,
  dir: string,
  swaps: readonly SwapSpec[] = [],
  transform?: ServeOptions['transform'],
): { html: string; results: SwapResult[] } {
  const file = path.join(dir, `${screen}.bundle.html`)
  const html = fs.readFileSync(file, 'utf8')
  if (!swaps.length && !transform) return { html, results: [] }
  const { template } = extractTemplate(html)
  const swapped = applySwaps(template, swaps)
  checkSwapResults(screen, swapped.results)
  const final = transform ? transform(screen, swapped.template) : swapped.template
  return { html: replaceTemplate(html, final), results: swapped.results }
}

export async function startOriginalServer(opts: ServeOptions = {}): Promise<OriginalServer> {
  const dir = opts.dir ?? ORIGINAL_DIR
  const pages = new Map<Screen, string>()
  const swapResults: Record<string, SwapResult[]> = {}
  for (const screen of SCREENS) {
    const built = buildBundle(screen, dir, opts.swapsByScreen?.[screen] ?? [], opts.transform)
    pages.set(screen, built.html)
    swapResults[screen] = built.results
  }
  const server = http.createServer((req, res) => {
    const m = /^\/orig\/([a-z]+)\.html$/.exec((req.url ?? '/').split('?')[0]!)
    const html = m ? pages.get(m[1] as Screen) : undefined
    if (!html) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(html)
  })
  const listen = (port: number) =>
    new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
  try {
    await listen(opts.port ?? DEFAULT_ORIGINAL_PORT)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE' || opts.strictPort) throw err
    await listen(0)
  }
  const port = (server.address() as AddressInfo).port
  const origin = `http://127.0.0.1:${port}`
  return {
    origin,
    port,
    url: (screen, hash) =>
      `${origin}/orig/${screen}.html${hash ? (hash.startsWith('#') ? hash : `#${hash}`) : ''}`,
    swapResults,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
