// The live chrome: what the live-variant template patches read as `{{ live.* }}` (header user chip, sign-out menu,
// view-as button and its "Viewing as X" bar), and the actions behind them.
//
// It is a plain external store. The three screens still run their original logic classes, which know nothing about
// the session; the compiler's live variant appends a small bridge to each logic source (tools/dc-compile/live-bridge.ts)
// that merges `liveChrome.vals()` into renderVals() and re-renders the screen when the store changes. A converted view
// model does the same by calling `liveChrome.vals()` and `liveChrome.subscribe()` directly.
//
// Kiosk mode (ADR 0180, DV-1003, DV-1004, DV-1008, DV-1012): on the shop's unlocked tablet the chip names the device and
// its lock time, the menu says "Lock kiosk" (with a confirm) and "Manager sign-in", and Payments, Settings and the
// "Manage" links are hidden (`showAdminNav`); the employee picker's values are here too (`kiosk.picker`). A person
// signed in on a kiosk device sees a bar; a person who may manage kiosks gets "Make this a kiosk…" in the menu.
import { toasts } from '@/data/toast'
import type { ToastSpec } from '@/data/toast'
import { businessClock } from '@/lib/tz'
import { KioskPicker } from './kiosk-picker'
import type { PickerVals } from './kiosk-picker'
import { can } from './session-model'
import type { Session } from './session-model'

export interface ViewAsEntry {
  name: string
  /** "refunds ≤ $1000", "refunds no limit" or "no refunds" (Payments role-menu wording). */
  lim: string
  style: Record<string, string>
  onClick: () => void
}

export interface LiveVals {
  /** `short` is the chip form, "Rafael M."; `name` is the full name. */
  user: { initials: string; name: string; short: string; email: string; roleTitle: string }
  menu: {
    open: boolean
    toggle: () => void
    signOut: () => void
    /** "Sign out", or "Lock kiosk" on the shop's tablet. */
    signOutLabel: string
    /** Kiosk: "Lock kiosk" asks first; these confirm or keep it open. */
    confirming: boolean
    /** The sign-out (or "Lock kiosk") entry, hidden while the lock asks first. */
    showSignOut: boolean
    confirmLock: () => void
    cancelLock: () => void
    /** Kiosk: "Manager sign-in" (the sign-in page; the email form is behind 0218). */
    isKiosk: boolean
    managerSignIn: () => void
    /** A person who may manage kiosks (team.roles), not already on one: "Make this a kiosk…" opens Settings → Kiosk. */
    canMakeKiosk: boolean
    makeKiosk: () => void
  }
  /** Payments, Settings and the "Manage" links; false on a kiosk (DV-1004). */
  showAdminNav: boolean
  kiosk: { on: boolean; picker: PickerVals }
  /** A person signed in on a kiosk device (DV-1008): "Signed in as Rafael M. on Front desk tablet · …". */
  adminKiosk: { on: boolean; text: string; signOut: () => void }
  canViewAs: boolean
  viewAs: {
    active: boolean
    /** Role named on the "Preview as" button: the viewed role, else the person's own. */
    label: string
    menuOpen: boolean
    toggleMenu: () => void
    exit: () => void
    options: ViewAsEntry[]
  }
}

export interface ChromeActions {
  /** Sign out, or lock the kiosk (the session decides). */
  signOut(): void
  /** Full-page navigation (window.location.assign by default). */
  navigate?(url: string): void
  viewAs(roleId: string | null): Promise<void> | void
  /** The theme was toggled inside a screen; persist it (PUT /me/preferences). */
  themeChanged?(theme: 'light' | 'dark', previous: 'light' | 'dark'): void
}

type Listener = () => void

const NOOP = (): void => {}

/** "Rafael Mendes" -> "Rafael M." (the chip's form in the designs); single names stay as they are. */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) return parts[0] ?? ''
  return `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.`
}

const limText = (v: number | null | undefined): string =>
  v === undefined ? 'no refunds' : v === null ? 'refunds no limit' : `refunds ≤ $${Math.round(v / 100)}`

export class LiveChrome {
  /** The kiosk's employee picker (used only while the session is a kiosk). */
  readonly picker: KioskPicker
  private session: Session | null = null
  private userMenuOpen = false
  private lockConfirm = false
  private viewAsMenuOpen = false
  private listeners = new Set<Listener>()
  private actions: ChromeActions = { signOut: NOOP, viewAs: NOOP }
  private cached: LiveVals | null = null

  constructor(picker: KioskPicker = new KioskPicker()) {
    this.picker = picker
    this.picker.subscribe(() => this.invalidate())
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  bind(actions: ChromeActions): void {
    this.actions = actions
    this.invalidate()
  }

  setSession(s: Session | null): void {
    this.session = s
    if (s?.kiosk) this.picker.setStaff(s.kiosk.staff)
    else if (this.picker.people().length) this.picker.setStaff([])
    this.invalidate()
  }

  getSession(): Session | null {
    return this.session
  }

  get hasSession(): boolean {
    return this.session !== null
  }

  toggleUserMenu = (): void => {
    this.userMenuOpen = !this.userMenuOpen
    this.viewAsMenuOpen = false
    this.lockConfirm = false
    this.invalidate()
  }
  toggleViewAsMenu = (): void => {
    this.viewAsMenuOpen = !this.viewAsMenuOpen
    this.userMenuOpen = false
    this.invalidate()
  }
  closeMenus = (): void => {
    if (!this.userMenuOpen && !this.viewAsMenuOpen) return
    this.userMenuOpen = false
    this.viewAsMenuOpen = false
    this.lockConfirm = false
    this.invalidate()
  }

  private navigate(url: string): void {
    if (this.actions.navigate) this.actions.navigate(url)
    else if (typeof window !== 'undefined') window.location.assign(url)
  }

  /** The bridge forwards API-layer toasts (errors, "Connection lost") to the screen's own flash(). */
  subscribeToasts(fn: (t: ToastSpec) => void): () => void {
    return toasts.subscribe(fn)
  }

  /** Called by the bridge when a screen toggled its theme. */
  themeChanged(theme: 'light' | 'dark', previous: 'light' | 'dark'): void {
    this.actions.themeChanged?.(theme, previous)
  }

  private invalidate(): void {
    this.cached = null
    for (const l of [...this.listeners]) l()
  }

  /** The current `live.*` values. Stable between changes (the same object until the store changes). */
  vals(): LiveVals {
    if (this.cached) return this.cached
    const s = this.session
    const active = s?.viewAs.active ?? false
    const selected = s?.viewAs.roleId ?? null
    const options: ViewAsEntry[] = (s?.viewAs.options ?? []).map((o) => ({
      name: o.name,
      lim: limText(o.limits.refund as number | null | undefined),
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '1px',
        width: '100%',
        padding: '9px 10px',
        borderRadius: '10px',
        background: (active ? selected === o.id : o.locked) ? 'var(--accentSoft)' : 'transparent',
      },
      onClick: () => {
        this.viewAsMenuOpen = false
        this.invalidate()
        void this.actions.viewAs(o.locked ? null : o.id)
      },
    }))
    const k = s?.kiosk ?? null
    const tz = s?.businessTz ?? ''
    const clock = (iso: string): string => {
      const ms = Date.parse(iso)
      return Number.isFinite(ms) && tz ? businessClock(ms, tz) : ''
    }
    const signOut = () => {
      this.userMenuOpen = false
      this.lockConfirm = false
      this.invalidate()
      this.actions.signOut()
    }
    this.cached = {
      user: k
        ? {
            initials: 'K',
            name: k.deviceName,
            short: k.deviceName,
            email: 'Unlocked ' + clock(k.unlockedAt) + ' · locks ' + k.locksAtLabel,
            roleTitle: 'Locks at ' + k.locksAtLabel,
          }
        : {
            initials: s?.user.initials ?? '',
            name: s?.user.name ?? '',
            short: shortName(s?.user.name ?? ''),
            email: s?.user.email ?? '',
            roleTitle: s?.roleTitle ?? '',
          },
      menu: {
        open: this.userMenuOpen,
        toggle: this.toggleUserMenu,
        signOut: k
          ? () => {
              this.lockConfirm = true
              this.invalidate()
            }
          : signOut,
        signOutLabel: k ? 'Lock kiosk' : 'Sign out',
        confirming: !!k && this.lockConfirm,
        showSignOut: !(k && this.lockConfirm),
        confirmLock: signOut,
        cancelLock: () => {
          this.lockConfirm = false
          this.invalidate()
        },
        isKiosk: !!k,
        managerSignIn: () => this.navigate('/login?admin=1'),
        canMakeKiosk: !k && !!s && !s.kioskDevice && can(s, 'team.roles'),
        makeKiosk: () => {
          this.userMenuOpen = false
          this.invalidate()
          this.navigate('/settings#kiosk')
        },
      },
      showAdminNav: !k,
      kiosk: { on: !!k, picker: this.picker.vals() },
      adminKiosk: {
        on: !k && !!s?.kioskDevice,
        text: s?.kioskDevice
          ? 'Signed in as ' +
            shortName(s.user.name) +
            ' on ' +
            s.kioskDevice.name +
            ' · signs out after 15 minutes without use'
          : '',
        signOut,
      },
      canViewAs: s?.viewAs.canViewAs ?? false,
      viewAs: {
        active,
        label: s?.viewAs.roleName ?? s?.roleTitle ?? '',
        menuOpen: this.viewAsMenuOpen,
        toggleMenu: this.toggleViewAsMenu,
        exit: () => void this.actions.viewAs(null),
        options,
      },
    }
    return this.cached
  }
}

export const liveChrome = new LiveChrome()

/** The bridge appended to the logic sources reaches the store through this global (set by installLiveChrome). */
export const CHROME_GLOBAL = '__oasisLive'

declare global {
  interface Window {
    __oasisLive?: LiveChrome
  }
}

export function installLiveChrome(chrome: LiveChrome = liveChrome): void {
  if (typeof window !== 'undefined') window.__oasisLive = chrome
}
