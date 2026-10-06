// RFC 9457 problem+json parsing. The backend sends {type, title, status, code, detail, errors?, requestId, meta?};
// for guard failures `title` and `detail` are exactly the design's toast strings, so they are shown unchanged.

export interface ProblemFieldError {
  path: string
  message: string
}

export interface ProblemBody {
  type?: string
  title?: string
  status?: number
  code?: string
  detail?: string
  errors?: ProblemFieldError[]
  requestId?: string
  meta?: Record<string, unknown>
}

export type ApiErrorKind = 'http' | 'network' | 'aborted' | 'parse'

export interface ApiErrorInit extends ProblemBody {
  status: number
  kind?: ApiErrorKind
  retryAfterMs?: number | null
  cause?: unknown
}

export class ApiError extends Error {
  readonly status: number
  readonly kind: ApiErrorKind
  readonly code: string
  readonly title: string
  readonly detail: string
  readonly errors: ProblemFieldError[]
  readonly requestId: string | undefined
  readonly meta: Record<string, unknown>
  /** From Retry-After (429 / login throttle), milliseconds. */
  readonly retryAfterMs: number | null

  constructor(init: ApiErrorInit) {
    const title = init.title || defaultTitle(init.status, init.kind)
    super(
      init.detail ? `${title}: ${init.detail}` : title,
      init.cause === undefined ? undefined : { cause: init.cause },
    )
    this.name = 'ApiError'
    this.status = init.status
    this.kind = init.kind ?? 'http'
    this.code = init.code ?? defaultCode(init.status, init.kind)
    this.title = title
    this.detail = init.detail ?? ''
    this.errors = init.errors ?? []
    this.requestId = init.requestId
    this.meta = init.meta ?? {}
    this.retryAfterMs = init.retryAfterMs ?? null
  }

  get isUnauthenticated(): boolean {
    return this.status === 401
  }
  get isForbidden(): boolean {
    return this.status === 403
  }
  /** 409 state conflict and 412 version mismatch: the entity changed under the user, refetch it. */
  get isConflict(): boolean {
    return this.status === 409 || this.status === 412
  }
  get isValidation(): boolean {
    return this.status === 422
  }
  get isNetwork(): boolean {
    return this.kind === 'network'
  }
  get isRetryable(): boolean {
    return (
      this.kind === 'network' ||
      this.status === 502 ||
      this.status === 503 ||
      this.status === 504 ||
      this.code === 'IDEMPOTENCY_IN_FLIGHT' ||
      this.code === 'CONCURRENT_UPDATE'
    )
  }

  /** Message for the field at `path` (e.g. "body.email"), if the server named one. */
  fieldError(path: string): string | undefined {
    return this.errors.find((e) => e.path === path || e.path.endsWith('.' + path))?.message
  }
}

function defaultTitle(status: number, kind?: ApiErrorKind): string {
  if (kind === 'network') return 'Can’t reach the server'
  if (kind === 'aborted') return 'Request canceled'
  if (status === 401) return 'Sign in required'
  if (status === 403) return 'Not allowed'
  if (status === 404) return 'Not found'
  if (status === 429) return 'Too many requests'
  if (status >= 500) return 'Something went wrong'
  return 'Request failed'
}

function defaultCode(status: number, kind?: ApiErrorKind): string {
  if (kind === 'network') return 'NETWORK_ERROR'
  if (kind === 'aborted') return 'ABORTED'
  if (kind === 'parse') return 'BAD_RESPONSE'
  if (status === 401) return 'UNAUTHENTICATED'
  if (status === 403) return 'FORBIDDEN'
  if (status === 404) return 'NOT_FOUND'
  if (status === 429) return 'RATE_LIMITED'
  return status >= 500 ? 'INTERNAL' : 'HTTP_ERROR'
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Retry-After as milliseconds: delta-seconds or an HTTP date (needs `nowMs` for the date form). */
export function parseRetryAfter(value: string | null | undefined, nowMs?: number): number | null {
  if (!value) return null
  const s = value.trim()
  if (/^\d+$/.test(s)) return Number(s) * 1000
  if (nowMs === undefined) return null
  const t = Date.parse(s)
  return Number.isFinite(t) ? Math.max(0, t - nowMs) : null
}

function sanitizeErrors(v: unknown): ProblemFieldError[] {
  if (!Array.isArray(v)) return []
  const out: ProblemFieldError[] = []
  for (const e of v) {
    if (isRecord(e) && typeof e.message === 'string')
      out.push({ path: typeof e.path === 'string' ? e.path : '', message: e.message })
  }
  return out
}

/** Builds an ApiError from a failed Response. Never throws: a non-JSON or malformed body falls back to the status. */
export async function problemFromResponse(res: Response, nowMs?: number): Promise<ApiError> {
  let body: ProblemBody = {}
  try {
    const text = await res.text()
    if (text) {
      const json: unknown = JSON.parse(text)
      if (isRecord(json)) {
        body = {
          type: typeof json.type === 'string' ? json.type : undefined,
          title: typeof json.title === 'string' ? json.title : undefined,
          status: typeof json.status === 'number' ? json.status : undefined,
          code: typeof json.code === 'string' ? json.code : undefined,
          detail: typeof json.detail === 'string' ? json.detail : undefined,
          errors: sanitizeErrors(json.errors),
          requestId: typeof json.requestId === 'string' ? json.requestId : undefined,
          meta: isRecord(json.meta) ? json.meta : undefined,
        }
      }
    }
  } catch {
    // not JSON: the status line is all we have
  }
  return new ApiError({
    ...body,
    status: res.status,
    requestId: body.requestId ?? res.headers.get('x-request-id') ?? undefined,
    retryAfterMs: parseRetryAfter(res.headers.get('retry-after'), nowMs),
  })
}
