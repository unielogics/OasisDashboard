// The Operations region of the data port: the board, calendar, appointment file, availability, messages, photos and the
// appointment commands of the backend (api-spec sections 20, 22 and 23). Response and request types come from the
// generated operations-schema.d.ts (scripts/gen-operations-schema.ts), so they are the server's own contract; the
// aliases below name the pieces the screen uses. Everything money is integer cents and every label the design derives
// (time, bayLabel, atLabel, toast) is sent by the server.
import type { ApiClient, RequestOptions } from '../http/client'
import type { paths } from './operations-schema'

const enc = encodeURIComponent

type JsonBody<R> = R extends { content: { 'application/json': infer B } } ? B : never
type Ok<Op> = Op extends { responses: { 200: infer R } }
  ? JsonBody<R>
  : Op extends { responses: { 201: infer R } }
    ? JsonBody<R>
    : never
type Req<Op> = Op extends { requestBody?: { content: { 'application/json': infer B } } } ? B : never
type Op<P extends keyof paths, M extends 'get' | 'put' | 'post' | 'patch' | 'delete'> = paths[P][M]

// ---- reads ----------------------------------------------------------------------------------------------------------

export type OpsWindow = 'next24' | 'today' | 'tomorrow' | 'week'
export type OpsSnapshot = Ok<Op<'/api/v1/ops/snapshot', 'get'>>
export type OpsCard = OpsSnapshot['timeline']['groups'][number]['items'][number]
export type OpsGroup = OpsSnapshot['timeline']['groups'][number]
export type OpsBay = OpsSnapshot['bays'][number]
export type OpsArrival = OpsSnapshot['arrivals'][number]
export type OpsStaffColumn = OpsSnapshot['staff'][number]
export type OpsAlert = OpsSnapshot['alerts'][number]
export type OpsKpi = OpsSnapshot['kpis'][number]
export type PayView = OpsCard['pay']

export type CalendarSummary = Ok<Op<'/api/v1/calendar/summary', 'get'>>
export type CalendarSummaryDay = CalendarSummary['days'][number]
export type CalendarDay = Ok<Op<'/api/v1/calendar/day', 'get'>>

export type AppointmentFile = Ok<Op<'/api/v1/appointments/{id}', 'get'>>
export type FileChecklistSection = AppointmentFile['checklist']['sections'][number]
export type FilePhoto = AppointmentFile['photos']['arrival']['items'][number]
export type PhotoCategory = 'arrival' | 'before' | 'after' | 'issue'

export type Availability = Ok<Op<'/api/v1/availability', 'get'>>
export type AvailabilitySlot = Availability['slots'][number]
export type AvailabilityQuery = {
  date: string
  serviceId: string
  addonIds?: string[]
  channel?: 'desk' | 'online'
  customerId?: string
  excludeAppointmentId?: string
}

export type Thread = Ok<Op<'/api/v1/appointments/{id}/messages', 'get'>>
export type ThreadMessage = Thread['items'][number]
export type SendMessageRes = Ok<Op<'/api/v1/appointments/{id}/messages', 'post'>>
export type SendMessageReq = Req<Op<'/api/v1/appointments/{id}/messages', 'post'>>
export type Templates = Ok<Op<'/api/v1/messages/templates', 'get'>>

export type CustomerHits = Ok<Op<'/api/v1/customers', 'get'>>
export type CustomerHit = CustomerHits['items'][number]
export type MembershipView = Ok<Op<'/api/v1/customers/{id}/membership', 'get'>>
export type ServiceCatalog = Ok<Op<'/api/v1/services', 'get'>>

// ---- commands -------------------------------------------------------------------------------------------------------

export type CommandRes = Ok<Op<'/api/v1/appointments/{id}/advance', 'post'>>
export type AppointmentCore = CommandRes['appointment']
export type AddonRes = Ok<Op<'/api/v1/appointments/{id}/addons/{serviceId}', 'put'>>
export type ChecklistItemRes = Ok<Op<'/api/v1/appointments/{id}/checklist/items/{itemId}', 'put'>>
export type ChecklistBulkRes = Ok<Op<'/api/v1/appointments/{id}/checklist/bulk', 'post'>>
export type BookingReq = Req<Op<'/api/v1/appointments', 'post'>>
export type BookingRes = Ok<Op<'/api/v1/appointments', 'post'>>
export type CreateCustomerReq = Req<Op<'/api/v1/customers', 'post'>>
export type CreateCustomerRes = Ok<Op<'/api/v1/customers', 'post'>>
export type PresignRes = Ok<Op<'/api/v1/appointments/{id}/photos/presign', 'post'>>
export type PerkRes = Ok<Op<'/api/v1/appointments/{id}/membership-perks/apply', 'post'>>
export type ApptStatus = AppointmentCore['status']

type Opts = Pick<RequestOptions, 'idempotencyKey' | 'signal'>

export interface OperationsPort {
  // reads
  snapshot(q: { window: OpsWindow; q?: string }): Promise<OpsSnapshot>
  calendarSummary(from: string, to: string): Promise<CalendarSummary>
  calendarDay(date: string): Promise<CalendarDay>
  appointment(id: string): Promise<AppointmentFile>
  thread(id: string): Promise<Thread>
  availability(q: AvailabilityQuery): Promise<Availability>
  customers(q: string): Promise<CustomerHits>
  membership(customerId: string): Promise<MembershipView>
  catalog(): Promise<ServiceCatalog>
  templates(): Promise<Templates>
  // lifecycle
  advance(id: string, expectedStatus: ApptStatus, o?: Opts): Promise<CommandRes>
  arrive(id: string, o?: Opts): Promise<CommandRes>
  assignBay(id: string, bayId: string, o?: Opts): Promise<CommandRes>
  prepBay(id: string, o?: Opts): Promise<CommandRes>
  reschedule(
    id: string,
    input: { start: string; override?: { reason: string } },
    o?: Opts,
  ): Promise<CommandRes>
  pickup(id: string, state: 'collected' | 'pending', o?: Opts): Promise<CommandRes>
  notifyReady(id: string, o?: Opts): Promise<CommandRes>
  cancel(
    id: string,
    input: { reason: string; notify?: boolean; deposit?: 'keep' | 'refund_card' | 'refund_credit' },
    o?: Opts,
  ): Promise<CommandRes>
  noShow(id: string, o?: Opts): Promise<CommandRes>
  book(input: BookingReq, o?: Opts): Promise<BookingRes>
  // file
  setAddon(id: string, serviceId: string, on: boolean, o?: Opts): Promise<AddonRes>
  checklistItem(id: string, itemId: string, done: boolean, o?: Opts): Promise<ChecklistItemRes>
  checklistBulk(id: string, itemIds: string[], done: boolean, o?: Opts): Promise<ChecklistBulkRes>
  applyPerk(id: string, o?: Opts): Promise<PerkRes>
  // messages
  sendMessage(id: string, input: SendMessageReq, o?: Opts): Promise<SendMessageRes>
  markRead(customerId: string, o?: Opts): Promise<{ marked: number }>
  // photos
  presignPhoto(
    id: string,
    input: { category: PhotoCategory; contentType: string; bytes: number; note?: string | null },
    o?: Opts,
  ): Promise<PresignRes>
  completePhoto(id: string, photoId: string, o?: Opts): Promise<{ photo: { id: string } }>
  deletePhoto(id: string, photoId: string, o?: Opts): Promise<unknown>
  /** POSTs the file to the presigned slot (S3 or the simulator store); not an API call. */
  uploadToSlot(slot: PresignRes['upload'], file: Blob): Promise<void>
}

/** A refused upload (the object store answers outside the API's problem+json): its message is the toast text. */
export class UploadError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'UploadError'
  }
}

export function createLiveOperationsPort(
  c: ApiClient,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): OperationsPort {
  const a = (id: string) => `/appointments/${enc(id)}`
  const post = <T>(path: string, body: unknown, o?: Opts) => c.post<T>(path, body, o)
  return {
    snapshot: (q) => c.get('/ops/snapshot', { query: { window: q.window, q: q.q?.trim() || undefined } }),
    calendarSummary: (from, to) => c.get('/calendar/summary', { query: { from, to } }),
    calendarDay: (date) => c.get('/calendar/day', { query: { date } }),
    appointment: (id) => c.get(a(id)),
    thread: (id) => c.get(`${a(id)}/messages`),
    availability: (q) =>
      c.get('/availability', {
        query: {
          date: q.date,
          serviceId: q.serviceId,
          addonIds: q.addonIds?.length ? q.addonIds.join(',') : undefined,
          channel: q.channel ?? 'desk',
          customerId: q.customerId,
          excludeAppointmentId: q.excludeAppointmentId,
        },
      }),
    customers: (q) => c.get('/customers', { query: { q, limit: 8 } }),
    membership: (id) => c.get(`/customers/${enc(id)}/membership`),
    catalog: () => c.get('/services'),
    templates: () => c.get('/messages/templates'),
    advance: (id, expectedStatus, o) => post(`${a(id)}/advance`, { expectedStatus }, o),
    arrive: (id, o) => post(`${a(id)}/arrive`, { source: 'manual' }, o),
    assignBay: (id, bayId, o) => post(`${a(id)}/assign-bay`, { bayId }, o),
    prepBay: (id, o) => post(`${a(id)}/prep-bay`, undefined, o),
    reschedule: (id, input, o) => post(`${a(id)}/reschedule`, input, o),
    pickup: (id, state, o) => post(`${a(id)}/pickup`, { state }, o),
    notifyReady: (id, o) => post(`${a(id)}/notify-ready`, undefined, o),
    cancel: (id, input, o) => post(`${a(id)}/cancel`, input, o),
    noShow: (id, o) => post(`${a(id)}/no-show`, undefined, o),
    book: (input, o) => post('/appointments', input, o),
    setAddon: (id, serviceId, on, o) =>
      on
        ? c.put(`${a(id)}/addons/${enc(serviceId)}`, undefined, o)
        : c.delete(`${a(id)}/addons/${enc(serviceId)}`, o),
    checklistItem: (id, itemId, done, o) => c.put(`${a(id)}/checklist/items/${enc(itemId)}`, { done }, o),
    checklistBulk: (id, itemIds, done, o) => post(`${a(id)}/checklist/bulk`, { itemIds, done }, o),
    applyPerk: (id, o) => post(`${a(id)}/membership-perks/apply`, {}, o),
    sendMessage: (id, input, o) => post(`${a(id)}/messages`, input, o),
    markRead: (customerId, o) => post(`/customers/${enc(customerId)}/messages/read`, {}, o),
    presignPhoto: (id, input, o) => post(`${a(id)}/photos/presign`, input, o),
    completePhoto: (id, photoId, o) => post(`${a(id)}/photos/${enc(photoId)}/complete`, undefined, o),
    deletePhoto: (id, photoId, o) => c.delete(`${a(id)}/photos/${enc(photoId)}`, o),
    async uploadToSlot(slot, file) {
      const form = new FormData()
      // the signed fields first, the file last (S3 ignores everything after `file`)
      for (const [k, v] of Object.entries(slot.fields)) form.append(k, v)
      form.append('file', file)
      let res: Response
      try {
        res = await fetchImpl(slot.url, { method: 'POST', body: form })
      } catch {
        throw new UploadError(
          0,
          'NETWORK',
          'The photo could not be uploaded. Check your connection and try again.',
        )
      }
      if (res.ok) return
      let code = 'UPLOAD_FAILED'
      let message = 'The photo could not be uploaded.'
      try {
        const j = (await res.json()) as { error?: { code?: string; message?: string } }
        if (j.error?.message) message = j.error.message
        if (j.error?.code) code = j.error.code
      } catch {
        // S3 answers XML; the generic message stands
      }
      throw new UploadError(res.status, code, message)
    },
  }
}
