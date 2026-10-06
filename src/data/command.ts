// command(): the one wrapper for every mutation (dashboard design 3.4).
//   - one Idempotency-Key per user action, generated here (or by a sheet that owns an Action) and passed to request();
//     client-level retries reuse it, so a retried money action cannot be applied twice
//   - optimistic patches of the query cache, rolled back when the request fails
//   - success: onOk toast, then the touched queries are refetched so server truth replaces the patch
//   - failure: rollback; 401 is left to the sign-in redirect; 403 -> "Your role can’t …"; 409/412 -> refetch the
//     entity and show the server's message; everything else -> the server's title and detail
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { newIdempotencyKey } from '@/lib/id'
import { ApiError } from './http/problem'
import { toastForError, toasts } from './toast'
import type { ToastSpec } from './toast'

export interface CachePatch<T = unknown> {
  queryKey: QueryKey
  /** Pure: returns the next cache value from the current one. Skipped while nothing is cached for the key. */
  apply: (current: T) => T
}

export interface CommandSpec<TData> {
  /** Primary query key: refetched on success and on 409/412. */
  key: QueryKey
  request: (idempotencyKey: string) => Promise<TData>
  /** Optimistic edits applied before the request is sent and undone on failure. */
  optimistic?: CachePatch | CachePatch[]
  /** Further queries to refetch after the command settles. */
  invalidate?: QueryKey[]
  onOk?: (data: TData) => ToastSpec | void
  /** Override the failure toast; return nothing to fall back to the default mapping. */
  onFail?: (e: ApiError) => ToastSpec | void
  /** Completes "Your role can’t …" when a 403 does not name the permission. */
  denyLabel?: string
  /** Reuse the key of a sheet's Action; generated when omitted. */
  idempotencyKey?: string
  queryClient: QueryClient
  /** Where toasts go (default: the shared toast bus the screens subscribe to). */
  toast?: (t: ToastSpec) => void
}

export type CommandResult<TData> = { ok: true; data: TData } | { ok: false; error: ApiError }

const inFlight = new Map<string, Promise<CommandResult<never>>>()

const asApiError = (e: unknown): ApiError =>
  e instanceof ApiError
    ? e
    : new ApiError({
        status: 0,
        kind: 'network',
        title: 'Something went wrong',
        detail: e instanceof Error ? e.message : String(e),
        cause: e,
      })

export async function command<TData>(spec: CommandSpec<TData>): Promise<CommandResult<TData>> {
  const key = spec.idempotencyKey ?? newIdempotencyKey()
  // A double click on the same action (same key) joins the request already in flight.
  const running = inFlight.get(key)
  if (running) return running as Promise<CommandResult<TData>>
  const p = run(spec, key)
  inFlight.set(key, p as Promise<CommandResult<never>>)
  try {
    return await p
  } finally {
    inFlight.delete(key)
  }
}

async function run<TData>(spec: CommandSpec<TData>, key: string): Promise<CommandResult<TData>> {
  const { queryClient: qc } = spec
  const emit = spec.toast ?? ((t: ToastSpec) => toasts.emit(t))
  const patches =
    spec.optimistic === undefined ? [] : Array.isArray(spec.optimistic) ? spec.optimistic : [spec.optimistic]
  const undo: Array<() => void> = []

  for (const p of patches) {
    await qc.cancelQueries({ queryKey: p.queryKey })
    const before = qc.getQueryData(p.queryKey)
    if (before === undefined) continue
    qc.setQueryData(p.queryKey, p.apply(before))
    undo.push(() => qc.setQueryData(p.queryKey, before))
  }

  const refetch = (): Promise<unknown> =>
    Promise.all([spec.key, ...(spec.invalidate ?? [])].map((queryKey) => qc.invalidateQueries({ queryKey })))

  try {
    const data = await spec.request(key)
    const t = spec.onOk?.(data)
    if (t) emit(t)
    void refetch()
    return { ok: true, data }
  } catch (e) {
    for (const u of undo.reverse()) u()
    const error = asApiError(e)
    if (error.isConflict) void refetch()
    if (error.isUnauthenticated || error.kind === 'aborted') return { ok: false, error }
    emit(spec.onFail?.(error) ?? toastForError(error, { denyLabel: spec.denyLabel }))
    return { ok: false, error }
  }
}

/**
 * A user action that may be submitted more than once (a sheet whose Confirm button can be pressed again after a
 * failure). The key is created when the action starts and stays the same until it succeeds.
 */
export class Action {
  private k = newIdempotencyKey()
  get key(): string {
    return this.k
  }
  /** Call after the action succeeded or the sheet closed, so the next submit is a new action. */
  renew(): string {
    return (this.k = newIdempotencyKey())
  }
}
