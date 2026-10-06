// design:extract — one-off unpacker for the three Claude Design bundles in design/original/.
// Produces the immutable reference under design/extracted/ (see docs/reference/design/dashboard.md §2.1):
//   <screen>/template.html      serialized <x-dc> innerHTML == what the dc runtime parses (helmet included, asset uuids intact)
//   <screen>/logic.original.js  the `class Component extends DCLogic` script, byte-exact
//   <screen>/meta.json          screen label, data-props ($preview), source sha256
//   <screen>/helmet.fonts.css   the @font-face <style> (url("<uuid>") kept)   helmet.global.css  the global <style>
//   fonts/*.woff2 + fonts/manifest.json   (deduped across bundles by sha256)
//   runtime/{dc-runtime.js,react.production.min.js,react-dom.production.min.js}
// Refuses to overwrite an existing design/extracted unless --force. Run `pnpm design:checksums` afterwards.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { parse, parseFragment, serialize } from 'parse5'
import type { DefaultTreeAdapterMap } from 'parse5'

type El = DefaultTreeAdapterMap['element']
type Node = DefaultTreeAdapterMap['node']

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const origDir = path.join(root, 'design', 'original')
const outDir = path.join(root, 'design', 'extracted')
const force = process.argv.includes('--force')

const SCREENS = [
  { key: 'operations', file: 'operations.bundle.html' },
  { key: 'payments', file: 'payments.bundle.html' },
  { key: 'settings', file: 'settings.bundle.html' },
] as const

const sha = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex')
const isEl = (n: Node): n is El => 'tagName' in n
const attr = (e: El, name: string) => e.attrs.find((a) => a.name === name)?.value
function walk(n: Node, f: (e: El) => void) {
  if (isEl(n)) f(n)
  const kids = (n as { childNodes?: Node[] }).childNodes ?? []
  const content = (n as { content?: { childNodes: Node[] } }).content
  for (const k of kids) walk(k, f)
  if (content) for (const k of content.childNodes) walk(k, f)
}
const textOf = (e: El) => (e.childNodes as { nodeName: string; value?: string }[]).map((c) => c.value ?? '').join('')
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

if (fs.existsSync(outDir) && !force) {
  console.error('design/extracted already exists; refusing to overwrite (use --force to regenerate).')
  process.exit(2)
}
fs.rmSync(outDir, { recursive: true, force: true })

type ManifestEntry = { mime: string; compressed?: boolean; data: string }
const fontsByHash = new Map<string, { file: string; family: string; subset: string; bytes: number }>()
const fontManifest: Record<string, unknown> = {}
let runtimeWritten = false

for (const s of SCREENS) {
  const raw = fs.readFileSync(path.join(origDir, s.file), 'utf8')
  const grab = (t: string) => {
    const m = raw.match(new RegExp(`<script type="__bundler/${t}">([\\s\\S]*?)</script>`))
    if (!m) throw new Error(`${s.file}: missing __bundler/${t}`)
    return m[1]!
  }
  const manifest = JSON.parse(grab('manifest')) as Record<string, ManifestEntry>
  const template = JSON.parse(grab('template')) as string
  const ext = JSON.parse(grab('ext_resources')) as { id: string; uuid: string }[]
  const bytesOf = (uuid: string) => {
    const e = manifest[uuid]
    if (!e) throw new Error(`${s.file}: manifest has no ${uuid}`)
    const b = Buffer.from(e.data, 'base64')
    return e.compressed ? zlib.gunzipSync(b) : b
  }

  // The runtime parses <x-dc> children; locate it in the full page.
  const doc = parse(template)
  let xdc: El | undefined
  let logicEl: El | undefined
  walk(doc as unknown as Node, (e) => {
    if (e.tagName === 'x-dc') xdc = e
    if (e.tagName === 'script' && attr(e, 'data-dc-script') !== undefined) logicEl = e
  })
  if (!xdc || !logicEl) throw new Error(`${s.file}: <x-dc> or data-dc-script not found`)
  const templateHtml = serialize(xdc as DefaultTreeAdapterMap['parentNode'])
  const logic = textOf(logicEl)
  const dataProps = attr(logicEl, 'data-props')

  // Split <helmet> into the font-face style and the global style.
  const frag = parseFragment(templateHtml)
  const styles: string[] = []
  walk(frag as unknown as Node, (e) => {
    if (e.tagName === 'style') styles.push(textOf(e))
  })
  if (styles.length !== 2) throw new Error(`${s.file}: expected 2 <style> blocks in helmet, got ${styles.length}`)
  const fontsCss = styles.find((c) => c.includes('@font-face'))
  const globalCss = styles.find((c) => !c.includes('@font-face'))
  if (!fontsCss || !globalCss) throw new Error(`${s.file}: could not classify helmet styles`)

  const d = path.join(outDir, s.key)
  fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(d, 'template.html'), templateHtml)
  fs.writeFileSync(path.join(d, 'logic.original.js'), logic)
  fs.writeFileSync(path.join(d, 'helmet.fonts.css'), fontsCss)
  fs.writeFileSync(path.join(d, 'helmet.global.css'), globalCss)
  const label = templateHtml.match(/data-screen-label="([^"]+)"/)?.[1] ?? null
  fs.writeFileSync(
    path.join(d, 'meta.json'),
    JSON.stringify(
      {
        screen: s.key,
        name: label,
        dataProps: dataProps ? JSON.parse(dataProps.replace(/&quot;/g, '"')) : null,
        sourceSha256: sha(fs.readFileSync(path.join(origDir, s.file))),
        templateChars: templateHtml.length,
        logicChars: logic.length,
      },
      null,
      2,
    ) + '\n',
  )

  // Fonts: each @font-face = family + weight + preceding "/* subset */" comment + url("<uuid>").
  const blockRe = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g
  let m: RegExpExecArray | null
  const perScreenUuidToFile = new Map<string, string>()
  while ((m = blockRe.exec(fontsCss))) {
    const subset = m[1]!
    const body = m[2]!
    const family = body.match(/font-family:\s*'([^']+)'/)?.[1]
    const uuid = body.match(/url\("([0-9a-f-]{36})"\)/)?.[1]
    if (!family || !uuid) throw new Error(`${s.file}: unparsable @font-face (${subset})`)
    const buf = bytesOf(uuid)
    const h = sha(buf)
    let f = fontsByHash.get(h)
    if (!f) {
      f = { file: `${slug(family)}-${subset}.woff2`, family, subset, bytes: buf.length }
      fontsByHash.set(h, f)
      fs.mkdirSync(path.join(outDir, 'fonts'), { recursive: true })
      fs.writeFileSync(path.join(outDir, 'fonts', f.file), buf)
    } else if (f.family !== family || f.subset !== subset) {
      throw new Error(`${s.file}: font hash collision across (${family}/${subset}) and (${f.family}/${f.subset})`)
    }
    perScreenUuidToFile.set(uuid, f.file)
  }
  fontManifest[s.key] = Object.fromEntries(perScreenUuidToFile)

  if (!runtimeWritten) {
    const rt = path.join(outDir, 'runtime')
    fs.mkdirSync(rt, { recursive: true })
    const firstUuid = Object.keys(manifest)[0]!
    fs.writeFileSync(path.join(rt, 'dc-runtime.js'), bytesOf(firstUuid))
    for (const r of ext) {
      const name = r.id.includes('react-dom') ? 'react-dom.production.min.js' : 'react.production.min.js'
      fs.writeFileSync(path.join(rt, name), bytesOf(r.uuid))
    }
    runtimeWritten = true
  }
  console.log(`extracted ${s.key}: template ${templateHtml.length} chars, logic ${logic.length} chars, ${perScreenUuidToFile.size} font refs`)
}

fs.writeFileSync(
  path.join(outDir, 'fonts', 'manifest.json'),
  JSON.stringify(
    {
      files: Object.fromEntries([...fontsByHash].map(([h, f]) => [f.file, { sha256: h, family: f.family, subset: f.subset, bytes: f.bytes }])),
      uuidToFilePerScreen: fontManifest,
    },
    null,
    2,
  ) + '\n',
)
console.log(`fonts: ${fontsByHash.size} unique files (deduped across ${SCREENS.length} bundles)`)
