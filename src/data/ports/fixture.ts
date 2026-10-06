// FixtureDataPort: deterministic, in-memory data from the designs' own fixtures, for the regions whose data is static
// (catalog, hours, closures, emergency, calendar summary, availability). The verbatim logic classes still carry the
// rest of their fixtures inside the class (the parity oracle), so the other regions throw PortUnavailableError
// instead of inventing numbers. Mutations edit the in-memory copy so a screen wired to ports behaves end to end.
import { dayInfo } from '@/lib/dates'
import { dayCount } from '@/lib/calendar'
import { addDays, diffDays } from '@/lib/tz'
import type { DataPort } from './ports'
import { PortUnavailableError } from './ports'
import { DESIGN_SLOTS, fixtureClosures, fixtureHoursDays, fixtureServices } from './fixtures'
import type { CalendarDay, ClosureItem, EmergencyState, HoursSettings } from './types'

export interface FixtureOptions {
  /** The business date the fixture treats as today (the design freezes Saturday 2026-06-13). */
  today?: string
  /** Appointments the Operations fixture has today; the calendar shows this count for today. */
  todayCount?: number
}

const clone = <T>(v: T): T => structuredClone(v)

export function createFixtureDataPort(opts: FixtureOptions = {}): DataPort {
  const today = opts.today ?? '2026-06-13'
  const todayCount = opts.todayCount ?? 11
  const catalog = fixtureServices()
  let hours: HoursSettings = {
    days: fixtureHoursDays(),
    rules: { slot: 30, buffer: 10, cutoff: 60 },
    version: 1,
  }
  let closures: ClosureItem[] = fixtureClosures()
  let emergency: EmergencyState = { active: false }
  let nextId = 1

  const hoursByWeekday = () => hours.days.slice().sort((a, b) => a.weekday - b.weekday)
  const info = (date: string) => {
    const [y, m, d] = date.split('-').map(Number) as [number, number, number]
    return dayInfo(new Date(y, m - 1, d), closures, hoursByWeekday())
  }
  const unavailable = (region: string): never => {
    throw new PortUnavailableError(region, 'fixture')
  }

  return {
    kind: 'fixture',
    catalog: {
      services: async () => clone(catalog),
      async saveChecklist(serviceId, tasks) {
        const s = [...catalog.packages, ...catalog.addons].find((x) => x.id === serviceId)
        if (!s) throw new Error(`unknown service ${serviceId}`)
        s.tasks = tasks
          .map((t) => ({ id: t.id ?? `fx-task-new-${nextId++}`, label: t.label.trim() }))
          .filter((t) => t.label !== '')
        s.version += 1
        return clone(s)
      },
    },
    hours: {
      hours: async () => clone(hours),
      async saveHours(next) {
        hours = { ...clone(next), version: hours.version + 1 }
        return clone(hours)
      },
      async closures(range) {
        return clone(
          closures.filter(
            (c) => (!range?.from || c.date >= range.from) && (!range?.to || c.date <= range.to),
          ),
        )
      },
      previewClosure: async () => ({ affected: 0 }),
      async createClosure(input) {
        const c: ClosureItem = {
          id: `fx-closure-new-${nextId++}`,
          source: 'manual',
          notify: !!input.notify,
          affectedCount: 0,
          name: input.name ?? 'Closure',
          ...input,
        }
        closures = [...closures, c].sort((a, b) => a.date.localeCompare(b.date))
        return clone(c)
      },
      async deleteClosure(id) {
        closures = closures.filter((c) => c.id !== id)
      },
    },
    emergency: {
      current: async () => clone(emergency),
      preview: async () => ({ count: 0, affected: [], renderedMessage: '' }),
      async close(input) {
        emergency = {
          active: true,
          reason: input.reason,
          dur: input.dur,
          until: input.until,
          through: input.through,
          startedAt: undefined,
          notified: { queued: 0, sent: 0, failed: 0 },
        }
        return clone(emergency)
      },
      async reopen() {
        emergency = { active: false }
        return clone(emergency)
      },
    },
    calendar: {
      async summary(from, to) {
        const out: CalendarDay[] = []
        for (let d = from; d <= to; d = addDays(d, 1)) {
          const inf = info(d)
          const off = diffDays(today, d)
          if (inf.closed !== undefined) {
            out.push({ date: d, count: 0, closed: inf.closed })
            continue
          }
          const n = off === 0 ? todayCount : dayCount(off, !!inf.note).n
          out.push({ date: d, count: n, reduced: !!inf.note, open: { from: inf.from, to: inf.to } })
        }
        return out
      },
      async day(date) {
        const inf = info(date)
        return {
          date,
          dayInfo:
            inf.closed !== undefined
              ? { closed: inf.closed }
              : { from: inf.from, to: inf.to, note: inf.note },
          appointments: [],
          outsideHours: [],
        }
      },
    },
    availability: {
      async slots() {
        return DESIGN_SLOTS.times.map((time) => ({
          time,
          state: (DESIGN_SLOTS.blocked as readonly string[]).includes(time)
            ? ('blocked' as const)
            : (DESIGN_SLOTS.vipHeld as readonly string[]).includes(time)
              ? ('vip_held' as const)
              : ('available' as const),
        }))
      },
    },
    ops: {
      snapshot: async () => unavailable('ops.snapshot'),
      appointment: async () => unavailable('ops.appointment'),
      advance: async () => unavailable('ops.advance'),
      assignBay: async () => unavailable('ops.assignBay'),
      toggleChecklistItem: async () => unavailable('ops.toggleChecklistItem'),
      toggleAddon: async () => unavailable('ops.toggleAddon'),
      reschedule: async () => unavailable('ops.reschedule'),
    },
    messages: {
      thread: async () => unavailable('messages.thread'),
      send: async () => unavailable('messages.send'),
    },
    payments: {
      summary: async () => unavailable('payments.summary'),
      invoices: async () => unavailable('payments.invoices'),
      invoicePage: async () => unavailable('payments.invoicePage'),
      invoice: async () => unavailable('payments.invoice'),
      collect: async () => unavailable('payments.collect'),
      applyCredit: async () => unavailable('payments.applyCredit'),
      refund: async () => unavailable('payments.refund'),
      approveRefund: async () => unavailable('payments.approveRefund'),
      denyRefund: async () => unavailable('payments.denyRefund'),
      adjust: async () => unavailable('payments.adjust'),
      issueCredit: async () => unavailable('payments.issueCredit'),
      voidPayment: async () => unavailable('payments.voidPayment'),
      sendReceipt: async () => unavailable('payments.sendReceipt'),
      confirmProcessor: async () => unavailable('payments.confirmProcessor'),
      exportCsv: async () => unavailable('payments.exportCsv'),
    },
    people: {
      employees: async () => unavailable('people.employees'),
      roles: async () => unavailable('people.roles'),
      setRolePermission: async () => unavailable('people.setRolePermission'),
      setRoleLimit: async () => unavailable('people.setRoleLimit'),
    },
  }
}
