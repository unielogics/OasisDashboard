// The Settings endpoints as the backend declares them (types from the generated settings-schema.d.ts), and a typed
// client over ApiClient. The live Settings data (src/screens/settings/live) is the only caller.
import type { ApiClient, RequestOptions } from '../http/client'
import type { paths as apiPaths } from '../http/schema'
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
// Vehicle sizes, prices by size, membership tiers and the booking fee (ADR 0170; api-spec 15.9, 15.10). The pre-size
// writes (tint matrix, guest markup, plans) answer 410 since then and are not called.
export type VehicleClass = CatalogRes['vehicleClasses'][number]
export type VehicleClassCreateReq = Req<operations['createVehicleClass']>
export type VehicleClassPatchReq = Req<operations['updateVehicleClass']>
export type VehicleClassRes = Ok<operations['updateVehicleClass']>
export type PriceRow = CatalogRes['prices'][number]
export type PricesReq = Req<operations['putCatalogPrices']>
export type PricesRes = Ok<operations['putCatalogPrices']>
export type Tier = CatalogRes['tiers'][number]
export type TierCreateReq = Req<operations['createCatalogTier']>
export type TierReq = Req<operations['putCatalogTier']>
export type TierRes = Ok<operations['putCatalogTier']>
export type TierPricesReq = Req<operations['putCatalogTierPrices']>
export type TierPricesRes = Ok<operations['putCatalogTierPrices']>
export type GuestFee = CatalogRes['guestFee']
export type GuestFeeReq = Req<operations['putCatalogGuestFee']>
export type RemindersRes = Ok<operations['getSettingsReminders']>
export type RemindersReq = Req<operations['putSettingsReminders']>
export type RemindersSaveRes = Ok<operations['putSettingsReminders']>
export type RemindersPreviewReq = Req<operations['previewSettingsReminders']>
export type RemindersPreviewRes = Ok<operations['previewSettingsReminders']>

// Settings → Billing & integrations (ADR 0171; api-spec 30.13, 30.11, 30.12, 30.3): typed from the full API schema
type ApiOk<P extends keyof apiPaths, M extends 'get' | 'put' | 'post'> = Ok<NonNullable<apiPaths[P][M]>>
type ApiReq<P extends keyof apiPaths, M extends 'put' | 'post'> = Req<NonNullable<apiPaths[P][M]>>
export type BillingRes = ApiOk<'/api/v1/settings/billing', 'get'>
export type SquareTestRes = ApiOk<'/api/v1/integrations/square/test', 'post'>
export type CatalogSyncRes = ApiOk<'/api/v1/integrations/square/catalog/sync', 'post'>
export type LinkTippingReq = ApiReq<'/api/v1/settings/billing/link-tipping', 'put'>
export type LinkTippingRes = ApiOk<'/api/v1/settings/billing/link-tipping', 'put'>
export type RenewalPolicyReq = ApiReq<'/api/v1/settings/billing/renewal-policy', 'put'>
export type RenewalPolicyRes = ApiOk<'/api/v1/settings/billing/renewal-policy', 'put'>
export type PriceNoticeReq = ApiReq<'/api/v1/settings/billing/price-change-notice', 'put'>
export type PriceNoticeRes = ApiOk<'/api/v1/settings/billing/price-change-notice', 'put'>
export type CardFeesReq = ApiReq<'/api/v1/settings/card-fees', 'put'>
export type CardFeesRes = ApiOk<'/api/v1/settings/card-fees', 'put'>
export type MoveMembersRes = ApiOk<'/api/v1/catalog/tiers/{key}/move-members', 'post'>

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
  createVehicleClass(body: VehicleClassCreateReq, o?: Opts): Promise<VehicleClass>
  updateVehicleClass(key: string, body: VehicleClassPatchReq, o?: Opts): Promise<VehicleClassRes>
  deleteVehicleClass(key: string, version: number | undefined, o?: Opts): Promise<unknown>
  savePrices(body: PricesReq, o?: Opts): Promise<PricesRes>
  createTier(body: TierCreateReq, o?: Opts): Promise<Tier>
  saveTier(key: string, body: TierReq, o?: Opts): Promise<TierRes>
  deleteTier(key: string, version: number | undefined, o?: Opts): Promise<unknown>
  saveTierPrices(body: TierPricesReq, o?: Opts): Promise<TierPricesRes>
  saveGuestFee(body: GuestFeeReq, o?: Opts): Promise<GuestFee>
  reminders(): Promise<RemindersRes>
  saveReminders(body: RemindersReq, o?: Opts): Promise<RemindersSaveRes>
  previewReminders(body: RemindersPreviewReq, o?: Pick<Opts, 'signal'>): Promise<RemindersPreviewRes>
  // Settings → Billing & integrations (set.billing; the booking fee stays on saveGuestFee, set.services)
  billing(): Promise<BillingRes>
  saveLinkTipping(body: LinkTippingReq, o?: Opts): Promise<LinkTippingRes>
  saveRenewalPolicy(body: RenewalPolicyReq, o?: Opts): Promise<RenewalPolicyRes>
  savePriceNotice(body: PriceNoticeReq, o?: Opts): Promise<PriceNoticeRes>
  saveCardFees(body: CardFeesReq, o?: Opts): Promise<CardFeesRes>
  /** POST /integrations/square/test: token, location, Events API and webhook subscription (the simulator with sim). */
  testSquare(o?: Opts): Promise<SquareTestRes>
  /** POST /integrations/square/catalog/sync ("Sync to Square"): skipped while Square writes or memberships are off. */
  syncSquareCatalog(o?: Opts): Promise<CatalogSyncRes>
  /** POST /catalog/tiers/:key/move-members (set.billing): members on an older price are told, then moved. */
  moveMembers(key: string, body: { notice?: number }, o?: Opts): Promise<MoveMembersRes>
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
    createVehicleClass: (body, o) => c.post('/catalog/vehicle-classes', body, o),
    updateVehicleClass: (key, body, o) => c.patch(`/catalog/vehicle-classes/${enc(key)}`, body, o),
    deleteVehicleClass: (key, version, o) =>
      c.delete(`/catalog/vehicle-classes/${enc(key)}`, version === undefined ? o : { ...o, ifMatch: version }),
    savePrices: (body, o) => c.put('/catalog/prices', body, o),
    createTier: (body, o) => c.post('/catalog/tiers', body, o),
    saveTier: (key, body, o) => c.put(`/catalog/tiers/${enc(key)}`, body, o),
    deleteTier: (key, version, o) =>
      c.delete(`/catalog/tiers/${enc(key)}`, version === undefined ? o : { ...o, ifMatch: version }),
    saveTierPrices: (body, o) => c.put('/catalog/tier-prices', body, o),
    saveGuestFee: (body, o) => c.put('/catalog/guest-fee', body, o),
    reminders: () => c.get('/settings/reminders'),
    saveReminders: (body, o) => c.put('/settings/reminders', body, o),
    previewReminders: (body, o) => c.post('/settings/reminders/preview', body, { ...o, retries: 0 }),
    billing: () => c.get('/settings/billing'),
    saveLinkTipping: (body, o) => c.put('/settings/billing/link-tipping', body, o),
    saveRenewalPolicy: (body, o) => c.put('/settings/billing/renewal-policy', body, o),
    savePriceNotice: (body, o) => c.put('/settings/billing/price-change-notice', body, o),
    saveCardFees: (body, o) => c.put('/settings/card-fees', body, o),
    testSquare: (o) => c.post('/integrations/square/test', {}, o),
    syncSquareCatalog: (o) => c.post('/integrations/square/catalog/sync', {}, o),
    moveMembers: (key, body, o) => c.post(`/catalog/tiers/${enc(key)}/move-members`, body, o),
  }
}
