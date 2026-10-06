// A tiny stand-in for the backend identity module, so the live variant and the login pages can be exercised end to
// end without the real API: /api/v1/auth/*, /me, /me/preferences, /me/view-as, /meta/now and the /events SSE stream.
//
//   pnpm fake-api            listens on :4000 (FAKE_API_PORT), heartbeat every 20 s (FAKE_HEARTBEAT_MS)
//
// Canned people (password for all: oasis-demo-1234): alex@oasis.test (Super Admin), rafael@oasis.test (Management),
// marco@oasis.test (Crew). Invite tokens: invite-demo-token (single use), invite-expired. Reset tokens:
// reset-demo-token (single use), reset-expired. Test hooks (not part of the real API): POST /__fake/emit
// {channel,type,payload}, POST /__fake/drop-streams, POST /__fake/expire-sessions, POST /__fake/reset,
// GET /__fake/state.
import crypto from 'node:crypto'
import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { DEFAULT_ROLE_GRANTS, LIMITED_PERMISSIONS, PERMISSION_KEYS } from '../src/auth/permissions'

type RoleKey = keyof typeof DEFAULT_ROLE_GRANTS
interface Role {
  id: string
  key: RoleKey
  name: string
  locked: boolean
  limits: { refund: number | null; adjust: number | null; credit: number | null }
}
interface Person {
  id: string
  employeeId: string
  first: string
  last: string
  email: string
  password: string
  title: string
  roles: RoleKey[]
  theme: 'light' | 'dark' | null
}
interface Session {
  token: string
  personId: string
  csrfSecret: string
  viewAsRoleId: string | null
  expiresAt: Date
}

const ROLES: Role[] = [
  {
    id: 'role-super',
    key: 'super',
    name: 'Super Admin',
    locked: true,
    limits: { refund: null, adjust: null, credit: null },
  },
  {
    id: 'role-mgmt',
    key: 'mgmt',
    name: 'Management',
    locked: false,
    limits: { refund: 100000, adjust: 50000, credit: 50000 },
  },
  {
    id: 'role-acct',
    key: 'acct',
    name: 'Accounting',
    locked: false,
    limits: { refund: 50000, adjust: 25000, credit: 25000 },
  },
  {
    id: 'role-support',
    key: 'support',
    name: 'Customer Support',
    locked: false,
    limits: { refund: 5000, adjust: 2500, credit: 5000 },
  },
  {
    id: 'role-crew',
    key: 'crew',
    name: 'Crew',
    locked: false,
    limits: { refund: 2500, adjust: 2500, credit: 2500 },
  },
]

const seedPeople = (): Person[] => [
  {
    id: 'user-alex',
    employeeId: 'emp-alex',
    first: 'Alex',
    last: 'Rivera',
    email: 'alex@oasis.test',
    password: 'oasis-demo-1234',
    title: 'Owner',
    roles: ['super'],
    theme: null,
  },
  {
    id: 'user-rafael',
    employeeId: 'emp-rafael',
    first: 'Rafael',
    last: 'Mendes',
    email: 'rafael@oasis.test',
    password: 'oasis-demo-1234',
    title: 'General Manager',
    roles: ['mgmt', 'acct'],
    theme: 'dark',
  },
  {
    id: 'user-marco',
    employeeId: 'emp-marco',
    first: 'Marco',
    last: 'Diaz',
    email: 'marco@oasis.test',
    password: 'oasis-demo-1234',
    title: 'Detailer',
    roles: ['crew'],
    theme: null,
  },
]

const problemTypes: Record<string, { status: number; title: string; detail: string }> = {
  UNAUTHENTICATED: { status: 401, title: 'Sign in required', detail: 'Sign in to continue' },
  INVALID_CREDENTIALS: { status: 401, title: 'Sign-in failed', detail: 'Email or password is incorrect' },
  LOGIN_THROTTLED: {
    status: 429,
    title: 'Too many attempts',
    detail: 'Too many sign-in attempts. Try again shortly',
  },
  CSRF_INVALID: { status: 403, title: 'Request blocked', detail: 'The security token is missing or expired' },
  FORBIDDEN: { status: 403, title: 'Not allowed', detail: "You don't have permission to do that" },
  VIEW_AS_FORBIDDEN: {
    status: 403,
    title: 'Not allowed',
    detail: 'Only a Super Admin can view as another role',
  },
  INVITE_INVALID: {
    status: 410,
    title: 'Invite not valid',
    detail: 'This invite link has expired or was already used',
  },
  RESET_INVALID: {
    status: 410,
    title: 'Link not valid',
    detail: 'This reset link has expired or was already used',
  },
  EMAIL_TAKEN: { status: 409, title: 'Email in use', detail: 'That email address is already in use' },
  VALIDATION_FAILED: { status: 422, title: 'Check the form', detail: 'Some fields need attention' },
  NOT_FOUND: { status: 404, title: 'Not found', detail: 'Nothing here' },
}

export interface FakeApiOptions {
  heartbeatMs?: number
  /** Replace the wall clock (tests). */
  now?: () => Date
}

export interface FakeApi {
  server: http.Server
  listen(port?: number): Promise<number>
  close(): Promise<void>
  emit(channel: string, type: string, payload?: Record<string, unknown>): number
  readonly state: { sessions: number; streams: number; lastEventId: number }
}

export function createFakeApi(opts: FakeApiOptions = {}): FakeApi {
  const now = opts.now ?? (() => new Date())
  const heartbeatMs = opts.heartbeatMs ?? 20_000
  let people = seedPeople()
  let sessions = new Map<string, Session>()
  let invites = new Set(['invite-demo-token'])
  let resets = new Set(['reset-demo-token'])
  let failures = new Map<string, number>()
  let eventId = 0
  const log: { id: number; channel: string; type: string; payload: Record<string, unknown>; at: string }[] =
    []
  const streams = new Set<{ res: ServerResponse; channels: Set<string>; timer: NodeJS.Timeout }>()

  const problem = (
    res: ServerResponse,
    code: string,
    extra: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ) => {
    const p = problemTypes[code] ?? { status: 500, title: 'Something went wrong', detail: '' }
    send(
      res,
      p.status,
      {
        type: `urn:oasis:problem:${code.toLowerCase().replace(/_/g, '-')}`,
        title: p.title,
        status: p.status,
        code,
        detail: p.detail,
        requestId: 'fake-req',
        ...extra,
      },
      { 'content-type': 'application/problem+json', ...headers },
    )
  }
  const send = (
    res: ServerResponse,
    status: number,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    res.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-api-version': '1',
      ...headers,
    })
    res.end(body === undefined ? undefined : JSON.stringify(body))
  }
  const readBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const text = Buffer.concat(chunks).toString('utf8')
    if (!text) return {}
    try {
      const v: unknown = JSON.parse(text)
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }

  const csrfOf = (s: Session) => crypto.createHmac('sha256', s.csrfSecret).update(s.token).digest('hex')
  const cookieOf = (req: IncomingMessage, name: string) => {
    for (const part of (req.headers.cookie ?? '').split(';')) {
      const [k, ...v] = part.trim().split('=')
      if (k === name) return v.join('=')
    }
    return null
  }
  const sessionOf = (req: IncomingMessage): Session | null => {
    const t = cookieOf(req, 'oasis_sid')
    const s = t ? sessions.get(t) : undefined
    if (!s || s.expiresAt.getTime() <= now().getTime()) return null
    return s
  }
  const roleOf = (key: RoleKey) => ROLES.find((r) => r.key === key)!
  const isSuper = (p: Person) => p.roles.includes('super')

  const meOf = (s: Session, p: Person) => {
    const viewed = s.viewAsRoleId ? ROLES.find((r) => r.id === s.viewAsRoleId) : undefined
    const effective = viewed ? [viewed] : p.roles.map(roleOf)
    const granted = new Set<string>()
    for (const r of effective) for (const k of DEFAULT_ROLE_GRANTS[r.key]) granted.add(k)
    const limits: Record<string, number | null> = {}
    const permissions: Record<string, { on: boolean; limit?: number | null }> = {}
    for (const k of PERMISSION_KEYS) {
      const on = granted.has(k)
      if (!on) {
        permissions[k] = { on: false }
        continue
      }
      const kind = (LIMITED_PERMISSIONS as Record<string, 'refund' | 'adjust' | 'credit'>)[k]
      if (!kind) {
        permissions[k] = { on: true }
        continue
      }
      let best: number | null | undefined
      for (const r of effective.filter((x) => DEFAULT_ROLE_GRANTS[x.key].includes(k))) {
        const v = r.limits[kind]
        best = best === null || v === null ? null : Math.max(best ?? 0, v)
      }
      limits[kind] = best ?? 2500
      permissions[k] = { on: true, limit: best ?? 2500 }
    }
    const canViewAs = isSuper(p)
    return {
      user: { id: p.id, email: p.email },
      employee: {
        id: p.employeeId,
        first: p.first,
        last: p.last,
        name: `${p.first} ${p.last}`,
        initials: `${p.first[0]}${p.last[0]}`,
        title: p.title,
        phone: '(305) 555-0100',
        email: p.email,
        avatarColor: null,
      },
      roles: effective.map((r) => ({ id: r.id, key: r.key, name: r.name })),
      displayRole: viewed?.name ?? effective[0]!.name,
      isSuperAdmin: canViewAs,
      permissions,
      limits,
      rbacVersion: 1,
      preferences: { theme: p.theme },
      viewAs: {
        active: !!viewed,
        canViewAs,
        roleId: viewed?.id ?? null,
        roleName: viewed?.name ?? null,
        options: canViewAs
          ? ROLES.map((r) => ({ id: r.id, key: r.key, name: r.name, locked: r.locked, limits: r.limits }))
          : [],
      },
      csrfToken: csrfOf(s),
      session: { expiresAt: s.expiresAt.toISOString() },
    }
  }

  const emit = (channel: string, type: string, payload: Record<string, unknown> = {}): number => {
    const e = { id: ++eventId, channel, type, payload, at: now().toISOString() }
    log.push(e)
    if (log.length > 500) log.shift()
    for (const st of streams) if (st.channels.has(channel)) writeEvent(st.res, e)
    return e.id
  }
  const writeEvent = (res: ServerResponse, e: (typeof log)[number]) =>
    res.write(
      `id: ${e.id}\ndata: ${JSON.stringify({ channel: e.channel, type: e.type, payload: e.payload, at: e.at })}\n\n`,
    )

  const serveEvents = (req: IncomingMessage, res: ServerResponse, url: URL) => {
    const s = sessionOf(req)
    if (!s) return problem(res, 'UNAUTHENTICATED')
    const want = (url.searchParams.get('channels') ?? 'ops,payments,messages,settings,notifications').split(
      ',',
    )
    const channels = new Set(
      want.filter((c) => ['ops', 'payments', 'messages', 'settings', 'notifications'].includes(c)),
    )
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-api-version': '1',
    })
    res.write('retry: 3000\n\n')
    const lastRaw = req.headers['last-event-id'] ?? url.searchParams.get('lastEventId')
    const last = lastRaw === undefined || lastRaw === null || lastRaw === '' ? null : Number(lastRaw)
    if (
      last !== null &&
      (!Number.isFinite(last) || last > eventId || (log.length > 0 && last < log[0]!.id - 1))
    ) {
      res.write(
        `id: ${eventId}\nevent: resync\ndata: ${JSON.stringify({ reason: 'cursor_unavailable', latestId: eventId })}\n\n`,
      )
    } else {
      const idLine = last === null ? `id: ${eventId}\n` : ''
      res.write(
        `${idLine}event: ready\ndata: ${JSON.stringify({ channels: [...channels], denied: [], cursor: eventId, heartbeatMs })}\n\n`,
      )
      if (last !== null) for (const e of log) if (e.id > last && channels.has(e.channel)) writeEvent(res, e)
    }
    const st = { res, channels, timer: setInterval(() => res.write(': hb\n\n'), heartbeatMs) }
    streams.add(st)
    req.on('close', () => {
      clearInterval(st.timer)
      streams.delete(st)
    })
  }

  const dropStreams = () => {
    for (const st of [...streams]) {
      clearInterval(st.timer)
      st.res.destroy()
      streams.delete(st)
    }
  }

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://fake')
    const path = url.pathname
    const method = req.method ?? 'GET'

    if (path.startsWith('/__fake/')) {
      if (path === '/__fake/emit') {
        const b = await readBody(req)
        return send(res, 200, {
          id: emit(
            String(b.channel ?? 'ops'),
            String(b.type ?? 'kpi.dirty'),
            (b.payload as Record<string, unknown>) ?? {},
          ),
        })
      }
      if (path === '/__fake/drop-streams') return (dropStreams(), send(res, 204))
      if (path === '/__fake/expire-sessions') return ((sessions = new Map()), send(res, 204))
      if (path === '/__fake/reset') {
        dropStreams()
        people = seedPeople()
        sessions = new Map()
        invites = new Set(['invite-demo-token'])
        resets = new Set(['reset-demo-token'])
        failures = new Map()
        return send(res, 204)
      }
      if (path === '/__fake/state')
        return send(res, 200, { sessions: sessions.size, streams: streams.size, lastEventId: eventId })
      return problem(res, 'NOT_FOUND')
    }

    if (!path.startsWith('/api/v1/')) return problem(res, 'NOT_FOUND')
    const route = path.slice('/api/v1'.length)

    if (method === 'GET' && route === '/events') return serveEvents(req, res, url)
    if (method === 'GET' && route === '/meta/now') {
      const d = now()
      return send(res, 200, {
        now: d.toISOString(),
        tz: 'America/New_York',
        bizDate: d.toISOString().slice(0, 10),
        weekday: d.getUTCDay(),
        minutes: 0,
        dateLabel: '',
      })
    }

    // ---- public auth endpoints -------------------------------------------------------------------------------
    if (method === 'POST' && route === '/auth/login') {
      const b = await readBody(req)
      const email = String(b.email ?? '')
        .trim()
        .toLowerCase()
      const p = people.find((x) => x.email === email)
      const fails = failures.get(email) ?? 0
      if (fails >= 5) return problem(res, 'LOGIN_THROTTLED', {}, { 'retry-after': '3' })
      if (!p || p.password !== b.password) {
        failures.set(email, fails + 1)
        return problem(res, 'INVALID_CREDENTIALS')
      }
      failures.delete(email)
      const token = crypto.randomBytes(32).toString('base64url')
      const s: Session = {
        token,
        personId: p.id,
        csrfSecret: crypto.randomBytes(16).toString('hex'),
        viewAsRoleId: null,
        expiresAt: new Date(now().getTime() + 14 * 86400_000),
      }
      sessions.set(token, s)
      return send(
        res,
        200,
        {
          user: { id: p.id, employeeId: p.employeeId, email: p.email, name: `${p.first} ${p.last}` },
          csrfToken: csrfOf(s),
        },
        {
          'set-cookie': `oasis_sid=${token}; HttpOnly; SameSite=Lax; Path=/; Expires=${s.expiresAt.toUTCString()}`,
        },
      )
    }
    if (method === 'POST' && route === '/auth/invite/accept') {
      const b = await readBody(req)
      const token = String(b.token ?? '')
      const email = String(b.email ?? '')
        .trim()
        .toLowerCase()
      const password = String(b.password ?? '')
      if (!invites.has(token)) return problem(res, 'INVITE_INVALID')
      const errors: { path: string; message: string }[] = []
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        errors.push({ path: 'body.email', message: 'Enter a valid email address' })
      if (password.length < 12 || password.length > 128)
        errors.push({ path: 'body.password', message: 'Password must be 12-128 characters' })
      if (errors.length) return problem(res, 'VALIDATION_FAILED', { errors })
      if (people.some((x) => x.email === email)) return problem(res, 'EMAIL_TAKEN')
      invites.delete(token)
      const p: Person = {
        id: 'user-new',
        employeeId: 'emp-new',
        first: 'Kevin',
        last: 'Tran',
        email,
        password,
        title: 'Detailer',
        roles: ['crew'],
        theme: null,
      }
      people.push(p)
      const tk = crypto.randomBytes(32).toString('base64url')
      const s: Session = {
        token: tk,
        personId: p.id,
        csrfSecret: crypto.randomBytes(16).toString('hex'),
        viewAsRoleId: null,
        expiresAt: new Date(now().getTime() + 14 * 86400_000),
      }
      sessions.set(tk, s)
      return send(
        res,
        200,
        {
          user: { id: p.id, employeeId: p.employeeId, email: p.email, name: `${p.first} ${p.last}` },
          csrfToken: csrfOf(s),
        },
        { 'set-cookie': `oasis_sid=${tk}; HttpOnly; SameSite=Lax; Path=/` },
      )
    }
    if (method === 'POST' && route === '/auth/password/forgot') {
      await readBody(req)
      return send(res, 202, { accepted: true })
    }
    if (method === 'POST' && route === '/auth/password/reset') {
      const b = await readBody(req)
      const token = String(b.token ?? '')
      if (!resets.has(token)) return problem(res, 'RESET_INVALID')
      const password = String(b.password ?? '')
      if (password.length < 12 || password.length > 128)
        return problem(res, 'VALIDATION_FAILED', {
          errors: [{ path: 'body.password', message: 'Password must be 12-128 characters' }],
        })
      resets.delete(token)
      for (const p of people) p.password = password
      sessions = new Map()
      return send(res, 204)
    }

    // ---- everything below needs a session -----------------------------------------------------------------------
    const s = sessionOf(req)
    if (!s) return problem(res, 'UNAUTHENTICATED')
    const p = people.find((x) => x.id === s.personId)!
    const unsafe = method !== 'GET' && method !== 'HEAD'
    if (unsafe && req.headers['x-csrf-token'] !== csrfOf(s)) return problem(res, 'CSRF_INVALID')

    if (method === 'GET' && route === '/auth/csrf') return send(res, 200, { csrfToken: csrfOf(s) })
    if (method === 'POST' && route === '/auth/logout') {
      sessions.delete(s.token)
      return send(res, 204, undefined, {
        'set-cookie': 'oasis_sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
      })
    }
    if (method === 'GET' && route === '/me') return send(res, 200, meOf(s, p))
    if (method === 'PUT' && route === '/me/preferences') {
      const b = await readBody(req)
      if (b.theme !== 'light' && b.theme !== 'dark')
        return problem(res, 'VALIDATION_FAILED', {
          errors: [{ path: 'body.theme', message: 'Theme must be light or dark' }],
        })
      p.theme = b.theme
      return send(res, 200, { theme: p.theme })
    }
    if (method === 'POST' && route === '/me/view-as') {
      if (!isSuper(p)) return problem(res, 'VIEW_AS_FORBIDDEN')
      const b = await readBody(req)
      const id = b.roleId === null || b.roleId === undefined ? null : String(b.roleId)
      if (id !== null && !ROLES.some((r) => r.id === id)) return problem(res, 'NOT_FOUND')
      s.viewAsRoleId = id
      emit('settings', 'rbac.changed', {})
      return send(res, 200, meOf(s, p))
    }
    return problem(res, 'NOT_FOUND')
  }

  const server = http.createServer((req, res) => {
    handler(req, res).catch((e: unknown) => {
      console.error('fake-api error', e)
      if (!res.headersSent)
        send(
          res,
          500,
          { title: 'Something went wrong', status: 500, code: 'INTERNAL' },
          { 'content-type': 'application/problem+json' },
        )
      else res.end()
    })
  })

  return {
    server,
    listen: (port = 0) =>
      new Promise((resolve) => {
        server.listen(port, '127.0.0.1', () => resolve((server.address() as { port: number }).port))
      }),
    close: () =>
      new Promise((resolve) => {
        dropStreams()
        server.close(() => resolve())
        server.closeAllConnections()
      }),
    emit,
    get state() {
      return { sessions: sessions.size, streams: streams.size, lastEventId: eventId }
    },
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.FAKE_API_PORT ?? 4000)
  const api = createFakeApi({ heartbeatMs: Number(process.env.FAKE_HEARTBEAT_MS ?? 20_000) })
  api
    .listen(port)
    .then((p) =>
      console.log(
        `fake-api listening on http://127.0.0.1:${p} (alex@ / rafael@ / marco@oasis.test, password oasis-demo-1234)`,
      ),
    )
}
