// Settings → Billing & integrations and the Memberships tab's Square words (ADR 0171; DV-908, DV-909), pure: the Square row
// and the connection checks in plain words, the server's switches, the forms' checks, Sync to Square's answer, and the
// notice "Move members" sends with its date.
import { describe, expect, it } from 'vitest'
import { billingFixture } from '@/screens/settings/live/extras-testkit'
import {
  checkLines,
  feesBody,
  lastTestText,
  moveMembersPreview,
  moveToast,
  noticeBody,
  noticeDate,
  parseDollars,
  policyBody,
  policyText,
  priceSquareText,
  processingLines,
  squareStatus,
  syncToast,
  testToast,
} from './billing'

describe('the Square row and Test connection', () => {
  it('the defaults: the simulator, nothing reaches Square, the warnings as the server words them', () => {
    const b = billingFixture()
    expect(squareStatus(b.square)).toEqual({
      headline: 'Square simulator (nothing reaches Square)',
      tone: 'ink',
      missing: [],
      warnings: ['Squarespace is still the processor', 'Square simulator: nothing reaches Square'],
    })
  })
  it('live: set up, or what is still missing', () => {
    const b = billingFixture()
    const live = { ...b.square, status: { ...b.square.status, live: true, configured: true, details: { environment: 'production' } } }
    expect(squareStatus(live).headline).toBe('Connected to Square (production) · set up')
    const missing = { ...live, status: { ...live.status, configured: false, missing: ['SQUARE_ACCESS_TOKEN'] } }
    expect(squareStatus(missing)).toMatchObject({ headline: 'Connected to Square (production) · not set up yet', tone: 'red', missing: ['SQUARE_ACCESS_TOKEN'] })
  })
  it('the checks, the last test and the toast', () => {
    const checks = [
      { key: 'token', ok: true, detail: 'Square answered' },
      { key: 'webhook', ok: false, detail: 'No subscription for the webhook URL' },
    ]
    expect(checkLines(checks)).toEqual([
      { label: 'Access token', value: 'OK · Square answered', tone: 'green' },
      { label: 'Webhook', value: 'Not OK · No subscription for the webhook URL', tone: 'red' },
    ])
    expect(lastTestText(null, '')).toBe('Never tested')
    expect(lastTestText({ ok: true, at: 'x', checks: [] }, 'Jun 13, 10:36 AM')).toBe('Last test: all checks passed · Jun 13, 10:36 AM')
    expect(testToast({ ok: true, checks: [] as never })).toBe('Square connection OK')
    expect(testToast({ ok: false, checks: checks as never })).toBe('Square connection: 1 check(s) failed')
  })
  it('the server’s switches, read only, in plain words', () => {
    const lines = processingLines(billingFixture().processing)
    expect(lines.map((l) => l.label + ': ' + l.value)).toEqual([
      'Card payments go through: Squarespace (Square not switched on yet)',
      'Square: Simulator',
      'Square writes: Off · watch only: payments are seen and matched, nothing is made at Square',
      'Memberships on Square: Off',
      'Saved cards and fees: Off until Square takes card payments',
      'Personal pay, card and membership pages: Off',
      'Counter payments recorded: Only on strong evidence',
      '“Open Square POS” button: Off',
    ])
  })
})

describe('the forms’ checks', () => {
  it('whole dollars', () => {
    expect(parseDollars('15')).toBe(1500)
    expect(parseDollars('$15')).toBe(1500)
    expect(parseDollars('15.00')).toBe(1500)
    expect(parseDollars('')).toBe(0)
    expect(parseDollars('15.50')).toBeNull()
    expect(parseDollars('abc')).toBeNull()
  })
  it('the fees: whole dollars up to $1,000; on needs at least one fee', () => {
    expect(feesBody({ enabled: true, noShow: '15', lateCancel: '10' })).toEqual({
      ok: true,
      value: { enabled: true, noShowCents: 1500, lateCancelCents: 1000 },
    })
    expect(feesBody({ enabled: true, noShow: '0', lateCancel: '' })).toEqual({ ok: false, message: 'Set at least one fee before turning fees on.' })
    expect(feesBody({ enabled: false, noShow: '1001', lateCancel: '0' }).ok).toBe(false)
    expect(feesBody({ enabled: false, noShow: '0', lateCancel: '0' }).ok).toBe(true)
  })
  it('the renewal policy: the cancel day comes after the last day of perks; what it means', () => {
    expect(policyBody({ grace: '7', cancel: '21' })).toEqual({ ok: true, value: { graceDays: 7, cancelDays: 21 } })
    expect(policyBody({ grace: '21', cancel: '21' })).toEqual({ ok: false, message: 'The cancel day must come after the last day of perks.' })
    expect(policyBody({ grace: '61', cancel: '90' }).ok).toBe(false)
    expect(policyBody({ grace: '0', cancel: '0' }).ok).toBe(false)
    expect(policyText({ grace: '7', cancel: '21' })).toBe(
      'A renewal Square can’t charge: the client gets a text with a card link at once and keeps the perks 7 days; then the perks pause; 21 days after the failed payment the membership is canceled. A payment at any point puts it back.',
    )
    expect(policyText({ grace: 'x', cancel: '21' })).toBe('')
  })
  it('the notice: 0 to 90 days', () => {
    expect(noticeBody('30')).toEqual({ ok: true, value: 30 })
    expect(noticeBody('91').ok).toBe(false)
    expect(noticeBody('-1').ok).toBe(false)
  })
  it('Sync to Square: skipped with the server’s reason, or what was made', () => {
    const base = { plansCreated: 0, plansRenamed: 0, variationsCreated: 0, retired: 0, kept: 0, drift: 0, recreated: 0, failed: 0 }
    expect(syncToast({ ...base, status: 'skipped', reason: 'Square writes are off' })).toBe('Not synced: Square writes are off')
    expect(syncToast({ ...base, status: 'done', plansCreated: 1, variationsCreated: 4, failed: 1 })).toBe('Synced to Square · 5 made · 1 failed')
    expect(syncToast({ ...base, status: 'done' })).toBe('Synced to Square · nothing to change')
  })
})

describe('Move members and the price cells (DV-909)', () => {
  it('the notice date is the backend’s ("Wed, Nov 11"), the shop’s today plus the days', () => {
    expect(noticeDate('2026-10-12', 30)).toBe('Wed, Nov 11')
    expect(noticeDate('2026-06-13', 0)).toBe('Sat, Jun 13')
  })
  it('the text members get, and what happens', () => {
    const p = moveMembersPreview({ tierName: 'Gold', fromCents: 13900, days: 30, today: '2026-10-12' })
    expect(p.when).toBe('Wed, Nov 11')
    expect(p.text).toBe(
      'Hi Maria, your Oasis Auto Spa Gold membership will be $139/month from your first bill after Wed, Nov 11. Questions? Just reply here.',
    )
    expect(p.explain).toContain('(30 days’ notice)')
    expect(moveToast({ moving: 2, skipped: 1 }, 'Wed, Nov 11')).toBe(
      'Moving 2 members · new price from their first bill after Wed, Nov 11 · 1 left alone (a change is already scheduled)',
    )
    expect(moveToast({ moving: 0, skipped: 0 }, 'x')).toBe('No member is on an older price')
  })
  it('each price’s Square state, with the reason when Square lost it', () => {
    expect(priceSquareText('synced', null)).toEqual({ text: 'On Square', tone: 'green' })
    expect(priceSquareText('failed', 'Square refused the price')).toEqual({ text: 'Square sync failed', tone: 'red' })
    expect(priceSquareText('pending', 'Square lost its plan variation')).toEqual({ text: 'Square lost it · making it again', tone: 'amber' })
    expect(priceSquareText('pending', null)).toEqual({ text: 'Not synced yet', tone: 'ink' })
    expect(priceSquareText(undefined, undefined).text).toBe('Not synced yet')
  })
})
