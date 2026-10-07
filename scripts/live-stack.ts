// live-stack — runs the REAL backend API and the live dashboard against an ISOLATED Postgres schema, for end-to-end work.
//
//   pnpm tsx scripts/live-stack.ts up --name settings [--profile design[,parity-pay]] [--api-port 4010] [--web-port 3210]
//        [--backend ~/oasis/backend] [--dev-password oasis-dev-pass-1234] [--freeze 2026-06-13T10:36:00-04:00] [--skip-build]
//        [--host 127.0.0.1] [--origin http://100.x.y.z:3240[,https://...]] [--secure-cookies]
//   pnpm tsx scripts/live-stack.ts down --name settings [--drop]
//   pnpm tsx scripts/live-stack.ts status --name settings
//
// `up` (re)creates the schema e2e_<name> in the backend's DATABASE_URL, migrates and seeds it, starts the API
// (src/server.ts) on --api-port (jobs off, SMS dispatch inline, hooks listener off), builds the live dashboard with API_ORIGIN pointing at it and serves it on --web-port.
// The web server binds to --host (loopback unless told otherwise; pass a tailnet IP to review from another machine) and the
// API accepts --origin as extra browser origins (CSRF origin check), so a remote browser can sign in. --secure-cookies marks
// the session cookie Secure, for a stack reached over HTTPS (a tunnel or proxy in front of it).
// It prints a JSON summary and writes .live-stack/<name>.json (ports, pids, URLs, logs). Seeded logins are
// <first name>@oasisautospa.com (rafael, amara, sofia, marco, lena, daniel) with the dev password.
// Use one name, one API port and one web port per agent/worktree so concurrent stacks never collide.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const [cmd, ...rest] = process.argv.slice(2)
const flag = (n: string, d?: string): string | undefined => {
  const i = rest.indexOf(n)
  return i >= 0 ? rest[i + 1] : d
}
const has = (n: string) => rest.includes(n)

const nameArg = flag('--name')
if (!cmd || !['up', 'down', 'status'].includes(cmd) || !nameArg || !/^[a-z0-9_]{1,20}$/.test(nameArg)) {
  console.error('usage: live-stack.ts up|down|status --name <[a-z0-9_]{1,20}> [options]')
  process.exit(2)
}
const name: string = nameArg
const schema = `e2e_${name}`
const stateDir = path.join(root, '.live-stack')
const stateFile = path.join(stateDir, `${name}.json`)
const expand = (p: string) => p.replace(/^~(?=$|\/)/, os.homedir())
const backend = path.resolve(expand(flag('--backend', '~/oasis/backend')!))

interface State {
  name: string
  schema: string
  apiPort: number
  webPort: number
  apiUrl: string
  webUrl: string
  apiPid: number
  webPid: number
  devPassword: string
  profiles: string[]
  frozen: string | null
  apiLog: string
  webLog: string
}

function readEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]!] = m[2]!.replace(/^['"]|['"]$/g, '')
  }
  return out
}

function run(label: string, command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): void {
  const r = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 600_000 })
  if (r.status !== 0) {
    console.error(
      `[live-stack] ${label} failed (exit ${r.status})\n${(r.stdout ?? '') + (r.stderr ?? '')}`.slice(-4000),
    )
    process.exit(1)
  }
}

async function waitFor(url: string, ms: number, ok = (s: number) => s >= 200 && s < 500): Promise<void> {
  const t0 = Date.now()
  for (;;) {
    try {
      const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(2000) })
      if (ok(r.status)) return
    } catch {
      /* not up yet */
    }
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${url}`)
    await new Promise((r) => setTimeout(r, 400))
  }
}

function kill(pid: number): void {
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, 'SIGTERM')
      return
    } catch {
      /* already gone */
    }
  }
}
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function psql(dbUrl: string, sql: string): void {
  const r = spawnSync('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-qc', sql], { encoding: 'utf8' })
  if (r.status !== 0) {
    console.error(`[live-stack] psql failed: ${r.stderr}`)
    process.exit(1)
  }
}

async function up(): Promise<void> {
  const be = readEnvFile(path.join(backend, '.env'))
  const dbUrl = be.DATABASE_URL
  if (!dbUrl) throw new Error(`${backend}/.env has no DATABASE_URL`)
  const apiPort = Number(flag('--api-port', '4010'))
  const webPort = Number(flag('--web-port', '3210'))
  const devPassword = flag('--dev-password', 'oasis-dev-pass-1234')!
  const webHost = flag('--host', '127.0.0.1')!
  const extraOrigins = (flag('--origin') ?? '').split(',').filter(Boolean)
  const profiles = flag('--profile', 'design')!.split(',').filter(Boolean)
  const frozen = flag('--freeze') ?? null
  const apiUrl = `http://127.0.0.1:${apiPort}`
  const webUrl = `http://${webHost}:${webPort}`

  if (fs.existsSync(stateFile)) await down(false)
  fs.mkdirSync(stateDir, { recursive: true })

  const base: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${os.homedir()}/.local/bin:${process.env.PATH ?? ''}`,
    NODE_OPTIONS: '--max-old-space-size=2048',
    DATABASE_URL: dbUrl,
    DB_SEARCH_PATH: `${schema},public`,
    SEED_DEV_PASSWORD: devPassword,
    ...(frozen ? { CLOCK_FREEZE_AT: frozen } : {}),
  }
  // 1. fresh isolated schema, migrated and seeded
  psql(dbUrl, `drop schema if exists ${schema} cascade`)
  run('migrate', 'pnpm', ['migrate', 'up', '--schema', schema], backend, base)
  for (const p of profiles) run(`seed ${p}`, 'pnpm', ['seed', '--', '--profile', p], backend, base)

  // 2. the real API (no jobs: nothing in the e2e stack needs the scheduler; pg-boss would need its own schema)
  const apiLog = path.join(stateDir, `${name}.api.log`)
  const apiFd = fs.openSync(apiLog, 'w')
  const api = spawn('pnpm', ['exec', 'tsx', 'src/server.ts'], {
    cwd: backend,
    detached: true,
    stdio: ['ignore', apiFd, apiFd],
    env: {
      ...base,
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: String(apiPort),
      JOBS_ENABLED: 'false',
      // no worker in the stack: the SMS outbox drains inside the API process, and the tailnet-only hooks listener stays off
      SMS_DISPATCH_MODE: 'inline',
      HOOKS_PORT: '0',
      COOKIE_SECURE: has('--secure-cookies') ? 'true' : 'false',
      SESSION_SECRET: randomBytes(32).toString('base64'),
      PUBLIC_API_URL: apiUrl,
      PUBLIC_DASHBOARD_URL: extraOrigins[0] ?? webUrl,
      ALLOWED_ORIGINS: [webUrl, `http://localhost:${webPort}`, ...extraOrigins].join(','),
      PGBOSS_SCHEMA: `pgboss_${name}`,
    },
  })
  api.unref()
  await waitFor(`${apiUrl}/readyz`, 90_000, (s) => s === 200)

  // 3. the live dashboard, built against this API (the rewrites are baked in at build time)
  const webLog = path.join(stateDir, `${name}.web.log`)
  if (!has('--skip-build') || !fs.existsSync(path.join(root, '.next-live'))) {
    run('build:live', 'pnpm', ['build:live'], root, { ...base, API_ORIGIN: apiUrl })
  }
  const webFd = fs.openSync(webLog, 'w')
  const web = spawn('pnpm', ['start:live'], {
    cwd: root,
    detached: true,
    stdio: ['ignore', webFd, webFd],
    env: { ...base, API_ORIGIN: apiUrl, PORT: String(webPort), WEB_HOST: webHost },
  })
  web.unref()
  await waitFor(`${webUrl}/login`, 90_000, (s) => s === 200)

  const state: State = {
    name,
    schema,
    apiPort,
    webPort,
    apiUrl,
    webUrl,
    apiPid: api.pid!,
    webPid: web.pid!,
    devPassword,
    profiles,
    frozen,
    apiLog,
    webLog,
  }
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n')
  console.log(JSON.stringify(state, null, 2))
}

async function down(announce = true): Promise<void> {
  if (!fs.existsSync(stateFile)) {
    if (announce) console.log(`no stack named ${name}`)
    return
  }
  const s = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as State
  kill(s.webPid)
  kill(s.apiPid)
  for (let i = 0; i < 20 && (alive(s.webPid) || alive(s.apiPid)); i++)
    await new Promise((r) => setTimeout(r, 250))
  fs.rmSync(stateFile)
  if (has('--drop')) {
    const be = readEnvFile(path.join(backend, '.env'))
    if (be.DATABASE_URL) psql(be.DATABASE_URL, `drop schema if exists ${s.schema} cascade`)
  }
  if (announce) console.log(`stack ${name} stopped${has('--drop') ? ` and schema ${s.schema} dropped` : ''}`)
}

function status(): void {
  if (!fs.existsSync(stateFile)) return void console.log(JSON.stringify({ name, running: false }))
  const s = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as State
  console.log(JSON.stringify({ ...s, running: alive(s.apiPid) && alive(s.webPid) }, null, 2))
}

if (cmd === 'up') await up()
else if (cmd === 'down') await down()
else status()
