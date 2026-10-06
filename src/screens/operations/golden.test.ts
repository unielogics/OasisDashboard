// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// The port against values read from the ORIGINAL bundle running in Chromium (tests/operations/extract-golden.ts):
// KPIs, alerts, timeline groups, bays, staff, calendar counts for day, week and month across closures, and the totals
// of every appointment file. Re-extract with `pnpm exec tsx tests/operations/extract-golden.ts` if the oracle changes.
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { serializeVals } from '@/dc/serialize'
import { BASELINE, GOLDEN_SCENARIOS, project } from './golden-project'
import { PortClass, mount } from './testkit'

const golden = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'tests/fixtures/golden/operations.json'), 'utf8'),
) as Record<string, unknown>

beforeAll(() => {
  process.env.TZ = 'America/New_York'
  vi.useFakeTimers({ now: new Date('2026-06-13T10:36:00-04:00') })
  localStorage.clear()
})
afterAll(() => vi.useRealTimers())

describe('golden values from the original bundle', () => {
  it('covers every scenario', () => {
    expect(Object.keys(golden)).toEqual(GOLDEN_SCENARIOS.map((s) => s.name))
  })

  it('the headline numbers are what the design shows', () => {
    const k = (
      golden['initial light'] as { kpis: Array<{ label: string; value: string; sub: string }> }
    ).kpis.map((x) => [x.label, x.value, x.sub])
    expect(k).toEqual([
      ['Appointments 24h', '12', '12 booked'],
      ['Active jobs', '1', 'in bays'],
      ['Ready for pickup', '1', 'notify'],
      ['Pending payments', '6', '$1,299'],
      ['Bay time free', '3.5h', 'today'],
      ['Members today', '6', 'of 11'],
      ['Revenue today', '$1,488', 'paid'],
    ])
  })

  let logic: any
  let dispose: () => void
  beforeAll(() => {
    ;({ logic, dispose } = mount(PortClass()))
  })
  afterAll(() => dispose())
  for (const s of GOLDEN_SCENARIOS) {
    it(s.name, () => {
      logic.setState({ ...BASELINE, ...s.patch })
      const got = project(serializeVals(logic.renderVals()) as Record<string, unknown>, s.sections)
      expect(got).toEqual(golden[s.name])
    })
  }
})
