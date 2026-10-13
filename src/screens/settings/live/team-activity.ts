// Settings → Shop floor → Team activity (live variant only; ADR 0180, design 5 and 6.6, api-spec 31.4; DEVIATIONS DV-1011).
// Per employee for a date range (Today, Yesterday, This week, Last week or Custom, at most 31 days): checked in, in bay,
// finished, picked up, average bay time, payments (count, and the amount with "View payment reports"), texts and
// bookings. Selecting a row shows that person's days, the cars they touched with each step and who did it, and their
// timeline with a Kiosk / Signed-in tag (paged). Reads only: GET /reports/employee-activity (team.edit) and
// .../:employeeId/events. Until the backend builds the report it answers 501 NOT_BUILT, which the section says plainly.
import type { QueryKey } from '@tanstack/react-query'
import { qk } from '@/data/query'
import type { QueryStore } from '@/data/query-store'
import { ApiError } from '@/data/http/problem'
import type {
  ActivityCar,
  ActivityEmployee,
  EmployeeActivity,
  EmployeeEvent,
  EmployeeEvents,
  KioskAdminApi,
} from '@/data/ports/kiosk-api'
import { AVATAR_COLORS } from '@/lib/settings/constants'
import {
  RANGE_CHIPS,
  STEP_WORDS,
  TOTALS_HEADINGS,
  customRangeProblem,
  dayLabel,
  minutesText,
  paymentsText,
  rangeLabel,
  rangeOf,
  stamp,
  totalsRow,
  viaLabel,
} from '@/lib/settings/kiosk'
import type { RangeKey } from '@/lib/settings/kiosk'
import { formatCents } from '@/lib/money'
import { businessClock } from '@/lib/tz'
import { chip } from '@/lib/settings/styles'
import type { InputEvent, Vals } from './ui'

/** Reading the report takes "Add & edit employees"; amounts also need "View payment reports" (the server decides). */
export const ACTIVITY_PERMISSION = 'team.edit' as const

export interface ActivityCtx {
  api: KioskAdminApi
  store: QueryStore
  changed(): void
  tz(): string
  today(): string
}

const FRESH = { staleTimeMs: 60_000 }
const noop = (): void => {}

const rowStyle = (selected: boolean) => ({
  display: 'grid',
  gridTemplateColumns: 'minmax(170px,1.6fr) repeat(8,minmax(64px,1fr))',
  gap: '8px',
  alignItems: 'center',
  padding: '10px 10px',
  margin: '0 -10px',
  borderRadius: '12px',
  textAlign: 'left',
  width: 'calc(100% + 20px)',
  background: selected ? 'var(--accentSoft)' : 'transparent',
  border: '1px solid ' + (selected ? 'var(--accentBrd)' : 'transparent'),
  color: 'var(--ink)',
})

const avatarStyle = (colour: string | null, i: number) => ({
  width: '34px',
  height: '34px',
  borderRadius: '10px',
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 800,
  fontSize: '12px',
  color: '#fff',
  background: colour || AVATAR_COLORS[i % AVATAR_COLORS.length]!,
})

const tagStyle = (kiosk: boolean) => ({
  fontSize: '10.5px',
  fontWeight: 800,
  padding: '2px 7px',
  borderRadius: '6px',
  background: kiosk ? 'var(--accentSoft)' : 'var(--panel3)',
  color: kiosk ? 'var(--accentInk)' : 'var(--ink2)',
  flex: 'none',
})

export class TeamActivitySection {
  private range: RangeKey = 'today'
  private customFrom = ''
  private customTo = ''
  private customApplied: { from: string; to: string } | null = null
  private customError = ''
  private selected: string | null = null
  /** The timeline's pages already shown, by cursor (null = the first page). */
  private pages: Array<string | null> = [null]

  constructor(private readonly ctx: ActivityCtx) {}

  private edit(fn: () => void): void {
    fn()
    this.ctx.changed()
  }

  /** The dates the report covers now. */
  dates(): { from: string; to: string } {
    if (this.range === 'custom') return this.customApplied ?? rangeOf('today', this.ctx.today())
    return rangeOf(this.range, this.ctx.today())
  }

  private key(from: string, to: string, employeeId?: string): QueryKey {
    return employeeId ? qk.settings('activity', from, to, employeeId) : qk.settings('activity', from, to)
  }

  private report(from: string, to: string): EmployeeActivity | undefined {
    return this.ctx.store.read(this.key(from, to), () => this.ctx.api.activity({ from, to }), FRESH)
  }

  private detail(from: string, to: string, employeeId: string): EmployeeActivity | undefined {
    return this.ctx.store.read(
      this.key(from, to, employeeId),
      () => this.ctx.api.activity({ from, to, employeeId }),
      FRESH,
    )
  }

  private eventsPage(employeeId: string, from: string, to: string, cursor: string | null): EmployeeEvents | undefined {
    return this.ctx.store.read(
      qk.settings('activity', 'events', employeeId, from, to, cursor ?? ''),
      () => this.ctx.api.events(employeeId, { from, to, cursor: cursor ?? undefined }),
      FRESH,
    )
  }

  /** What stands in for the section: the report's own state. */
  private state(from: string, to: string): 'ready' | 'loading' | 'notBuilt' | 'failed' {
    if (this.report(from, to)) return 'ready'
    const k = this.key(from, to)
    if (this.ctx.store.status(k) !== 'error') return 'loading'
    const e = this.ctx.store.error(k)
    return e instanceof ApiError && (e.status === 501 || e.code === 'NOT_BUILT') ? 'notBuilt' : 'failed'
  }

  private pick(key: RangeKey): void {
    this.edit(() => {
      this.range = key
      this.selected = null
      this.pages = [null]
      this.customError = ''
      if (key === 'custom' && !this.customFrom) {
        const r = rangeOf('week', this.ctx.today())
        this.customFrom = r.from
        this.customTo = r.to
      }
    })
  }

  private applyCustom(): void {
    const problem = customRangeProblem(this.customFrom, this.customTo)
    this.edit(() => {
      this.customError = problem ?? ''
      if (!problem) {
        this.customApplied = { from: this.customFrom, to: this.customTo }
        this.selected = null
        this.pages = [null]
      }
    })
  }

  vals(open: boolean): Vals {
    const today = this.ctx.today()
    const tz = this.ctx.tz()
    const { from, to } = this.dates()
    const chips = RANGE_CHIPS.map(([k, label]) => ({
      label,
      style: chip(this.range === k),
      onClick: () => this.pick(k),
    }))
    const base: Vals = {
      chips,
      custom: this.range === 'custom',
      customFrom: this.customFrom,
      customTo: this.customTo,
      setFrom: (e: InputEvent) => this.edit(() => (this.customFrom = e.target.value)),
      setTo: (e: InputEvent) => this.edit(() => (this.customTo = e.target.value)),
      applyCustom: () => this.applyCustom(),
      hasCustomError: !!this.customError,
      customError: this.customError,
      headings: TOTALS_HEADINGS.map((h) => ({ text: h })),
      rows: [],
      noRows: false,
      ready: false,
      loading: false,
      notBuilt: false,
      failed: false,
      rangeText: rangeLabel(from, to, today),
      detail: { show: false, days: [], cars: [], events: [], close: noop, more: noop },
      retry: noop,
    }
    if (!open) return base
    const st = this.state(from, to)
    const r = this.report(from, to)
    if (st !== 'ready' || !r) {
      return {
        ...base,
        loading: st === 'loading',
        notBuilt: st === 'notBuilt',
        failed: st === 'failed',
        retry: () => void this.ctx.store.refetch(this.key(from, to), () => this.ctx.api.activity({ from, to })),
      }
    }
    const rows = r.employees.map((e, i) => this.rowVals(e, i))
    const sel = this.selected ? r.employees.find((e) => e.id === this.selected) : undefined
    return {
      ...base,
      ready: true,
      rangeText: rangeLabel(r.from, r.to, today) + (r.amounts ? '' : ' · amounts need “View payment reports”'),
      rows,
      noRows: rows.length === 0,
      detail: sel ? this.detailVals(sel, from, to, today, tz) : base.detail,
    }
  }

  private rowVals(e: ActivityEmployee, i: number): Vals {
    const selected = this.selected === e.id
    return {
      name: e.name,
      sub: e.title + (e.status === 'inactive' ? ' · no longer active' : ''),
      initials: e.initials,
      avatarStyle: avatarStyle(e.avatarColor, i),
      cells: totalsRow(e.totals).map((text) => ({ text })),
      style: rowStyle(selected),
      onClick: () =>
        this.edit(() => {
          this.selected = selected ? null : e.id
          this.pages = [null]
        }),
    }
  }

  private detailVals(e: ActivityEmployee, from: string, to: string, today: string, tz: string): Vals {
    const days = e.days
      .filter((d) => d.checkIns + d.baysStarted + d.completed + d.pickedUp + d.payments.count + d.textsSent + d.bookings + d.walkIns > 0)
      .map((d) => ({ label: dayLabel(d.date, today), cells: totalsRow(d).map((text) => ({ text })) }))
    const det = this.detail(from, to, e.id)
    const cars = (det?.cars ?? []).map((c) => this.carVals(c, today, tz))
    const pages = this.pages.map((c) => this.eventsPage(e.id, from, to, c))
    const events: EmployeeEvent[] = pages.flatMap((p) => p?.items ?? [])
    const last = pages[pages.length - 1]
    return {
      show: true,
      name: e.name,
      bayTime:
        e.totals.bayMinutes.cars > 0
          ? 'Bay time ' +
            minutesText(e.totals.bayMinutes.total) +
            ' over ' +
            e.totals.bayMinutes.cars +
            (e.totals.bayMinutes.cars === 1 ? ' car' : ' cars') +
            ' · ' +
            minutesText(e.totals.bayMinutes.avg) +
            ' each'
          : 'No timed bay work in this range',
      payments: 'Payments ' + paymentsText(e.totals.payments),
      days,
      noDays: days.length === 0,
      cars,
      noCars: !!det && cars.length === 0,
      carsLoading: !det,
      events: events.map((ev) => this.eventVals(ev, today, tz)),
      noEvents: !!pages[0] && events.length === 0,
      hasMore: !!last?.nextCursor,
      more: () =>
        this.edit(() => {
          if (last?.nextCursor && !this.pages.includes(last.nextCursor)) this.pages.push(last.nextCursor)
        }),
      close: () => this.edit(() => (this.selected = null)),
    }
  }

  private carVals(c: ActivityCar, today: string, tz: string): Vals {
    return {
      title: [c.customer, c.vehicle].filter(Boolean).join(' · '),
      sub: [
        dayLabel(c.date, today),
        c.seq !== null ? '#' + c.seq : '',
        c.worker ? 'Worker ' + c.worker.name : 'No worker set',
        c.bayMinutes !== null ? 'in bay ' + minutesText(c.bayMinutes) : '',
        c.paidCents !== null ? 'paid ' + formatCents(c.paidCents) : '',
      ]
        .filter(Boolean)
        .join(' · '),
      steps: c.steps.map((s) => {
        const ms = Date.parse(s.at)
        return {
          text:
            (Number.isFinite(ms) ? businessClock(ms, tz) + ' · ' : '') + STEP_WORDS[s.kind] + ' · ' + s.by,
          tag: viaLabel(s.via),
          tagStyle: tagStyle(s.via === 'kiosk'),
        }
      }),
    }
  }

  private eventVals(ev: EmployeeEvent, today: string, tz: string): Vals {
    return {
      line: [
        stamp(ev.at, tz, today),
        STEP_WORDS[ev.kind],
        ev.customer ?? '',
        ev.amountCents !== null ? formatCents(ev.amountCents) : '',
        ev.deviceName ?? '',
      ]
        .filter(Boolean)
        .join(' · '),
      tag: viaLabel(ev.via),
      tagStyle: tagStyle(ev.via === 'kiosk'),
    }
  }
}
