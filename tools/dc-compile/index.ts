import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScreens, SCREENS } from './compile'
import type { ScreenId } from './compile'
import { CompileError } from './errors'

const USAGE = `usage: tsx tools/dc-compile/index.ts [--screen operations|payments|settings|all] [--check]
         [--variant=prod|parity|live] [--emit-tpl-ids] [--out <dir>] [--allow-complex-expr]
exit codes: 0 ok, 1 --check mismatch, 2 grammar / unknown attribute / unsupported construct, 3 patch guard failed`

function main(argv: string[]): number {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  let screen = 'all'
  let check = false
  let variant: 'prod' | 'parity' | 'live' = 'prod'
  let tplIds = false
  let out = 'src/generated'
  let allowComplexExpr = false
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i]!
    let inline: string | undefined
    const eq = a.indexOf('=')
    if (a.startsWith('--') && eq > 0) {
      inline = a.slice(eq + 1)
      a = a.slice(0, eq)
    }
    const val = () => inline ?? argv[++i]
    switch (a) {
      case '--screen':
        screen = val() ?? ''
        break
      case '--check':
        check = true
        break
      case '--variant': {
        const v = val()
        if (v !== 'prod' && v !== 'parity' && v !== 'live')
          throw new CompileError(`--variant must be prod, parity or live, got ${v}`)
        variant = v
        break
      }
      case '--emit-tpl-ids':
        tplIds = true
        break
      case '--out':
        out = val() ?? ''
        break
      case '--allow-complex-expr':
        allowComplexExpr = true
        break
      case '--help':
      case '-h':
        console.log(USAGE)
        return 0
      default:
        throw new CompileError(`unknown argument ${a}\n${USAGE}`)
    }
  }
  const screens: readonly ScreenId[] =
    screen === 'all'
      ? SCREENS
      : (SCREENS as readonly string[]).includes(screen)
        ? [screen as ScreenId]
        : (() => {
            throw new CompileError(
              `--screen must be operations|payments|settings|all, got ${screen}\n${USAGE}`,
            )
          })()

  const outDir = path.resolve(root, out)
  const { perScreen, shared } = compileScreens(screens, { root, variant, tplIds, allowComplexExpr })
  const files: [string, string | Buffer][] = []
  for (const s of screens)
    for (const [rel, data] of Object.entries(perScreen[s]!)) files.push([path.join(outDir, rel), data])
  for (const [rel, data] of Object.entries(shared)) files.push([path.join(root, rel), data])

  if (check) {
    const bad: string[] = []
    for (const [file, data] of files) {
      const want = Buffer.isBuffer(data) ? data : Buffer.from(data)
      if (!fs.existsSync(file)) bad.push(`missing  ${path.relative(root, file)}`)
      else if (!fs.readFileSync(file).equals(want)) bad.push(`differs  ${path.relative(root, file)}`)
    }
    if (bad.length) {
      console.error(`dc:check FAILED (run \`pnpm dc:compile\` and commit the result):\n  ${bad.join('\n  ')}`)
      return 1
    }
    console.log(`dc:check OK (${files.length} files, variant ${variant})`)
    return 0
  }
  for (const [file, data] of files) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, data)
  }
  console.log(
    `dc:compile wrote ${files.length} files (variant ${variant}${tplIds || variant === 'parity' ? ', tpl ids' : ''}) -> ${path.relative(root, outDir) || '.'}`,
  )
  return 0
}

try {
  process.exitCode = main(process.argv.slice(2))
} catch (e) {
  if (e instanceof CompileError) {
    console.error(`dc-compile: ${e.message}`)
    process.exitCode = e.exit
  } else throw e
}
