// Settings → Shop floor → Kiosk (live variant only; ADR 0180, design 6.6, api-spec 31.3; DEVIATIONS DV-1010). One read,
// GET /kiosk (team.roles), and the manager's controls: kiosk mode on or off, the shop code (set it, or generate one that
// is shown once), "Make this a kiosk" for this browser, the devices (rename, lock, clear a lockout, remove), Lock all,
// who shows on the kiosk's picker, and the recent kiosk events. Every write goes through the extras' run() (Idempotency-
// Key, the "Your role can’t …" toast, a refetch); the event stream (`settings.changed {section: kiosk}`) keeps it fresh.
import type { KioskAdminApi, KioskDevice, KioskOverview } from '@/data/ports/kiosk-api'
import {
  CODE_NUDGE_DAYS,
  codeFormProblem,
  codeLine,
  deviceNameProblem,
  deviceState,
  groupCode,
  lastSeenLine,
  recentLine,
} from '@/lib/settings/kiosk'
import type { Tone } from '@/lib/settings/kiosk'
import { sw } from '@/lib/settings/styles'
import { saveButtonStyle } from './ui'
import type { InputEvent, RunOptions, RunResult, Vals } from './ui'

/** Managing kiosks takes "Assign roles & permissions" (no new permission key, open decision 13). */
export const KIOSK_PERMISSION = 'team.roles' as const

export interface KioskCtx {
  api: KioskAdminApi
  /** A write needing team.roles under `name`; refetches GET /kiosk afterwards. */
  run<T>(name: string, request: (idem: string) => Promise<T>, o?: RunOptions): Promise<RunResult<T>>
  allowed(): boolean
  busy(name: string): boolean
  changed(): void
  flash(text: string): void
  tz(): string
  today(): string
  /** Full-page navigation: "Make this a kiosk" while kiosk mode is on ends this session, the keypad comes next. */
  navigate(url: string): void
}

const TONE: Record<Tone, string> = { green: '#0E9E6E', amber: '#8A5A06', red: '#C2410C', grey: 'var(--ink3)' }
const stateStyle = (t: Tone) => ({ fontSize: '12.5px', fontWeight: 800, color: TONE[t] })

const ghostButton = {
  height: '38px',
  padding: '0 13px',
  borderRadius: '10px',
  background: 'var(--panel)',
  border: '1px solid var(--line)',
  fontWeight: 700,
  fontSize: '12.5px',
  color: 'var(--ink)',
  flex: 'none',
}

export class KioskSection {
  private codeOpen = false
  private code1 = ''
  private code2 = ''
  private codeError = ''
  /** A generated code, shown once until "Done". */
  private generated: string | null = null
  private deviceName = ''
  private registerError = ''
  private modeError = ''
  private renaming: { id: string; name: string; error: string } | null = null
  private confirmRevoke: string | null = null
  private confirmLockAll = false

  constructor(private readonly ctx: KioskCtx) {}

  private edit(fn: () => void): void {
    fn()
    this.ctx.changed()
  }

  // ---- writes ---------------------------------------------------------------------------------------------------------

  private async toggleMode(v: KioskOverview): Promise<void> {
    if (!this.ctx.allowed()) return
    this.modeError = ''
    const next = !v.enabled
    const r = await this.ctx.run('kiosk:mode', (idem) => this.ctx.api.setMode(next, v.version, { idempotencyKey: idem }), {
      staleMessage: 'Someone changed kiosk mode just now. Check it and try again.',
    })
    if (!r.ok) {
      this.edit(() => (this.modeError = r.message))
      return
    }
    this.ctx.flash(next ? 'Kiosk mode is on · the tablet shows the keypad' : 'Kiosk mode is off · every kiosk locked')
  }

  private async saveCode(): Promise<void> {
    if (!this.ctx.allowed()) return
    const problem = codeFormProblem(this.code1, this.code2)
    if (problem) {
      this.edit(() => (this.codeError = problem))
      return
    }
    const code = this.code1.trim()
    const r = await this.ctx.run('kiosk:code', (idem) => this.ctx.api.setCode({ code }, { idempotencyKey: idem }))
    if (!r.ok) {
      this.edit(() => (this.codeError = r.message))
      return
    }
    this.edit(() => {
      this.codeOpen = false
      this.code1 = ''
      this.code2 = ''
      this.codeError = ''
    })
    this.ctx.flash('Shop code changed · every kiosk locked')
  }

  private async generate(): Promise<void> {
    if (!this.ctx.allowed()) return
    const r = await this.ctx.run('kiosk:code', (idem) =>
      this.ctx.api.setCode({ generate: true }, { idempotencyKey: idem }),
    )
    if (!r.ok) {
      this.edit(() => (this.codeError = r.message))
      return
    }
    this.edit(() => {
      this.generated = r.data.code ?? null
      this.codeOpen = false
      this.code1 = ''
      this.code2 = ''
      this.codeError = ''
    })
  }

  private async register(): Promise<void> {
    if (!this.ctx.allowed()) return
    const problem = deviceNameProblem(this.deviceName)
    if (problem) {
      this.edit(() => (this.registerError = problem))
      return
    }
    const name = this.deviceName.trim()
    const r = await this.ctx.run('kiosk:register', (idem) => this.ctx.api.register(name, { idempotencyKey: idem }))
    if (!r.ok) {
      this.edit(() => (this.registerError = r.message))
      return
    }
    this.edit(() => {
      this.deviceName = ''
      this.registerError = ''
    })
    // kiosk mode is on: this browser's own session ended, the keypad is next
    if (r.data.signedOut) this.ctx.navigate('/login')
    else this.ctx.flash(name + ' is a kiosk now · turn kiosk mode on to show the keypad')
  }

  private async saveRename(d: KioskDevice): Promise<void> {
    const ren = this.renaming
    if (!ren || ren.id !== d.id || !this.ctx.allowed()) return
    const problem = deviceNameProblem(ren.name)
    if (problem) {
      this.edit(() => (ren.error = problem))
      return
    }
    const name = ren.name.trim()
    const r = await this.ctx.run('kiosk:rename:' + d.id, (idem) =>
      this.ctx.api.rename(d.id, name, d.version, { idempotencyKey: idem }),
    )
    if (!r.ok) {
      this.edit(() => (ren.error = r.message))
      return
    }
    this.edit(() => (this.renaming = null))
    this.ctx.flash('Renamed to ' + name)
  }

  private async deviceAction(d: KioskDevice, kind: 'lock' | 'clear' | 'revoke'): Promise<void> {
    if (!this.ctx.allowed()) return
    const r = await this.ctx.run<unknown>('kiosk:' + kind + ':' + d.id, (idem) => {
      const o = { idempotencyKey: idem }
      if (kind === 'lock') return this.ctx.api.lockDevice(d.id, o)
      if (kind === 'clear') return this.ctx.api.clearLockout(d.id, o)
      return this.ctx.api.revoke(d.id, o)
    })
    if (kind === 'revoke') this.edit(() => (this.confirmRevoke = null))
    if (!r.ok) {
      if (r.message) this.ctx.flash(r.message)
      return
    }
    this.ctx.flash(
      kind === 'lock'
        ? d.name + ' locked'
        : kind === 'clear'
          ? d.name + ' can take the code again'
          : d.name + ' removed · its code no longer works there',
    )
  }

  private async lockAll(): Promise<void> {
    if (!this.ctx.allowed()) return
    const r = await this.ctx.run('kiosk:lock-all', (idem) => this.ctx.api.lockAll({ idempotencyKey: idem }))
    this.edit(() => (this.confirmLockAll = false))
    if (!r.ok) {
      if (r.message) this.ctx.flash(r.message)
      return
    }
    const n = r.data.locked
    this.ctx.flash(n === 0 ? 'No kiosk was unlocked' : n === 1 ? '1 kiosk locked' : n + ' kiosks locked')
  }

  private async setListed(id: string, listed: boolean, name: string): Promise<void> {
    if (!this.ctx.allowed()) return
    const r = await this.ctx.run('kiosk:staff:' + id, (idem) =>
      this.ctx.api.setListed(id, listed, { idempotencyKey: idem }),
    )
    if (!r.ok) {
      if (r.message) this.ctx.flash(r.message)
      return
    }
    this.ctx.flash(listed ? name + ' shows on the kiosk' : name + ' no longer shows on the kiosk')
  }

  // ---- the template's values (live.kiosk.*) ------------------------------------------------------------------------------

  vals(v: KioskOverview | undefined): Vals {
    if (!v) return { has: false, devices: [], staff: [], recent: [] }
    const tz = this.ctx.tz()
    const today = this.ctx.today()
    const mode = sw(v.enabled)
    const live = v.devices.filter((d) => d.state !== 'revoked')
    const thisDevice = v.thisDeviceId ? v.devices.find((d) => d.id === v.thisDeviceId) : undefined
    const codeOld = v.code.set && (v.code.ageDays ?? 0) >= CODE_NUDGE_DAYS
    const busyCode = this.ctx.busy('kiosk:code')
    const codeReady = /^\d{8}$/.test(this.code1.trim()) && this.code2.trim().length === 8 && !busyCode
    const registerReady = !!this.deviceName.trim() && !this.ctx.busy('kiosk:register')
    return {
      has: true,
      // kiosk mode
      enabled: v.enabled,
      modeTrack: mode.track,
      modeKnob: mode.knob,
      modeToggle: () => void this.toggleMode(v),
      modeText: v.enabled
        ? 'On. The kiosk tablet shows the keypad; the shop code opens Operations until closing + 2 hours.'
        : 'Off. Everyone signs in with their email and password.',
      hasModeError: !!this.modeError,
      modeError: this.modeError,
      // the shop code
      codeLine: codeLine(v.code, tz, today),
      codeOld,
      codeOldText: 'This code is ' + (v.code.ageDays ?? 0) + ' days old. If someone who knew it has left, change it.',
      codeClosed: !this.codeOpen && !this.generated,
      codeOpen: this.codeOpen,
      openCode: () =>
        this.edit(() => {
          if (!this.ctx.allowed()) return
          this.codeOpen = true
          this.codeError = ''
        }),
      closeCode: () =>
        this.edit(() => {
          this.codeOpen = false
          this.code1 = ''
          this.code2 = ''
          this.codeError = ''
        }),
      code1: this.code1,
      code2: this.code2,
      setCode1: (e: InputEvent) =>
        this.edit(() => {
          this.code1 = e.target.value.replace(/\D/g, '').slice(0, 8)
          this.codeError = ''
        }),
      setCode2: (e: InputEvent) =>
        this.edit(() => {
          this.code2 = e.target.value.replace(/\D/g, '').slice(0, 8)
          this.codeError = ''
        }),
      saveCode: () => void this.saveCode(),
      saveCodeStyle: saveButtonStyle(codeReady),
      saveCodeLabel: busyCode ? 'Saving…' : 'Save code',
      generate: () => void this.generate(),
      hasCodeError: !!this.codeError,
      codeError: this.codeError,
      codeWarn: 'Changing the code locks every kiosk now.',
      hasGenerated: !!this.generated,
      generatedCode: this.generated ? groupCode(this.generated) : '',
      doneGenerated: () => this.edit(() => (this.generated = null)),
      // this browser
      isThisKiosk: !!thisDevice && thisDevice.state !== 'revoked',
      thisLine: thisDevice ? 'This browser is the kiosk “' + thisDevice.name + '”.' : '',
      notThisKiosk: !thisDevice || thisDevice.state === 'revoked',
      deviceName: this.deviceName,
      setDeviceName: (e: InputEvent) =>
        this.edit(() => {
          this.deviceName = e.target.value.slice(0, 40)
          this.registerError = ''
        }),
      register: () => void this.register(),
      registerStyle: saveButtonStyle(registerReady),
      registerNote: v.enabled
        ? 'Kiosk mode is on: you are signed out here and the keypad shows right away.'
        : 'The keypad shows here once kiosk mode is on.',
      hasRegisterError: !!this.registerError,
      registerError: this.registerError,
      // devices
      devices: live.map((d) => this.deviceVals(d, v.thisDeviceId, tz, today)),
      noDevices: live.length === 0,
      lockAllShow: !this.confirmLockAll,
      lockAll: () =>
        this.edit(() => {
          if (this.ctx.allowed()) this.confirmLockAll = true
        }),
      lockAllConfirm: this.confirmLockAll,
      lockAllYes: () => void this.lockAll(),
      lockAllNo: () => this.edit(() => (this.confirmLockAll = false)),
      // who shows on the kiosk
      staff: v.staff
        .filter((p) => p.status !== 'inactive')
        .map((p) => {
          const s = sw(p.listed)
          return {
            name: p.name,
            sub: p.status === 'invited' ? 'Invited · no login yet' : 'Active',
            track: s.track,
            knob: s.knob,
            toggle: () => void this.setListed(p.id, !p.listed, p.name),
          }
        }),
      noStaff: !v.staff.some((p) => p.status !== 'inactive'),
      // recent kiosk events
      recent: v.recent.map((r) => ({ line: recentLine(r, tz, today) })),
      noRecent: v.recent.length === 0,
    }
  }

  private deviceVals(d: KioskDevice, thisId: string | null, tz: string, today: string): Vals {
    const st = deviceState(d, tz)
    const ren = this.renaming?.id === d.id ? this.renaming : null
    const confirming = this.confirmRevoke === d.id
    return {
      name: d.name + (d.id === thisId ? ' (this browser)' : ''),
      state: st.label,
      stateStyle: stateStyle(st.tone),
      seen: lastSeenLine(d, tz, today),
      renaming: !!ren,
      notRenaming: !ren,
      renameValue: ren?.name ?? '',
      setRename: (e: InputEvent) =>
        this.edit(() => {
          if (this.renaming?.id === d.id) {
            this.renaming.name = e.target.value.slice(0, 40)
            this.renaming.error = ''
          }
        }),
      startRename: () =>
        this.edit(() => {
          if (this.ctx.allowed()) this.renaming = { id: d.id, name: d.name, error: '' }
        }),
      saveRename: () => void this.saveRename(d),
      cancelRename: () => this.edit(() => (this.renaming = null)),
      hasRenameError: !!ren?.error,
      renameError: ren?.error ?? '',
      canLock: d.state === 'unlocked',
      lock: () => void this.deviceAction(d, 'lock'),
      canClear: d.state === 'locked_out' || d.failedAttempts > 0,
      clear: () => void this.deviceAction(d, 'clear'),
      showRevoke: !confirming,
      revoke: () =>
        this.edit(() => {
          if (this.ctx.allowed()) this.confirmRevoke = d.id
        }),
      confirming,
      revokeYes: () => void this.deviceAction(d, 'revoke'),
      revokeNo: () => this.edit(() => (this.confirmRevoke = null)),
      buttonStyle: ghostButton,
    }
  }
}
