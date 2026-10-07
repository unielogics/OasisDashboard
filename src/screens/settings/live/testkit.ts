/* eslint-disable @typescript-eslint/no-explicit-any */
// Shared by the live tests: a SettingsApi that serves responses captured from the real API (and records every call),
// and a LiveData built over it for a given role. Not shipped.
import { makeSession } from '@/auth/test-fixtures'
import { ApiError } from '@/data/http/problem'
import { makeQueryClient } from '@/data/query'
import type { SettingsApi } from '@/data/ports/settings-api'
import type { ToastSpec } from '@/data/toast'
import bundle from './__fixtures__/bundle.json'
import employees from './__fixtures__/employees.json'
import roles from './__fixtures__/roles.json'
import sofia from './__fixtures__/emp-sofia.json'
import { LiveData } from './LiveData'
import type { LiveDataDeps } from './LiveData'

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export type Call = [name: string, ...args: unknown[]]

/** A SettingsApi over the captured responses; every call is recorded and any method can be made to fail. */
export function fakeApi(): {
  api: SettingsApi
  calls: Call[]
  fail: Map<string, ApiError>
  state: { hoursVersion: number }
  bundle: any
  rolesRes: any
} {
  const calls: Call[] = []
  const fail = new Map<string, ApiError>()
  const state = { hoursVersion: 1 }
  const b = clone(bundle) as any
  const rolesRes = clone(roles) as any
  const step =
    <A extends unknown[], R>(name: string, fn: (...a: A) => R) =>
    async (...a: A): Promise<R> => {
      calls.push([name, ...a])
      const e = fail.get(name)
      if (e) throw e
      return fn(...a)
    }
  const hours = () => ({
    days: b.hours.days,
    rules: b.rules,
    weekHours: b.hours.weekHours,
    weekMinutes: b.hours.weekMinutes,
    federalAuto: b.federalAuto,
    version: state.hoursVersion,
  })
  const api: any = {
    bundle: step('bundle', () => clone(b)),
    hours: step('hours', () => clone(hours())),
    saveHours: step('saveHours', () => {
      state.hoursVersion += 1
      return {
        ...hours(),
        changed: true,
        warnings: { employeeScheduleConflicts: [{}], appointmentsOutsideHours: [] },
      }
    }),
    saveRules: step('saveRules', () => {
      state.hoursVersion += 1
      return { rules: b.rules, version: state.hoursVersion, changed: true }
    }),
    closures: step('closures', () => ({ federalAuto: b.federalAuto, ...clone(b.closures) })),
    previewClosure: step('previewClosure', () => ({ affected: 2 })),
    createClosure: step('createClosure', (body: any) => ({
      closure: { ...clone(b.closures.upcoming[0]), id: 'new-closure', name: body.name, date: body.date },
      affectedCount: 0,
      notified: 0,
    })),
    patchClosure: step('patchClosure', () => ({})),
    deleteClosure: step('deleteClosure', () => ({})),
    setFederal: step('setFederal', (enabled: boolean) => ({ enabled, created: [], version: 2 })),
    emergency: step('emergency', () => clone(b.emergency)),
    previewEmergency: step('previewEmergency', () => ({
      count: 1,
      affected: [
        {
          appointmentId: 'a',
          customerId: 'c',
          customerName: 'Liam Chen',
          firstName: 'Liam',
          vehicle: 'BMW',
          time: '10:45 AM',
          bizDate: '2026-06-13',
          dateLabel: 'Saturday, Jun 13',
          status: 'booked',
        },
      ],
      onSite: [],
      summary: '',
      untilText: 'for the rest of today',
      renderedMessage: 'Hi Liam, from the server',
      endsAt: '',
    })),
    closeShop: step('closeShop', () => ({
      summary: 'Severe weather · closed for the rest of today',
      notifiedCount: 3,
      skipped: 0,
      affected: [],
      onSite: [],
      closuresCreated: [],
      emergency: {},
    })),
    reopen: step('reopen', () => ({})),
    employees: step('employees', () => clone(employees)),
    employee: step('employee', () => clone(sofia)),
    createEmployee: step('createEmployee', () => ({ employee: clone(sofia), invite: {}, warnings: [] })),
    updateEmployee: step('updateEmployee', () => ({})),
    deactivateEmployee: step('deactivateEmployee', () => ({})),
    reactivateEmployee: step('reactivateEmployee', () => ({})),
    roles: step('roles', () => clone(rolesRes)),
    createRole: step('createRole', () => {
      const crew = rolesRes.roles.find((r: any) => r.key === 'crew').id
      rolesRes.roles.push({
        id: 'custom-role',
        key: null,
        name: 'Shift Lead',
        description: 'Custom role — starts from Crew.',
        locked: false,
        custom: true,
        peopleCount: 0,
        permissionCount: 5,
        version: 1,
      })
      rolesRes.matrix['custom-role'] = { ...rolesRes.matrix[crew], 'sched.edit': true }
      rolesRes.limits['custom-role'] = { refund: 2500, adjust: 2500, credit: 2500 }
      return { id: 'custom-role' }
    }),
    setPermission: step('setPermission', () => ({})),
    setLimit: step('setLimit', () => ({})),
    deleteRole: step('deleteRole', () => ({})),
    vip: step('vip', () => {
      const vip = clone(b.vip)
      delete vip.clients
      return vip
    }),
    vipClients: step('vipClients', () => ({ items: clone(b.vip.clients), count: b.vip.clients.length })),
    saveVip: step('saveVip', () => ({})),
    addHold: step('addHold', () => ({})),
    removeHold: step('removeHold', () => ({})),
    addVipClient: step('addVipClient', (body: any) => ({
      customerId: 'c1',
      fullName: body.name ?? (body.customerId === 'c-1' ? 'David Okafor' : 'By Id'),
      added: true,
      toast: null,
    })),
    removeVipClient: step('removeVipClient', () => ({})),
    arrival: step('arrival', () => clone(b.arrival)),
    saveArrival: step('saveArrival', () => ({})),
    services: step('services', () => clone(b.services)),
    saveChecklist: step('saveChecklist', (id: string, tasks: any[]) => {
      const svc = [...b.services.packages, ...b.services.addons].find((x: any) => x.id === id)
      svc.tasks = tasks.map((t, i) => ({ id: t.id ?? `new-${i}`, label: t.label ?? t, position: i }))
      svc.taskCount = svc.tasks.length
      svc.version += 1
      return { service: clone(svc), changed: true, summary: {} }
    }),
  }
  return { api: api as SettingsApi, calls, fail, state, bundle: b, rolesRes }
}

export function setup(
  over: {
    role?: 'mgmt' | 'crew' | 'super' | 'support'
    toast?: (t: ToastSpec) => void
    debounceMs?: LiveDataDeps['debounceMs']
  } = {},
) {
  const f = fakeApi()
  const toasts: ToastSpec[] = []
  const qc = makeQueryClient()
  qc.setDefaultOptions({ queries: { ...qc.getDefaultOptions().queries, retry: false } })
  const session = makeSession({ role: (over.role ?? 'mgmt') as 'mgmt' })
  const deps: LiveDataDeps = {
    api: f.api,
    qc,
    session: () => session,
    toast: (t) => {
      toasts.push(t)
      over.toast?.(t)
    },
    schedule: (fn) => fn(),
    debounceMs: { preview: 10, checklist: 10, closure: 10, ...over.debounceMs },
  }
  const data = new LiveData(deps)
  return { ...f, data, toasts, qc }
}
