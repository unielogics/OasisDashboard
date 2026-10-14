// An unlocked kiosk away from the shop (ADR 0180 A13, K-PIN-DASH D3; DEVIATIONS DV-1016). The server answers every call of
// a kiosk session from an address that is not a shop network with 403 KIOSK_NOT_AT_SHOP and keeps the session. The page
// then covers the board with "This tablet works only on the shop's Wi-Fi", holds every call (nothing is sent, nothing
// loops), reads the public GET /kiosk/status every 30 s and when the page comes back into view or online, and removes
// the cover by itself once `atShop` is true again (then reads everything again). The only way out is "Manager sign-in".
import { AUTH_CODES } from '@/data/http/auth-types'
import type { KioskStatus } from '@/data/http/auth-types'
import { ApiError } from '@/data/http/problem'

/** Why the board is covered: `networkSet` false means a Super Admin removed every shop network meanwhile. */
export interface KioskAway {
  networkSet: boolean
}

/** The kiosk-away answer in an error, or null. */
export function awayOf(err: unknown): KioskAway | null {
  if (!(err instanceof ApiError) || err.status !== 403 || err.code !== AUTH_CODES.kioskNotAtShop) return null
  return { networkSet: err.meta.networkSet !== false }
}

export const AWAY_TEXT = {
  title: 'This tablet works only on the shop’s Wi-Fi',
  text: 'Connect it to the shop Wi-Fi. The board comes back by itself — no PIN needed.',
  noNetworkTitle: 'A Super Admin must set the shop network first — Settings → Kiosk',
  noNetworkText: 'The board comes back by itself once it’s set.',
  managerSignIn: 'Manager sign-in',
} as const

export function awayCopy(a: KioskAway): { title: string; text: string } {
  return a.networkSet
    ? { title: AWAY_TEXT.title, text: AWAY_TEXT.text }
    : { title: AWAY_TEXT.noNetworkTitle, text: AWAY_TEXT.noNetworkText }
}

/** How often the cover reads GET /kiosk/status again (and on focus, visibility and online). */
export const AWAY_RECHECK_MS = 30_000

/**
 * What a fresh GET /kiosk/status means for a covered board:
 *   back    on a shop network again: remove the cover and read everything again;
 *   ended   the kiosk session is gone meanwhile (locked, lock time, kiosk mode off): the keypad;
 *   stay    still away (the networkSet text may change).
 */
export type AwayStep = { kind: 'back' } | { kind: 'ended' } | { kind: 'stay'; away: KioskAway }

export function awayStep(s: Pick<KioskStatus, 'enabled' | 'networkSet' | 'atShop' | 'unlocked'>): AwayStep {
  if (!s.enabled || !s.unlocked) return { kind: 'ended' }
  if (s.atShop) return { kind: 'back' }
  return { kind: 'stay', away: { networkSet: s.networkSet } }
}
