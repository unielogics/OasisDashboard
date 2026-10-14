// Settings → Shop floor → Kiosk (live variant only; ADR 0180 and its 2026-10-14 amendment, design 6.6, api-spec 31.3;
// DEVIATIONS DV-1010). One read, GET /kiosk (team.roles), and the manager's controls:
//   - kiosk mode on or off (on by default: the sign-in page is the PIN keypad);
//   - Shop network: "Your connection: 73.x.x.x" and "This is the shop's network" (sends confirmAddress = the address shown;
//     a 409 KIOSK_ADDRESS_CHANGED re-reads it and shows the new one), the networks (Remove after a confirm, Clear lockout),
//     and "PIN tried from a new network" (Add this network). Adding and removing are a Super Admin's alone
//     (`canManageNetworks`); other managers see it read only. Clearing an address's lockout is any manager's;
//   - Staff PINs: per employee Set (typed twice) / Generate (shown once, with Copy) / Remove (after a confirm), never the PIN
//     itself, and "Shows on the kiosk";
//   - Browsers at the shop (rename, Lock, Clear lockout, Remove), Lock all, and the recent kiosk events ("Opened by …").
// Every write goes through the extras' run() (Idempotency-Key, the "Your role can’t …" toast, a refetch); the event stream
// (`settings.changed {section: kiosk}`) keeps it fresh.
import { AUTH_CODES } from '@/data/http/auth-types'
import type { ApiError } from '@/data/http/problem'
import type { KioskAdminApi, KioskDevice, KioskNetwork, KioskOverview, KioskRefusedTry, KioskStaffRow } from '@/data/ports/kiosk-api'
import {
  REFUSED_WARNING,
  deviceNameProblem,
  deviceState,
  groupPin,
  lastSeenLine,
  networkLine,
  networkState,
  networkTitle,
  pinFormProblem,
  pinLine,
  recentLine,
  refusedLine,
  refusedTitle,
} from '@/lib/settings/kiosk'
import type { Tone } from '@/lib/settings/kiosk'
import { sw } from '@/lib/settings/styles'
import { saveButtonStyle } from './ui'
import type { InputEvent, RunOptions, RunResult, Vals } from './ui'

/** Managing kiosks takes "Assign roles & permissions" (no new permission key, open decision 13). */
export const KIOSK_PERMISSION = 'team.roles' as const

export const NETWORK_HELP =
  'Do this from a phone or computer connected to the shop Wi-Fi — not mobile data. Every device on the shop Wi-Fi shares this address, so it doesn’t have to be the tablet.'
export const SUPER_ONLY_NOTE = 'Only a Super Admin can change the shop network'

export interface KioskCtx {
  api: KioskAdminApi
  /** A write needing team.roles under `name`; refetches GET /kiosk afterwards (a 409 or 412 too). */
  run<T>(name: string, request: (idem: string) => Promise<T>, o?: RunOptions): Promise<RunResult<T>>
  allowed(): boolean
  busy(name: string): boolean
  changed(): void
  flash(text: string): void
  tz(): string
  today(): string
  /** Full-page navigation: kiosk mode switched on the tablet itself ends this session, the keypad comes next. */
  navigate(url: string): void
  /** Copies a generated PIN (navigator.clipboard by default); false when the browser refused. */
  copy?(text: string): Promise<boolean>
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

async function clipboardCopy(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

const first = (name: string): string => name.split(' ')[0] || name

export class KioskSection {
  private modeError = ''
  // the shop network
  private networkLabel = ''
  private networkError = ''
  private confirmRemoveNetwork: string | null = null
  private confirmApprove: string | null = null
  // staff PINs: one row is edited at a time; a generated PIN is shown once, until Done
  private pinEdit: { id: string; pin1: string; pin2: string; error: string } | null = null
  private pinError: { id: string; text: string } | null = null
  private generated: { id: string; pin: string; copied: 'no' | 'yes' | 'failed' } | null = null
  private confirmRemovePin: string | null = null
  // shop browsers
  private renaming: { id: string; name: string; error: string } | null = null
  private confirmRevoke: string | null = null
  private confirmLockAll = false

  constructor(private readonly ctx: KioskCtx) {}

  private edit(fn: () => void): void {
    fn()
    this.ctx.changed()
  }

  // ---- kiosk mode -------------------------------------------------------------------------------------------------------

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
    // switched on the tablet itself: the manager is signed out here (K4 review kiosk:F1), the keypad is next
    if (r.data.signedOut) {
      this.ctx.navigate('/login')
      return
    }
    this.ctx.flash(next ? 'Kiosk mode is on · the sign-in page shows the PIN keypad' : 'Kiosk mode is off · every kiosk locked')
  }

  // ---- the shop network (Super Admin) -----------------------------------------------------------------------------------

  private async addThisNetwork(v: KioskOverview): Promise<void> {
    if (!this.ctx.allowed() || !v.canManageNetworks || !v.yourAddress) return
    const shown = v.yourAddress
    const label = this.networkLabel.trim().slice(0, 40) || null
    this.networkError = ''
    const r = await this.ctx.run(
      'kiosk:network:add',
      (idem) => this.ctx.api.addNetwork({ confirmAddress: shown, label }, { idempotencyKey: idem }),
      {
        // the connection's address is not the one shown (a phone that left the Wi-Fi): GET /kiosk is read again
        explain: (e: ApiError) => {
          if (e.code !== AUTH_CODES.kioskAddressChanged) return null
          const now = typeof e.meta.yourAddress === 'string' ? e.meta.yourAddress : ''
          return (
            (now ? 'Your connection changed to ' + now + '.' : 'Your connection changed.') +
            ' Check you’re on the shop Wi-Fi, then press the button again.'
          )
        },
      },
    )
    if (!r.ok) {
      this.edit(() => (this.networkError = r.message))
      return
    }
    this.edit(() => {
      this.networkLabel = ''
      this.networkError = ''
    })
    this.ctx.flash(
      r.data.created
        ? r.data.network.address + ' is a shop network · PINs work there now'
        : r.data.network.address + ' already was a shop network',
    )
  }

  private async approve(v: KioskOverview, t: KioskRefusedTry): Promise<void> {
    if (!this.ctx.allowed() || !v.canManageNetworks) return
    const r = await this.ctx.run('kiosk:network:approve:' + t.id, (idem) =>
      this.ctx.api.addNetwork({ address: t.address }, { idempotencyKey: idem }),
    )
    this.edit(() => (this.confirmApprove = null))
    if (!r.ok) {
      if (r.message) this.ctx.flash(r.message)
      return
    }
    this.ctx.flash(t.address + ' is a shop network · PINs work there now')
  }

  private async removeNetwork(v: KioskOverview, n: KioskNetwork): Promise<void> {
    if (!this.ctx.allowed() || !v.canManageNetworks) return
    const r = await this.ctx.run<unknown>('kiosk:network:remove:' + n.id, (idem) =>
      this.ctx.api.removeNetwork(n.id, { idempotencyKey: idem }),
    )
    this.edit(() => (this.confirmRemoveNetwork = null))
    if (!r.ok) {
      if (r.message) this.ctx.flash(r.message)
      return
    }
    this.ctx.flash(n.address + ' removed · PINs no longer work from it')
  }

  private async clearNetworkLockout(n: KioskNetwork): Promise<void> {
    if (!this.ctx.allowed()) return
    const r = await this.ctx.run('kiosk:network:clear:' + n.id, (idem) =>
      this.ctx.api.clearNetworkLockout(n.id, { idempotencyKey: idem }),
    )
    if (!r.ok) {
      if (r.message) this.ctx.flash(r.message)
      return
    }
    this.ctx.flash('PINs work again from ' + n.address)
  }

  // ---- staff PINs -------------------------------------------------------------------------------------------------------

  private async savePin(p: KioskStaffRow): Promise<void> {
    const ed = this.pinEdit
    if (!ed || ed.id !== p.id || !this.ctx.allowed()) return
    const problem = pinFormProblem(ed.pin1, ed.pin2)
    if (problem) {
      this.edit(() => (ed.error = problem))
      return
    }
    const pin = ed.pin1.trim()
    const r = await this.ctx.run('kiosk:pin:' + p.id, (idem) => this.ctx.api.setPin(p.id, { pin }, { idempotencyKey: idem }))
    if (!r.ok) {
      this.edit(() => {
        if (this.pinEdit?.id === p.id) this.pinEdit.error = r.message
      })
      return
    }
    this.edit(() => (this.pinEdit = null))
    this.ctx.flash(p.name + '’s PIN is set')
  }

  private async generatePin(p: KioskStaffRow): Promise<void> {
    if (!this.ctx.allowed()) return
    this.edit(() => {
      this.pinError = null
      this.generated = null
    })
    const r = await this.ctx.run('kiosk:pin:' + p.id, (idem) =>
      this.ctx.api.setPin(p.id, { generate: true }, { idempotencyKey: idem }),
    )
    if (!r.ok) {
      this.edit(() => (this.pinError = r.message ? { id: p.id, text: r.message } : null))
      return
    }
    this.edit(() => {
      this.pinEdit = null
      this.generated = r.data.pin ? { id: p.id, pin: r.data.pin, copied: 'no' } : null
    })
  }

  private async removePin(p: KioskStaffRow): Promise<void> {
    if (!this.ctx.allowed()) return
    const r = await this.ctx.run<unknown>('kiosk:pin:' + p.id, (idem) => this.ctx.api.removePin(p.id, { idempotencyKey: idem }))
    this.edit(() => (this.confirmRemovePin = null))
    if (!r.ok) {
      if (r.message) this.ctx.flash(r.message)
      return
    }
    if (this.generated?.id === p.id) this.edit(() => (this.generated = null))
    this.ctx.flash(p.name + '’s PIN removed · it no longer opens the kiosk')
  }

  private async copyGenerated(): Promise<void> {
    const g = this.generated
    if (!g) return
    const ok = await (this.ctx.copy ?? clipboardCopy)(g.pin)
    this.edit(() => {
      if (this.generated === g) g.copied = ok ? 'yes' : 'failed'
    })
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
    this.ctx.flash(listed ? name + ' shows on the kiosk' : name + ' no longer shows on the kiosk · their PIN doesn’t open it')
  }

  // ---- shop browsers -----------------------------------------------------------------------------------------------------

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
          ? d.name + ' can take PINs again'
          : d.name + ' removed · a PIN typed there later makes it a new shop browser',
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

  // ---- the template's values (live.kio.*) ---------------------------------------------------------------------------------

  vals(v: KioskOverview | undefined): Vals {
    if (!v) return { has: false, networks: [], refused: [], staff: [], devices: [], recent: [] }
    const tz = this.ctx.tz()
    const today = this.ctx.today()
    const mode = sw(v.enabled)
    const live = v.devices.filter((d) => d.state !== 'revoked')
    const staff = v.staff.filter((p) => p.status !== 'inactive')
    const manage = v.canManageNetworks
    const addBusy = this.ctx.busy('kiosk:network:add')
    return {
      has: true,
      // kiosk mode
      enabled: v.enabled,
      modeTrack: mode.track,
      modeKnob: mode.knob,
      modeToggle: () => void this.toggleMode(v),
      modeText: v.enabled
        ? 'On. The sign-in page is the PIN keypad: an employee’s PIN, at the shop, opens Operations until closing + 2 hours.'
        : 'Off. Everyone signs in with their email and password.',
      hasModeError: !!this.modeError,
      modeError: this.modeError,
      // the shop network
      yourLine: 'Your connection: ' + (v.yourAddress ?? 'unknown'),
      isShop: v.yourAddressIsShop,
      shopText: 'This is the shop’s network. PINs work here.',
      canAdd: manage && !v.yourAddressIsShop && !!v.yourAddress,
      notShopReadOnly: !manage && !v.yourAddressIsShop,
      notShopText: 'This connection isn’t a shop network.',
      readOnly: !manage,
      readOnlyText: SUPER_ONLY_NOTE,
      networkLabel: this.networkLabel,
      setNetworkLabel: (e: InputEvent) =>
        this.edit(() => {
          this.networkLabel = e.target.value.slice(0, 40)
          this.networkError = ''
        }),
      addNetwork: () => void this.addThisNetwork(v),
      addStyle: saveButtonStyle(!addBusy),
      addLabel: addBusy ? 'Adding…' : 'This is the shop’s network',
      networkHelp: NETWORK_HELP,
      hasNetworkError: !!this.networkError,
      networkError: this.networkError,
      networks: v.networks.map((n) => this.networkVals(v, n, tz, today)),
      noNetworks: v.networks.length === 0,
      noNetworksText: manage
        ? 'No shop network yet. PINs don’t work anywhere until you add one.'
        : 'No shop network yet. PINs don’t work anywhere until a Super Admin adds one.',
      hasRefused: v.refused.length > 0,
      refused: v.refused.map((t) => this.refusedVals(v, t, tz, today)),
      // staff PINs
      staff: staff.map((p) => this.staffVals(p, tz, today)),
      noStaff: staff.length === 0,
      // shop browsers
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
      // recent kiosk events
      recent: v.recent.map((r) => ({ line: recentLine(r, tz, today) })),
      noRecent: v.recent.length === 0,
    }
  }

  private networkVals(v: KioskOverview, n: KioskNetwork, tz: string, today: string): Vals {
    const st = networkState(n)
    const confirming = this.confirmRemoveNetwork === n.id
    return {
      title: networkTitle(n),
      line: networkLine(n, tz, today),
      hasState: !!st,
      state: st?.label ?? '',
      stateStyle: stateStyle(st?.tone ?? 'grey'),
      canClear: n.lockedOut || n.failedAttempts > 0,
      clear: () => void this.clearNetworkLockout(n),
      canRemove: v.canManageNetworks && !confirming,
      remove: () =>
        this.edit(() => {
          if (this.ctx.allowed() && v.canManageNetworks) this.confirmRemoveNetwork = n.id
        }),
      confirming,
      removeYes: () => void this.removeNetwork(v, n),
      removeNo: () => this.edit(() => (this.confirmRemoveNetwork = null)),
      buttonStyle: ghostButton,
    }
  }

  private refusedVals(v: KioskOverview, t: KioskRefusedTry, tz: string, today: string): Vals {
    const confirming = this.confirmApprove === t.id
    return {
      title: refusedTitle(t),
      line: refusedLine(t, tz, today),
      warn: !t.fromKnownBrowser,
      warning: REFUSED_WARNING,
      canAdd: v.canManageNetworks && !confirming,
      // a known shop browser: added at once; an unknown one asks first
      add: () => {
        if (!this.ctx.allowed() || !v.canManageNetworks) return
        if (t.fromKnownBrowser) void this.approve(v, t)
        else this.edit(() => (this.confirmApprove = t.id))
      },
      confirming,
      confirmText: 'Add ' + t.address + ' as a shop network? Anyone on it can then use a PIN.',
      addYes: () => void this.approve(v, t),
      addNo: () => this.edit(() => (this.confirmApprove = null)),
      buttonStyle: ghostButton,
    }
  }

  private staffVals(p: KioskStaffRow, tz: string, today: string): Vals {
    const listed = sw(p.listed)
    const ed = this.pinEdit?.id === p.id ? this.pinEdit : null
    const gen = this.generated?.id === p.id ? this.generated : null
    const removing = this.confirmRemovePin === p.id
    const busy = this.ctx.busy('kiosk:pin:' + p.id)
    const ready = !!ed && /^\d{8}$/.test(ed.pin1.trim()) && ed.pin2.trim().length === 8 && !busy
    const err = ed?.error || (this.pinError?.id === p.id ? this.pinError.text : '')
    const idle = !ed && !gen && !removing
    return {
      name: p.name,
      sub: (p.status === 'invited' ? 'Invited · ' : '') + pinLine(p.pin, tz, today) + (p.listed ? '' : ' · hidden on the kiosk'),
      track: listed.track,
      knob: listed.knob,
      toggle: () => void this.setListed(p.id, !p.listed, p.name),
      idle,
      setLabel: p.pin ? 'Change PIN' : 'Set PIN',
      openSet: () =>
        this.edit(() => {
          if (!this.ctx.allowed()) return
          this.pinEdit = { id: p.id, pin1: '', pin2: '', error: '' }
          this.pinError = null
          this.generated = null
          this.confirmRemovePin = null
        }),
      generate: () => void this.generatePin(p),
      generateLabel: busy && !ed ? 'Generating…' : 'Generate',
      canRemove: !!p.pin,
      remove: () =>
        this.edit(() => {
          if (!this.ctx.allowed()) return
          this.confirmRemovePin = p.id
          this.pinEdit = null
        }),
      removing,
      removeText: 'Remove ' + first(p.name) + '’s PIN? It stops opening the kiosk right away.',
      removeYes: () => void this.removePin(p),
      removeNo: () => this.edit(() => (this.confirmRemovePin = null)),
      // typing a PIN
      editing: !!ed,
      pin1: ed?.pin1 ?? '',
      pin2: ed?.pin2 ?? '',
      setPin1: (e: InputEvent) =>
        this.edit(() => {
          if (this.pinEdit?.id !== p.id) return
          this.pinEdit.pin1 = e.target.value.replace(/\D/g, '').slice(0, 8)
          this.pinEdit.error = ''
        }),
      setPin2: (e: InputEvent) =>
        this.edit(() => {
          if (this.pinEdit?.id !== p.id) return
          this.pinEdit.pin2 = e.target.value.replace(/\D/g, '').slice(0, 8)
          this.pinEdit.error = ''
        }),
      savePin: () => void this.savePin(p),
      saveStyle: saveButtonStyle(ready),
      saveLabel: busy ? 'Saving…' : 'Save PIN',
      cancelSet: () => this.edit(() => (this.pinEdit = null)),
      hasError: !!err,
      error: err,
      // a generated PIN, shown once
      hasGenerated: !!gen,
      generatedPin: gen ? groupPin(gen.pin) : '',
      generatedFor: 'The new PIN for ' + first(p.name),
      copy: () => void this.copyGenerated(),
      copyLabel: gen?.copied === 'yes' ? 'Copied' : 'Copy',
      copyFailed: gen?.copied === 'failed',
      doneGenerated: () => this.edit(() => (this.generated = null)),
      buttonStyle: ghostButton,
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
      hasOpenedBy: d.state === 'unlocked' && !!d.openedBy,
      openedBy: d.openedBy ? 'Opened by ' + d.openedBy : '',
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
