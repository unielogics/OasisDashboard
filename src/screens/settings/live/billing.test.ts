// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// Settings → Billing & integrations (live only; ADR 0171, DV-908) and Move members on the Memberships tab (DV-909) on the
// view model with the fake API, and the live template rendering them: the fourth tab of "Prices & memberships", locked
// without set.billing (nothing read), Test connection and Sync to Square, the read-only switches, each form saved with its
// own version (a 412 says so and keeps the edit), the booking fee's collect mode on its own route (set.services), and
// "Move members" with the text the members get, its date and a second click.
import fs from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { compileScreens } from '../../../../tools/dc-compile/compile'
import { root } from '../../../../tools/dc-compile/tests/original-runtime'
import { atPath } from '../testkit'
import { makeExtrasLogic, stale } from './extras-testkit'

const tmp = path.join(root, 'tools/dc-compile/tests/.tmp-snippets/settings-billing-render')
const text = (v: string | Buffer | undefined): string => (Buffer.isBuffer(v) ? v.toString('utf8') : (v ?? ''))
let render: (vals: any, ctx: { name: string }) => any

beforeAll(async () => {
  process.env.TZ = 'America/New_York'
  const out = compileScreens(['settings'], { root, variant: 'live', tplIds: false, allowComplexExpr: false })
  const dir = path.join(tmp, 'gen')
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, buf] of Object.entries(out.perScreen.settings!))
    fs.writeFileSync(path.join(dir, name), text(buf))
  render = (await import(/* @vite-ignore */ path.join(dir, 'settings.tsx'))).default
})
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))
beforeEach(() => {
  vi.useRealTimers()
  location.hash = ''
})
afterEach(() => vi.restoreAllMocks())

const vals = (logic: any): any => logic.renderVals()
const html = (logic: any) => renderToStaticMarkup(render(vals(logic), { name: 'settings' }))
const call = (logic: any, p: string, value = ''): void => {
  const fn = atPath(vals(logic), p)
  expect(typeof fn, `no handler at ${p}`).toBe('function')
  fn({ target: { value }, key: '' })
}
const writes = (calls: any[][], name: string) => calls.filter((c) => c[0] === name)
const openBilling = async (logic: any): Promise<any> => {
  logic.setState({ section: 'billing' })
  await vi.waitFor(() => expect(vals(logic).live.secBilling).toBe(true))
  return vals(logic).live.bill
}

describe('Settings → Billing & integrations (DV-908)', () => {
  it('is the fourth tab of Prices & memberships; the section shows the defaults in plain words', async () => {
    const t = makeExtrasLogic('super')
    call(t.logic, 'live.goPrices')
    const tabs = vals(t.logic).live.pricingTabs.tabs
    expect(tabs.map((x: any) => x.label)).toEqual([
      'Prices by size',
      'Memberships',
      'Vehicle sizes',
      'Billing & integrations',
    ])
    tabs[3].onClick()
    const b = await openBilling(t.logic)
    expect(vals(t.logic).secTitle).toBe('Billing & integrations')
    expect(b.sqHeadline).toBe('Square simulator (nothing reaches Square)')
    expect(b.sqLastTest).toBe('Never tested')
    expect(b.switches[0]).toMatchObject({
      label: 'Card payments go through',
      value: 'Squarespace (Square not switched on yet)',
    })
    expect(b.bookingFee).toBe('$25 per online booking by a guest, toward the visit (set in Prices by size).')
    expect(b.consentVersion).toBe('Version v1 · the box starts unticked')
    expect(b.grace).toBe('7')
    expect(b.cancel).toBe('21')
    expect(b.noticeDays).toBe('30')
    const page = html(t.logic)
    for (const s of [
      'Billing &amp; integrations',
      'Square simulator (nothing reaches Square)',
      'Test connection',
      'Sync to Square',
      'How payments run',
      'Tips on payment links',
      'No-show and late-cancel fees',
      'When a membership payment fails',
      'Notice before a price change',
      'Card consent',
    ])
      expect(page, s).toContain(s)
  })

  it('without set.billing it is locked and nothing is read', async () => {
    const t = makeExtrasLogic('mgmt')
    t.logic.setState({ section: 'billing' })
    await vi.waitFor(() => expect(vals(t.logic).live.secLocked).toBe(true))
    expect(vals(t.logic).live.lockedBody).toBe(
      'Ask an administrator to give your role the “Billing & integrations” permission.',
    )
    expect(writes(t.calls, 'billing')).toHaveLength(0)
  })

  it('Test connection shows the checks; Sync to Square says what the server answered', async () => {
    const t = makeExtrasLogic('super')
    await openBilling(t.logic)
    call(t.logic, 'live.bill.test')
    await vi.waitFor(() => expect(vals(t.logic).live.bill.sqHasChecks).toBe(true))
    expect(vals(t.logic).live.bill.sqChecks.map((c: any) => c.label + ': ' + c.value)).toEqual([
      'Access token: OK · Square answered',
      'Location: OK · Oasis Auto Spa, USD, takes cards',
      'Events: OK · Events API on',
      'Webhook: OK · Simulator',
    ])
    expect(vals(t.logic).live.bill.sqLastTest).toBe('Last test: all checks passed · Jun 13, 10:36 AM')
    expect(t.flashes).toContain('Square connection OK')
    call(t.logic, 'live.bill.sync')
    await vi.waitFor(() => expect(t.flashes).toContain('Not synced: Square writes are off'))
    expect(writes(t.calls, 'syncSquareCatalog')).toHaveLength(1)
  })

  it('link tipping is sent at once with its version', async () => {
    const t = makeExtrasLogic('super')
    await openBilling(t.logic)
    call(t.logic, 'live.bill.tipToggle')
    await vi.waitFor(() => expect(writes(t.calls, 'saveLinkTipping')).toHaveLength(1))
    expect(writes(t.calls, 'saveLinkTipping')[0]![1]).toEqual({ enabled: true, version: 0 })
    await vi.waitFor(() => expect(t.flashes).toContain('Tips on payment links: on'))
  })

  it('the fees are a draft until Save; a refusal is said before sending; Save sends cents and the version', async () => {
    const t = makeExtrasLogic('super')
    await openBilling(t.logic)
    call(t.logic, 'live.bill.feeToggle')
    expect(vals(t.logic).live.bill.feeDirty).toBe(true)
    call(t.logic, 'live.bill.feeSave')
    await vi.waitFor(() =>
      expect(vals(t.logic).live.bill.feeError).toBe('Set at least one fee before turning fees on.'),
    )
    expect(writes(t.calls, 'saveCardFees')).toHaveLength(0)
    call(t.logic, 'live.bill.setNoShow', '15')
    call(t.logic, 'live.bill.feeSave')
    await vi.waitFor(() => expect(writes(t.calls, 'saveCardFees')).toHaveLength(1))
    expect(writes(t.calls, 'saveCardFees')[0]![1]).toEqual({
      enabled: true,
      noShowCents: 1500,
      lateCancelCents: 0,
      version: 0,
    })
    await vi.waitFor(() => expect(vals(t.logic).live.bill.feeDirty).toBe(false))
  })

  it('the renewal policy and the notice: checked here, then saved; a 412 keeps the edit and says so', async () => {
    const t = makeExtrasLogic('super')
    await openBilling(t.logic)
    call(t.logic, 'live.bill.setGrace', '30')
    call(t.logic, 'live.bill.policySave')
    await vi.waitFor(() =>
      expect(vals(t.logic).live.bill.policyError).toBe(
        'The cancel day must come after the last day of perks.',
      ),
    )
    call(t.logic, 'live.bill.setCancel', '45')
    expect(vals(t.logic).live.bill.policyText).toContain('keeps the perks 30 days')
    call(t.logic, 'live.bill.policySave')
    await vi.waitFor(() => expect(writes(t.calls, 'saveRenewalPolicy')).toHaveLength(1))
    expect(writes(t.calls, 'saveRenewalPolicy')[0]![1]).toEqual({ graceDays: 30, cancelDays: 45, version: 0 })
    t.fail.set('savePriceNotice', stale())
    call(t.logic, 'live.bill.setNotice', '14')
    call(t.logic, 'live.bill.noticeSave')
    await vi.waitFor(() =>
      expect(vals(t.logic).live.bill.noticeError).toMatch(/^Someone else saved a change meanwhile/),
    )
    expect(vals(t.logic).live.bill.noticeDays).toBe('14')
  })

  it('the booking fee’s collect mode goes to its own route (set.services), with the amount it has', async () => {
    const t = makeExtrasLogic('super')
    await openBilling(t.logic)
    vals(t.logic).live.bill.collectOpts[1].onClick()
    expect(vals(t.logic).live.bill.collectDirty).toBe(true)
    call(t.logic, 'live.bill.collectSave')
    await vi.waitFor(() => expect(writes(t.calls, 'saveGuestFee')).toHaveLength(1))
    expect(writes(t.calls, 'saveGuestFee')[0]![1]).toMatchObject({ cents: 2500, collect: 'link' })
  })

  it('Accounting (set.billing without set.services) reads it all but the collect mode says no', async () => {
    const t = makeExtrasLogic('acct')
    await openBilling(t.logic)
    vals(t.logic).live.bill.collectOpts[1].onClick()
    expect(vals(t.logic).live.bill.collectDirty).toBe(false)
    expect(t.flashes).toContain('Your role can’t edit packages and checklists')
  })
})

describe('Memberships: Move members and each price’s Square state (DV-909)', () => {
  const openMem = async (logic: any): Promise<any> => {
    logic.setState({ section: 'memberships' })
    await vi.waitFor(() => expect(vals(logic).live.secMemberships).toBe(true))
    return vals(logic).live.mem
  }

  it('with set.billing: the notice they get and its date, then a second click sends it with the notice days', async () => {
    const t = makeExtrasLogic('super')
    let m = await openMem(t.logic)
    expect(m.t.canMove).toBe(true)
    expect(m.t.moveOpen).toBe(false)
    expect(html(t.logic)).toContain('Move members to today’s prices')
    call(t.logic, 'live.mem.t.moveStart')
    m = vals(t.logic).live.mem
    expect(m.t.moveOpen).toBe(true)
    expect(m.t.moveText).toMatch(
      /^Hi Maria, your Oasis Auto Spa .+ membership will be \$\d+\/month from your first bill after \w{3}, \w{3} \d{1,2}\. Questions\? Just reply here\.$/,
    )
    expect(m.t.moveWhen).toMatch(/^Moves at the first bill after \w{3}, \w{3} \d{1,2}$/)
    const page = html(t.logic)
    expect(page).toContain('The text they get')
    expect(writes(t.calls, 'moveMembers')).toHaveLength(0)
    call(t.logic, 'live.mem.t.moveConfirm')
    await vi.waitFor(() => expect(writes(t.calls, 'moveMembers')).toHaveLength(1))
    expect(writes(t.calls, 'moveMembers')[0]!.slice(1, 3)).toEqual([expect.any(String), { notice: 30 }])
    await vi.waitFor(() =>
      expect(
        t.flashes.some((f) => f.startsWith('Moving 2 members · new price from their first bill after')),
      ).toBe(true),
    )
    expect(vals(t.logic).live.mem.t.moveOpen).toBe(false)
  })

  it('without set.billing there is no Move members box', async () => {
    const t = makeExtrasLogic('mgmt')
    const m = await openMem(t.logic)
    expect(m.t.canMove).toBe(false)
    expect(html(t.logic)).not.toContain('Move members to today’s prices')
  })

  it('each price cell shows the state the sync keeps, with the reason Square lost it in its tooltip', async () => {
    const t = makeExtrasLogic('super')
    const gold = t.cat.tiers.find((x: any) => x.prices.length)
    gold.prices[0].squareState = 'pending'
    gold.prices[0].squareError = 'Square lost its plan variation; it is being made again'
    const m = await openMem(t.logic)
    const row = m.grid.rows.find((r: any) => r.name === gold.name)
    const cell = row.cells.find((c: any) => c.state !== 'No price')
    expect(cell.state).toBe('Square lost it · making it again')
    expect(cell.stateTitle).toBe('Square lost its plan variation; it is being made again')
    expect(html(t.logic)).toContain('Square lost it · making it again')
  })
})
