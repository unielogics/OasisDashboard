// Toast plumbing. The designs own the toast component (each logic class has flash() and renders its own element);
// this module only carries the message. A screen's logic subscribes with `toasts.subscribe` (or calls
// `toastText`/`toastSpec` from its flash) and the live data layer emits through `toasts.emit`.
import { ApiError } from './http/problem'
import { deniedTitle, isPermissionKey } from '@/auth/permissions'

export interface ToastSpec {
  title: string
  desc?: string
}

type Listener = (t: ToastSpec) => void

/** How long a toast raised while no screen is listening waits for one (the screens load a moment after the stream). */
const PENDING_MS = 4000
const MAX_PENDING = 3

export class ToastBus {
  private listeners = new Set<Listener>()
  private pending: Array<{ toast: ToastSpec; timer: ReturnType<typeof setTimeout> }> = []

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    // A toast raised before the first screen mounted (the stream failing right after the session loads) is shown now.
    const waiting = this.pending
    this.pending = []
    for (const w of waiting) {
      clearTimeout(w.timer)
      fn(w.toast)
    }
    return () => void this.listeners.delete(fn)
  }

  emit(t: ToastSpec): void {
    if (this.listeners.size === 0) {
      if (this.pending.length >= MAX_PENDING) clearTimeout(this.pending.shift()!.timer)
      const entry = {
        toast: t,
        timer: setTimeout(() => {
          this.pending = this.pending.filter((p) => p !== entry)
        }, PENDING_MS),
      }
      this.pending.push(entry)
      return
    }
    for (const l of [...this.listeners]) l(t)
  }

  get size(): number {
    return this.listeners.size
  }
}

export const toasts = new ToastBus()

/** One line, for the Payments and Settings toast (a single string). */
export const toastText = (t: ToastSpec): string => (t.desc ? `${t.title} · ${t.desc}` : t.title)

export interface ToastContext {
  /** Completes "Your role can’t …" when the server did not name the missing permission. */
  denyLabel?: string
}

/**
 * The toast for a failed request. Server guard messages are shown as sent (title and detail are the design's
 * strings); 403 becomes "Your role can’t …"; network and 5xx get plain wording that never leaks internals.
 */
export function toastForError(err: unknown, ctx: ToastContext = {}): ToastSpec {
  if (!(err instanceof ApiError)) return { title: 'Something went wrong', desc: 'Please try again.' }
  if (err.isForbidden && err.code === 'FORBIDDEN') {
    const required = err.meta.required
    const key =
      typeof required === 'string'
        ? required
        : Array.isArray(required) && typeof required[0] === 'string'
          ? required[0]
          : undefined
    if (key && isPermissionKey(key)) return { title: deniedTitle(key) }
    return { title: `Your role can’t ${ctx.denyLabel ?? 'do that'}` }
  }
  if (err.isNetwork) return { title: 'Connection lost', desc: 'Check your connection and try again.' }
  if (err.status >= 500) return { title: err.title, desc: 'Please try again in a moment.' }
  return err.detail ? { title: err.title, desc: err.detail } : { title: err.title }
}
