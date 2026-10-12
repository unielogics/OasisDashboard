/* eslint-disable @typescript-eslint/no-explicit-any */
// The wave Q3 routes of the Payments port and the Settings API (ADR 0171; api-spec 30.11, 30.12, 30.13): verbs, paths, bodies
// and the caller's Idempotency-Key, over the real ApiClient with a recording fetch.
import { describe, expect, it, vi } from 'vitest'
import { ApiClient } from '../http/client'
import { createLivePaymentsPort } from './payments'
import { createSettingsApi } from './settings-api'

function harness() {
  const calls: Array<{ method: string; url: string; body: unknown; headers: Record<string, string> }> = []
  const fetch = vi.fn(async (url: string, init: any) => {
    calls.push({ method: init.method, url, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers })
    return new Response(JSON.stringify({ items: [] }), { status: 200 })
  })
  const client = new ApiClient({ fetch: fetch as any, newKey: () => 'auto-key', sleep: async () => {} })
  client.csrf.set('csrf-1')
  return { client, calls }
}
const line = (c: { method: string; url: string }) => `${c.method} ${c.url}`

describe('the Payments port: saved-card charges and fees', () => {
  it('charges a card for the balance, reads an invoice’s charges, charges and waives a visit’s fee', async () => {
    const { client, calls } = harness()
    const port = createLivePaymentsPort(client)
    const o = { idempotencyKey: 'k-1' }
    await port.chargeCard('inv-1', { cardId: 'card-1', amountCents: 4280 }, o)
    await port.chargeFee('a-1', 'ch-1', o)
    await port.waiveFee('a-1', 'ch-1', 'First time', o)
    await port.invoiceCharges('inv-1')
    expect(calls.map((c) => [line(c), c.body])).toEqual([
      ['POST /api/v1/invoices/inv-1/card-charges', { cardId: 'card-1', amountCents: 4280 }],
      ['POST /api/v1/appointments/a-1/fee-charges/ch-1/charge', {}],
      ['POST /api/v1/appointments/a-1/fee-charges/ch-1/waive', { reason: 'First time' }],
      ['GET /api/v1/invoices/inv-1/card-charges', undefined],
    ])
    for (const c of calls.slice(0, 3)) expect(c.headers['Idempotency-Key'], line(c)).toBe('k-1')
  })
})

describe('the Settings API: Billing & integrations and Move members', () => {
  it('reads the panel and sends each block to its own route', async () => {
    const { client, calls } = harness()
    const api = createSettingsApi(client)
    const o = { idempotencyKey: 'k-1' }
    await api.billing()
    await api.saveLinkTipping({ enabled: true, version: 0 }, o)
    await api.saveRenewalPolicy({ graceDays: 7, cancelDays: 21, version: 1 }, o)
    await api.savePriceNotice({ days: 30, version: 2 }, o)
    await api.saveCardFees({ enabled: true, noShowCents: 1500, lateCancelCents: 0, version: 3 }, o)
    await api.testSquare(o)
    await api.syncSquareCatalog(o)
    await api.moveMembers('gold', { notice: 30 }, o)
    expect(calls.map((c) => [line(c), c.body])).toEqual([
      ['GET /api/v1/settings/billing', undefined],
      ['PUT /api/v1/settings/billing/link-tipping', { enabled: true, version: 0 }],
      ['PUT /api/v1/settings/billing/renewal-policy', { graceDays: 7, cancelDays: 21, version: 1 }],
      ['PUT /api/v1/settings/billing/price-change-notice', { days: 30, version: 2 }],
      ['PUT /api/v1/settings/card-fees', { enabled: true, noShowCents: 1500, lateCancelCents: 0, version: 3 }],
      ['POST /api/v1/integrations/square/test', {}],
      ['POST /api/v1/integrations/square/catalog/sync', {}],
      ['POST /api/v1/catalog/tiers/gold/move-members', { notice: 30 }],
    ])
  })
})
