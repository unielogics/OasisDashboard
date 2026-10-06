/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest'
import { ApiClient } from '../http/client'
import { createLiveDataPort } from './live'

function harness(handler: (url: string, init: any) => unknown = () => ({})) {
  const calls: Array<{ method: string; url: string; body: unknown; headers: Record<string, string> }> = []
  const fetch = vi.fn(async (url: string, init: any) => {
    calls.push({
      method: init.method,
      url,
      body: init.body ? JSON.parse(init.body) : undefined,
      headers: init.headers,
    })
    const r = handler(url, init)
    return new Response(r === undefined ? null : JSON.stringify(r), { status: r === undefined ? 204 : 200 })
  })
  const client = new ApiClient({ fetch: fetch as any, newKey: () => 'auto-key', sleep: async () => {} })
  client.csrf.set('csrf-1')
  return { port: createLiveDataPort(client), calls }
}

describe('LiveDataPort wires every region to the documented endpoint', () => {
  it('reads: URLs, queries and encoding', async () => {
    const { port, calls } = harness()
    await port.catalog.services()
    await port.hours.hours()
    await port.hours.closures({ from: '2026-06-01', to: '2026-06-30' })
    await port.hours.closures()
    await port.emergency.current()
    await port.emergency.preview({ reason: 'Storm', dur: 'until', until: '3:00 PM' })
    await port.calendar.summary('2026-06-01', '2026-06-30')
    await port.calendar.day('2026-06-13')
    await port.availability.slots({ date: '2026-06-13', serviceId: 's 1', addonIds: ['a', 'b'] })
    await port.ops.snapshot({ window: 'next24', q: 'bmw x5' })
    await port.ops.appointment('ap/1')
    await port.messages.thread('ap-1')
    await port.payments.summary('7d')
    await port.payments.invoice('INV-20603')
    await port.people.employees({ q: 'mar', role: 'crew' })
    await port.people.roles()
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/v1/services',
      'GET /api/v1/settings/hours',
      'GET /api/v1/closures?from=2026-06-01&to=2026-06-30',
      'GET /api/v1/closures',
      'GET /api/v1/emergency',
      'GET /api/v1/emergency/preview?reason=Storm&dur=until&until=3%3A00+PM',
      'GET /api/v1/calendar/summary?from=2026-06-01&to=2026-06-30',
      'GET /api/v1/calendar/day?date=2026-06-13',
      'GET /api/v1/availability?date=2026-06-13&serviceId=s+1&addonIds=a%2Cb',
      'GET /api/v1/ops/snapshot?window=next24&q=bmw+x5',
      'GET /api/v1/appointments/ap%2F1',
      'GET /api/v1/appointments/ap-1/messages',
      'GET /api/v1/payments/summary?range=7d',
      'GET /api/v1/invoices/INV-20603',
      'GET /api/v1/employees?q=mar&role=crew',
      'GET /api/v1/roles',
    ])
    expect(port.kind).toBe('live')
  })

  it('writes: verbs, bodies, CSRF and the action key', async () => {
    const { port, calls } = harness()
    const o = { idempotencyKey: 'act-1' }
    await port.catalog.saveChecklist('svc-1', [{ label: 'x' }], o)
    await port.hours.saveHours({ days: [], rules: { slot: 30, buffer: 10, cutoff: 60 }, version: 3 }, o)
    await port.hours.previewClosure({ date: '2026-07-04', type: 'closed' })
    await port.hours.createClosure({ date: '2026-07-04', type: 'closed' }, o)
    await port.hours.deleteClosure('c-1', o)
    await port.emergency.close({ reason: 'Storm', dur: 'today', notify: true }, o)
    await port.emergency.reopen(o)
    await port.ops.advance('ap-1', { expectedStatus: 'confirmed' }, o)
    await port.ops.assignBay('ap-1', 'bay-2', o)
    await port.ops.toggleChecklistItem('ap-1', 'task-9', true, o)
    await port.ops.toggleAddon('ap-1', 'addon-3', true, o)
    await port.ops.toggleAddon('ap-1', 'addon-3', false, o)
    await port.ops.reschedule('ap-1', { start: '2026-06-13T15:00:00-04:00' }, o)
    await port.messages.send('ap-1', { text: 'On our way' }, o)
    await port.payments.collect('INV-1', { method: 'cash' }, o)
    await port.payments.refund(
      'INV-1',
      { mode: 'custom', amountCents: 500, reason: 'Goodwill', dest: 'card' },
      o,
    )
    await port.payments.approveRefund('INV-1', 'ev-1', o)
    await port.payments.denyRefund('INV-1', 'ev-1', o)
    await port.payments.adjust('INV-1', { kind: 'discount', unit: '$', value: 500, reason: 'Loyalty' }, o)
    await port.payments.issueCredit('INV-1', { amountCents: 2000, reason: 'Referral', expiry: '90 days' }, o)
    await port.payments.voidPayment('INV-1', 'ev-2', o)
    await port.people.setRolePermission('r-1', 'pay.refund', true, o)
    await port.people.setRoleLimit('r-1', 'refund', null, o)
    await port.payments.applyCredit('INV-1', o)
    await port.payments.sendReceipt('INV-1', o)
    await port.payments.confirmProcessor('ev-3', o)
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'PUT /api/v1/services/svc-1/checklist',
      'PUT /api/v1/settings/hours',
      'POST /api/v1/closures/preview',
      'POST /api/v1/closures',
      'DELETE /api/v1/closures/c-1',
      'POST /api/v1/emergency/close',
      'POST /api/v1/emergency/reopen',
      'POST /api/v1/appointments/ap-1/advance',
      'POST /api/v1/appointments/ap-1/assign-bay',
      'PUT /api/v1/appointments/ap-1/checklist/items/task-9',
      'PUT /api/v1/appointments/ap-1/addons/addon-3',
      'DELETE /api/v1/appointments/ap-1/addons/addon-3',
      'POST /api/v1/appointments/ap-1/reschedule',
      'POST /api/v1/appointments/ap-1/messages',
      'POST /api/v1/invoices/INV-1/payments',
      'POST /api/v1/invoices/INV-1/refunds',
      'POST /api/v1/invoices/INV-1/refunds/ev-1/approve',
      'POST /api/v1/invoices/INV-1/refunds/ev-1/deny',
      'POST /api/v1/invoices/INV-1/adjustments',
      'POST /api/v1/invoices/INV-1/credits',
      'POST /api/v1/invoices/INV-1/void',
      'PUT /api/v1/roles/r-1/permissions/pay.refund',
      'PUT /api/v1/roles/r-1/limits/refund',
      'POST /api/v1/invoices/INV-1/credit-applications',
      'POST /api/v1/invoices/INV-1/receipt',
      'POST /api/v1/ledger-events/ev-3/confirm-processor',
    ])
    for (const c of calls) {
      expect(c.headers['X-CSRF-Token'], c.url).toBe('csrf-1')
      // previewClosure is the one mutation without an action key of its own: the client generates one
      expect(c.headers['Idempotency-Key'], c.url).toBe(
        c.url.endsWith('/closures/preview') ? 'auto-key' : 'act-1',
      )
    }
    expect(calls[7]!.body).toEqual({ expectedStatus: 'confirmed' })
    expect(calls[8]!.body).toEqual({ bayId: 'bay-2' })
    expect(calls[9]!.body).toEqual({ done: true })
    expect(calls[20]!.body).toEqual({ eventId: 'ev-2' })
    expect(calls[21]!.body).toEqual({ granted: true })
    expect(calls[22]!.body).toEqual({ value: null })
    // the Payments commands carry an object body (the server's strict schemas reject a missing one)
    expect(calls[23]!.body).toEqual({})
    expect(calls[24]!.body).toEqual({})
    expect(calls[25]!.body).toEqual({})
    expect(calls[16]!.body).toEqual({})
  })

  it('payments.invoices follows keyset cursors until the list is complete', async () => {
    const pages: Record<string, unknown> = {
      first: { items: [{ id: 'a' }, { id: 'b' }], nextCursor: 'c2' },
      c2: { items: [{ id: 'c' }], nextCursor: 'c3' },
      c3: { items: [{ id: 'd' }], nextCursor: null },
    }
    const { port, calls } = harness(
      (url) => pages[new URL(url, 'http://x').searchParams.get('cursor') ?? 'first'],
    )
    const rows = await port.payments.invoices({ range: '30d', filter: 'unpaid', q: ' kim ' })
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(calls.map((c) => c.url)).toEqual([
      '/api/v1/payments/invoices?range=30d&filter=unpaid&q=kim&limit=500',
      '/api/v1/payments/invoices?range=30d&filter=unpaid&q=kim&cursor=c2&limit=500',
      '/api/v1/payments/invoices?range=30d&filter=unpaid&q=kim&cursor=c3&limit=500',
    ])
  })

  it('an empty list is one request', async () => {
    const { port, calls } = harness(() => ({ items: [], nextCursor: null }))
    expect(await port.payments.invoices({ range: 'today' })).toEqual([])
    expect(calls).toHaveLength(1)
  })
})
