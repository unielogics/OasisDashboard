/* eslint-disable @typescript-eslint/no-explicit-any */
// LiveData against a fake SettingsApi that serves responses captured from the real API: reads and revisions, the
// commands each member sends (verb, body, version), the hours/rules version token, the debounced checklist with task
// ids, the emergency and closure previews, and what happens when the server says no.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSession } from '@/auth/test-fixtures'
import { ApiError } from '@/data/http/problem'
import { makeQueryClient } from '@/data/query'
import { DEFAULT_EMERGENCY_MESSAGE } from '@/lib/settings'
import type { Emergency } from '@/lib/settings'
import bundle from './__fixtures__/bundle.json'
import roles from './__fixtures__/roles.json'
import type { LiveData } from './LiveData'
import { LiveData as LiveDataClass } from './LiveData'
import { setup } from './testkit'
import type { Call } from './testkit'

const names = (calls: Call[]): string[] => calls.map((c) => c[0])
const loaded = async (d: LiveData, part = 'hours'): Promise<any> => {
  let m: any
  await vi.waitFor(() => {
    m = d.sync()
    expect(m?.[part]).toBeTruthy()
  })
  return m
}

beforeEach(() => {
  vi.useRealTimers()
})
afterEach(() => vi.restoreAllMocks())

describe('reading', () => {
  it('loads the whole screen with one bundle call and serves every section from it', async () => {
    const { data, calls } = setup()
    expect(data.sync()).toEqual({})
    expect(data.status()).toBe('loading')
    const m = await loaded(data, 'services')
    expect(names(calls).filter((n) => n === 'bundle')).toHaveLength(1)
    for (const part of ['hours', 'closures', 'emergency', 'vip', 'arrival', 'services', 'roles', 'employees'])
      await loaded(data, part)
    expect(names(calls)).not.toContain('hours')
    expect(names(calls)).not.toContain('closures')
    expect(m.hours.data.hours).toHaveLength(7)
    expect(data.status()).toBe('ready')
    expect(Object.keys(data.sync()!.services!.data.packages)).toHaveLength(9)
  })

  it('keeps a part’s revision until the data changes, and bumps it when a reload is asked for', async () => {
    const { data } = setup()
    const first = (await loaded(data)).hours.rev
    expect(data.sync()!.hours!.rev).toBe(first)
    data.reload(['hours'])
    expect(data.sync()!.hours!.rev).not.toBe(first)
  })

  it('does not ask for the team when the caller cannot see it', async () => {
    const { data, calls } = setup({ role: 'crew' })
    const m = await loaded(data)
    expect(m.roles).toBeUndefined()
    expect(m.employees).toBeUndefined()
    expect(names(calls)).not.toContain('roles')
    expect(names(calls)).not.toContain('employees')
    expect(data.locked('employees')).toBe(true)
    expect(data.locked('roles')).toBe(true)
    expect(data.locked('emergency')).toBe(true)
    expect(data.locked('vip')).toBe(true)
    expect(data.locked('hours')).toBe(false)
    expect(data.locked('services')).toBe(false)
    expect(data.locked('arrival')).toBe(false)
  })

  it('a Support person reads the team and VIP but not the emergency closing', () => {
    const { data } = setup({ role: 'support' })
    expect(data.locked('employees')).toBe(false)
    expect(data.locked('roles')).toBe(false)
    expect(data.locked('vip')).toBe(false)
    expect(data.locked('emergency')).toBe(true)
  })

  it('fails when the first load fails and recovers on reload', async () => {
    const { data, fail } = setup()
    fail.set('bundle', new ApiError({ status: 500, title: 'Boom' }))
    data.sync()
    await vi.waitFor(() => expect(data.status()).toBe('failed'))
    fail.delete('bundle')
    data.reload()
    await loaded(data)
    expect(data.status()).toBe('ready')
  })

  it('knows the signed-in person', () => {
    const { data } = setup({ role: 'super' })
    expect(data.access().userShort).toBe('Rafael M.')
    expect(data.access().isSuper).toBe(true)
    expect(data.access().can('set.emergency')).toBe(true)
    expect(setup({ role: 'mgmt' }).data.access().isSuper).toBe(false)
    expect(setup({ role: 'crew' }).data.access().can('team.view')).toBe(false)
  })
})

describe('invalidations from the stream', () => {
  it('an invalidation that arrives while a refetch is on its way is not lost', async () => {
    const { data, api, qc, bundle } = setup()
    data.subscribe(() => {})
    await loaded(data, 'closures')
    const real = api.closures.bind(api)
    const gates: (() => void)[] = []
    let served = 0
    api.closures = async () => {
      const mine = ++served
      const snapshot = await real() // what the server holds at the moment the request is served
      await new Promise<void>((resolve) => gates.push(resolve))
      return mine === 1 ? snapshot : await real()
    }
    // first event: the section is refetched at once (the screen is open)
    void qc.invalidateQueries({ queryKey: ['settings', 'closures'] })
    await vi.waitFor(() => expect(gates).toHaveLength(1))
    // somebody deletes a closure and a second event arrives while that fetch is still waiting
    bundle.closures.upcoming.shift()
    void qc.invalidateQueries({ queryKey: ['settings', 'closures'] })
    await vi.waitFor(() => expect(gates).toHaveLength(2))
    gates[0]!() // the cancelled fetch's answer is dropped
    gates[1]!()
    await vi.waitFor(() => {
      const m = data.sync()!
      expect(m.closures!.data.closures.some((c: any) => c.name === 'Thanksgiving')).toBe(false)
    })
  })
})

describe('hours and rules', () => {
  it('saves the week on the current version, adopts the new one and words the warnings', async () => {
    const { data, calls, toasts } = setup()
    const m = await loaded(data)
    const r = await data.saveHours(m.hours.data.hours)
    expect(r).toEqual({ ok: true, value: { note: '1 employee schedule no longer fits' } })
    const call = calls.find((c) => c[0] === 'saveHours')!
    expect((call[1] as any).version).toBe(1)
    expect((call[1] as any).days).toHaveLength(7)
    // the next save (or rule) carries the version the server answered with
    await data.saveRule('slot', 15)
    expect(calls.find((c) => c[0] === 'saveRules')![1] as any).toMatchObject({ slot: 15, version: 2 })
    expect(toasts).toEqual([])
  })

  it('runs hours and rule saves one at a time, in the order they were asked for', async () => {
    const { data, calls } = setup()
    await loaded(data)
    const order: string[] = []
    const a = data.saveRule('buffer', 15).then(() => order.push('rule'))
    const b = data.saveHours((await loaded(data)).hours.data.hours).then(() => order.push('hours'))
    await Promise.all([a, b])
    expect(order).toEqual(['rule', 'hours'])
    expect(names(calls).filter((n) => n === 'saveRules' || n === 'saveHours')).toEqual([
      'saveRules',
      'saveHours',
    ])
    expect((calls.find((c) => c[0] === 'saveHours')![1] as any).version).toBe(2)
  })

  it('a refused save answers not ok, toasts the server’s message and forgets the version', async () => {
    const { data, fail, toasts } = setup()
    await loaded(data)
    fail.set(
      'saveHours',
      new ApiError({
        status: 422,
        title: 'Check the hours',
        detail: 'Tuesday: closing time must be after opening time.',
      }),
    )
    const r = await data.saveHours((await loaded(data)).hours.data.hours)
    expect(r).toEqual({ ok: false })
    expect(toasts).toEqual([
      { title: 'Check the hours', desc: 'Tuesday: closing time must be after opening time.' },
    ])
  })

  it('a 403 toasts "Your role can’t …"', async () => {
    const { data, fail, toasts } = setup()
    await loaded(data)
    fail.set(
      'saveRules',
      new ApiError({ status: 403, code: 'FORBIDDEN', title: 'Forbidden', meta: { required: 'set.hours' } }),
    )
    expect(await data.saveRule('slot', 60)).toBe(false)
    expect(toasts).toEqual([{ title: 'Your role can’t change hours and closures' }])
  })
})

describe('closures', () => {
  it('creates, mapping the closure the server returned', async () => {
    const { data, calls } = setup()
    await loaded(data)
    const r = await data.createClosure({
      date: '2026-12-01',
      name: ' Staff day ',
      type: 'closed',
      from: '10:00 AM',
      to: '2:00 PM',
    })
    expect(r.ok && r.value).toMatchObject({ id: 'new-closure', name: 'Staff day', date: '2026-12-01' })
    expect(calls.find((c) => c[0] === 'createClosure')![1]).toEqual({
      date: '2026-12-01',
      name: 'Staff day',
      type: 'closed',
      notify: true,
    })
  })

  it('answers a validation error inline (design wording) and does not toast it', async () => {
    const { data, fail, toasts } = setup()
    await loaded(data)
    fail.set(
      'createClosure',
      new ApiError({
        status: 422,
        code: 'CLOSURE_DATE_TAKEN',
        title: 'Check the form',
        detail: "There's already a closure on that date.",
      }),
    )
    const r = await data.createClosure({ date: '2026-12-01', name: 'X', type: 'closed', from: '', to: '' })
    expect(r).toEqual({ ok: false, message: 'There’s already a closure on that date.' })
    expect(toasts).toEqual([])
  })

  it('toasts anything that is not a validation error', async () => {
    const { data, fail, toasts } = setup()
    await loaded(data)
    fail.set(
      'createClosure',
      new ApiError({ status: 403, code: 'FORBIDDEN', title: 'Forbidden', meta: { required: 'set.hours' } }),
    )
    expect(
      await data.createClosure({ date: '2026-12-01', name: 'X', type: 'closed', from: '', to: '' }),
    ).toEqual({ ok: false })
    expect(toasts).toEqual([{ title: 'Your role can’t change hours and closures' }])
  })

  it('patches notify, deletes, and sets the federal toggle', async () => {
    const { data, calls } = setup()
    await loaded(data)
    expect(await data.setClosureNotify('c1', false)).toBe(true)
    expect(await data.removeClosure('c1')).toBe(true)
    expect(await data.setFederal(false)).toBe(true)
    expect(calls.find((c) => c[0] === 'patchClosure')!.slice(1, 3)).toEqual(['c1', { notify: false }])
    expect(calls.find((c) => c[0] === 'deleteClosure')![1]).toBe('c1')
    expect(calls.find((c) => c[0] === 'setFederal')![1]).toBe(false)
  })

  it('counts who is booked for the add form once, a moment after the date settles', async () => {
    const { data, calls } = setup()
    await loaded(data)
    const nc = { date: '2999-01-01', name: '', type: 'closed' as const, from: '10:00 AM', to: '2:00 PM' }
    expect(data.closureAffected(nc)).toBe('')
    expect(data.closureAffected({ ...nc, date: '2999-01-02' })).toBe('')
    await vi.waitFor(() =>
      expect(data.closureAffected({ ...nc, date: '2999-01-02' })).toMatch(/^2 customers are booked/),
    )
    expect(calls.filter((c) => c[0] === 'previewClosure')).toHaveLength(1)
    expect((calls.find((c) => c[0] === 'previewClosure')![1] as any).date).toBe('2999-01-02')
    expect(data.closureAffected({ ...nc, date: '2000-01-01' })).toBe('')
  })
})

describe('emergency', () => {
  const em: Emergency = {
    active: false,
    summary: '',
    reason: 'Severe weather',
    dur: 'today',
    until: '2:00 PM',
    through: '2026-06-15',
    notify: true,
    link: true,
    credits: true,
    pause: true,
    crew: true,
    msg: DEFAULT_EMERGENCY_MESSAGE,
  }

  it('reads the strip, the access line and idle counters from the server', async () => {
    const { data } = setup()
    await loaded(data, 'emergency')
    expect(data.emergencyStrip()).toMatch(/appointments? left today/)
    expect(data.emergencyAccess()).toEqual({
      canClose: true,
      requirement: 'Requires Management or Super Admin',
    })
    expect(data.emergencyCounters(em)).toEqual({ notified: '0', rebooked: '0', booking: 'Paused' })
  })

  it('previews only while the section is open and only for the latest form state', async () => {
    const { data, calls } = setup()
    await loaded(data, 'emergency')
    // not visible: no request, the client-rendered message
    const hidden = data.emergencyPreview(em, false)
    expect(hidden.message).toContain('Hi Liam, due to severe weather')
    await new Promise((r) => setTimeout(r, 40))
    expect(names(calls)).not.toContain('previewEmergency')
    // typing: every call replaces the last, one request goes out
    data.emergencyPreview({ ...em, msg: 'a' }, true)
    data.emergencyPreview({ ...em, msg: 'ab' }, true)
    data.emergencyPreview({ ...em, msg: 'abc' }, true)
    await vi.waitFor(() =>
      expect(data.emergencyPreview({ ...em, msg: 'abc' }, true).message).toBe('Hi Liam, from the server'),
    )
    const sent = calls.filter((c) => c[0] === 'previewEmergency')
    expect(sent).toHaveLength(1)
    expect((sent[0]![1] as any).message).toBe('abc')
    expect(data.emergencyPreview({ ...em, msg: 'abc' }, true)).toMatchObject({
      count: 1,
      first: 'Liam',
      affected: [{ time: '10:45 AM', name: 'Liam Chen', veh: 'BMW' }],
    })
  })

  it('leaving the section before the request goes out cancels it', async () => {
    const { data, calls } = setup()
    await loaded(data, 'emergency')
    data.emergencyPreview({ ...em, msg: 'zzz' }, true)
    data.emergencyPreview({ ...em, msg: 'zzz' }, false)
    await new Promise((r) => setTimeout(r, 50))
    expect(names(calls)).not.toContain('previewEmergency')
  })

  it('a refused preview toasts once and keeps the client message', async () => {
    const { data, fail, toasts, calls } = setup()
    await loaded(data, 'emergency')
    fail.set(
      'previewEmergency',
      new ApiError({ status: 422, title: 'Already closed', detail: 'Choose Multiple days' }),
    )
    data.emergencyPreview(em, true)
    await vi.waitFor(() => expect(toasts).toHaveLength(1))
    expect(toasts[0]).toEqual({ title: 'Already closed', desc: 'Choose Multiple days' })
    expect(data.emergencyPreview(em, true).message).toContain('Hi Liam, due to severe weather')
    await new Promise((r) => setTimeout(r, 40))
    expect(calls.filter((c) => c[0] === 'previewEmergency')).toHaveLength(1)
  })

  it('closes with the screen’s Idempotency-Key and the form’s fields, then reopens', async () => {
    const { data, calls } = setup()
    await loaded(data, 'emergency')
    const r = await data.close({ ...em, dur: 'until' }, 'close-key-123456')
    expect(r).toEqual({
      ok: true,
      value: { summary: 'Severe weather · closed for the rest of today', notified: 3 },
    })
    const call = calls.find((c) => c[0] === 'closeShop')!
    expect(call[1]).toMatchObject({ reason: 'Severe weather', dur: 'until', until: '2:00 PM', notify: true })
    expect((call[2] as any).idempotencyKey).toBe('close-key-123456')
    const back = await data.reopen(em)
    expect(back.ok && back.value.reason).toBe('Severe weather')
    expect(names(calls)).toContain('reopen')
  })

  it('a refused close answers not ok with the server’s toast', async () => {
    const { data, fail, toasts } = setup()
    await loaded(data, 'emergency')
    fail.set(
      'closeShop',
      new ApiError({
        status: 409,
        code: 'EMERGENCY_ACTIVE',
        title: 'Already closed',
        detail: 'An emergency closure is already active',
      }),
    )
    expect(await data.close(em, 'k-12345678')).toEqual({ ok: false })
    expect(toasts).toEqual([{ title: 'Already closed', desc: 'An emergency closure is already active' }])
  })
})

describe('employees', () => {
  const draftOf = async (data: LiveData) => {
    const e = await data.employee('x')
    return { ...e!, roles: [...e!.roles] }
  }

  it('loads the full record for the drawer', async () => {
    const { data } = setup()
    const e = await data.employee('anyone')
    expect(e).toMatchObject({ first: 'Sofia', overrides: { 'sched.override': 'allow' } })
    expect(e!.sched).toHaveLength(7)
  })

  it('creates with the draft’s fields and returns the saved record', async () => {
    const { data, calls } = setup()
    await loaded(data, 'roles')
    const draft = { ...(await draftOf(data)), id: null }
    const r = await data.saveEmployee(draft, null)
    expect(r.ok).toBe(true)
    const body = calls.find((c) => c[0] === 'createEmployee')![1] as any
    expect(body).toMatchObject({
      first: 'Sofia',
      employmentType: 'full_time',
      payType: 'hourly',
      overrides: { 'sched.override': 'allow' },
    })
    expect(body.schedule).toHaveLength(7)
  })

  it('updates with If-Match on the draft’s version and applies deactivate afterwards', async () => {
    const { data, calls } = setup()
    const draft = { ...(await draftOf(data)), status: 'inactive' as const }
    const r = await data.saveEmployee(draft, { ...draft, status: 'active' })
    expect(r.ok).toBe(true)
    const names_ = names(calls)
    expect(names_.indexOf('updateEmployee')).toBeLessThan(names_.indexOf('deactivateEmployee'))
    expect(calls.find((c) => c[0] === 'updateEmployee')![2]).toBe(1)
  })

  it('reactivates someone who was inactive', async () => {
    const { data, calls } = setup()
    const draft = { ...(await draftOf(data)), status: 'active' as const }
    await data.saveEmployee(draft, { ...draft, status: 'inactive' })
    expect(names(calls)).toContain('reactivateEmployee')
    expect(names(calls)).not.toContain('deactivateEmployee')
  })

  it('shows a validation error inline with the tab it belongs to and no toast', async () => {
    const { data, fail, toasts } = setup()
    fail.set(
      'createEmployee',
      new ApiError({
        status: 422,
        title: 'Check the form',
        detail: 'Sunday: availability must sit inside business hours (9:00 AM – 3:00 PM).',
        errors: [{ path: 'body.schedule', message: 'x' }],
      }),
    )
    const r = await data.saveEmployee({ ...(await draftOf(data)), id: null }, null)
    expect(r).toEqual({
      ok: false,
      message: 'Sunday: availability must sit inside business hours (9:00 AM – 3:00 PM).',
      tab: 'sched',
    })
    expect(toasts).toEqual([])
  })

  it('a 403 is a toast, not an inline error', async () => {
    const { data, fail, toasts } = setup()
    fail.set(
      'createEmployee',
      new ApiError({ status: 403, code: 'FORBIDDEN', title: 'Forbidden', meta: { required: 'team.edit' } }),
    )
    const r = await data.saveEmployee({ ...(await draftOf(data)), id: null }, null)
    expect(r).toEqual({ ok: false, message: '' })
    expect(toasts).toEqual([{ title: 'Your role can’t edit employees' }])
  })

  it('the default role is Crew’s id once the roles are loaded', async () => {
    const { data } = setup()
    expect(data.defaultRole()).toBe('crew')
    await loaded(data, 'roles')
    const crew = (roles as any).roles.find((r: any) => r.key === 'crew').id
    expect(data.defaultRole()).toBe(crew)
  })
})

describe('roles', () => {
  it('sends a permission toggle and a limit in dollars', async () => {
    const { data, calls } = setup({ role: 'super' })
    await loaded(data, 'roles')
    expect(await data.setPermission('r1', 'cli.export', true)).toBe(true)
    expect(await data.setLimit('r1', 'refund', 500)).toBe(true)
    expect(await data.setLimit('r1', 'credit', null)).toBe(true)
    expect(calls.find((c) => c[0] === 'setPermission')!.slice(1, 4)).toEqual(['r1', 'cli.export', true])
    expect(calls.filter((c) => c[0] === 'setLimit').map((c) => c.slice(1, 4))).toEqual([
      ['r1', 'refund', 500],
      ['r1', 'credit', null],
    ])
  })

  it('a Super-only refusal is a toast with the server’s words', async () => {
    const { data, fail, toasts } = setup()
    await loaded(data, 'roles')
    fail.set(
      'setLimit',
      new ApiError({
        status: 403,
        code: 'SUPER_ONLY',
        title: 'Super Admin only',
        detail: 'Only a Super Admin can do that',
      }),
    )
    expect(await data.setLimit('r1', 'refund', 500)).toBe(false)
    expect(toasts).toEqual([{ title: 'Super Admin only', desc: 'Only a Super Admin can do that' }])
  })

  it('adds a custom role and returns it with its grants and limits', async () => {
    const { data, calls } = setup()
    await loaded(data, 'roles')
    const r = await data.addRole()
    expect(names(calls)).toContain('createRole')
    expect(r.ok).toBe(true)
    const v = (r as any).value
    expect(v.role).toEqual({
      id: 'custom-role',
      name: 'Shift Lead',
      desc: 'Custom role — starts from Crew.',
      custom: true,
    })
    expect(v.perms['sched.edit']).toBe(true)
    expect(v.perms['jobs.status']).toBe(true)
    expect(v.limits).toEqual({ refund: 25, adjust: 25, credit: 25 })
  })

  it('removes a role', async () => {
    const { data, calls } = setup()
    await loaded(data, 'roles')
    expect(await data.removeRole('r9')).toBe(true)
    expect(calls.find((c) => c[0] === 'deleteRole')![1]).toBe('r9')
  })
})

describe('VIP and arrival', () => {
  it('sends the changed VIP keys (cadence labels as keys) and the arrival keys', async () => {
    const { data, calls } = setup()
    await loaded(data, 'vip')
    expect(await data.saveVip('vip', { windowVip: 37 })).toBe(true)
    expect(await data.saveVip('vip', { cadences: ['Weekly', 'Monthly'] })).toBe(true)
    expect(await data.saveVip('arrival', { radius: 500 })).toBe(true)
    expect(calls.filter((c) => c[0] === 'saveVip').map((c) => c[1])).toEqual([
      { windowVip: 37 },
      { cadences: ['weekly', 'monthly'] },
    ])
    expect(calls.find((c) => c[0] === 'saveArrival')![1]).toEqual({ radius: 500 })
  })

  it('adds a hold by weekday and time and removes one by the id the server gave it', async () => {
    const { data, calls } = setup()
    await loaded(data, 'vip')
    await data.addHold({ d: 6, t: '11:00 AM' })
    expect(calls.find((c) => c[0] === 'addHold')![1]).toEqual({ weekday: 6, time: '11:00 AM' })
    const held = (bundle as any).vip.holds.find((h: any) => h.weekday === 5)
    await data.removeHold({ d: 5, t: '4:00 PM' })
    expect(calls.find((c) => c[0] === 'removeHold')![1]).toBe(held.id)
    // a hold that is not there any more is already gone
    const before = calls.length
    expect(await data.removeHold({ d: 2, t: '9:00 AM' })).toBe(true)
    expect(calls.length).toBe(before)
  })

  it('adds a client by name, answers candidates on 409 and adds by id', async () => {
    const { data, fail, calls } = setup()
    await loaded(data, 'vip')
    expect(await data.addVipClient('Marcus Webb')).toEqual({
      status: 'added',
      name: 'Marcus Webb',
      toast: 'Marcus Webb is now VIP',
    })
    fail.set(
      'addVipClient',
      new ApiError({
        status: 409,
        code: 'VIP_CLIENT_AMBIGUOUS',
        title: 'Which client?',
        meta: {
          candidates: [
            {
              customerId: 'c-1',
              fullName: 'Liam Chen',
              phoneHint: '+1******0107',
              vehicles: ['2020 BMW M340i'],
              alreadyVip: false,
            },
          ],
        },
      }),
    )
    expect(await data.addVipClient('Chen')).toEqual({
      status: 'candidates',
      candidates: [{ id: 'c-1', name: 'Liam Chen', detail: '2020 BMW M340i · …0107' }],
    })
    fail.delete('addVipClient')
    await data.addVipClientById('c-1')
    expect(calls.filter((c) => c[0] === 'addVipClient').map((c) => c[1])).toEqual([
      { name: 'Marcus Webb' },
      { name: 'Chen' },
      { customerId: 'c-1' },
    ])
  })

  it('removes a client by the id behind the name', async () => {
    const { data, calls } = setup()
    await loaded(data, 'vip')
    await data.removeVipClient('Liam Chen')
    const id = (bundle as any).vip.clients.find((c: any) => c.fullName === 'Liam Chen').customerId
    expect(calls.find((c) => c[0] === 'removeVipClient')![1]).toBe(id)
    expect(await data.removeVipClient('Nobody')).toBe(true)
  })
})

describe('checklists', () => {
  const pkg = (bundle as any).services.packages.find((p: any) => p.name === 'Premium Hand Wash + Interior')
  const labels: string[] = pkg.tasks.map((t: any) => t.label)

  it('coalesces a burst of edits into one save and tells every caller how it went', async () => {
    const { data, calls } = setup()
    await loaded(data, 'services')
    const a = data.saveChecklist(
      'pkg',
      pkg.name,
      [...labels.slice(0, 3), 'Tire shine and dress', ...labels.slice(4)],
      { kind: 'edit', i: 3, label: 'Tire shine and dress' },
    )
    const b = data.saveChecklist(
      'pkg',
      pkg.name,
      [...labels.slice(0, 3), 'Tire shine and dress', ...labels.slice(4)],
      { kind: 'edit', i: 3, label: 'Tire shine and dress' },
    )
    expect(await Promise.all([a, b])).toEqual([true, true])
    expect(calls.filter((c) => c[0] === 'saveChecklist')).toHaveLength(1)
  })

  it('carries the task ids through a rename and a move, so identity survives', async () => {
    const { data, calls } = setup()
    await loaded(data, 'services')
    const renamed = [...labels]
    renamed[3] = 'Tire shine and dress'
    void data.saveChecklist('pkg', pkg.name, renamed, { kind: 'edit', i: 3, label: 'Tire shine and dress' })
    const moved = [...renamed]
    ;[moved[3], moved[4]] = [moved[4]!, moved[3]!]
    const done = data.saveChecklist('pkg', pkg.name, moved, { kind: 'down', i: 3 })
    await done
    const sent = calls.find((c) => c[0] === 'saveChecklist')![2] as { id?: string; label: string }[]
    expect(sent.map((t) => t.label)).toEqual(moved)
    expect(sent[3]!.id).toBe(pkg.tasks[4].id)
    expect(sent[4]!.id).toBe(pkg.tasks[3].id)
    expect(sent[0]!.id).toBe(pkg.tasks[0].id)
  })

  it('a new task has no id yet, a removed one is gone from the list', async () => {
    const { data, calls } = setup()
    await loaded(data, 'services')
    await data.saveChecklist('pkg', pkg.name, [...labels, 'Brand new'], { kind: 'add', label: 'Brand new' })
    const sent = calls.find((c) => c[0] === 'saveChecklist')![2] as { id?: string; label: string }[]
    expect(sent.at(-1)).toEqual({ label: 'Brand new' })
    expect(sent).toHaveLength(labels.length + 1)
    calls.length = 0
    const rest = [...labels, 'Brand new'].slice(1)
    await data.saveChecklist('pkg', pkg.name, rest, { kind: 'remove', i: 0 })
    const after = calls.find((c) => c[0] === 'saveChecklist')![2] as { id?: string; label: string }[]
    expect(after[0]!.id).toBe(pkg.tasks[1].id)
  })

  it('answers false for a service it does not know and when the save is refused', async () => {
    const { data, fail } = setup()
    await loaded(data, 'services')
    expect(await data.saveChecklist('pkg', 'Nope', [], { kind: 'remove', i: 0 })).toBe(false)
    fail.set('saveChecklist', new ApiError({ status: 422, title: 'Too long', detail: 'x' }))
    expect(await data.saveChecklist('pkg', pkg.name, [...labels, 'x'], { kind: 'add', label: 'x' })).toBe(
      false,
    )
  })

  it('flush sends what is waiting at once', async () => {
    const { data, calls } = setup()
    const slow = new LiveDataClass({
      api: (data as any).api,
      qc: makeQueryClient(),
      session: () => makeSession({ role: 'mgmt' }),
      toast: () => {},
      schedule: (fn) => fn(),
      debounceMs: { checklist: 60_000, preview: 10, closure: 10 },
    })
    await loaded(slow, 'services')
    const p = slow.saveChecklist('pkg', pkg.name, [...labels, 'x'], { kind: 'add', label: 'x' })
    expect(calls.filter((c) => c[0] === 'saveChecklist')).toHaveLength(0)
    slow.flush()
    expect(await p).toBe(true)
    expect(calls.filter((c) => c[0] === 'saveChecklist')).toHaveLength(1)
  })
})
