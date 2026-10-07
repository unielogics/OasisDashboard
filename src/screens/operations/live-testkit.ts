/* eslint-disable @typescript-eslint/no-explicit-any */
// Test helpers for the live Operations screen: a stub OperationsPort and PaymentsPort that serve responses captured from
// the real API (live/__fixtures__, taken from a stack seeded with `design,parity-ops` at the frozen clock) and record
// every call, and a live view model built over them for a given role. Not shipped.
import { QueryClient } from '@tanstack/react-query'
import { vi } from 'vitest'
import { LiveChrome } from '@/auth/chrome'
import { makeSession } from '@/auth/test-fixtures'
import type { Session } from '@/auth/session-model'
import { ApiError } from '@/data/http/problem'
import { QueryStore } from '@/data/query-store'
import type {
  AddonRes,
  AppointmentFile,
  Availability,
  BookingRes,
  CalendarDay,
  CalendarSummary,
  ChecklistBulkRes,
  ChecklistItemRes,
  CommandRes,
  CustomerHits,
  MembershipView,
  OperationsPort,
  OpsSnapshot,
  PerkRes,
  SendMessageRes,
  ServiceCatalog,
  Templates,
  Thread,
} from '@/data/ports/operations'
import type { PaymentsPort } from '@/data/ports/payments'
import { applyChecklist } from '@/lib/operations/live/optimistic'
import { attach } from './testkit'
import { LiveOperationsLogic } from './LiveLogic'
import type { LiveOpsDeps } from './LiveLogic'
import availability from './live/__fixtures__/availability.json'
import calendarDay from './live/__fixtures__/calendar-day.json'
import calendarMonth from './live/__fixtures__/calendar-month.json'
import calendarWeek from './live/__fixtures__/calendar-week.json'
import catalog from './live/__fixtures__/catalog.json'
import customers from './live/__fixtures__/customers.json'
import fileCleaning from './live/__fixtures__/file-cleaning.json'
import fileCompleted from './live/__fixtures__/file-completed-unpaid.json'
import fileLate from './live/__fixtures__/file-late.json'
import fileNonMember from './live/__fixtures__/file-nonmember.json'
import fileVip from './live/__fixtures__/file-vip-confirmed.json'
import membershipMember from './live/__fixtures__/membership-member.json'
import membershipNone from './live/__fixtures__/membership-none.json'
import snapshot from './live/__fixtures__/snapshot.json'
import threadEmpty from './live/__fixtures__/thread-empty.json'
import templates from './live/__fixtures__/templates.json'

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export const FILES = {
  cleaning: fileCleaning,
  completed: fileCompleted,
  late: fileLate,
  nonMember: fileNonMember,
  vip: fileVip,
} as const

export const fixtures = {
  snapshot: snapshot as unknown as OpsSnapshot,
  calendarDay: calendarDay as unknown as CalendarDay,
  calendarWeek: calendarWeek as unknown as CalendarSummary,
  calendarMonth: calendarMonth as unknown as CalendarSummary,
  availability: availability as unknown as Availability,
  catalog: catalog as unknown as ServiceCatalog,
  customers: customers as unknown as CustomerHits,
  templates: templates as unknown as Templates,
  thread: threadEmpty as unknown as Thread,
  membershipMember: membershipMember as unknown as MembershipView,
  membershipNone: membershipNone as unknown as MembershipView,
}

export type Call = [name: string, ...args: unknown[]]

export interface StubPort extends OperationsPort {
  calls: Call[]
  /** Makes the next call(s) of a method throw. */
  fail: Map<string, ApiError>
  snap: OpsSnapshot
  files: Map<string, AppointmentFile>
  /** The thread every appointment answers unless `threads` has its own. */
  defaultThread: Thread
  threads: Map<string, Thread>
  memberships: Map<string, MembershipView>
  slots: Availability
  /** The answer of book(). */
  booked: BookingRes
}

const toastOf = (title: string, detail: string) => ({ title, detail })

/** An OperationsPort over the captured responses. Every method records `[name, ...args]`. */
export function stubPort(): StubPort {
  const calls: Call[] = []
  const fail = new Map<string, ApiError>()
  const files = new Map<string, AppointmentFile>()
  for (const f of Object.values(FILES)) files.set((f as any).id, clone(f) as unknown as AppointmentFile)
  const memberships = new Map<string, MembershipView>()
  for (const f of files.values())
    memberships.set(f.customer.id, clone(f.membership ? fixtures.membershipMember : fixtures.membershipNone))
  const step =
    <A extends unknown[], R>(name: string, fn: (...a: A) => R) =>
    async (...a: A): Promise<R> => {
      calls.push([name, ...a])
      const e = fail.get(name)
      if (e) throw e
      return fn(...a)
    }
  /** A file for any appointment of the board: the captured late file with the card's own identity and status. */
  const derivedFile = (id: string): AppointmentFile | undefined => {
    const snap = port.snap
    const cards = [
      ...snap.timeline.groups.flatMap((g) => g.items),
      ...snap.completed.items,
      ...snap.bays.flatMap((b) => (b.occupant ? [b.occupant.card] : [])),
    ]
    const c = cards.find((x) => x.id === id)
    if (!c) return undefined
    const f = clone(FILES.late) as unknown as AppointmentFile
    f.id = c.id
    f.status = c.status
    f.next = c.next as AppointmentFile['next']
    f.customer = { ...f.customer, id: c.customer.id, name: c.customer.name, vip: c.vip }
    f.overview = { ...f.overview, pay: c.pay }
    return f
  }
  const core = (status: string): CommandRes['appointment'] =>
    ({ id: 'x', status, version: 2 }) as unknown as CommandRes['appointment']
  const cmd = (name: string, title: string, detail: string) =>
    step(
      name,
      (..._a: unknown[]): CommandRes =>
        ({ appointment: core('x'), toast: toastOf(title, detail), warnings: [] }) as CommandRes,
    )
  const port: StubPort = {
    calls,
    fail,
    snap: clone(fixtures.snapshot),
    files,
    defaultThread: clone(fixtures.thread),
    threads: new Map(),
    memberships,
    slots: clone(fixtures.availability),
    booked: {
      appointment: core('booked'),
      customer: { id: 'c-new', name: 'New Customer', created: true },
      invoice: {} as BookingRes['invoice'],
      messageQueued: true,
      overrides: [],
      toast: toastOf('Appointment booked', 'Premium Hand Wash + Interior · 2:30 PM'),
    },
    snapshot: step('snapshot', (q: { window: string; q?: string }) => {
      const s = clone(port.snap)
      return { ...s, window: q.window as OpsSnapshot['window'], q: q.q ?? '' }
    }),
    calendarSummary: step('calendarSummary', (from: string, to: string) =>
      to > from && Date.parse(to) - Date.parse(from) > 8 * 86400000
        ? clone(fixtures.calendarMonth)
        : clone(fixtures.calendarWeek),
    ),
    calendarDay: step('calendarDay', (date: string) => ({ ...clone(fixtures.calendarDay), date })),
    appointment: step('appointment', (id: string) => {
      const f = files.get(id) ?? derivedFile(id)
      if (!f) throw new ApiError({ status: 404, title: 'Not found', detail: 'That record does not exist' })
      return clone(f)
    }),
    thread: step('thread', (id: string) => clone(port.threads.get(id) ?? port.defaultThread)),
    availability: step('availability', () => clone(port.slots)),
    customers: step('customers', () => clone(fixtures.customers)),
    membership: step('membership', (id: string) => clone(memberships.get(id) ?? fixtures.membershipNone)),
    catalog: step('catalog', () => clone(fixtures.catalog)),
    templates: step('templates', () => clone(fixtures.templates)),
    advance: cmd('advance', 'Marked arrived', 'Internal team notified'),
    arrive: cmd('arrive', 'Marked arrived', 'Internal team notified'),
    assignBay: cmd('assignBay', 'Moved to Bay 2', 'Maria · cleaning started'),
    prepBay: cmd('prepBay', 'Bay 1 prepped', 'Ready for Liam'),
    reschedule: cmd('reschedule', 'Moved to 11:15 AM', 'Marcus notified via SMS'),
    pickup: cmd('pickup', 'Vehicle picked up', 'Released to Maria'),
    notifyReady: cmd('notifyReady', 'Customer notified', 'Ready-for-pickup sent via SMS'),
    cancel: cmd('cancel', 'Appointment canceled', ''),
    noShow: cmd('noShow', 'Marked no-show', ''),
    book: step('book', () => clone(port.booked)),
    setAddon: step(
      'setAddon',
      (_id: string, _sid: string, on: boolean): AddonRes =>
        ({
          added: on,
          changed: true,
          toast: toastOf('Invoice + checklist updated', (on ? 'Added ' : 'Removed ') + 'Wax'),
        }) as unknown as AddonRes,
    ),
    checklistItem: step('checklistItem', (id: string, itemId: string, done: boolean) => {
      const f = files.get(id)
      if (f) files.set(id, applyChecklist(f, [itemId], done))
      return { changed: 1 } as unknown as ChecklistItemRes
    }),
    checklistBulk: step('checklistBulk', (id: string, itemIds: string[], done: boolean) => {
      const f = files.get(id)
      if (f) files.set(id, applyChecklist(f, itemIds, done))
      return { changed: itemIds.length } as unknown as ChecklistBulkRes
    }),
    applyPerk: step(
      'applyPerk',
      () => ({ credits: { left: 0, used: 2 }, discountCents: 12900 }) as unknown as PerkRes,
    ),
    sendMessage: step(
      'sendMessage',
      () =>
        ({
          held: false,
          holdUntil: null,
          queued: true,
          segments: 1,
          message: { id: 'm1', status: 'queued' },
        }) as unknown as SendMessageRes,
    ),
    markRead: step('markRead', () => ({ marked: 1 })),
    presignPhoto: step('presignPhoto', () => ({
      photoId: 'ph1',
      upload: { url: 'http://api.test/dev-storage/upload', fields: { key: 'k' }, key: 'k', expiresAt: 'x' },
    })),
    completePhoto: step('completePhoto', () => ({ photo: { id: 'ph1' } })),
    deletePhoto: step('deletePhoto', () => ({})),
    uploadToSlot: step('uploadToSlot', () => undefined),
  }
  return port
}

export interface StubPayments extends PaymentsPort {
  calls: Call[]
  fail: Map<string, ApiError>
}

export function stubPayments(): StubPayments {
  const calls: Call[] = []
  const fail = new Map<string, ApiError>()
  const step =
    <A extends unknown[], R>(name: string, fn: (...a: A) => R) =>
    async (...a: A): Promise<R> => {
      calls.push([name, ...a])
      const e = fail.get(name)
      if (e) throw e
      return fn(...a)
    }
  const p = {
    calls,
    fail,
    collect: step('collect', () => ({ event: { id: 'ev1' }, invoice: {} })),
    sendReceipt: step('sendReceipt', () => ({ sms: 'queued', email: 'skipped', invoice: {} })),
    invoice: step('invoice', (id: string) => ({
      id,
      ledger: [
        { id: 'ev-pay', type: 'pay', voided: false, status: 'done' },
        { id: 'ev-old', type: 'pay', voided: true, status: 'done' },
      ],
    })),
    voidPayment: step('voidPayment', () => ({ event: { id: 'ev-void' }, invoice: {} })),
    confirmProcessor: step('confirmProcessor', () => ({ event: { id: 'ev1' }, invoice: {} })),
  }
  return p as unknown as StubPayments
}

export function makeChrome(session: Session): LiveChrome {
  const c = new LiveChrome()
  c.setSession(session)
  return c
}

export interface Live {
  logic: LiveOperationsLogic
  port: StubPort
  payments: StubPayments
  chrome: LiveChrome
  qc: QueryClient
  themes: string[]
  tenders: string[]
  /** The wall clock the view model reads (server clock); advance it to age bay timers. */
  clock: { now: number }
  settle(): Promise<void>
  vals(): Record<string, any>
}

export const FROZEN = Date.parse('2026-06-13T10:36:00-04:00')

export function makeLive(
  session: Session = makeSession({ role: 'mgmt' }),
  port: StubPort = stubPort(),
  payments: StubPayments = stubPayments(),
): Live {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  const store = new QueryStore(qc, { schedule: (fn) => queueMicrotask(fn) })
  const chrome = makeChrome(session)
  const themes: string[] = []
  const tenders: string[] = []
  const clock = { now: FROZEN }
  const deps: LiveOpsDeps = {
    port,
    payments,
    queryClient: qc,
    store,
    chrome: () => chrome,
    now: () => clock.now,
    loadTheme: () => 'light',
    saveTheme: (t) => void themes.push(t),
    loadTender: () => 'card',
    saveTender: (t) => void tenders.push(t),
  }
  const logic = new LiveOperationsLogic({}, deps)
  attach(logic)
  logic.componentDidMount()
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 8; i++) {
      // under fake timers the macrotask never comes by itself
      if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0)
      else await new Promise((r) => setTimeout(r, 0))
    }
  }
  return { logic, port, payments, chrome, qc, themes, tenders, clock, settle, vals: () => logic.renderVals() }
}

export { makeSession }
