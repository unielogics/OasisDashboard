/* eslint-disable @typescript-eslint/no-explicit-any */
// The endpoints of Settings → Oasis AI's tabs (ADR 0174, backend api-spec 15.6c–f): knowledge and PDFs, the practice chat,
// corrections and the review of real chats; ids encoded, the caller's Idempotency-Key; and the PDF upload to the presigned
// POST with XMLHttpRequest (progress, the store's refusal in words, a network failure, an abort), against a fake XHR.
import { describe, expect, it, vi } from 'vitest'
import { ApiClient } from '../http/client'
import { UploadError, createAssistantKnowledgeApi, xhrUpload } from './assistant-knowledge-api'
import type { XhrLike } from './assistant-knowledge-api'
import { createAssistantPracticeApi, createAssistantReviewApi } from './assistant-practice-api'

function harness(body: unknown = {}) {
  const calls: Array<{ method: string; url: string; body: unknown; headers: Record<string, string> }> = []
  const fetch = vi.fn(async (url: string, init: any) => {
    calls.push({ method: init.method, url, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers })
    return new Response(JSON.stringify(body), { status: 200 })
  })
  const client = new ApiClient({ fetch: fetch as any, newKey: () => 'auto-key', sleep: async () => {} })
  client.csrf.set('csrf-1')
  return { client, calls }
}
const line = (c: { method: string; url: string }) => `${c.method} ${c.url}`

/** A fake XMLHttpRequest: records what was sent, lets the test drive progress and the end. */
class FakeXhr implements XhrLike {
  static last: FakeXhr | null = null
  method = ''
  url = ''
  sent: FormData | null = null
  aborted = false
  status = 0
  responseText = ''
  upload: XhrLike['upload'] = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  constructor() {
    FakeXhr.last = this
  }
  open(method: string, url: string) {
    this.method = method
    this.url = url
  }
  send(body: FormData) {
    this.sent = body
  }
  abort() {
    this.aborted = true
    this.onabort?.()
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ loaded, total, lengthComputable: true })
  }
  finish(status: number, text = '') {
    this.status = status
    this.responseText = text
    this.onload?.()
  }
}

const slot = {
  key: 'kb/loc/doc.pdf',
  url: 'https://bucket.example/upload',
  fields: { key: 'kb/loc/doc.pdf', 'Content-Type': 'application/pdf', Policy: 'p', 'X-Amz-Signature': 's' },
  expiresAt: '2026-10-13T12:05:00Z',
}

describe('knowledge', () => {
  it('entries and PDFs: every route, ids encoded, the caller’s key', async () => {
    const { client, calls } = harness()
    const api = createAssistantKnowledgeApi(client)
    await api.get()
    await api.createNote({ title: 'Waiting area', body: 'Wifi and coffee.', active: true }, { idempotencyKey: 'k1' })
    await api.update('e/1', { active: false, version: 3 }, { idempotencyKey: 'k2' })
    await api.remove('e/1', { idempotencyKey: 'k3' })
    await api.presign({ filename: 'guide.pdf', bytes: 1200, sha256: 'a'.repeat(64) }, { idempotencyKey: 'k4' })
    await api.complete('d/1', { idempotencyKey: 'k5' })
    await api.retry('d/1')
    await api.removeDocument('d/1')
    await api.file('d/1')
    expect(calls.map(line)).toEqual([
      'GET /api/v1/assistant/knowledge',
      'POST /api/v1/assistant/knowledge',
      'PUT /api/v1/assistant/knowledge/e%2F1',
      'DELETE /api/v1/assistant/knowledge/e%2F1',
      'POST /api/v1/assistant/knowledge/documents/presign',
      'POST /api/v1/assistant/knowledge/documents/d%2F1/complete',
      'POST /api/v1/assistant/knowledge/documents/d%2F1/extract',
      'DELETE /api/v1/assistant/knowledge/documents/d%2F1',
      'GET /api/v1/assistant/knowledge/documents/d%2F1/file',
    ])
    expect(calls[2]!.body).toEqual({ active: false, version: 3 })
    expect(calls[4]!.body).toEqual({ filename: 'guide.pdf', bytes: 1200, sha256: 'a'.repeat(64) })
    expect(calls.slice(1, 6).map((c) => c.headers['Idempotency-Key'])).toEqual(['k1', 'k2', 'k3', 'k4', 'k5'])
  })

  it('uploads the signed fields first and the file last, with progress in whole percent', async () => {
    const seen: number[] = []
    const done = xhrUpload(slot, new Blob(['%PDF-1.4'], { type: 'application/pdf' }), { onProgress: (p) => seen.push(p) }, () => new FakeXhr())
    const x = FakeXhr.last!
    expect([x.method, x.url]).toEqual(['POST', 'https://bucket.example/upload'])
    expect([...x.sent!.keys()]).toEqual(['key', 'Content-Type', 'Policy', 'X-Amz-Signature', 'file'])
    x.progress(450, 1000)
    x.progress(455, 1000)
    x.progress(1000, 1000)
    x.finish(204)
    await done
    expect(seen).toEqual([0, 45, 100])
  })

  it('a refusal of the store in its words, a network failure and an abort in plain words', async () => {
    const a = xhrUpload(slot, new Blob(['x']), {}, () => new FakeXhr())
    FakeXhr.last!.finish(400, JSON.stringify({ error: { code: 'TYPE_MISMATCH', message: 'The file is not the announced type.' } }))
    await expect(a).rejects.toMatchObject({ status: 400, code: 'TYPE_MISMATCH', message: 'The file is not the announced type.' })
    const b = xhrUpload(slot, new Blob(['x']), {}, () => new FakeXhr())
    FakeXhr.last!.finish(403, '<Error><Code>AccessDenied</Code></Error>')
    await expect(b).rejects.toMatchObject({ status: 403, code: 'UPLOAD_FAILED', message: 'The PDF could not be uploaded. Try again.' })
    const c = xhrUpload(slot, new Blob(['x']), {}, () => new FakeXhr())
    FakeXhr.last!.onerror?.()
    await expect(c).rejects.toBeInstanceOf(UploadError)
    const ctl = new AbortController()
    const d = xhrUpload(slot, new Blob(['x']), { signal: ctl.signal }, () => new FakeXhr())
    ctl.abort()
    await expect(d).rejects.toMatchObject({ code: 'ABORTED' })
    expect(FakeXhr.last!.aborted).toBe(true)
  })

  it('the API’s upload goes through the XHR factory it was given', async () => {
    const { client } = harness()
    const api = createAssistantKnowledgeApi(client, () => new FakeXhr())
    const p = api.upload(slot, new Blob(['%PDF']))
    FakeXhr.last!.finish(201)
    await p
  })
})

describe('practice, corrections and review (contracts until wave K2c)', () => {
  it('practice sessions and turns', async () => {
    const { client, calls } = harness({ items: [{ id: 'c1', fullName: 'Priya Nair', phone: '+12015550142', email: null }] })
    const api = createAssistantPracticeApi(client)
    await api.sessions()
    await api.createSession({ persona: 'client', customerId: 'c1', verified: true, language: 'en' }, { idempotencyKey: 'k1' })
    await api.session('s/1')
    await api.sendTurn('s/1', 'Do you have wifi?', { idempotencyKey: 'k2' })
    await api.rerun('t/1', { idempotencyKey: 'k3' })
    await api.deleteSession('s/1')
    const hits = await api.findClients('Priya')
    expect(calls.map(line)).toEqual([
      'GET /api/v1/assistant/practice/sessions',
      'POST /api/v1/assistant/practice/sessions',
      'GET /api/v1/assistant/practice/sessions/s%2F1',
      'POST /api/v1/assistant/practice/sessions/s%2F1/turns',
      'POST /api/v1/assistant/practice/turns/t%2F1/rerun',
      'DELETE /api/v1/assistant/practice/sessions/s%2F1',
      'GET /api/v1/customers?q=Priya&limit=8',
    ])
    expect(calls[3]!.body).toEqual({ text: 'Do you have wifi?' })
    expect(calls[3]!.headers['Idempotency-Key']).toBe('k2')
    expect(hits).toEqual([{ id: 'c1', fullName: 'Priya Nair', phone: '+12015550142' }])
  })

  it('corrections and the review of real chats', async () => {
    const { client, calls } = harness()
    const api = createAssistantReviewApi(client)
    await api.conversations({ days: 30, filter: 'handed_off', limit: 30, cursor: 'c2' })
    await api.conversation('v/1')
    await api.createCorrection(
      { clientText: 'Do you have wifi?', rightAnswer: 'Yes, in the lounge.', source: 'live', assistantTurnId: 't1', active: true },
      { idempotencyKey: 'k1' },
    )
    expect(calls.map(line)).toEqual([
      'GET /api/v1/assistant/conversations?days=30&filter=handed_off&limit=30&cursor=c2',
      'GET /api/v1/assistant/conversations/v%2F1',
      'POST /api/v1/assistant/corrections',
    ])
    expect(calls[2]!.headers['Idempotency-Key']).toBe('k1')
  })
})
