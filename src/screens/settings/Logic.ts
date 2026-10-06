// Typed view model of the Settings screen: a port of the design's `class Component extends DCLogic`
// (design/extracted/settings/logic.original.js) with identical renderVals() output, key order and setState semantics in
// the fixture build. Formulas live in src/lib/settings; everything the class used to keep in localStorage, constants or
// the clock comes through SettingsData (data.ts). In the live variant the same class hydrates its working copies from
// the server's model and waits for the server's answer where the server decides (docs/screens-settings.md).
import { DCLogic } from '@/dc/DCLogic'
import type { DCLogicCtor } from '@/dc/types'
import { LIVE } from '@/data/env'
import { Action } from '@/data/command'
import { deniedTitle } from '@/auth/permissions'
import type { PermissionKey } from '@/auth/permissions'
import type { LiveChrome } from '@/auth/chrome'
import { parseT } from '@/lib/time'
import {
  ALL_PERMS,
  ALL_PERM_ITEMS,
  CADENCES,
  DAYS,
  EMERGENCY_DURATIONS,
  EMERGENCY_REASONS,
  ORDER,
  PERMS,
  SECTION_META,
  SERVICE_NOTE,
  SKILLS,
  DAY_ABBR,
  addonMeta,
  arrivalSteps,
  avatarStyle,
  blankDraft,
  chip,
  closureLabels,
  closureTagStyle,
  cloneRoles,
  confirmText,
  copyMondayToWeekdays,
  drawerFieldStyle,
  drawerTabStyle,
  effDotStyle,
  effective,
  effectiveCount,
  employeeStatusStyle,
  hourRows,
  hoursDirty,
  hoursText,
  initialsOf,
  limKey,
  limLabel,
  limitChipStyle,
  matrixBoxStyle,
  navStyle,
  newRoleParts,
  nextLimit,
  overrideButtonStyle,
  packageMeta,
  rateHint,
  roleNameOf,
  roleOptionBoxStyle,
  roleOptionStyle,
  serviceKindStyle,
  serviceRowStyle,
  seg,
  sortClosures,
  sortHolds,
  statusLabel,
  step,
  sw,
  taskOps,
  validateDraft,
  visibleEmployees,
  withLimit,
  withPermission,
  withRole,
  withoutRole,
  withoutRoleOnPeople,
} from '@/lib/settings'
import type {
  Arrival,
  Closure,
  Draft,
  Employee,
  HoursDay,
  LimitKind,
  RuleKey,
  SectionKey,
  SettingsState,
  Vip,
  VipKey,
} from '@/lib/settings'
import { settle } from './data'
import type {
  EmergencyPreview,
  MaybeAsync,
  ServerSync,
  SettingsData,
  SyncPartName,
  VipCandidate,
} from './data'

type Vals = Record<string, unknown>
type InputEvent = { target: { value: string } }
type KeyEvent = { key: string }

const TOAST_MS = 2800

/** Sections whose data comes from the server model, by the parts each one needs. */
const SECTION_PARTS: Record<SectionKey, SyncPartName[]> = {
  hours: ['hours'],
  closures: ['closures'],
  emergency: ['emergency'],
  employees: ['employees', 'roles'],
  roles: ['roles', 'employees'],
  vip: ['vip'],
  arrival: ['arrival'],
  services: ['services'],
}

/** The permission each section needs before it is shown at all (the live variant; the design gates nothing). */
const SECTION_READ: Partial<Record<SectionKey, PermissionKey>> = {
  emergency: 'set.emergency',
  employees: 'team.view',
  roles: 'team.view',
  vip: 'cli.member',
}

export class SettingsLogic extends DCLogic<SettingsState> {
  readonly data: SettingsData
  private toastTimer: ReturnType<typeof setTimeout> | undefined
  private liveOff: (() => void) | null = null
  private dataOff: (() => void) | null = null
  /** The revision of each server part the state was last hydrated from. */
  private seen: Partial<Record<SyncPartName, number>> = {}
  /** Persists in flight per part: a part is not rehydrated while its own changes are on their way. */
  private busy: Partial<Record<SyncPartName, number>> = {}
  private candidates: VipCandidate[] = []
  private closing = false
  /** One Idempotency-Key per attempt to close the shop; renewed once it succeeded. */
  private readonly closeAction = new Action()

  constructor(props: Record<string, unknown> | undefined, data: SettingsData) {
    super(props)
    this.data = data
    const seed = data.seed()
    this.state = {
      theme: seed.theme,
      section: 'hours',
      hours: seed.hours,
      savedHours: seed.savedHours,
      rules: seed.rules,
      closures: seed.closures,
      adding: false,
      nc: { date: '', name: '', type: 'closed', from: '10:00 AM', to: '2:00 PM' },
      ncError: '',
      federal: seed.federal,
      em: seed.em,
      emHistory: seed.emHistory,
      confirm: false,
      employees: seed.employees,
      empQuery: '',
      roleFilter: 'all',
      drawer: null,
      draft: null,
      drTab: 'profile',
      drError: '',
      vip: seed.vip,
      arrival: seed.arrival,
      holdDay: 6,
      holdTime: '11:00 AM',
      vipNew: '',
      rc: seed.rc,
      svcKind: 'pkg',
      svcSel: 'Premium Hand Wash + Interior',
      packages: seed.packages,
      addons: seed.addons,
      newTask: '',
      toast: null,
    }
    data.attach(() => this.state)
  }

  // helpers ------------------------------------------------------------------------------------------------------------

  flash(t: string): void {
    this.setState({ toast: t })
    clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => this.setState({ toast: null }), TOAST_MS)
  }

  parseT(s: string): number {
    return parseT(s)
  }

  step(t: string, d: number): string {
    return step(t, d)
  }

  roleName(id: string): string {
    return roleNameOf(this.state.rc, id)
  }

  /** The design gates nothing; a person who lacks the permission gets the existing-style toast and no request. */
  private allowed(key: PermissionKey): boolean {
    if (this.data.access().can(key)) return true
    this.flash(deniedTitle(key))
    return false
  }

  private chrome(): LiveChrome | null {
    return (LIVE && typeof window !== 'undefined' && window.__oasisLive) || null
  }

  /** Stores a change the state already shows. A failure (or a thrown reject) reloads the server's truth for the part. */
  private persist(part: SyncPartName, r: MaybeAsync<boolean>): void {
    if (!(r instanceof Promise)) {
      if (r === false) this.data.reload([part])
      return
    }
    this.busy[part] = (this.busy[part] ?? 0) + 1
    const done = (ok: boolean): void => {
      this.busy[part] = (this.busy[part] ?? 1) - 1
      if (!ok) this.data.reload([part])
      this.forceUpdate()
    }
    r.then(done, () => done(false))
  }

  private setRC(next: SettingsState['rc']): void {
    this.setState({ rc: next })
  }

  private setHours(fn: (h: HoursDay[]) => HoursDay[]): void {
    if (!this.allowed('set.hours')) return
    this.setState((s) => ({ hours: fn(s.hours.map((h) => ({ ...h }))) }))
  }

  private applyVip(p: Partial<Vip> & Partial<Arrival>, key?: VipKey): void {
    this.setState((s) => {
      const k = key || 'vip'
      const nv = { ...s[k], ...p }
      return { [k]: nv } as unknown as Partial<SettingsState>
    })
  }

  /** `setVip` of the design: merge into the VIP (or arrival) settings and store them. */
  private setVip(p: Partial<Vip> & Partial<Arrival>, key?: VipKey, store?: () => MaybeAsync<boolean>): void {
    if (!this.allowed('cli.member')) return
    this.applyVip(p, key)
    this.persist(key === 'arrival' ? 'arrival' : 'vip', store ? store() : this.data.saveVip(key || 'vip', p))
  }

  openEmp(e: Employee | null): void {
    this.setState({
      drawer: e ? e.id : 'new',
      drTab: 'profile',
      drError: '',
      draft: e ? (JSON.parse(JSON.stringify(e)) as Draft) : blankDraft(this.data.defaultRole()),
    })
  }

  /** Opens the drawer on a person: the list row holds a summary, the drawer needs the full record. */
  private openEmployee(e: Employee): void {
    if (!this.data.live) return this.openEmp(e)
    settle(this.data.employee(e.id), (full) => this.openEmp(full ?? e))
  }

  private setDraft(fn: (d: Draft) => Draft): void {
    this.setState((s) => ({ draft: fn({ ...s.draft! }), drError: '' }))
  }

  /** Only a person who may assign roles can change a draft's roles and exceptions (the Access tab). */
  private setAccess(fn: (d: Draft) => Draft): void {
    if (!this.allowed('team.roles')) return
    this.setDraft(fn)
  }

  // server model (live) ------------------------------------------------------------------------------------------------

  /** Copies the server's parts into the working copies when they changed and nothing of ours is on its way. */
  private hydrate(): void {
    const m: ServerSync | null = this.data.sync()
    if (!m) return
    const patch: Partial<SettingsState> = {}
    const s = this.state
    const fresh = <T>(name: SyncPartName, part: { rev: number; data: T } | undefined): T | null => {
      if (!part || this.seen[name] === part.rev || (this.busy[name] ?? 0) > 0) return null
      this.seen[name] = part.rev
      return part.data
    }
    const hours = fresh('hours', m.hours)
    if (hours) {
      const dirty = hoursDirty(s.hours, s.savedHours)
      patch.savedHours = JSON.stringify(hours.hours)
      patch.hours = dirty ? s.hours : hours.hours
      patch.rules = hours.rules
    }
    const closures = fresh('closures', m.closures)
    if (closures) {
      patch.closures = closures.closures
      patch.federal = closures.federal
    }
    const emergency = fresh('emergency', m.emergency)
    if (emergency) {
      patch.em = { ...s.em, ...emergency.em } as SettingsState['em']
      patch.emHistory = emergency.history
    }
    const vip = fresh('vip', m.vip)
    if (vip)
      patch.vip = vip.clients ? { ...vip.vip, clients: vip.clients } : { ...vip.vip, clients: s.vip.clients }
    const arrival = fresh('arrival', m.arrival)
    if (arrival) patch.arrival = arrival
    const services = fresh('services', m.services)
    if (services) {
      patch.packages = services.packages
      patch.addons = services.addons
    }
    const roles = fresh('roles', m.roles)
    if (roles) patch.rc = roles
    const employees = fresh('employees', m.employees)
    if (employees) patch.employees = employees
    if (Object.keys(patch).length) this.state = { ...this.state, ...patch }
  }

  /** What stands in for a section whose data is not here: loading, failed or not readable by this person. */
  private gate(section: SectionKey): 'locked' | 'loading' | 'failed' | null {
    if (!this.data.live) return null
    if (this.data.locked(section)) return 'locked'
    const m = this.data.sync()
    const ready = SECTION_PARTS[section].every((p) => !!m?.[p])
    if (ready) return null
    return this.data.status() === 'failed' ? 'failed' : 'loading'
  }

  // lifecycle ----------------------------------------------------------------------------------------------------------

  componentDidMount(): void {
    if (location.hash === '#emergency') this.setState({ section: 'emergency' })
    this.dataOff = this.data.subscribe(() => this.forceUpdate())
    const c = this.chrome()
    if (c) {
      const offs = [
        c.subscribe(() => this.forceUpdate()),
        c.subscribeToasts((t) => this.flash(t.desc ? t.title + ' · ' + t.desc : t.title)),
      ]
      this.liveOff = () => offs.forEach((off) => off())
    }
  }

  componentWillUnmount(): void {
    this.dataOff?.()
    this.dataOff = null
    if (this.liveOff) {
      this.liveOff()
      this.liveOff = null
    }
    clearTimeout(this.toastTimer)
  }

  // view models --------------------------------------------------------------------------------------------------------

  vipVM(): Vals {
    const s = this.state
    const v = s.vip
    const ar = s.arrival
    const tog = <T extends Vip | Arrival>(
      obj: T,
      k: keyof T & string,
      label: string,
      sub: string,
      key?: VipKey,
    ) => {
      const w = sw(obj[k] as boolean)
      return {
        label,
        sub,
        track: w.track,
        knob: w.knob,
        toggle: () => this.setVip({ [k]: !obj[k] } as Partial<Vip> & Partial<Arrival>, key),
      }
    }
    const stp = (
      label: string,
      sub: string,
      k: 'windowVip' | 'windowStd' | 'sameDay',
      min: number,
      max: number,
      unit: string,
      stepN?: number,
    ) => ({
      label,
      sub,
      val: v[k] + unit,
      dec: () => this.setVip({ [k]: Math.max(min, v[k] - (stepN || 1)) }),
      inc: () => this.setVip({ [k]: Math.min(max, v[k] + (stepN || 1)) }),
    })
    const holds = sortHolds(v.holds)
    return {
      vipHolds: holds.map((h) => ({
        label: DAYS[h.d] + ' · ' + h.t,
        remove: () => {
          if (!this.allowed('cli.member')) return
          this.applyVip({ holds: v.holds.filter((x) => !(x.d === h.d && x.t === h.t)) })
          this.persist('vip', this.data.removeHold(h))
        },
      })),
      holdDay: DAYS[s.holdDay],
      holdTime: s.holdTime,
      holdDayDec: () => this.setState({ holdDay: (s.holdDay + 6) % 7 }),
      holdDayInc: () => this.setState({ holdDay: (s.holdDay + 1) % 7 }),
      holdTimeDec: () => this.setState({ holdTime: this.step(s.holdTime, -1) }),
      holdTimeInc: () => this.setState({ holdTime: this.step(s.holdTime, 1) }),
      addHold: () => {
        if (!this.allowed('cli.member')) return
        if (v.holds.some((x) => x.d === s.holdDay && x.t === s.holdTime)) {
          this.flash('That slot is already held')
          return
        }
        const hold = { d: s.holdDay, t: s.holdTime }
        this.applyVip({ holds: [...v.holds, hold] })
        this.persist('vip', this.data.addHold(hold))
        this.flash(DAY_ABBR[s.holdDay] + ' ' + s.holdTime + ' held for VIPs')
      },
      releaseOpts: [24, 48, 72].map((h) => ({
        label: h + 'h before',
        onClick: () => this.setVip({ release: h }),
        style: seg(v.release === h),
      })),
      vipSteppers: [
        stp('VIP booking window', 'How far ahead VIPs can book', 'windowVip', 7, 90, ' days', 7),
        stp('Standard booking window', 'Everyone else', 'windowStd', 7, 60, ' days', 7),
        stp(
          'Same-day guarantee',
          'Per VIP, per month — we fit them in even when full',
          'sameDay',
          0,
          8,
          ' / mo',
        ),
      ],
      vipToggles: [
        tog(v, 'waitlist', 'Waitlist priority', 'Cancellations are offered to VIPs first'),
        tog(v, 'standing', 'Standing appointments', 'VIPs can set a repeating slot'),
        tog(v, 'autoConfirm', 'Auto-confirm standing visits', 'Confirmed 48h before without a reply'),
      ],
      offerOpts: [10, 15, 30].map((m) => ({
        label: m + ' min',
        onClick: () => this.setVip({ offerMin: m }),
        style: seg(v.offerMin === m),
      })),
      cadenceOpts: CADENCES.map((c) => {
        const on = v.cadences.includes(c)
        return {
          label: c,
          onClick: () =>
            this.setVip({ cadences: on ? v.cadences.filter((x) => x !== c) : [...v.cadences, c] }),
          style: chip(on),
        }
      }),
      vipClients: v.clients.map((n) => ({
        name: n,
        remove: () => {
          if (!this.allowed('cli.member')) return
          this.applyVip({ clients: v.clients.filter((x) => x !== n) })
          this.persist('vip', this.data.removeVipClient(n))
        },
      })),
      vipCount: v.clients.length + ' clients',
      vipNew: s.vipNew,
      vipNewSet: (e: InputEvent) => this.setState({ vipNew: e.target.value }),
      addVip: () => {
        const n = s.vipNew.trim()
        if (!n) return
        if (!this.allowed('cli.member')) return
        this.candidates = []
        settle(this.data.addVipClient(n), (r) => this.vipClientAdded(r, v.clients))
      },
      arrToggles: [
        tog(ar, 'on', 'Geofence auto check-in', 'Turn off to require check-in at the desk', 'arrival'),
        tog(
          ar,
          'autoArrive',
          'Mark as Arrived automatically',
          'Job moves to Arrived on the Operations screen',
          'arrival',
        ),
        tog(ar, 'welcome', 'Send welcome message', '“You’re checked in — pull into Bay 2”', 'arrival'),
        tog(ar, 'crew', 'Alert the crew', 'Push notification to whoever is on shift', 'arrival'),
        tog(ar, 'vipFirst', 'VIP arrivals first', 'VIP arrivals sit at the top of alerts', 'arrival'),
      ],
      radiusOpts: [150, 300, 500].map((m) => ({
        label: m + ' m',
        onClick: () => this.setVip({ radius: m }, 'arrival'),
        style: seg(ar.radius === m),
      })),
      prepOpts: [10, 15, 20].map((m) => ({
        label: m + ' min away',
        onClick: () => this.setVip({ prepAt: m }, 'arrival'),
        style: seg(ar.prepAt === m),
      })),
      arrSteps: arrivalSteps(ar),
    }
  }

  /** The answer to "Make VIP": added, already there, several customers match, or it failed. */
  private vipClientAdded(r: Awaited<ReturnType<SettingsData['addVipClient']>>, clients: string[]): void {
    if (r.status === 'added') {
      this.applyVip({ clients: [...clients, r.name] })
      this.setState({ vipNew: '' })
      this.flash(r.toast)
    } else if (r.status === 'already') {
      this.setState({ vipNew: '' })
      this.flash(r.toast)
    } else if (r.status === 'candidates') {
      this.candidates = r.candidates
      this.forceUpdate()
    }
  }

  private pickCandidate(c: VipCandidate): void {
    this.candidates = []
    settle(this.data.addVipClientById(c.id), (r) => this.vipClientAdded(r, this.state.vip.clients))
  }

  renderVals(): Vals {
    this.hydrate()
    const s = this.state
    const dark = s.theme === 'dark'
    const sec = s.section
    const data = this.data
    const go = (k: SectionKey) => () => this.setState({ section: k })
    const today = data.today()
    const gate = this.gate(sec)

    // hours
    const { rows: baseRows, total } = hourRows(s.hours, DAYS)
    const hourRowsVm = baseRows.map((r, i) => {
      const d = ORDER[i]!
      const h = s.hours[d]!
      const w = sw(h.open)
      const upd = (k: 'from' | 'to', dir: number) => () =>
        this.setHours((H) => {
          H[d]![k] = this.step(H[d]![k], dir)
          return H
        })
      return {
        ...r,
        track: w.track,
        knob: w.knob,
        toggle: () =>
          this.setHours((H) => {
            H[d]!.open = !H[d]!.open
            return H
          }),
        fromDec: upd('from', -1),
        fromInc: upd('from', 1),
        toDec: upd('to', -1),
        toInc: upd('to', 1),
      }
    })
    const rule = (label: string, key: RuleKey, opts: number[], unit: string) => ({
      label,
      opts: opts.map((v) => ({
        label: v + ' ' + unit,
        onClick: () => {
          if (!this.allowed('set.hours')) return
          this.setState((st) => ({ rules: { ...st.rules, [key]: v } }))
          this.persist('hours', data.saveRule(key, v))
        },
        style: seg(s.rules[key] === v),
      })),
    })
    const ruleRows = [
      rule('Slot length', 'slot', [15, 30, 60], 'min'),
      rule('Buffer between jobs', 'buffer', [0, 10, 15, 20], 'min'),
      rule('Last booking before close', 'cutoff', [30, 60, 90], 'min'),
    ]

    // closures
    const fmtC = (c: Closure) => {
      const l = closureLabels(c, today)
      const w = sw(c.notify)
      return {
        mon: l.mon,
        day: l.day,
        dow: l.dow,
        name: c.name,
        typeLabel: l.typeLabel,
        tagStyle: closureTagStyle(c),
        sub: data.closureSub(c),
        track: w.track,
        knob: w.knob,
        past: l.past,
        toggleNotify: () => {
          if (!this.allowed('set.hours')) return
          this.setState((st) => ({
            closures: st.closures.map((x) => (x.id === c.id ? { ...x, notify: !x.notify } : x)),
          }))
          const now = this.state.closures.find((x) => x.id === c.id)
          if (now) this.persist('closures', data.setClosureNotify(c.id, now.notify))
        },
        remove: () => {
          if (!this.allowed('set.hours')) return
          this.setState((st) => ({ closures: st.closures.filter((x) => x.id !== c.id) }))
          this.persist('closures', data.removeClosure(c.id))
          this.flash(c.name + ' removed')
        },
      }
    }
    const sortedC = sortClosures(s.closures).map(fmtC)
    const nc = s.nc
    const fw = sw(s.federal)

    // emergency
    const em = s.em
    const preview = data.emergencyPreview(em)
    const counters = data.emergencyCounters(em)
    const access = data.emergencyAccess()
    const setEm = (p: Partial<SettingsState['em']>) => this.setState((st) => ({ em: { ...st.em, ...p } }))
    const emOpt = (k: 'notify' | 'link' | 'credits' | 'pause' | 'crew', label: string, sub: string) => {
      const w = sw(em[k])
      return { label, sub, track: w.track, knob: w.knob, toggle: () => setEm({ [k]: !em[k] }) }
    }

    // employees
    const rows = visibleEmployees(s.employees, s.rc, s.roleFilter, s.empQuery)
    const empRows = rows.map(({ e, i }) => {
      const st = e.status
      const days = e.daysPerWeek ?? e.sched.filter((x) => x.on).length
      const ovN = e.exceptionCount ?? Object.keys(e.overrides).length
      return {
        name: e.first + ' ' + e.last,
        initials: initialsOf(e.first, e.last),
        title: e.title || '—',
        type: e.type,
        phone: e.phone,
        sched: days + ' days / week',
        roles: e.roles.map((r) => this.roleName(r)),
        hasOverrides: ovN > 0,
        overrides: ovN + ' exception' + (ovN > 1 ? 's' : ''),
        avatar: avatarStyle(i, 46, dark),
        status: statusLabel(st),
        statusStyle: employeeStatusStyle(st),
        open: () => this.openEmployee(e),
      }
    })
    const roleFilters = [{ id: 'all', name: 'All' }, ...s.rc.roles].map((r) => ({
      label: r.name,
      onClick: () => this.setState({ roleFilter: r.id }),
      style: chip(s.roleFilter === r.id),
    }))

    // roles matrix
    const roles = s.rc.roles
    const matrixCols = 'minmax(220px,1.6fr) repeat(' + roles.length + ', minmax(96px,1fr))'
    const roleCards = roles.map((r) => {
      const n = Object.values(s.rc.perms[r.id] || {}).filter(Boolean).length
      const ppl = s.employees.filter((e) => e.roles.includes(r.id)).length
      return {
        name: r.name,
        desc: r.desc,
        people: ppl + (ppl === 1 ? ' person' : ' people'),
        count: n + ' of ' + ALL_PERM_ITEMS.length + ' permissions',
      }
    })
    const roleCols = roles.map((r) => ({
      name: r.name,
      locked: !!r.locked,
      custom: !!r.custom,
      remove: () => {
        if (!this.allowed('team.roles')) return
        this.setRC(withoutRole(this.state.rc, r.id))
        this.setState((st) => ({
          employees: withoutRoleOnPeople(st.employees, r.id),
          ...(data.live && st.roleFilter === r.id ? { roleFilter: 'all' } : {}),
        }))
        this.persist('roles', data.removeRole(r.id))
        this.flash(r.name + ' removed')
      },
    }))
    const permGroups = PERMS.map((g) => ({
      mod: g.mod,
      rows: g.items.map(([pid, label, lim]) => ({
        label,
        cells: roles.map((r) => {
          const on = !!(s.rc.perms[r.id] || {})[pid]
          const lk = lim ? limKey(pid) : null
          const lv = lk ? (s.rc.limits[r.id] || {})[lk as LimitKind] : undefined
          return {
            on,
            hasLimit: !!lk && on,
            limitLabel: lk ? limLabel(lv === undefined ? 25 : (lv as number | null)) : '',
            box: matrixBoxStyle(on, !!r.locked),
            limitStyle: limitChipStyle(!!r.locked),
            toggle: () => {
              if (r.locked) {
                this.flash('Super Admin always has every permission')
                return
              }
              if (!this.allowed('team.roles')) return
              this.setRC(withPermission(this.state.rc, r.id, pid, !on))
              this.persist('roles', data.setPermission(r.id, pid, !on))
            },
            cycle: () => {
              if (r.locked) return
              if (!this.allowed('team.roles')) return
              if (data.live && !data.access().isSuper) {
                this.flash('Super Admin only · Only a Super Admin can do that')
                return
              }
              const cur = (this.state.rc.limits[r.id] || {})[lk as LimitKind]
              const value = nextLimit(cur)
              this.setRC(withLimit(this.state.rc, r.id, lk as LimitKind, value))
              this.persist('roles', data.setLimit(r.id, lk as LimitKind, value))
            },
          }
        }),
      })),
    }))

    // services
    const isPkg = s.svcKind === 'pkg'
    const src = isPkg ? s.packages : s.addons
    const sel = src[s.svcSel] ? s.svcSel : Object.keys(src)[0]!
    const item = src[sel]!
    const setTasks = (fn: (t: string[]) => string[]) => {
      if (!this.allowed('set.services')) return
      const kind = s.svcKind
      this.setState((st) => {
        const key = isPkg ? 'packages' : 'addons'
        const coll = { ...st[key], [sel]: { ...st[key][sel]!, tasks: fn([...st[key][sel]!.tasks]) } }
        return { [key]: coll } as unknown as Partial<SettingsState>
      })
      const now = (isPkg ? this.state.packages : this.state.addons)[sel]!
      this.persist('services', data.saveChecklist(kind, sel, now.tasks))
    }
    const addTask = () => {
      const t = s.newTask.trim()
      if (!t) return
      setTasks((T) => taskOps.add(T, t))
      this.setState({ newTask: '' })
    }
    const tasks = item.tasks.map((t, i) => ({
      n: String(i + 1),
      label: t,
      edit: (e: InputEvent) => {
        const v = e.target.value
        setTasks((T) => taskOps.edit(T, i, v))
      },
      up: () => setTasks((T) => taskOps.up(T, i)),
      down: () => setTasks((T) => taskOps.down(T, i)),
      remove: () => setTasks((T) => taskOps.remove(T, i)),
    }))
    const svcList = Object.keys(src).map((k) => ({
      name: k,
      count: String(src[k]!.tasks.length),
      onClick: () => this.setState({ svcSel: k }),
      style: serviceRowStyle(k === sel),
    }))

    // drawer
    const dft = s.draft
    let dr: Vals = {}
    if (dft) {
      const idx = Math.max(
        0,
        s.employees.findIndex((e) => e.id === dft.id),
      )
      const fld = (k: 'first' | 'last' | 'phone' | 'email' | 'title', label: string, ph: string) => ({
        label,
        value: dft[k],
        ph,
        set: (e: InputEvent) => {
          const v = e.target.value
          this.setDraft((d) => ({ ...d, [k]: v }))
        },
        style: drawerFieldStyle(
          !!s.drError && ((k === 'first' && !dft.first.trim()) || (k === 'phone' && !dft.phone.trim())),
        ),
      })
      const segs = <K extends 'type' | 'payType'>(k: K, opts: Draft[K][]) =>
        opts.map((o) => ({
          label: o,
          onClick: () => this.setDraft((d) => ({ ...d, [k]: o })),
          style: seg(dft[k] === o),
        }))
      const tab = (k: SettingsState['drTab']) => drawerTabStyle(s.drTab === k)
      const effOn = effectiveCount(s.rc, dft)
      dr = {
        heading: dft.id ? dft.first + ' ' + dft.last : 'New employee',
        sub: dft.id
          ? (dft.title || '') + ' · ' + dft.roles.map((r) => this.roleName(r)).join(' + ')
          : 'They’ll get an SMS invite to set up their login.',
        initials: dft.id ? initialsOf(dft.first, dft.last) : '+',
        avatar: avatarStyle(idx, 54, dark),
        tProfile: tab('profile'),
        tAccess: tab('access'),
        tSched: tab('sched'),
        isProfile: s.drTab === 'profile',
        isAccess: s.drTab === 'access',
        isSched: s.drTab === 'sched',
        fields: [
          fld('first', 'First name *', 'First'),
          fld('last', 'Last name', 'Last'),
          fld('phone', 'Mobile *', '(305) 555-0000'),
          fld('email', 'Email', 'name@oasisautospa.com'),
          fld('title', 'Job title', 'e.g. Detailer'),
        ],
        types: segs('type', ['Full-time', 'Part-time', 'Contractor']),
        pays: segs('payType', ['Hourly', 'Commission', 'Salary']),
        rate: dft.rate,
        ratePh: rateHint(dft.payType),
        setRate: (e: InputEvent) => {
          const v = e.target.value
          this.setDraft((d) => ({ ...d, rate: v }))
        },
        skills: SKILLS.map((k) => {
          const on = dft.skills.includes(k)
          return {
            label: k,
            onClick: () =>
              this.setDraft((d) => ({
                ...d,
                skills: on ? d.skills.filter((x) => x !== k) : [...d.skills, k],
              })),
            style: chip(on),
          }
        }),
        roleOpts: roles.map((r) => {
          const on = dft.roles.includes(r.id)
          return {
            name: r.name,
            desc: r.desc,
            on,
            onClick: () =>
              this.setAccess((d) => ({
                ...d,
                roles: on ? d.roles.filter((x) => x !== r.id) : [...d.roles, r.id],
              })),
            style: roleOptionStyle(on),
            box: roleOptionBoxStyle(on),
          }
        }),
        effCount: effOn + ' of ' + ALL_PERMS.length + ' allowed',
        effGroups: PERMS.map((g) => ({
          mod: g.mod,
          rows: g.items.map(([pid, label]) => {
            const ef = effective(s.rc, dft, pid)
            const setOv = (v: 'allow' | 'deny' | null) => () =>
              this.setAccess((d) => {
                const o = { ...d.overrides }
                if (v) o[pid] = v
                else delete o[pid]
                return { ...d, overrides: o }
              })
            return {
              label,
              src: ef.src,
              dot: effDotStyle(ef.on),
              inherit: setOv(null),
              allow: setOv('allow'),
              deny: setOv('deny'),
              sInherit: overrideButtonStyle(!ef.ov, 'var(--ink2)'),
              sAllow: overrideButtonStyle(ef.ov === 'allow', 'var(--accent)'),
              sDeny: overrideButtonStyle(ef.ov === 'deny', '#C2410C'),
            }
          }),
        })),
        sched: ORDER.map((d) => {
          const h = dft.sched[d]!
          const w = sw(h.on)
          const up = (k: 'from' | 'to', dir: number) => () =>
            this.setDraft((x) => {
              const S = x.sched.map((y) => ({ ...y }))
              S[d]![k] = this.step(S[d]![k], dir)
              return { ...x, sched: S }
            })
          return {
            day: DAYS[d],
            on: h.on,
            off: !h.on,
            from: h.from,
            to: h.to,
            track: w.track,
            knob: w.knob,
            toggle: () =>
              this.setDraft((x) => {
                const S = x.sched.map((y) => ({ ...y }))
                S[d]!.on = !S[d]!.on
                return { ...x, sched: S }
              }),
            fromDec: up('from', -1),
            fromInc: up('from', 1),
            toDec: up('to', -1),
            toInc: up('to', 1),
          }
        }),
        error: s.drError,
        canDeactivate: !!dft.id,
        activeLabel: dft.status === 'inactive' ? 'Reactivate' : 'Deactivate',
        saveLabel: dft.id ? 'Save changes' : 'Create & send invite',
      }
    }

    const headBtns: Partial<Record<SectionKey, [string, () => void]>> = {
      closures: [
        'Add closure',
        () => {
          if (!this.allowed('set.hours')) return
          this.setState({
            adding: true,
            nc: { date: '', name: '', type: 'closed', from: '10:00 AM', to: '2:00 PM' },
            ncError: '',
          })
        },
      ],
      employees: [
        'Add employee',
        () => {
          if (!this.allowed('team.edit')) return
          this.openEmp(null)
        },
      ],
      roles: [
        'Custom role',
        () => {
          if (!this.allowed('team.roles')) return
          settle(data.addRole(), (r) => {
            if (!r.ok) return
            this.setRC(withRole(this.state.rc, r.value))
            this.flash('Custom role added — adjust its permissions below')
          })
        },
      ],
    }
    const head = headBtns[sec]

    const closeNow = () => {
      if (this.closing) return
      this.closing = true
      settle(data.close(em, this.closeAction.key), (r) => {
        this.closing = false
        if (!r.ok) return
        this.closeAction.renew()
        this.setState((st) => ({ confirm: false, em: { ...st.em, active: true, summary: r.value.summary } }))
        this.flash(
          'Shop closed · ' + (em.notify ? r.value.notified + ' customers notified' : 'no messages sent'),
        )
      })
    }

    const vals: Vals = {
      theme: s.theme,
      toggleTheme: () => {
        const t = dark ? 'light' : 'dark'
        data.saveTheme(t)
        this.setState({ theme: t })
        this.chrome()?.themeChanged(t, s.theme)
      },
      nav: {
        hours: navStyle(sec, 'hours'),
        closures: navStyle(sec, 'closures'),
        emergency: navStyle(sec, 'emergency'),
        employees: navStyle(sec, 'employees'),
        roles: navStyle(sec, 'roles'),
        services: navStyle(sec, 'services'),
        vip: navStyle(sec, 'vip'),
        arrival: navStyle(sec, 'arrival'),
      },
      goVip: go('vip'),
      goArrival: go('arrival'),
      secVip: sec === 'vip' && !gate,
      secArrival: sec === 'arrival' && !gate,
      ...this.vipVM(),
      goHours: go('hours'),
      goClosures: go('closures'),
      goEmergency: go('emergency'),
      goEmployees: go('employees'),
      goRoles: go('roles'),
      goServices: go('services'),
      empCount: String(s.employees.length),
      secTitle: SECTION_META[sec][0],
      secDesc: SECTION_META[sec][1],
      hasHeadBtn: !!head && !gate,
      headBtnLabel: head ? head[0] : '',
      headBtn: head ? head[1] : null,
      secHours: sec === 'hours' && !gate,
      secClosures: sec === 'closures' && !gate,
      secEmergency: sec === 'emergency' && !gate,
      secEmployees: sec === 'employees' && !gate,
      secRoles: sec === 'roles' && !gate,
      secServices: sec === 'services' && !gate,
      hourRows: hourRowsVm,
      ruleRows,
      weekHours: total / 60 + ' hrs',
      copyWeekdays: () => this.setHours((H) => copyMondayToWeekdays(H)),
      hoursDirty: sec === 'hours' && !gate && hoursDirty(s.hours, s.savedHours),
      discardHours: () => this.setState((st) => ({ hours: JSON.parse(st.savedHours) as HoursDay[] })),
      saveHours: () => {
        if (!this.allowed('set.hours')) return
        const hours = s.hours
        this.busy.hours = (this.busy.hours ?? 0) + 1
        settle(data.saveHours(hours), (r) => {
          this.busy.hours = (this.busy.hours ?? 1) - 1
          if (!r.ok) return void this.forceUpdate()
          this.setState({ savedHours: JSON.stringify(hours) })
          this.flash(
            'Working hours saved · booking and calendar updated' + (r.value.note ? ' · ' + r.value.note : ''),
          )
        })
      },
      upcoming: sortedC.filter((c) => !c.past),
      past: sortedC.filter((c) => c.past).reverse(),
      federalSw: fw,
      toggleFederal: () => {
        if (!this.allowed('set.hours')) return
        this.setState({ federal: !s.federal })
        this.persist('closures', data.setFederal(!s.federal))
      },
      addingClosure: s.adding,
      nc,
      ncIsReduced: nc.type === 'reduced',
      ncError: s.ncError,
      ncClosedStyle: seg(nc.type === 'closed'),
      ncReducedStyle: seg(nc.type === 'reduced'),
      ncDate: (e: InputEvent) => {
        const v = e.target.value
        this.setState((st) => ({ nc: { ...st.nc, date: v }, ncError: '' }))
      },
      ncName: (e: InputEvent) => {
        const v = e.target.value
        this.setState((st) => ({ nc: { ...st.nc, name: v }, ncError: '' }))
      },
      ncClosed: () => this.setState((st) => ({ nc: { ...st.nc, type: 'closed' } })),
      ncReduced: () => this.setState((st) => ({ nc: { ...st.nc, type: 'reduced' } })),
      ncFromDec: () => this.setState((st) => ({ nc: { ...st.nc, from: this.step(st.nc.from, -1) } })),
      ncFromInc: () => this.setState((st) => ({ nc: { ...st.nc, from: this.step(st.nc.from, 1) } })),
      ncToDec: () => this.setState((st) => ({ nc: { ...st.nc, to: this.step(st.nc.to, -1) } })),
      ncToInc: () => this.setState((st) => ({ nc: { ...st.nc, to: this.step(st.nc.to, 1) } })),
      ncAffected: data.closureAffected(nc),
      cancelClosure: () => this.setState({ adding: false }),
      addClosure: () => {
        if (!nc.date || !nc.name.trim()) {
          this.setState({ ncError: 'Add a date and a name.' })
          return
        }
        if (s.closures.some((c) => c.date === nc.date)) {
          this.setState({ ncError: 'There’s already a closure on that date.' })
          return
        }
        if (!this.allowed('set.hours')) return
        settle(data.createClosure(nc), (r) => {
          if (!r.ok) {
            if (r.message) this.setState({ ncError: r.message })
            return
          }
          this.setState({ closures: [...s.closures, r.value], adding: false })
          this.flash(nc.name.trim() + ' added · calendar updated')
        })
      },
      emActive: em.active,
      emIdle: !em.active,
      emSummary: em.summary,
      emNotified: counters.notified,
      emRebooked: counters.rebooked,
      emBooking: counters.booking,
      emReasons: EMERGENCY_REASONS.map((r) => ({
        label: r,
        onClick: () => setEm({ reason: r }),
        style: chip(em.reason === r),
      })),
      emDurations: EMERGENCY_DURATIONS.map(([k, l]) => ({
        label: l,
        onClick: () => setEm({ dur: k }),
        style: seg(em.dur === k),
      })),
      emIsUntil: em.dur === 'until',
      emIsDays: em.dur === 'days',
      emUntil: em.until,
      emThrough: em.through,
      emUntilDec: () => setEm({ until: this.step(em.until, -1) }),
      emUntilInc: () => setEm({ until: this.step(em.until, 1) }),
      emThroughSet: (e: InputEvent) => setEm({ through: e.target.value }),
      emMsg: em.msg,
      emMsgSet: (e: InputEvent) => setEm({ msg: e.target.value }),
      emPreview: preview.message,
      emOpts: [
        emOpt(
          'notify',
          'Notify affected customers',
          data.live ? 'Sent by SMS' : 'WhatsApp, with SMS fallback',
        ),
        emOpt('link', 'Include one-tap reschedule link', 'Customers pick a new slot themselves'),
        emOpt('credits', 'Protect member credits', 'Missed visits don’t use a credit'),
        emOpt('pause', 'Pause online booking', 'Until you reopen'),
        emOpt('crew', 'Alert on-shift crew', 'Push notification to the team'),
      ],
      emAffected: preview.affected,
      emAffectedCount: preview.count + ' customers',
      emHistory: s.emHistory,
      confirmOpen: s.confirm,
      confirmText: confirmText(em, preview.count),
      askClose: () => {
        if (!this.allowed('set.emergency')) return
        this.setState({ confirm: true })
      },
      cancelClose: () => this.setState({ confirm: false }),
      doClose: closeNow,
      reopen: () => {
        if (!this.allowed('set.emergency')) return
        settle(data.reopen(em), (r) => {
          if (!r.ok) return
          this.setState((st) => ({ em: { ...st.em, active: false }, emHistory: [r.value, ...st.emHistory] }))
          this.flash('Shop reopened · online booking resumed')
        })
      },
      empQuery: s.empQuery,
      empSearch: (e: InputEvent) => this.setState({ empQuery: e.target.value }),
      roleFilters,
      empRows,
      noEmp: empRows.length === 0,
      roleCards,
      roleCols,
      permGroups,
      matrixCols,
      kindPkg: () => this.setState({ svcKind: 'pkg', svcSel: Object.keys(s.packages)[1]! }),
      kindAddon: () => this.setState({ svcKind: 'addon', svcSel: Object.keys(s.addons)[0]! }),
      kindPkgStyle: seg(isPkg),
      kindAddonStyle: seg(!isPkg),
      svcList,
      tasks,
      svcName: sel,
      svcKindLabel: isPkg ? 'Package' : 'Add-on',
      svcMeta: isPkg ? packageMeta(item as SettingsState['packages'][string]) : addonMeta(item),
      svcKindStyle: serviceKindStyle(isPkg),
      svcNote: SERVICE_NOTE[s.svcKind],
      newTask: s.newTask,
      newTaskSet: (e: InputEvent) => this.setState({ newTask: e.target.value }),
      newTaskKey: (e: KeyEvent) => {
        if (e.key === 'Enter') addTask()
      },
      addTask,
      drawerOpen: !!dft,
      dr,
      closeDrawer: () => this.setState({ draft: null, drawer: null }),
      stop: (e: { stopPropagation(): void }) => e.stopPropagation(),
      tabProfile: () => this.setState({ drTab: 'profile' }),
      tabAccess: () => this.setState({ drTab: 'access' }),
      tabSched: () => this.setState({ drTab: 'sched' }),
      toggleActive: () =>
        this.setDraft((d) => ({ ...d, status: d.status === 'inactive' ? 'active' : 'inactive' })),
      saveEmp: () => {
        if (!dft) return
        const bad = validateDraft(dft)
        if (bad) {
          this.setState({ drError: bad.error, drTab: bad.tab })
          return
        }
        if (!this.allowed('team.edit')) return
        const stored = dft.id ? (s.employees.find((e) => e.id === dft.id) ?? null) : null
        settle(data.saveEmployee(dft, stored), (r) => {
          if (!r.ok) {
            this.setState({ drError: r.message, ...(r.tab ? { drTab: r.tab } : {}) })
            return
          }
          if (dft.id) {
            this.setState((st) => ({
              employees: st.employees.map((e) => (e.id === dft.id ? r.employee : e)),
              draft: null,
            }))
            this.flash('Saved ' + dft.first + ' ' + dft.last)
          } else {
            this.setState((st) => ({ employees: [...st.employees, r.employee], draft: null }))
            this.flash('Invite sent to ' + dft.phone)
          }
        })
      },
      toast: s.toast,
    }
    if (data.live) {
      Object.assign(vals, this.liveVals(sec, gate, preview, access))
    }
    if (LIVE) {
      const chrome = this.chrome()
      vals.live = chrome ? chrome.vals() : {}
      if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') !== s.theme)
        document.documentElement.setAttribute('data-theme', s.theme)
    }
    return vals
  }

  /** The extra roots of the live template (loading, locked and failed cards, server-driven texts, candidates). */
  private liveVals(
    sec: SectionKey,
    gate: 'locked' | 'loading' | 'failed' | null,
    preview: EmergencyPreview,
    access: ReturnType<SettingsData['emergencyAccess']>,
  ): Vals {
    const meta = SECTION_META[sec]
    return {
      secLoading: gate === 'loading',
      secFailed: gate === 'failed',
      secLocked: gate === 'locked',
      retryLoad: () => this.data.reload(),
      lockedTitle: 'You don’t have access to ' + meta[0],
      lockedBody: this.lockedBody(sec),
      emStrip: this.data.emergencyStrip(),
      emRequirement:
        access.requirement + ' · ' + (access.canClose ? 'you have access' : 'you don’t have access'),
      emPreviewLabel: 'Preview · SMS to ' + (preview.first || 'a customer'),
      hasCandidates: this.candidates.length > 0,
      candidates: this.candidates.map((c) => ({
        name: c.name,
        detail: c.detail,
        onClick: () => this.pickCandidate(c),
      })),
    }
  }

  private lockedBody(sec: SectionKey): string {
    const key = SECTION_READ[sec]
    return key
      ? 'Ask an administrator to give your role the “' +
          (ALL_PERM_ITEMS.find((i) => i[0] === key)?.[1] ?? key) +
          '” permission.'
      : ''
  }
}

/** The constructor DCHost instantiates: the view model bound to its data source. */
export function createSettingsLogic(data: SettingsData): DCLogicCtor {
  return class extends SettingsLogic {
    constructor(props?: Record<string, unknown>) {
      super(props, data)
    }
  }
}

export { hoursText, cloneRoles, newRoleParts }
