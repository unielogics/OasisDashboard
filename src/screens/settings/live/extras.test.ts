// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// Settings → Catalog, Categories and Reminders & texts (live only, DV-317..DV-321) on the view model with the fake API:
// the sections open after their read, edits are drafts until Save, the bodies are what the server takes (cents, the
// version, whole objects), refusals are shown in the form, people without the permission get the toast and no request,
// and the reminders preview follows the draft.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { atPath } from '../testkit'
import { makeExtrasLogic, stale, validation } from './extras-testkit'

beforeAll(() => {
  process.env.TZ = 'America/New_York'
})
beforeEach(() => {
  vi.useRealTimers()
  location.hash = ''
})
afterEach(() => vi.restoreAllMocks())

const vals = (logic: any): any => logic.renderVals()
const ev = (value = '', key = '') => ({ target: { value }, key })
const call = (logic: any, path: string, value?: string, key?: string): void => {
  const fn = atPath(vals(logic), path)
  expect(typeof fn, `no handler at ${path}`).toBe('function')
  fn(ev(value, key))
}
const open = async (logic: any, section: 'catalog' | 'categories' | 'reminders'): Promise<any> => {
  logic.setState({ section })
  const key = section === 'catalog' ? 'secCatalog' : section === 'categories' ? 'secCategories' : 'secReminders'
  await vi.waitFor(() => expect(vals(logic).live[key]).toBe(true))
  return vals(logic).live
}
const writes = (calls: any[][], name: string) => calls.filter((c) => c[0] === name)

describe('Settings extras: navigation and loading', () => {
  it('the nav, the section titles, the loading card until the read answers, and nothing read before a section opens', async () => {
    const t = makeExtrasLogic()
    const v0 = vals(t.logic)
    expect(typeof v0.live.goCatalog).toBe('function')
    expect(v0.live.xnav.catalog).toMatchObject({ display: 'flex' })
    expect(t.calls.some((c) => c[0] === 'catalog' || c[0] === 'reminders')).toBe(false)
    t.logic.setState({ section: 'catalog' })
    const v1 = vals(t.logic)
    expect(v1.secTitle).toBe('Catalog')
    expect(v1.secHours).toBe(false)
    expect(v1.hoursDirty).toBe(false)
    const live = await open(t.logic, 'catalog')
    expect(live.secOpen).toBe(true)
    expect(live.secCategories).toBe(false)
    expect(vals(t.logic).live.xnav.catalog.background).not.toBe(vals(t.logic).live.xnav.reminders.background)
    call(t.logic, 'live.goReminders')
    expect(vals(t.logic).secTitle).toBe('Reminders & texts')
    await open(t.logic, 'reminders')
    expect(writes(t.calls, 'reminders')).toHaveLength(1)
  })

  it('a failed read shows the failed card; Try again reads again', async () => {
    const t = makeExtrasLogic()
    t.fail.set('catalog', new Error('down') as any)
    t.logic.setState({ section: 'catalog' })
    await vi.waitFor(() => expect(vals(t.logic).live.secFailed).toBe(true))
    t.fail.delete('catalog')
    call(t.logic, 'live.retryLoad')
    await vi.waitFor(() => expect(vals(t.logic).live.secCatalog).toBe(true))
  })
})

describe('Settings extras: Catalog', () => {
  it('lists packages and add-ons with their category, price and state; the first one is open', async () => {
    const t = makeExtrasLogic()
    const live = await open(t.logic, 'catalog')
    expect(live.cat.note).toMatch(/Change prices only here/)
    expect(live.cat.list.map((x: any) => x.name)).toEqual([
      'Signature Hand Wash',
      'Exterior Hand Wash',
      'Carbon window tint',
      'Rim powder coating',
    ])
    expect(live.cat.list[0].sub).toBe('Wash · $45')
    expect(live.cat.list[3].sub).toBe('Quote · quote only')
    expect(live.cat.svc).toMatchObject({
      title: 'Signature Hand Wash',
      meta: 'Booking charges $54 · 45 min',
      member: '45',
      guest: '',
      guestHint: 'Empty: guests pay $54 (member price + 20%).',
      dirty: false,
    })
    expect(live.cat.svc.catOpts.map((o: any) => o.label)).toEqual(['Wash', 'Add-ons', 'Tint', 'Detail', 'Quote'])
    call(t.logic, 'live.cat.kindAddon')
    expect(vals(t.logic).live.cat.svc.title).toBe('Hand wax')
    expect(vals(t.logic).live.cat.svc.vipOpts[0].style.background).toBe('var(--accent)')
  })

  it('edits stay a draft until Save; the PUT carries cents, the version and every field; the toast names it', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'catalog')
    call(t.logic, 'live.cat.svc.setMember', '47.50')
    call(t.logic, 'live.cat.svc.setGuest', '57')
    call(t.logic, 'live.cat.svc.setDescription', 'Hand wash, wheels and a quick interior.')
    call(t.logic, 'live.cat.svc.vipOpts.1.onClick')
    call(t.logic, 'live.cat.svc.setVipNote', '2× a month')
    call(t.logic, 'live.cat.svc.toggles.0.toggle')
    call(t.logic, 'live.cat.svc.sortInc')
    expect(vals(t.logic).live.cat.svc.dirty).toBe(true)
    expect(vals(t.logic).live.cat.list[0].sub).toMatch(/unsaved/)
    expect(writes(t.calls, 'saveCatalogService')).toHaveLength(0)
    call(t.logic, 'live.cat.svc.save')
    await vi.waitFor(() => expect(writes(t.calls, 'saveCatalogService')).toHaveLength(1))
    const [, id, body, opts] = writes(t.calls, 'saveCatalogService')[0]!
    expect(id).toBe('p-sig')
    expect(body).toEqual({
      category: 'wash',
      publicName: 'Signature Hand Wash',
      description: 'Hand wash, wheels and a quick interior.',
      memberPriceCents: 4750,
      guestPriceCents: 5700,
      vipInclusion: 'allowance',
      vipNote: '2× a month',
      quoteOnly: false,
      visibleOnline: false,
      sort: 11,
      version: 3,
    })
    expect(opts.idempotencyKey).toBeTruthy()
    await vi.waitFor(() => expect(t.flashes).toContain('Saved Signature Hand Wash'))
    await vi.waitFor(() => expect(vals(t.logic).live.cat.svc.dirty).toBe(false))
    expect(vals(t.logic).live.cat.svc.member).toBe('47.50')
  })

  it('Discard drops the draft; an edit back to the saved value is not dirty', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'catalog')
    call(t.logic, 'live.cat.svc.setMember', '50')
    call(t.logic, 'live.cat.svc.setMember', '45')
    expect(vals(t.logic).live.cat.svc.dirty).toBe(false)
    call(t.logic, 'live.cat.svc.setPublicName', 'Signature')
    call(t.logic, 'live.cat.svc.discard')
    expect(vals(t.logic).live.cat.svc.publicName).toBe('Signature Hand Wash')
  })

  it('what the server would refuse is said before sending; the server’s own refusal shows under the form', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'catalog')
    call(t.logic, 'live.cat.svc.setGuest', '40')
    call(t.logic, 'live.cat.svc.save')
    expect(vals(t.logic).live.cat.svc.error).toBe('The guest price can’t be lower than the member price.')
    expect(writes(t.calls, 'saveCatalogService')).toHaveLength(0)
    call(t.logic, 'live.cat.svc.setGuest', '60')
    t.fail.set('saveCatalogService', validation('There is no category "x".', 'body.category'))
    call(t.logic, 'live.cat.svc.save')
    await vi.waitFor(() => expect(vals(t.logic).live.cat.svc.error).toBe('There is no category "x".'))
    expect(vals(t.logic).live.cat.svc.dirty).toBe(true)
    t.fail.set('saveCatalogService', stale())
    call(t.logic, 'live.cat.svc.save')
    await vi.waitFor(() => expect(vals(t.logic).live.cat.svc.error).toMatch(/^Someone else saved a change meanwhile/))
    expect(vals(t.logic).live.cat.svc.guest).toBe('60')
  })

  it('without “Services, pricing & checklists” an edit is refused with the toast and nothing is sent', async () => {
    const t = makeExtrasLogic('support')
    await open(t.logic, 'catalog')
    call(t.logic, 'live.cat.svc.setMember', '1')
    expect(t.flashes).toContain('Your role can’t edit packages and checklists')
    expect(vals(t.logic).live.cat.svc.member).toBe('45')
    call(t.logic, 'live.cat.markup.inc')
    call(t.logic, 'live.cat.plans.0.setMonthly', '1')
    expect(t.calls.filter((c) => /^save|^create|^update|^delete/.test(c[0] as string))).toEqual([])
  })

  it('guest markup: steps of 5, saved with its version', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'catalog')
    expect(vals(t.logic).live.cat.markup).toMatchObject({ val: '20%', dirty: false })
    expect(vals(t.logic).live.cat.markup.feeLine).toBe('Online booking fee for guests: $25 (members pay none).')
    call(t.logic, 'live.cat.markup.inc')
    expect(vals(t.logic).live.cat.markup).toMatchObject({ val: '25%', dirty: true })
    call(t.logic, 'live.cat.markup.save')
    await vi.waitFor(() => expect(writes(t.calls, 'saveGuestMarkup')).toHaveLength(1))
    expect(writes(t.calls, 'saveGuestMarkup')[0]![1]).toEqual({ pct: 25, version: 2 })
    await vi.waitFor(() => expect(t.flashes).toContain('Guest prices saved · member price + 25%'))
  })

  it('plans: label, monthly price, perks one per line and the checkout link (squarespace.com only)', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'catalog')
    const p = vals(t.logic).live.cat.plans
    expect(p.map((x: any) => x.title)).toEqual(['Gold', 'VIP'])
    expect(p[0].sub).toBe('Premium plan · the website’s Gold plan')
    call(t.logic, 'live.cat.plans.0.setUrl', 'https://evil.example/checkout')
    call(t.logic, 'live.cat.plans.0.save')
    expect(vals(t.logic).live.cat.plans[0].error).toBe('The checkout link must be on squarespace.com.')
    expect(writes(t.calls, 'savePlan')).toHaveLength(0)
    call(t.logic, 'live.cat.plans.0.setUrl', 'https://oasis.squarespace.com/checkout/gold')
    call(t.logic, 'live.cat.plans.0.setPerks', '4 hand washes a month\n\nFree tire shine')
    call(t.logic, 'live.cat.plans.0.setMonthly', '109')
    call(t.logic, 'live.cat.plans.0.save')
    await vi.waitFor(() => expect(writes(t.calls, 'savePlan')).toHaveLength(1))
    expect(writes(t.calls, 'savePlan')[0]!.slice(1, 3)).toEqual([
      'premium',
      {
        publicLabel: 'Gold',
        monthlyPriceCents: 10900,
        perks: ['4 hand washes a month', 'Free tire shine'],
        checkoutUrl: 'https://oasis.squarespace.com/checkout/gold',
        version: 1,
      },
    ])
    await vi.waitFor(() => expect(t.flashes).toContain('Saved the Gold plan'))
  })

  it('tint table: every vehicle × film row; a filled row is sent whole, an empty one left out', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'catalog')
    const tint = vals(t.logic).live.cat.tint
    expect(tint.has).toBe(true)
    expect(tint.rows.map((r: any) => r.label)).toEqual(['Sedan / coupe · Carbon', 'SUV / crossover · Carbon'])
    expect(tint.films[0].label).toBe('Carbon: 5%, 20%, 35% shade')
    call(t.logic, 'live.cat.tint.rows.1.setMemberMin', '259')
    call(t.logic, 'live.cat.tint.save')
    expect(vals(t.logic).live.cat.tint.error).toMatch(/fill all four/)
    call(t.logic, 'live.cat.tint.rows.1.setMemberMax', '329')
    call(t.logic, 'live.cat.tint.rows.1.setGuestMin', '309')
    call(t.logic, 'live.cat.tint.rows.1.setGuestMax', '395')
    call(t.logic, 'live.cat.tint.save')
    await vi.waitFor(() => expect(writes(t.calls, 'saveTintMatrix')).toHaveLength(1))
    const body = writes(t.calls, 'saveTintMatrix')[0]![1] as any
    expect(body.version).toBe(4)
    expect(body.prices).toHaveLength(2)
    expect(body.prices[1]).toEqual({
      vehicle: 'suv_crossover',
      film: 'carbon',
      memberMinCents: 25900,
      memberMaxCents: 32900,
      guestMinCents: 30900,
      guestMaxCents: 39500,
    })
    await vi.waitFor(() => expect(vals(t.logic).live.cat.tint.dirty).toBe(false))
  })
})

describe('Settings extras: Categories', () => {
  it('rows in order with their key, use and state; built-in ones cannot be removed', async () => {
    const t = makeExtrasLogic()
    const live = await open(t.logic, 'categories')
    expect(live.cats.rows.map((r: any) => r.label)).toEqual(['Wash', 'Add-ons', 'Tint', 'Detail', 'Quote', 'Polish'])
    expect(live.cats.rows[0].keyLine).toBe('Key wash · built in · 2 active services')
    expect(live.cats.rows[5].keyLine).toBe('Key polish · 0 active services · off: hidden from the website')
    expect(live.cats.rows.map((r: any) => r.canRemove)).toEqual([false, false, false, false, false, true])
    expect(live.cats.rows[0].swatch.background).toBe('#1FB6FF')
  })

  it('rename and recolour are a draft saved with the version; a swatch sets the colour', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'categories')
    call(t.logic, 'live.cats.rows.2.setLabel', 'Window tint')
    call(t.logic, 'live.cats.rows.2.swatches.6.onClick')
    expect(vals(t.logic).live.cats.rows[2]).toMatchObject({ dirty: true, colour: '#7A3B8A' })
    call(t.logic, 'live.cats.rows.2.save')
    await vi.waitFor(() => expect(writes(t.calls, 'updateCategory')).toHaveLength(1))
    expect(writes(t.calls, 'updateCategory')[0]!.slice(1, 3)).toEqual([
      'tint',
      { label: 'Window tint', colour: '#7A3B8A', version: 1 },
    ])
    await vi.waitFor(() => expect(t.flashes).toContain('Saved Window tint'))
    await vi.waitFor(() => expect(vals(t.logic).live.cats.rows[2].dirty).toBe(false))
  })

  it('a typed colour must be a #RRGGBB', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'categories')
    call(t.logic, 'live.cats.rows.0.setColour', 'blue')
    call(t.logic, 'live.cats.rows.0.save')
    expect(vals(t.logic).live.cats.rows[0].error).toMatch(/colour/)
    expect(writes(t.calls, 'updateCategory')).toHaveLength(0)
    call(t.logic, 'live.cats.rows.0.setColour', '0e7a63')
    call(t.logic, 'live.cats.rows.0.save')
    await vi.waitFor(() => expect(writes(t.calls, 'updateCategory')).toHaveLength(1))
    expect((writes(t.calls, 'updateCategory')[0]![2] as any).colour).toBe('#0E7A63')
  })

  it('on/off, order and remove save at once', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'categories')
    call(t.logic, 'live.cats.rows.5.toggle')
    await vi.waitFor(() => expect(writes(t.calls, 'updateCategory')).toHaveLength(1))
    expect(writes(t.calls, 'updateCategory')[0]![2]).toEqual({ active: true, version: 2 })
    await vi.waitFor(() => expect(t.flashes).toContain('Polish is on'))
    call(t.logic, 'live.cats.rows.1.down')
    await vi.waitFor(() => expect(writes(t.calls, 'updateCategory')).toHaveLength(3))
    expect(writes(t.calls, 'updateCategory').slice(1).map((c) => [c[1], (c[2] as any).sort])).toEqual([
      ['addons', 30],
      ['tint', 20],
    ])
    await vi.waitFor(() => expect(vals(t.logic).live.cats.rows[5].keyLine).not.toMatch(/off/))
    call(t.logic, 'live.cats.rows.5.remove')
    await vi.waitFor(() => expect(writes(t.calls, 'deleteCategory')).toHaveLength(1))
    expect(writes(t.calls, 'deleteCategory')[0]!.slice(1, 3)).toEqual(['polish', 3])
  })

  it('a refused removal (in use) is toasted with the server’s words', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'categories')
    const e = validation('Polish is still used by 2 services.')
    ;(e as any).status = 409
    t.fail.set('deleteCategory', e)
    call(t.logic, 'live.cats.rows.5.remove')
    await vi.waitFor(() => expect(t.flashes).toContain('Polish is still used by 2 services.'))
  })

  it('add: the key comes from the name, mixed and taken names are refused, Enter adds', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'categories')
    expect(vals(t.logic).live.cats.add.open).toBe(false)
    call(t.logic, 'live.cats.add.start')
    expect(vals(t.logic).live.cats.add.canAdd).toBe(false)
    call(t.logic, 'live.cats.add.setLabel', 'Mixed')
    call(t.logic, 'live.cats.add.save')
    expect(vals(t.logic).live.cats.add.error).toMatch(/Mixed/)
    call(t.logic, 'live.cats.add.setLabel', 'Tint')
    call(t.logic, 'live.cats.add.save')
    expect(vals(t.logic).live.cats.add.error).toMatch(/already/)
    call(t.logic, 'live.cats.add.setLabel', 'Paint correction')
    expect(vals(t.logic).live.cats.add.keyLine).toBe('Key: paint_correction (set once, never changes)')
    call(t.logic, 'live.cats.add.onKey', '', 'Enter')
    await vi.waitFor(() => expect(writes(t.calls, 'createCategory')).toHaveLength(1))
    expect(writes(t.calls, 'createCategory')[0]![1]).toEqual({
      key: 'paint_correction',
      label: 'Paint correction',
      colour: '#0E7A63',
    })
    await vi.waitFor(() => expect(vals(t.logic).live.cats.add.open).toBe(false))
    expect(t.flashes).toContain('Added Paint correction')
  })
})

describe('Settings extras: Reminders & texts', () => {
  it('shows the saved settings, quiet hours, a prep line per active category and the preview of the exact texts', async () => {
    const t = makeExtrasLogic()
    const live = await open(t.logic, 'reminders')
    expect(live.rem.quiet).toBe('Quiet hours are on: texts wait from 9:00 PM to 8:00 AM.')
    expect(live.rem.offsets.map((o: any) => o.label)).toEqual(['24 hours before', '2 hours before'])
    expect(live.rem.addOpts.map((o: any) => o.label)).toEqual([
      '+ 1 week',
      '+ 3 days',
      '+ 2 days',
      '+ 12 h',
      '+ 4 h',
      '+ 1 h',
      '+ 30 min',
    ])
    expect(live.rem.prep.map((p: any) => p.label)).toEqual(['Wash', 'Add-ons', 'Tint', 'Detail', 'Quote'])
    expect(live.rem.status.map((s: any) => s.label)).toEqual([
      'Checked in',
      'Running late',
      'Ready for pickup',
      'Picked up',
      'Book-again link in the thank-you',
    ])
    expect(live.rem.status[1].steppers.map((x: any) => x.val)).toEqual(['10 min', 'at most 2'])
    expect(live.rem.leads[0].steppers.map((x: any) => x.val)).toEqual(['3 h', '24 h of their last text'])
    await vi.waitFor(() => expect(vals(t.logic).live.rem.texts.length).toBe(3))
    const texts = vals(t.logic).live.rem.texts
    expect(texts[0].text).toMatch(/Reply C to confirm/)
    expect(texts[2].meta).toBe('2 texts · special characters (shorter texts)')
    expect(vals(t.logic).live.rem.previewNote).toMatch(/^Sample: Maria, Sun, Jun 14 at 10:00 AM/)
    expect(vals(t.logic).live.rem.dirty).toBe(false)
  })

  it('edits are a draft with the Save bar; the preview follows the draft; Save sends every group with the version', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'reminders')
    await vi.waitFor(() => expect(writes(t.calls, 'previewReminders')).toHaveLength(1))
    call(t.logic, 'live.rem.offsets.1.remove')
    call(t.logic, 'live.rem.addOpts.0.onClick')
    call(t.logic, 'live.rem.toggles.0.toggle')
    call(t.logic, 'live.rem.prep.2.set', 'Plan for 2–3 hours.')
    call(t.logic, 'live.rem.status.0.steppers.0.inc')
    call(t.logic, 'live.rem.leads.0.steppers.0.dec')
    call(t.logic, 'live.rem.leads.1.toggle')
    expect(vals(t.logic).live.rem.dirty).toBe(true)
    await vi.waitFor(() => expect(writes(t.calls, 'previewReminders').length).toBeGreaterThan(1))
    const last = writes(t.calls, 'previewReminders').at(-1)![1] as any
    expect(last.draft.reminders.offsetsMin).toEqual([10080, 1440])
    expect('version' in last.draft).toBe(false)
    call(t.logic, 'live.rem.save')
    await vi.waitFor(() => expect(writes(t.calls, 'saveReminders')).toHaveLength(1))
    expect(writes(t.calls, 'saveReminders')[0]![1]).toEqual({
      reminders: {
        offsetsMin: [10080, 1440],
        confirmRequest: false,
        categoryPrep: { tint: 'Plan for 2–3 hours.' },
        reviewRequest: false,
      },
      statusTexts: {
        checkedIn: true,
        checkedInDelayMin: 4,
        runningLate: true,
        lateGraceMin: 10,
        lateMax: 2,
        ready: true,
        pickedUp: true,
        bookAgainLink: false,
      },
      leads: { followUpEnabled: true, followUpDelayMin: 150, businessHoursOnly: false, withinHours: 24 },
      version: 16,
    })
    await vi.waitFor(() => expect(t.flashes).toContain('Reminders saved · the next texts use them'))
    await vi.waitFor(() => expect(vals(t.logic).live.rem.dirty).toBe(false))
  })

  it('at most five reminders; Discard brings the saved ones back', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'reminders')
    for (let i = 0; i < 3; i++) call(t.logic, 'live.rem.addOpts.0.onClick')
    expect(vals(t.logic).live.rem.offsets).toHaveLength(5)
    expect(vals(t.logic).live.rem.canAdd).toBe(false)
    call(t.logic, 'live.rem.discard')
    expect(vals(t.logic).live.rem.offsets).toHaveLength(2)
  })

  it('a refused save shows the server’s words in the Save bar and keeps the draft', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'reminders')
    call(t.logic, 'live.rem.prep.0.set', 'Bring the keys.')
    t.fail.set('saveReminders', validation('There is no category "x".', 'reminders.categoryPrep.x'))
    call(t.logic, 'live.rem.save')
    await vi.waitFor(() => expect(vals(t.logic).live.rem.error).toBe('There is no category "x".'))
    expect(vals(t.logic).live.rem.dirty).toBe(true)
  })

  it('a prep line over 160 characters is stopped before sending', async () => {
    const t = makeExtrasLogic()
    await open(t.logic, 'reminders')
    call(t.logic, 'live.rem.prep.2.set', 'x'.repeat(161))
    expect(vals(t.logic).live.rem.prep[2].error).toBe('At most 160 characters (161 now).')
    call(t.logic, 'live.rem.save')
    expect(vals(t.logic).live.rem.error).toBe('Tint: At most 160 characters (161 now).')
    expect(writes(t.calls, 'saveReminders')).toHaveLength(0)
  })

  it('without “Working hours & holidays” the reminders cannot change', async () => {
    const t = makeExtrasLogic('support')
    await open(t.logic, 'reminders')
    call(t.logic, 'live.rem.toggles.0.toggle')
    expect(t.flashes).toContain('Your role can’t change hours and closures')
    expect(vals(t.logic).live.rem.dirty).toBe(false)
  })
})

describe('Settings extras: Packages & checklists', () => {
  it('says where prices are edited and opens Catalog', async () => {
    const t = makeExtrasLogic()
    const v = vals(t.logic)
    expect(v.live.svcPriceNote).toMatch(/^Prices are set in Catalog/)
    expect(v.live.svcPriceNote).toMatch(/A service without a member price keeps charging its last price\.$/)
    v.live.goCatalog()
    expect(t.logic.state.section).toBe('catalog')
  })
})
