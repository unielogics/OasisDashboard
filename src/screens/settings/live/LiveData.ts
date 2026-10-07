// LiveData: the SettingsData backed by the real API, through the data layer. Reads go through the QueryStore (one
// GET /settings/bundle on load seeds the per-section queries; SSE `settings.changed` and `rbac.changed` invalidate them
// and the section refetches on its own), writes go through command() (Idempotency-Key, 403 "Your role can't ...",
// 409/412 refetch). Nothing here formats text the design owns; the view model keeps doing that. See
// docs/screens-settings.md for the table of what each member calls.
import { QueryObserver } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { can as sessionCan } from '@/auth/session-model'
import type { Session } from '@/auth/session-model'
import { shortName } from '@/auth/chrome'
import type { PermissionKey } from '@/auth/permissions'
import { command } from '@/data/command'
import type { CommandResult, CommandSpec } from '@/data/command'
import { ApiError } from '@/data/http/problem'
import { qk } from '@/data/query'
import { QueryStore } from '@/data/query-store'
import type { SettingsApi } from '@/data/ports/settings-api'
import { toastForError, toasts } from '@/data/toast'
import type { ToastSpec } from '@/data/toast'
import { serverNow } from '@/lib/clock'
import { newIdempotencyKey } from '@/lib/id'
import {
  DEFAULT_EMERGENCY_MESSAGE,
  PREVIEW_SAMPLE,
  SECTION_READ_PERMISSION,
  followTaskOp,
  renderPreview,
} from '@/lib/settings'
import type {
  Arrival,
  Closure,
  Draft,
  Emergency,
  EmergencyHistoryItem,
  Employee,
  HoursDay,
  LimitKind,
  LimitValue,
  NewClosure,
  RolesConfig,
  RuleKey,
  SectionKey,
  SettingsState,
  SvcKind,
  TaskOp,
  Theme,
  Vip,
  VipKey,
} from '@/lib/settings'
import { addDays, businessToday, DEFAULT_TZ } from '@/lib/tz'
import type {
  ClosedResult,
  EmergencyAccess,
  EmergencyCounters,
  EmergencyPreview,
  EmployeeSaved,
  LoadStatus,
  NewRole,
  Outcome,
  ServerSync,
  SettingsAccess,
  SettingsData,
  SettingsSeed,
  SyncPart,
  SyncPartName,
  VipClientResult,
} from '../data'
import {
  affectedText,
  candidateDetail,
  closeBody,
  closureBody,
  closureMessage,
  employeeBody,
  errorTab,
  hoursBody,
  mapAffected,
  mapArrival,
  mapClosure,
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
import type { ArrivalPart, ClosuresPart, EmergencyPart, HoursPart, ServicesPart, VipPart } from './mapping'
import type { EmployeesRes, RolesRes } from '@/data/ports/settings-api'

/** The bundle query lives outside the realtime families: SSE never refetches it; the sections it seeds are the live ones. */
const BOOT_KEY = ['settings-boot'] as const
const FOREVER = { staleTimeMs: Infinity }
const PREVIEW_TTL_MS = 30_000

export interface LiveDataDeps {
  api: SettingsApi
  qc: QueryClient
  /** The signed-in person (liveChrome.getSession). */
  session: () => Session | null
  /** Where API-layer toasts go (the shared bus, which the screen flashes). */
  toast?: (t: ToastSpec) => void
  /** Frame scheduler of the QueryStore (tests pass a synchronous one). */
  schedule?: (fn: () => void) => void
  debounceMs?: { preview?: number; checklist?: number; closure?: number }
}

interface Preview {
  at: number
  value: EmergencyPreview | null
}

const noop = (): void => {}

export class LiveData implements SettingsData {
  readonly live = true
  private readonly store: QueryStore
  private readonly api: SettingsApi
  private readonly qc: QueryClient
  private readonly sessionOf: () => Session | null
  private readonly emit: (t: ToastSpec) => void
  private readonly debounce: { preview: number; checklist: number; closure: number }
  private readonly listeners = new Set<() => void>()
  private unsubscribeStore: (() => void) | null = null
  private observers = new Map<string, () => void>()
  private getState: () => SettingsState = () => {
    throw new Error('LiveData is not attached to a view model')
  }

  // revisions, so the view model can tell when a part changed (or must be taken again after a failure)
  private ids = new WeakMap<object, number>()
  private nextId = 1
  private epoch: Partial<Record<SyncPartName, number>> = {}
  private mapped = new WeakMap<object, unknown>()

  // hours and rules share one version token and are saved one at a time
  private hoursVersion: number | null = null
  private hoursQueue: Promise<unknown> = Promise.resolve()

  // asynchronous helpers of the forms
  private closurePreview = new Map<string, { text: string; at: number }>()
  private closurePending = new Set<string>()
  private closureLast = ''
  private closureTimer: ReturnType<typeof setTimeout> | undefined
  private previews = new Map<string, Preview>()
  private previewPending = new Set<string>()
  private previewLast: EmergencyPreview | null = null
  private previewTimer: ReturnType<typeof setTimeout> | undefined
  private previewWanted: string | null = null
  private closureWanted: string | null = null
  private checklists = new Map<
    string,
    {
      tasks: { id?: string; label: string }[]
      timer: ReturnType<typeof setTimeout>
      waiters: ((ok: boolean) => void)[]
    }
  >()
  private checklistInFlight = new Set<string>()
  /** Task ids per service, running alongside the labels the screen edits (see saveChecklist). */
  private taskIds = new Map<string, (string | null)[]>()
  private lastServices: object | undefined
  private lastEmergency: object | undefined

  constructor(deps: LiveDataDeps) {
    this.api = deps.api
    this.qc = deps.qc
    this.sessionOf = deps.session
    this.emit = deps.toast ?? ((t) => toasts.emit(t))
    this.store = new QueryStore(deps.qc, deps.schedule ? { schedule: deps.schedule } : {})
    this.debounce = {
      preview: deps.debounceMs?.preview ?? 250,
      checklist: deps.debounceMs?.checklist ?? 600,
      closure: deps.debounceMs?.closure ?? 250,
    }
  }

  attach(getState: () => SettingsState): void {
    this.getState = getState
  }

  // identity and clock -------------------------------------------------------------------------------------------------

  private tz(): string {
    return this.sessionOf()?.businessTz || DEFAULT_TZ
  }
  today(): string {
    return businessToday(serverNow(), this.tz())
  }
  newId(prefix: string): string {
    return prefix + newIdempotencyKey()
  }
  stampDate(): string {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: this.tz(),
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(serverNow())
  }
  access(): SettingsAccess {
    const s = this.sessionOf()
    return {
      userShort: shortName(s?.user.name ?? ''),
      can: (key: PermissionKey) => sessionCan(s, key),
      isSuper: !!s?.roles.some((r) => r.key === 'super'),
    }
  }
  locked(section: SectionKey): boolean {
    const key = SECTION_READ_PERMISSION[section]
    return !!key && !this.access().can(key as PermissionKey)
  }

  // reads ------------------------------------------------------------------------------------------------------------------

  seed(): SettingsSeed {
    let theme: Theme = 'light'
    try {
      theme = localStorage.getItem('oasis-theme') === 'dark' ? 'dark' : 'light'
    } catch {
      /* storage blocked: the server preference arrives with the session */
    }
    const closed = { open: false, from: '8:00 AM', to: '6:00 PM' }
    return {
      theme,
      hours: [0, 1, 2, 3, 4, 5, 6].map(() => ({ ...closed })),
      savedHours: JSON.stringify([0, 1, 2, 3, 4, 5, 6].map(() => ({ ...closed }))),
      rules: { slot: 30, buffer: 10, cutoff: 60 },
      closures: [],
      federal: true,
      em: {
        active: false,
        summary: '',
        reason: 'Severe weather',
        dur: 'today',
        until: '2:00 PM',
        through: addDays(this.today(), 2),
        notify: true,
        link: true,
        credits: true,
        pause: true,
        crew: true,
        msg: DEFAULT_EMERGENCY_MESSAGE,
      },
      emHistory: [],
      employees: [],
      vip: {
        holds: [],
        release: 48,
        windowVip: 30,
        windowStd: 14,
        sameDay: 2,
        waitlist: true,
        offerMin: 15,
        standing: true,
        autoConfirm: true,
        cadences: [],
        clients: [],
      },
      arrival: {
        on: true,
        radius: 300,
        prepAt: 15,
        autoArrive: true,
        welcome: true,
        crew: true,
        vipFirst: true,
      },
      rc: { roles: [], perms: {}, limits: {} },
      packages: {},
      addons: {},
    }
  }

  private rev(name: SyncPartName, data: object): number {
    let id = this.ids.get(data)
    if (id === undefined) this.ids.set(data, (id = this.nextId++))
    return id * 1000 + (this.epoch[name] ?? 0)
  }

  private memo<T extends object, R>(data: T, name: string, fn: (d: T) => R): R {
    const key = this.mapped
    const bag = (key.get(data) as Record<string, R> | undefined) ?? {}
    if (!(name in bag)) {
      bag[name] = fn(data)
      key.set(data, bag)
    }
    return bag[name]!
  }

  private part<T extends object>(name: SyncPartName, data: T | undefined): SyncPart<T> | undefined {
    return data ? { rev: this.rev(name, data), data } : undefined
  }

  /** One section's data. The bundled ones wait for the first load (it fills them); the team loads on its own. */
  private section<T>(name: string, fetcher: () => Promise<T>, bundled = true): T | undefined {
    if (bundled && this.qc.getQueryData(BOOT_KEY) === undefined) return undefined
    this.watch(name, fetcher)
    return this.store.read<T>(qk.settings(name), fetcher, FOREVER)
  }

  /**
   * While the screen is open each section has an observer, which makes its query "active": an invalidation (the stream
   * saying something changed) then refetches at once and cancels a fetch that is already on its way. Without an observer
   * the fetch that finishes first would clear an invalidation that arrived meanwhile and the section would keep stale data.
   */
  private watch<T>(name: string, fetcher: () => Promise<T>): void {
    if (!this.listeners.size || this.observers.has(name)) return
    const observer = new QueryObserver<T>(this.qc, {
      queryKey: qk.settings(name),
      queryFn: fetcher,
      staleTime: Infinity,
    })
    this.observers.set(
      name,
      observer.subscribe(() => {}),
    )
  }

  private hoursPart(): HoursPart | undefined {
    return this.section('hours', async () => {
      const h = await this.api.hours()
      return { days: h.days, rules: h.rules, federalAuto: h.federalAuto, version: h.version }
    })
  }
  private closuresPart(): ClosuresPart | undefined {
    return this.section('closures', () => this.api.closures())
  }
  private emergencyPart(): EmergencyPart | undefined {
    return this.section('emergency', () => this.api.emergency())
  }
  private vipPart(): VipPart | undefined {
    return this.section('vip', async () => {
      const [view, clients] = await Promise.all([
        this.api.vip(),
        this.access().can('cli.member') ? this.api.vipClients().then((r) => r.items) : Promise.resolve(null),
      ])
      return { view, clients }
    })
  }
  private arrivalPart(): ArrivalPart | undefined {
    return this.section('arrival', () => this.api.arrival())
  }
  private servicesPart(): ServicesPart | undefined {
    return this.section('services', () => this.api.services())
  }
  private rolesPart(): RolesRes | undefined {
    return this.access().can('team.view') ? this.section('roles', () => this.api.roles(), false) : undefined
  }
  private employeesPart(): EmployeesRes | undefined {
    return this.access().can('team.view')
      ? this.section('employees', () => this.api.employees(), false)
      : undefined
  }

  /** The first load: one call for the whole screen, then each section lives on its own query. */
  private booted(): boolean {
    const b = this.store.read(
      BOOT_KEY,
      async () => {
        const bundle = await this.api.bundle()
        const p = partsFromBundle(bundle)
        for (const [name, data] of Object.entries(p)) this.qc.setQueryData(qk.settings(name), data)
        return bundle
      },
      FOREVER,
    )
    return !!b
  }

  sync(): ServerSync | null {
    if (!this.booted()) return {}
    const hours = this.hoursPart()
    if (hours) this.hoursVersion = Math.max(this.hoursVersion ?? 0, hours.version)
    const closures = this.closuresPart()
    const emergency = this.emergencyPart()
    if (emergency !== this.lastEmergency) {
      // closing or reopening the shop adds and removes emergency rows in the closure list
      const first = this.lastEmergency === undefined
      this.lastEmergency = emergency
      if (!first) void this.qc.invalidateQueries({ queryKey: qk.settings('closures') })
    }
    const vip = this.vipPart()
    const arrival = this.arrivalPart()
    const services = this.servicesPart()
    if (services !== this.lastServices) {
      // somebody else (or our own save) changed the catalog: ids are re-read unless a save is on its way
      this.lastServices = services
      for (const id of [...this.taskIds.keys()])
        if (!this.checklists.has(id) && !this.checklistInFlight.has(id)) this.taskIds.delete(id)
    }
    const roles = this.rolesPart()
    const employees = this.employeesPart()
    return {
      hours: this.part('hours', hours && this.memo(hours, 'hours', mapHours)),
      closures: this.part('closures', closures && this.memo(closures, 'closures', mapClosures)),
      emergency: this.part('emergency', emergency && this.memo(emergency, 'emergency', mapEmergency)),
      vip: this.part('vip', vip && this.memo(vip, 'vip', mapVip)),
      arrival: this.part('arrival', arrival && this.memo(arrival, 'arrival', mapArrival)),
      services: this.part('services', services && this.memo(services, 'services', mapServices)),
      roles: this.part('roles', roles && this.memo(roles, 'roles', mapRoles)),
      employees: this.part(
        'employees',
        employees && this.memo(employees, 'employees', (e: EmployeesRes) => e.items.map(mapEmployeeSummary)),
      ),
    }
  }

  status(): LoadStatus {
    const keys = [
      BOOT_KEY as readonly unknown[],
      ...['hours', 'closures', 'emergency', 'vip', 'arrival', 'services', 'roles', 'employees'].map(
        (n) => qk.settings(n) as readonly unknown[],
      ),
    ]
    let loading = false
    for (const k of keys) {
      const st = this.store.status(k as never)
      if (st === 'error' && this.qc.getQueryData(k as never) === undefined) return 'failed'
      if (st === 'pending') loading = true
    }
    return loading && this.qc.getQueryData(BOOT_KEY as never) === undefined ? 'loading' : 'ready'
  }

  reload(parts?: SyncPartName[]): void {
    if (!parts) {
      void this.qc.invalidateQueries({ queryKey: ['settings'] })
      void this.store.refetch(BOOT_KEY as never, async () => {
        const bundle = await this.api.bundle()
        for (const [name, data] of Object.entries(partsFromBundle(bundle)))
          this.qc.setQueryData(qk.settings(name), data)
        return bundle
      })
      for (const n of Object.keys(this.epoch))
        this.epoch[n as SyncPartName] = (this.epoch[n as SyncPartName] ?? 0) + 1
      return
    }
    for (const p of parts) {
      this.epoch[p] = (this.epoch[p] ?? 0) + 1
      void this.qc.invalidateQueries({ queryKey: qk.settings(p) })
    }
    // a changed role list changes who holds what; a closure change can change the emergency strip counts
    if (parts.includes('roles')) void this.qc.invalidateQueries({ queryKey: qk.settings('employees') })
    this.notify()
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    if (!this.unsubscribeStore) this.unsubscribeStore = this.store.subscribe(() => this.notify())
    return () => {
      this.listeners.delete(fn)
      if (!this.listeners.size) {
        this.unsubscribeStore?.()
        this.unsubscribeStore = null
        for (const off of this.observers.values()) off()
        this.observers.clear()
      }
    }
  }

  private notify(): void {
    for (const l of [...this.listeners]) l()
  }

  // commands -----------------------------------------------------------------------------------------------------------------

  private cmd<T>(
    spec: Omit<CommandSpec<T>, 'queryClient' | 'toast'>,
    inline = false,
  ): Promise<CommandResult<T>> {
    return command<T>({ ...spec, queryClient: this.qc, toast: inline ? noop : this.emit })
  }

  /** Errors the form shows inline come back as a message; everything else (403, 5xx, network) is toasted. */
  private inlineError(
    e: ApiError,
    denyLabel: string,
    validation = (x: ApiError) => x.status === 422 || x.status === 409,
  ): string | null {
    if (validation(e)) return e.detail || e.title
    if (e.isUnauthenticated || e.kind === 'aborted') return null
    this.emit(toastForError(e, { denyLabel }))
    return null
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.hoursQueue.then(fn, fn)
    this.hoursQueue = run.catch(noop)
    return run
  }

  // theme --------------------------------------------------------------------------------------------------------------------

  saveTheme(_theme: Theme): void {
    // the live chrome saves the preference (PUT /me/preferences) when the screen reports the toggle
  }

  // working hours and rules ---------------------------------------------------------------------------------------------------

  async saveHours(hours: HoursDay[]): Promise<Outcome<{ note?: string }>> {
    return this.serial(async () => {
      const version = this.hoursVersion ?? (this.hoursPart()?.version as number)
      const r = await this.cmd({
        key: qk.settings('hours'),
        request: (idem) => this.api.saveHours(hoursBody(hours, version), { idempotencyKey: idem }),
        denyLabel: 'change hours and closures',
      })
      if (!r.ok) {
        this.hoursVersion = null
        return { ok: false }
      }
      this.hoursVersion = Math.max(this.hoursVersion ?? 0, r.data.version)
      void this.qc.invalidateQueries({ queryKey: qk.settings('emergency') })
      const note = warningsNote(r.data.warnings)
      return { ok: true, value: note ? { note } : {} }
    })
  }

  async saveRule(key: RuleKey, value: number): Promise<boolean> {
    return this.serial(async () => {
      const r = await this.cmd({
        key: qk.settings('hours'),
        request: (idem) =>
          this.api.saveRules(
            { [key]: value, ...(this.hoursVersion !== null ? { version: this.hoursVersion } : {}) },
            { idempotencyKey: idem },
          ),
        denyLabel: 'change hours and closures',
      })
      if (!r.ok) {
        this.hoursVersion = null
        return false
      }
      this.hoursVersion = Math.max(this.hoursVersion ?? 0, r.data.version)
      return true
    })
  }

  // closures ----------------------------------------------------------------------------------------------------------------------

  closureSub(c: Closure): string {
    return c.sub ?? ''
  }

  /** The count the add form shows; the last answer stays up while the next one is on its way. */
  closureAffected(nc: NewClosure): string {
    if (!nc.date || nc.date < this.today() || !this.access().can('set.hours')) {
      this.closureWanted = null
      return ''
    }
    const key = [
      nc.type,
      nc.date,
      nc.type === 'reduced' ? nc.from : '',
      nc.type === 'reduced' ? nc.to : '',
    ].join('|')
    const hit = this.closurePreview.get(key)
    if (hit && serverNow() - hit.at < PREVIEW_TTL_MS) {
      this.closureWanted = null
      this.closureLast = hit.text
      return hit.text
    }
    this.closureWanted = key
    clearTimeout(this.closureTimer)
    if (!this.closurePending.has(key))
      this.closureTimer = setTimeout(() => {
        if (this.closureWanted !== key) return
        this.closurePending.add(key)
        void this.fetchClosurePreview(key, nc)
      }, this.debounce.closure)
    return this.closureLast
  }

  private async fetchClosurePreview(key: string, nc: NewClosure): Promise<void> {
    try {
      const r = await this.api.previewClosure({
        date: nc.date,
        type: nc.type,
        ...(nc.type === 'reduced' ? { from: nc.from, to: nc.to } : {}),
      })
      this.closurePreview.set(key, { text: affectedText(r.affected), at: serverNow() })
    } catch (e) {
      if (e instanceof ApiError && e.status !== 422) this.emit(toastForError(e))
      this.closurePreview.set(key, { text: '', at: serverNow() })
    } finally {
      this.closurePending.delete(key)
      this.notify()
    }
  }

  async createClosure(nc: NewClosure): Promise<Outcome<Closure>> {
    const r = await this.cmd(
      {
        key: qk.settings('closures'),
        request: (idem) => this.api.createClosure(closureBody(nc), { idempotencyKey: idem }),
        invalidate: [qk.settings('emergency')],
      },
      true,
    )
    if (r.ok) return { ok: true, value: mapClosure(r.data.closure) }
    const e = r.error
    if (e.status === 422) return { ok: false, message: closureMessage(e) }
    this.inlineError(e, 'change hours and closures', () => false)
    return { ok: false }
  }

  async setClosureNotify(id: string, notify: boolean): Promise<boolean> {
    const r = await this.cmd({
      key: qk.settings('closures'),
      request: (idem) => this.api.patchClosure(id, { notify }, { idempotencyKey: idem }),
      denyLabel: 'change hours and closures',
    })
    return r.ok
  }

  async removeClosure(id: string): Promise<boolean> {
    const r = await this.cmd({
      key: qk.settings('closures'),
      request: (idem) => this.api.deleteClosure(id, { idempotencyKey: idem }),
      invalidate: [qk.settings('emergency')],
      denyLabel: 'change hours and closures',
    })
    return r.ok
  }

  async setFederal(enabled: boolean): Promise<boolean> {
    const r = await this.cmd({
      key: qk.settings('closures'),
      request: (idem) => this.api.setFederal(enabled, { idempotencyKey: idem }),
      invalidate: [qk.settings('hours')],
      denyLabel: 'change hours and closures',
    })
    return r.ok
  }

  // emergency ----------------------------------------------------------------------------------------------------------------------

  emergencyAccess(): EmergencyAccess {
    const e = this.emergencyPart()
    return { canClose: e?.canClose ?? false, requirement: e?.requirement ?? '' }
  }

  emergencyStrip(): string {
    return this.emergencyPart()?.strip.text ?? ''
  }

  emergencyCounters(em: Emergency): EmergencyCounters {
    const c = this.emergencyPart()?.current?.counters
    if (c) return { notified: String(c.notified), rebooked: String(c.rebooked), booking: c.booking }
    return { notified: '0', rebooked: '0', booking: em.pause ? 'Paused' : 'Open' }
  }

  emergencyPreview(em: Emergency, visible: boolean): EmergencyPreview {
    const sample = this.emergencyPart()?.options.sample ?? PREVIEW_SAMPLE
    const message = renderPreview(em, sample)
    const fallback: EmergencyPreview = { affected: [], count: 0, message, first: sample.first }
    const stale = (): EmergencyPreview => (this.previewLast ? { ...this.previewLast, message } : fallback)
    if (!visible || !this.access().can('set.emergency')) {
      this.previewWanted = null
      return stale()
    }
    const key = JSON.stringify(previewQuery(em))
    const hit = this.previews.get(key)
    if (hit && serverNow() - hit.at < PREVIEW_TTL_MS) {
      this.previewWanted = null
      if (hit.value) this.previewLast = hit.value
      return hit.value ?? stale()
    }
    // the last form state asked for wins; a request goes out a moment after the person stops changing it
    this.previewWanted = key
    clearTimeout(this.previewTimer)
    if (!this.previewPending.has(key))
      this.previewTimer = setTimeout(() => {
        if (this.previewWanted !== key) return
        this.previewPending.add(key)
        void this.fetchPreview(key, em)
      }, this.debounce.preview)
    return stale()
  }

  private async fetchPreview(key: string, em: Emergency): Promise<void> {
    try {
      const r = await this.api.previewEmergency(previewQuery(em))
      const value: EmergencyPreview = {
        affected: mapAffected(r, em.dur === 'days'),
        count: r.count,
        message: r.renderedMessage,
        first: r.affected[0]?.firstName ?? this.emergencyPart()?.options.sample.first ?? PREVIEW_SAMPLE.first,
      }
      this.previews.set(key, { at: serverNow(), value })
    } catch (e) {
      // one toast per distinct form state ("Already closed ... choose Multiple days"); the list stays as it was
      if (e instanceof ApiError && e.status !== 403) this.emit(toastForError(e))
      this.previews.set(key, { at: serverNow(), value: null })
    } finally {
      this.previewPending.delete(key)
      this.notify()
    }
  }

  async close(em: Emergency, idempotencyKey: string): Promise<Outcome<ClosedResult>> {
    const r = await this.cmd({
      key: qk.settings('emergency'),
      idempotencyKey,
      request: (idem) => this.api.closeShop(closeBody(em), { idempotencyKey: idem }),
      invalidate: [qk.settings('closures')],
      denyLabel: 'use emergency closing',
    })
    if (!r.ok) return { ok: false }
    return { ok: true, value: { summary: r.data.summary, notified: r.data.notifiedCount } }
  }

  async reopen(em: Emergency): Promise<Outcome<EmergencyHistoryItem>> {
    const r = await this.cmd({
      key: qk.settings('emergency'),
      request: (idem) => this.api.reopen({ idempotencyKey: idem }),
      invalidate: [qk.settings('closures')],
      denyLabel: 'use emergency closing',
    })
    if (!r.ok) return { ok: false }
    let item: EmergencyHistoryItem | undefined
    try {
      const fresh = await this.api.emergency()
      this.qc.setQueryData(qk.settings('emergency'), fresh)
      item = mapEmergency(fresh).history[0]
    } catch {
      /* the history line arrives with the next refetch */
    }
    return {
      ok: true,
      value: item ?? {
        date: this.stampDate(),
        reason: em.reason,
        detail: 'Reopened by ' + this.access().userShort,
      },
    }
  }

  // employees ----------------------------------------------------------------------------------------------------------------------

  async employee(id: string): Promise<Employee | null> {
    try {
      return mapEmployeeDetail(await this.api.employee(id))
    } catch (e) {
      this.emit(toastForError(e, { denyLabel: 'view the team' }))
      return null
    }
  }

  defaultRole(): string {
    const rc = this.rolesPart()
    const crew = rc?.roles.find((r) => r.key === 'crew')
    return crew?.id ?? 'crew'
  }

  async saveEmployee(draft: Draft, stored: Employee | null): Promise<EmployeeSaved> {
    const body = employeeBody(draft, true)
    const fail = (e: ApiError): EmployeeSaved => {
      const message = this.inlineError(e, 'edit employees')
      return message === null ? { ok: false, message: '' } : { ok: false, message, tab: errorTab(e) }
    }
    try {
      if (!draft.id) {
        const r = await this.cmd(
          {
            key: qk.settings('employees'),
            request: (idem) => this.api.createEmployee(body, { idempotencyKey: idem }),
            invalidate: [qk.settings('roles')],
          },
          true,
        )
        if (!r.ok) return fail(r.error)
        return { ok: true, employee: mapEmployeeDetail(r.data.employee) }
      }
      const version = draft.version ?? stored?.version ?? 0
      const upd = await this.cmd(
        {
          key: qk.settings('employees'),
          request: (idem) => this.api.updateEmployee(draft.id!, version, body, { idempotencyKey: idem }),
          invalidate: [qk.settings('roles')],
        },
        true,
      )
      if (!upd.ok) return fail(upd.error)
      const was = stored?.status ?? 'active'
      if (was !== 'inactive' && draft.status === 'inactive') {
        const r = await this.cmd(
          {
            key: qk.settings('employees'),
            request: (idem) => this.api.deactivateEmployee(draft.id!, { idempotencyKey: idem }),
            denyLabel: 'edit employees',
          },
          true,
        )
        if (!r.ok) return fail(r.error)
      } else if (was === 'inactive' && draft.status !== 'inactive') {
        const r = await this.cmd(
          {
            key: qk.settings('employees'),
            request: (idem) => this.api.reactivateEmployee(draft.id!, { idempotencyKey: idem }),
            denyLabel: 'edit employees',
          },
          true,
        )
        if (!r.ok) return fail(r.error)
      }
      return { ok: true, employee: mapEmployeeDetail(await this.api.employee(draft.id)) }
    } catch (e) {
      if (e instanceof ApiError) return fail(e)
      throw e
    }
  }

  // roles --------------------------------------------------------------------------------------------------------------------------

  async setPermission(roleId: string, key: string, granted: boolean): Promise<boolean> {
    const r = await this.cmd({
      key: qk.settings('roles'),
      request: (idem) => this.api.setPermission(roleId, key, granted, { idempotencyKey: idem }),
      invalidate: [qk.settings('employees')],
      denyLabel: 'change roles',
    })
    return r.ok
  }

  async setLimit(roleId: string, kind: LimitKind, value: LimitValue): Promise<boolean> {
    const r = await this.cmd({
      key: qk.settings('roles'),
      request: (idem) => this.api.setLimit(roleId, kind, value, { idempotencyKey: idem }),
      denyLabel: 'change roles',
    })
    return r.ok
  }

  async addRole(): Promise<Outcome<NewRole>> {
    const r = await this.cmd({
      key: qk.settings('roles'),
      request: (idem) => this.api.createRole({ idempotencyKey: idem }),
      denyLabel: 'change roles',
    })
    if (!r.ok) return { ok: false }
    const fresh = await this.api.roles()
    this.qc.setQueryData(qk.settings('roles'), fresh)
    const rc: RolesConfig = mapRoles(fresh)
    const role = rc.roles.find((x) => x.id === r.data.id)
    if (!role) return { ok: false }
    return { ok: true, value: { role, perms: rc.perms[role.id] ?? {}, limits: rc.limits[role.id] ?? {} } }
  }

  async removeRole(roleId: string): Promise<boolean> {
    const r = await this.cmd({
      key: qk.settings('roles'),
      request: (idem) => this.api.deleteRole(roleId, { idempotencyKey: idem }),
      invalidate: [qk.settings('employees')],
      denyLabel: 'change roles',
    })
    return r.ok
  }

  // VIP and arrival --------------------------------------------------------------------------------------------------------------

  async saveVip(key: VipKey, patch: Partial<Vip> & Partial<Arrival>): Promise<boolean> {
    const r = await this.cmd({
      key: qk.settings(key === 'arrival' ? 'arrival' : 'vip'),
      request: (idem) =>
        key === 'arrival'
          ? this.api.saveArrival(patch as Partial<Arrival>, { idempotencyKey: idem })
          : this.api.saveVip(vipBody(patch) as never, { idempotencyKey: idem }),
      denyLabel: 'manage memberships',
    })
    return r.ok
  }

  async addHold(hold: { d: number; t: string }): Promise<boolean> {
    const r = await this.cmd({
      key: qk.settings('vip'),
      request: (idem) => this.api.addHold({ weekday: hold.d, time: hold.t }, { idempotencyKey: idem }),
      denyLabel: 'manage memberships',
    })
    return r.ok
  }

  async removeHold(hold: { d: number; t: string }): Promise<boolean> {
    const found = this.vipPart()?.view.holds.find((h) => h.weekday === hold.d && h.time === hold.t)
    if (!found) return true
    const r = await this.cmd({
      key: qk.settings('vip'),
      request: (idem) => this.api.removeHold(found.id, { idempotencyKey: idem }),
      denyLabel: 'manage memberships',
    })
    return r.ok
  }

  private async vipClientRequest(body: { name?: string; customerId?: string }): Promise<VipClientResult> {
    const r = await this.cmd(
      {
        key: qk.settings('vip'),
        request: (idem) => this.api.addVipClient(body, { idempotencyKey: idem }),
        denyLabel: 'manage memberships',
      },
      true,
    )
    if (r.ok) {
      const d = r.data
      return d.added
        ? { status: 'added', name: d.fullName, toast: d.toast ?? d.fullName + ' is now VIP' }
        : { status: 'already', name: d.fullName, toast: d.fullName + ' is already VIP' }
    }
    const e = r.error
    if (e.code === 'VIP_CLIENT_AMBIGUOUS') {
      const list = Array.isArray(e.meta.candidates) ? (e.meta.candidates as Record<string, unknown>[]) : []
      return {
        status: 'candidates',
        candidates: list.map((c) => ({
          id: String(c.customerId),
          name: String(c.fullName),
          detail: candidateDetail(
            c as { vehicles?: unknown; phoneHint?: string | null; alreadyVip?: boolean },
          ),
        })),
      }
    }
    this.emit(toastForError(e, { denyLabel: 'manage memberships' }))
    return { status: 'failed' }
  }

  addVipClient(name: string): Promise<VipClientResult> {
    return this.vipClientRequest({ name })
  }
  addVipClientById(id: string): Promise<VipClientResult> {
    return this.vipClientRequest({ customerId: id })
  }

  async removeVipClient(name: string): Promise<boolean> {
    const found = this.vipPart()?.clients?.find((c) => c.fullName === name)
    if (!found) return true
    const r = await this.cmd({
      key: qk.settings('vip'),
      request: (idem) => this.api.removeVipClient(found.customerId, { idempotencyKey: idem }),
      denyLabel: 'manage memberships',
    })
    return r.ok
  }

  // services ---------------------------------------------------------------------------------------------------------------------

  private serviceId(kind: SvcKind, name: string): string | undefined {
    const s = this.servicesPart()
    return (kind === 'pkg' ? s?.packages : s?.addons)?.find((x) => x.name === name)?.id
  }

  /** The ids of the tasks the server has for a service, in order. */
  private serverTaskIds(id: string): (string | null)[] {
    const s = this.servicesPart()
    const svc = [...(s?.packages ?? []), ...(s?.addons ?? [])].find((x) => x.id === id)
    return svc ? svc.tasks.map((t) => t.id) : []
  }

  /**
   * The whole ordered list, a moment after the last keystroke; every caller learns whether the saved request worked.
   * The ids of the tasks travel with the edits (rename, reorder and remove act on the id list the way they act on the
   * labels), so renaming a task and moving it before the save goes out still keeps its identity on live jobs.
   */
  saveChecklist(kind: SvcKind, name: string, tasks: string[], op: TaskOp): Promise<boolean> {
    const id = this.serviceId(kind, name)
    if (!id) return Promise.resolve(false)
    const known = this.taskIds.get(id) ?? this.serverTaskIds(id)
    const before = tasks.length - (op.kind === 'add' ? 1 : op.kind === 'remove' ? -1 : 0)
    const ids = known.length === before ? followTaskOp(known, op, null) : tasks.map(() => null)
    this.taskIds.set(id, ids)
    const entry = {
      tasks: tasks.map((label, i) => (ids[i] ? { id: ids[i]!, label } : { label })),
      waiters: [] as ((ok: boolean) => void)[],
      timer: undefined as unknown as ReturnType<typeof setTimeout>,
    }
    return new Promise((resolve) => {
      const cur = this.checklists.get(id)
      if (cur) clearTimeout(cur.timer)
      entry.waiters = [...(cur?.waiters ?? []), resolve]
      entry.timer = setTimeout(() => void this.sendChecklist(id), this.debounce.checklist)
      this.checklists.set(id, entry)
    })
  }

  private async sendChecklist(id: string): Promise<void> {
    const entry = this.checklists.get(id)
    if (!entry) return
    clearTimeout(entry.timer)
    this.checklists.delete(id)
    this.checklistInFlight.add(id)
    const r = await this.cmd({
      key: qk.settings('services'),
      request: (idem) => this.api.saveChecklist(id, entry.tasks, { idempotencyKey: idem }),
      denyLabel: 'edit packages and checklists',
    })
    this.checklistInFlight.delete(id)
    if (r.ok && !this.checklists.has(id))
      this.taskIds.set(
        id,
        r.data.service.tasks.map((t) => t.id),
      )
    else if (!r.ok) this.taskIds.delete(id)
    for (const w of entry.waiters) w(r.ok)
  }

  flush(): void {
    for (const id of [...this.checklists.keys()]) void this.sendChecklist(id)
  }
}
