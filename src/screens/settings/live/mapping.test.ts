/* eslint-disable @typescript-eslint/no-explicit-any */
// The mapping layer against responses captured from the real API (the `design` seed profile, Management user):
// __fixtures__/bundle.json (GET /settings/bundle), roles.json (GET /roles), employees.json (GET /employees) and
// emp-sofia.json (GET /employees/:id).
import { describe, expect, it } from 'vitest'
import { ApiError } from '@/data/http/problem'
import { ALL_PERMS, effective, hoursDirty } from '@/lib/settings'
import type { Draft, Emergency } from '@/lib/settings'
import bundle from './__fixtures__/bundle.json'
import employees from './__fixtures__/employees.json'
import roles from './__fixtures__/roles.json'
import sofia from './__fixtures__/emp-sofia.json'
import {
  affectedText,
  cadenceKey,
  cadenceLabel,
  candidateDetail,
  centsToDollars,
  closeBody,
  closureBody,
  closureMessage,
  employeeBody,
  errorTab,
  hoursBody,
  mapAffected,
  mapArrival,
  mapClosures,
  mapEmergency,
  mapEmployeeDetail,
  mapEmployeeSummary,
  mapHours,
  mapRoles,
  mapServices,
  mapVip,
  partsFromBundle,
  previewQuery,
  vipBody,
  warningsNote,
} from './mapping'

const b = bundle as any
const parts = partsFromBundle(b)

describe('hours and rules', () => {
  it('indexes the week by weekday and keeps the design shape', () => {
    const { hours, rules } = mapHours(parts.hours)
    expect(hours).toHaveLength(7)
    expect(hours[0]).toEqual({ open: true, from: '9:00 AM', to: '3:00 PM' })
    expect(hours[1]).toEqual({ open: true, from: '8:00 AM', to: '6:00 PM' })
    expect(hours[6]).toEqual({ open: true, from: '8:00 AM', to: '5:00 PM' })
    expect(rules).toEqual({ slot: 30, buffer: 10, cutoff: 60 })
  })

  it('a saved week is not dirty and the PUT body carries all seven days with the version', () => {
    const { hours } = mapHours(parts.hours)
    expect(hoursDirty(hours, JSON.stringify(hours))).toBe(false)
    const body = hoursBody(hours, 4)
    expect(body.version).toBe(4)
    expect(body.days.map((d) => d.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(body.days[1]).toEqual({ weekday: 1, open: true, from: '8:00 AM', to: '6:00 PM' })
  })

  it('words the server warnings for the toast', () => {
    expect(warningsNote({ employeeScheduleConflicts: [], appointmentsOutsideHours: [] })).toBe('')
    expect(warningsNote({ employeeScheduleConflicts: [1], appointmentsOutsideHours: [] })).toBe(
      '1 employee schedule no longer fits',
    )
    expect(warningsNote({ employeeScheduleConflicts: [1, 2], appointmentsOutsideHours: [1] })).toBe(
      '2 employee schedules no longer fit · 1 appointment is outside the new hours',
    )
  })
})

describe('closures', () => {
  it('merges upcoming and past, keeps the server sub-line and locks emergency rows', () => {
    const { closures, federal } = mapClosures(parts.closures)
    expect(federal).toBe(true)
    expect(closures.map((c) => c.name)).toEqual([
      'Thanksgiving',
      'Christmas Eve',
      'Christmas Day',
      'Labor Day',
      'Independence Day',
      'Weather closure',
      'Memorial Day',
    ])
    const thanksgiving = closures[0]!
    expect(thanksgiving).toMatchObject({ type: 'closed', from: '10:00 AM', to: '2:00 PM', notify: true })
    expect(thanksgiving.sub).toBe('Online booking blocked · 0 existing bookings to move')
    expect(closures[1]).toMatchObject({ type: 'reduced', from: '8:00 AM', to: '1:00 PM' })
    const weather = closures.find((c) => c.name === 'Weather closure')!
    expect(weather).toMatchObject({ emergency: true, locked: true })
    expect(closures.find((c) => c.name === 'Labor Day')!.sub).toBeUndefined()
  })

  it('builds the create body (reduced hours only when reduced) and the preview line', () => {
    expect(
      closureBody({
        date: '2026-12-01',
        name: ' Staff day ',
        type: 'closed',
        from: '9:00 AM',
        to: '1:00 PM',
      }),
    ).toEqual({
      date: '2026-12-01',
      name: 'Staff day',
      type: 'closed',
      notify: true,
    })
    expect(
      closureBody({ date: '2026-12-01', name: 'Half', type: 'reduced', from: '9:00 AM', to: '1:00 PM' }),
    ).toEqual({
      date: '2026-12-01',
      name: 'Half',
      type: 'reduced',
      from: '9:00 AM',
      to: '1:00 PM',
      notify: true,
    })
    expect(affectedText(0)).toBe('No customers are booked that day.')
    expect(affectedText(1)).toBe(
      '1 customer is booked that day — they’ll get a reschedule link when you add this.',
    )
    expect(affectedText(3)).toBe(
      '3 customers are booked that day — they’ll get a reschedule link when you add this.',
    )
  })

  it('shows the design’s apostrophe for a duplicate date', () => {
    const e = new ApiError({
      status: 422,
      code: 'CLOSURE_DATE_TAKEN',
      title: 'Check the form',
      detail: "There's already a closure on that date.",
    })
    expect(closureMessage(e)).toBe('There’s already a closure on that date.')
    expect(
      closureMessage(new ApiError({ status: 422, code: 'CLOSURE_INCOMPLETE', title: 't', detail: 'x' })),
    ).toBe('Add a date and a name.')
    expect(
      closureMessage(new ApiError({ status: 422, code: 'OTHER', title: 'Title', detail: 'Detail' })),
    ).toBe('Detail')
  })
})

describe('emergency', () => {
  it('idle: only the active flag and an empty summary, the form keeps what the person typed', () => {
    const { em, history } = mapEmergency(parts.emergency)
    expect(em).toEqual({ active: false, summary: '' })
    expect(history.map((h) => h.date)).toEqual(['Jun 3, 2026', 'Feb 18, 2026'])
    expect(history[0]).toEqual({
      date: 'Jun 3, 2026',
      reason: 'Severe weather',
      detail: 'Full day · 7 customers notified · 6 rebooked',
    })
  })

  it('active: the form is the running closure', () => {
    const active = {
      ...b.emergency,
      active: true,
      summary: 'Power outage · closed until 2:00 PM today · online booking paused',
      current: {
        id: 'x',
        reason: 'power_outage',
        reasonLabel: 'Power outage',
        durationKind: 'until',
        untilMin: 840,
        throughDate: null,
        endsAt: null,
        summary: 'Power outage · closed until 2:00 PM today · online booking paused',
        startedAt: '',
        startedByName: null,
        message: 'Hi {first}',
        notify: false,
        link: true,
        credits: true,
        pause: true,
        crew: false,
        counters: { affected: 3, notified: 0, rebooked: 1, booking: 'Paused' },
      },
    }
    const { em } = mapEmergency(active)
    expect(em).toMatchObject({
      active: true,
      reason: 'Power outage',
      dur: 'until',
      until: '2:00 PM',
      notify: false,
      crew: false,
      msg: 'Hi {first}',
    })
    expect('through' in em).toBe(false)
  })

  it('previews and closes with the same fields, and a multi-day list carries the date', () => {
    const em: Emergency = {
      active: false,
      summary: '',
      reason: 'Other',
      dur: 'days',
      until: '2:00 PM',
      through: '2026-12-02',
      notify: true,
      link: false,
      credits: true,
      pause: true,
      crew: true,
      msg: 'Hello',
    }
    expect(previewQuery(em)).toEqual({
      reason: 'Other',
      dur: 'days',
      through: '2026-12-02',
      message: 'Hello',
      notify: true,
      link: false,
      pause: true,
    })
    expect(closeBody({ ...em, dur: 'until' })).toMatchObject({
      dur: 'until',
      until: '2:00 PM',
      link: false,
      crew: true,
    })
    const preview = {
      count: 2,
      affected: [
        {
          appointmentId: '1',
          customerId: '1',
          customerName: 'Liam Chen',
          firstName: 'Liam',
          vehicle: 'BMW M340i',
          time: '10:45 AM',
          bizDate: '2026-12-01',
          dateLabel: 'Tuesday, Dec 1',
          status: 'booked',
        },
        {
          appointmentId: '2',
          customerId: '2',
          customerName: 'Aisha Rahman',
          firstName: 'Aisha',
          vehicle: null,
          time: '9:00 AM',
          bizDate: '2026-12-02',
          dateLabel: 'Wednesday, Dec 2',
          status: 'booked',
        },
      ],
      onSite: [],
      summary: '',
      untilText: '',
      renderedMessage: '',
      endsAt: '',
    }
    expect(mapAffected(preview as any, false).map((r) => r.time)).toEqual(['10:45 AM', '9:00 AM'])
    expect(mapAffected(preview as any, true)).toEqual([
      { time: 'Tue, Dec 1 · 10:45 AM', name: 'Liam Chen', veh: 'BMW M340i' },
      { time: 'Wed, Dec 2 · 9:00 AM', name: 'Aisha Rahman', veh: '' },
    ])
  })
})

describe('roles', () => {
  const rc = mapRoles(roles as any)
  const id = (key: string) => (roles as any).roles.find((r: any) => r.key === key).id as string

  it('maps the roles, the matrix and the limits (cents on the wire, whole dollars here)', () => {
    expect(rc.roles.map((r) => r.name)).toEqual([
      'Super Admin',
      'Management',
      'Accounting',
      'Customer Support',
      'Crew',
    ])
    expect(rc.roles[0]).toMatchObject({ locked: true })
    expect(rc.roles[1]!.locked).toBeUndefined()
    expect(rc.perms[id('crew')]).toEqual((roles as any).matrix[id('crew')])
    expect(Object.values(rc.perms[id('crew')]!).filter(Boolean)).toHaveLength(4)
    expect(rc.limits[id('super')]).toEqual({ refund: null, adjust: null, credit: null })
    expect(rc.limits[id('mgmt')]).toEqual({ refund: 1000, adjust: 500, credit: 500 })
    expect(rc.limits[id('support')]).toEqual({ refund: 50, adjust: 25, credit: 50 })
    expect(centsToDollars(2500)).toBe(25)
    expect(centsToDollars(null)).toBeNull()
    expect(centsToDollars(undefined)).toBeUndefined()
  })

  it('the engine reproduces the server’s effective permissions for Sofia (support + crew + one exception)', () => {
    const emp = mapEmployeeDetail(sofia as any)
    expect(emp.roles).toHaveLength(2)
    expect(emp.overrides).toEqual({ 'sched.override': 'allow' })
    const server = new Map((sofia as any).effectivePermissions.map((p: any) => [p.key, p]))
    expect(server.size).toBe(27)
    for (const key of ALL_PERMS) {
      const mine = effective(rc, emp, key)
      const theirs = server.get(key) as any
      expect([key, mine.on, mine.src]).toEqual([key, theirs.on, theirs.src])
    }
  })
})

describe('employees', () => {
  const items = (employees as any).items as any[]

  it('maps a list row: roles by id, enum labels, counts from the server, no schedule yet', () => {
    const e = mapEmployeeSummary(items.find((x) => x.first === 'Daniel'))
    expect(e).toMatchObject({
      first: 'Daniel',
      type: 'Part-time',
      payType: 'Hourly',
      rate: '34',
      status: 'active',
      daysPerWeek: 3,
      exceptionCount: 0,
    })
    expect(e.roles).toEqual([(roles as any).roles.find((r: any) => r.key === 'acct').id])
    const kevin = mapEmployeeSummary(items.find((x) => x.first === 'Kevin'))
    expect(kevin.status).toBe('invited')
    expect(mapEmployeeSummary(items.find((x) => x.first === 'Marco')).payType).toBe('Commission')
  })

  it('withholds pay (null on the wire) without inventing a value', () => {
    const hidden = mapEmployeeSummary({ ...items[0], payType: null, rateText: null })
    expect(hidden.payHidden).toBe(true)
    expect(hidden.rate).toBe('')
    expect(mapEmployeeSummary(items[0]).payHidden).toBeUndefined()
  })

  it('maps the detail: schedule by weekday and exceptions', () => {
    const e = mapEmployeeDetail(sofia as any)
    expect(e.sched).toHaveLength(7)
    expect(e.sched[0]).toEqual({ on: false, from: '9:00 AM', to: '3:00 PM' })
    expect(e.sched[6]).toEqual({ on: true, from: '8:00 AM', to: '5:00 PM' })
    expect(e.version).toBe(1)
  })

  it('builds the body from a draft and reads it back to the same schedule', () => {
    const e = mapEmployeeDetail(sofia as any)
    const draft: Draft = { ...e, first: ' Sofía ', rate: ' 23 ' }
    const body = employeeBody(draft, true)
    expect(body).toMatchObject({
      first: 'Sofía',
      rateText: '23',
      employmentType: 'full_time',
      payType: 'hourly',
    })
    expect(body).not.toHaveProperty('rate')
    expect(body.schedule).toHaveLength(7)
    expect(body.schedule![0]).toEqual({ weekday: 1, on: true, fromMin: 480, toMin: 1080 })
    expect(body.schedule!.at(-1)).toEqual({ weekday: 0, on: false, fromMin: 540, toMin: 900 })
    expect(body.overrides).toEqual({ 'sched.override': 'allow' })
    expect('payType' in employeeBody(draft, false)).toBe(false)
  })

  it('finds the drawer tab an error belongs to', () => {
    const err = (detail: string, path = '') =>
      new ApiError({ status: 422, title: 'x', detail, errors: path ? [{ path, message: detail }] : [] })
    expect(errorTab(err('First name and mobile number are required.', 'first'))).toBe('profile')
    expect(errorTab(err('Assign at least one role.', 'roles'))).toBe('access')
    expect(errorTab(err('Sunday: availability must sit inside business hours (9:00 AM – 3:00 PM).'))).toBe(
      'sched',
    )
    expect(errorTab(err('Enter a valid mobile number.', 'phone'))).toBe('profile')
  })
})

describe('VIP, arrival and services', () => {
  it('maps the program (cadence keys become the design’s labels) and the client names', () => {
    const { vip, clients } = mapVip(parts.vip)
    expect(vip).toMatchObject({ release: 48, windowVip: 30, windowStd: 14, sameDay: 2, offerMin: 15 })
    expect(vip.cadences).toEqual(['Weekly', 'Every 2 weeks', 'Monthly'])
    expect(vip.holds).toContainEqual({ d: 6, t: '8:00 AM' })
    expect(vip.holds).toHaveLength(5)
    expect(clients).toEqual(['Jonathan Franco', 'Liam Chen', 'Aisha Rahman', 'Elena Volkov'])
    expect(mapVip({ view: parts.vip.view, clients: null }).clients).toBeNull()
    expect(cadenceKey(cadenceLabel('triweekly'))).toBe('triweekly')
  })

  it('sends only what changed, with cadence keys', () => {
    expect(vipBody({ windowVip: 37 })).toEqual({ windowVip: 37 })
    expect(vipBody({ cadences: ['Weekly', 'Every 3 weeks'] })).toEqual({ cadences: ['weekly', 'triweekly'] })
    expect(vipBody({ holds: [], clients: [], release: 24 })).toEqual({ release: 24 })
  })

  it('maps the arrival settings without the version', () => {
    expect(mapArrival(parts.arrival)).toEqual({
      on: true,
      radius: 300,
      prepAt: 15,
      autoArrive: true,
      welcome: true,
      crew: true,
      vipFirst: true,
    })
  })

  it('maps packages and add-ons by name with whole-dollar prices and ordered labels', () => {
    const { packages, addons } = mapServices(parts.services)
    expect(Object.keys(packages)[1]).toBe('Premium Hand Wash + Interior')
    expect(packages['Premium Hand Wash + Interior']).toMatchObject({ price: 129, dur: 75 })
    expect(packages['Premium Hand Wash + Interior']!.tasks[0]).toBe('Exterior pre-rinse')
    expect(Object.keys(addons)).toHaveLength(10)
    expect(addons['Wax']).toMatchObject({ price: 40 })
    expect(addons['Wax']!.tasks).toEqual(['Apply carnauba wax', 'Buff off haze'])
  })

  it('words a candidate: vehicles, the last four digits, already VIP', () => {
    expect(
      candidateDetail({ vehicles: ['2020 BMW M340i'], phoneHint: '+1******0107', alreadyVip: true }),
    ).toBe('2020 BMW M340i · …0107 · already VIP')
    expect(candidateDetail({ vehicles: [], phoneHint: null, alreadyVip: false })).toBe('')
  })
})
