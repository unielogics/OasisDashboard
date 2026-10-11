/* eslint-disable @typescript-eslint/no-explicit-any */
// The endpoints of the AI assistant and phone identity screens (ADR 0160): the client file's identity read and Clear PIN
// on the Operations port, and GET/PUT /settings/assistant (the body carries the version; the Idempotency-Key is the
// caller's).
import { describe, expect, it, vi } from 'vitest'
import { ApiClient } from '../http/client'
import { createAssistantApi } from './assistant-api'
import { createLiveOperationsPort } from './operations'

function harness() {
  const calls: Array<{ method: string; url: string; body: unknown; headers: Record<string, string> }> = []
  const fetch = vi.fn(async (url: string, init: any) => {
    calls.push({ method: init.method, url, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers })
    return new Response(JSON.stringify({}), { status: 200 })
  })
  const client = new ApiClient({ fetch: fetch as any, newKey: () => 'auto-key', sleep: async () => {} })
  client.csrf.set('csrf-1')
  return { client, calls }
}
const line = (c: { method: string; url: string }) => `${c.method} ${c.url}`

describe('identity on the Operations port', () => {
  it('reads the identity and clears the PIN of a client, ids encoded, with the caller’s key', async () => {
    const { client, calls } = harness()
    const port = createLiveOperationsPort(client)
    await port.identity('c/1')
    await port.clearPin('c/1', { idempotencyKey: 'k-pin' })
    expect(calls.map(line)).toEqual([
      'GET /api/v1/customers/c%2F1/identity',
      'POST /api/v1/customers/c%2F1/identity/pin/clear',
    ])
    expect(calls[1]!.body).toBeUndefined()
    expect(calls[1]!.headers['Idempotency-Key']).toBe('k-pin')
  })
})

describe('Settings → Oasis AI assistant', () => {
  it('GET and PUT /settings/assistant', async () => {
    const { client, calls } = harness()
    const api = createAssistantApi(client)
    await api.get()
    await api.save({ enabled: true, version: 4 }, { idempotencyKey: 'k-a' })
    expect(calls.map(line)).toEqual(['GET /api/v1/settings/assistant', 'PUT /api/v1/settings/assistant'])
    expect(calls[1]!.body).toEqual({ enabled: true, version: 4 })
    expect(calls[1]!.headers['Idempotency-Key']).toBe('k-a')
  })
})
