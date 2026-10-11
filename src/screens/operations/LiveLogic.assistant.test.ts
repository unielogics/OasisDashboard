// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// The AI assistant and phone identity in the live Operations view model (ADR 0160, design section 8, plan G): the
// "Oasis AI" tag on the assistant's texts, the "AI paused" line, the AI handoff and picture-message alerts opening the
// thread, and the Overview's "Website PIN" cell with Clear PIN (cli.edit, asked first). With the assistant off and no PIN
// anywhere (the production defaults) the file shows nothing new.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/data/http/problem'
import type { ClientIdentity } from '@/data/ports/operations'
import { FILES, clone, fixtures, makeLive, makeSession, stubPort } from './live-testkit'
import type { Live } from './live-testkit'

const id = (k: keyof typeof FILES): string => (FILES[k] as any).id
const customerOf = (k: keyof typeof FILES): string => (FILES[k] as any).customer.id
const calls = (l: Live, name: string) => l.port.calls.filter((c) => c[0] === name)

async function boot(role: Parameters<typeof makeSession>[0] = { role: 'mgmt' }, port = stubPort()): Promise<Live> {
  const l = makeLive(makeSession(role), port)
  l.vals()
  await l.settle()
  l.vals()
  return l
}

async function open(l: Live, key: keyof typeof FILES, tab = 'overview') {
  l.logic.select(id(key), tab)
  l.vals()
  await l.settle()
  l.vals()
  await l.settle()
  return l.vals()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
})
afterEach(() => vi.useRealTimers())

const flushed = async (l: Live) => {
  for (let i = 0; i < 6; i++) {
    await vi.advanceTimersByTimeAsync(5)
    await Promise.resolve()
  }
  await l.settle()
}

const msg = (over: Record<string, unknown>) => ({
  id: 'm-' + Math.abs(JSON.stringify(over).length),
  text: 'Hello',
  time: '10:00 AM',
  at: '2026-06-13T14:00:00.000Z',
  direction: 'out',
  from: 'staff',
  author: 'staff',
  senderName: 'Rafael M.',
  status: 'delivered',
  channel: 'sms',
  kind: 'sms',
  attachments: [],
  ...over,
})

const trusted = (status: ClientIdentity['pin']['status'] = 'set'): ClientIdentity => {
  const i = clone(fixtures.identityNone)
  i.pin = { status, setAt: '2026-06-10T14:00:00.000Z', lockedUntil: null, resetHoldUntil: null }
  i.trust = {
    trusted: true,
    until: '2026-07-10T14:00:00.000Z',
    verifiedAt: '2026-06-10T14:00:00.000Z',
    verifiedBy: 'pin',
    reason: null,
    revokeReason: null,
  }
  return i
}

describe('Messages: the Oasis AI tag and the AI paused line', () => {
  it("the assistant's texts carry the Oasis AI tag; the shop's automatic texts keep theirs", async () => {
    const port = stubPort()
    const t = clone(fixtures.thread)
    ;(t as any).items = [
      msg({ direction: 'in', from: 'customer', author: 'customer', senderName: 'Priya', text: 'Open Sunday?', status: 'received' }),
      msg({ from: 'system', author: 'ai', senderName: 'Oasis AI', text: 'We are closed on Sundays.' }),
      msg({ from: 'system', author: 'system', senderName: 'Oasis Auto Spa', text: 'Your car is ready.' }),
      msg({ text: 'See you Monday!' }),
    ]
    port.threads.set(id('completed'), t)
    const l = await boot({ role: 'mgmt' }, port)
    const v = await open(l, 'completed', 'messages')
    expect(v.sel.messages.map((m: any) => m.channelTag)).toEqual([
      null,
      'Oasis AI · SMS',
      'Automated · SMS',
      null,
    ])
    // the assistant's bubble is the design's automatic-text bubble
    expect(v.sel.messages[1].bubbleStyle).toEqual(v.sel.messages[2].bubbleStyle)
  })

  it('a staff reply pauses the assistant: the line says until when, only while the assistant answers texts', async () => {
    const port = stubPort()
    const t = clone(fixtures.thread)
    ;(t as any).assistantActive = true
    ;(t as any).aiPausedUntil = '2026-06-13T22:36:00-04:00'
    port.threads.set(id('completed'), t)
    const l = await boot({ role: 'mgmt' }, port)
    const v = await open(l, 'completed', 'messages')
    expect([v.sel.aiLineShow, v.sel.aiLineText, v.sel.aiLineSub]).toEqual([
      true,
      'AI paused — staff replying',
      'Oasis AI answers again at 10:36 PM.',
    ])
    // the clock passes the pause: the line goes away
    l.clock.now = Date.parse('2026-06-13T22:37:00-04:00')
    expect(l.vals().sel.aiLineShow).toBe(false)
  })

  it('an open handoff shows the line too; with the assistant off nothing shows (the production default)', async () => {
    const port = stubPort()
    const t = clone(fixtures.thread)
    ;(t as any).assistantActive = true
    ;(t as any).handoff = { open: true, since: '2026-06-13T10:20:00-04:00', reason: 'agent_keyword' }
    port.threads.set(id('completed'), t)
    const off = clone(t)
    ;(off as any).assistantActive = false
    port.threads.set(id('cleaning'), off)
    const l = await boot({ role: 'mgmt' }, port)
    let v = await open(l, 'completed', 'messages')
    expect([v.sel.aiLineText, v.sel.aiLineSub]).toEqual([
      'AI paused — waiting for a staff reply',
      'The client asked for a person at 10:20 AM.',
    ])
    v = await open(l, 'cleaning', 'messages')
    expect(v.sel.aiLineShow).toBe(false)
  })
})

describe('alerts from texts open the thread', () => {
  const alert = (kind: string, appointmentId: string | null, title: string) =>
    ({
      key: kind + ':x',
      kind,
      tone: 'violet',
      glyph: '!',
      appointmentId,
      priority: 1,
      title,
      desc: '10:20 AM · texted AGENT · reply in Messages',
      actionLabel: 'Open messages',
      action: { type: 'open', appointmentId },
    }) as any

  it('an AI handoff and a picture message open the Messages tab of the appointment they name', async () => {
    const port = stubPort()
    port.snap.alerts = [
      alert('ai_handoff', id('completed'), 'Asked for a person · Priya Nair'),
      alert('sms.picture_message', id('cleaning'), 'Picture message · Liam'),
    ]
    const l = await boot({ role: 'mgmt' }, port)
    const [handoff, picture] = l.vals().alerts
    expect(handoff.title).toBe('Asked for a person · Priya Nair')
    handoff.action()
    await flushed(l)
    expect([l.logic.state.selectedId, l.logic.state.modalTab]).toEqual([id('completed'), 'messages'])
    l.logic.setState({ selectedId: null })
    picture.open()
    expect([l.logic.state.selectedId, l.logic.state.modalTab]).toEqual([id('cleaning'), 'messages'])
  })

  it("a handoff with no appointment (a client with none booked) says what it says: there is no file to open", async () => {
    const port = stubPort()
    port.snap.alerts = [alert('ai_handoff', null, 'Asked for a person · New texter ••0142')]
    const l = await boot({ role: 'mgmt' }, port)
    l.vals().alerts[0].action()
    await flushed(l)
    expect(l.logic.state.selectedId).toBeNull()
    expect(l.logic.state.toast).toEqual({
      title: 'Asked for a person · New texter ••0142',
      desc: '10:20 AM · texted AGENT · reply in Messages',
    })
  })
})

describe('Overview: the Website PIN cell', () => {
  it('shows nothing while the client has no PIN and no trust (links off: the file looks as it did)', async () => {
    const l = await boot()
    const v = await open(l, 'completed')
    expect(calls(l, 'identity').map((c) => c[1])).toEqual([customerOf('completed')])
    expect(v.sel.idShow).toBe(false)
    expect(v.sel.idCanClear).toBe(false)
  })

  it('reads the identity only for the Overview tab', async () => {
    const l = await boot()
    await open(l, 'completed', 'messages')
    expect(calls(l, 'identity')).toHaveLength(0)
  })

  it('opening a file reads the identity again (a PIN set on a link page announces nothing)', async () => {
    const port = stubPort()
    const l = await boot({ role: 'mgmt' }, port)
    let v = await open(l, 'completed')
    expect(v.sel.idShow).toBe(false)
    // the file stays open: the 1 s tick does not read it again
    l.vals()
    await flushed(l)
    expect(calls(l, 'identity')).toHaveLength(1)
    port.identities.set(customerOf('completed'), trusted())
    l.logic.setState({ selectedId: null })
    v = await open(l, 'completed')
    expect(calls(l, 'identity')).toHaveLength(2)
    expect(v.sel.idValue).toBe('Set · trusted to Jul 10')
  })

  it('a failed identity read shows nothing and no toast', async () => {
    const port = stubPort()
    port.fail.set('identity', new ApiError({ status: 500, title: 'Server error', detail: '' }))
    const l = await boot({ role: 'mgmt' }, port)
    const v = await open(l, 'completed')
    await flushed(l)
    expect(v.sel.idShow).toBe(false)
    expect(l.logic.state.toast).toBeNull()
  })

  it('"Set · trusted to Jul 10"; Clear PIN asks first, then clears with one key and shows the server state', async () => {
    const port = stubPort()
    port.identities.set(customerOf('completed'), trusted())
    const l = await boot({ role: 'mgmt' }, port)
    let v = await open(l, 'completed')
    expect([v.sel.idShow, v.sel.idValue, v.sel.idCanClear, v.sel.idConfirming]).toEqual([
      true,
      'Set · trusted to Jul 10',
      true,
      false,
    ])
    v.sel.idClear()
    v = l.vals()
    expect(v.sel.idConfirming).toBe(true)
    expect(v.sel.idConfirmText).toBe(
      'Clear Priya’s website PIN? Their personal links stop working and they confirm with a texted code next time.',
    )
    expect(calls(l, 'clearPin')).toHaveLength(0)
    v.sel.idConfirm()
    v.sel.idConfirm() // a double click is one request
    await flushed(l)
    const c = calls(l, 'clearPin')
    expect(c).toHaveLength(1)
    expect(c[0]![1]).toBe(customerOf('completed'))
    expect((c[0]![2] as any).idempotencyKey).toBeTruthy()
    expect(l.logic.state.toast).toEqual({
      title: 'Website PIN cleared',
      desc: 'Priya confirms with a texted code next time',
    })
    l.vals()
    await flushed(l)
    v = l.vals()
    expect([v.sel.idConfirming, v.sel.idValue, v.sel.idCanClear]).toEqual([false, 'Cleared · not trusted', false])
  })

  it('Keep it closes the question without a request; opening another file closes it too', async () => {
    const port = stubPort()
    port.identities.set(customerOf('completed'), trusted('locked'))
    const l = await boot({ role: 'mgmt' }, port)
    let v = await open(l, 'completed')
    v.sel.idClear()
    l.vals().sel.idCancel()
    expect(l.vals().sel.idConfirming).toBe(false)
    l.vals().sel.idClear()
    v = await open(l, 'cleaning')
    expect(l.logic.state.pinConfirm).toBe(false)
    expect(calls(l, 'clearPin')).toHaveLength(0)
  })

  it("a refusal keeps the question open and shows the server's words", async () => {
    const port = stubPort()
    port.identities.set(customerOf('completed'), trusted())
    port.fail.set('clearPin', new ApiError({ status: 404, code: 'NOT_FOUND', title: 'Client not found', detail: 'That client was merged' }))
    const l = await boot({ role: 'mgmt' }, port)
    const v = await open(l, 'completed')
    v.sel.idClear()
    l.vals().sel.idConfirm()
    await flushed(l)
    expect(l.logic.state.toast).toEqual({ title: 'Client not found', desc: 'That client was merged' })
    expect(l.vals().sel.idConfirming).toBe(true)
    expect(l.logic.state.busy).not.toContain('pin')
  })

  it('a role without cli.edit sees the cell but gets the design toast and sends nothing', async () => {
    const port = stubPort()
    port.identities.set(customerOf('completed'), trusted())
    const l = await boot({ role: 'crew' }, port)
    const v = await open(l, 'completed')
    expect(v.sel.idValue).toBe('Set · trusted to Jul 10')
    v.sel.idClear()
    expect(l.vals().sel.idConfirming).toBe(false)
    expect(l.logic.state.toast!.title).toBe('Your role can’t edit clients')
    // even a stale confirm button cannot send it
    l.vals().sel.idConfirm()
    await flushed(l)
    expect(calls(l, 'clearPin')).toHaveLength(0)
  })
})
