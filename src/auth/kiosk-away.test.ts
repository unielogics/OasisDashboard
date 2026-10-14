import { describe, expect, it } from 'vitest'
import { ApiError } from '@/data/http/problem'
import { AWAY_RECHECK_MS, AWAY_TEXT, awayCopy, awayOf, awayStep } from './kiosk-away'

const STATUS = {
  enabled: true,
  networkSet: true,
  atShop: false,
  unlocked: { locksAt: '2026-06-14T01:00:00Z', locksAtLabel: '9:00 PM' },
}

describe('a kiosk away from the shop (ADR 0180 A13)', () => {
  it('reads 403 KIOSK_NOT_AT_SHOP (and its networkSet) out of an error; nothing else', () => {
    const e = (meta: Record<string, unknown>) => new ApiError({ status: 403, code: 'KIOSK_NOT_AT_SHOP', title: 'x', meta })
    expect(awayOf(e({ networkSet: true }))).toEqual({ networkSet: true })
    expect(awayOf(e({ networkSet: false }))).toEqual({ networkSet: false })
    expect(awayOf(e({}))).toEqual({ networkSet: true })
    expect(awayOf(new ApiError({ status: 403, code: 'KIOSK_FORBIDDEN', title: 'x' }))).toBeNull()
    expect(awayOf(new ApiError({ status: 401, code: 'UNAUTHENTICATED', title: 'x' }))).toBeNull()
    expect(awayOf(new Error('x'))).toBeNull()
    expect(awayOf(null)).toBeNull()
  })

  it('the cover’s words: the shop’s Wi-Fi, or no shop network yet', () => {
    expect(awayCopy({ networkSet: true })).toEqual({
      title: 'This tablet works only on the shop’s Wi-Fi',
      text: 'Connect it to the shop Wi-Fi. The board comes back by itself — no PIN needed.',
    })
    expect(awayCopy({ networkSet: false })).toEqual({
      title: 'A Super Admin must set the shop network first — Settings → Kiosk',
      text: 'The board comes back by itself once it’s set.',
    })
    expect(AWAY_TEXT.managerSignIn).toBe('Manager sign-in')
    expect(AWAY_RECHECK_MS).toBe(30_000)
  })

  it('a fresh status: back at the shop, still away, or the session is gone', () => {
    expect(awayStep({ ...STATUS, atShop: true })).toEqual({ kind: 'back' })
    expect(awayStep(STATUS)).toEqual({ kind: 'stay', away: { networkSet: true } })
    expect(awayStep({ ...STATUS, networkSet: false })).toEqual({ kind: 'stay', away: { networkSet: false } })
    expect(awayStep({ ...STATUS, unlocked: null })).toEqual({ kind: 'ended' })
    expect(awayStep({ ...STATUS, atShop: true, unlocked: null })).toEqual({ kind: 'ended' })
    expect(awayStep({ ...STATUS, enabled: false })).toEqual({ kind: 'ended' })
  })
})
