// The fetch wrapper. Same-origin cookies, X-CSRF-Token and an Idempotency-Key on every mutation of a signed-in
// caller, RFC 9457 errors as ApiError, 401 -> sign-in redirect, one CSRF refresh retry, bounded retries for
// network failures that reuse the SAME Idempotency-Key (so a retried money action can never be applied twice).
import { newIdempotencyKey } from '@/lib/id'
import { serverNow } from '@/lib/clock'
import { AUTH_CODES } from './auth-types'
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
}

const MUTATING = new Set<Method>(['POST', 'PUT', 'PATCH', 'DELETE'])
const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class ApiClient {
  readonly csrf: CsrfStore
  private cfg: ApiClientConfig

  constructor(cfg: ApiClientConfig = {}) {
    this.cfg = cfg
    this.csrf = cfg.csrf ?? createCsrfStore()
  }

  configure(patch: Partial<ApiClientConfig>): void {
    this.cfg = { ...this.cfg, ...patch }
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
        if (!e.isRetryable || attempt >= maxRetries) throw e
        await (this.cfg.sleep ?? defaultSleep)(this.backoff(attempt, e))
      }
    }
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
