// The live chrome: what the live-variant template patches read as `{{ live.* }}` (header user chip, sign-out menu,
// view-as button and its "Viewing as X" bar), and the actions behind them.
//
// It is a plain external store. The three screens still run their original logic classes, which know nothing about
// the session; the compiler's live variant appends a small bridge to each logic source (tools/dc-compile/live-bridge.ts)
// that merges `liveChrome.vals()` into renderVals() and re-renders the screen when the store changes. A converted view
// model does the same by calling `liveChrome.vals()` and `liveChrome.subscribe()` directly.
import { toasts } from '@/data/toast'
import type { ToastSpec } from '@/data/toast'
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
  menu: { open: boolean; toggle: () => void; signOut: () => void }
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
  signOut(): void
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
  private session: Session | null = null
  private userMenuOpen = false
  private viewAsMenuOpen = false
  private listeners = new Set<Listener>()
  private actions: ChromeActions = { signOut: NOOP, viewAs: NOOP }
  private cached: LiveVals | null = null

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
    this.invalidate()
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
    this.cached = {
      user: {
        initials: s?.user.initials ?? '',
        name: s?.user.name ?? '',
        short: shortName(s?.user.name ?? ''),
        email: s?.user.email ?? '',
        roleTitle: s?.roleTitle ?? '',
      },
      menu: {
        open: this.userMenuOpen,
        toggle: this.toggleUserMenu,
        signOut: () => this.actions.signOut(),
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
