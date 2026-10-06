/* eslint-disable @typescript-eslint/no-explicit-any */
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { Action, command } from './command'
import { ApiError } from './http/problem'
import type { ToastSpec } from './toast'

const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
const deferred = <T>() => {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}
const board = ['board'] as const
const apiErr = (
  status: number,
  code: string,
  title: string,
  detail = '',
  meta: Record<string, unknown> = {},
) => new ApiError({ status, code, title, detail, meta })

describe('command(): optimistic patches', () => {
  it('applies the patch before the request settles and keeps server truth to the refetch on success', async () => {
    const client = qc()
    client.setQueryData(board, { a: { done: false } })
    const d = deferred<{ ok: true }>()
    const p = command({
      key: board,
      queryClient: client,
      request: () => d.promise,
      optimistic: { queryKey: board, apply: (cur: any) => ({ ...cur, a: { done: true } }) },
    })
    await vi.waitFor(() => expect(client.getQueryData(board)).toEqual({ a: { done: true } }))
    d.resolve({ ok: true })
    const r = await p
    expect(r).toEqual({ ok: true, data: { ok: true } })
    expect(client.getQueryState(board)!.isInvalidated).toBe(true)
  })

  it('rolls back on failure and toasts the server message', async () => {
    const client = qc()
    client.setQueryData(board, { a: { done: false } })
    const toast = vi.fn()
    const r = await command({
      key: board,
      queryClient: client,
      toast,
      request: async () => {
        throw apiErr(409, 'STALE_STATE', 'Already advanced', 'Another device moved this job')
      },
      optimistic: { queryKey: board, apply: (cur: any) => ({ ...cur, a: { done: true } }) },
    })
    expect(r.ok).toBe(false)
    expect(client.getQueryData(board)).toEqual({ a: { done: false } })
    expect(toast).toHaveBeenCalledWith({ title: 'Already advanced', desc: 'Another device moved this job' })
  })

  it('rolls several patches back in reverse order and skips keys with nothing cached', async () => {
    const client = qc()
    client.setQueryData(['a'], 1)
    client.setQueryData(['b'], 10)
    const seen: string[] = []
    await command({
      key: ['a'],
      queryClient: client,
      toast: () => {},
      request: async () => {
        seen.push(
          JSON.stringify([
            client.getQueryData(['a']),
            client.getQueryData(['b']),
            client.getQueryData(['c']),
          ]),
        )
        throw apiErr(500, 'INTERNAL', 'Something went wrong')
      },
      optimistic: [
        { queryKey: ['a'], apply: (c: any) => c + 1 },
        { queryKey: ['b'], apply: (c: any) => c * 2 },
        { queryKey: ['c'], apply: () => 99 },
      ],
    })
    expect(seen).toEqual(['[2,20,null]'])
    expect([client.getQueryData(['a']), client.getQueryData(['b']), client.getQueryData(['c'])]).toEqual([
      1,
      10,
      undefined,
    ])
  })

  it('cancels in-flight fetches of the patched key so a stale response cannot overwrite the patch', async () => {
    const client = qc()
    client.setQueryData(board, 1)
    const spy = vi.spyOn(client, 'cancelQueries')
    await command({
      key: board,
      queryClient: client,
      request: async () => 1,
      optimistic: { queryKey: board, apply: (c: any) => c + 1 },
    })
    expect(spy).toHaveBeenCalledWith({ queryKey: board })
  })
})

describe('command(): idempotency', () => {
  it('passes a generated key to request(), a different one per action', async () => {
    const client = qc()
    const keys: string[] = []
    const req = async (k: string) => void keys.push(k)
    await command({ key: board, queryClient: client, request: req })
    await command({ key: board, queryClient: client, request: req })
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
    for (const k of keys) expect(k).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('a double submit of the same action (same key) joins the request in flight', async () => {
    const client = qc()
    const d = deferred<string>()
    const request = vi.fn(() => d.promise)
    const a = command({ key: board, queryClient: client, request, idempotencyKey: 'sheet-1' })
    const b = command({ key: board, queryClient: client, request, idempotencyKey: 'sheet-1' })
    d.resolve('paid')
    expect(await a).toEqual({ ok: true, data: 'paid' })
    expect(await b).toEqual({ ok: true, data: 'paid' })
    expect(request).toHaveBeenCalledTimes(1)
    // once settled, the key can be used again by a new submit
    await command({ key: board, queryClient: client, request, idempotencyKey: 'sheet-1' })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('an Action keeps its key across failed submits (retry of THAT action) until renewed', async () => {
    const client = qc()
    const action = new Action()
    const keys: string[] = []
    const fail = async (k: string) => {
      keys.push(k)
      throw apiErr(0, 'NETWORK_ERROR', 'x')
    }
    await command({
      key: board,
      queryClient: client,
      request: fail,
      idempotencyKey: action.key,
      toast: () => {},
    })
    await command({
      key: board,
      queryClient: client,
      request: fail,
      idempotencyKey: action.key,
      toast: () => {},
    })
    expect(keys[0]).toBe(keys[1])
    const before = action.key
    expect(action.renew()).not.toBe(before)
    expect(action.key).not.toBe(before)
  })
})

describe('command(): failure mapping', () => {
  const run = async (e: unknown, extra: Partial<Parameters<typeof command>[0]> = {}) => {
    const client = qc()
    const toasts: ToastSpec[] = []
    const refetch = vi.spyOn(client, 'invalidateQueries')
    const r = await command({
      key: board,
      queryClient: client,
      request: async () => {
        throw e
      },
      toast: (t) => toasts.push(t),
      invalidate: [['other']],
      ...extra,
    })
    return { r, toasts, refetch }
  }

  it('409 and 412 refetch the entity and show the server message', async () => {
    for (const [status, code] of [
      [409, 'BAY_BUSY'],
      [412, 'VERSION_CONFLICT'],
    ] as const) {
      const { r, toasts, refetch } = await run(
        apiErr(status, code, 'Bay busy', 'Bay 2 is in use', { currentVersion: 5 }),
      )
      expect(r.ok).toBe(false)
      expect(toasts).toEqual([{ title: 'Bay busy', desc: 'Bay 2 is in use' }])
      expect(refetch).toHaveBeenCalledWith({ queryKey: board })
      expect(refetch).toHaveBeenCalledWith({ queryKey: ['other'] })
    }
  })

  it('403 shows "Your role can’t …" from the named permission or the command’s denyLabel', async () => {
    let x = await run(apiErr(403, 'FORBIDDEN', 'Not allowed', '', { required: 'pay.refund' }))
    expect(x.toasts).toEqual([{ title: 'Your role can’t issue refunds' }])
    x = await run(apiErr(403, 'FORBIDDEN', 'Not allowed'), { denyLabel: 'approve $12.00' })
    expect(x.toasts).toEqual([{ title: 'Your role can’t approve $12.00' }])
    expect(x.refetch).not.toHaveBeenCalled()
  })

  it('401 shows no toast (the sign-in redirect owns it); aborts are silent', async () => {
    expect((await run(apiErr(401, 'UNAUTHENTICATED', 'Sign in required'))).toasts).toEqual([])
    expect((await run(new ApiError({ status: 0, kind: 'aborted' }))).toasts).toEqual([])
  })

  it('network and unknown errors toast plainly; onFail can replace the toast, returning nothing falls back', async () => {
    expect((await run(new ApiError({ status: 0, kind: 'network' }))).toasts).toEqual([
      { title: 'Connection lost', desc: 'Check your connection and try again.' },
    ])
    expect((await run(new Error('boom'))).toasts[0]!.title).toBe('Connection lost')
    const custom = await run(apiErr(422, 'OVER_LIMIT', 'Over limit'), {
      onFail: (e) => ({ title: `Cap hit: ${e.title}` }),
    })
    expect(custom.toasts).toEqual([{ title: 'Cap hit: Over limit' }])
    const fallback = await run(apiErr(422, 'OVER_LIMIT', 'Over limit', 'Max $50'), {
      onFail: () => undefined,
    })
    expect(fallback.toasts).toEqual([{ title: 'Over limit', desc: 'Max $50' }])
  })

  it('onOk may return a toast; the result carries the data', async () => {
    const client = qc()
    const toasts: ToastSpec[] = []
    const r = await command({
      key: board,
      queryClient: client,
      toast: (t) => toasts.push(t),
      request: async () => ({ id: 7 }),
      onOk: (d) => ({ title: `Saved ${d.id}` }),
    })
    expect(r).toEqual({ ok: true, data: { id: 7 } })
    expect(toasts).toEqual([{ title: 'Saved 7' }])
  })
})
