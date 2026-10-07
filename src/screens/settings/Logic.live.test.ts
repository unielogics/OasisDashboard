// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// The view model on LiveData over a fake API (responses captured from the real one): loading and locked cards,
// hydration from the server model, "Your role can’t …" without a request, optimistic changes that come back when the
// server refuses, the Save bar with the shared version, forms that wait for the server, and the live-only wording.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/data/http/problem'
import { LiveData } from './live/LiveData'
import { setup } from './live/testkit'
import { createSettingsLogic } from './Logic'
import { atPath, attach } from './testkit'

beforeAll(() => {
  process.env.TZ = 'America/New_York'
})
beforeEach(() => {
  vi.useRealTimers()
  location.hash = ''
})
afterEach(() => vi.restoreAllMocks())

type Role = 'mgmt' | 'crew' | 'super' | 'support'

function make(role: Role = 'mgmt', debounceMs?: { checklist?: number }) {
  const ref: { logic?: any } = {}
  const s = setup({
    debounceMs,
    role,
    toast: (t) => ref.logic?.flash(t.desc ? t.title + ' · ' + t.desc : t.title),
  })
  const logic: any = (ref.logic = new (createSettingsLogic(s.data))({}))
  // a host that renders after every change, like DCHost (the screen hydrates from the server when it renders)
  const render = () => queueMicrotask(() => logic.renderVals())
  logic.__host = {
    __setLogicState(update: any, cb?: () => void) {
      const patch = typeof update === 'function' ? update(logic.state) : update
      logic.state = { ...logic.state, ...patch }
      render()
      cb?.()
    },
    forceUpdate: render,
  }
  return { ...s, logic }
}

const vals = (logic: any): any => logic.renderVals()
const ev = (value = '', key = '') => ({ target: { value }, key, stopPropagation() {}, preventDefault() {} })
const click = (logic: any, path: string, value?: string, key?: string): void => {
  const fn = atPath(vals(logic), path)
  expect(typeof fn, `no handler at ${path}`).toBe('function')
  fn(ev(value, key))
}
const go = (logic: any, section: string): void => {
  logic.setState({ section })
}
/** Waits until a section has what it needs. */
const ready = async (logic: any, section = 'hours'): Promise<void> => {
  go(logic, section)
  await vi.waitFor(() => expect(vals(logic).secOpen).toBe(true))
}
const writes = (calls: any[][]): string[] =>
  calls
    .map((c) => c[0] as string)
    .filter(
      (n) =>
        ![
          'bundle',
          'roles',
          'employees',
          'hours',
          'closures',
          'emergency',
          'vip',
          'vipClients',
          'arrival',
          'services',
          'employee',
          'previewEmergency',
          'previewClosure',
        ].includes(n),
    )
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('loading and locked sections', () => {
  it('shows the loading card, then the section, hydrated from the server', async () => {
    const { logic } = make()
    const first = vals(logic)
    expect(first.secLoading).toBe(true)
    expect(first.secHours).toBe(false)
    expect(first.secOpen).toBe(false)
    await ready(logic)
    const v = vals(logic)
    expect(v.secLoading).toBe(false)
    expect(v.secHours).toBe(true)
    expect(v.hourRows[0]).toMatchObject({ day: 'Monday', from: '8:00 AM', to: '6:00 PM', len: '10 hrs' })
    expect(v.weekHours).toBe('65 hrs')
    expect(logic.state.savedHours).toBe(JSON.stringify(logic.state.hours))
    expect(v.empCount).toBe('7')
  })

  it('a failed load shows the failed card with a retry that loads it', async () => {
    const { logic, fail, data } = make()
    fail.set('bundle', new ApiError({ status: 500, title: 'Boom' }))
    go(logic, 'hours')
    await vi.waitFor(() => expect(vals(logic).secFailed).toBe(true))
    expect(vals(logic).secLoading).toBe(false)
    fail.delete('bundle')
    click(logic, 'retryLoad')
    await vi.waitFor(() => expect(vals(logic).secOpen).toBe(true))
    expect(data.status()).toBe('ready')
  })

  it('sections the caller cannot read show the locked card with the permission named', async () => {
    const { logic } = make('support')
    go(logic, 'emergency')
    await vi.waitFor(() => expect(vals(logic).secLocked).toBe(true))
    const v = vals(logic)
    expect(v.secEmergency).toBe(false)
    expect(v.secOpen).toBe(false)
    expect(v.lockedTitle).toBe('You don’t have access to Emergency closing')
    expect(v.lockedBody).toBe('Ask an administrator to give your role the “Emergency closing” permission.')
    await ready(logic, 'employees')
    expect(vals(logic).secLocked).toBe(false)
  })

  it('Crew has no team, VIP or emergency section but still reads hours', async () => {
    const { logic } = make('crew')
    for (const s of ['employees', 'roles', 'vip', 'emergency']) {
      go(logic, s)
      expect(vals(logic).secLocked, s).toBe(true)
    }
    await ready(logic, 'hours')
    expect(vals(logic).secLocked).toBe(false)
  })

  it('opens the emergency section for the #emergency deep link', async () => {
    location.hash = '#emergency'
    const { logic } = make()
    logic.componentDidMount()
    expect(logic.state.section).toBe('emergency')
    logic.componentWillUnmount()
  })

  it('uses the live wording: SMS options, a live strip, the access line and singular forms', async () => {
    const { logic } = make()
    await ready(logic, 'emergency')
    const v = vals(logic)
    expect(v.emOpts[0].sub).toBe('Sent by SMS')
    expect(v.emStrip).toMatch(/appointments? left today, \d+ vehicles? on site/)
    expect(v.emRequirement).toBe('Requires Management or Super Admin · you have access')
    expect(v.emPreviewLabel).toBe('Preview · SMS to Liam')
    expect(v.emReasons).toHaveLength(5)
    await ready(logic, 'vip')
    expect(vals(logic).vipCount).toBe('4 clients')
    logic.setState({ vip: { ...logic.state.vip, clients: ['Only One'] } })
    expect(vals(logic).vipCount).toBe('1 client')
  })
})

describe('writes the caller cannot do', () => {
  it('Support: hours, closures, roles, services and the team show "Your role can’t …" and send nothing', async () => {
    const { logic, calls } = make('support')
    await ready(logic, 'hours')
    const before = calls.length
    click(logic, 'hourRows[0].toInc')
    expect(logic.state.toast).toBe('Your role can’t change hours and closures')
    expect(logic.state.hours[1].to).toBe('6:00 PM')
    click(logic, 'ruleRows[0].opts[0].onClick')
    expect(logic.state.rules.slot).toBe(30)
    await ready(logic, 'closures')
    click(logic, 'toggleFederal')
    expect(logic.state.toast).toBe('Your role can’t change hours and closures')
    click(logic, 'headBtn')
    expect(logic.state.adding).toBe(false)
    await ready(logic, 'roles')
    click(logic, 'permGroups[1].rows[3].cells[4].toggle')
    expect(logic.state.toast).toBe('Your role can’t change roles')
    click(logic, 'headBtn')
    expect(logic.state.toast).toBe('Your role can’t change roles')
    await ready(logic, 'employees')
    click(logic, 'headBtn')
    expect(logic.state.toast).toBe('Your role can’t edit employees')
    await ready(logic, 'services')
    click(logic, 'tasks[0].remove')
    expect(logic.state.toast).toBe('Your role can’t edit packages and checklists')
    expect(writes(calls.slice(before))).toEqual([])
  })

  it('Management cannot touch a money limit: the Super-only toast, no request, no flip', async () => {
    const { logic, calls } = make('mgmt')
    await ready(logic, 'roles')
    const acct = logic.state.rc.roles.findIndex((r: any) => r.name === 'Accounting')
    const before = JSON.stringify(logic.state.rc)
    click(logic, `permGroups[2].rows[1].cells[${acct}].cycle`)
    expect(logic.state.toast).toBe('Super Admin only · Only a Super Admin can do that')
    expect(JSON.stringify(logic.state.rc)).toBe(before)
    expect(names(calls)).not.toContain('setLimit')
  })

  it('a Super Admin can: the chip cycles in dollars and the request carries them', async () => {
    const { logic, calls } = make('super')
    await ready(logic, 'roles')
    const acct = logic.state.rc.roles.findIndex((r: any) => r.name === 'Accounting')
    click(logic, `permGroups[2].rows[1].cells[${acct}].cycle`)
    expect(logic.state.rc.limits[logic.state.rc.roles[acct].id].refund).toBe(1000)
    await vi.waitFor(() => expect(names(calls)).toContain('setLimit'))
    expect(calls.find((c) => c[0] === 'setLimit')!.slice(2, 4)).toEqual(['refund', 1000])
  })
})

const names = (calls: any[][]): string[] => calls.map((c) => c[0] as string)

describe('hours', () => {
  it('edits stay local until Save; Save sends the week on the version and words the warning', async () => {
    const { logic, calls } = make()
    await ready(logic)
    click(logic, 'hourRows[0].toInc')
    expect(vals(logic).hoursDirty).toBe(true)
    expect(names(calls)).not.toContain('saveHours')
    click(logic, 'saveHours')
    await vi.waitFor(() => expect(logic.state.toast).toMatch(/^Working hours saved/))
    expect(logic.state.toast).toBe(
      'Working hours saved · booking and calendar updated · 1 employee schedule no longer fits',
    )
    expect(vals(logic).hoursDirty).toBe(false)
    const body = calls.find((c) => c[0] === 'saveHours')![1] as any
    expect(body.version).toBe(1)
    expect(body.days[1]).toEqual({ weekday: 1, open: true, from: '8:00 AM', to: '6:30 PM' })
  })

  it('a refused save keeps the edit and the Save bar', async () => {
    const { logic, fail } = make()
    await ready(logic)
    click(logic, 'hourRows[0].toDec')
    fail.set(
      'saveHours',
      new ApiError({
        status: 422,
        title: 'Check the hours',
        detail: 'Monday: closing time must be after opening time.',
      }),
    )
    click(logic, 'saveHours')
    await vi.waitFor(() =>
      expect(logic.state.toast).toBe('Check the hours · Monday: closing time must be after opening time.'),
    )
    expect(vals(logic).hoursDirty).toBe(true)
    expect(logic.state.hours[1].to).toBe('5:30 PM')
  })

  it('a rule click saves at once and does not lose the unsaved hours edit', async () => {
    const { logic, calls } = make()
    await ready(logic)
    click(logic, 'hourRows[0].fromInc')
    click(logic, 'ruleRows[0].opts[0].onClick')
    expect(logic.state.rules.slot).toBe(15)
    await vi.waitFor(() => expect(names(calls)).toContain('saveRules'))
    await sleep(50)
    expect(logic.state.hours[1].from).toBe('8:30 AM')
    expect(vals(logic).hoursDirty).toBe(true)
    click(logic, 'saveHours')
    await vi.waitFor(() => expect(names(calls)).toContain('saveHours'))
    expect((calls.find((c) => c[0] === 'saveHours')![1] as any).version).toBe(2)
  })

  it('a change made elsewhere is merged under the unsaved edit', async () => {
    const { logic, bundle, data } = make()
    await ready(logic)
    click(logic, 'hourRows[0].fromInc') // Monday opens 8:30 (unsaved)
    bundle.hours.days[2].to = '6:30 PM' // somebody else: Tuesday closes 6:30
    bundle.hours.days[2].toMin = 1110
    // the server part arrives (what the stream's invalidation does)
    ;(data as LiveData).reload(['hours'])
    // the fake serves GET /settings/hours from the bundle's days
    await vi.waitFor(() => expect(logic.renderVals() && logic.state.hours[2].to).toBe('6:30 PM'))
    expect(logic.state.hours[1].from).toBe('8:30 AM')
    expect(vals(logic).hoursDirty).toBe(true)
    expect(JSON.parse(logic.state.savedHours)[2].to).toBe('6:30 PM')
  })

  it('discard returns to the saved week', async () => {
    const { logic } = make()
    await ready(logic)
    click(logic, 'hourRows[3].toggle')
    click(logic, 'discardHours')
    expect(vals(logic).hoursDirty).toBe(false)
  })
})

describe('closures', () => {
  it('validates locally with the design’s strings, then waits for the server before listing', async () => {
    const { logic, calls } = make()
    await ready(logic, 'closures')
    click(logic, 'headBtn')
    click(logic, 'addClosure')
    expect(logic.state.ncError).toBe('Add a date and a name.')
    const taken = logic.state.closures[0].date
    click(logic, 'ncDate', taken)
    click(logic, 'ncName', 'Dup')
    click(logic, 'addClosure')
    expect(logic.state.ncError).toBe('There’s already a closure on that date.')
    click(logic, 'ncDate', '2027-02-02')
    click(logic, 'ncName', 'Staff day')
    const n = logic.state.closures.length
    click(logic, 'addClosure')
    expect(logic.state.closures.length).toBe(n)
    expect(logic.state.adding).toBe(true)
    await vi.waitFor(() => expect(logic.state.adding).toBe(false))
    expect(logic.state.toast).toBe('Staff day added · calendar updated')
    expect(logic.state.closures.some((c: any) => c.id === 'new-closure')).toBe(true)
    expect(names(calls)).toContain('createClosure')
  })

  it('a server refusal shows inline and the form stays open', async () => {
    const { logic, fail } = make()
    await ready(logic, 'closures')
    click(logic, 'headBtn')
    click(logic, 'ncDate', '2027-02-02')
    click(logic, 'ncName', 'Staff day')
    fail.set(
      'createClosure',
      new ApiError({
        status: 422,
        code: 'CLOSURE_DATE_TAKEN',
        title: 'Check the form',
        detail: "There's already a closure on that date.",
      }),
    )
    click(logic, 'addClosure')
    await vi.waitFor(() => expect(logic.state.ncError).toBe('There’s already a closure on that date.'))
    expect(logic.state.adding).toBe(true)
  })

  it('shows the server’s counts, not the design’s made-up ones, and the real affected line', async () => {
    const { logic } = make()
    await ready(logic, 'closures')
    expect(vals(logic).upcoming[0].sub).toBe('Online booking blocked · 0 existing bookings to move')
    click(logic, 'headBtn')
    click(logic, 'ncDate', '2999-01-01')
    expect(vals(logic).ncAffected).toBe('')
    await vi.waitFor(() => expect(vals(logic).ncAffected).toMatch(/^2 customers are booked that day/))
  })

  it('removing is immediate, and comes back when the server refuses', async () => {
    const { logic, fail, calls } = make()
    await ready(logic, 'closures')
    const name = vals(logic).upcoming[0].name
    const before = logic.state.closures.length
    fail.set(
      'deleteClosure',
      new ApiError({
        status: 409,
        code: 'CLOSURE_LOCKED',
        title: 'Emergency closure',
        detail: 'Reopen the shop to change it',
      }),
    )
    click(logic, 'upcoming[0].remove')
    expect(logic.state.closures.length).toBe(before - 1)
    expect(logic.state.toast).toBe(name + ' removed')
    await vi.waitFor(() => expect(logic.state.closures.length).toBe(before))
    expect(names(calls)).toContain('deleteClosure')
  })
})

describe('emergency', () => {
  it('asking to close needs the permission; closing waits for the server and keeps the dialog on a refusal', async () => {
    const { logic, fail, calls } = make()
    await ready(logic, 'emergency')
    click(logic, 'askClose')
    expect(logic.state.confirm).toBe(true)
    fail.set(
      'closeShop',
      new ApiError({
        status: 409,
        code: 'EMERGENCY_ACTIVE',
        title: 'Already closed',
        detail: 'An emergency closure is already active',
      }),
    )
    click(logic, 'doClose')
    await vi.waitFor(() => expect(names(calls)).toContain('closeShop'))
    await sleep(30)
    expect(logic.state.confirm).toBe(true)
    expect(logic.state.em.active).toBe(false)
    fail.delete('closeShop')
    click(logic, 'doClose')
    await vi.waitFor(() => expect(logic.state.em.active).toBe(true))
    expect(logic.state.confirm).toBe(false)
    expect(logic.state.toast).toBe('Shop closed · 3 customers notified')
    expect(logic.state.em.summary).toBe('Severe weather · closed for the rest of today')
    const keys = calls.filter((c) => c[0] === 'closeShop').map((c) => (c[2] as any).idempotencyKey)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
  })

  it('reopening adds the history line the server wrote', async () => {
    const { logic, calls } = make()
    await ready(logic, 'emergency')
    logic.setState({ em: { ...logic.state.em, active: true, summary: 'x' } })
    click(logic, 'reopen')
    await vi.waitFor(() => expect(logic.state.em.active).toBe(false))
    expect(logic.state.toast).toBe('Shop reopened · online booking resumed')
    expect(names(calls)).toContain('reopen')
  })

  it('shows the server’s affected list and message, and the singular form', async () => {
    const { logic } = make()
    await ready(logic, 'emergency')
    await vi.waitFor(() => expect(vals(logic).emPreview).toBe('Hi Liam, from the server'))
    const v = vals(logic)
    expect(v.emAffected).toEqual([{ time: '10:45 AM', name: 'Liam Chen', veh: 'BMW' }])
    expect(v.emAffectedCount).toBe('1 customer')
    expect(v.confirmText).toMatch(/^1 customer will be messaged, online booking pauses/)
  })
})

describe('employees', () => {
  it('the drawer opens on the full record loaded from the server', async () => {
    const { logic } = make()
    await ready(logic, 'employees')
    click(logic, 'empRows[4].open')
    await vi.waitFor(() => expect(logic.state.draft).not.toBeNull())
    expect(logic.state.draft.overrides).toEqual({ 'sched.override': 'allow' })
    expect(logic.state.draft.sched[6]).toEqual({ on: true, from: '8:00 AM', to: '5:00 PM' })
    expect(vals(logic).dr.effCount).toMatch(/^\d+ of 27 allowed$/)
  })

  it('a server validation error lands in the drawer on the right tab; success lists the saved person', async () => {
    const { logic, fail } = make()
    await ready(logic, 'employees')
    click(logic, 'headBtn')
    click(logic, 'dr.fields[0].set', 'Nia')
    click(logic, 'dr.fields[2].set', '(305) 555-0199')
    fail.set(
      'createEmployee',
      new ApiError({
        status: 422,
        title: 'Check the form',
        detail: 'Sunday: availability must sit inside business hours (9:00 AM – 3:00 PM).',
        errors: [{ path: 'body.schedule', message: 'x' }],
      }),
    )
    click(logic, 'saveEmp')
    await vi.waitFor(() => expect(logic.state.drError).toMatch(/^Sunday: availability/))
    expect(logic.state.drTab).toBe('sched')
    expect(logic.state.draft).not.toBeNull()
    fail.delete('createEmployee')
    const n = logic.state.employees.length
    click(logic, 'saveEmp')
    await vi.waitFor(() => expect(logic.state.draft).toBeNull())
    expect(logic.state.employees.length).toBe(n + 1)
    expect(logic.state.toast).toBe('Invite sent to (305) 555-0199')
  })

  it('the Access tab needs team.roles; saving needs team.edit', async () => {
    const { logic, calls } = make('support')
    await ready(logic, 'employees')
    click(logic, 'empRows[2].open')
    await vi.waitFor(() => expect(logic.state.draft).not.toBeNull())
    click(logic, 'tabAccess')
    click(logic, 'dr.roleOpts[0].onClick')
    expect(logic.state.toast).toBe('Your role can’t change roles')
    expect(logic.state.draft.roles).toHaveLength(2)
    click(logic, 'saveEmp')
    expect(logic.state.toast).toBe('Your role can’t edit employees')
    expect(names(calls)).not.toContain('updateEmployee')
  })

  it('withheld pay is shown as hidden, with no option selected', async () => {
    const { logic } = make()
    await ready(logic, 'employees')
    click(logic, 'empRows[0].open')
    await vi.waitFor(() => expect(logic.state.draft).not.toBeNull())
    logic.setState({ draft: { ...logic.state.draft, payHidden: true } })
    const v = vals(logic).dr
    expect(v.ratePh).toBe('Pay hidden')
    expect(JSON.stringify(v.pays.map((p: any) => p.style.background))).not.toContain('var(--accent)')
  })
})

describe('roles', () => {
  it('a toggle flips at once and is undone when the server refuses', async () => {
    const { logic, fail } = make('mgmt')
    await ready(logic, 'roles')
    const crew = logic.state.rc.roles.findIndex((r: any) => r.name === 'Crew')
    const id = logic.state.rc.roles[crew].id
    const was = logic.state.rc.perms[id]['cli.export']
    fail.set(
      'setPermission',
      new ApiError({ status: 403, code: 'FORBIDDEN', title: 'Forbidden', meta: { required: 'team.roles' } }),
    )
    click(logic, `permGroups[1].rows[3].cells[${crew}].toggle`)
    expect(logic.state.rc.perms[id]['cli.export']).toBe(!was)
    await vi.waitFor(() => expect(logic.state.rc.perms[id]['cli.export']).toBe(was))
  })

  it('adding a custom role waits for the server and uses its name; removing resets the filter', async () => {
    const { logic } = make('mgmt')
    await ready(logic, 'roles')
    const n = logic.state.rc.roles.length
    click(logic, 'headBtn')
    await vi.waitFor(() => expect(logic.state.rc.roles.length).toBe(n + 1))
    expect(logic.state.toast).toBe('Custom role added — adjust its permissions below')
    expect(logic.state.rc.roles.at(-1)).toMatchObject({ name: 'Shift Lead', custom: true })
    logic.setState({ roleFilter: 'custom-role' })
    click(logic, `roleCols[${n}].remove`)
    expect(logic.state.rc.roles.length).toBe(n)
    expect(logic.state.roleFilter).toBe('all')
    expect(logic.state.toast).toBe('Shift Lead removed')
  })
})

describe('VIP', () => {
  it('hold, steppers and toggles are optimistic and persisted; a client is added only when the server resolves it', async () => {
    const { logic, calls } = make()
    await ready(logic, 'vip')
    click(logic, 'addHold')
    expect(logic.state.toast).toBe('Sat 11:00 AM held for VIPs')
    click(logic, 'vipSteppers[0].inc')
    click(logic, 'vipToggles[0].toggle')
    await vi.waitFor(() => expect(names(calls)).toContain('saveVip'))
    expect(calls.filter((c) => c[0] === 'saveVip').map((c) => c[1])).toEqual([
      { windowVip: 37 },
      { waitlist: false },
    ])
    click(logic, 'vipNewSet', 'Marcus Webb')
    click(logic, 'addVip')
    expect(logic.state.vip.clients).not.toContain('Marcus Webb')
    await vi.waitFor(() => expect(logic.state.vip.clients).toContain('Marcus Webb'))
    expect(logic.state.toast).toBe('Marcus Webb is now VIP')
    expect(logic.state.vipNew).toBe('')
  })

  it('an ambiguous name shows the candidates and picking one adds it', async () => {
    const { logic, fail } = make()
    await ready(logic, 'vip')
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
              fullName: 'David Okafor',
              phoneHint: '+1******0103',
              vehicles: ['2019 Ford F-150'],
              alreadyVip: false,
            },
          ],
        },
      }),
    )
    click(logic, 'vipNewSet', 'Okaf')
    click(logic, 'addVip')
    await vi.waitFor(() => expect(vals(logic).hasCandidates).toBe(true))
    expect(vals(logic).candidates[0].label).toBe('David Okafor · 2019 Ford F-150 · …0103')
    fail.delete('addVipClient')
    click(logic, 'candidates[0].onClick')
    await vi.waitFor(() => expect(logic.state.vip.clients).toContain('David Okafor'))
    expect(vals(logic).hasCandidates).toBe(false)
  })
})

describe('services', () => {
  it('edits are saved in one request a moment later, and the server list does not overwrite typing in between', async () => {
    const { logic, calls, bundle } = make('mgmt', { checklist: 250 })
    await ready(logic, 'services')
    const name = logic.state.svcSel
    expect(name).toBe('Premium Hand Wash + Interior')
    const originalIds: string[] = bundle.services.packages[1].tasks.map((t: any) => t.id)
    click(logic, 'tasks[3].edit', 'Tire shine and dress')
    click(logic, 'tasks[3].down')
    expect(logic.state.packages[name].tasks[4]).toBe('Tire shine and dress')
    // the server answers with something else while the person is still typing: it must wait
    bundle.services.packages[1].tasks[0].label = 'Changed elsewhere'
    ;(logic.data as LiveData).reload(['services'])
    await sleep(30)
    expect(logic.state.packages[name].tasks[4]).toBe('Tire shine and dress')
    await vi.waitFor(() => expect(names(calls)).toContain('saveChecklist'))
    const sent = calls.filter((c) => c[0] === 'saveChecklist')
    expect(sent).toHaveLength(1)
    const tasks = sent[0]![2] as { id?: string; label: string }[]
    expect(tasks[4]).toEqual({ id: originalIds[3], label: 'Tire shine and dress' })
    expect(tasks[3]!.id).toBe(originalIds[4])
  })
})

describe('the fixture build is untouched', () => {
  it('a LiveData-free Logic reports no live roots', async () => {
    const { FixtureData } = await import('./fixtures')
    const logic = new (createSettingsLogic(new FixtureData({ storage: null })))({}) as any
    attach(logic)
    const v = logic.renderVals()
    for (const k of ['secOpen', 'secLoading', 'secLocked', 'secFailed', 'emStrip', 'candidates'])
      expect(v).not.toHaveProperty(k)
    expect(v.emOpts[0].sub).toBe('WhatsApp, with SMS fallback')
  })
})
