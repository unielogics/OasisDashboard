// Settings → Memberships (live variant only; ADR 0170, backend api-spec 15.10; DEVIATIONS DV-324): the tier list (add,
// order, on/off at a glance) and the editor of the selected tier (name, colour, on, public, VIP booking, member % off,
// max cars, perks, the Squarespace link kept until Square billing, and the inclusions: what each covers, N a month,
// unlimited or every wash, applied by itself), saved whole with the tier's version (PUT /catalog/tiers/:key); then the
// tier × size monthly price grid, saved with each tier's priceVersion (PUT /catalog/tier-prices; append-only on the
// server: a changed price is a new price version, members keep theirs), with the Square sync state read only.
import type { CatalogRes } from '@/data/ports/settings-api'
import { swatchStyle } from '@/lib/categories'
import { CATEGORY_SWATCHES, normalizeColour } from '@/lib/settings/catalog'
import type { CatalogItem } from '@/lib/settings/catalog'
import { CONFLICT_MESSAGE, DraftSet, STALE_ACTION_MESSAGE } from '@/lib/settings/drafts'
import { offChangesText, offSizeChanges, sortSizes } from '@/lib/settings/sizes'
import type { PriceRowItem, VehicleClassItem } from '@/lib/settings/sizes'
import { chip, seg, serviceRowStyle, sw } from '@/lib/settings/styles'
import {
  TIER_LIMITS,
  changedTierCells,
  discountHint,
  inclusionCountText,
  newInclusion,
  newTierBody,
  newTierProblem,
  parsePercent,
  sortTiers,
  staleTierMessage,
  tierBody,
  tierBodyOf,
  tierDraft,
  tierKeyFromName,
  tierPriceDraft,
  tierSub,
} from '@/lib/settings/tiers'
import type { InclusionDraft, InclusionKind, TierDraft, TierItem, TierPriceDraft } from '@/lib/settings/tiers'
import { moveMembersPreview, moveToast, priceSquareText } from '@/lib/settings/billing'
import { cellInputStyle, formError, gridColumns, saveButtonStyle, swatchButtonStyle } from './ui'
import type { InputEvent, KeyEvent, RunOptions, RunResult, SectionCtx, Vals } from './ui'

const STATE_COLOURS = { ink: 'var(--ink3)', green: '#0E9E6E', amber: '#8A5A06', red: '#C2410C' } as const
const stateStyle = (tone: keyof typeof STATE_COLOURS): Record<string, string | number> => ({
  fontSize: '10.5px',
  fontWeight: 700,
  color: STATE_COLOURS[tone],
  marginTop: '3px',
  textAlign: 'right',
  paddingRight: '4px',
})

const KINDS: [InclusionKind, string][] = [
  ['count', 'Per month'],
  ['unlimited', 'Unlimited'],
  ['every_visit', 'Every wash'],
]

/** "Move members" (ADR 0171 D9, DV-909): set.billing, the notice from the billing settings, the shop's today. */
export interface MoveHooks {
  canMove(): boolean
  /** set.billing, or the "Your role can’t …" toast and false. */
  allowedMove(): boolean
  /** The billing setting's notice (days); null while it has not loaded (Move members then waits: no fallback is sent). */
  noticeDays(): number | null
  today(): string
  runMove<T>(name: string, request: (idem: string) => Promise<T>, o?: RunOptions): Promise<RunResult<T>>
}

export class MembershipSections {
  private moveFor: string | null = null
  private moveError = ''
  private selKey: string | null = null
  private readonly drafts = new DraftSet<TierDraft>()
  private errors: Record<string, string> = {}
  private adding: { name: string; colour: string } | null = null
  private addError = ''
  private readonly prices = new DraftSet<TierPriceDraft>()
  private priceError = ''
  private conflictTier: string | null = null

  constructor(
    private readonly ctx: SectionCtx,
    private readonly move: MoveHooks = {
      canMove: () => false,
      allowedMove: () => false,
      noticeDays: () => null,
      today: () => '1970-01-01',
      runMove: async () => ({ ok: false, message: '' }),
    },
  ) {}

  private tiers(c: CatalogRes): TierItem[] {
    return sortTiers(c.tiers as TierItem[])
  }

  vals(c: CatalogRes | undefined): Vals {
    const add = this.adding
    const tiers = c ? this.tiers(c) : []
    const addKey = add ? tierKeyFromName(add.name) : ''
    const addVals: Vals = {
      open: !!add,
      start: () => {
        if (!this.ctx.allowed()) return
        this.adding = { name: '', colour: CATEGORY_SWATCHES[5] }
        this.addError = ''
        this.ctx.changed()
      },
      cancel: () => {
        this.adding = null
        this.addError = ''
        this.ctx.changed()
      },
      name: add?.name ?? '',
      setName: (e: InputEvent) => {
        if (!this.adding) return
        this.adding = { ...this.adding, name: e.target.value }
        this.addError = ''
        this.ctx.changed()
      },
      onKey: (e: KeyEvent) => {
        if (e.key === 'Enter') void this.createTier(tiers)
      },
      colour: add?.colour ?? '',
      setColour: (e: InputEvent) => {
        if (!this.adding) return
        this.adding = { ...this.adding, colour: e.target.value }
        this.ctx.changed()
      },
      swatch: swatchStyle(add ? normalizeColour(add.colour) : null, 22),
      swatches: CATEGORY_SWATCHES.map((hex) => ({
        style: swatchButtonStyle(hex, !!add && normalizeColour(add.colour) === hex),
        onClick: () => {
          if (!this.adding) return
          this.adding = { ...this.adding, colour: hex }
          this.ctx.changed()
        },
      })),
      keyLine: addKey ? 'Key: ' + addKey + ' (set once, never changes)' : 'The key is made from the name.',
      hasError: !!this.addError,
      error: this.addError,
      saveLabel: this.ctx.busy('tier:new') ? 'Adding…' : 'Add tier',
      save: () => void this.createTier(tiers),
      canAdd: !!c && tiers.length < TIER_LIMITS.tiers && !add,
    }
    if (!c)
      return {
        note: '',
        list: [],
        noTiers: true,
        has: false,
        t: {},
        add: addVals,
        grid: { note: '', rows: [], heads: [], headStyle: gridColumns(0), noSizes: false, dirty: false, hasError: false },
      }
    const sel = tiers.find((t) => t.key === this.selKey) ?? tiers[0] ?? null
    const list = tiers.map((t) => ({
      name: (this.drafts.get(t.key, tierDraft(t), t.version)?.value.name.trim() || t.name),
      sub: tierSub(t, !!this.drafts.get(t.key, tierDraft(t), t.version)),
      swatch: swatchStyle(t.colour, 10),
      style: serviceRowStyle(!!sel && sel.key === t.key),
      onClick: () => {
        this.selKey = t.key
        this.ctx.changed()
      },
    }))
    return {
      note:
        'Each tier has a monthly price per vehicle size: a car up to the plan size is covered in full, a larger one up to the plan-size price, and the difference is paid at the shop. Members get the tier’s % off on what the plan does not include. A tier without a price is not sold online.',
      list,
      noTiers: !tiers.length,
      has: !!sel,
      t: sel ? this.editorVals(c, sel, tiers) : {},
      add: addVals,
      grid: this.gridVals(c, tiers),
    }
  }

  // ---- the editor -------------------------------------------------------------------------------------------------------

  private editorVals(c: CatalogRes, t: TierItem, tiers: TierItem[]): Vals {
    const base = tierDraft(t)
    const entry = this.drafts.get(t.key, base, t.version)
    const d = entry?.value ?? base
    const edit = (fn: (x: TierDraft) => void) => {
      if (!this.ctx.allowed()) return
      const cur = this.drafts.value(t.key, base, t.version)
      const next: TierDraft = { ...cur, inclusions: cur.inclusions.map((i) => ({ ...i, serviceIds: [...i.serviceIds] })) }
      fn(next)
      this.drafts.set(t.key, base, t.version, next)
      delete this.errors[t.key]
      this.ctx.changed()
    }
    const toggle = (label: string, sub: string, on: boolean, flip: (x: TierDraft) => void) => {
      const w = sw(on)
      return { label, sub, track: w.track, knob: w.knob, toggle: () => edit(flip) }
    }
    const services = [...(c.packages as CatalogItem[]), ...(c.addons as CatalogItem[])]
    const nameOf = (id: string) => {
      const s = services.find((x) => x.id === id)
      return s ? s.publicName || s.name : 'A service no longer listed'
    }
    const sample = this.sampleWash(c)
    const bp = parsePercent(d.discount)
    const dirty = !!entry
    const busy = this.ctx.busy('tier:' + t.key)
    const err = formError(this.errors[t.key] ?? '', entry)
    const i = tiers.findIndex((x) => x.key === t.key)
    const subs = ['Key ' + t.key]
    if (t.legacyKey) subs.push('was ' + t.legacyKey)
    subs.push(t.sold ? 'sold: can be turned off, not removed' : 'not sold yet')
    subs.push('Square: ' + (t.squarePlanId ? 'linked' : 'not synced yet'))
    return {
      title: d.name.trim() || t.name,
      sub: subs.join(' · '),
      swatch: swatchStyle(normalizeColour(d.colour), 22),
      name: d.name,
      setName: (e: InputEvent) => edit((x) => (x.name = e.target.value)),
      colour: d.colour,
      setColour: (e: InputEvent) => edit((x) => (x.colour = e.target.value)),
      swatches: [t.colour, ...CATEGORY_SWATCHES.filter((h) => h !== t.colour.toUpperCase())].slice(0, 8).map((hex) => ({
        style: swatchButtonStyle(hex, normalizeColour(d.colour) === hex.toUpperCase()),
        onClick: () => edit((x) => (x.colour = hex)),
      })),
      toggles: [
        toggle('On', 'Off: no new members join. Members keep their plan.', d.active, (x) => (x.active = !x.active)),
        toggle(
          'On the website',
          'Sold on the website and by the text assistant once it has a price.',
          d.public,
          (x) => (x.public = !x.public),
        ),
        toggle('VIP booking', 'Members get the VIP booking times and held slots.', d.vipBooking, (x) => (x.vipBooking = !x.vipBooking)),
      ],
      discount: d.discount,
      setDiscount: (e: InputEvent) => edit((x) => (x.discount = e.target.value)),
      discountHint: discountHint(bp, sample),
      maxCars: d.maxCars,
      setMaxCars: (e: InputEvent) => edit((x) => (x.maxCars = e.target.value)),
      perks: d.perks,
      setPerks: (e: InputEvent) => edit((x) => (x.perks = e.target.value)),
      url: d.checkoutUrl,
      setUrl: (e: InputEvent) => edit((x) => (x.checkoutUrl = e.target.value)),
      inclusions: d.inclusions.map((inc, k) => this.inclusionVals(inc, k, edit, services, nameOf)),
      noInclusions: d.inclusions.length === 0,
      canAddInclusion: d.inclusions.length < TIER_LIMITS.inclusions,
      addInclusion: () => edit((x) => x.inclusions.push(newInclusion())),
      up: () => void this.moveTier(tiers, i, -1),
      down: () => void this.moveTier(tiers, i, 1),
      canRemove: !t.sold,
      remove: () => void this.removeTier(t),
      hasError: !!err,
      error: err,
      dirty,
      saveStyle: saveButtonStyle(dirty && !busy),
      saveLabel: busy ? 'Saving…' : 'Save tier',
      save: () => void this.saveTier(t),
      ...this.moveVals(t),
      discard: () => {
        this.drafts.drop(t.key)
        delete this.errors[t.key]
        this.ctx.changed()
      },
    }
  }

  private inclusionVals(
    inc: InclusionDraft,
    k: number,
    edit: (fn: (x: TierDraft) => void) => void,
    services: CatalogItem[],
    nameOf: (id: string) => string,
  ): Vals {
    const at = (x: TierDraft) => x.inclusions[k]!
    const auto = sw(inc.autoApply)
    const on = sw(inc.active)
    const known = new Set(services.map((s) => s.id))
    const picks = [
      ...services.map((s) => ({ id: s.id, label: s.publicName || s.name })),
      // a service the inclusion names that is no longer listed stays visible so it can be taken off
      ...inc.serviceIds.filter((id) => !known.has(id)).map((id) => ({ id, label: nameOf(id) })),
    ]
    const covered = inc.serviceIds.map(nameOf)
    return {
      label: inc.label,
      setLabel: (e: InputEvent) => edit((x) => (at(x).label = e.target.value)),
      kinds: KINDS.map(([kind, label]) => ({
        label,
        style: seg(inc.kind === kind),
        onClick: () =>
          edit((x) => {
            at(x).kind = kind
            if (kind === 'count' && !at(x).count.trim()) at(x).count = '1'
          }),
      })),
      showCount: inc.kind === 'count',
      count: inc.count,
      setCount: (e: InputEvent) => edit((x) => (at(x).count = e.target.value)),
      summary:
        (inc.label.trim() || 'This inclusion') +
        ': ' +
        inclusionCountText(inc) +
        (covered.length ? ' · ' + covered.join(', ') : ' · pick what it covers') +
        (inc.active ? '' : ' · off'),
      services: picks.map((p) => ({
        label: p.label,
        style: chip(inc.serviceIds.includes(p.id)),
        onClick: () =>
          edit((x) => {
            const ids = at(x).serviceIds
            at(x).serviceIds = ids.includes(p.id) ? ids.filter((y) => y !== p.id) : [...ids, p.id]
          }),
      })),
      autoTrack: auto.track,
      autoKnob: auto.knob,
      toggleAuto: () => edit((x) => (at(x).autoApply = !at(x).autoApply)),
      onTrack: on.track,
      onKnob: on.knob,
      toggleOn: () => edit((x) => (at(x).active = !at(x).active)),
      remove: () => edit((x) => x.inclusions.splice(k, 1)),
      isNew: inc.id === null,
    }
  }

  /**
   * "Move members" of the picked tier (DV-909): members billed by Square at an older price of their size are told (text and
   * email) and moved to today's price after the notice. The box shows the text they get and the date; a second click
   * sends it. Only for set.billing (others see nothing) and only once the tier has a price.
   */
  private moveVals(t: TierItem): Vals {
    const can = this.move.canMove() && t.prices.length > 0
    // the owner's notice period from Billing & integrations; until it has loaded nothing is sent (a guessed notice could
    // give members less notice than the setting says)
    const days = this.move.noticeDays()
    const open = this.moveFor === t.key
    const pv =
      days === null
        ? null
        : moveMembersPreview({ tierName: t.name, fromCents: t.fromMonthlyCents ?? null, days, today: this.move.today() })
    const busy = this.ctx.busy('move:' + t.key)
    return {
      canMove: can,
      moveOpen: can && open,
      moveClosed: can && !open,
      moveStart: () => {
        if (!this.move.allowedMove()) return
        this.moveFor = t.key
        this.moveError = ''
        this.ctx.changed()
      },
      moveCancel: () => {
        this.moveFor = null
        this.moveError = ''
        this.ctx.changed()
      },
      moveExplain: pv ? pv.explain : '',
      moveText: pv ? pv.text : 'Reading the notice period…',
      moveWhen: pv ? 'Moves at the first bill after ' + pv.when : 'Reading the notice period…',
      moveLabel: busy ? 'Sending…' : 'Send the notice and move them',
      moveConfirm: () => {
        if (days !== null && pv) void this.doMove(t, days, pv.when)
      },
      moveHasError: open && !!this.moveError,
      moveError: open ? this.moveError : '',
      moveStyle: saveButtonStyle(!busy && pv !== null),
    }
  }

  private async doMove(t: TierItem, days: number, when: string): Promise<void> {
    if (!this.move.allowedMove()) return
    const r = await this.move.runMove(
      'move:' + t.key,
      (idem) => this.ctx.api.moveMembers(t.key, { notice: days }, { idempotencyKey: idem }),
      {
        explain: (e) =>
          e.code === 'TIER_PRICE_NOT_SYNCED'
            ? 'Today’s ' + t.name + ' prices are not on Square yet. Sync to Square first (Billing & integrations), then move the members.'
            : null,
      },
    )
    if (!r.ok) {
      this.moveError = r.message
      return this.ctx.changed()
    }
    this.moveFor = null
    this.moveError = ''
    this.ctx.flash(moveToast(r.data, when))
  }

  /** The cheapest wash with a price, for the % off example ("Signature Hand Wash $40 costs them $36"). */
  private sampleWash(c: CatalogRes): { name: string; cents: number } | null {
    const prices = c.prices as PriceRowItem[]
    const priced = (c.packages as CatalogItem[])
      .filter((s) => !s.quoteOnly && s.category === 'wash')
      .map((s) => ({ s, row: prices.find((r) => r.serviceId === s.id) }))
      .filter((x) => x.row && x.row.cells.length)
      .sort((a, b) => a.row!.fromCents - b.row!.fromCents)
    const first = priced[0]
    return first ? { name: first.s.publicName || first.s.name, cents: first.row!.fromCents } : null
  }

  private async saveTier(t: TierItem): Promise<void> {
    if (!this.ctx.allowed()) return
    const e = this.drafts.get(t.key, tierDraft(t), t.version)
    if (!e) return
    const b = tierBody(e.value, t, e.version)
    if (!b.ok) {
      this.errors[t.key] = b.message
      return this.ctx.changed()
    }
    const r = await this.ctx.run('tier:' + t.key, (idem) => this.ctx.api.saveTier(t.key, b.value, { idempotencyKey: idem }), {
      // the board's member badges take the tier's name and colour
      invalidate: [
        ['ops', 'snapshot'],
        ['ops', 'file'],
      ],
    })
    if (!r.ok) {
      if (r.message) this.errors[t.key] = r.message
      return this.ctx.changed()
    }
    this.drafts.drop(t.key)
    delete this.errors[t.key]
    this.ctx.flash('Saved the ' + r.data.name + ' tier')
  }

  /** Swaps the order with the neighbour: each tier is re-sent whole from the copy on screen with its new order. */
  private async moveTier(tiers: TierItem[], i: number, dir: 1 | -1): Promise<void> {
    const j = i + dir
    if (j < 0 || j >= tiers.length || !this.ctx.allowed()) return
    const a = tiers[i]!
    const b = tiers[j]!
    const sa = a.sort === b.sort ? (i + 1) * 10 : a.sort
    const sb = a.sort === b.sort ? (j + 1) * 10 : b.sort
    const put = async (t: TierItem, sort: number) => {
      const r = await this.ctx.run(
        'tier:' + t.key,
        (idem) => this.ctx.api.saveTier(t.key, tierBodyOf(t, { sort }), { idempotencyKey: idem }),
        { staleMessage: STALE_ACTION_MESSAGE },
      )
      if (!r.ok && r.message) {
        this.errors[t.key] = r.message
        this.ctx.changed()
      }
      return r.ok
    }
    if (await put(a, sb)) await put(b, sa)
  }

  private async removeTier(t: TierItem): Promise<void> {
    if (!this.ctx.allowed() || t.sold) return
    const r = await this.ctx.run(
      'tier:' + t.key,
      (idem) => this.ctx.api.deleteTier(t.key, t.version, { idempotencyKey: idem }),
      {
        staleMessage: STALE_ACTION_MESSAGE,
        explain: (e) =>
          e.code === 'TIER_IN_USE' ? t.name + ' has been sold, so it can’t be removed. Turn it off instead.' : null,
      },
    )
    if (!r.ok) {
      if (r.message) this.errors[t.key] = r.message
      return this.ctx.changed()
    }
    this.drafts.drop(t.key)
    this.prices.drop(t.key)
    if (this.selKey === t.key) this.selKey = null
    this.ctx.flash('Removed the ' + t.name + ' tier')
  }

  private async createTier(tiers: TierItem[]): Promise<void> {
    const a = this.adding
    if (!a || !this.ctx.allowed()) return
    const key = tierKeyFromName(a.name)
    const problem = newTierProblem(a.name, a.colour, key, tiers)
    if (problem) {
      this.addError = problem
      return this.ctx.changed()
    }
    const r = await this.ctx.run('tier:new', (idem) =>
      this.ctx.api.createTier(newTierBody(key, a.name, a.colour, tiers), { idempotencyKey: idem }),
    )
    if (!r.ok) {
      if (r.message) this.addError = r.message
      return this.ctx.changed()
    }
    this.adding = null
    this.addError = ''
    this.selKey = r.data.key
    this.ctx.flash('Added the ' + r.data.name + ' tier · set what it includes and its prices')
  }

  // ---- the monthly price grid -----------------------------------------------------------------------------------------

  private gridVals(c: CatalogRes, tiers: TierItem[]): Vals {
    // drafts cover every size, on or off; the grid shows the sizes that are on (DV-324, as Prices by size)
    const all = sortSizes(c.vehicleClasses as VehicleClassItem[])
    const active = all.filter((s) => s.active)
    let dirtyRows = 0
    const conflict = this.conflictTier
    const rows = tiers.map((t) => {
      const base = tierPriceDraft(t, all)
      const entry = this.prices.get(t.key, base, t.priceVersion)
      // a draft made before a size existed has no box for it: that size shows the server's copy
      const d = { ...base, ...(entry?.value ?? {}) }
      if (entry) dirtyRows++
      const subs = ['Price version ' + t.priceVersion]
      if (!t.active) subs.push('off')
      if (entry) subs.push(entry.conflict || conflict === t.key ? 'changed meanwhile' : 'unsaved')
      const hidden = entry ? offChangesText(offSizeChanges(entry.value, base, all)) : ''
      if (hidden) subs.push(hidden)
      return {
        name: t.name,
        swatch: swatchStyle(t.colour, 10),
        sub: subs.join(' · '),
        style: gridColumns(active.length),
        cells: active.map((s) => {
          const changed = (d[s.key] ?? '').trim() !== (base[s.key] ?? '').trim()
          const p = t.prices.find((x) => x.class === s.key)
          return {
            value: d[s.key] ?? '',
            set: (e: InputEvent) => {
              if (!this.ctx.allowed()) return
              const cur = { ...base, ...this.prices.value(t.key, base, t.priceVersion) }
              this.prices.set(t.key, base, t.priceVersion, { ...cur, [s.key]: e.target.value })
              this.priceError = ''
              this.ctx.changed()
            },
            style: cellInputStyle(changed, changed && (!!entry?.conflict || conflict === t.key)),
            // DV-909: the state the catalog sync keeps, with its last problem in the cell's tooltip
            state: p ? priceSquareText(p.squareState, p.squareError).text : 'No price',
            stateStyle: stateStyle(p ? priceSquareText(p.squareState, p.squareError).tone : 'ink'),
            stateTitle: p?.squareError ?? '',
            label: t.name + ' · ' + s.label,
          }
        }),
      }
    })
    const busy = this.ctx.busy('tier-prices')
    const dirty = dirtyRows > 0
    const anyConflict = tiers.some((t) => this.prices.get(t.key, tierPriceDraft(t, all), t.priceVersion)?.conflict)
    const err = this.priceError || (anyConflict ? CONFLICT_MESSAGE : '')
    return {
      note: 'Whole dollars a month per plan size. Changing a price starts a new price version: members keep the price they joined at until you use “Move members”. Each price shows whether Square has it.',
      heads: active.map((s) => ({ label: s.label })),
      headStyle: gridColumns(active.length),
      rows,
      noSizes: active.length === 0,
      hasError: !!err,
      error: err,
      dirty,
      dirtyText: dirtyRows === 1 ? '1 tier changed' : dirtyRows + ' tiers changed',
      saveStyle: saveButtonStyle(dirty && !busy),
      saveLabel: busy ? 'Saving…' : 'Save monthly prices',
      save: () => void this.saveGrid(c, tiers),
      discard: () => {
        for (const t of tiers) this.prices.drop(t.key)
        this.priceError = ''
        this.conflictTier = null
        this.ctx.changed()
      },
    }
  }

  private async saveGrid(c: CatalogRes, tiers: TierItem[]): Promise<void> {
    if (!this.ctx.allowed()) return
    // a change at a size turned off meanwhile is sent too (the row says so); a size the draft never had is left alone
    const all = sortSizes(c.vehicleClasses as VehicleClassItem[])
    const rows: { tierKey: string; priceVersion: number; cells: { class: string; monthlyCents: number | null }[] }[] = []
    for (const t of tiers) {
      const base = tierPriceDraft(t, all)
      const e = this.prices.get(t.key, base, t.priceVersion)
      if (!e) continue
      const cells = changedTierCells(e.value, base, all, t.name)
      if (!cells.ok) {
        this.priceError = cells.message
        return this.ctx.changed()
      }
      if (cells.value.length) rows.push({ tierKey: t.key, priceVersion: e.version, cells: cells.value })
    }
    if (!rows.length) return
    const r = await this.ctx.run(
      'tier-prices',
      (idem) => this.ctx.api.saveTierPrices({ rows }, { idempotencyKey: idem }),
      {
        explain: (e) => {
          if (e.status !== 412) return null
          const key = e.meta.tierKey ?? (typeof e.meta.row === 'number' ? rows[e.meta.row]?.tierKey : undefined)
          this.conflictTier = typeof key === 'string' ? key : null
          return staleTierMessage(tiers.find((t) => t.key === key)?.name ?? null)
        },
      },
    )
    if (!r.ok) {
      if (r.message) this.priceError = r.message
      return this.ctx.changed()
    }
    for (const row of rows) this.prices.drop(row.tierKey)
    this.priceError = ''
    this.conflictTier = null
    const n = r.data.changed.length
    this.ctx.flash('Monthly prices saved · ' + (n === 1 ? '1 tier' : n + ' tiers') + ' · members keep the price they joined at')
  }
}
