// The SSE client for GET /api/v1/events (backend api-spec section 7).
//
// Frames: default message {channel,type,payload,at} with an `id`; named `ready` {channels,denied,cursor,heartbeatMs};
// named `resync` {reason,latestId} (the cursor can no longer be replayed: refetch everything); `: hb` comment lines
// every heartbeatMs. Browsers never surface comment lines to EventSource, so the watchdog treats ANY frame as proof of
// life and, after 3 heartbeat intervals of silence, closes and reopens the stream (a quiet but healthy stream is
// reopened about once a minute, which costs one request and replays nothing).
//
// Reconnects are driven here, not by the browser: every error closes the source, marks the stream down (which starts
// the poll fallback) and retries with exponential backoff and jitter, resuming with ?lastEventId=<n> (the backend
// accepts it as a query parameter because EventSource cannot set headers by hand).

export interface RealtimeEvent {
  /** realtime_events.id, null when the frame carried none. */
  id: number | null
  channel: string
  type: string
  payload: Record<string, unknown>
  at: string
}

export type StreamStatus = 'idle' | 'connecting' | 'up' | 'down' | 'stopped'

export interface SseMessage {
  data: string
  lastEventId: string
}

/** The slice of EventSource this client uses (so tests can supply a fake). */
export interface EventSourceLike {
  readonly readyState: number
  close(): void
  addEventListener(type: string, listener: (e: SseMessage) => void): void
  onopen: ((e: unknown) => void) | null
  onerror: ((e: unknown) => void) | null
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(h: unknown): void
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(h: unknown): void
}

export const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
}

export interface RealtimeOptions {
  url?: string
  channels?: readonly string[]
  createSource?: (url: string) => EventSourceLike
  timers?: Timers
  /** Uniform [0,1) for backoff jitter. */
  random?: () => number
  onEvent: (e: RealtimeEvent) => void
  /** The cursor is gone (resync frame) or the stream came back after being down: refetch everything. */
  onResync: (reason: 'resync' | 'reconnected') => void
  onStatus?: (s: StreamStatus, prev: StreamStatus) => void
  /** While the stream is down: called every pollMs (the fallback refresh). */
  onPoll?: () => void
  /** The stream failed `authProbeAfter` times in a row without ever opening: check whether the session is gone. */
  onSuspectAuth?: () => void
  pollMs?: number
  backoffBaseMs?: number
  backoffMaxMs?: number
  /** Silence limit before reopening; default 3 x the server heartbeat (60 s until `ready` says otherwise). 0 disables. */
  watchdogMs?: number
  authProbeAfter?: number
}

const DEFAULT_HEARTBEAT_MS = 20_000
const CLOSED = 2

export class RealtimeClient {
  private opts: RealtimeOptions
  private timers: Timers
  private src: EventSourceLike | null = null
  private status_: StreamStatus = 'idle'
  private lastId: number | null = null
  private attempt = 0
  private failuresWithoutOpen = 0
  private reconnectTimer: unknown = null
  private watchdogTimer: unknown = null
  private pollTimer: unknown = null
  private heartbeatMs = DEFAULT_HEARTBEAT_MS
  private wasDown = false
  private generation = 0

  constructor(opts: RealtimeOptions) {
    this.opts = opts
    this.timers = opts.timers ?? realTimers
  }

  get status(): StreamStatus {
    return this.status_
  }
  get lastEventId(): number | null {
    return this.lastId
  }

  start(): void {
    if (this.status_ !== 'idle' && this.status_ !== 'stopped') return
    this.attempt = 0
    this.failuresWithoutOpen = 0
    this.connect()
  }

  stop(): void {
    this.generation++
    this.closeSource()
    this.clearTimers()
    this.setStatus('stopped')
  }

  /** Skip the backoff and reconnect now (tab became visible, browser came back online). */
  reconnectNow(): void {
    if (this.status_ === 'stopped' || this.status_ === 'idle' || this.status_ === 'up') return
    this.timers.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.attempt = 0
    this.connect()
  }

  private url(): string {
    const base = this.opts.url ?? '/api/v1/events'
    const q: string[] = []
    if (this.opts.channels?.length) q.push(`channels=${encodeURIComponent(this.opts.channels.join(','))}`)
    if (this.lastId !== null) q.push(`lastEventId=${this.lastId}`)
    return q.length ? `${base}?${q.join('&')}` : base
  }

  private connect(): void {
    const gen = ++this.generation
    this.closeSource()
    if (this.status_ === 'idle' || this.status_ === 'stopped') this.setStatus('connecting')
    const create =
      this.opts.createSource ??
      ((u: string) => new EventSource(u, { withCredentials: true }) as unknown as EventSourceLike)
    let src: EventSourceLike
    try {
      src = create(this.url())
    } catch {
      this.onFailure(gen)
      return
    }
    this.src = src
    this.armWatchdog(gen)
    src.onopen = () => {
      if (gen !== this.generation) return
      this.armWatchdog(gen)
      this.markUp()
    }
    src.onerror = () => {
      if (gen !== this.generation) return
      this.onFailure(gen)
    }
    src.addEventListener('message', (e) => {
      if (gen !== this.generation) return
      this.touch(e)
      this.markUp()
      const ev = parseEvent(e)
      if (ev) this.opts.onEvent(ev)
    })
    src.addEventListener('ready', (e) => {
      if (gen !== this.generation) return
      this.touch(e)
      const data = safeJson(e.data)
      const hb = data && typeof data.heartbeatMs === 'number' ? data.heartbeatMs : null
      if (hb && hb > 0) this.heartbeatMs = hb
      this.markUp()
      this.armWatchdog(gen)
    })
    src.addEventListener('resync', (e) => {
      if (gen !== this.generation) return
      const data = safeJson(e.data)
      const latest = data && typeof data.latestId === 'number' ? data.latestId : null
      if (latest !== null) this.lastId = latest
      this.touch(e)
      this.markUp()
      this.opts.onResync('resync')
    })
    // A server that sends a visible heartbeat frame keeps the watchdog quiet too.
    src.addEventListener('heartbeat', (e) => {
      if (gen !== this.generation) return
      this.touch(e)
    })
  }

  private touch(e: SseMessage): void {
    const n = Number(e.lastEventId)
    if (e.lastEventId !== '' && Number.isFinite(n)) this.lastId = n
    this.armWatchdog(this.generation)
  }

  private markUp(): void {
    this.failuresWithoutOpen = 0
    this.attempt = 0
    if (this.status_ === 'up') return
    const recovered = this.wasDown
    this.wasDown = false
    this.stopPolling()
    this.setStatus('up')
    if (recovered) this.opts.onResync('reconnected')
  }

  private onFailure(gen: number): void {
    if (gen !== this.generation) return
    this.closeSource()
    this.clearWatchdog()
    this.failuresWithoutOpen++
    if (!this.wasDown) {
      this.wasDown = true
      this.setStatus('down')
      this.startPolling()
    }
    if (this.failuresWithoutOpen === (this.opts.authProbeAfter ?? 2)) this.opts.onSuspectAuth?.()
    const base = this.opts.backoffBaseMs ?? 1000
    const max = this.opts.backoffMaxMs ?? 30_000
    const delay = Math.min(max, base * 2 ** this.attempt)
    const jitter = 0.5 + 0.5 * (this.opts.random ? this.opts.random() : 0.5)
    this.attempt++
    this.timers.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = this.timers.setTimeout(
      () => {
        this.reconnectTimer = null
        if (gen !== this.generation) return
        this.connect()
      },
      Math.round(delay * jitter),
    )
  }

  private armWatchdog(gen: number): void {
    this.clearWatchdog()
    const ms = this.opts.watchdogMs ?? Math.max(3 * this.heartbeatMs, 60_000)
    if (ms <= 0 || this.status_ === 'stopped') return
    this.watchdogTimer = this.timers.setTimeout(() => {
      this.watchdogTimer = null
      if (gen !== this.generation) return
      // Silent for too long: reopen with the cursor. Not an outage, so no poll fallback and no backoff.
      this.connect()
    }, ms)
  }

  private clearWatchdog(): void {
    if (this.watchdogTimer !== null) this.timers.clearTimeout(this.watchdogTimer)
    this.watchdogTimer = null
  }

  private startPolling(): void {
    if (this.pollTimer !== null || !this.opts.onPoll) return
    this.pollTimer = this.timers.setInterval(() => this.opts.onPoll?.(), this.opts.pollMs ?? 20_000)
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) this.timers.clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  private closeSource(): void {
    const s = this.src
    this.src = null
    if (!s) return
    s.onopen = null
    s.onerror = null
    try {
      if (s.readyState !== CLOSED) s.close()
    } catch {
      // already closed
    }
  }

  private clearTimers(): void {
    this.clearWatchdog()
    this.stopPolling()
    this.timers.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private setStatus(s: StreamStatus): void {
    if (s === this.status_) return
    const prev = this.status_
    this.status_ = s
    this.opts.onStatus?.(s, prev)
  }
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(text)
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function parseEvent(e: SseMessage): RealtimeEvent | null {
  const d = safeJson(e.data)
  if (!d || typeof d.channel !== 'string' || typeof d.type !== 'string') return null
  const id = Number(e.lastEventId)
  return {
    id: e.lastEventId !== '' && Number.isFinite(id) ? id : null,
    channel: d.channel,
    type: d.type,
    payload:
      d.payload !== null && typeof d.payload === 'object' && !Array.isArray(d.payload)
        ? (d.payload as Record<string, unknown>)
        : {},
    at: typeof d.at === 'string' ? d.at : '',
  }
}
