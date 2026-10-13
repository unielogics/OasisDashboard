// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// Kiosk mode on the live Operations screen (ADR 0180, design 6.5; DV-1005, DV-1006, DV-1007): who is asked, when, and
// what each request carries. On the shop's tablet every write names the employee who taps their name BEFORE the request:
// every time for the car steps, once per flow for a booking and a collect, sticky for 2 minutes per open file for texts,
// add-ons, checklist and photos; never for reads. A signed-in person is never asked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Action } from '@/data/command'
import { ApiClient } from '@/data/http/client'
import { ApiError } from '@/data/http/problem'
import { createLiveOperationsPort } from '@/data/ports/operations'
import { createLivePaymentsPort } from '@/data/ports/payments'
import { makeKioskSession } from '@/auth/test-fixtures'
import { serverClock } from '@/lib/clock'
import { QueryClient } from '@tanstack/react-query'
import { LiveChrome } from '@/auth/chrome'
import { OpsCommands } from './live/commands'
import { FILES, clone, makeLive, makeSession, stubPort } from './live-testkit'
import type { Live } from './live-testkit'

const id = (k: keyof typeof FILES): string => (FILES[k] as any).id
const calls = (l: Live, name: string) => l.port.calls.filter((c) => c[0] === name)
const payCalls = (l: Live, name: string) => l.payments.calls.filter((c) => c[0] === name)
const last = <T>(a: T[]): T => a[a.length - 1]!
const actorOf = (call: any[]) => (call[call.length - 1] as { actor?: string } | undefined)?.actor

const tick = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

async function kiosk(): Promise<Live> {
  const l = makeLive(makeKioskSession(), stubPort())
  l.vals()
  await l.settle()
  return l
}

/** Runs a command, answers the picker with `who` (null = cancel), returns the command's result. */
async function asked<T>(l: Live, run: () => Promise<T>, who: string | null): Promise<{ result: T; title: string }> {
  const p = run()
  await tick()
  expect(l.chrome.picker.isOpen).toBe(true)
  const title = l.chrome.picker.vals().title
  if (who) l.chrome.picker.choose(who)
  else l.chrome.picker.cancel()
  return { result: await p, title }
}

let clock = 1_000_000
beforeEach(() => {
  clock = 1_000_000
  serverClock.setClientNow(() => clock)
})
afterEach(() => {
  serverClock.setClientNow(() => Date.now())
  vi.restoreAllMocks()
})

describe('kiosk: the car steps ask every time, before the request', () => {
  it('assign to a bay: the picker names the car and the bay; nothing is sent until a name is tapped', async () => {
    const l = await kiosk()
    const card = l.port.snap.timeline.groups.flatMap((g) => g.items).find((c) => c.canDrag)!
    const bay = l.port.snap.bays[1]!
    const p = (l.logic as any).assignToBay(card, bay.number) as Promise<void>
    await tick()
    expect(l.chrome.picker.isOpen).toBe(true)
    expect(l.chrome.picker.vals().title).toMatch(new RegExp('^Who’s putting .+ in ' + bay.name + '\\?$'))
    expect(calls(l, 'assignBay')).toHaveLength(0)
    l.chrome.picker.choose('emp-marco')
    await p
    expect(calls(l, 'assignBay')).toHaveLength(1)
    expect(actorOf(last(calls(l, 'assignBay')))).toBe('emp-marco')
    // again: asked again (every time), another name
    const { result } = await asked(l, () => l.logic.cmd.assignBay(card.id, bay.id), 'emp-lena')
    expect(result).toBe(true)
    expect(actorOf(last(calls(l, 'assignBay')))).toBe('emp-lena')
  })

  it('advance, arrive, prep the bay, pickup, ready text, move: each asks and carries the name', async () => {
    const l = await kiosk()
    const a = id('late')
    await asked(l, () => l.logic.cmd.advance({ id: a, status: 'checked_in' as any, step: 'start' }), 'emp-marco')
    await asked(l, () => l.logic.cmd.arrive(a), 'emp-lena')
    await asked(l, () => l.logic.cmd.prepBay(a), 'emp-sofia')
    await asked(l, () => l.logic.cmd.setPickup(a, 'collected'), 'emp-marco')
    await asked(l, () => l.logic.cmd.notifyReady(a), 'emp-lena')
    await asked(l, () => l.logic.cmd.reschedule(a, '2026-06-13T15:00:00.000Z'), 'emp-sofia')
    expect(actorOf(last(calls(l, 'advance')))).toBe('emp-marco')
    expect(actorOf(last(calls(l, 'arrive')))).toBe('emp-lena')
    expect(actorOf(last(calls(l, 'prepBay')))).toBe('emp-sofia')
    expect(actorOf(last(calls(l, 'pickup')))).toBe('emp-marco')
    expect(actorOf(last(calls(l, 'notifyReady')))).toBe('emp-lena')
    expect(actorOf(last(calls(l, 'reschedule')))).toBe('emp-sofia')
  })

  it('Cancel stops the step: no request, no toast', async () => {
    const l = await kiosk()
    const { result } = await asked(l, () => l.logic.cmd.arrive(id('late')), null)
    expect(result).toBe(false)
    expect(calls(l, 'arrive')).toHaveLength(0)
    expect(l.logic.state.toast).toBeNull()
  })
})

describe('kiosk: once per flow', () => {
  it('a booking asks once for every try of the same sheet; the next booking asks again', async () => {
    const l = await kiosk()
    const action = new Action()
    l.port.fail.set('book', new ApiError({ status: 409, code: 'SLOT_UNAVAILABLE', title: 'Taken' }))
    const body = { walkIn: true } as any
    const first = await asked(l, () => l.logic.cmd.book(body, action), 'emp-sofia')
    expect(first.title).toBe('Who’s checking in this walk-in?')
    expect(first.result?.ok).toBe(false)
    l.port.fail.delete('book')
    // the retry of the same sheet: not asked again
    const r = await l.logic.cmd.book(body, action)
    expect(r?.ok).toBe(true)
    expect(calls(l, 'book').map(actorOf)).toEqual(['emp-sofia', 'emp-sofia'])
    // a new flow (the action renewed after success): asked again
    const second = await asked(l, () => l.logic.cmd.book({} as any, action), 'emp-marco')
    expect(second.title).toBe('Who’s making this booking?')
    expect(actorOf(last(calls(l, 'book')))).toBe('emp-marco')
  })

  it('a collect asks once: the payment and its receipt carry the same name', async () => {
    const l = await kiosk()
    const { result, title } = await asked(
      l,
      () => l.logic.cmd.collect('inv-1', 'cash', { first: 'Maria' }),
      'emp-lena',
    )
    expect(result).toBe(true)
    expect(title).toBe('Who’s taking Maria’s payment?')
    expect(actorOf(last(payCalls(l, 'collect')))).toBe('emp-lena')
    expect(actorOf(last(payCalls(l, 'sendReceipt')))).toBe('emp-lena')
  })

  it('a failed collect keeps its name for a retry of the same file', async () => {
    const l = await kiosk()
    l.logic.select(id('late'), 'payment')
    l.payments.fail.set('collect', new ApiError({ status: 409, code: 'CONFLICT', title: 'Try again' }))
    const first = await asked(l, () => l.logic.cmd.collect('inv-1', 'cash', { first: 'Maria' }), 'emp-lena')
    expect(first.result).toBe(false)
    l.payments.fail.delete('collect')
    l.clock.now += 60_000
    expect(await l.logic.cmd.collect('inv-1', 'cash', { first: 'Maria' })).toBe(true)
    expect(payCalls(l, 'collect').map(actorOf)).toEqual(['emp-lena', 'emp-lena'])
  })

  it('a failed collect, then the file closes: the next collect asks again (F1)', async () => {
    const l = await kiosk()
    l.logic.select(id('late'), 'payment')
    l.vals()
    l.payments.fail.set('collect', new ApiError({ status: 409, code: 'CONFLICT', title: 'Try again' }))
    await asked(l, () => l.logic.cmd.collect('inv-1', 'cash', { first: 'Maria' }), 'emp-lena')
    l.payments.fail.delete('collect')
    ;(l.vals().closeModal as () => void)()
    const again = await asked(l, () => l.logic.cmd.collect('inv-1', 'cash', { first: 'Maria' }), 'emp-marco')
    expect(again.result).toBe(true)
    expect(actorOf(last(payCalls(l, 'collect')))).toBe('emp-marco')
    expect(actorOf(last(payCalls(l, 'sendReceipt')))).toBe('emp-marco')
  })

  it('a failed payment link, then another file or Escape: the next link asks again (F1)', async () => {
    const l = await kiosk()
    l.logic.select(id('late'), 'payment')
    l.payments.fail.set('collect', new ApiError({ status: 409, code: 'CONFLICT', title: 'Try again' }))
    await asked(l, () => l.logic.cmd.sendLink('inv-1', ''), 'emp-lena')
    l.logic.select(id('cleaning'), 'payment')
    await asked(l, () => l.logic.cmd.sendLink('inv-1', ''), 'emp-sofia')
    ;(l.logic as any).onKey({ key: 'Escape', target: document.body, preventDefault() {} })
    l.payments.fail.delete('collect')
    await asked(l, () => l.logic.cmd.sendLink('inv-1', ''), 'emp-marco')
    expect(payCalls(l, 'collect').map(actorOf)).toEqual(['emp-lena', 'emp-sofia', 'emp-marco'])
  })

  it('a failed collect left open: after 2 quiet minutes the next collect asks again (F1)', async () => {
    const l = await kiosk()
    l.logic.select(id('late'), 'payment')
    l.payments.fail.set('collect', new ApiError({ status: 409, code: 'CONFLICT', title: 'Try again' }))
    await asked(l, () => l.logic.cmd.collect('inv-1', 'cash', { first: 'Maria' }), 'emp-lena')
    l.payments.fail.delete('collect')
    l.clock.now += 2 * 60_000 + 1
    await asked(l, () => l.logic.cmd.collect('inv-1', 'cash', { first: 'Maria' }), 'emp-marco')
    expect(payCalls(l, 'collect').map(actorOf)).toEqual(['emp-lena', 'emp-marco'])
  })

  it('a payment link and a size change ask at their confirm', async () => {
    const l = await kiosk()
    await asked(l, () => l.logic.cmd.sendLink('inv-1', ''), 'emp-marco')
    expect(actorOf(last(payCalls(l, 'collect')))).toBe('emp-marco')
    await asked(l, () => l.logic.cmd.setVisitSize(id('late'), 'large_suv', 3), 'emp-sofia')
    expect(actorOf(last(calls(l, 'setVisitSize')))).toBe('emp-sofia')
  })
})

describe('kiosk: sticky per open file for 2 minutes (DV-1006)', () => {
  it('texts, add-ons, checklist and photos of one file ask once; the chip says who; Change asks again', async () => {
    const l = await kiosk()
    const f = id('late')
    l.logic.select(f, 'messages')
    l.vals()
    await l.settle()
    await asked(l, () => l.logic.cmd.sendMessage(f, { text: 'On our way' } as any, 'Maria'), 'emp-marco')
    expect(l.vals().live.acting).toMatchObject({ show: true, text: 'As Marco R.' })
    await l.logic.cmd.setAddon(f, 'svc-wax', true)
    await l.logic.cmd.checklistItem(f, 'item-1', true)
    expect(l.chrome.picker.isOpen).toBe(false)
    expect(actorOf(last(calls(l, 'sendMessage')))).toBe('emp-marco')
    expect(actorOf(last(calls(l, 'setAddon')))).toBe('emp-marco')
    expect(actorOf(last(calls(l, 'checklistItem')))).toBe('emp-marco')
    // Change
    const change = l.vals().live.acting.change as () => void
    change()
    expect(l.chrome.picker.isOpen).toBe(true)
    l.chrome.picker.choose('emp-lena')
    await tick()
    expect(l.vals().live.acting.text).toBe('As Lena K.')
    await l.logic.cmd.checklistBulk(f, ['item-1', 'item-2'], true, true)
    expect(actorOf(last(calls(l, 'checklistBulk')))).toBe('emp-lena')
    // two quiet minutes: asked again
    clock += 2 * 60_000 + 1
    await asked(l, () => l.logic.cmd.setAddon(f, 'svc-wax', false), 'emp-sofia')
    expect(actorOf(last(calls(l, 'setAddon')))).toBe('emp-sofia')
  })

  it('closing the file forgets the name; another file asks', async () => {
    const l = await kiosk()
    const f = id('late')
    l.logic.select(f, 'checklist')
    l.vals()
    await asked(l, () => l.logic.cmd.checklistItem(f, 'item-1', true), 'emp-marco')
    ;(l.vals().closeModal as () => void)()
    expect(l.chrome.picker.acting(f)).toBeNull()
    expect(l.vals().live.acting.show).toBe(false)
    await asked(l, () => l.logic.cmd.checklistItem(f, 'item-1', false), 'emp-lena')
    await asked(l, () => l.logic.cmd.checklistItem(id('cleaning'), 'item-1', true), 'emp-sofia')
  })

  it('never asked: opening a file, marking a thread read', async () => {
    const l = await kiosk()
    l.logic.select(id('late'), 'overview')
    l.vals()
    await l.settle()
    await l.logic.cmd.markRead('cust-1')
    expect(l.chrome.picker.isOpen).toBe(false)
    expect(calls(l, 'markRead')).toHaveLength(1)
  })
})

describe('kiosk: wording and what is not on the kiosk (DV-1007)', () => {
  it('an action the kiosk may not do says “Not on the kiosk · Ask a manager” and sends nothing', async () => {
    const l = await kiosk()
    expect(await l.logic.cmd.cancelVisit(id('late'), 'x')).toBeNull()
    expect(l.logic.state.toast).toEqual({ title: 'Not on the kiosk', desc: 'Ask a manager' })
    expect(calls(l, 'cancel')).toHaveLength(0)
    expect(l.chrome.picker.isOpen).toBe(false)
  })
})

describe('a signed-in person is never asked', () => {
  it('every write goes without a name and without the picker', async () => {
    const l = makeLive(makeSession({ role: 'mgmt' }), stubPort())
    l.vals()
    await l.settle()
    const a = id('late')
    await l.logic.cmd.arrive(a)
    await l.logic.cmd.assignBay(a, 'bay-1')
    await l.logic.cmd.sendMessage(a, { text: 'hi' } as any, 'Maria')
    await l.logic.cmd.collect('inv-1', 'cash', { first: 'Maria' })
    expect(l.chrome.picker.isOpen).toBe(false)
    for (const c of [...calls(l, 'arrive'), ...calls(l, 'assignBay'), ...calls(l, 'sendMessage')])
      expect(actorOf(c)).toBeUndefined()
    expect(actorOf(last(payCalls(l, 'collect')))).toBeUndefined()
  })
})

describe('the fallback picker of the API client is never reached by the Operations commands', () => {
  it('every write the kiosk does carries X-Oasis-Employee from the command itself', async () => {
    const sent: Array<{ method: string; url: string; actor?: string }> = []
    const fetch = vi.fn(async (url: string, init: any) => {
      sent.push({ method: init.method, url, actor: init.headers['X-Oasis-Employee'] })
      if (url.endsWith('/receipt')) return new Response(JSON.stringify({ sms: 'queued', email: 'skipped' }), { status: 200 })
      if (url.includes('/photos/presign'))
        return new Response(JSON.stringify({ photoId: 'ph-1', upload: { url: 'https://s3.test/up', fields: {} } }), { status: 200 })
      return new Response(JSON.stringify({ toast: { title: 'Done', detail: '' } }), { status: 200 })
    })
    const resolveActor = vi.fn(async () => 'emp-fallback')
    const client = new ApiClient({ fetch: fetch as any, kiosk: { resolveActor }, newKey: () => 'k', sleep: async () => {} })
    client.csrf.set('csrf')
    const chrome = new LiveChrome()
    chrome.setSession(makeKioskSession())
    const port = createLiveOperationsPort(client, (async () => new Response(null, { status: 204 })) as any)
    const cmd = new OpsCommands({
      port,
      payments: createLivePaymentsPort(client),
      queryClient: new QueryClient(),
      session: () => chrome.getSession(),
      flash: () => {},
      now: () => clock,
      tz: () => 'America/New_York',
      who: (ask) => {
        const p = chrome.picker.pick(ask)
        // whoever is asked taps Marco at once
        queueMicrotask(() => chrome.picker.isOpen && chrome.picker.choose('emp-marco'))
        return p
      },
    })
    const a = 'appt-1'
    const runs: Array<() => Promise<unknown>> = [
      () => cmd.advance({ id: a, status: 'checked_in' as any, step: 'start' }),
      () => cmd.assignBay(a, 'bay-1'),
      () => cmd.arrive(a),
      () => cmd.prepBay(a),
      () => cmd.setPickup(a, 'collected'),
      () => cmd.notifyReady(a),
      () => cmd.reschedule(a, '2026-06-13T15:00:00.000Z'),
      () => cmd.checklistItem(a, 'i1', true),
      () => cmd.checklistBulk(a, ['i1'], true, true),
      () => cmd.setAddon(a, 's1', true),
      () => cmd.setAddon(a, 's1', false),
      () => cmd.setVisitSize(a, 'large_suv', 1),
      () => cmd.book({ walkIn: true } as any, new Action()),
      () => cmd.sendMessage(a, { text: 'hi' } as any, 'Maria'),
      () => cmd.collect('inv-1', 'cash', { first: 'Maria' }),
      () => cmd.sendLink('inv-1', ''),
      () => cmd.uploadPhoto(a, 'arrival', new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' })),
      () => cmd.markRead('cust-1'),
    ]
    for (const r of runs) await r()
    expect(resolveActor).not.toHaveBeenCalled()
    const writes = sent.filter((s) => s.method !== 'GET')
    expect(writes.length).toBeGreaterThanOrEqual(runs.length)
    for (const w of writes)
      if (!w.url.endsWith('/messages/read')) expect(w.actor, w.method + ' ' + w.url).toBe('emp-marco')
  })
})

void clone
