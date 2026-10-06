// Theme persistence. The source of truth is the per-user server preference (PUT /me/preferences). The
// `oasis-theme` localStorage key (the one the designs already use) is only the pre-hydration cache: it is read
// before paint so a reload does not flash the wrong theme, overwritten by the server value once /me has loaded,
// and cleared on sign-out.
import type { Theme } from './http/auth-types'

export const THEME_KEY = 'oasis-theme'
export const DEFAULT_THEME: Theme = 'light'

export const isTheme = (v: unknown): v is Theme => v === 'light' || v === 'dark'

/** Inline script for <head>: sets <html data-theme> from the cache before first paint. */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem('${THEME_KEY}');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}`

export function readThemeCache(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Theme | null {
  try {
    const v = storage?.getItem(THEME_KEY)
    return isTheme(v) ? v : null
  } catch {
    return null
  }
}

export function writeThemeCache(
  theme: Theme,
  storage: Pick<Storage, 'setItem'> | null = safeStorage(),
): void {
  try {
    storage?.setItem(THEME_KEY, theme)
  } catch {
    // private mode or blocked storage: the cache is optional
  }
}

export function clearThemeCache(storage: Pick<Storage, 'removeItem'> | null = safeStorage()): void {
  try {
    storage?.removeItem(THEME_KEY)
  } catch {
    // ignore
  }
}

/** Mirrors the theme to <html data-theme>. (The screens keep data-theme on their own wrapper as designed.) */
export function applyDocumentTheme(
  theme: Theme,
  doc: Document | null = typeof document === 'undefined' ? null : document,
): void {
  doc?.documentElement.setAttribute('data-theme', theme)
}

/** The theme to show: the server preference wins, then the cache, then light. */
export const resolveTheme = (server: Theme | null | undefined, cached: Theme | null): Theme =>
  server ?? cached ?? DEFAULT_THEME

/**
 * Applies the server preference locally (cache + <html>) once the session has loaded. Returns the theme in effect and
 * whether it differs from what the cache said (the verbatim classes read the cache at construction, so a screen that
 * was already mounted with the old theme needs to be told).
 */
export function adoptServerTheme(server: Theme | null | undefined): { theme: Theme; changed: boolean } {
  const cached = readThemeCache()
  const theme = resolveTheme(server, cached)
  if (server) writeThemeCache(server)
  applyDocumentTheme(theme)
  return { theme, changed: server != null && cached !== null && cached !== server }
}

export interface ThemeSaver {
  put(theme: Theme): Promise<unknown>
  /** Called with the previous theme when the save fails, so the screen can undo its optimistic toggle. */
  onRollback?: (previous: Theme) => void
}

/** Optimistic: cache and <html> change at once, then the server is told; a failure restores the previous theme. */
export async function persistTheme(next: Theme, previous: Theme, saver: ThemeSaver): Promise<boolean> {
  writeThemeCache(next)
  applyDocumentTheme(next)
  try {
    await saver.put(next)
    return true
  } catch {
    writeThemeCache(previous)
    applyDocumentTheme(previous)
    saver.onRollback?.(previous)
    return false
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}
