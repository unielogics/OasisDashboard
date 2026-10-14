// The fetch wrapper. Same-origin cookies, X-CSRF-Token and an Idempotency-Key on every mutation of a signed-in
// caller, RFC 9457 errors as ApiError, 401 -> sign-in redirect, one CSRF refresh retry, bounded retries for
// network failures that reuse the SAME Idempotency-Key (so a retried money action can never be applied twice).
// In kiosk mode (ADR 0180) it also refuses, without sending them, the routes the kiosk may not call, and names the
// acting employee of a write in X-Oasis-Employee (asking the fallback picker when a write forgot to); away from the shop
// (403 KIOSK_NOT_AT_SHOP) it tells the app and holds every call until the kiosk is back on the shop's network.
import { newIdempotencyKey } from '@/lib/id'
import { serverNow } from '@/lib/clock'
import { AUTH_CODES } from './auth-types'
import { ACTOR_HEADER, KioskCancelled, KioskRefused, kioskRouteMode } from './kiosk'
import type { KioskClientConfig } from './kiosk'
import { ApiError, problemFromResponse } from './problem'

export const API_PREFIX = '/api/v1'

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export type ResponseType = 'json' | 'text' | 'blob' | 'none'

export interface RequestOptions {
  query?: Record<string, string | number | boolean | null | undefined>
  body?: unknown
  /** Reuse the key generated when the user action started. A fresh one is generated per call when omitted. */
  idempotencyKey?: string
  /** If-Match for optimistic concurrency (the entity version). */
  ifMatch?: string | number
  /** Public endpoint (login, invite, forgot, reset): no CSRF, no Idempotency-Key, a 401 is an answer, not a sign-out. */
  public?: boolean
  signal?: AbortSignal
  headers?: Record<string, string>
  responseType?: ResponseType
  /** Retries after a network failure or 502/503/504; default 2 (0 disables). */
  retries?: number
  /** Kiosk mode: the employee doing this write (X-Oasis-Employee). Ignored on reads and public calls. */
  actor?: string
}

export interface CsrfStore {
  get(): string | null
  set(token: string | null): void
}

export function createCsrfStore(): CsrfStore {
  let token: string | null = null
  return { get: () => token, set: (t) => void (token = t) }
}

export interface ApiClientConfig {
  fetch?: typeof fetch
  /** Path prefix; '' (default) is same-origin. */
  origin?: string
  csrf?: CsrfStore
  /** Called once per 401 on a non-public request (the app redirects to /login?next=). */
  onUnauthorized?: (e: ApiError) => void
  newKey?: () => string
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** Backoff base for retries, milliseconds. */
  retryBaseMs?: number
  /** Set while the page is an unlocked kiosk (src/auth/session.tsx); null or absent for a signed-in person. */
  kiosk?: KioskClientConfig | null
  /**
   * An unlocked kiosk answered 403 KIOSK_NOT_AT_SHOP (ADR 0180 A13: it works only on the shop's network): the app covers
   * the board and holds every call (`holdKiosk`) until GET /kiosk/status says it is back. Never for a public call.
   */
  onKioskAway?: (e: ApiError) => void
}

const MUTATING = new Set<Method>(['POST', 'PUT', 'PATCH', 'DELETE'])
const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class ApiClient {
  readonly csrf: CsrfStore
  private cfg: ApiClientConfig
  /** While the kiosk is away from the shop: every non-public call waits here, unsent (no request loops). */
  private held: { wait: Promise<void>; release: () => void } | null = null

  constructor(cfg: ApiClientConfig = {}) {
    this.cfg = cfg
    this.csrf = cfg.csrf ?? createCsrfStore()
  }

  configure(patch: Partial<ApiClientConfig>): void {
    this.cfg = { ...this.cfg, ...patch }
  }

  /** Holds every non-public call, unsent, until `releaseKiosk()` (the kiosk is away from the shop; public calls pass). */
  holdKiosk(): void {
    if (this.held) return
    let release = (): void => {}
    const wait = new Promise<void>((r) => (release = r))
    this.held = { wait, release }
  }

  /** Back at the shop: the calls that waited go out. */
  releaseKiosk(): void {
    const h = this.held
    this.held = null
    h?.release()
  }

  get kioskHeld(): boolean {
    return this.held !== null
  }

  private async waitWhileHeld(signal: AbortSignal | undefined): Promise<void> {
    while (this.held) {
      const h = this.held
      if (signal?.aborted) throw new ApiError({ status: 0, kind: 'aborted' })
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => reject(new ApiError({ status: 0, kind: 'aborted' }))
        signal?.addEventListener('abort', onAbort, { once: true })
        void h.wait.then(() => {
          signal?.removeEventListener('abort', onAbort)
          resolve()
        })
      })
    }
  }

  get<T = unknown>(path: string, opts: Omit<RequestOptions, 'body'> = {}): Promise<T> {
    return this.request<T>('GET', path, opts)
  }
  post<T = unknown>(path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
    return this.request<T>('POST', path, { ...opts, body })
  }
  put<T = unknown>(path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
    return this.request<T>('PUT', path, { ...opts, body })
  }
  patch<T = unknown>(path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
    return this.request<T>('PATCH', path, { ...opts, body })
  }
  delete<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
    return this.request<T>('DELETE', path, opts)
  }

  /** Builds /api/v1<path>?query. Paths are relative to the API prefix; an absolute /api path is used as is. */
  url(path: string, query?: RequestOptions['query']): string {
    const base =
      (this.cfg.origin ?? '') +
      (path.startsWith('/api/') ? path : API_PREFIX + (path.startsWith('/') ? path : '/' + path))
    if (!query) return base
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) qs.append(k, String(v))
    const s = qs.toString()
    return s ? `${base}?${s}` : base
  }

  async request<T = unknown>(method: Method, path: string, opts: RequestOptions = {}): Promise<T> {
    const mutating = MUTATING.has(method)
    if (this.held && !opts.public) await this.waitWhileHeld(opts.signal)
    if (this.cfg.kiosk && !opts.public) opts = await this.kioskGate(method, path, opts, this.cfg.kiosk)
    // One key per action, shared by every retry of this call.
    const key =
      mutating && !opts.public ? (opts.idempotencyKey ?? (this.cfg.newKey ?? newIdempotencyKey)()) : undefined
    const maxRetries = opts.retries ?? (mutating && !opts.public ? 2 : mutating ? 0 : 2)
    let csrfRefreshed = false
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once<T>(method, path, opts, key)
      } catch (e) {
        if (!(e instanceof ApiError)) throw e
        if (
          e.status === 403 &&
          e.code === AUTH_CODES.csrfInvalid &&
          mutating &&
          !opts.public &&
          !csrfRefreshed
        ) {
          csrfRefreshed = true
          await this.refreshCsrf()
          attempt--
          continue
        }
        if (e.status === 401 && !opts.public) this.cfg.onUnauthorized?.(e)
        if (e.status === 403 && e.code === AUTH_CODES.kioskNotAtShop && !opts.public) this.cfg.onKioskAway?.(e)
        if (!e.isRetryable || attempt >= maxRetries) throw e
        await (this.cfg.sleep ?? defaultSleep)(this.backoff(attempt, e))
      }
    }
  }

  /**
   * Kiosk mode: a route the kiosk may not call is refused here (no request, no 403 noise); an `actor` write without its
   * employee asks the fallback picker (cancelling throws KioskCancelled, which command() keeps silent).
   */
  private async kioskGate(
    method: Method,
    path: string,
    opts: RequestOptions,
    k: KioskClientConfig,
  ): Promise<RequestOptions> {
    const mode = (k.modeOf ?? kioskRouteMode)(method, path)
    if (mode === null) throw new KioskRefused(method, path)
    if (mode !== 'actor' || !MUTATING.has(method) || opts.actor) return opts
    const actor = k.resolveActor ? await k.resolveActor({ method, path }) : null
    if (!actor) throw new KioskCancelled()
    return { ...opts, actor }
  }

  /** GET /auth/csrf and remember the token. */
  async refreshCsrf(): Promise<string> {
    const r = await this.once<{ csrfToken: string }>('GET', '/auth/csrf', {}, undefined)
    this.csrf.set(r.csrfToken)
    return r.csrfToken
  }

  private backoff(attempt: number, e: ApiError): number {
    const base = (this.cfg.retryBaseMs ?? 250) * 2 ** attempt
    return e.retryAfterMs !== null && e.retryAfterMs > 0 ? Math.min(e.retryAfterMs, 10_000) : base
  }

  private async once<T>(
    method: Method,
    path: string,
    opts: RequestOptions,
    idempotencyKey: string | undefined,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers }
    let body: BodyInit | undefined
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(opts.body)
    }
    if (MUTATING.has(method) && !opts.public) {
      const t = this.csrf.get()
      if (t) headers['X-CSRF-Token'] = t
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
      if (opts.actor) headers[ACTOR_HEADER] = opts.actor
    }
    if (opts.ifMatch !== undefined) headers['If-Match'] = `"${opts.ifMatch}"`

    const f = this.cfg.fetch ?? globalThis.fetch.bind(globalThis)
    let res: Response
    try {
      res = await f(this.url(path, opts.query), {
        method,
        headers,
        body,
        credentials: 'same-origin',
        signal: opts.signal,
      })
    } catch (cause) {
      if (opts.signal?.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) {
        throw new ApiError({ status: 0, kind: 'aborted', cause })
      }
      throw new ApiError({ status: 0, kind: 'network', cause })
    }
    if (!res.ok) throw await problemFromResponse(res, (this.cfg.now ?? serverNow)())
    if (res.status === 204 || opts.responseType === 'none') return undefined as T
    try {
      if (opts.responseType === 'text') return (await res.text()) as T
      if (opts.responseType === 'blob') return (await res.blob()) as T
      const text = await res.text()
      return (text ? JSON.parse(text) : undefined) as T
    } catch (cause) {
      throw new ApiError({
        status: res.status,
        kind: 'parse',
        title: 'Unexpected response',
        detail: 'The server sent something unreadable.',
        cause,
      })
    }
  }
}

/** Where a 401 goes: the app registers the redirect once (see src/auth/session.tsx). */
export const api = new ApiClient()
