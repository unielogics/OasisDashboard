// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// ADR 0173 on the live Payments screen: the tax line names the invoice's own rate to three decimals (DV-213) and the sheet
// previews (by-item refund rows, the adjustment's new total) round like the server, with each invoice's own rule: 6.625%
// half to even (Square's), 6.625% half up (an invoice made before the switch), and an older server that sends only taxBp.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSession } from '@/auth/test-fixtures'
import { makeDetail, makeEvent, makeLive, makeRow, resetIds, stubPort } from './live-testkit'
import type { Live } from './live-testkit'

beforeEach(() => {
  resetIds()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
  localStorage.clear()
})
afterEach(() => vi.useRealTimers())

const items = [
  { name: 'Express Hand Wash', priceCents: 3600 },
  { name: 'Rain repellent', priceCents: 400 },
]
// $40.00 at 6.625%: 265 cents either way; paid in full
const paid = (taxRounding: 'half_up' | 'half_even') =>
  makeDetail({
    label: 'INV-20701',
    items,
    taxDbp: 6625,
    taxRounding,
    events: [makeEvent({ type: 'pay', amountCents: 4265, method: 'Visa ••4421', methodKind: 'card', dest: null })],
  })

function boot(d: ReturnType<typeof makeDetail>): Live {
  const port = stubPort()
  port.details.set(d.id, d)
  port.rows = [makeRow(d)]
  return makeLive(makeSession({ role: 'mgmt' }), port)
}
async function load(l: Live) {
  for (let i = 0; i < 3; i++) {
    l.vals()
    await l.settle()
  }
  return l.vals()
}

describe('Payments at 6.625% (ADR 0173)', () => {
  it('the tax line reads the invoice’s rate to three decimals; the figures are the server’s', async () => {
    const v = await load(boot(paid('half_even')))
    expect(v.d.lines.map((x: any) => [x.label, x.value])).toEqual([
      ['Express Hand Wash', '$36.00'],
      ['Rain repellent', '$4.00'],
      ['Tax (6.625%)', '$2.65'],
      ['Total', '$42.65'],
      ['Paid', '$42.65'],
    ])
  })

  it('a refund by item adds the line’s tax with the invoice’s rule: $4 is $4.26 half to even, $4.27 half up', async () => {
    for (const [rounding, want] of [
      ['half_even', '$4.26'],
      ['half_up', '$4.27'],
    ] as const) {
      const l = boot(paid(rounding))
      let v = await load(l)
      v.d.actions.find((a: any) => a.label === 'Refund').onClick()
      l.vals().sh.modes[1].onClick()
      v = l.vals()
      expect(v.sh.itemRows.map((r: any) => [r.label, r.value]), rounding).toEqual([
        ['Express Hand Wash', rounding === 'half_even' ? '$38.38' : '$38.39'],
        ['Rain repellent', want],
      ])
      l.vals().sh.itemRows[1].onClick()
      expect(l.vals().sh.submitLabel, rounding).toBe('Refund ' + want)
    }
  })

  it('an adjustment previews the new total with the invoice’s rule ($36 at 6.625% half to even is $38.38)', async () => {
    const l = boot(paid('half_even'))
    let v = await load(l)
    v.d.actions.find((a: any) => a.label === 'Adjust').onClick()
    l.vals().sh.setAmount({ target: { value: '4' } })
    v = l.vals()
    expect(v.sh.summary.slice(0, 3).map((r: any) => [r.label, r.value])).toEqual([
      ['Current total', '$42.65'],
      ['Discount (pre-tax)', '−$4.00'],
      ['New total', '$38.38'],
    ])
  })

  it('a server before ADR 0173 (taxBp only) reads as before: whole basis points, half up', async () => {
    const d: any = makeDetail({ label: 'INV-20702', items: [{ name: 'Executive Detail', priceCents: 26000 }] })
    delete d.taxDbp
    delete d.taxRounding
    const v = await load(boot(d))
    expect(v.d.lines.find((x: any) => x.label.startsWith('Tax'))).toMatchObject({ label: 'Tax (7%)', value: '$18.20' })
  })
})
