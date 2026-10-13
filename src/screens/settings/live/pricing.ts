// Settings → Vehicle sizes and Prices by size, with the booking fee (live variant only; ADR 0170, backend api-spec 15.9 and
// 15.10; DEVIATIONS DV-322, DV-323, DV-325). Both read GET /catalog (SettingsExtras' one read) and keep their own drafts:
//   - sizes: a rename is a draft per size (Save / Discard); order, on/off and remove are sent at once on the copy on
//     screen; a new size gets its key from its name; a size in use cannot be removed (409 CLASS_IN_USE, said with what
//     uses it).
//   - prices: one draft per service row (whole dollars per size, tint rows "from–to"), rebased on a newer copy like the
//     other drafts; one Save sends every changed row with its service's version (PUT /catalog/prices, all or nothing);
//     a 412 names the row someone else changed, the copy is read again and the drafts are rebased on it.
//   - the booking fee guests pay toward the visit: amount and how it is collected (PUT /catalog/guest-fee + version).
import { qk } from '@/data/query'
import type { CatalogRes } from '@/data/ports/settings-api'
import { categoryLabel, swatchStyle } from '@/lib/categories'
import type { CatalogCategoryItem, CatalogItem } from '@/lib/settings/catalog'
import { CONFLICT_MESSAGE, DraftSet, STALE_ACTION_MESSAGE, STALE_DRAFT_MESSAGE } from '@/lib/settings/drafts'
import {
  SIZE_LIMITS,
  changedCells,
  emptyCells,
  feeBody,
  feeDraft,
  isRangeRow,
  notSetText,
  offChangesText,
  offSizeChanges,
  rowDraft,
  sizeInUseMessage,
  sizeKeyFromLabel,
  sizeProblem,
  sortSizes,
  staleRowMessage,
  wholeMoney,
} from '@/lib/settings/sizes'
import type { FeeDraft, GuestFeeView, PriceRowItem, RowDraft, SentCell, VehicleClassItem } from '@/lib/settings/sizes'
import { cellDot, rowSquareText } from '@/lib/settings/square-items'
import { seg, sw } from '@/lib/settings/styles'
import { cellInputStyle, formError, gridColumns, gridRowStyle, saveButtonStyle } from './ui'
import type { InputEvent, KeyEvent, SectionCtx, Vals } from './ui'

const SERVICES = qk.settings('services')

const sameRow = (a: RowDraft, b: RowDraft): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    const x = a[k] ?? { from: '', to: '' }
    const y = b[k] ?? { from: '', to: '' }
    if (x.from.trim() !== y.from.trim() || x.to.trim() !== y.to.trim()) return false
  }
  return true
}

export class PricingSections {
  // sizes
  private readonly names = new DraftSet<string>((a, b) => a.trim() === b.trim())
  private sizeErrors: Record<string, string> = {}
  private adding: string | null = null
  private addError = ''
  // prices
  private readonly rows = new DraftSet<RowDraft>(sameRow)
  private priceError = ''
  private conflictRow: string | null = null
  /** The service "Edit prices" was pressed for in Catalog: its row is outlined. */
  focus: string | null = null
  // the booking fee
  private readonly fee = new DraftSet<FeeDraft>()
  private feeError = ''

  constructor(private readonly ctx: SectionCtx) {}

  private sizes(c: CatalogRes): VehicleClassItem[] {
    return sortSizes(c.vehicleClasses as VehicleClassItem[])
  }

  // ---- Vehicle sizes --------------------------------------------------------------------------------------------------

  sizesVals(c: CatalogRes | undefined): Vals {
    const add = this.adding
    const all = c ? this.sizes(c) : []
    const addKey = add !== null ? sizeKeyFromLabel(add) : ''
    const addVals: Vals = {
      open: add !== null,
      start: () => {
        if (!this.ctx.allowed()) return
        this.adding = ''
        this.addError = ''
        this.ctx.changed()
      },
      cancel: () => {
        this.adding = null
        this.addError = ''
        this.ctx.changed()
      },
      label: add ?? '',
      setLabel: (e: InputEvent) => {
        if (this.adding === null) return
        this.adding = e.target.value
        this.addError = ''
        this.ctx.changed()
      },
      onKey: (e: KeyEvent) => {
        if (e.key === 'Enter' && c) void this.createSize(all)
      },
      keyLine: addKey ? 'Key: ' + addKey + ' (set once, never changes)' : 'The key is made from the name.',
      hasError: !!this.addError,
      error: this.addError,
      saveLabel: this.ctx.busy('size:new') ? 'Adding…' : 'Add size',
      save: () => void this.createSize(all),
      canAdd: !!c && all.length < SIZE_LIMITS.sizes && add === null,
    }
    if (!c) return { rows: [], add: addVals, note: '' }
    const prices = c.prices as PriceRowItem[]
    const rows = all.map((x, i) => {
      const entry = this.names.get(x.key, x.label, x.version)
      const label = entry?.value ?? x.label
      const dirty = !!entry
      const busy = this.ctx.busy('size:' + x.key)
      const err = formError(this.sizeErrors[x.key] ?? '', entry)
      const priced = prices.filter((r) => r.cells.some((cell) => cell.class === x.key)).length
      const w = sw(x.active)
      return {
        key: x.key,
        label,
        setLabel: (e: InputEvent) => {
          if (!this.ctx.allowed()) return
          this.names.set(x.key, x.label, x.version, e.target.value)
          delete this.sizeErrors[x.key]
          this.ctx.changed()
        },
        onKey: (e: KeyEvent) => {
          if (e.key === 'Enter') void this.renameSize(x, all)
        },
        keyLine:
          'Key ' +
          x.key +
          ' · ' +
          (priced === 1 ? '1 service priced' : priced + ' services priced') +
          (x.active ? '' : ' · off: not offered, its prices are kept'),
        track: w.track,
        knob: w.knob,
        toggle: () => void this.patchSize(x, { active: !x.active }),
        up: () => void this.moveSize(all, i, -1),
        down: () => void this.moveSize(all, i, 1),
        remove: () => void this.removeSize(x),
        dirty,
        saveStyle: saveButtonStyle(dirty && !busy),
        saveLabel: busy ? 'Saving…' : 'Save',
        save: () => void this.renameSize(x, all),
        discard: () => {
          this.names.drop(x.key)
          delete this.sizeErrors[x.key]
          this.ctx.changed()
        },
        hasError: !!err,
        error: err,
      }
    })
    return {
      rows,
      add: addVals,
      note:
        'Every service has one price per size (set them in Prices by size). Smallest first: the website lists them in this order. A size that is off is not offered; its prices are kept. A size in use can be turned off but not removed.',
    }
  }

  private async renameSize(x: VehicleClassItem, all: VehicleClassItem[]): Promise<void> {
    const e = this.names.get(x.key, x.label, x.version)
    if (!e) return
    const problem = sizeProblem(e.value, null, all, x.key)
    if (problem) {
      this.sizeErrors[x.key] = problem
      return this.ctx.changed()
    }
    const label = e.value.trim()
    if (await this.patchSize(x, { label }, e.version, STALE_DRAFT_MESSAGE)) {
      this.names.drop(x.key)
      this.ctx.flash('Saved ' + label)
    }
  }

  /** One size change; on/off and order go at once on the copy on screen, a rename with its draft's version. */
  private async patchSize(
    x: VehicleClassItem,
    patch: { label?: string; active?: boolean; sort?: number },
    version: number = x.version,
    staleMessage: string = STALE_ACTION_MESSAGE,
  ): Promise<boolean> {
    if (!this.ctx.allowed()) return false
    const r = await this.ctx.run(
      'size:' + x.key,
      (idem) => this.ctx.api.updateVehicleClass(x.key, { ...patch, version }, { idempotencyKey: idem }),
      { invalidate: [SERVICES], staleMessage },
    )
    if (!r.ok) {
      if (r.message) this.sizeErrors[x.key] = r.message
      this.ctx.changed()
      return false
    }
    delete this.sizeErrors[x.key]
    if (patch.active !== undefined)
      this.ctx.flash(r.data.label + (r.data.active ? ' is on' : ' is off · not offered, its prices are kept'))
    return true
  }

  /** Swaps the order with the neighbour (two saves; equal orders are spread first). */
  private async moveSize(all: VehicleClassItem[], i: number, dir: 1 | -1): Promise<void> {
    const j = i + dir
    if (j < 0 || j >= all.length || !this.ctx.allowed()) return
    const a = all[i]!
    const b = all[j]!
    const sa = a.sort === b.sort ? (i + 1) * 10 : a.sort
    const sb = a.sort === b.sort ? (j + 1) * 10 : b.sort
    if (await this.patchSize(a, { sort: sb })) await this.patchSize(b, { sort: sa })
  }

  private async removeSize(x: VehicleClassItem): Promise<void> {
    if (!this.ctx.allowed()) return
    const r = await this.ctx.run(
      'size:' + x.key,
      (idem) => this.ctx.api.deleteVehicleClass(x.key, x.version, { idempotencyKey: idem }),
      {
        staleMessage: STALE_ACTION_MESSAGE,
        explain: (e) => (e.code === 'CLASS_IN_USE' ? sizeInUseMessage(x.label, e.meta) : null),
      },
    )
    if (!r.ok) {
      if (r.message) this.sizeErrors[x.key] = r.message
      return this.ctx.changed()
    }
    this.names.drop(x.key)
    delete this.sizeErrors[x.key]
    this.ctx.flash('Removed ' + x.label)
  }

  private async createSize(all: VehicleClassItem[]): Promise<void> {
    const label = this.adding
    if (label === null || !this.ctx.allowed()) return
    const key = sizeKeyFromLabel(label)
    const problem = sizeProblem(label, key, all)
    if (problem) {
      this.addError = problem
      return this.ctx.changed()
    }
    const sort = all.reduce((m, s) => Math.max(m, s.sort), 0) + 10
    const r = await this.ctx.run('size:new', (idem) =>
      this.ctx.api.createVehicleClass({ key, label: label.trim(), sort }, { idempotencyKey: idem }),
    )
    if (!r.ok) {
      if (r.message) this.addError = r.message
      return this.ctx.changed()
    }
    this.adding = null
    this.addError = ''
    this.ctx.flash('Added ' + r.data.label + ' · set its prices in Prices by size')
  }

  // ---- Prices by size -----------------------------------------------------------------------------------------------------

  /** The services of the grid, grouped by category in category order (packages, then add-ons, by their order). */
  private groups(c: CatalogRes): { cat: CatalogCategoryItem | null; key: string; services: CatalogItem[] }[] {
    const cats = [...(c.categories as CatalogCategoryItem[])].sort((a, b) => a.sort - b.sort)
    const services = [...(c.packages as CatalogItem[]), ...(c.addons as CatalogItem[])]
    const order = (s: CatalogItem) => (s.kind === 'package' ? 0 : 1)
    const by = (a: CatalogItem, b: CatalogItem) =>
      order(a) - order(b) || a.sort - b.sort || a.name.localeCompare(b.name)
    const out: { cat: CatalogCategoryItem | null; key: string; services: CatalogItem[] }[] = cats
      .map((cat) => ({ cat, key: cat.key, services: services.filter((s) => s.category === cat.key).sort(by) }))
      .filter((g) => g.services.length)
    const rest = services.filter((s) => !cats.some((x) => x.key === s.category)).sort(by)
    if (rest.length) out.push({ cat: null, key: '_other', services: rest })
    return out
  }

  /** The server's copy of a row over every size, on or off (a draft keeps the prices of hidden sizes; DV-323). */
  private base(row: PriceRowItem | undefined, all: VehicleClassItem[]): RowDraft {
    return rowDraft(row, all)
  }

  pricesVals(c: CatalogRes | undefined): Vals {
    const empty: Vals = {
      note: '',
      heads: [],
      headStyle: gridColumns(0),
      groups: [],
      noSizes: false,
      hasMissing: false,
      missing: '',
      dirty: false,
      fee: {},
    }
    if (!c) return empty
    const all = this.sizes(c)
    const active = all.filter((s) => s.active)
    const prices = c.prices as PriceRowItem[]
    let missing = 0
    let dirtyRows = 0
    const conflict = this.conflictRow
    const groups = this.groups(c).map((g) => ({
      label: g.cat ? g.cat.label + (g.cat.active ? '' : ' (off)') : categoryLabel(g.key, []),
      swatch: swatchStyle(g.cat?.colour ?? null),
      rows: g.services.map((s) => {
        const row = prices.find((r) => r.serviceId === s.id)
        const version = row?.version ?? s.version
        const base = this.base(row, all)
        const entry = this.rows.get(s.id, base, version)
        // a draft made before a size existed has no box for it: that size shows the server's copy
        const d = { ...base, ...(entry?.value ?? {}) }
        if (entry) dirtyRows++
        if (!s.quoteOnly) missing += emptyCells(d, active)
        const range = isRangeRow(s.category, row)
        const name = s.publicName || s.name
        const set = (k: string, field: 'from' | 'to') => (e: InputEvent) => {
          if (!this.ctx.allowed()) return
          const cur = { ...base, ...this.rows.value(s.id, base, version) }
          this.rows.set(s.id, base, version, { ...cur, [k]: { ...(cur[k] ?? { from: '', to: '' }), [field]: e.target.value } })
          this.priceError = ''
          this.ctx.changed()
        }
        const subs = [s.kind === 'package' ? 'Package' : 'Add-on']
        if (s.quoteOnly) subs.push('quote only: no price online')
        else if (row && row.cells.some((x) => active.some((a) => a.key === x.class)))
          subs.push('from ' + wholeMoney(row.fromCents))
        if (range) subs.push('from–to')
        // DV-912: the service's Square item, only while the item sync is on (the server sends nothing otherwise); a quote-only
        // service is never sold in Square, and its line already says why
        const sq = s.quoteOnly && row?.square?.state === 'not_sold' ? '' : rowSquareText(row?.square)
        if (sq) subs.push(sq)
        if (entry) subs.push(entry.conflict || conflict === s.id ? 'changed meanwhile' : 'unsaved')
        const hidden = entry ? offChangesText(offSizeChanges(entry.value, base, all)) : ''
        if (hidden) subs.push(hidden)
        return {
          name,
          sub: subs.join(' · '),
          style: gridRowStyle(active.length, this.focus === s.id),
          cells: active.map((a) => {
            const v = d[a.key] ?? { from: '', to: '' }
            const b = base[a.key] ?? { from: '', to: '' }
            const changed = v.from.trim() !== b.from.trim() || v.to.trim() !== b.to.trim()
            const cs = cellInputStyle(changed, changed && (!!entry?.conflict || conflict === s.id))
            const dot = cellDot(row?.square, a.key)
            return {
              range,
              single: !range,
              from: v.from,
              setFrom: set(a.key, 'from'),
              to: v.to,
              setTo: set(a.key, 'to'),
              style: cs,
              label: name + ' · ' + a.label,
              toLabel: name + ' · ' + a.label + ' (up to)',
              // DV-912: where this price stands in Square (the error as the tooltip of a failed one)
              hasDot: !!dot,
              dotTitle: dot?.title ?? '',
              // in the cell's top right corner, over the box: the columns keep their widths with or without a dot
              dotStyle: {
                position: 'absolute',
                top: '5px',
                right: '5px',
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: dot?.colour ?? 'transparent',
              },
            }
          }),
        }
      }),
    }))
    const busy = this.ctx.busy('prices')
    const dirty = dirtyRows > 0
    const err = this.priceError || (this.anyConflict(c, all) ? CONFLICT_MESSAGE : '')
    return {
      note:
        'One regular price per service and size, in whole dollars. Empty (—) means not set: online it shows only the sizes with a price, and a visit at an empty size is booked at the starting price and confirmed at the shop. Member prices are worked out from each tier’s % off (Memberships).',
      heads: active.map((a) => ({ label: a.label })),
      headStyle: gridColumns(active.length),
      groups,
      noSizes: active.length === 0,
      hasMissing: missing > 0,
      missing: notSetText(missing),
      hasError: !!err,
      error: err,
      dirty,
      dirtyText: dirtyRows === 1 ? '1 service changed' : dirtyRows + ' services changed',
      saveStyle: saveButtonStyle(dirty && !busy),
      saveLabel: busy ? 'Saving…' : 'Save prices',
      save: () => void this.savePrices(c),
      discard: () => {
        for (const s of [...c.packages, ...c.addons]) this.rows.drop(s.id)
        this.priceError = ''
        this.conflictRow = null
        this.ctx.changed()
      },
      fee: this.feeVals(c.guestFee as GuestFeeView),
    }
  }

  private anyConflict(c: CatalogRes, all: VehicleClassItem[]): boolean {
    return (c.prices as PriceRowItem[]).some((r) => this.rows.get(r.serviceId, this.base(r, all), r.version)?.conflict)
  }

  /**
   * Every changed row, checked; the first problem (naming the service and size) stops the save before it is sent. A
   * change at a size turned off meanwhile is sent too (the row says so); a size the draft never had is left alone.
   */
  private async savePrices(c: CatalogRes): Promise<void> {
    if (!this.ctx.allowed()) return
    const all = this.sizes(c)
    const prices = c.prices as PriceRowItem[]
    const services = [...(c.packages as CatalogItem[]), ...(c.addons as CatalogItem[])]
    const rows: { serviceId: string; version: number; cells: SentCell[] }[] = []
    for (const s of services) {
      const row = prices.find((r) => r.serviceId === s.id)
      const base = this.base(row, all)
      const entry = this.rows.get(s.id, base, row?.version ?? s.version)
      if (!entry) continue
      const cells = changedCells(entry.value, base, all, s.publicName || s.name, row)
      if (!cells.ok) {
        this.priceError = cells.message
        return this.ctx.changed()
      }
      if (cells.value.length) rows.push({ serviceId: s.id, version: entry.version, cells: cells.value })
    }
    if (!rows.length) return
    const nameOf = (id: unknown): string | null => {
      const s = services.find((x) => x.id === id)
      return s ? s.publicName || s.name : null
    }
    const r = await this.ctx.run(
      'prices',
      (idem) => this.ctx.api.savePrices({ rows }, { idempotencyKey: idem }),
      {
        invalidate: [SERVICES],
        explain: (e) => {
          if (e.status !== 412 && e.status !== 404) return null
          const id = e.meta.serviceId ?? (typeof e.meta.row === 'number' ? rows[e.meta.row]?.serviceId : undefined)
          this.conflictRow = typeof id === 'string' ? id : null
          return e.status === 412
            ? staleRowMessage(nameOf(id))
            : (nameOf(id) ?? 'A service') + ' is no longer in the catalog, so nothing was saved. Discard its row and save again.'
        },
      },
    )
    if (!r.ok) {
      if (r.message) this.priceError = r.message
      return this.ctx.changed()
    }
    for (const row of rows) this.rows.drop(row.serviceId)
    this.priceError = ''
    this.conflictRow = null
    const n = r.data.rows.filter((x) => x.changed).length
    this.ctx.flash(
      'Prices saved · ' +
        (n === 1 ? '1 service' : n + ' services') +
        (r.data.missingPrices ? ' · ' + notSetText(r.data.missingPrices) : ''),
    )
  }

  // ---- the booking fee ----------------------------------------------------------------------------------------------------

  private feeVals(f: GuestFeeView): Vals {
    const base = feeDraft(f)
    const entry = this.fee.get('fee', base, f.version)
    const d = entry?.value ?? base
    const dirty = !!entry
    const busy = this.ctx.busy('fee')
    const err = formError(this.feeError, entry)
    const edit = (patch: Partial<FeeDraft>) => {
      if (!this.ctx.allowed()) return
      this.fee.set('fee', base, f.version, { ...this.fee.value('fee', base, f.version), ...patch })
      this.feeError = ''
      this.ctx.changed()
    }
    const how: [FeeDraft['collect'], string][] = [
      ['counter', 'At the counter'],
      ['link', 'By payment link'],
    ]
    return {
      amount: d.amount,
      setAmount: (e: InputEvent) => edit({ amount: e.target.value }),
      opts: how.map(([k, label]) => ({ label, style: seg(d.collect === k), onClick: () => edit({ collect: k }) })),
      sub: 'What a guest pays toward the visit when booking online. Members pay none. It is settled by the cancel and no-show rules.',
      hasError: !!err,
      error: err,
      dirty,
      saveStyle: saveButtonStyle(dirty && !busy),
      saveLabel: busy ? 'Saving…' : 'Save fee',
      save: () => void this.saveFee(f),
      discard: () => {
        this.fee.drop('fee')
        this.feeError = ''
        this.ctx.changed()
      },
    }
  }

  private async saveFee(f: GuestFeeView): Promise<void> {
    if (!this.ctx.allowed()) return
    const e = this.fee.get('fee', feeDraft(f), f.version)
    if (!e) return
    const b = feeBody(e.value, e.version)
    if (!b.ok) {
      this.feeError = b.message
      return this.ctx.changed()
    }
    const r = await this.ctx.run('fee', (idem) => this.ctx.api.saveGuestFee(b.value, { idempotencyKey: idem }))
    if (!r.ok) {
      if (r.message) this.feeError = r.message
      return this.ctx.changed()
    }
    this.fee.drop('fee')
    this.feeError = ''
    this.ctx.flash(
      'Booking fee saved · ' +
        (r.data.cents ? wholeMoney(r.data.cents) : 'none') +
        (r.data.collect === 'link' ? ', by payment link' : ', at the counter'),
    )
  }
}
