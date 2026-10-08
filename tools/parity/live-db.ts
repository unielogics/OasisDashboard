// Save and restore a live stack's schema around a scenario that writes through the real API (docs/parity-live.md), so
// the next run starts from the seeded design state again. pg_dump/pg_restore of the stack's own schema only; the
// database URL comes from the backend checkout the stack runs (never printed).
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { StackFile } from './live-config'

export interface SchemaSnapshot {
  /** restores the schema to the saved state (drop and reload); safe to call more than once */
  restore(): void
  /** removes the dump file */
  dispose(): void
}

const redact = (s: string) => s.replace(/postgres(ql)?:\/\/\S+/g, '<url>')

export function databaseUrl(backend: string): string {
  const file = path.join(backend.replace(/^~(?=$|\/)/, os.homedir()), '.env')
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^DATABASE_URL=(.*)$/)
    if (m) return m[1]!.replace(/^['"]|['"]$/g, '')
  }
  throw new Error(`${file} has no DATABASE_URL`)
}

function run(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`${cmd} failed: ${redact((r.stderr || r.stdout || '').slice(-800))}`)
  return r.stdout
}

/** Dumps the stack's schema now; `restore()` puts it back exactly (rows, sequences, constraints). */
export function saveSchema(stack: Pick<StackFile, 'schema' | 'backend' | 'name'>): SchemaSnapshot {
  if (!/^e2e_[a-z0-9_]+$/.test(stack.schema)) throw new Error(`unexpected schema name ${stack.schema}`)
  if (!stack.backend)
    throw new Error(`stack "${stack.name}" does not name its backend; restart it with live:up`)
  const url = databaseUrl(stack.backend)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-live-'))
  const dump = path.join(dir, `${stack.schema}.dump`)
  run('pg_dump', [
    '--dbname',
    url,
    '--schema',
    stack.schema,
    '--format',
    'custom',
    '--no-owner',
    '--file',
    dump,
  ])
  return {
    restore() {
      run('psql', [url, '-v', 'ON_ERROR_STOP=1', '-qc', `drop schema if exists ${stack.schema} cascade`])
      run('pg_restore', ['--dbname', url, '--no-owner', '--exit-on-error', dump])
    },
    dispose() {
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}
