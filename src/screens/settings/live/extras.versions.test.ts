// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// Settings → Catalog, Categories and Reminders & texts when someone else saves meanwhile (review W3h F1): a draft is
// rebased on the newer copy the event stream brings (untouched fields follow it, the save sends its version), a save
// made on an older copy is refused by the server (412) instead of undoing their change, and a field both people changed
// is said in the form (Save keeps yours, Discard shows theirs).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { qk } from '@/data/query'
import { CONFLICT_MESSAGE, STALE_ACTION_MESSAGE, STALE_DRAFT_MESSAGE } from '@/lib/settings/drafts'
import { sw } from '@/lib/settings/styles'
import { atPath } from '../testkit'
import { makeExtrasLogic } from './extras-testkit'

beforeAll(() => {
  process.env.TZ = 'America/New_York'
})
beforeEach(() => {
  vi.useRealTimers()
  location.hash = ''
})
afterEach(() => vi.restoreAllMocks())

const vals = (logic: any): any => logic.renderVals()
const call = (logic: any, path: string, value = ''): void => {
  const fn = atPath(vals(logic), path)
  expect(typeof fn, `no handler at ${path}`).toBe('function')
  fn({ target: { value }, key: '' })
}
const open = async (logic: any, section: 'catalog' | 'categories' | 'reminders'): Promise<void> => {
  logic.setState({ section })
  const key = section === 'catalog' ? 'secCatalog' : section === 'categories' ? 'secCategories' : 'secReminders'
  await vi.waitFor(() => expect(vals(logic).live[key]).toBe(true))
}
const writes = (calls: any[][], name: string) => calls.filter((c) => c[0] === name)
/** What the event stream does when someone else saves: the section's query is invalidated and read again. */
const pushed = (t: any, what: 'catalog' | 'reminders') => t.qc.invalidateQueries({ queryKey: qk.settings(what) })
const reads = (t: any, what: string) => writes(t.calls, what).length
const OFF = sw(false).track

describe('Settings extras: someone else saves meanwhile', () => {
  it('reminders: their change shows at once and Save sends it back with the newer version, not the old values', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'reminders')
    call(t.logic, 'live.rem.leads.1.toggle') // Business hours only: off
    t.rem.statusTexts.ready = false
    t.rem.version = 17
    const before = reads(t, 'reminders')
    await pushed(t, 'reminders')
    await vi.waitFor(() => expect(reads(t, 'reminders')).toBe(before + 1))
    await vi.waitFor(() => expect(vals(t.logic).live.rem.status[2].track).toEqual(OFF))
    expect(vals(t.logic).live.rem.leads[1].track).toEqual(OFF)
    expect(vals(t.logic).live.rem.dirty).toBe(true)
    expect(vals(t.logic).live.rem.error).toBe('')
    call(t.logic, 'live.rem.save')
    await vi.waitFor(() => expect(writes(t.calls, 'saveReminders')).toHaveLength(1))
    const body = writes(t.calls, 'saveReminders')[0]![1] as any
    expect(body.version).toBe(17)
    expect(body.statusTexts.ready).toBe(false)
    expect(body.leads.businessHoursOnly).toBe(false)
    await vi.waitFor(() => expect(t.flashes).toContain('Reminders saved · the next texts use them'))
  })

  it('reminders: a save made before their change arrived is refused (412); the screen then shows theirs with yours on top', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'reminders')
    call(t.logic, 'live.rem.toggles.1.toggle') // Review request: on
    t.rem.statusTexts.pickedUp = false // their save; the event has not arrived yet
    t.rem.version = 17
    call(t.logic, 'live.rem.save')
    await vi.waitFor(() => expect(vals(t.logic).live.rem.error).toBe(STALE_DRAFT_MESSAGE))
    expect(writes(t.calls, 'saveReminders')[0]![1].version).toBe(16)
    expect(t.rem.statusTexts.pickedUp).toBe(false)
    await vi.waitFor(() => expect(vals(t.logic).live.rem.status[3].track).toEqual(OFF))
    expect(vals(t.logic).live.rem.toggles[1].track).toEqual(sw(true).track)
    call(t.logic, 'live.rem.save')
    await vi.waitFor(() => expect(writes(t.calls, 'saveReminders')).toHaveLength(2))
    const body = writes(t.calls, 'saveReminders')[1]![1] as any
    expect(body).toMatchObject({ version: 17, reminders: { reviewRequest: true }, statusTexts: { pickedUp: false } })
  })

  it('catalog: a fresh description from someone else shows while the price is being edited, and both are saved', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'catalog')
    call(t.logic, 'live.cat.svc.setMember', '46')
    const sig = t.cat.packages[0]
    sig.description = 'Hand wash, wheels and interior.'
    sig.version = 4
    await pushed(t, 'catalog')
    await vi.waitFor(() => expect(vals(t.logic).live.cat.svc.description).toBe('Hand wash, wheels and interior.'))
    expect(vals(t.logic).live.cat.svc).toMatchObject({ member: '46', dirty: true, error: '' })
    call(t.logic, 'live.cat.svc.save')
    await vi.waitFor(() => expect(writes(t.calls, 'saveCatalogService')).toHaveLength(1))
    expect(writes(t.calls, 'saveCatalogService')[0]![2]).toMatchObject({
      version: 4,
      description: 'Hand wash, wheels and interior.',
      memberPriceCents: 4600,
    })
  })

  it('catalog: a save on an older copy is refused (412) and nothing of theirs is undone; saving again merges', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'catalog')
    call(t.logic, 'live.cat.svc.setMember', '46')
    const sig = t.cat.packages[0]
    sig.description = 'Hand wash, wheels and interior.'
    sig.version = 4
    call(t.logic, 'live.cat.svc.save')
    await vi.waitFor(() => expect(vals(t.logic).live.cat.svc.error).toBe(STALE_DRAFT_MESSAGE))
    expect(writes(t.calls, 'saveCatalogService')[0]![2].version).toBe(3)
    expect(sig.description).toBe('Hand wash, wheels and interior.')
    await vi.waitFor(() => expect(vals(t.logic).live.cat.svc.description).toBe('Hand wash, wheels and interior.'))
    expect(vals(t.logic).live.cat.svc.member).toBe('46')
    call(t.logic, 'live.cat.svc.save')
    await vi.waitFor(() => expect(writes(t.calls, 'saveCatalogService')).toHaveLength(2))
    expect(writes(t.calls, 'saveCatalogService')[1]![2]).toMatchObject({
      version: 4,
      description: 'Hand wash, wheels and interior.',
      memberPriceCents: 4600,
    })
    await vi.waitFor(() => expect(vals(t.logic).live.cat.svc.dirty).toBe(false))
  })

  it('catalog: a field both changed keeps yours on screen and says so; Discard shows theirs', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'catalog')
    call(t.logic, 'live.cat.svc.setDescription', 'Mine.')
    const sig = t.cat.packages[0]
    sig.description = 'Theirs.'
    sig.version = 4
    await pushed(t, 'catalog')
    await vi.waitFor(() => expect(vals(t.logic).live.cat.svc.error).toBe(CONFLICT_MESSAGE))
    expect(vals(t.logic).live.cat.svc.description).toBe('Mine.')
    call(t.logic, 'live.cat.svc.discard')
    expect(vals(t.logic).live.cat.svc).toMatchObject({ description: 'Theirs.', dirty: false, error: '' })
  })

  it('plans, tint, markup and a category rename are rebased the same way and saved with the newer version', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'catalog')
    call(t.logic, 'live.cat.plans.0.setMonthly', '109')
    call(t.logic, 'live.cat.tint.rows.0.setGuestMax', '369')
    call(t.logic, 'live.cat.markup.inc')
    t.cat.plans[0].perks = ['Unlimited hand washes']
    t.cat.plans[0].version = 2
    t.cat.tintMatrix.prices[0].memberMinCents = 21900
    t.cat.tintMatrix.version = 5
    t.cat.guestMarkup = { pct: 30, version: 3 }
    await pushed(t, 'catalog')
    await vi.waitFor(() => expect(vals(t.logic).live.cat.plans[0].perks).toBe('Unlimited hand washes'))
    const v = vals(t.logic).live.cat
    expect(v.plans[0].monthly).toBe('109')
    expect(v.tint.rows[0]).toMatchObject({ memberMin: '219', guestMax: '369' })
    expect(v.markup).toMatchObject({ val: '25%', dirty: true, sub: CONFLICT_MESSAGE })
    call(t.logic, 'live.cat.plans.0.save')
    call(t.logic, 'live.cat.tint.save')
    call(t.logic, 'live.cat.markup.save')
    await vi.waitFor(() => expect(writes(t.calls, 'saveGuestMarkup')).toHaveLength(1))
    await vi.waitFor(() => expect(writes(t.calls, 'saveTintMatrix')).toHaveLength(1))
    await vi.waitFor(() => expect(writes(t.calls, 'savePlan')).toHaveLength(1))
    expect(writes(t.calls, 'savePlan')[0]![2]).toMatchObject({
      version: 2,
      monthlyPriceCents: 10900,
      perks: ['Unlimited hand washes'],
    })
    expect(writes(t.calls, 'saveTintMatrix')[0]![1]).toMatchObject({ version: 5 })
    expect(writes(t.calls, 'saveTintMatrix')[0]![1].prices[0]).toMatchObject({
      memberMinCents: 21900,
      guestMaxCents: 36900,
    })
    expect(writes(t.calls, 'saveGuestMarkup')[0]![1]).toEqual({ pct: 25, version: 3 })

    await open(t.logic, 'categories')
    call(t.logic, 'live.cats.rows.2.setLabel', 'Window tint')
    const tint = t.cat.categories.find((c: any) => c.key === 'tint')
    tint.colour = '#0E7A63'
    tint.version = 2
    await pushed(t, 'catalog')
    await vi.waitFor(() => expect(vals(t.logic).live.cats.rows[2].colour).toBe('#0E7A63'))
    expect(vals(t.logic).live.cats.rows[2]).toMatchObject({ label: 'Window tint', dirty: true })
    call(t.logic, 'live.cats.rows.2.save')
    await vi.waitFor(() => expect(writes(t.calls, 'updateCategory')).toHaveLength(1))
    expect(writes(t.calls, 'updateCategory')[0]!.slice(1, 3)).toEqual([
      'tint',
      { label: 'Window tint', colour: '#0E7A63', version: 2 },
    ])
  })

  it('an on/off made on an older copy is refused (412) and says to try again', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'categories')
    t.cat.categories[5].version = 3
    call(t.logic, 'live.cats.rows.5.toggle')
    await vi.waitFor(() => expect(vals(t.logic).live.cats.rows[5].error).toBe(STALE_ACTION_MESSAGE))
    expect(t.cat.categories[5].active).toBe(false)
  })
})
