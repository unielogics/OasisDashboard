// design:verify — the design/ directory is the immutable reference. Fails if any file differs from CHECKSUMS.sha256.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const designDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'design')
const listFile = path.join(designDir, 'CHECKSUMS.sha256')
const bad = []
for (const line of fs.readFileSync(listFile, 'utf8').split('\n').filter(Boolean)) {
  const [sum, rel] = line.split(/\s+/)
  const file = path.join(designDir, rel)
  const actual = fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : 'MISSING'
  if (actual !== sum) bad.push(`${rel}: expected ${sum}, got ${actual}`)
}
if (bad.length) {
  console.error('design:verify FAILED\n' + bad.join('\n'))
  process.exit(1)
}
console.log('design:verify OK')
