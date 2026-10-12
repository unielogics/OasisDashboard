// Settings → Catalog, Categories and Reminders & texts (live variant only, ADR 0160 plan A, I, K; DEVIATIONS
// DV-317..DV-321), and Vehicle sizes, Prices by size and Memberships (ADR 0170; DV-322..DV-326, their own files
// live/pricing.ts and live/memberships.ts): sections the design does not have. They live beside the design's view model rather than in it: the
// SettingsLogic state stays the design's (the differential test compares it key by key with the original class), and
// these sections keep their own drafts here and give the template everything under `live.*`.
//
// Reads: GET /catalog (one call for both catalog sections) and GET /settings/reminders through the QueryStore, under
// ['settings', 'catalog'] and ['settings', 'reminders'], which the event stream invalidates (src/data/realtime). The
// reminders preview is POST /settings/reminders/preview, debounced, with the draft as it is typed.
// Writes: command() (Idempotency-Key, "Your role can’t …", refetch on 409/412); set.services for the catalog and the
// categories, set.hours for the reminders (the server's own rules: api-spec 15.6a, 15.8).
// Drafts (lib/settings/drafts.ts) remember the server copy and version they started from and are rebased when a newer
// copy arrives: what the person did not touch follows it, and a save sends the version of the copy the draft was merged
// with, so someone else's change is never undone silently (a save on an older copy gets the server's 412).
import { QueryObserver } from '@tanstack/react-query'
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { deniedTitle } from '@/auth/permissions'
import type { PermissionKey } from '@/auth/permissions'
import { can as sessionCan } from '@/auth/session-model'
import type { Session } from '@/auth/session-model'
import { command } from '@/data/command'
import { ApiError } from '@/data/http/problem'
import { qk } from '@/data/query'
import { QueryStore } from '@/data/query-store'
import type {
  CatalogRes,
  RemindersPreviewRes,
  RemindersRes,
  SettingsApi,
} from '@/data/ports/settings-api'
import { toastForError, toasts } from '@/data/toast'
import type { ToastSpec } from '@/data/toast'
import { categoryChipStyle, categoryLabel, swatchStyle } from '@/lib/categories'
import type { CategoryInfo } from '@/lib/categories'
import {
  CATEGORY_SWATCHES,
  categoryProblem,
  keyFromLabel,
  normalizeColour,
  serviceBody,
  serviceDraft,
} from '@/lib/settings/catalog'
import type { CatalogCategoryItem, CatalogItem, ServiceDraft } from '@/lib/settings/catalog'
import { DraftSet, STALE_ACTION_MESSAGE, STALE_DRAFT_MESSAGE } from '@/lib/settings/drafts'
import type { DraftEntry } from '@/lib/settings/drafts'
import { fromLine, sortSizes } from '@/lib/settings/sizes'
import type { PriceRowItem, VehicleClassItem } from '@/lib/settings/sizes'
import {
  MAX_OFFSETS,
  OFFSET_CHOICES,
  PREP_MAX,
  delayText,
  minutesText,
  offsetLabel,
  offsetShort,
  prepProblem,
  previewDraft,
  quietHoursText,
  remindersBody,
  remindersDraft,
  sameReminders,
  stepValue,
} from '@/lib/settings/reminders'
import type { RemindersDraft, RemindersView, StepperKey } from '@/lib/settings/reminders'
import { chip, navStyle, seg, serviceKindStyle, serviceRowStyle, sw } from '@/lib/settings/styles'
import type { SectionKey } from '@/lib/settings/types'
import { MembershipSections } from './memberships'
import { PricingSections } from './pricing'
import { formError, saveButtonStyle, swatchButtonStyle } from './ui'
import type { InputEvent, KeyEvent, RunOptions, RunResult, SectionCtx, Vals } from './ui'

export type ExtraSection = 'catalog' | 'categories' | 'reminders' | 'sizes' | 'prices' | 'memberships'
export const EXTRA_SECTIONS: readonly ExtraSection[] = [
  'catalog',
  'categories',
  'reminders',
  'sizes',
  'prices',
  'memberships',
]
/** Vehicle sizes, Prices by size, Memberships: one nav button, tabs over the section. */
const PRICING_SECTIONS: readonly SectionKey[] = ['sizes', 'prices', 'memberships']
/** The sections that read GET /catalog. */
const CATALOG_SECTIONS: readonly SectionKey[] = ['catalog', 'categories', 'sizes', 'prices', 'memberships']
export const isExtraSection = (s: SectionKey): s is ExtraSection =>
  (EXTRA_SECTIONS as readonly string[]).includes(s)

/** What the extras need from the Settings view model. */
export interface ExtrasHost {
  section(): SectionKey
  go(k: SectionKey): void
  flash(text: string): void
  rerender(): void
}

export interface ExtrasDeps {
  api: SettingsApi
  qc: QueryClient
  session: () => Session | null
  toast?: (t: ToastSpec) => void
  schedule?: (fn: () => void) => void
  previewDebounceMs?: number
}

const CATALOG_KEY = qk.settings('catalog')
const REMINDERS_KEY = qk.settings('reminders')
const FOREVER = { staleTimeMs: Infinity }
const noop = (): void => {}

const SERVICES_DENY = 'set.services' as const
const REMINDERS_DENY = 'set.hours' as const

/** A 422 names the field; its message is what the form shows. Anything else is toasted by command(). */
function inlineMessage(e: ApiError): string {
  return e.errors[0]?.message || e.detail || e.title
}

type CategoryDraft = { label: string; colour: string }
const sameCategory = (a: CategoryDraft, b: CategoryDraft): boolean =>
  a.label === b.label && normalizeColour(a.colour) === normalizeColour(b.colour)

const STEPPER_BTN = { dec: '−', inc: '+' } as const

interface RemPreview {
  key: string
  value: RemindersPreviewRes | null
  failed: string
}

export class SettingsExtras {
  private readonly api: SettingsApi
  private readonly qc: QueryClient
  private readonly store: QueryStore
  private readonly sessionOf: () => Session | null
  private readonly emit: (t: ToastSpec) => void
  private readonly debounceMs: number
  private host: ExtrasHost | null = null
  private readonly listeners = new Set<() => void>()
  private unsubscribeStore: (() => void) | null = null
  private readonly observers = new Map<string, () => void>()

  // catalog
  private kind: 'pkg' | 'addon' = 'pkg'
  private selId: string | null = null
  private readonly svcDrafts = new DraftSet<ServiceDraft>()
  private svcErrors: Record<string, string> = {}
  // vehicle sizes, prices by size and the booking fee; memberships (ADR 0170)
  private readonly pricing: PricingSections
  private readonly memberships: MembershipSections
  // categories
  private readonly cats = new DraftSet<CategoryDraft>(sameCategory)
  private catErrors: Record<string, string> = {}
  private adding: { label: string; colour: string } | null = null
  private addError = ''
  // reminders
  private readonly rem = new DraftSet<RemindersDraft>(sameReminders)
  private remError = ''
  private preview: RemPreview = { key: '', value: null, failed: '' }
  private previewWanted = ''
  private previewTimer: ReturnType<typeof setTimeout> | undefined
  private previewInFlight = ''
  // writes on their way, by name (a second click while one is running does nothing)
  private readonly busy = new Set<string>()

  constructor(deps: ExtrasDeps) {
    this.api = deps.api
    this.qc = deps.qc
    this.sessionOf = deps.session
    this.emit = deps.toast ?? ((t) => toasts.emit(t))
    this.store = new QueryStore(deps.qc, deps.schedule ? { schedule: deps.schedule } : {})
    this.debounceMs = deps.previewDebounceMs ?? 300
    const ctx: SectionCtx = {
      api: this.api,
      run: <T>(name: string, request: (idem: string) => Promise<T>, o: RunOptions = {}): Promise<RunResult<T>> =>
        this.run(name, CATALOG_KEY, request, SERVICES_DENY, o.invalidate ?? [], o.staleMessage, o.explain),
      allowed: () => this.allowed(SERVICES_DENY),
      busy: (name) => this.busy.has(name),
      changed: () => this.changed(),
      flash: (t) => this.flash(t),
      go: (k) => this.host?.go(k),
    }
    this.pricing = new PricingSections(ctx)
    this.memberships = new MembershipSections(ctx)
  }

  bind(host: ExtrasHost): void {
    this.host = host
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
        clearTimeout(this.previewTimer)
      }
    }
  }

  private notify(): void {
    for (const l of [...this.listeners]) l()
  }

  private changed(): void {
    this.host?.rerender()
  }

  private flash(t: string): void {
    this.host?.flash(t)
  }

  private can(key: PermissionKey): boolean {
    return sessionCan(this.sessionOf(), key)
  }

  /** A write the person cannot do: the existing-style toast and no request (DV-312). */
  private allowed(key: PermissionKey): boolean {
    if (this.can(key)) return true
    this.flash(deniedTitle(key))
    return false
  }

  // reads --------------------------------------------------------------------------------------------------------------

  /**
   * An observer makes the query active, so an invalidation from the event stream refetches it at once. Only while its
   * section is the one on screen (vals drops it otherwise): elsewhere an event just marks the copy stale, and opening
   * the section again reads it then, once.
   */
  private watch<T>(name: string, key: QueryKey, fetcher: () => Promise<T>): void {
    if (!this.listeners.size || this.observers.has(name)) return
    const o = new QueryObserver<T>(this.qc, { queryKey: key, queryFn: fetcher, staleTime: Infinity })
    this.observers.set(
      name,
      o.subscribe(() => {}),
    )
  }

  private unwatch(name: string): void {
    this.observers.get(name)?.()
    this.observers.delete(name)
  }

  catalog(): CatalogRes | undefined {
    const f = () => this.api.catalog()
    this.watch('catalog', CATALOG_KEY, f)
    return this.store.read<CatalogRes>(CATALOG_KEY, f, FOREVER)
  }

  reminders(): RemindersRes | undefined {
    const f = () => this.api.reminders()
    this.watch('reminders', REMINDERS_KEY, f)
    return this.store.read<RemindersRes>(REMINDERS_KEY, f, FOREVER)
  }

  /** What stands in for an extra section while its data is not here. */
  gate(sec: ExtraSection): 'loading' | 'failed' | null {
    const key = sec === 'reminders' ? REMINDERS_KEY : CATALOG_KEY
    const v = sec === 'reminders' ? this.reminders() : this.catalog()
    if (v) return null
    return this.store.status(key) === 'error' ? 'failed' : 'loading'
  }

  reload(): void {
    void this.qc.invalidateQueries({ queryKey: CATALOG_KEY })
    void this.qc.invalidateQueries({ queryKey: REMINDERS_KEY })
  }

  private async run<T>(
    name: string,
    key: QueryKey,
    request: (idem: string) => Promise<T>,
    deny: PermissionKey,
    invalidate: QueryKey[] = [],
    staleMessage: string = STALE_DRAFT_MESSAGE,
    explain?: (e: ApiError) => string | null,
  ): Promise<RunResult<T>> {
    if (this.busy.has(name)) return { ok: false, message: '' }
    this.busy.add(name)
    this.changed()
    try {
      const r = await command<T>({
        key,
        request,
        invalidate,
        denyLabel: deniedTitle(deny).replace(/^Your role can’t /, ''),
        queryClient: this.qc,
        toast: noop,
      })
      if (r.ok) return r
      const e = r.error
      const own = explain?.(e)
      if (own) return { ok: false, message: own }
      if (e.isValidation || (e.isConflict && e.status === 409))
        return { ok: false, message: inlineMessage(e) }
      // the draft was made on an older copy: command() refetches it and the draft is rebased on the newer one
      if (e.status === 412) return { ok: false, message: staleMessage }
      if (!e.isUnauthenticated && e.kind !== 'aborted')
        this.emit(toastForError(e, { denyLabel: deniedTitle(deny).replace(/^Your role can’t /, '') }))
      return { ok: false, message: '' }
    } finally {
      this.busy.delete(name)
      this.changed()
    }
  }

  // ---- the values of the template (everything under live.*) --------------------------------------------------------

  vals(sec: SectionKey, gate: 'locked' | 'loading' | 'failed' | null, dark: boolean): Vals {
    const go = (k: SectionKey) => () => this.host?.go(k)
    const open = !gate
    const out: Vals = {
      xnav: {
        catalog: navStyle(sec, 'catalog'),
        categories: navStyle(sec, 'categories'),
        reminders: navStyle(sec, 'reminders'),
        // one nav button for the three pricing sections (the nav has no room for three at 1000 px: DV-322)
        pricing: navStyle(PRICING_SECTIONS.includes(sec) ? 'prices' : sec, 'prices'),
      },
      goCatalog: go('catalog'),
      goCategories: go('categories'),
      goReminders: go('reminders'),
      goSizes: go('sizes'),
      goPrices: () => {
        this.pricing.focus = null
        this.host?.go('prices')
      },
      goMemberships: go('memberships'),
      secCatalog: sec === 'catalog' && open,
      secCategories: sec === 'categories' && open,
      secReminders: sec === 'reminders' && open,
      secSizes: sec === 'sizes' && open,
      secPrices: sec === 'prices' && open,
      secMemberships: sec === 'memberships' && open,
      // Prices by size, Memberships, Vehicle sizes: tabs over the section (the design's segment control)
      pricingTabs: {
        show: PRICING_SECTIONS.includes(sec) && open,
        tabs: (
          [
            ['prices', 'Prices by size'],
            ['memberships', 'Memberships'],
            ['sizes', 'Vehicle sizes'],
          ] as const
        ).map(([k, label]) => ({
          label,
          style: seg(sec === k),
          onClick: () => {
            if (k === 'prices') this.pricing.focus = null
            this.host?.go(k)
          },
        })),
      },
      svcPriceNote:
        'Prices are set by vehicle size in Prices by size: the website, online booking and the text assistant read them from there, and a booking charges the starting price until visits are priced by size.',
    }
    if (!CATALOG_SECTIONS.includes(sec)) this.unwatch('catalog')
    if (sec !== 'reminders') this.unwatch('reminders')
    const c = CATALOG_SECTIONS.includes(sec) ? this.catalog() : undefined
    out.cat = this.catalogVals(sec === 'catalog' ? c : undefined, dark)
    out.cats = this.categoriesVals(sec === 'categories' ? c : undefined)
    out.rem = this.remindersVals(sec === 'reminders' ? this.reminders() : undefined, sec === 'reminders' && open)
    out.sizes = this.pricing.sizesVals(sec === 'sizes' ? c : undefined)
    out.prices = this.pricing.pricesVals(sec === 'prices' ? c : undefined)
    out.mem = this.memberships.vals(sec === 'memberships' ? c : undefined)
    return out
  }

  // ---- Catalog ----------------------------------------------------------------------------------------------------

  private items(c: CatalogRes): CatalogItem[] {
    return (this.kind === 'pkg' ? c.packages : c.addons) as CatalogItem[]
  }

  private selected(c: CatalogRes): CatalogItem | null {
    const list = this.items(c)
    return list.find((s) => s.id === this.selId) ?? list[0] ?? null
  }

  private svcEntry(s: CatalogItem): DraftEntry<ServiceDraft> | undefined {
    return this.svcDrafts.get(s.id, serviceDraft(s), s.version)
  }

  private draftOf(s: CatalogItem): ServiceDraft {
    return this.svcEntry(s)?.value ?? serviceDraft(s)
  }

  private editService(s: CatalogItem, patch: Partial<ServiceDraft>): void {
    if (!this.allowed(SERVICES_DENY)) return
    this.svcDrafts.set(s.id, serviceDraft(s), s.version, { ...this.draftOf(s), ...patch })
    delete this.svcErrors[s.id]
    this.changed()
  }

  private async saveService(s: CatalogItem): Promise<void> {
    if (!this.allowed(SERVICES_DENY)) return
    const e = this.svcEntry(s)
    if (!e) return
    const b = serviceBody(e.value, e.version)
    if (!b.ok) {
      this.svcErrors[s.id] = b.message
      return this.changed()
    }
    const r = await this.run(
      'svc:' + s.id,
      CATALOG_KEY,
      (idem) => this.api.saveCatalogService(s.id, b.value, { idempotencyKey: idem }),
      SERVICES_DENY,
      [qk.settings('services'), ['ops'], ['payments']],
    )
    if (!r.ok) {
      if (r.message) this.svcErrors[s.id] = r.message
      return this.changed()
    }
    this.svcDrafts.drop(s.id)
    delete this.svcErrors[s.id]
    const moved = r.data.appointmentsUpdated
    this.flash(
      'Saved ' +
        (r.data.publicName || r.data.name) +
        (moved ? ' · ' + moved + (moved === 1 ? ' open visit' : ' open visits') + ' updated' : ''),
    )
  }

  private catalogVals(c: CatalogRes | undefined, dark: boolean): Vals {
    const empty: Vals = {
      note: '',
      kindPkgStyle: seg(true),
      kindAddonStyle: seg(false),
      kindPkg: noop,
      kindAddon: noop,
      list: [],
      noItems: true,
      has: false,
      svc: {},
    }
    if (!c) return empty
    const cats = c.categories as CatalogCategoryItem[]
    const info: CategoryInfo[] = cats.map((x) => ({ key: x.key, label: x.label, colour: x.colour }))
    const sizes = sortSizes(c.vehicleClasses as VehicleClassItem[])
    const prices = c.prices as PriceRowItem[]
    const line = (s: CatalogItem) =>
      fromLine(prices.find((r) => r.serviceId === s.id), s.quoteOnly, s.priceCents, sizes)
    const sel = this.selected(c)
    const list = this.items(c).map((s) => {
      const d = this.draftOf(s)
      const subs = [categoryLabel(s.category, info), s.quoteOnly ? 'quote only' : line(s)]
      if (!s.visibleOnline) subs.push('hidden')
      if (this.svcEntry(s)) subs.push('unsaved')
      return {
        name: d.publicName.trim() || s.name,
        sub: subs.join(' · '),
        swatch: swatchStyle(cats.find((x) => x.key === s.category)?.colour ?? null),
        style: serviceRowStyle(!!sel && sel.id === s.id),
        onClick: () => {
          this.selId = s.id
          this.changed()
        },
      }
    })
    return {
      note:
        'What you set here is what the website, online booking and the text assistant show. Prices are set per vehicle size in Prices by size, and what members get in Memberships.',
      kindPkgStyle: seg(this.kind === 'pkg'),
      kindAddonStyle: seg(this.kind === 'addon'),
      kindPkg: () => {
        this.kind = 'pkg'
        this.selId = null
        this.changed()
      },
      kindAddon: () => {
        this.kind = 'addon'
        this.selId = null
        this.changed()
      },
      list,
      noItems: list.length === 0,
      has: !!sel,
      svc: sel ? this.serviceVals(sel, cats, line(sel), dark) : {},
    }
  }

  private serviceVals(s: CatalogItem, cats: CatalogCategoryItem[], priceLine: string, dark: boolean): Vals {
    const d = this.draftOf(s)
    const set =
      (k: 'publicName' | 'description') =>
      (e: InputEvent): void =>
        this.editService(s, { [k]: e.target.value } as Partial<ServiceDraft>)
    const shown = cats.filter((x) => x.active || x.key === d.category)
    const toggle = (label: string, sub: string, on: boolean, flip: () => void) => {
      const w = sw(on)
      return { label, sub, track: w.track, knob: w.knob, toggle: flip }
    }
    const dirty = !!this.svcEntry(s)
    const busy = this.busy.has('svc:' + s.id)
    const err = formError(this.svcErrors[s.id] ?? '', this.svcEntry(s))
    const cur = cats.find((x) => x.key === d.category)
    return {
      kindStyle: serviceKindStyle(s.kind === 'package'),
      kindLabel: s.kind === 'package' ? 'Package' : 'Add-on',
      chip: { label: cur?.label ?? categoryLabel(d.category, []), style: categoryChipStyle(cur?.colour ?? '', dark, 'file') },
      title: s.name,
      meta: (s.quoteOnly ? 'Quote only · ' : '') + s.durationMin + ' min',
      priceLine,
      editPrices: () => {
        this.pricing.focus = s.id
        this.host?.go('prices')
      },
      publicName: d.publicName,
      namePlaceholder: s.name,
      setPublicName: set('publicName'),
      description: d.description,
      setDescription: set('description'),
      catOpts: shown.map((x) => ({
        label: x.active ? x.label : x.label + ' (off)',
        style: chip(x.key === d.category),
        onClick: () => this.editService(s, { category: x.key }),
      })),
      toggles: [
        toggle(
          'Shown on the website',
          'Off: hidden from the website and online booking. Staff can still book it.',
          d.visibleOnline,
          () => this.editService(s, { visibleOnline: !d.visibleOnline }),
        ),
        toggle('Quote only', 'No price on the website: clients ask for a quote.', d.quoteOnly, () =>
          this.editService(s, { quoteOnly: !d.quoteOnly }),
        ),
      ],
      sort: String(d.sort),
      sortDec: () => this.editService(s, { sort: Math.max(0, d.sort - 1) }),
      sortInc: () => this.editService(s, { sort: d.sort + 1 }),
      hasError: !!err,
      error: err,
      dirty,
      canSave: dirty && !busy,
      saveLabel: busy ? 'Saving…' : 'Save',
      saveStyle: saveButtonStyle(dirty && !busy),
      save: () => void this.saveService(s),
      discard: () => {
        this.svcDrafts.drop(s.id)
        delete this.svcErrors[s.id]
        this.changed()
      },
    }
  }

  // ---- Categories -------------------------------------------------------------------------------------------------

  private categoriesVals(c: CatalogRes | undefined): Vals {
    const swatchesFor = (cur: string, pick: (hex: string) => void) =>
      CATEGORY_SWATCHES.map((hex) => ({
        style: swatchButtonStyle(hex, normalizeColour(cur) === hex),
        onClick: () => pick(hex),
      }))
    const add = this.adding
    const addKey = add ? keyFromLabel(add.label) : ''
    const taken = c ? c.categories.map((x) => x.key) : []
    const addVals: Vals = {
      open: !!add,
      start: () => {
        if (!this.allowed(SERVICES_DENY)) return
        this.adding = { label: '', colour: CATEGORY_SWATCHES[5] }
        this.addError = ''
        this.changed()
      },
      cancel: () => {
        this.adding = null
        this.addError = ''
        this.changed()
      },
      label: add?.label ?? '',
      setLabel: (e: InputEvent) => {
        if (!this.adding) return
        this.adding = { ...this.adding, label: e.target.value }
        this.addError = ''
        this.changed()
      },
      onKey: (e: KeyEvent) => {
        if (e.key === 'Enter') void this.createCategory(taken)
      },
      colour: add?.colour ?? '',
      setColour: (e: InputEvent) => {
        if (!this.adding) return
        this.adding = { ...this.adding, colour: e.target.value }
        this.changed()
      },
      swatch: swatchStyle(add ? normalizeColour(add.colour) : null, 22),
      swatches: swatchesFor(add?.colour ?? '', (hex) => {
        if (!this.adding) return
        this.adding = { ...this.adding, colour: hex }
        this.changed()
      }),
      keyLine: addKey ? 'Key: ' + addKey + ' (set once, never changes)' : 'The key is made from the name.',
      hasError: !!this.addError,
      error: this.addError,
      saveLabel: this.busy.has('cat:new') ? 'Adding…' : 'Add category',
      save: () => void this.createCategory(taken),
      canAdd: (c?.categories.length ?? 0) < 20 && !add,
    }
    if (!c) return { rows: [], add: addVals, note: '' }
    const all = [...(c.categories as CatalogCategoryItem[])].sort((a, b) => a.sort - b.sort)
    const rows = all.map((x, i) => {
      const server: CategoryDraft = { label: x.label, colour: x.colour }
      const entry = this.cats.get(x.key, server, x.version)
      const d = entry?.value ?? server
      const dirty = !!entry
      const busy = this.busy.has('cat:' + x.key)
      const err = formError(this.catErrors[x.key] ?? '', entry)
      const edit = (patch: Partial<CategoryDraft>) => {
        if (!this.allowed(SERVICES_DENY)) return
        this.cats.set(x.key, server, x.version, { ...this.cats.value(x.key, server, x.version), ...patch })
        delete this.catErrors[x.key]
        this.changed()
      }
      const w = sw(x.active)
      const used = c.packages.concat(c.addons).filter((s) => s.category === x.key).length
      return {
        key: x.key,
        swatch: swatchStyle(normalizeColour(d.colour), 22),
        label: d.label,
        setLabel: (e: InputEvent) => edit({ label: e.target.value }),
        colour: d.colour,
        setColour: (e: InputEvent) => edit({ colour: e.target.value }),
        swatches: swatchesFor(d.colour, (hex) => edit({ colour: hex })),
        keyLine:
          'Key ' +
          x.key +
          (x.builtin ? ' · built in' : '') +
          ' · ' +
          (used === 1 ? '1 active service' : used + ' active services') +
          (x.active ? '' : ' · off: hidden from the website'),
        track: w.track,
        knob: w.knob,
        toggle: () => void this.patchCategory(x, { active: !x.active }),
        up: () => void this.moveCategory(all, i, -1),
        down: () => void this.moveCategory(all, i, 1),
        canRemove: !x.builtin,
        remove: () => void this.removeCategory(x),
        dirty,
        saveStyle: saveButtonStyle(dirty && !busy),
        saveLabel: busy ? 'Saving…' : 'Save',
        save: () => void this.saveCategory(x),
        discard: () => {
          this.cats.drop(x.key)
          delete this.catErrors[x.key]
          this.changed()
        },
        hasError: !!err,
        error: err,
      }
    })
    return {
      rows,
      add: addVals,
      note:
        'Every service belongs to one category (set it in Catalog). A visit shows a chip per category on the board and in Payments, and counts as Mixed when it combines two. Turning a category off hides it and its services from the website; the five built-in ones can be turned off but not removed.',
    }
  }

  private async saveCategory(x: CatalogCategoryItem): Promise<void> {
    const e = this.cats.get(x.key, { label: x.label, colour: x.colour }, x.version)
    if (!e) return
    const d = e.value
    const problem = categoryProblem(d.label, d.colour, null, [])
    if (problem) {
      this.catErrors[x.key] = problem
      return this.changed()
    }
    const patch = { label: d.label.trim(), colour: normalizeColour(d.colour) }
    const ok = await this.patchCategory(x, patch, e.version, STALE_DRAFT_MESSAGE)
    if (ok) {
      this.cats.drop(x.key)
      this.flash('Saved ' + patch.label)
    }
  }

  /** One category change; on/off and order are sent at once on the copy on screen, a rename with its draft's version. */
  private async patchCategory(
    x: CatalogCategoryItem,
    patch: { label?: string; colour?: string; active?: boolean; sort?: number },
    version: number = x.version,
    staleMessage: string = STALE_ACTION_MESSAGE,
  ): Promise<boolean> {
    if (!this.allowed(SERVICES_DENY)) return false
    const r = await this.run(
      'cat:' + x.key,
      CATALOG_KEY,
      (idem) => this.api.updateCategory(x.key, { ...patch, version }, { idempotencyKey: idem }),
      SERVICES_DENY,
      [REMINDERS_KEY, ['ops'], ['payments']],
      staleMessage,
    )
    if (!r.ok) {
      if (r.message) this.catErrors[x.key] = r.message
      this.changed()
      return false
    }
    if (patch.active !== undefined)
      this.flash(r.data.label + (r.data.active ? ' is on' : ' is off · hidden from the website'))
    return true
  }

  /** Swaps the order with the neighbour (two saves; equal orders are spread first). */
  private async moveCategory(all: CatalogCategoryItem[], i: number, dir: 1 | -1): Promise<void> {
    const j = i + dir
    if (j < 0 || j >= all.length || !this.allowed(SERVICES_DENY)) return
    const a = all[i]!
    const b = all[j]!
    const sa = a.sort === b.sort ? (i + 1) * 10 : a.sort
    const sb = a.sort === b.sort ? (j + 1) * 10 : b.sort
    if (await this.patchCategory(a, { sort: sb })) await this.patchCategory(b, { sort: sa })
  }

  private async removeCategory(x: CatalogCategoryItem): Promise<void> {
    if (!this.allowed(SERVICES_DENY) || x.builtin) return
    const r = await this.run(
      'cat:' + x.key,
      CATALOG_KEY,
      (idem) => this.api.deleteCategory(x.key, x.version, { idempotencyKey: idem }),
      SERVICES_DENY,
      [REMINDERS_KEY],
      STALE_ACTION_MESSAGE,
    )
    if (!r.ok) {
      if (r.message) this.flash(r.message)
      return
    }
    this.cats.drop(x.key)
    this.flash('Removed ' + x.label)
  }

  private async createCategory(taken: string[]): Promise<void> {
    const a = this.adding
    if (!a || !this.allowed(SERVICES_DENY)) return
    const key = keyFromLabel(a.label)
    const problem = categoryProblem(a.label, a.colour, key, taken)
    if (problem) {
      this.addError = problem
      return this.changed()
    }
    const r = await this.run(
      'cat:new',
      CATALOG_KEY,
      (idem) =>
        this.api.createCategory(
          { key, label: a.label.trim(), colour: normalizeColour(a.colour) },
          { idempotencyKey: idem },
        ),
      SERVICES_DENY,
      [REMINDERS_KEY],
    )
    if (!r.ok) {
      if (r.message) this.addError = r.message
      return this.changed()
    }
    this.adding = null
    this.addError = ''
    this.flash('Added ' + r.data.label)
  }

  // ---- Reminders & texts -----------------------------------------------------------------------------------------------

  private remEntry(v: RemindersView): DraftEntry<RemindersDraft> | undefined {
    return this.rem.get('rem', remindersDraft(v), v.version)
  }

  private remDraftOf(v: RemindersView): RemindersDraft {
    return this.remEntry(v)?.value ?? remindersDraft(v)
  }

  private editRem(v: RemindersView, fn: (d: RemindersDraft) => void): void {
    if (!this.allowed(REMINDERS_DENY)) return
    const cur = this.remDraftOf(v)
    const next: RemindersDraft = {
      reminders: {
        ...cur.reminders,
        offsetsMin: [...cur.reminders.offsetsMin],
        categoryPrep: { ...cur.reminders.categoryPrep },
      },
      statusTexts: { ...cur.statusTexts },
      leads: { ...cur.leads },
    }
    fn(next)
    this.rem.set('rem', remindersDraft(v), v.version, next)
    this.remError = ''
    this.changed()
  }

  private async saveRem(v: RemindersView): Promise<void> {
    if (!this.allowed(REMINDERS_DENY)) return
    const e = this.remEntry(v)
    if (!e) return
    const bad = Object.entries(e.value.reminders.categoryPrep)
      .map(([k, t]) => [k, prepProblem(t)] as const)
      .find(([, p]) => p)
    if (bad) {
      this.remError = categoryLabel(bad[0], v.categories) + ': ' + bad[1]
      return this.changed()
    }
    const body = remindersBody(e.value, e.version)
    const r = await this.run(
      'rem',
      REMINDERS_KEY,
      (idem) => this.api.saveReminders(body, { idempotencyKey: idem }),
      REMINDERS_DENY,
    )
    if (!r.ok) {
      if (r.message) this.remError = r.message
      return this.changed()
    }
    this.rem.drop('rem')
    this.remError = ''
    this.flash('Reminders saved · the next texts use them')
  }

  /** The texts as they will go out, for the draft on screen (debounced; the last answer stays up meanwhile). */
  private previewOf(d: RemindersDraft): RemPreview {
    const key = JSON.stringify(previewDraft(d))
    if (this.preview.key === key || this.previewInFlight === key) return this.preview
    if (this.previewWanted !== key) {
      this.previewWanted = key
      clearTimeout(this.previewTimer)
      this.previewTimer = setTimeout(() => void this.fetchPreview(key), this.preview.key ? this.debounceMs : 0)
    }
    return this.preview
  }

  private async fetchPreview(key: string): Promise<void> {
    if (this.previewWanted !== key || !this.listeners.size) return
    this.previewInFlight = key
    try {
      const value = await this.api.previewReminders({ draft: JSON.parse(key) as RemindersDraft })
      if (this.previewWanted === key) this.preview = { key, value, failed: '' }
    } catch (e) {
      if (this.previewWanted === key)
        this.preview = {
          key,
          value: this.preview.value,
          failed: e instanceof ApiError && e.isValidation ? inlineMessage(e) : 'The preview couldn’t load.',
        }
    } finally {
      if (this.previewInFlight === key) this.previewInFlight = ''
      this.changed()
    }
  }

  private remindersVals(r: RemindersRes | undefined, open: boolean): Vals {
    const blank: Vals = {
      offsets: [],
      addOpts: [],
      toggles: [],
      prep: [],
      status: [],
      leads: [],
      texts: [],
      dirty: false,
    }
    if (!r) return blank
    const v = r as RemindersView
    const d = this.remDraftOf(v)
    const offsets = [...d.reminders.offsetsMin].sort((a, b) => b - a)
    const toggle = (label: string, sub: string, on: boolean, flip: (x: RemindersDraft) => void) => {
      const w = sw(on)
      return { label, sub, track: w.track, knob: w.knob, toggle: () => this.editRem(v, flip) }
    }
    const stepper = (label: string, key: StepperKey, value: number, text: string, setv: (x: RemindersDraft, n: number) => void) => ({
      label,
      val: text,
      dec: () => this.editRem(v, (x) => setv(x, stepValue(key, value, -1))),
      inc: () => this.editRem(v, (x) => setv(x, stepValue(key, value, 1))),
      decLabel: STEPPER_BTN.dec,
      incLabel: STEPPER_BTN.inc,
    })
    const st = d.statusTexts
    const ld = d.leads
    const prepKeys = [
      ...v.categories.filter((c) => c.active).map((c) => c.key),
      ...Object.keys(d.reminders.categoryPrep).filter((k) => !v.categories.some((c) => c.key === k && c.active)),
    ]
    const preview = open ? this.previewOf(d) : this.preview
    const busy = this.busy.has('rem')
    const entry = this.remEntry(v)
    const dirty = !!entry
    const remError = formError(this.remError, entry)
    return {
      quiet: quietHoursText(v.quietHours),
      offsets: offsets.map((m) => ({
        label: offsetLabel(m),
        remove: () => this.editRem(v, (x) => (x.reminders.offsetsMin = x.reminders.offsetsMin.filter((y) => y !== m))),
      })),
      noOffsets: offsets.length === 0,
      canAdd: offsets.length < MAX_OFFSETS,
      addOpts: OFFSET_CHOICES.filter((m) => !offsets.includes(m)).map((m) => ({
        label: '+ ' + offsetShort(m),
        style: chip(false),
        onClick: () => {
          if (offsets.length >= MAX_OFFSETS) return this.flash('At most ' + MAX_OFFSETS + ' reminders per visit')
          this.editRem(v, (x) => x.reminders.offsetsMin.push(m))
        },
      })),
      toggles: [
        toggle(
          'Ask to confirm',
          'A booked visit that is not confirmed yet gets “Reply C to confirm” in its reminder.',
          d.reminders.confirmRequest,
          (x) => (x.reminders.confirmRequest = !x.reminders.confirmRequest),
        ),
        toggle(
          'Review request',
          'A thank-you with a review link after the visit.',
          d.reminders.reviewRequest,
          (x) => (x.reminders.reviewRequest = !x.reminders.reviewRequest),
        ),
      ],
      prep: prepKeys.map((k) => {
        const cat = v.categories.find((c) => c.key === k)
        const text = d.reminders.categoryPrep[k] ?? ''
        const problem = prepProblem(text)
        return {
          label: (cat?.label ?? categoryLabel(k, [])) + (cat && !cat.active ? ' (off)' : ''),
          swatch: swatchStyle(cat?.colour ?? null),
          value: text,
          placeholder: k === 'tint' ? 'e.g. Plan for 2–3 hours.' : 'Nothing extra',
          set: (e: InputEvent) => this.editRem(v, (x) => (x.reminders.categoryPrep[k] = e.target.value)),
          count: text.trim().length + ' / ' + PREP_MAX,
          hasError: !!problem,
          error: problem ?? '',
        }
      }),
      status: [
        {
          ...toggle(
            'Checked in',
            'When staff check the car in, unless the wash starts first (then “wash started” goes).',
            st.checkedIn,
            (x) => (x.statusTexts.checkedIn = !x.statusTexts.checkedIn),
          ),
          steppers: [
            stepper('Wait after check-in', 'checkedInDelayMin', st.checkedInDelayMin, minutesText(st.checkedInDelayMin), (x, n) => (x.statusTexts.checkedInDelayMin = n)),
          ],
        },
        {
          ...toggle(
            'Running late',
            'A new pickup time when a wash runs past its promised end.',
            st.runningLate,
            (x) => (x.statusTexts.runningLate = !x.statusTexts.runningLate),
          ),
          steppers: [
            stepper('Late after', 'lateGraceMin', st.lateGraceMin, minutesText(st.lateGraceMin), (x, n) => (x.statusTexts.lateGraceMin = n)),
            stepper('Texts per visit', 'lateMax', st.lateMax, 'at most ' + st.lateMax, (x, n) => (x.statusTexts.lateMax = n)),
          ],
        },
        {
          ...toggle('Ready for pickup', 'When the job is marked complete.', st.ready, (x) => (x.statusTexts.ready = !x.statusTexts.ready)),
          steppers: [],
        },
        {
          ...toggle(
            'Picked up',
            'A thank-you when the car leaves, with the receipt when it is paid.',
            st.pickedUp,
            (x) => (x.statusTexts.pickedUp = !x.statusTexts.pickedUp),
          ),
          steppers: [],
        },
        {
          ...toggle(
            'Book-again link in the thank-you',
            'Only to clients who agreed to offers.',
            st.bookAgainLink,
            (x) => (x.statusTexts.bookAgainLink = !x.statusTexts.bookAgainLink),
          ),
          steppers: [],
        },
      ],
      leads: [
        {
          ...toggle(
            'Follow up once',
            'One text to someone who asked about a service and did not book. Never twice, never after STOP.',
            ld.followUpEnabled,
            (x) => (x.leads.followUpEnabled = !x.leads.followUpEnabled),
          ),
          steppers: [
            stepper('Wait after their last text', 'followUpDelayMin', ld.followUpDelayMin, delayText(ld.followUpDelayMin), (x, n) => (x.leads.followUpDelayMin = n)),
            stepper('Only within', 'withinHours', ld.withinHours, ld.withinHours + ' h of their last text', (x, n) => (x.leads.withinHours = n)),
          ],
        },
        {
          ...toggle(
            'Business hours only',
            'Outside open hours the follow-up waits for the shop to open.',
            ld.businessHoursOnly,
            (x) => (x.leads.businessHoursOnly = !x.leads.businessHoursOnly),
          ),
          steppers: [],
        },
      ],
      texts: (preview.value?.texts ?? []).map((t) => ({
        title: t.label,
        timing: t.timing,
        text: t.text,
        meta:
          (t.segments === 1 ? '1 text' : t.segments + ' texts') +
          ' · ' +
          (t.encoding === 'GSM-7' ? 'plain SMS' : 'special characters (shorter texts)'),
        off: !t.enabled,
        bubbleStyle: bubbleStyle(t.enabled),
      })),
      previewNote: preview.value
        ? 'Sample: ' + preview.value.sample.firstName + ', ' + preview.value.sample.date + ' at ' + preview.value.sample.time + '. Exactly what is sent; links are placeholders.'
        : 'Loading the preview…',
      previewFailed: !!preview.failed,
      previewError: preview.failed,
      dirty,
      hasError: !!remError,
      error: remError,
      saveLabel: busy ? 'Saving…' : 'Save changes',
      save: () => void this.saveRem(v),
      discard: () => {
        this.rem.drop('rem')
        this.remError = ''
        this.changed()
      },
    }
  }
}

/** A preview text in the Messages tab's system bubble shape; a text that is off is dimmed. */
function bubbleStyle(on: boolean): Record<string, string | number> {
  return {
    marginTop: '8px',
    padding: '10px 13px',
    borderRadius: '14px 14px 14px 4px',
    background: 'var(--panel)',
    border: '1px solid var(--line)',
    fontSize: '13px',
    fontWeight: 600,
    lineHeight: 1.45,
    color: on ? 'var(--ink)' : 'var(--ink3)',
    whiteSpace: 'pre-wrap',
    opacity: on ? 1 : 0.7,
  }
}
