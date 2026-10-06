// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// Differential tests: the typed view model against the ORIGINAL class (evaluated from design/extracted) on the same
// data, clock and storage. renderVals() must serialise identically (values AND key order), handlers must produce the
// same state and the same localStorage, and the toasts and timers must agree, across scripted flows of every section
// and thousands of seeded random steps.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { serializeVals } from '@/dc/serialize'
import { defaultRoles } from './fixtures'
import { atPath, firstDiff, handlerPaths, makePair, seeded, serial } from './testkit'

beforeAll(() => {
  process.env.TZ = 'America/New_York'
})
beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-06-13T10:36:00-04:00') })
  localStorage.clear()
})
afterEach(() => vi.useRealTimers())
afterAll(() => vi.useRealTimers())

type P = ReturnType<typeof makePair>

const KEYS = [
  'oasis-hours',
  'oasis-roles',
  'oasis-closures',
  'oasis-checklists',
  'oasis-emergency',
  'oasis-vip',
  'oasis-theme',
]

function renderBoth(p: P): { vo: any; vp: any } | null {
  let vo: any, vp: any, eo: any, ep: any
  try {
    vo = p.orig.renderVals()
  } catch (e) {
    eo = e
  }
  try {
    vp = p.port.renderVals()
  } catch (e) {
    ep = e
  }
  if (eo || ep) {
    expect(ep?.message, 'port render result differs from the original (threw vs not)').toBe(eo?.message)
    return null
  }
  return { vo, vp }
}

/** The storage both sides wrote, as one comparable string. */
const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const stored = (): string => JSON.stringify(KEYS.map((k) => [k, read(k)]))

/** Original and port each write to their own storage view: run a step on one side, snapshot, then the other. */
function compare(p: P, what = ''): { vo: any; vp: any } | null {
  const r = renderBoth(p)
  if (r) {
    const d = firstDiff(serializeVals(r.vo), serializeVals(r.vp))
    expect(d, `renderVals differ ${what}: ${d}`).toBeNull()
  }
  expect(Object.keys(p.port.state), `state keys ${what}`).toEqual(Object.keys(p.orig.state))
  expect(JSON.stringify(p.port.state), `state differs ${what}`).toBe(JSON.stringify(p.orig.state))
  return r
}
const same = (p: P, what = ''): void => void compare(p, what)

const ev = (value = '', key = '') => ({ target: { value }, key, stopPropagation() {}, preventDefault() {} })

/**
 * Runs the handler at `path` on the original and on the port. Both write localStorage, so each side starts from the
 * same snapshot and the writes are compared afterwards.
 */
function click(p: P, path: string, value?: string, key?: string): void {
  const fo = atPath(p.orig.renderVals(), path)
  const fn = atPath(p.port.renderVals(), path)
  expect(typeof fo, `original has no handler at ${path}`).toBe('function')
  expect(typeof fn, `port has no handler at ${path}`).toBe('function')
  const before = snapshot()
  try {
    fo(ev(value, key))
  } catch (e) {
    // the design's handler throws on a closed drawer (it reads `draft.first`); the port ignores the click
    if (!/Cannot read properties of null/.test(String((e as Error).message))) throw e
    restore(before)
    return
  }
  const afterOrig = stored()
  restore(before)
  fn(ev(value, key))
  expect(stored(), `localStorage differs after ${path}`).toBe(afterOrig)
}

const snapshot = (): Record<string, string | null> => Object.fromEntries(KEYS.map((k) => [k, read(k)]))
const restore = (s: Record<string, string | null>): void => {
  try {
    for (const k of KEYS) {
      if (s[k] === null) localStorage.removeItem(k)
      else localStorage.setItem(k, s[k]!)
    }
  } catch {
    /* storage is blocked in this test */
  }
}

const go = (p: P, section: string): void => {
  const names: Record<string, string> = {
    hours: 'goHours',
    closures: 'goClosures',
    emergency: 'goEmergency',
    employees: 'goEmployees',
    roles: 'goRoles',
    services: 'goServices',
    vip: 'goVip',
    arrival: 'goArrival',
  }
  click(p, names[section]!)
}

describe('initial render', () => {
  it('serialises identically to the original, key order included', () => {
    const p = makePair()
    same(p, 'initial')
    expect(serial(p.port)).toBeTruthy()
  })

  it('starts from the same state with the same key order', () => {
    const p = makePair()
    expect(Object.keys(p.port.state)).toEqual(Object.keys(p.orig.state))
    expect(JSON.stringify(p.port.state)).toBe(JSON.stringify(p.orig.state))
  })

  it('every section and both themes render the same', () => {
    for (const theme of ['light', 'dark']) {
      localStorage.setItem('oasis-theme', theme)
      const p = makePair()
      for (const sec of [
        'hours',
        'closures',
        'emergency',
        'employees',
        'roles',
        'services',
        'vip',
        'arrival',
      ]) {
        go(p, sec)
        same(p, `${theme}/${sec}`)
      }
    }
  })

  it('reads every oasis-* key like the original', () => {
    const hours = JSON.parse(JSON.stringify(defaultHoursDays()))
    hours[1].to = '7:30 PM'
    hours[0].open = false
    localStorage.setItem('oasis-hours', JSON.stringify(hours))
    const roles = defaultRoles()
    roles.roles.push({ id: 'ops', name: 'Ops Lead', desc: 'x', custom: true })
    roles.perms.ops = { 'pay.reports': true, 'pay.refund': true }
    roles.limits.ops = { refund: 75 } as any
    localStorage.setItem('oasis-roles', JSON.stringify(roles))
    localStorage.setItem(
      'oasis-closures',
      JSON.stringify([
        {
          date: '2026-06-20',
          name: 'Staff day',
          type: 'reduced',
          from: '9:00 AM',
          to: '1:00 PM',
          notify: false,
        },
        { date: '2026-06-01', name: 'Past one', type: 'closed' },
        { date: '2026-06-13', name: 'Today', type: 'closed', emergency: true },
      ]),
    )
    localStorage.setItem(
      'oasis-checklists',
      JSON.stringify({ packages: { 'Full Detail': ['One', 'Two'] }, addons: { Wax: ['Only'] } }),
    )
    localStorage.setItem(
      'oasis-emergency',
      JSON.stringify({ active: true, summary: 'Power outage · closed today' }),
    )
    localStorage.setItem(
      'oasis-vip',
      JSON.stringify({
        vip: {
          holds: [{ d: 1, t: '8:00 AM' }],
          release: 24,
          windowVip: 21,
          windowStd: 7,
          sameDay: 0,
          waitlist: false,
          offerMin: 30,
          standing: false,
          autoConfirm: false,
          cadences: ['Monthly'],
          clients: ['Zed'],
        },
        arrival: {
          on: false,
          radius: 150,
          prepAt: 20,
          autoArrive: false,
          welcome: false,
          crew: false,
          vipFirst: false,
        },
      }),
    )
    const p = makePair()
    for (const sec of [
      'hours',
      'closures',
      'emergency',
      'employees',
      'roles',
      'services',
      'vip',
      'arrival',
    ]) {
      go(p, sec)
      same(p, 'custom storage ' + sec)
    }
    expect(p.port.state.rc.roles.map((r: any) => r.id)).toContain('ops')
    expect(p.port.state.em.active).toBe(true)
  })

  it('falls back to the defaults when storage holds garbage', () => {
    for (const k of KEYS) localStorage.setItem(k, '{not json')
    const p = makePair()
    same(p, 'garbage')
  })

  it('works when storage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    try {
      const p = makePair()
      same(p, 'no storage')
      click(p, 'toggleTheme')
      go(p, 'closures')
      click(p, 'upcoming[0].remove')
      same(p, 'edited without storage')
    } finally {
      spy.mockRestore()
      set.mockRestore()
    }
  })
})

function defaultHoursDays(): any[] {
  const p = makePair()
  return p.orig.state.hours
}

describe('methods match the original member by member', () => {
  it('parseT, step and roleName', () => {
    const p = makePair()
    for (const t of ['5:00 AM', '12:00 AM', '12:30 PM', '11:30 PM', '9:00 am', '1:05 pm']) {
      expect(p.port.parseT(t)).toBe(p.orig.parseT(t))
      for (const d of [-3, -1, 0, 1, 2, 40, -40]) expect(p.port.step(t, d)).toBe(p.orig.step(t, d))
    }
    for (const id of ['super', 'crew', 'nobody']) expect(p.port.roleName(id)).toBe(p.orig.roleName(id))
  })
})

describe('scripted flows', () => {
  const flow = (name: string, steps: (p: P) => void) =>
    it(name, () => {
      const p = makePair()
      steps(p)
      same(p, name)
    })

  flow('working hours: steppers, toggles, copy Monday, discard, save', (p) => {
    for (let i = 0; i < 7; i++) {
      click(p, `hourRows[${i}].fromDec`)
      click(p, `hourRows[${i}].toInc`)
    }
    click(p, 'hourRows[2].toggle')
    click(p, 'hourRows[0].fromInc')
    same(p, 'edited')
    expect(p.port.renderVals().hoursDirty).toBe(true)
    click(p, 'copyWeekdays')
    same(p, 'copied')
    click(p, 'discardHours')
    same(p, 'discarded')
    expect(p.port.renderVals().hoursDirty).toBe(false)
    click(p, 'hourRows[1].toggle')
    click(p, 'saveHours')
    same(p, 'saved')
    expect(p.port.state.toast).toBe('Working hours saved · booking and calendar updated')
    expect(JSON.parse(localStorage.getItem('oasis-hours')!)[2].open).toBe(false)
    go(p, 'closures')
    go(p, 'hours')
    same(p, 'back on hours')
  })

  flow('stepper clamps at 5:00 AM and 11:30 PM', (p) => {
    for (let i = 0; i < 40; i++) click(p, 'hourRows[0].fromDec')
    for (let i = 0; i < 60; i++) click(p, 'hourRows[0].toInc')
    expect(p.port.state.hours[1].from).toBe('5:00 AM')
    expect(p.port.state.hours[1].to).toBe('11:30 PM')
  })

  flow('booking rules chips', (p) => {
    for (const r of [0, 1, 2]) for (let o = 0; o < 3; o++) click(p, `ruleRows[${r}].opts[${o}].onClick`)
    expect(p.port.state.rules).toEqual(p.orig.state.rules)
  })

  flow('closures: validate, add closed and reduced, duplicate, notify, remove, federal', (p) => {
    go(p, 'closures')
    click(p, 'headBtn')
    same(p, 'form open')
    click(p, 'addClosure')
    expect(p.port.state.ncError).toBe('Add a date and a name.')
    click(p, 'ncDate', '2026-06-20')
    expect(p.port.state.ncError).toBe('')
    click(p, 'addClosure')
    click(p, 'ncName', '   ')
    click(p, 'addClosure')
    click(p, 'ncName', 'Staff training day')
    same(p, 'filled')
    expect(p.port.renderVals().ncAffected).toMatch(/customers are booked that day/)
    click(p, 'ncReduced')
    for (let i = 0; i < 3; i++) {
      click(p, 'ncFromInc')
      click(p, 'ncToDec')
    }
    click(p, 'addClosure')
    same(p, 'added')
    expect(p.port.state.toast).toBe('Staff training day added · calendar updated')
    click(p, 'headBtn')
    click(p, 'ncDate', '2026-06-20')
    click(p, 'ncName', 'Again')
    click(p, 'addClosure')
    expect(p.port.state.ncError).toBe('There’s already a closure on that date.')
    click(p, 'ncDate', '2026-01-02')
    expect(p.port.renderVals().ncAffected).toBe('')
    click(p, 'ncName', 'Past day')
    click(p, 'ncClosed')
    click(p, 'addClosure')
    click(p, 'cancelClosure')
    click(p, 'headBtn')
    click(p, 'cancelClosure')
    same(p, 'cancelled')
    click(p, 'upcoming[0].toggleNotify')
    click(p, 'upcoming[1].remove')
    expect(p.port.state.toast).toMatch(/ removed$/)
    click(p, 'toggleFederal')
    same(p, 'federal')
    expect(JSON.parse(localStorage.getItem('oasis-closures')!).length).toBe(p.port.state.closures.length)
  })

  flow('emergency: options, durations, message, preview, close with and without notifying, reopen', (p) => {
    go(p, 'emergency')
    for (let i = 0; i < 5; i++) {
      click(p, `emReasons[${i}].onClick`)
      same(p, `reason ${i}`)
    }
    click(p, 'emDurations[1].onClick')
    for (let i = 0; i < 4; i++) click(p, 'emUntilInc')
    for (let i = 0; i < 12; i++) click(p, 'emUntilDec')
    same(p, 'until stepped')
    click(p, 'emDurations[2].onClick')
    click(p, 'emThroughSet', '2026-06-18')
    same(p, 'days')
    click(p, 'emThroughSet', '')
    same(p, 'no end date')
    click(p, 'emThroughSet', '2026-06-18')
    click(p, 'emMsgSet', 'Hello {first}, {reason}, {until}, {link}, {first} {unknown}')
    for (let i = 0; i < 5; i++) click(p, `emOpts[${i}].toggle`)
    same(p, 'options off')
    for (let i = 0; i < 5; i++) click(p, `emOpts[${i}].toggle`)
    click(p, 'emDurations[1].onClick')
    click(p, 'askClose')
    same(p, 'confirm open')
    expect(p.port.state.confirm).toBe(true)
    click(p, 'cancelClose')
    click(p, 'askClose')
    click(p, 'doClose')
    same(p, 'closed')
    expect(p.port.state.toast).toMatch(/^Shop closed · \d customers notified$/)
    expect(localStorage.getItem('oasis-emergency')).toContain('"active":true')
    vi.advanceTimersByTime(3000)
    click(p, 'reopen')
    same(p, 'reopened')
    expect(p.port.state.toast).toBe('Shop reopened · online booking resumed')
    click(p, 'emOpts[0].toggle')
    click(p, 'emDurations[0].onClick')
    click(p, 'askClose')
    click(p, 'doClose')
    expect(p.port.state.toast).toBe('Shop closed · no messages sent')
    click(p, 'reopen')
  })

  flow('employees: search, filter, drawer tabs, validation, save, add, deactivate', (p) => {
    go(p, 'employees')
    click(p, 'empSearch', 'sofia')
    same(p, 'search')
    click(p, 'empSearch', 'crew')
    click(p, 'empSearch', 'zzz')
    expect(p.port.renderVals().noEmp).toBe(true)
    click(p, 'empSearch', '')
    for (let i = 0; i < 6; i++) {
      click(p, `roleFilters[${i}].onClick`)
      same(p, `filter ${i}`)
    }
    click(p, 'roleFilters[0].onClick')
    for (let i = 0; i < 7; i++) {
      click(p, `empRows[${i}].open`)
      for (const t of ['tabProfile', 'tabAccess', 'tabSched']) {
        click(p, t)
        same(p, `drawer ${i} ${t}`)
      }
      click(p, 'closeDrawer')
    }
    click(p, 'empRows[4].open')
    click(p, 'dr.fields[0].set', '')
    click(p, 'saveEmp')
    expect(p.port.state.drError).toBe('First name and mobile number are required.')
    click(p, 'dr.fields[0].set', 'Sofía')
    click(p, 'tabAccess')
    click(p, 'dr.roleOpts[3].onClick')
    click(p, 'dr.roleOpts[4].onClick')
    click(p, 'saveEmp')
    expect(p.port.state.drError).toBe('Assign at least one role.')
    expect(p.port.state.drTab).toBe('access')
    click(p, 'dr.roleOpts[3].onClick')
    click(p, 'dr.effGroups[5].rows[0].deny')
    click(p, 'dr.effGroups[2].rows[1].allow')
    click(p, 'dr.effGroups[2].rows[1].inherit')
    click(p, 'tabSched')
    click(p, 'dr.sched[0].toggle')
    click(p, 'dr.sched[2].fromDec')
    click(p, 'dr.sched[2].toInc')
    click(p, 'tabProfile')
    click(p, 'dr.types[1].onClick')
    click(p, 'dr.pays[1].onClick')
    click(p, 'dr.setRate', '27.5')
    click(p, 'dr.skills[5].onClick')
    click(p, 'dr.skills[0].onClick')
    click(p, 'toggleActive')
    same(p, 'edited draft')
    click(p, 'saveEmp')
    same(p, 'saved employee')
    expect(p.port.state.toast).toBe('Saved Sofía Duarte')
    click(p, 'headBtn')
    same(p, 'new employee drawer')
    click(p, 'saveEmp')
    click(p, 'dr.fields[0].set', 'Nia')
    click(p, 'dr.fields[2].set', '(305) 555-0199')
    click(p, 'saveEmp')
    same(p, 'added')
    expect(p.port.state.toast).toBe('Invite sent to (305) 555-0199')
    expect(p.port.state.employees.at(-1).status).toBe('invited')
    click(p, `empRows[${p.port.renderVals().empRows.length - 1}].open`)
    click(p, 'toggleActive')
    click(p, 'toggleActive')
  })

  flow('roles: toggles, locked toast, limit chips wrap, custom role add and remove', (p) => {
    go(p, 'roles')
    const cols = p.orig.renderVals().roleCols.length
    for (let g = 0; g < 6; g++) {
      const rows = p.orig.renderVals().permGroups[g].rows.length
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) click(p, `permGroups[${g}].rows[${r}].cells[${c}].toggle`)
    }
    same(p, 'all toggled')
    expect(p.port.state.toast).toBe('Super Admin always has every permission')
    for (let i = 0; i < 9; i++)
      for (const c of [0, 1, 2, 3, 4]) click(p, `permGroups[2].rows[1].cells[${c}].cycle`)
    same(p, 'limits cycled')
    click(p, 'headBtn')
    same(p, 'custom role')
    expect(p.port.state.toast).toBe('Custom role added — adjust its permissions below')
    const n = p.port.state.rc.roles.length - 1
    vi.setSystemTime(new Date('2026-06-13T10:37:00-04:00'))
    click(p, 'headBtn')
    expect(p.port.state.rc.roles.length).toBe(n + 2)
    click(p, `roleCols[${n + 1}].remove`)
    same(p, 'custom role removed')
    expect(p.port.state.toast).toBe('Shift Lead removed')
  })

  flow('removing a role that employees hold strips it from them', (p) => {
    go(p, 'roles')
    vi.setSystemTime(new Date('2026-06-13T10:40:00-04:00'))
    click(p, 'headBtn')
    go(p, 'employees')
    click(p, 'empRows[2].open')
    click(p, 'tabAccess')
    click(p, 'dr.roleOpts[5].onClick')
    click(p, 'saveEmp')
    expect(p.port.state.employees[2].roles).toContain(p.port.state.rc.roles[5].id)
    go(p, 'roles')
    click(p, 'roleCols[5].remove')
    same(p, 'stripped')
    expect(p.port.state.employees[2].roles).not.toContain('custom')
  })

  flow('VIP: holds, steppers, toggles, segments, cadences, clients', (p) => {
    go(p, 'vip')
    click(p, 'addHold')
    expect(p.port.state.toast).toBe('Sat 11:00 AM held for VIPs')
    click(p, 'addHold')
    expect(p.port.state.toast).toBe('That slot is already held')
    for (let i = 0; i < 8; i++) click(p, 'holdDayInc')
    for (let i = 0; i < 8; i++) click(p, 'holdDayDec')
    for (let i = 0; i < 5; i++) click(p, 'holdTimeInc')
    for (let i = 0; i < 70; i++) click(p, 'holdTimeDec')
    click(p, 'addHold')
    click(p, 'vipHolds[0].remove')
    same(p, 'holds')
    for (let i = 0; i < 3; i++)
      for (let n = 0; n < 14; n++) click(p, `vipSteppers[${i}].${n % 2 ? 'dec' : 'inc'}`)
    for (let i = 0; i < 20; i++) click(p, 'vipSteppers[0].inc')
    for (let i = 0; i < 20; i++) click(p, 'vipSteppers[1].dec')
    for (let i = 0; i < 3; i++) click(p, `vipToggles[${i}].toggle`)
    for (let i = 0; i < 3; i++) click(p, `releaseOpts[${i}].onClick`)
    for (let i = 0; i < 3; i++) click(p, `offerOpts[${i}].onClick`)
    for (let i = 0; i < 4; i++) click(p, `cadenceOpts[${i}].onClick`)
    same(p, 'settings')
    click(p, 'vipNewSet', '  ')
    click(p, 'addVip')
    click(p, 'vipNewSet', '  Marcus Webb ')
    click(p, 'addVip')
    expect(p.port.state.toast).toBe('Marcus Webb is now VIP')
    expect(p.port.state.vipNew).toBe('')
    click(p, 'vipClients[0].remove')
    same(p, 'clients')
    expect(JSON.parse(localStorage.getItem('oasis-vip')!).vip.clients.length).toBe(
      p.port.state.vip.clients.length,
    )
  })

  flow('arrival: toggles and segments', (p) => {
    go(p, 'arrival')
    for (let i = 0; i < 5; i++) click(p, `arrToggles[${i}].toggle`)
    for (let i = 0; i < 3; i++) click(p, `radiusOpts[${i}].onClick`)
    for (let i = 0; i < 3; i++) click(p, `prepOpts[${i}].onClick`)
    same(p, 'arrival')
    expect(JSON.parse(localStorage.getItem('oasis-vip')!).arrival.prepAt).toBe(p.port.state.arrival.prepAt)
  })

  flow('services: kinds, selection, task edits, reorder at the edges, add, remove', (p) => {
    go(p, 'services')
    click(p, 'kindAddon')
    same(p, 'add-ons')
    for (let i = 0; i < 10; i++) {
      click(p, `svcList[${i}].onClick`)
      same(p, `add-on ${i}`)
    }
    click(p, 'kindPkg')
    for (let i = 0; i < 9; i++) click(p, `svcList[${i}].onClick`)
    click(p, 'svcList[3].onClick')
    click(p, 'tasks[0].up')
    click(p, 'tasks[0].down')
    click(p, 'tasks[1].up')
    click(p, 'tasks[3].edit', 'Renamed task')
    click(p, 'tasks[9].down')
    click(p, 'tasks[2].remove')
    click(p, 'newTaskSet', '   ')
    click(p, 'addTask')
    click(p, 'newTaskSet', 'Brand new step')
    click(p, 'newTaskKey', undefined, 'a')
    click(p, 'newTaskKey', undefined, 'Enter')
    click(p, 'newTaskSet', 'Another')
    click(p, 'addTask')
    same(p, 'edited checklist')
    const saved = JSON.parse(localStorage.getItem('oasis-checklists')!)
    expect(saved.packages['Executive Detail'].at(-1)).toBe('Another')
    while (p.orig.renderVals().tasks.length) click(p, 'tasks[0].remove')
    same(p, 'emptied')
    expect(p.port.renderVals().tasks).toEqual([])
  })

  flow('theme toggle writes the raw value under oasis-theme', (p) => {
    click(p, 'toggleTheme')
    expect(localStorage.getItem('oasis-theme')).toBe('dark')
    click(p, 'toggleTheme')
    expect(localStorage.getItem('oasis-theme')).toBe('light')
  })

  flow('a toast stays 2.8 s and a second one restarts the timer', (p) => {
    go(p, 'vip')
    click(p, 'addHold')
    vi.advanceTimersByTime(2000)
    click(p, 'addHold')
    vi.advanceTimersByTime(2000)
    same(p, 'second toast still up')
    expect(p.port.state.toast).toBe('That slot is already held')
    vi.advanceTimersByTime(900)
    same(p, 'both expired')
    expect(p.port.state.toast).toBeNull()
  })

  it('opens on the emergency section for the #emergency deep link', () => {
    location.hash = '#emergency'
    try {
      const p = makePair()
      p.orig.componentDidMount()
      p.port.componentDidMount()
      same(p, 'deep link')
      expect(p.port.state.section).toBe('emergency')
    } finally {
      location.hash = ''
    }
  })
})

describe('seeded random walks', () => {
  const VALUES = [
    '',
    ' ',
    'abc',
    '2026-06-13',
    '2026-06-20',
    '2025-01-01',
    'Weekend deal',
    'Liam',
    '(305) 555-0000',
    '30',
    '2026-09-07',
  ]
  const KEYS_POOL = ['Enter', 'a', '']

  function walk(seed: number, steps: number, prep?: (p: P) => void): number {
    const rnd = seeded(seed)
    const p = makePair()
    prep?.(p)
    const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)]!
    let handled = 0
    for (let i = 0; i < steps; i++) {
      let paths: string[]
      try {
        paths = handlerPaths(p.orig.renderVals()).filter((x) => x !== 'stop')
      } catch (e) {
        if (process.env.WALK_DEBUG) console.log('walk', seed, 'ended at', i, String((e as Error).message))
        break
      }
      if (!paths.length) break
      const path = rnd() < 0.12 ? pick(paths.filter((x) => /^go[A-Z]/.test(x))) : pick(paths)
      const value = pick(VALUES)
      const key = pick(KEYS_POOL)
      // a click on a stale closure: sometimes replay a handler taken before the previous step
      const stale = rnd() < 0.08
      try {
        if (stale) {
          const before = snapshot()
          const fo = atPath(p.orig.renderVals(), path)
          const fn = atPath(p.port.renderVals(), path)
          p.orig.setState({ toast: null })
          p.port.setState({ toast: null })
          fo(ev(value, key))
          const afterOrig = stored()
          restore(before)
          fn(ev(value, key))
          expect(stored(), `storage after stale ${path}`).toBe(afterOrig)
        } else {
          click(p, path, value, key)
        }
        handled++
      } catch (e: any) {
        if (/^(original|port) has no handler/.test(String(e?.message))) continue
        throw new Error(`seed ${seed} step ${i} ${path}: ${e?.message ?? e}`)
      }
      if (rnd() < 0.15) {
        vi.advanceTimersByTime(rnd() < 0.5 ? 1000 : 3000)
      }
      const c = renderBoth(p)
      if (c) {
        const d = firstDiff(serializeVals(c.vo), serializeVals(c.vp))
        if (d) throw new Error(`seed ${seed} step ${i} after ${path}: renderVals differ: ${d}`)
      }
      if (JSON.stringify(p.port.state) !== JSON.stringify(p.orig.state))
        throw new Error(`seed ${seed} step ${i} after ${path}: state differs`)
    }
    return handled
  }

  it('24 seeds of 100 steps on the default data stay identical', { timeout: 120_000 }, () => {
    let handled = 0
    for (let seed = 1; seed <= 24; seed++) handled += walk(seed, 100)
    expect(handled).toBeGreaterThan(24 * 100 * 0.7)
  })

  it('12 seeds of 100 steps starting dark', { timeout: 120_000 }, () => {
    let handled = 0
    for (let seed = 101; seed <= 112; seed++)
      handled += walk(seed, 100, () => {
        localStorage.setItem('oasis-theme', 'dark')
      })
    expect(handled).toBeGreaterThan(12 * 100 * 0.7)
  })
})
