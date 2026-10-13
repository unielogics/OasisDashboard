/* eslint-disable @typescript-eslint/no-explicit-any */
// Shared by the Catalog / Categories / Reminders / Vehicle sizes / Prices by size / Memberships tests: the shapes GET
// /catalog and GET /settings/reminders answer (backend api-spec 15.6a, 15.8, 15.9 and 15.10, the website-catalog and
// pricing-defaults seeds' content), a fake of their endpoints that keeps state and records every call (with the server's
// version rules), and the Settings view model wired to it. Not shipped.
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
    vehicleClasses: [
      { key: 'compact_car', label: 'Compact car', sort: 10, active: true, version: 1 },
      { key: 'large_car', label: 'Large car', sort: 20, active: true, version: 1 },
      { key: 'compact_suv', label: 'Compact SUV', sort: 30, active: true, version: 1 },
      { key: 'large_suv', label: 'Large SUV', sort: 40, active: true, version: 1 },
      { key: 'truck', label: 'Truck', sort: 50, active: false, version: 2 },
    ],
    prices: [
      {
        serviceId: 'p-sig',
        version: 3,
        cells: [
          { class: 'compact_car', cents: 4000, maxCents: null },
          { class: 'compact_suv', cents: 5000, maxCents: null },
          { class: 'truck', cents: 7000, maxCents: null },
        ],
        fromCents: 4000,
        missing: 2,
      },
      { serviceId: 'p-ext', version: 1, cells: [], fromCents: 3800, missing: 4 },
      {
        serviceId: 'p-carbon',
        version: 1,
        cells: [{ class: 'compact_car', cents: 27500, maxCents: 35900 }],
        fromCents: 27500,
        missing: 3,
      },
      { serviceId: 'p-rim', version: 1, cells: [], fromCents: 0, missing: 0 },
      { serviceId: 'a-wax', version: 1, cells: [{ class: 'compact_car', cents: 3000, maxCents: null }], fromCents: 3000, missing: 3 },
    ],
    missingPrices: 12,
    tiers: [
      {
        key: 'gold',
        name: 'Gold',
        colour: '#8A6D3B',
        bgColour: '#F1EDE7',
        sort: 30,
        active: true,
        public: true,
        vipBooking: false,
        memberDiscountBp: 0,
        maxVehicles: null,
        perks: ['4 hand washes a month', 'Member prices on everything'],
        checkoutUrl: null,
        legacyKey: 'premium',
        priceVersion: 2,
        version: 3,
        squarePlanId: null,
        inclusions: [
          {
            id: 'inc-gold-wash',
            label: 'Hand washes',
            mode: 'per_cycle',
            perCycle: 4,
            autoApply: true,
            active: true,
            serviceIds: ['p-sig', 'p-ext'],
          },
        ],
        prices: [
          {
            class: 'compact_car',
            monthlyCents: 12900,
            priceVersion: 2,
            effectiveFrom: '2026-10-12T14:00:00.000Z',
            squareState: 'pending',
          },
        ],
        fromMonthlyCents: 12900,
        sold: false,
      },
      {
        key: 'vip',
        name: 'VIP',
        colour: '#1F2937',
        bgColour: '#DDDEE0',
        sort: 40,
        active: true,
        public: true,
        vipBooking: true,
        memberDiscountBp: 1000,
        maxVehicles: 2,
        perks: ['Everything in Gold'],
        checkoutUrl: 'https://oasis.squarespace.com/checkout/vip',
        legacyKey: 'executive',
        priceVersion: 1,
        version: 2,
        squarePlanId: null,
        inclusions: [
          {
            id: 'inc-vip-wax',
            label: 'Hand wax',
            mode: 'every_visit',
            perCycle: null,
            autoApply: true,
            active: true,
            serviceIds: ['a-wax'],
          },
        ],
        prices: [],
        fromMonthlyCents: null,
        sold: true,
      },
    ],
    guestFee: { cents: 2500, collect: 'counter', version: 0 },
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

/** GET /settings/billing as the backend answers it with the defaults (Squarespace, the simulator, everything off). */
export function billingFixture(): any {
  return {
    square: {
      status: {
        key: 'square',
        label: 'Square',
        provider: 'sim',
        live: false,
        configured: false,
        missing: [],
        warnings: ['Squarespace is still the processor', 'Square simulator: nothing reaches Square'],
        lastSuccessAt: null,
        lastErrorAt: null,
        lastError: null,
        details: { environment: 'sim' },
      },
      eventTypes: ['payment.created'],
      lastTest: null,
      catchup: { watermark: null, lastRunAt: null, lastEvents: 0 },
      reconcile: null,
    },
    processing: {
      processor: 'squarespace',
      squareProvider: 'sim',
      squareEnvironment: 'sandbox',
      writesEnabled: false,
      membershipsEnabled: false,
      itemsSyncEnabled: false,
      posAppSwitch: false,
      posAutomatch: 'evidence',
      publicLinksEnabled: false,
      cardsOn: false,
    },
    guestFee: { cents: 2500, collect: 'counter', version: 3 },
    linkTipping: { enabled: false, version: 0 },
    cardFees: { fees: { enabled: false, noShowCents: 0, lateCancelCents: 0 }, version: 0, active: false },
    renewalPolicy: { graceDays: 7, cancelDays: 21, version: 0 },
    priceChangeNotice: { days: 30, version: 0 },
    salesTax: { percent: '7', rateDbp: 7000, label: '7%', rounding: 'half_up', version: 0 },
    squareItems: {
      mode: 'preview',
      tax: null,
      counts: { onSquare: 0, waiting: 0, failed: 0, archived: 0, notSold: 0 },
      lastSyncAt: null,
    },
    consent: {
      version: 'v1',
      checkedByDefault: false,
      purposes: ['membership_billing', 'no_show_fee', 'late_cancel_fee', 'balance'],
      text: 'Save this card with Square so Oasis Auto Spa can charge it for: membership payments, no-show fees, late-cancel fees, balances. Charges are made only after the shop confirms them, except your membership’s monthly payment. You can remove the card any time from your link or by asking us.',
    },
  }
}

/** GET /integrations/square/items as the backend answers it with the defaults (watch only, never checked). */
export function squareItemsFixture(): any {
  return {
    mode: 'preview',
    environment: 'sim',
    writesEnabled: false,
    itemsSyncEnabled: false,
    taxMode: 'auto',
    taxObjectId: null,
    taxCheck: null,
    taxCheckedAt: null,
    counts: { onSquare: 0, waiting: 5, failed: 0, archived: 0, notSold: 1 },
    lastSyncAt: null,
    lastSync: null,
    lastDriftAt: null,
    lastWriteAt: null,
    lastError: null,
    lastErrorAt: null,
    failures: [],
    preview: null,
    version: 0,
  }
}

/** A tax check as the backend writes it (ADR 0172 tax.ts): the shop's one tax at Oasis's rate, adopted. */
export function taxCheckFixture(over: Record<string, unknown> = {}): any {
  return {
    status: 'ok',
    mode: 'auto',
    taxId: 'TAX-NJ',
    taxName: 'NJ Sales Tax',
    percentage: '6.625',
    wantPercentage: '6.625',
    own: false,
    ownChanged: [],
    detail: 'Square tax “NJ Sales Tax” is 6.625%, the same as Oasis',
    warnings: [],
    candidates: [{ id: 'TAX-NJ', name: 'NJ Sales Tax', percentage: '6.625', matches: true, problem: null }],
    rounding: { checked: 9, differ: 0, detail: 'all 9 sample totals match Square to the cent' },
    ...over,
  }
}

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
  // vehicle sizes, prices by size, tiers, tier prices, the booking fee (api-spec 15.9, 15.10)
  api.createVehicleClass = step('createVehicleClass', (body: any) => {
    const c = { active: true, version: 1, ...body }
    cat.vehicleClasses.push(c)
    return clone(c)
  })
  api.updateVehicleClass = step('updateVehicleClass', (key: string, body: any) => {
    const c = cat.vehicleClasses.find((x: any) => x.key === key)
    if (body.version !== undefined) fresh(c.version, body.version)
    Object.assign(c, omitVersion(body), { version: c.version + 1 })
    return { ...clone(c), changed: true }
  })
  api.deleteVehicleClass = step('deleteVehicleClass', (key: string, version: number) => {
    fresh(cat.vehicleClasses.find((x: any) => x.key === key).version, version)
    const used = cat.prices.filter((r: any) => r.cells.some((c: any) => c.class === key)).length
    if (used) throw inUse('CLASS_IN_USE', { key, prices: used })
    cat.vehicleClasses = cat.vehicleClasses.filter((x: any) => x.key !== key)
    return { key, removed: true }
  })
  api.savePrices = step('savePrices', (body: any) => {
    // all or nothing: every row's version is checked before anything is written
    body.rows.forEach((r: any, i: number) => {
      const row = cat.prices.find((x: any) => x.serviceId === r.serviceId)
      if (row.version !== r.version) throw stale({ row: i, serviceId: r.serviceId, currentVersion: row.version })
    })
    const order = (k: string) => cat.vehicleClasses.findIndex((c: any) => c.key === k)
    const out = body.rows.map((r: any) => {
      const row = cat.prices.find((x: any) => x.serviceId === r.serviceId)
      for (const c of r.cells) {
        row.cells = row.cells.filter((x: any) => x.class !== c.class)
        if (c.cents !== null) row.cells.push({ class: c.class, cents: c.cents, maxCents: c.maxCents ?? null })
      }
      row.cells.sort((a: any, b: any) => order(a.class) - order(b.class))
      const on = row.cells.filter((x: any) => cat.vehicleClasses.find((v: any) => v.key === x.class)?.active)
      row.fromCents = on.length ? Math.min(...on.map((x: any) => x.cents)) : row.fromCents
      row.version += 1
      for (const s of [...cat.packages, ...cat.addons]) if (s.id === r.serviceId) s.version = row.version
      return { ...clone(row), changed: true }
    })
    return { rows: out, missingPrices: 11 }
  })
  api.createTier = step('createTier', (body: any) => {
    const t = {
      ...body,
      bgColour: '#EEEEEE',
      legacyKey: null,
      priceVersion: 1,
      version: 1,
      squarePlanId: null,
      inclusions: [],
      prices: [],
      fromMonthlyCents: null,
      sold: false,
    }
    cat.tiers.push(t)
    return clone(t)
  })
  api.saveTier = step('saveTier', (key: string, body: any) => {
    const t = cat.tiers.find((x: any) => x.key === key)
    fresh(t.version, body.version)
    const fields = omitVersion(body)
    fields.inclusions = fields.inclusions.map((i: any, n: number) => ({ id: i.id ?? `inc-new-${n}`, active: true, ...i }))
    Object.assign(t, fields, { version: t.version + 1 })
    return { ...clone(t), changed: true }
  })
  api.deleteTier = step('deleteTier', (key: string, version: number) => {
    const t = cat.tiers.find((x: any) => x.key === key)
    fresh(t.version, version)
    if (t.sold) throw inUse('TIER_IN_USE', { key })
    cat.tiers = cat.tiers.filter((x: any) => x.key !== key)
    return { key, removed: true }
  })
  api.saveTierPrices = step('saveTierPrices', (body: any) => {
    body.rows.forEach((r: any, i: number) => {
      const t = cat.tiers.find((x: any) => x.key === r.tierKey)
      if (t.priceVersion !== r.priceVersion) throw stale({ row: i, tierKey: r.tierKey, currentVersion: t.priceVersion })
    })
    for (const r of body.rows) {
      const t = cat.tiers.find((x: any) => x.key === r.tierKey)
      for (const c of r.cells) {
        t.priceVersion += 1
        t.prices = t.prices.filter((p: any) => p.class !== c.class)
        if (c.monthlyCents !== null)
          t.prices.push({
            class: c.class,
            monthlyCents: c.monthlyCents,
            priceVersion: t.priceVersion,
            effectiveFrom: '2026-10-12T15:00:00.000Z',
            squareState: 'pending',
          })
      }
      t.fromMonthlyCents = t.prices.length ? Math.min(...t.prices.map((p: any) => p.monthlyCents)) : null
    }
    return { tiers: clone(cat.tiers), changed: body.rows.map((r: any) => r.tierKey) }
  })
  api.saveGuestFee = step('saveGuestFee', (body: any) => {
    fresh(cat.guestFee.version, body.version)
    cat.guestFee = { cents: body.cents, collect: body.collect, version: cat.guestFee.version + 1 }
    cat.guestBookingFeeCents = body.cents
    return clone(cat.guestFee)
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
  // Settings → Billing & integrations (api-spec 30.13) and Move members (30.12)
  const bill = billingFixture()
  api.billing = step('billing', () => {
    bill.guestFee = { ...cat.guestFee }
    return clone(bill)
  })
  api.saveLinkTipping = step('saveLinkTipping', (body: any) => {
    fresh(bill.linkTipping.version, body.version)
    bill.linkTipping = { enabled: body.enabled, version: bill.linkTipping.version + 1 }
    return clone(bill.linkTipping)
  })
  api.saveCardFees = step('saveCardFees', (body: any) => {
    fresh(bill.cardFees.version, body.version)
    bill.cardFees = { fees: omitVersion(body), version: bill.cardFees.version + 1, active: false }
    return clone(bill.cardFees)
  })
  api.saveRenewalPolicy = step('saveRenewalPolicy', (body: any) => {
    fresh(bill.renewalPolicy.version, body.version)
    if (!(body.cancelDays > body.graceDays)) throw validation('cancelDays must be greater than graceDays', 'body.cancelDays')
    bill.renewalPolicy = { graceDays: body.graceDays, cancelDays: body.cancelDays, version: bill.renewalPolicy.version + 1 }
    return clone(bill.renewalPolicy)
  })
  api.savePriceNotice = step('savePriceNotice', (body: any) => {
    fresh(bill.priceChangeNotice.version, body.version)
    bill.priceChangeNotice = { days: body.days, version: bill.priceChangeNotice.version + 1 }
    return clone(bill.priceChangeNotice)
  })
  api.testSquare = step('testSquare', () => ({
    ok: true,
    environment: 'sim',
    locationId: 'LSIMOASIS0001',
    merchantId: 'MSIM',
    webhookSubscriptionId: null,
    checks: [
      { key: 'token', ok: true, detail: 'Square answered' },
      { key: 'location', ok: true, detail: 'Oasis Auto Spa, USD, takes cards' },
      { key: 'events', ok: true, detail: 'Events API on' },
      { key: 'webhook', ok: true, detail: 'Simulator' },
    ],
    testedAt: '2026-06-13T14:36:00.000Z',
  }))
  api.syncSquareCatalog = step('syncSquareCatalog', () => ({
    status: 'skipped',
    reason: 'Square writes are off',
    plansCreated: 0,
    plansRenamed: 0,
    variationsCreated: 0,
    retired: 0,
    kept: 0,
    drift: 0,
    recreated: 0,
    failed: 0,
  }))
  // the sales tax rate (ADR 0173, api-spec 30.15): the server's parser, 422 on `percent`
  api.saveSalesTax = step('saveSalesTax', (body: any) => {
    fresh(bill.salesTax.version, body.version)
    const m = /^\s*(\d{1,3})(?:\.(\d{0,3}))?\s*%?\s*$/.exec(String(body.percent))
    const dbp = m ? Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0') || '0') : null
    if (dbp === null || dbp > 100_000)
      throw validation('Use a percentage from 0 to 100 with up to three decimals, such as 6.625', 'body.percent')
    const whole = Math.floor(dbp / 1000)
    const frac = String(dbp % 1000).padStart(3, '0').replace(/0+$/, '')
    const percent = whole + (frac ? '.' + frac : '')
    bill.salesTax = { ...bill.salesTax, percent, rateDbp: dbp, label: percent + '%', version: bill.salesTax.version + 1 }
    return clone(bill.salesTax)
  })
  // the Square item library (ADR 0172, api-spec 30.14)
  const items = squareItemsFixture()
  api.squareItems = step('squareItems', () => clone(items))
  api.syncSquareItems = step('syncSquareItems', () => {
    const preview = {
      create: 5,
      createPrices: 14,
      update: 0,
      archive: 0,
      unchanged: 0,
      skipped: 1,
      categories: 3,
      tax: 'adopt',
      at: '2026-06-13T14:36:00.000Z',
    }
    items.taxCheck = taxCheckFixture()
    items.taxCheckedAt = preview.at
    items.preview = preview
    return {
      status: 'preview',
      mode: items.mode,
      tax: clone(items.taxCheck),
      preview,
      created: 0,
      updated: 0,
      archived: 0,
      recreated: 0,
      adopted: 0,
      restored: 0,
      failed: 0,
      categoriesCreated: 0,
      taxCreated: 0,
      taxUpdated: 0,
      failures: [],
      changedInSquare: [],
      reported: [],
    }
  })
  api.setSquareItemsTax = step('setSquareItemsTax', (body: any) => {
    fresh(items.version, body.version)
    if (body.mode === 'adopt' && !body.squareTaxId) throw validation('Pick the Square tax', 'body.squareTaxId')
    items.taxMode = body.mode
    items.taxObjectId = body.mode === 'adopt' ? body.squareTaxId : null
    items.version += 1
    return { mode: items.taxMode, squareTaxId: items.taxObjectId, version: items.version }
  })
  api.archiveSquareItems = step('archiveSquareItems', () => ({ archived: 3, alreadyArchived: 1, failed: 0, failures: [] }))
  api.moveMembers = step('moveMembers', (key: string) => ({
    tierKey: key,
    moving: 2,
    skipped: 1,
    swapAfter: '2026-07-13T14:36:00.000Z',
  }))
  return { cat, rem, bill, items }
}

export const validation = (detail: string, path = 'body.x'): ApiError =>
  new ApiError({ status: 422, title: 'Invalid', detail, code: 'VALIDATION', errors: [{ path, message: detail }] } as any)

export const stale = (meta?: Record<string, unknown>): ApiError =>
  new ApiError({ status: 412, title: 'Changed', detail: 'Version conflict', code: 'VERSION_CONFLICT', meta } as any)

/** A 409 "in use" with the counts the server sends (CLASS_IN_USE, TIER_IN_USE). */
export const inUse = (code: string, meta: Record<string, unknown>): ApiError =>
  new ApiError({ status: 409, title: 'In use', detail: 'Still in use. Turn it off instead', code, meta } as any)

/** The Settings view model with LiveData and the extras over the fakes; `toasts` collects both success and error toasts. */
export function makeExtrasLogic(role: 'mgmt' | 'crew' | 'super' | 'support' | 'acct' = 'mgmt') {
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
