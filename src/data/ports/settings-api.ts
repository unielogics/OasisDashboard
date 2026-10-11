// The Settings endpoints as the backend declares them (types from the generated settings-schema.d.ts), and a typed
// client over ApiClient. The live Settings data (src/screens/settings/live) is the only caller.
import type { ApiClient, RequestOptions } from '../http/client'
import type { operations, paths } from './settings-schema'

const enc = encodeURIComponent

type JsonBody<R> = R extends { content: { 'application/json': infer B } } ? B : never
type Ok<Op> = Op extends { responses: { 200: infer R } }
  ? JsonBody<R>
  : Op extends { responses: { 201: infer R } }
    ? JsonBody<R>
    : never
type Req<Op> = Op extends { requestBody: { content: { 'application/json': infer B } } } ? B : never
type Method<P extends keyof paths, M extends 'get' | 'put' | 'post' | 'patch' | 'delete'> = paths[P][M]

export type Bundle = Ok<operations['getSettingsBundle']>
export type HoursRes = Ok<operations['getSettingsHours']>
export type SaveHoursRes = Ok<operations['putSettingsHours']>
export type SaveHoursReq = Req<operations['putSettingsHours']>
export type SaveRulesRes = Ok<operations['putSettingsRules']>
export type RulesReq = Req<operations['putSettingsRules']>
export type ClosuresRes = Ok<operations['listClosures']>
export type ClosureView = ClosuresRes['upcoming'][number]
export type CreateClosureReq = Req<operations['createClosure']>
export type CreateClosureRes = Ok<operations['createClosure']>
export type PreviewClosureRes = Ok<operations['previewClosure']>
export type EmergencyRes = Ok<operations['getEmergency']>
export type EmergencyPreviewRes = Ok<operations['previewEmergency']>
export type CloseShopReq = Req<operations['closeShop']>
export type CloseShopRes = Ok<operations['closeShop']>
export type EmployeesRes = Ok<Method<'/api/v1/employees', 'get'>>
export type EmployeeSummary = EmployeesRes['items'][number]
export type EmployeeReq = Req<Method<'/api/v1/employees', 'post'>>
export type CreateEmployeeRes = Ok<Method<'/api/v1/employees', 'post'>>
export type EmployeeDetail = CreateEmployeeRes['employee']
export type RolesRes = Ok<Method<'/api/v1/roles', 'get'>>
export type RoleCreatedRes = Ok<Method<'/api/v1/roles', 'post'>>
export type VipRes = Ok<operations['getVip']>
export type VipReq = Req<operations['putVip']>
export type VipClientsRes = Ok<operations['listVipClients']>
export type AddVipClientReq = Req<operations['addVipClient']>
export type AddVipClientRes = Ok<operations['addVipClient']>
export type AddHoldRes = Ok<operations['addVipHold']>
export type ArrivalRes = Ok<operations['getArrivalSettings']>
export type ArrivalReq = Req<operations['putArrivalSettings']>
export type ServicesRes = Ok<operations['listServices']>
export type ChecklistRes = Ok<operations['putServiceChecklist']>
export type FederalRes = Ok<operations['putAutoFederalHolidays']>
// Settings → Catalog, Categories and Reminders (ADR 0160, plan A, I, K; api-spec 15.6a and 15.8)
export type CatalogRes = Ok<operations['getCatalogSettings']>
export type CatalogService = CatalogRes['packages'][number]
export type CatalogServiceReq = Req<operations['putCatalogService']>
export type CatalogServiceRes = Ok<operations['putCatalogService']>
export type CatalogCategory = CatalogRes['categories'][number]
export type CategoryCreateReq = Req<operations['createCatalogCategory']>
export type CategoryPatchReq = Req<operations['updateCatalogCategory']>
export type CategoryRes = Ok<operations['updateCatalogCategory']>
export type TintMatrix = CatalogRes['tintMatrix']
export type TintMatrixReq = Req<operations['putCatalogTintMatrix']>
export type GuestMarkupRes = Ok<operations['putCatalogGuestMarkup']>
export type CatalogPlan = CatalogRes['plans'][number]
export type PlanReq = Req<operations['putCatalogPlan']>
export type PlanRes = Ok<operations['putCatalogPlan']>
export type RemindersRes = Ok<operations['getSettingsReminders']>
export type RemindersReq = Req<operations['putSettingsReminders']>
export type RemindersSaveRes = Ok<operations['putSettingsReminders']>
export type RemindersPreviewReq = Req<operations['previewSettingsReminders']>
export type RemindersPreviewRes = Ok<operations['previewSettingsReminders']>

type Opts = Pick<RequestOptions, 'idempotencyKey' | 'ifMatch' | 'signal'>

export interface SettingsApi {
  bundle(): Promise<Bundle>
  hours(): Promise<HoursRes>
  saveHours(body: SaveHoursReq, o?: Opts): Promise<SaveHoursRes>
  saveRules(body: RulesReq, o?: Opts): Promise<SaveRulesRes>
  closures(): Promise<ClosuresRes>
  previewClosure(body: {
    date: string
    type: 'closed' | 'reduced'
    from?: string
    to?: string
  }): Promise<PreviewClosureRes>
  createClosure(body: CreateClosureReq, o?: Opts): Promise<CreateClosureRes>
  patchClosure(id: string, body: { notify?: boolean }, o?: Opts): Promise<unknown>
  deleteClosure(id: string, o?: Opts): Promise<unknown>
  setFederal(enabled: boolean, o?: Opts): Promise<FederalRes>
  emergency(): Promise<EmergencyRes>
  previewEmergency(q: {
    reason: string
    dur: 'today' | 'until' | 'days'
    until?: string
    through?: string
    message?: string
    notify?: boolean
    link?: boolean
    pause?: boolean
  }): Promise<EmergencyPreviewRes>
  closeShop(body: CloseShopReq, o?: Opts): Promise<CloseShopRes>
  reopen(o?: Opts): Promise<unknown>
  employees(): Promise<EmployeesRes>
  employee(id: string): Promise<EmployeeDetail>
  createEmployee(body: EmployeeReq, o?: Opts): Promise<CreateEmployeeRes>
  updateEmployee(id: string, version: number, body: EmployeeReq, o?: Opts): Promise<unknown>
  deactivateEmployee(id: string, o?: Opts): Promise<unknown>
  reactivateEmployee(id: string, o?: Opts): Promise<unknown>
  roles(): Promise<RolesRes>
  createRole(o?: Opts): Promise<RoleCreatedRes>
  setPermission(roleId: string, key: string, granted: boolean, o?: Opts): Promise<unknown>
  /** `valueDollars` is one of the limit chips (25 .. 1000) or null for "No limit". */
  setLimit(roleId: string, kind: string, valueDollars: number | null, o?: Opts): Promise<unknown>
  deleteRole(id: string, o?: Opts): Promise<unknown>
  vip(): Promise<VipRes>
  vipClients(): Promise<VipClientsRes>
  saveVip(body: VipReq, o?: Opts): Promise<unknown>
  addHold(body: { weekday: number; time: string }, o?: Opts): Promise<AddHoldRes>
  removeHold(id: string, o?: Opts): Promise<unknown>
  addVipClient(body: AddVipClientReq, o?: Opts): Promise<AddVipClientRes>
  removeVipClient(customerId: string, o?: Opts): Promise<unknown>
  arrival(): Promise<ArrivalRes>
  saveArrival(body: ArrivalReq, o?: Opts): Promise<unknown>
  services(): Promise<ServicesRes>
  saveChecklist(
    id: string,
    tasks: (string | { id?: string; label: string })[],
    o?: Opts,
  ): Promise<ChecklistRes>
  // Settings → Catalog / Categories (set.services to write) and Reminders (set.hours to write)
  catalog(): Promise<CatalogRes>
  saveCatalogService(id: string, body: CatalogServiceReq, o?: Opts): Promise<CatalogServiceRes>
  createCategory(body: CategoryCreateReq, o?: Opts): Promise<CatalogCategory>
  updateCategory(key: string, body: CategoryPatchReq, o?: Opts): Promise<CategoryRes>
  deleteCategory(key: string, version: number | undefined, o?: Opts): Promise<unknown>
  saveTintMatrix(body: TintMatrixReq, o?: Opts): Promise<TintMatrix>
  saveGuestMarkup(body: { pct: number; version?: number }, o?: Opts): Promise<GuestMarkupRes>
  savePlan(key: string, body: PlanReq, o?: Opts): Promise<PlanRes>
  reminders(): Promise<RemindersRes>
  saveReminders(body: RemindersReq, o?: Opts): Promise<RemindersSaveRes>
  previewReminders(body: RemindersPreviewReq, o?: Pick<Opts, 'signal'>): Promise<RemindersPreviewRes>
}

export function createSettingsApi(c: ApiClient): SettingsApi {
  return {
    bundle: () => c.get('/settings/bundle'),
    hours: () => c.get('/settings/hours'),
    saveHours: (body, o) => c.put('/settings/hours', body, o),
    saveRules: (body, o) => c.put('/settings/rules', body, o),
    closures: () => c.get('/closures'),
    previewClosure: (body) => c.post('/closures/preview', body, { retries: 0 }),
    createClosure: (body, o) => c.post('/closures', body, o),
    patchClosure: (id, body, o) => c.patch(`/closures/${enc(id)}`, body, o),
    deleteClosure: (id, o) => c.delete(`/closures/${enc(id)}`, o),
    setFederal: (enabled, o) => c.put('/settings/auto-federal-holidays', { enabled }, o),
    emergency: () => c.get('/emergency'),
    previewEmergency: (q) => c.get('/emergency/preview', { query: q }),
    closeShop: (body, o) => c.post('/emergency/close', body, o),
    reopen: (o) => c.post('/emergency/reopen', undefined, o),
    employees: () => c.get('/employees'),
    employee: (id) => c.get(`/employees/${enc(id)}`),
    createEmployee: (body, o) => c.post('/employees', body, o),
    updateEmployee: (id, version, body, o) =>
      c.put(`/employees/${enc(id)}`, body, { ...o, ifMatch: version }),
    deactivateEmployee: (id, o) => c.post(`/employees/${enc(id)}/deactivate`, undefined, o),
    reactivateEmployee: (id, o) => c.post(`/employees/${enc(id)}/reactivate`, undefined, o),
    roles: () => c.get('/roles'),
    createRole: (o) => c.post('/roles', {}, o),
    setPermission: (roleId, key, granted, o) =>
      c.put(`/roles/${enc(roleId)}/permissions/${enc(key)}`, { granted }, o),
    setLimit: (roleId, kind, value, o) => c.put(`/roles/${enc(roleId)}/limits/${enc(kind)}`, { value }, o),
    deleteRole: (id, o) => c.delete(`/roles/${enc(id)}`, o),
    vip: () => c.get('/vip'),
    vipClients: () => c.get('/vip/clients'),
    saveVip: (body, o) => c.put('/vip', body, o),
    addHold: (body, o) => c.post('/vip/holds', body, o),
    removeHold: (id, o) => c.delete(`/vip/holds/${enc(id)}`, o),
    addVipClient: (body, o) => c.post('/vip/clients', body, o),
    removeVipClient: (id, o) => c.delete(`/vip/clients/${enc(id)}`, o),
    arrival: () => c.get('/arrival-settings'),
    saveArrival: (body, o) => c.put('/arrival-settings', body, o),
    services: () => c.get('/services'),
    saveChecklist: (id, tasks, o) => c.put(`/services/${enc(id)}/checklist`, { tasks }, o),
    catalog: () => c.get('/catalog'),
    saveCatalogService: (id, body, o) => c.put(`/catalog/services/${enc(id)}`, body, o),
    createCategory: (body, o) => c.post('/catalog/categories', body, o),
    updateCategory: (key, body, o) => c.patch(`/catalog/categories/${enc(key)}`, body, o),
    deleteCategory: (key, version, o) =>
      c.delete(`/catalog/categories/${enc(key)}`, version === undefined ? o : { ...o, ifMatch: version }),
    saveTintMatrix: (body, o) => c.put('/catalog/tint-matrix', body, o),
    saveGuestMarkup: (body, o) => c.put('/catalog/guest-markup', body, o),
    savePlan: (key, body, o) => c.put(`/catalog/plans/${enc(key)}`, body, o),
    reminders: () => c.get('/settings/reminders'),
    saveReminders: (body, o) => c.put('/settings/reminders', body, o),
    previewReminders: (body, o) => c.post('/settings/reminders/preview', body, { ...o, retries: 0 }),
  }
}
