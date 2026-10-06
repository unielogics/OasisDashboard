import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const ORIGINAL_DIR = path.join(ROOT, 'design', 'original')
export const PARITY_DIR = path.join(ROOT, 'parity')
export const FONTS_DIR = path.join(PARITY_DIR, 'fonts')
export const FONTCONFIG_FILE = path.join(PARITY_DIR, 'fontconfig', 'fonts.conf')
export const ALLOWLIST_FILE = path.join(PARITY_DIR, 'allowlist.json')
export const TOLERANCES_FILE = path.join(PARITY_DIR, 'tolerances.json')
export const CONSOLE_BASELINE_FILE = path.join(PARITY_DIR, 'console-baseline.json')
export const REPORTS_DIR = path.join(ROOT, 'parity-reports')

export const SCREENS = ['operations', 'payments', 'settings'] as const
export type Screen = (typeof SCREENS)[number]
export const THEMES = ['light', 'dark'] as const
export type Theme = (typeof THEMES)[number]
export type Side = 'orig' | 'port'

/** Frozen "now" of the designs (Saturday, June 13 2026, 10:36 AM Eastern). The explicit offset is mandatory. */
export const FIXED_NOW = process.env.PARITY_FIXED_NOW ?? '2026-06-13T10:36:00-04:00'
export const TIMEZONE = process.env.PARITY_TZ ?? 'America/New_York'
export const LOCALE = process.env.PARITY_LOCALE ?? 'en-US'
/** Every screen is verified at 1480x1000 (the cc `$preview` size); other viewports are informational only. */
export const VIEWPORT = { width: 1480, height: 1000 } as const

export const DEFAULT_ORIGINAL_PORT = 4310
export const DEFAULT_PORT_URL = 'http://127.0.0.1:3100'

/** Path of each screen on the port (full page loads, the Next production build run with NEXT_PUBLIC_PARITY=1). */
export const PORT_PATHS: Record<Screen, string> = {
  operations: '/operations',
  payments: '/payments',
  settings: '/settings',
}

export const CHROMIUM_FLAGS = [
  '--disable-dev-shm-usage',
  '--force-color-profile=srgb',
  '--font-render-hinting=none',
  '--disable-lcd-text',
]

/** localStorage key every screen reads its theme from. */
export const THEME_KEY = 'oasis-theme'

export function isScreen(v: string): v is Screen {
  return (SCREENS as readonly string[]).includes(v)
}
export function isTheme(v: string): v is Theme {
  return (THEMES as readonly string[]).includes(v)
}
