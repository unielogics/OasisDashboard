// Settings → Shop floor (ADR 0180, api-spec 31.3 and 31.4): the manager's kiosk controls (team.roles) and the team
// activity report (team.edit; amounts need pay.reports). Types from the generated schema.d.ts, so they are the server's
// own contract. The live Settings sections (src/screens/settings/live/kiosk.ts, team-activity.ts) are the only callers.
import type { ApiClient, RequestOptions } from '../http/client'
import type { paths } from '../http/schema'

const enc = encodeURIComponent

type Json<R> = R extends { content: { 'application/json': infer B } } ? B : never
type Ok<Op> = Op extends { responses: { 200: infer R } }
  ? Json<R>
  : Op extends { responses: { 201: infer R } }
    ? Json<R>
    : never

export type KioskOverview = Ok<paths['/api/v1/kiosk']['get']>
export type KioskDevice = KioskOverview['devices'][number]
export type KioskStaffRow = KioskOverview['staff'][number]
export type KioskRecent = KioskOverview['recent'][number]
export type KioskModeRes = Ok<paths['/api/v1/kiosk/settings']['put']>
export type KioskCodeRes = Ok<paths['/api/v1/kiosk/code']['put']>
export type RegisterRes = Ok<paths['/api/v1/kiosk/devices']['post']>
export type LockAllRes = Ok<paths['/api/v1/kiosk/lock-all']['post']>
export type EmployeeActivity = Ok<paths['/api/v1/reports/employee-activity']['get']>
export type ActivityEmployee = EmployeeActivity['employees'][number]
export type ActivityTotals = ActivityEmployee['totals']
export type ActivityDay = ActivityEmployee['days'][number]
export type ActivityCar = NonNullable<EmployeeActivity['cars']>[number]
export type StaffEventKind = ActivityCar['steps'][number]['kind']
export type EmployeeEvents = Ok<paths['/api/v1/reports/employee-activity/{employeeId}/events']['get']>
export type EmployeeEvent = EmployeeEvents['items'][number]

type Opts = Pick<RequestOptions, 'idempotencyKey' | 'signal'>

export interface KioskAdminApi {
  overview(signal?: AbortSignal): Promise<KioskOverview>
  setMode(enabled: boolean, version: number, o?: Opts): Promise<KioskModeRes>
  setCode(body: { code: string } | { generate: true }, o?: Opts): Promise<KioskCodeRes>
  /** "Make this a kiosk": registers THIS browser (the device cookie is set by the answer). */
  register(name: string, o?: Opts): Promise<RegisterRes>
  rename(id: string, name: string, version: number, o?: Opts): Promise<KioskDevice>
  revoke(id: string, o?: Opts): Promise<void>
  lockDevice(id: string, o?: Opts): Promise<void>
  clearLockout(id: string, o?: Opts): Promise<KioskDevice>
  lockAll(o?: Opts): Promise<LockAllRes>
  setListed(employeeId: string, listed: boolean, o?: Opts): Promise<KioskStaffRow>
  activity(q: { from: string; to: string; employeeId?: string }, signal?: AbortSignal): Promise<EmployeeActivity>
  events(employeeId: string, q: { from: string; to: string; cursor?: string }, signal?: AbortSignal): Promise<EmployeeEvents>
}

export function createKioskAdminApi(c: ApiClient): KioskAdminApi {
  return {
    overview: (signal) => c.get('/kiosk', { signal }),
    setMode: (enabled, version, o) => c.put('/kiosk/settings', { enabled, version }, o),
    setCode: (body, o) => c.put('/kiosk/code', body, { ...o, retries: 0 }),
    register: (name, o) => c.post('/kiosk/devices', { name }, o),
    rename: (id, name, version, o) => c.patch(`/kiosk/devices/${enc(id)}`, { name, version }, o),
    revoke: (id, o) => c.delete(`/kiosk/devices/${enc(id)}`, o),
    lockDevice: (id, o) => c.post(`/kiosk/devices/${enc(id)}/lock`, undefined, o),
    clearLockout: (id, o) => c.post(`/kiosk/devices/${enc(id)}/clear-lockout`, undefined, o),
    lockAll: (o) => c.post('/kiosk/lock-all', undefined, o),
    setListed: (employeeId, listed, o) => c.put(`/kiosk/staff/${enc(employeeId)}`, { listed }, o),
    activity: (q, signal) =>
      c.get('/reports/employee-activity', { query: { from: q.from, to: q.to, employeeId: q.employeeId }, signal }),
    events: (employeeId, q, signal) =>
      c.get(`/reports/employee-activity/${enc(employeeId)}/events`, {
        query: { from: q.from, to: q.to, cursor: q.cursor },
        signal,
      }),
  }
}
