import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryStore } from './query-store'

const key = ['ops', 'board'] as const
let qc: QueryClient
let frames: Array<() => void>
let store: QueryStore
let clock = 0
const runFrame = () => {
  const f = frames
  frames = []
  f.forEach((fn) => fn())
}
const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  frames = []
  clock = Date.now()
  store = new QueryStore(qc, { schedule: (fn) => frames.push(fn), now: () => clock })
})

describe('QueryStore.read', () => {
  it('returns undefined first, starts the fetch once, then serves the cached value synchronously', async () => {
    const fetcher = vi.fn(async () => ({ n: 1 }))
    expect(store.read(key, fetcher)).toBeUndefined()
    expect(store.read(key, fetcher)).toBeUndefined() // the in-flight request is shared
    expect(fetcher).toHaveBeenCalledTimes(1)
    await settle()
    expect(store.read(key, fetcher)).toEqual({ n: 1 })
    expect(store.status(key)).toBe('success')
    expect(fetcher).toHaveBeenCalledTimes(1) // fresh: renders every second do not refetch
  })

  it('refetches once the data is stale or has been invalidated, keeping the old value meanwhile', async () => {
    let n = 0
    const fetcher = vi.fn(async () => ({ n: ++n }))
    store.read(key, fetcher)
    await settle()
    await qc.invalidateQueries({ queryKey: key, refetchType: 'none' })
    expect(store.read(key, fetcher)).toEqual({ n: 1 })
    await settle()
    expect(store.read(key, fetcher)).toEqual({ n: 2 })
    expect(store.read(key, fetcher, { staleTimeMs: 0 })).toEqual({ n: 2 })
    await settle()
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('reports pending, error with the cause, and does not hammer a failing endpoint on every render', async () => {
    const boom = new Error('offline')
    const fetcher = vi.fn(async () => {
      throw boom
    })
    expect(store.status(key)).toBe('pending')
    store.read(key, fetcher)
    await settle()
    expect(store.status(key)).toBe('error')
    expect(store.error(key)).toBe(boom)
    for (let i = 0; i < 5; i++) expect(store.read(key, fetcher)).toBeUndefined()
    await settle()
    expect(fetcher).toHaveBeenCalledTimes(1)
    // once the back-off has passed the next read retries
    clock += 9_000
    store.read(key, fetcher)
    await settle()
    expect(fetcher).toHaveBeenCalledTimes(1)
    clock += 1_500
    store.read(key, fetcher)
    await settle()
    expect(fetcher).toHaveBeenCalledTimes(2)
    // and so does an explicit retry
    await store.refetch(key, fetcher)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('keeps a failed refetch from hiding the last good data', async () => {
    let fail = false
    const fetcher = async () => {
      if (fail) throw new Error('x')
      return 'good'
    }
    store.read(key, fetcher)
    await settle()
    fail = true
    await store.refetch(key, fetcher)
    expect(store.read(key, fetcher)).toBe('good')
  })
})

describe('QueryStore.subscribe', () => {
  it('batches cache changes into one notification per frame', async () => {
    const l = vi.fn()
    store.subscribe(l)
    qc.setQueryData(['a'], 1)
    qc.setQueryData(['b'], 2)
    qc.setQueryData(['a'], 3)
    await settle()
    expect(l).not.toHaveBeenCalled()
    expect(frames).toHaveLength(1)
    runFrame()
    expect(l).toHaveBeenCalledTimes(1)
    qc.setQueryData(['c'], 1)
    await settle()
    runFrame()
    expect(l).toHaveBeenCalledTimes(2)
  })

  it('stops listening to the cache when the last subscriber leaves, and dispose() silences everything', async () => {
    const l = vi.fn()
    const off = store.subscribe(l)
    off()
    qc.setQueryData(['a'], 1)
    expect(frames).toHaveLength(0)
    store.subscribe(l)
    qc.setQueryData(['a'], 2)
    store.dispose()
    runFrame()
    expect(l).not.toHaveBeenCalled()
    qc.setQueryData(['a'], 3)
    expect(frames).toHaveLength(0)
  })

  it('a fetch completing notifies the screen so renderVals runs again with the data', async () => {
    const l = vi.fn()
    store.subscribe(l)
    store.read(key, async () => 'data')
    await settle()
    runFrame()
    expect(l).toHaveBeenCalled()
    expect(store.read(key, async () => 'other')).toBe('data')
  })
})
