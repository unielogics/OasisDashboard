/* eslint-disable @typescript-eslint/no-explicit-any */
// The Square item library in plain words (ADR 0172; DV-911..913), pure: the sync's state, the tax check (its own words,
// coloured by what it means for the sync), the shop's taxes, the counts, the preview, Sync now's answer, and the Prices by
// size dots. The wording of the tax check comes from the server (backend src/modules/catalog/square/tax.ts).
import { describe, expect, it } from 'vitest'
import { squareItemsFixture, taxCheckFixture } from '@/screens/settings/live/extras-testkit'
import {
  archiveToast,
  candidateRows,
  cellDot,
  countsText,
  itemsHeadline,
  itemsSyncToast,
  previewText,
  roundingLine,
  rowSquareText,
  showCounts,
  syncNote,
  taxLine,
  taxModeText,
} from './square-items'

const run = (over: Record<string, unknown>): any => ({
  status: 'done',
  mode: 'on',
  tax: null,
  created: 0,
  updated: 0,
  archived: 0,
  recreated: 0,
  adopted: 0,
  restored: 0,
  failed: 0,
  categoriesCreated: 0,
  taxCreated: 0,
  taxUpdated: 0,
  failures: [],
  changedInSquare: [],
  reported: [],
  ...over,
})

describe('the state of the item sync', () => {
  it('says whether Oasis writes, only watches, or is off, and what Sync now does then', () => {
    expect(itemsHeadline({ mode: 'on' })).toEqual({
      text: 'On · Oasis services and prices are kept in step with Square',
      tone: 'green',
    })
    expect(itemsHeadline({ mode: 'preview' })).toEqual({
      text: 'Watch only · Square writes are off, so nothing is made in Square',
      tone: 'amber',
    })
    expect(itemsHeadline({ mode: 'off' }).text).toBe('Off · the item sync is switched off on the server')
    expect(syncNote({ mode: 'preview' })).toBe(
      'Sync now only reads Square and shows what the sync would do. Nothing is written.',
    )
    expect(syncNote({ mode: 'on' })).toContain('every 5 minutes')
  })
})

describe('the tax line', () => {
  it('a tax at Oasis’s rate is green; Oasis’s own edited in Square is amber; one to add is neutral; paused is red', () => {
    expect(taxLine(null)).toEqual({
      text: 'Not checked yet. Sync now or Test connection checks it.',
      tone: 'ink',
    })
    expect(taxLine(taxCheckFixture())).toEqual({
      text: 'Square tax “NJ Sales Tax” is 6.625%, the same as Oasis',
      tone: 'green',
    })
    const edited = taxCheckFixture({
      own: true,
      ownChanged: ['turned off'],
      detail: 'Oasis’s Square tax “Sales tax” was changed in Square (turned off): the next sync puts it back',
    })
    expect(taxLine(edited).tone).toBe('amber')
    expect(
      taxLine(taxCheckFixture({ status: 'create', detail: 'No sales tax in Square yet: the item sync will add “Sales tax” at 6.625%' })),
    ).toEqual({ text: 'No sales tax in Square yet: the item sync will add “Sales tax” at 6.625%', tone: 'ink' })
    const blocked = taxCheckFixture({
      status: 'blocked',
      detail: 'Square’s taxes at the shop (NJ Sales Tax 7%) don’t match Oasis’s 6.625%: the item sync is paused until they match',
    })
    expect(taxLine(blocked).tone).toBe('red')
    expect(taxLine(taxCheckFixture({ status: 'error', detail: 'Square did not answer' }))).toEqual({
      text: 'Couldn’t check Square’s tax: Square did not answer',
      tone: 'red',
    })
  })
  it('the CalculateOrder sample, when it ran', () => {
    expect(roundingLine(taxCheckFixture())).toEqual({
      text: 'All 9 sample totals match Square to the cent',
      tone: 'green',
    })
    expect(
      roundingLine(taxCheckFixture({ rounding: { checked: 9, differ: 2, detail: '2 of 9 sample totals differ by a cent ($4.00: Square 26, Oasis 27)' } })),
    ).toEqual({ text: '2 of 9 sample totals differ by a cent ($4.00: Square 26, Oasis 27)', tone: 'amber' })
    expect(roundingLine(taxCheckFixture({ rounding: undefined }))).toBeNull()
    expect(roundingLine(taxCheckFixture({ rounding: { checked: 0, differ: 0, detail: 'no prices to check yet' } }))).toBeNull()
  })
  it('the shop’s taxes: which fits and why the others don’t; only a matching one not in use can be picked', () => {
    const t = taxCheckFixture({
      status: 'blocked',
      taxId: null,
      candidates: [
        { id: 'A', name: 'NJ Sales Tax', percentage: '6.625', matches: true, problem: null },
        { id: 'B', name: 'State tax', percentage: '6.625', matches: true, problem: null },
        { id: 'C', name: 'Old rate', percentage: '7', matches: false, problem: '7%, not 6.625%' },
        { id: 'D', name: 'Fee', percentage: null, matches: false, problem: null },
      ],
    })
    expect(candidateRows(t, null).map((r) => [r.text, r.tone, r.canUse])).toEqual([
      ['“NJ Sales Tax” 6.625% · matches Oasis', 'green', true],
      ['“State tax” 6.625% · matches Oasis', 'green', true],
      ['“Old rate” 7% · 7%, not 6.625%', 'ink', false],
      ['“Fee” (no rate) · does not match Oasis', 'ink', false],
    ])
    expect(candidateRows(t, 'A')[0]).toMatchObject({ text: '“NJ Sales Tax” 6.625% · used for Oasis items', canUse: false })
    // automatic, adopted: the tax in use is marked
    expect(candidateRows(taxCheckFixture(), null)[0]).toMatchObject({ inUse: true, canUse: false })
    expect(candidateRows(null, null)).toEqual([])
  })
  it('which tax Oasis items carry', () => {
    expect(taxModeText({ taxMode: 'auto' }, null)).toBe(
      'Automatic: the one Square tax at Oasis’s rate, or Oasis’s own when the shop has none.',
    )
    expect(taxModeText({ taxMode: 'create' }, null)).toBe('Oasis items carry Oasis’s own tax “Sales tax”.')
    expect(taxModeText({ taxMode: 'adopt' }, taxCheckFixture())).toBe(
      'Oasis items carry the Square tax picked here: “NJ Sales Tax”.',
    )
  })
})

describe('counts, preview and answers', () => {
  it('counts: On Square always, the others when not zero; shown once Oasis has items in Square', () => {
    expect(countsText({ onSquare: 17, waiting: 2, failed: 1, archived: 3, notSold: 2 })).toBe(
      'On Square 17 · Waiting 2 · Failed 1 · Archived 3 · Not sold 2',
    )
    expect(countsText({ onSquare: 0, waiting: 0, failed: 0, archived: 0, notSold: 0 })).toBe('On Square 0')
    const v = squareItemsFixture()
    expect(showCounts(v)).toBe(false) // watch only, nothing made: every service would read "waiting"
    expect(showCounts({ ...v, mode: 'on' })).toBe(true)
    expect(showCounts({ ...v, mode: 'off', counts: { ...v.counts, onSquare: 4 } })).toBe(true)
  })
  it('the preview in plain words', () => {
    const p = {
      create: 19,
      createPrices: 87,
      update: 0,
      archive: 0,
      unchanged: 0,
      skipped: 2,
      categories: 4,
      tax: 'create' as const,
      at: '2026-10-13T19:04:00.000Z',
    }
    expect(previewText(p)).toBe(
      'Would make 19 items with 87 prices and 4 categories; 2 services not sold (off, quote only or no price). The tax: adds Oasis’s own “Sales tax”.',
    )
    expect(previewText({ ...p, create: 0, update: 2, archive: 1, unchanged: 16, skipped: 0, tax: 'none' })).toBe(
      'Would make nothing new; update 2, archive 1, 16 already the same. The tax: leaves the tax as it is.',
    )
    expect(previewText({ ...p, create: 1, createPrices: 1, categories: 1, skipped: 1, tax: 'blocked' })).toBe(
      'Would make 1 item with 1 price and 1 category; 1 service not sold (off, quote only or no price). The tax: is paused: Square’s tax doesn’t match Oasis.',
    )
  })
  it('Sync now’s answer', () => {
    expect(itemsSyncToast(run({ created: 3, updated: 2, restored: 1, failed: 1 }))).toBe(
      'Synced with Square · 3 made · 2 updated · 1 put back · 1 failed',
    )
    expect(itemsSyncToast(run({}))).toBe('Synced with Square · nothing to change')
    expect(itemsSyncToast(run({ status: 'skipped', reason: 'A Square item sync is already running: try again in a minute' }))).toBe(
      'Not synced: A Square item sync is already running: try again in a minute',
    )
    expect(itemsSyncToast(run({ status: 'blocked', reason: 'Several Square taxes are 6.625%' }))).toBe(
      'Not synced: Several Square taxes are 6.625%',
    )
    const preview = { create: 2, createPrices: 5, update: 0, archive: 0, unchanged: 0, skipped: 0, categories: 0, tax: 'adopt', at: 'x' }
    expect(itemsSyncToast(run({ status: 'preview', preview }))).toBe(
      'Preview · Would make 2 items with 5 prices. The tax: uses the shop’s Square tax.',
    )
    expect(archiveToast({ archived: 3, alreadyArchived: 1, failed: 0 })).toBe('3 items archived in Square · 1 already archived')
    expect(archiveToast({ archived: 1, alreadyArchived: 0, failed: 2 })).toBe('1 item archived in Square · 2 failed')
  })
})

describe('Prices by size and the Catalog (DV-912, DV-913)', () => {
  const sq = {
    state: 'failed' as const,
    cells: { compact_car: 'synced' as const, large_suv: 'failed' as const, '': 'pending' as const, truck: 'hidden' as const },
    error: 'Square refused the price',
  }
  it('a dot per size Oasis sells it at; none without the server’s state', () => {
    expect(cellDot(sq, 'compact_car')).toEqual({ title: 'On Square', colour: '#0E9E6E' })
    expect(cellDot(sq, 'large_suv')).toEqual({ title: 'Square sync failed: Square refused the price', colour: '#C2410C' })
    expect(cellDot(sq, '')).toEqual({ title: 'Waiting for Square (the next sync sends it)', colour: '#FFB547' })
    expect(cellDot(sq, 'truck')?.title).toBe('Hidden in Square')
    expect(cellDot(sq, 'compact_suv')).toBeNull()
    expect(cellDot(undefined, 'compact_car')).toBeNull()
  })
  it('the service’s state in a few words', () => {
    expect(
      (['synced', 'pending', 'failed', 'archived', 'not_sold'] as const).map((state) =>
        rowSquareText({ state, cells: {}, error: null }),
      ),
    ).toEqual(['on Square', 'waiting for Square', 'Square sync failed', 'archived in Square', 'not on Square'])
    expect(rowSquareText(undefined)).toBe('')
  })
})
