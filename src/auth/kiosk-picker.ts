// The kiosk's employee picker (ADR 0180, design section 6.5; DEVIATIONS DV-1005, DV-1006). On the shop's unlocked tablet
// every write names the employee doing it: they tap their name (no PIN, the owner's choice). This store holds the
// list, the open question and the "sticky" choices, and gives the template its values under `live.kiosk.picker`
// (merged into the live chrome, so the screen re-renders when it changes).
//
//   pick({ title })            opens the picker; resolves the employee id, or null when it was cancelled
//   pick({ title, sticky: k }) reuses the person picked for `k` (an open file) within 2 minutes of activity; each use
//                              starts the 2 minutes again
//   acting(k) / change(k)      the "As Marco R. · Change" chip of an open file; forget(k) when the file closes
//
// No name is preselected (a quick tap must not pick the wrong person). Bay staff first, then by first name, as the
// server orders them. Cancel, a tap outside or Esc cancels; Tab stays inside the dialog while it is open.
import type { KioskPerson } from '@/data/http/auth-types'
import { serverNow } from '@/lib/clock'

/** How long a choice sticks to an open file after its last use. */
export const STICKY_MS = 2 * 60_000

export interface PickRequest {
  /** "Who’s putting Maria’s Camry in Bay 2?" */
  title: string
  /** The open file the choice sticks to (texts, add-ons, checklist, photos, notes); none for the car steps. */
  sticky?: string
}

interface Open {
  title: string
  sticky?: string
  resolve: (id: string | null) => void
}

export interface PickerTile {
  id: string
  name: string
  initials: string
  title: string
  avatarStyle: Record<string, string>
  onClick: () => void
}

export interface PickerVals {
  open: boolean
  title: string
  tiles: PickerTile[]
  empty: boolean
  cancel: () => void
  /** The dialog itself: a click inside does not reach the backdrop's cancel. */
  stop: (e: { stopPropagation(): void }) => void
}

const TILE_COLOURS = ['#0E7A63', '#2563EB', '#7A3B8A', '#C2740B', '#0D9488', '#B45309', '#6B7280']

const avatarStyle = (p: KioskPerson, i: number): Record<string, string> => ({
  width: '48px',
  height: '48px',
  borderRadius: '14px',
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: '800',
  fontSize: '16px',
  color: '#fff',
  background: p.avatarColor || TILE_COLOURS[i % TILE_COLOURS.length]!,
})

export class KioskPicker {
  private staff: KioskPerson[] = []
  private current: Open | null = null
  private sticky = new Map<string, { id: string; at: number }>()
  private listeners = new Set<() => void>()
  private cached: PickerVals | null = null
  private keyOff: (() => void) | null = null
  private returnFocus: HTMLElement | null = null

  constructor(private readonly now: () => number = serverNow) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  private changed(): void {
    this.cached = null
    for (const l of [...this.listeners]) l()
  }

  setStaff(list: readonly KioskPerson[]): void {
    this.staff = [...list]
    // a person no longer listed cannot stay the acting one of a file
    for (const [k, v] of this.sticky) if (!this.staff.some((p) => p.id === v.id)) this.sticky.delete(k)
    this.changed()
  }

  people(): readonly KioskPerson[] {
    return this.staff
  }

  get isOpen(): boolean {
    return this.current !== null
  }

  /** The person whose choice still sticks to `key`, or null. */
  acting(key: string | null | undefined): KioskPerson | null {
    if (!key) return null
    const s = this.sticky.get(key)
    if (!s) return null
    if (this.now() - s.at > STICKY_MS) {
      this.sticky.delete(key)
      return null
    }
    return this.staff.find((p) => p.id === s.id) ?? null
  }

  pick(req: PickRequest): Promise<string | null> {
    const held = this.acting(req.sticky)
    if (held && req.sticky) {
      this.sticky.set(req.sticky, { id: held.id, at: this.now() })
      return Promise.resolve(held.id)
    }
    return this.ask(req)
  }

  /** "Change" on the chip: asks again for that file; the new choice sticks. */
  change(key: string, title = 'Who’s working on this car?'): Promise<string | null> {
    return this.ask({ title, sticky: key })
  }

  /** The file closed: its choice is forgotten. */
  forget(key: string | null | undefined): void {
    if (key && this.sticky.delete(key)) this.changed()
  }

  forgetAll(): void {
    if (!this.sticky.size) return
    this.sticky.clear()
    this.changed()
  }

  private ask(req: PickRequest): Promise<string | null> {
    // a second question while one is open replaces it; the first one is cancelled
    this.finish(null)
    return new Promise((resolve) => {
      this.current = { title: req.title, sticky: req.sticky, resolve }
      this.listen()
      this.changed()
      this.focusFirst()
    })
  }

  choose(id: string): void {
    const c = this.current
    if (!c || !this.staff.some((p) => p.id === id)) return
    if (c.sticky) this.sticky.set(c.sticky, { id, at: this.now() })
    this.finish(id)
  }

  cancel = (): void => {
    this.finish(null)
  }

  private finish(id: string | null): void {
    const c = this.current
    if (!c) return
    this.current = null
    this.unlisten()
    this.changed()
    c.resolve(id)
    const back = this.returnFocus
    this.returnFocus = null
    if (back && typeof back.focus === 'function' && back.isConnected) back.focus()
  }

  // ---- keyboard: Esc cancels, Tab stays in the dialog, the screen's own shortcuts wait ----------------------------------

  private listen(): void {
    if (this.keyOff || typeof window === 'undefined') return
    const active = typeof document !== 'undefined' ? document.activeElement : null
    this.returnFocus = active instanceof HTMLElement ? active : null
    const onKey = (e: KeyboardEvent) => {
      if (!this.current) return
      // the board's shortcuts (s, r, n, m, p, Esc) must not act behind the dialog
      e.stopPropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        this.cancel()
        return
      }
      if (e.key === 'Tab') this.trapTab(e)
    }
    window.addEventListener('keydown', onKey, true)
    this.keyOff = () => window.removeEventListener('keydown', onKey, true)
  }

  private unlisten(): void {
    this.keyOff?.()
    this.keyOff = null
  }

  private focusables(): HTMLElement[] {
    if (typeof document === 'undefined') return []
    const root = document.querySelector('[data-kiosk-picker]')
    return root ? Array.from(root.querySelectorAll<HTMLElement>('button')) : []
  }

  private trapTab(e: KeyboardEvent): void {
    const f = this.focusables()
    if (!f.length) return
    const i = f.indexOf(document.activeElement as HTMLElement)
    e.preventDefault()
    const next = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i < 0 || i >= f.length - 1 ? 0 : i + 1
    f[next]!.focus()
  }

  private focusFirst(): void {
    if (typeof window === 'undefined') return
    // after the screen rendered the dialog
    setTimeout(() => {
      if (!this.current) return
      const f = this.focusables()
      f[0]?.focus()
    }, 0)
  }

  // ---- the template's values ------------------------------------------------------------------------------------------

  vals(): PickerVals {
    if (this.cached) return this.cached
    const c = this.current
    const tiles: PickerTile[] = c
      ? this.staff.map((p, i) => ({
          id: p.id,
          name: p.name,
          initials: p.initials,
          title: p.title,
          avatarStyle: avatarStyle(p, i),
          onClick: () => this.choose(p.id),
        }))
      : []
    this.cached = {
      open: !!c,
      title: c?.title ?? '',
      tiles,
      empty: !!c && tiles.length === 0,
      cancel: this.cancel,
      stop: (e) => e.stopPropagation(),
    }
    return this.cached
  }
}

/** "Maria’s Toyota Camry" from a client name and a car (a model year is dropped); "this car" without a name. */
export function carOf(customer: string | null | undefined, vehicle: string | null | undefined): string {
  const first = (customer ?? '').trim().split(/\s+/)[0] ?? ''
  const car = (vehicle ?? '')
    .split('·')[0]!
    .trim()
    .split(/\s+/)
    .filter((w) => w && !/^\d{4}$/.test(w))
    .join(' ')
  if (first && car) return first + '’s ' + car
  if (first) return first + '’s car'
  return 'this car'
}
