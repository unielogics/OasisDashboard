// assert:react — the visual-parity pin. Fails when
//   * more than one copy of react or react-dom is installed (pnpm store layout: node_modules/.pnpm/react@*),
//   * the installed copies are not exactly 18.3.1, or a canary/rc/experimental build is installed,
//   * with --dist <dir>: the built client bundle contains a React canary marker (what the App Router's vendored
//     React would leave behind) or does not contain the 18.3.1 version string.
// Usage: node scripts/assert-react.mjs [--dist .next]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WANT = '18.3.1'
const problems = []

const pnpmDir = path.join(root, 'node_modules', '.pnpm')
const direct = (name) => path.join(root, 'node_modules', name, 'package.json')

function installedCopies(name) {
  const dirs = new Set()
  if (fs.existsSync(pnpmDir)) {
    for (const d of fs.readdirSync(pnpmDir)) {
      // react@18.3.1, react-dom@18.3.1_react@18.3.1 (peer-suffixed), but not react-dom-xyz@ / react-is@
      if (d === name || d.startsWith(name + '@')) {
        const pkg = path.join(pnpmDir, d, 'node_modules', name, 'package.json')
        if (fs.existsSync(pkg)) dirs.add(fs.realpathSync(path.dirname(pkg)))
      }
    }
  }
  if (fs.existsSync(direct(name))) dirs.add(fs.realpathSync(path.dirname(direct(name))))
  return [...dirs]
}

for (const name of ['react', 'react-dom']) {
  const copies = installedCopies(name)
  if (copies.length === 0) problems.push(`${name} is not installed`)
  if (copies.length > 1)
    problems.push(`${copies.length} copies of ${name} installed:\n    ${copies.join('\n    ')}`)
  for (const dir of copies) {
    const v = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version
    if (v !== WANT) problems.push(`${name} is ${v}, expected exactly ${WANT} (${dir})`)
    if (/canary|experimental|rc|beta|alpha|nightly/i.test(v))
      problems.push(`${name} ${v} is a pre-release build`)
  }
}

const distArg = process.argv.indexOf('--dist')
if (distArg > 0) {
  const dist = path.resolve(root, process.argv[distArg + 1] ?? '.next')
  const staticDir = path.join(dist, 'static')
  if (!fs.existsSync(staticDir)) {
    problems.push(`${path.relative(root, staticDir)} does not exist (build first)`)
  } else {
    const files = []
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name.endsWith('.js')) files.push(p)
      }
    }
    walk(staticDir)
    const canary = /\b\d+\.\d+\.\d+-(canary|rc|experimental|beta)-[0-9a-f]{6,}/
    let sawVersion = false
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8')
      const m = text.match(canary)
      if (m) problems.push(`React canary marker "${m[0]}" in ${path.relative(root, f)}`)
      if (text.includes(`"${WANT}"`)) sawVersion = true
    }
    if (!sawVersion)
      problems.push(
        `no client chunk under ${path.relative(root, staticDir)} carries the React ${WANT} version string`,
      )
  }
}

if (problems.length) {
  console.error('assert:react FAILED\n  - ' + problems.join('\n  - '))
  process.exit(1)
}
console.log(`assert:react OK (single react/react-dom ${WANT}${distArg > 0 ? ', dist clean' : ''})`)
