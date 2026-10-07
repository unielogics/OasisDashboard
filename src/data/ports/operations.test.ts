/* eslint-disable @typescript-eslint/no-explicit-any */
// The Operations region of the data port: every method on its documented URL, verb and body, the Idempotency-Key it
// carries, and the presigned upload (signed fields first, the file last, the object store's own refusal text).
import { describe, expect, it, vi } from 'vitest'
import { ApiClient } from '../http/client'
import { UploadError, createLiveOperationsPort } from './operations'

function harness(upload: (url: string, init: any) => Response = () => new Response(null, { status: 204 })) {
  const calls: Array<{ method: string; url: string; body: unknown; headers: Record<string, string> }> = []
  const fetch = vi.fn(async (url: string, init: any) => {
    calls.push({
      method: init.method,
      url,
      body: init.body ? JSON.parse(init.body) : undefined,
      headers: init.headers,
    })
    return new Response(JSON.stringify({}), { status: 200 })
  })
  const client = new ApiClient({ fetch: fetch as any, newKey: () => 'auto-key', sleep: async () => {} })
  client.csrf.set('csrf-1')
  const up = vi.fn(async (url: string, init: any) => upload(url, init))
  return { port: createLiveOperationsPort(client, up as any), calls, up }
}
const line = (c: { method: string; url: string }) => `${c.method} ${c.url}`

describe('createLiveOperationsPort', () => {
  it('reads: URLs, queries and encoding', async () => {
    const { port, calls } = harness()
    await port.snapshot({ window: 'week', q: ' bmw x5 ' })
    await port.snapshot({ window: 'next24' })
    await port.calendarSummary('2026-06-01', '2026-06-30')
    await port.calendarDay('2026-06-13')
    await port.appointment('ap/1')
    await port.thread('ap-1')
    await port.availability({ date: '2026-06-13', serviceId: 's 1', addonIds: ['a', 'b'], customerId: 'c1' })
    await port.availability({ date: '2026-06-13', serviceId: 's1' })
    await port.customers('Priya N')
    await port.membership('c/1')
    await port.catalog()
    await port.templates()
    expect(calls.map(line)).toEqual([
      'GET /api/v1/ops/snapshot?window=week&q=bmw+x5',
      'GET /api/v1/ops/snapshot?window=next24',
      'GET /api/v1/calendar/summary?from=2026-06-01&to=2026-06-30',
      'GET /api/v1/calendar/day?date=2026-06-13',
      'GET /api/v1/appointments/ap%2F1',
      'GET /api/v1/appointments/ap-1/messages',
      'GET /api/v1/availability?date=2026-06-13&serviceId=s+1&addonIds=a%2Cb&channel=desk&customerId=c1',
      'GET /api/v1/availability?date=2026-06-13&serviceId=s1&channel=desk',
      'GET /api/v1/customers?q=Priya+N&limit=8',
      'GET /api/v1/customers/c%2F1/membership',
      'GET /api/v1/services',
      'GET /api/v1/messages/templates',
    ])
  })

  it('commands: verbs, bodies and the Idempotency-Key the caller owns', async () => {
    const { port, calls } = harness()
    const o = { idempotencyKey: 'k-1' }
    await port.advance('a1', 'confirmed', o)
    await port.arrive('a1', o)
    await port.assignBay('a1', 'bay-2', o)
    await port.prepBay('a1', o)
    await port.reschedule('a1', { start: '2026-06-13T19:00:00.000Z', override: { reason: 'Regular' } }, o)
    await port.pickup('a1', 'collected', o)
    await port.notifyReady('a1', o)
    await port.cancel('a1', { reason: 'Customer asked', deposit: 'keep' }, o)
    await port.noShow('a1', o)
    await port.book({ customer: { id: 'c1' }, serviceId: 's1', walkIn: true }, o)
    await port.setAddon('a1', 'svc-wax', true, o)
    await port.setAddon('a1', 'svc-wax', false, o)
    await port.checklistItem('a1', 't1', true, o)
    await port.checklistBulk('a1', ['t1', 't2'], false, o)
    await port.applyPerk('a1', o)
    await port.sendMessage('a1', { text: 'Hi' }, o)
    await port.sendMessage('a1', { templateKey: 'qr_confirmed' }, o)
    await port.markRead('c1', o)
    await port.presignPhoto('a1', { category: 'before', contentType: 'image/png', bytes: 10 }, o)
    await port.completePhoto('a1', 'p1', o)
    await port.deletePhoto('a1', 'p1', o)
    expect(calls.map((c) => [line(c), c.body])).toEqual([
      ['POST /api/v1/appointments/a1/advance', { expectedStatus: 'confirmed' }],
      ['POST /api/v1/appointments/a1/arrive', { source: 'manual' }],
      ['POST /api/v1/appointments/a1/assign-bay', { bayId: 'bay-2' }],
      ['POST /api/v1/appointments/a1/prep-bay', undefined],
      [
        'POST /api/v1/appointments/a1/reschedule',
        { start: '2026-06-13T19:00:00.000Z', override: { reason: 'Regular' } },
      ],
      ['POST /api/v1/appointments/a1/pickup', { state: 'collected' }],
      ['POST /api/v1/appointments/a1/notify-ready', undefined],
      ['POST /api/v1/appointments/a1/cancel', { reason: 'Customer asked', deposit: 'keep' }],
      ['POST /api/v1/appointments/a1/no-show', undefined],
      ['POST /api/v1/appointments', { customer: { id: 'c1' }, serviceId: 's1', walkIn: true }],
      ['PUT /api/v1/appointments/a1/addons/svc-wax', undefined],
      ['DELETE /api/v1/appointments/a1/addons/svc-wax', undefined],
      ['PUT /api/v1/appointments/a1/checklist/items/t1', { done: true }],
      ['POST /api/v1/appointments/a1/checklist/bulk', { itemIds: ['t1', 't2'], done: false }],
      ['POST /api/v1/appointments/a1/membership-perks/apply', {}],
      ['POST /api/v1/appointments/a1/messages', { text: 'Hi' }],
      ['POST /api/v1/appointments/a1/messages', { templateKey: 'qr_confirmed' }],
      ['POST /api/v1/customers/c1/messages/read', {}],
      [
        'POST /api/v1/appointments/a1/photos/presign',
        { category: 'before', contentType: 'image/png', bytes: 10 },
      ],
      ['POST /api/v1/appointments/a1/photos/p1/complete', undefined],
      ['DELETE /api/v1/appointments/a1/photos/p1', undefined],
    ])
    for (const c of calls) {
      expect(c.headers['Idempotency-Key'], line(c)).toBe('k-1')
      expect(c.headers['X-CSRF-Token']).toBe('csrf-1')
    }
  })

  it('a command without a key still gets one (one per call, generated by the client)', async () => {
    const { port, calls } = harness()
    await port.advance('a1', 'booked')
    expect(calls[0]!.headers['Idempotency-Key']).toBe('auto-key')
  })

  it('uploads the signed fields first and the file last, without credentials or API headers', async () => {
    const { port, up } = harness()
    const slot = {
      url: 'http://127.0.0.1:4023/dev-storage/upload',
      fields: { key: 'k', 'Content-Type': 'image/png', sig: 's' },
      key: 'k',
      expiresAt: 'x',
    }
    await port.uploadToSlot(slot, new Blob(['x'], { type: 'image/png' }))
    const [url, init] = up.mock.calls[0]!
    expect(url).toBe(slot.url)
    expect(init.method).toBe('POST')
    const names = [...(init.body as FormData).keys()]
    expect(names).toEqual(['key', 'Content-Type', 'sig', 'file'])
    expect(init.headers).toBeUndefined()
    expect(init.credentials).toBeUndefined()
  })

  it("the object store's refusal becomes an UploadError with its own message; S3 XML and a dead network get plain ones", async () => {
    const slot = { url: 'http://x/upload', fields: {}, key: 'k', expiresAt: 'x' }
    const heic = harness(
      () =>
        new Response(
          JSON.stringify({ error: { code: 'HEIC_NOT_SUPPORTED', message: 'HEIC photos are not supported' } }),
          { status: 415 },
        ),
    )
    await expect(heic.port.uploadToSlot(slot, new Blob(['x']))).rejects.toMatchObject({
      status: 415,
      code: 'HEIC_NOT_SUPPORTED',
      message: 'HEIC photos are not supported',
    })
    const xml = harness(() => new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 }))
    await expect(xml.port.uploadToSlot(slot, new Blob(['x']))).rejects.toMatchObject({
      status: 403,
      message: 'The photo could not be uploaded.',
    })
    const dead = harness(() => {
      throw new TypeError('fetch failed')
    })
    const e = await dead.port.uploadToSlot(slot, new Blob(['x'])).catch((x) => x)
    expect(e).toBeInstanceOf(UploadError)
    expect(e.code).toBe('NETWORK')
  })
})
