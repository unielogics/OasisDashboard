/* eslint-disable @typescript-eslint/no-explicit-any */
// Shared by the Catalog / Categories / Reminders tests: the shapes GET /catalog and GET /settings/reminders answer
// (backend api-spec 15.6a and 15.8, the website-catalog seed's content), a fake of their endpoints that keeps state and
// records every call, and the Settings view model wired to it. Not shipped.
import { ApiError } from '@/data/http/problem'
import { createSettingsLogic } from '../Logic'
import { SettingsExtras } from './extras'
import { clone, setup } from './testkit'

const svc = (over: Record<string, unknown>) => ({
  active: true,
  category: 'wash',
  publicName: null,
  description: null,
  memberPriceCents: null,
  guestPriceCents: null,
  vipInclusion: 'none',
  vipNote: null,
  quoteOnly: false,
  visibleOnline: true,
  sort: 10,
  priceCents: 0,
  durationMin: 30,
  tags: [],
  effective: { memberPriceCents: 0, guestPriceCents: 0, tintFilm: null },
  version: 1,
  ...over,
})

export function catalogFixture(): any {
  return {
    categories: [
      { key: 'wash', label: 'Wash', colour: '#1FB6FF', sort: 10, active: true, builtin: true, version: 1 },
      { key: 'addons', label: 'Add-ons', colour: '#7FD6FF', sort: 20, active: true, builtin: true, version: 1 },
      { key: 'tint', label: 'Tint', colour: '#2EE59D', sort: 30, active: true, builtin: true, version: 1 },
      { key: 'detail', label: 'Detail', colour: '#FFB547', sort: 40, active: true, builtin: true, version: 1 },
      { key: 'quote', label: 'Quote', colour: '#8C97A1', sort: 50, active: true, builtin: true, version: 1 },
      { key: 'polish', label: 'Polish', colour: '#7A3B8A', sort: 60, active: false, builtin: false, version: 2 },
    ],
    packages: [
      svc({
        id: 'p-sig',
        kind: 'package',
        name: 'Signature Hand Wash',
        publicName: 'Signature Hand Wash',
        description: 'Hand wash and interior wipe-down.',
        memberPriceCents: 4500,
        priceCents: 5400,
        durationMin: 45,
        effective: { memberPriceCents: 4500, guestPriceCents: 5400, tintFilm: null },
        version: 3,
      }),
      svc({
        id: 'p-ext',
        kind: 'package',
        name: 'Exterior Hand Wash',
        memberPriceCents: 3200,
        priceCents: 3800,
        sort: 20,
        effective: { memberPriceCents: 3200, guestPriceCents: 3800, tintFilm: null },
      }),
      svc({
        id: 'p-carbon',
        kind: 'package',
        name: 'Carbon window tint',
        category: 'tint',
        tags: ['tint', 'carbon'],
        priceCents: 27500,
        durationMin: 180,
        sort: 30,
        effective: { memberPriceCents: 22900, guestPriceCents: 27500, tintFilm: 'carbon' },
      }),
      svc({
        id: 'p-rim',
        kind: 'package',
        name: 'Rim powder coating',
        category: 'quote',
        quoteOnly: true,
        visibleOnline: true,
        sort: 40,
        durationMin: 480,
      }),
    ],
    addons: [
      svc({
        id: 'a-wax',
        kind: 'addon',
        name: 'Hand wax',
        category: 'addons',
        memberPriceCents: 2500,
        priceCents: 3000,
        vipInclusion: 'included',
        effective: { memberPriceCents: 2500, guestPriceCents: 3000, tintFilm: null },
      }),
    ],
    tintMatrix: {
      vehicleTypes: [
        { key: 'sedan_coupe', label: 'Sedan / coupe' },
        { key: 'suv_crossover', label: 'SUV / crossover' },
      ],
      films: [{ key: 'carbon', label: 'Carbon', vlt: [5, 20, 35] }],
      prices: [
        {
          vehicle: 'sedan_coupe',
          film: 'carbon',
          memberMinCents: 22900,
          memberMaxCents: 29900,
          guestMinCents: 27500,
          guestMaxCents: 35900,
        },
      ],
      version: 4,
    },
    guestMarkup: { pct: 20, version: 2 },
    guestBookingFeeCents: 2500,
    plans: [
      {
        key: 'premium',
        name: 'Premium',
        active: true,
        publicLabel: 'Gold',
        monthlyPriceCents: 9900,
        perks: ['4 hand washes a month', 'Member prices on everything'],
        checkoutUrl: null,
        websiteTier: 'gold',
        version: 1,
      },
      {
        key: 'executive',
        name: 'Executive',
        active: true,
        publicLabel: 'VIP',
        monthlyPriceCents: 16900,
        perks: ['Everything in Gold'],
        checkoutUrl: 'https://oasis.squarespace.com/checkout/vip',
        websiteTier: 'vip',
        version: 1,
      },
    ],
  }
}

export function remindersFixture(): any {
  return {
    reminders: { offsetsMin: [1440, 120], confirmRequest: true, categoryPrep: {}, reviewRequest: false },
    statusTexts: {
      checkedIn: true,
      checkedInDelayMin: 3,
      runningLate: true,
      lateGraceMin: 10,
      lateMax: 2,
      ready: true,
      pickedUp: true,
      bookAgainLink: false,
    },
    leads: { followUpEnabled: true, followUpDelayMin: 180, businessHoursOnly: true, withinHours: 24 },
    categories: [
      { key: 'wash', label: 'Wash', colour: '#1FB6FF', active: true },
      { key: 'addons', label: 'Add-ons', colour: '#7FD6FF', active: true },
      { key: 'tint', label: 'Tint', colour: '#2EE59D', active: true },
      { key: 'detail', label: 'Detail', colour: '#FFB547', active: true },
      { key: 'quote', label: 'Quote', colour: '#8C97A1', active: true },
    ],
    quietHours: { enabled: true, start: '21:00', end: '08:00' },
    version: 16,
  }
}

const omitVersion = (b: any): any => {
  const out = { ...b }
  delete out.version
  return out
}

const previewOf = (draft: any) => ({
  sample: { firstName: 'Maria', startsAt: '2026-06-14T14:00:00Z', date: 'Sun, Jun 14', time: '10:00 AM', categories: ['wash'] },
  texts: [
    ...(draft?.reminders?.offsetsMin ?? [1440, 120]).map((m: number) => ({
      id: 'reminder-' + m,
      group: 'reminders',
      label: 'Reminder',
      timing: m / 60 + ' h before',
      templateKey: 'confirm_request',
      klass: 'reminder',
      enabled: true,
      text: 'Hi Maria, see you Sun, Jun 14 at 10:00 AM. Reply C to confirm. Reply STOP to opt out.',
      segments: 1,
      encoding: 'GSM-7',
    })),
    {
      id: 'lead',
      group: 'leads',
      label: 'Lead follow-up',
      timing: '3 h after their last text',
      templateKey: 'lead_follow_up',
      klass: 'lead_follow_up',
      enabled: draft?.leads?.followUpEnabled ?? true,
      text: 'Hi Maria, still thinking about a wash? Book here: oasisautospanj.com/#/c/xxxxxxxx',
      segments: 2,
      encoding: 'UCS-2',
    },
  ],
})

/**
 * The catalog and reminders endpoints over in-memory state; every call is recorded in `calls` (shared with LiveData's).
 * Like the server, a write carrying another version than the stored one is refused with 412.
 */
export function extendApi(f: ReturnType<typeof setup>) {
  const cat = catalogFixture()
  const rem = remindersFixture()
  const { calls, fail } = f
  const step =
    <A extends unknown[], R>(name: string, fn: (...a: A) => R) =>
    async (...a: A): Promise<R> => {
      calls.push([name, ...a])
      const e = fail.get(name)
      if (e) throw e
      return fn(...a)
    }
  const api: any = f.api
  // the server's If-Match rule: a body made on an older copy is refused with 412
  const fresh = (have: number, sent: number): void => {
    if (have !== sent) throw stale()
  }
  api.catalog = step('catalog', () => clone(cat))
  api.saveCatalogService = step('saveCatalogService', (id: string, body: any) => {
    const s = [...cat.packages, ...cat.addons].find((x: any) => x.id === id)
    fresh(s.version, body.version)
    const fields = omitVersion(body)
    Object.assign(s, fields, { version: s.version + 1 })
    return { ...clone(s), changed: true, appointmentsUpdated: 0 }
  })
  api.createCategory = step('createCategory', (body: any) => {
    const c = { sort: 70, active: true, builtin: false, version: 1, ...body }
    cat.categories.push(c)
    return clone(c)
  })
  api.updateCategory = step('updateCategory', (key: string, body: any) => {
    const c = cat.categories.find((x: any) => x.key === key)
    fresh(c.version, body.version)
    const fields = omitVersion(body)
    Object.assign(c, fields, { version: c.version + 1 })
    return { ...clone(c), changed: true }
  })
  api.deleteCategory = step('deleteCategory', (key: string, version: number) => {
    fresh(cat.categories.find((x: any) => x.key === key).version, version)
    cat.categories = cat.categories.filter((x: any) => x.key !== key)
    return { key, removed: true }
  })
  api.saveTintMatrix = step('saveTintMatrix', (body: any) => {
    fresh(cat.tintMatrix.version, body.version)
    const m = omitVersion(body)
    cat.tintMatrix = { ...m, version: cat.tintMatrix.version + 1 }
    return clone(cat.tintMatrix)
  })
  api.saveGuestMarkup = step('saveGuestMarkup', (body: any) => {
    fresh(cat.guestMarkup.version, body.version)
    cat.guestMarkup = { pct: body.pct, version: cat.guestMarkup.version + 1 }
    return clone(cat.guestMarkup)
  })
  api.savePlan = step('savePlan', (key: string, body: any) => {
    const p = cat.plans.find((x: any) => x.key === key)
    fresh(p.version, body.version)
    const fields = omitVersion(body)
    Object.assign(p, fields, { version: p.version + 1 })
    return { ...clone(p), changed: true }
  })
  api.reminders = step('reminders', () => clone(rem))
  api.saveReminders = step('saveReminders', (body: any) => {
    fresh(rem.version, body.version)
    const groups = omitVersion(body)
    for (const g of ['reminders', 'statusTexts', 'leads']) if (groups[g]) Object.assign(rem[g], groups[g])
    rem.version += 1
    return { ...clone(rem), changed: ['reminders.offsets_min'] }
  })
  api.previewReminders = step('previewReminders', (body: any) => previewOf(body?.draft))
  return { cat, rem }
}

export const validation = (detail: string, path = 'body.x'): ApiError =>
  new ApiError({ status: 422, title: 'Invalid', detail, code: 'VALIDATION', errors: [{ path, message: detail }] } as any)

export const stale = (): ApiError =>
  new ApiError({ status: 412, title: 'Changed', detail: 'Version conflict', code: 'VERSION_CONFLICT' } as any)

/** The Settings view model with LiveData and the extras over the fakes; `toasts` collects both success and error toasts. */
export function makeExtrasLogic(role: 'mgmt' | 'crew' | 'super' | 'support' = 'mgmt') {
  const ref: { logic?: any } = {}
  const flashes: string[] = []
  const s = setup({ role, toast: (t) => ref.logic?.flash(t.desc ? t.title + ' · ' + t.desc : t.title) })
  const state = extendApi(s)
  const extras = new SettingsExtras({
    api: s.api,
    qc: s.qc,
    session: () => (s.data as any).sessionOf(),
    toast: (t) => {
      s.toasts.push(t)
      ref.logic?.flash(t.desc ? t.title + ' · ' + t.desc : t.title)
    },
    schedule: (fn) => fn(),
    previewDebounceMs: 5,
  })
  const logic: any = (ref.logic = new (createSettingsLogic(s.data, extras))({}))
  const flash = logic.flash.bind(logic)
  logic.flash = (t: string) => {
    flashes.push(t)
    flash(t)
  }
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
  logic.componentDidMount()
  return { ...s, ...state, extras, logic, flashes }
}
