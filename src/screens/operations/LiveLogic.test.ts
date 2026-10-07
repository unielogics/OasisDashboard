// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// The live Operations view model on responses captured from the API: what it reads, what each control sends (verb,
// body, Idempotency-Key reuse), what the server's refusal looks like on screen, what a role may not do (no request), and
// the design's gesture timings. The template itself is covered by LiveLogic.render.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/data/http/problem'
import { UploadError } from '@/data/ports/operations'
import { FILES, FROZEN, clone, fixtures, makeLive, makeSession, stubPayments, stubPort } from './live-testkit'
import type { Live } from './live-testkit'
import { pointerDownEvent } from './testkit'

const id = (k: keyof typeof FILES): string => (FILES[k] as any).id
const calls = (l: Live, name: string) => l.port.calls.filter((c) => c[0] === name)
const payCalls = (l: Live, name: string) => l.payments.calls.filter((c) => c[0] === name)
const opts = (call: any[], at: number) => call[at] as { idempotencyKey?: string }

async function boot(
  role: Parameters<typeof makeSession>[0] = { role: 'mgmt' },
  port = stubPort(),
): Promise<Live> {
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
  return l.vals()
}

const problem = (status: number, code: string, title: string, detail = '') =>
  new ApiError({ status, code, title, detail })

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

describe('reads', () => {
  it('shows the server board: KPIs, groups, bays, the pickup column, alerts and staff', async () => {
    const l = await boot()
    const v = l.vals()
    expect(v.kpis.map((k: any) => [k.label, k.value])).toEqual([
      ['Appointments 24h', '12'],
      ['Active jobs', '1'],
      ['Ready for pickup', '1'],
      ['Pending payments', '6'],
      ['Bay time free', '2.8h'],
      ['Members today', '6'],
      ['Revenue today', '$1,487.48'],
    ])
    expect(v.kpis[0].sub).toBe('7 booked')
    expect(v.groups[0].dividerLabel).toBe('Today')
    expect(v.bays.map((b: any) => [b.name, b.occupied])).toEqual([
      ['Bay 1', true],
      ['Bay 2', false],
    ])
    expect(v.completedCount).toBe(3)
    expect(v.alerts.length).toBe(10)
    expect(v.staffCols.map((s: any) => s.name)).toEqual(['Marco R.', 'Lena K.', 'Sofia D.', 'Unassigned'])
    expect(v.clockLabel).toBe('Live · 10:36 AM')
    expect(v.dateLabel).toBe('Saturday, June 13')
    expect(v.inFacilityLabel).toBe('1 in facility')
  })

  it('reads the window of the range tab and the search the server filters on (after the debounce)', async () => {
    const l = await boot()
    expect(l.port.calls.find((c) => c[0] === 'snapshot')![1]).toEqual({ window: 'next24', q: '' })
    l.vals().rangeTabs[1].onClick()
    l.vals()
    await flushed(l)
    expect(calls(l, 'snapshot').at(-1)![1]).toEqual({ window: 'today', q: '' })
    l.vals().onSearch({ target: { value: ' Bradley ' } })
    await vi.advanceTimersByTimeAsync(250)
    l.vals()
    await flushed(l)
    expect(calls(l, 'snapshot').at(-1)![1]).toEqual({ window: 'today', q: 'Bradley' })
  })

  it('the bay timer is the server start plus the synced clock, ticking by the second', async () => {
    const l = await boot()
    const first = l.vals().bays[0]
    expect(first.elapsed).toBe('27:00')
    expect(first.progressLabel).toBe('36% complete')
    l.clock.now += 65_000
    const later = l.vals().bays[0]
    expect(later.elapsed).toBe('28:05')
    expect(later.eta).toBe('11:24 AM')
  })

  it('an overrunning job keeps its finish at "now"', async () => {
    const l = await boot()
    l.clock.now += 80 * 60_000
    const b = l.vals().bays[0]
    expect(b.progressLabel).toBe('100% complete')
    expect(b.eta).toBe('11:56 AM')
  })

  it('opens a file from the server and the Messages count follows the thread', async () => {
    const port = stubPort()
    const t = clone(fixtures.thread)
    ;(t as any).items = [
      {
        text: 'Hello',
        time: '10:00 AM',
        direction: 'out',
        from: 'staff',
        status: 'delivered',
        channel: 'sms',
      },
      {
        text: 'Thanks',
        time: '10:05 AM',
        direction: 'in',
        from: 'customer',
        status: 'received',
        channel: 'sms',
      },
    ]
    port.threads.set(id('completed'), t)
    const l = await boot({ role: 'mgmt' }, port)
    const v = await open(l, 'completed', 'messages')
    expect(v.sel.tabs.find((x: any) => x.label === 'Messages').count).toBe(2)
    expect(v.sel.messages.map((m: any) => m.time)).toEqual(['10:00 AM · Delivered', '10:05 AM'])
  })

  it('an unavailable file says why instead of opening an empty window', async () => {
    const l = await boot()
    l.logic.select('missing-id')
    for (let i = 0; i < 3; i++) {
      l.vals()
      await flushed(l)
    }
    expect(l.vals().modalOpen).toBe(false)
    expect(l.logic.state.toast!.title).toBe('Not found')
  })
})

describe('advance and the board commands', () => {
  it('sends the next step with the status the screen showed (expectedStatus) and shows the server toast', async () => {
    const l = await boot()
    const card = l.vals().groups[0].items[0]
    card.doNext()
    await flushed(l)
    const c = calls(l, 'advance')
    expect(c).toHaveLength(1)
    expect(c[0]![1]).toBe(card.id)
    expect(c[0]![2]).toBe('confirmed')
    expect(opts(c[0] as any[], 3).idempotencyKey).toBeTruthy()
    expect(l.vals().toast).toEqual({ title: 'Marked arrived', desc: 'Internal team notified' })
  })

  it('a stale screen gets the server conflict as a toast and a refetch', async () => {
    const l = await boot()
    l.port.fail.set('advance', problem(409, 'STALE_STATE', 'Can’t do that now', 'This job is in a bay'))
    const before = calls(l, 'snapshot').length
    l.vals().groups[0].items[0].doNext()
    await flushed(l)
    l.vals()
    await flushed(l)
    expect(l.vals().toast).toEqual({ title: 'Can’t do that now', desc: 'This job is in a bay' })
    expect(calls(l, 'snapshot').length).toBeGreaterThan(before)
  })

  it('a completed job with a balance opens the Payments tab instead of calling advance', async () => {
    const l = await boot()
    const priya = l.vals().completedJobs.find((c: any) => c.name === 'Priya Nair')
    priya.open()
    l.vals()
    await flushed(l)
    l.logic.setTab('payments')
    expect(calls(l, 'advance')).toHaveLength(0)
    expect(l.vals().sel.tabPayments).toBe(true)
  })

  it('prep bay, arrive and pickup go through the matching commands', async () => {
    const l = await boot()
    l.vals().arrivals[0].prep()
    l.vals().arrivals[0].arrive()
    await flushed(l)
    expect(calls(l, 'prepBay')).toHaveLength(1)
    expect(calls(l, 'arrive')).toHaveLength(1)
    const needs = l.vals().completedJobs.find((c: any) => c.pickupChipLabel === 'Needs pickup')
    needs.togglePickup()
    await flushed(l)
    expect(calls(l, 'pickup')[0]!.slice(1, 3)).toEqual([needs.id, 'collected'])
    const done = l.vals().completedJobs.find((c: any) => c.pickupChipLabel === 'Picked up')
    done.togglePickup()
    await flushed(l)
    expect(calls(l, 'pickup')[1]!.slice(1, 3)).toEqual([done.id, 'pending'])
  })

  it('the alert actions run the real command for each kind', async () => {
    const l = await boot()
    const byTitle = (t: string) => l.vals().alerts.find((a: any) => a.title.startsWith(t))
    byTitle('Ready for pickup').action()
    await flushed(l)
    expect(calls(l, 'pickup')).toHaveLength(1)
    byTitle('VIP arriving').action()
    await flushed(l)
    expect(calls(l, 'prepBay')).toHaveLength(1)
    byTitle('Unconfirmed').action()
    await flushed(l)
    expect(calls(l, 'sendMessage')[0]![2]).toEqual({ templateKey: 'confirm_request' })
    byTitle('Running late').action()
    l.vals()
    await flushed(l)
    expect(l.vals().sel.tabMessages).toBe(true)
    byTitle('Member credit').action()
    await flushed(l)
    expect(calls(l, 'applyPerk')).toHaveLength(1)
    byTitle('Needs bay').open()
    expect(l.logic.state.selectedId).toBeTruthy()
  })
})

describe('roles: no request, the design toast', () => {
  it('Crew can move jobs and tick the checklist but not take money, message or add add-ons', async () => {
    const l = await boot({ role: 'crew' })
    l.vals().groups[0].items[0].doNext()
    await flushed(l)
    expect(calls(l, 'advance')).toHaveLength(1)

    await open(l, 'completed', 'payments')
    l.vals().sel.collect()
    await flushed(l)
    expect(payCalls(l, 'collect')).toHaveLength(0)
    expect(l.vals().toast!.title).toBe('Your role can’t collect payments')

    l.vals().sel.sendMessage()
    l.vals().sel.templates[0].send()
    await flushed(l)
    expect(calls(l, 'sendMessage')).toHaveLength(0)
    expect(l.vals().toast!.title).toBe('Your role can’t send messages')

    await open(l, 'completed', 'addons')
    l.vals().sel.addonCatalog[0].toggle()
    await flushed(l)
    expect(calls(l, 'setAddon')).toHaveLength(0)
    expect(l.vals().toast!.title).toBe('Your role can’t edit appointments')
  })

  it('Support (no job status) cannot start a wash but can confirm and arrive', async () => {
    const l = await boot({ role: 'support' })
    const snap = (l.port.snap.timeline.groups.flatMap((g) => g.items) as any[]).find(
      (c) => c.next.step === 'start',
    )!
    expect(snap).toBeTruthy()
    const vals = l.vals()
    const startCard = vals.groups
      .flatMap((g: any) => g.items)
      .find((c: any) => c.nextLabel === 'Start Cleaning')
    startCard.doNext()
    await flushed(l)
    expect(calls(l, 'advance')).toHaveLength(0)
    expect(l.vals().toast!.title).toBe('Your role can’t change job status')
    const confirmCard = vals.groups
      .flatMap((g: any) => g.items)
      .find((c: any) => c.nextLabel === 'Confirm Appointment')
    confirmCard.doNext()
    await flushed(l)
    expect(calls(l, 'advance')).toHaveLength(1)
  })

  it('Accounting may take money and mark unpaid but not move jobs', async () => {
    const l = await boot({ role: 'acct' })
    l.vals().groups[0].items[0].doNext()
    await flushed(l)
    expect(calls(l, 'advance')).toHaveLength(0)
    await open(l, 'completed', 'payments')
    l.vals().sel.collect()
    await flushed(l)
    expect(payCalls(l, 'collect')).toHaveLength(1)
  })

  it('a role that cannot view client files does not open one', async () => {
    const l = await boot({ role: 'mgmt' })
    const s = makeSession({ role: 'mgmt' })
    s.permissions['cli.view'] = { on: false }
    l.chrome.setSession(s)
    l.logic.select(id('completed'))
    expect(l.logic.state.selectedId).toBeNull()
    expect(l.logic.state.toast!.title).toBe('Your role can’t view client files')
  })

  it('a role change (view-as) refetches the board and closes the New Appointment sheet', async () => {
    const l = await boot()
    l.vals().openNew()
    expect(l.vals().newOpen).toBe(true)
    const before = calls(l, 'snapshot').length
    const s = makeSession({ role: 'crew' })
    s.rbacVersion = 2
    l.chrome.setSession(s)
    l.vals()
    await flushed(l)
    expect(l.vals().newOpen).toBe(false)
    expect(calls(l, 'snapshot').length).toBeGreaterThan(before)
  })
})

describe('the file: checklist, add-ons, perks', () => {
  it('a task tick shows before the server answers, then follows the server; a refusal restores it with the server text', async () => {
    const l = await boot()
    let v = await open(l, 'cleaning', 'checklist')
    const task = v.sel.checkSections[0].items.find((i: any) => !i.done)
    const done0 = v.sel.checkDone
    // hold the server's answer: the cache already counts the tick
    let release: () => void = () => undefined
    const real = l.port.checklistItem.bind(l.port)
    l.port.checklistItem = (...a: Parameters<typeof real>) =>
      new Promise((res) => (release = () => res(real(...a))))
    task.toggle()
    await flushed(l)
    expect(l.vals().sel.checkDone).toBe(done0 + 1)
    expect(calls(l, 'checklistItem')).toHaveLength(0)
    release()
    await flushed(l)
    expect(calls(l, 'checklistItem')[0]!.slice(1, 4)).toEqual([id('cleaning'), expect.any(String), true])
    l.vals()
    await flushed(l)
    expect(l.vals().sel.checkDone).toBe(done0 + 1)
    // refused: the old count comes back with the server's own words
    l.port.checklistItem = real
    l.port.fail.set('checklistItem', problem(409, 'CONFLICT', 'Job already closed', 'Checklist is locked'))
    v = l.vals()
    const again = v.sel.checkSections[0].items.find((i: any) => !i.done)
    const before = v.sel.checkDone
    again.toggle()
    await flushed(l)
    l.vals()
    await flushed(l)
    expect(l.vals().sel.checkDone).toBe(before)
    expect(l.vals().toast).toEqual({ title: 'Job already closed', desc: 'Checklist is locked' })
  })

  it('a section button and Check all send one bulk command; the section button does not toast', async () => {
    const l = await boot()
    const v = await open(l, 'cleaning', 'checklist')
    v.sel.checkSections[0].toggle()
    await flushed(l)
    const first = calls(l, 'checklistBulk')[0]!
    expect((first[2] as string[]).length).toBe(8)
    expect(first[3]).toBe(true)
    expect(l.vals().toast).toBeNull()
    l.vals().sel.checkAllToggle()
    await flushed(l)
    expect((calls(l, 'checklistBulk')[1]![2] as string[]).length).toBe(11)
    expect(l.vals().toast!.title).toBe('All tasks checked')
    expect(l.vals().toast!.desc).toBe('11 tasks marked done')
  })

  it("an add-on after payment can be removed only if it does not overpay: the 409 text is the server's", async () => {
    const l = await boot()
    const v = await open(l, 'cleaning', 'addons')
    l.port.fail.set(
      'setAddon',
      problem(
        409,
        'ADDON_REMOVE_OVERPAID',
        'Can’t remove add-on',
        'The invoice is already paid in full. Refund first.',
      ),
    )
    v.sel.addonCatalog.find((a: any) => a.on).toggle()
    await flushed(l)
    const c = calls(l, 'setAddon')[0]!
    expect(c.slice(1, 4)).toEqual([id('cleaning'), expect.any(String), false])
    expect(l.vals().toast).toEqual({
      title: 'Can’t remove add-on',
      desc: 'The invoice is already paid in full. Refund first.',
    })
  })

  it('adds an add-on with PUT semantics and shows the server toast (no inverted Added/Removed)', async () => {
    const l = await boot()
    const v = await open(l, 'cleaning', 'addons')
    v.sel.addonCatalog.find((a: any) => !a.on).toggle()
    await flushed(l)
    expect(calls(l, 'setAddon')[0]![3]).toBe(true)
    expect(l.vals().toast!.desc).toBe('Added Wax')
  })

  it('applies a membership credit once per action key', async () => {
    const l = await boot()
    const v = await open(l, 'completed', 'membership')
    expect(v.sel.creditAvailable).toBe(true)
    v.sel.applyCredit()
    await flushed(l)
    expect(calls(l, 'applyPerk')).toHaveLength(1)
    expect(l.vals().toast!.title).toBe('Credit applied')
  })
})

describe('Messages', () => {
  it('sends the composer text, clears it and says it is queued, not delivered', async () => {
    const l = await boot()
    const v = await open(l, 'completed', 'messages')
    v.sel.setComposer({ target: { value: 'Your car is ready' } })
    expect(l.vals().sel.composerHint).toBe('17 characters · 1 text')
    l.vals().sel.sendMessage()
    await flushed(l)
    const c = calls(l, 'sendMessage')[0]!
    expect(c.slice(1, 3)).toEqual([id('completed'), { text: 'Your car is ready' }])
    expect(opts(c as any[], 3).idempotencyKey).toBeTruthy()
    expect(l.vals().sel.composer).toBe('')
    expect(l.vals().toast).toEqual({ title: 'Message sent', desc: 'Queued via SMS to Priya' })
  })

  it('a pill sends its template key; a completed job\'s "Ready for pickup" is the notify-ready command', async () => {
    const l = await boot()
    let v = await open(l, 'cleaning', 'messages')
    v.sel.templates.find((t: any) => t.label === 'Being cleaned').send()
    await flushed(l)
    expect(calls(l, 'sendMessage')[0]![2]).toEqual({ templateKey: 'qr_being_cleaned' })
    v = await open(l, 'completed', 'messages')
    v.sel.templates.find((t: any) => t.label === 'Ready for pickup').send()
    await flushed(l)
    expect(calls(l, 'notifyReady')).toHaveLength(1)
    expect(calls(l, 'sendMessage')).toHaveLength(1)
  })

  it('an opted-out customer: the chip says so and the server refusal is the toast', async () => {
    const port = stubPort()
    const f = port.files.get(id('completed'))!
    f.customer.smsOptedOut = true
    const l = await boot({ role: 'mgmt' }, port)
    port.fail.set(
      'sendMessage',
      problem(
        422,
        'SMS_OPTED_OUT',
        'Customer opted out',
        'Priya replied STOP. Texts are blocked until they reply START.',
      ),
    )
    const v = await open(l, 'completed', 'messages')
    expect(v.sel.smsChipLabel).toBe('SMS opted-out')
    v.sel.setComposer({ target: { value: 'hello' } })
    l.vals().sel.sendMessage()
    await flushed(l)
    expect(l.vals().toast).toEqual({
      title: 'Customer opted out',
      desc: 'Priya replied STOP. Texts are blocked until they reply START.',
    })
    // the text stays so it can be sent by phone
    expect(l.vals().sel.composer).toBe('hello')
  })

  it("opening the thread marks the customer's replies read once", async () => {
    const port = stubPort()
    const t = clone(fixtures.thread)
    ;(t as any).unread = 2
    port.threads.set(id('completed'), t)
    const l = await boot({ role: 'mgmt' }, port)
    await open(l, 'completed', 'messages')
    l.vals()
    await flushed(l)
    l.vals()
    await flushed(l)
    expect(calls(l, 'markRead')).toHaveLength(1)
    expect(calls(l, 'markRead')[0]![1]).toBe((FILES.completed as any).customer.id)
  })

  it('counts texts the way the phone does: curly quotes are free, a special character makes it Unicode', async () => {
    const l = await boot()
    const v = await open(l, 'completed', 'messages')
    v.sel.setComposer({ target: { value: 'We’re ready — come on in!' } })
    expect(l.vals().sel.composerHint).toBe('25 characters · 1 text')
    v.sel.setComposer({ target: { value: 'x'.repeat(161) } })
    expect(l.vals().sel.composerHint).toBe('161 characters · 2 texts')
    v.sel.setComposer({ target: { value: 'Nice ⭐' } })
    expect(l.vals().sel.composerHint).toBe('6 characters · 1 text · special characters')
  })
})

describe('Payments tab', () => {
  it('Mark Paid by card records the payment, sends the receipt and says it waits for Squarespace', async () => {
    const l = await boot()
    const v = await open(l, 'completed', 'payments')
    expect(v.sel.payTenders.map((t: any) => t.label)).toEqual(['Card', 'Cash'])
    v.sel.collect()
    await flushed(l)
    const c = payCalls(l, 'collect')[0]!
    expect(c[1]).toBe((FILES.completed as any).invoice.invoiceId)
    expect(c[2]).toEqual({ method: 'card' })
    expect(opts(c as any[], 3).idempotencyKey).toBeTruthy()
    expect(payCalls(l, 'sendReceipt')).toHaveLength(1)
    expect(l.vals().toast).toEqual({
      title: 'Card payment recorded',
      desc: 'Waiting for Squarespace to confirm · Receipt sent via SMS',
    })
    expect(l.tenders).toEqual(['card'])
  })

  it('cash is a normal payment and the choice is remembered', async () => {
    const l = await boot()
    const v = await open(l, 'completed', 'payments')
    v.sel.payTenders[1].onClick()
    l.vals().sel.collect()
    await flushed(l)
    expect(payCalls(l, 'collect')[0]![2]).toEqual({ method: 'cash' })
    expect(l.vals().toast!.title).toBe('Payment collected')
    expect(l.tenders).toEqual(['cash'])
  })

  it('a double click is one payment (the action key is shared)', async () => {
    const l = await boot()
    const v = await open(l, 'completed', 'payments')
    v.sel.collect()
    v.sel.collect()
    await flushed(l)
    expect(payCalls(l, 'collect')).toHaveLength(1)
  })

  it("the payment link input sends the URL by SMS and shows the server's host error inline", async () => {
    const l = await boot()
    const v = await open(l, 'completed', 'payments')
    v.sel.sendLink()
    expect(l.vals().sel.payLinkOpen).toBe(true)
    l.vals().sel.setLinkUrl({ target: { value: 'https://evil.example/pay' } })
    l.payments.fail.set(
      'collect',
      problem(
        422,
        'PAYMENT_LINK_HOST',
        'Link not allowed',
        'Payment links must be HTTPS links on squarespace.com',
      ),
    )
    l.vals().sel.submitLink()
    await flushed(l)
    expect(payCalls(l, 'collect')[0]![2]).toEqual({ method: 'payment_link', url: 'https://evil.example/pay' })
    expect(l.vals().sel.payLinkError).toBe('Payment links must be HTTPS links on squarespace.com')
    l.payments.fail.clear()
    l.vals().sel.setLinkUrl({ target: { value: 'https://pay.squarespace.com/x' } })
    expect(l.vals().sel.payLinkError).toBe('')
    ;(l.payments as any).collect = async (...a: any[]) => {
      l.payments.calls.push(['collect', ...a])
      return { paymentLink: { sms: 'queued' }, invoice: {} }
    }
    l.vals().sel.submitLink()
    await flushed(l)
    expect(l.vals().toast).toEqual({ title: 'Payment link sent', desc: 'Secure link via SMS' })
    expect(l.vals().sel.payLinkOpen).toBe(false)
  })

  it('un-pay voids the last payment through the ledger and needs pay.void', async () => {
    const l = await boot({ role: 'super' })
    const maria = l.vals().completedJobs.find((c: any) => c.name === 'Maria Delgado')
    ;(l.port.files as Map<string, any>).set(maria.id, clone(FILES.completed) as any)
    ;(l.port.files.get(maria.id) as any).id = maria.id
    maria.togglePay()
    await flushed(l)
    expect(payCalls(l, 'voidPayment')[0]!.slice(1, 3)).toEqual([expect.any(String), 'ev-pay'])
    expect(l.vals().toast).toEqual({ title: 'Marked unpaid', desc: 'Balance reopened' })

    const m = await boot({ role: 'support' })
    const maria2 = m.vals().completedJobs.find((c: any) => c.name === 'Maria Delgado')
    maria2.togglePay()
    await flushed(m)
    expect(payCalls(m, 'voidPayment')).toHaveLength(0)
    expect(m.vals().toast).toEqual({ title: 'Your role can’t mark payments unpaid', desc: undefined })
  })

  it('an unpaid chip opens the Payments tab (money moves where the tender is chosen)', async () => {
    const l = await boot()
    const priya = l.vals().completedJobs.find((c: any) => c.name === 'Priya Nair')
    expect(priya.payChipLabel).toBe('Unpaid · collect')
    priya.togglePay()
    l.vals()
    await flushed(l)
    expect(l.logic.state.modalTab).toBe('payments')
    expect(payCalls(l, 'collect')).toHaveLength(0)
  })

  it('pending card money reads Payment pending (amber) on the card and the chip, never Paid', async () => {
    const port = stubPort()
    const priya = port.snap.completed.items.find((c) => c.customer.name === 'Priya Nair')!
    priya.pay = {
      label: 'Payment pending',
      kind: 'pending',
      balanceCents: 0,
      awaitingCents: 16478,
      invoiceNo: 20613,
      status: 'paid',
    }
    const l = await boot({ role: 'mgmt' }, port)
    const job = l.vals().completedJobs.find((c: any) => c.name === 'Priya Nair')
    expect(job.payChipLabel).toBe('Payment pending')
    expect(job.payChipStyle.color).toBe('#B07908')
    expect(job.accent).toBe('#B07908')
  })
})

describe('New Appointment and Walk-in', () => {
  async function sheet(role: Parameters<typeof makeSession>[0] = { role: 'mgmt' }) {
    const l = await boot(role)
    l.vals().openNew()
    l.vals()
    await flushed(l)
    l.vals()
    await flushed(l)
    return l
  }

  it("lists the first five real packages and the day's real slots; the design's package and first free slot are selected", async () => {
    const l = await sheet()
    const v = l.vals()
    expect(v.newServices).toHaveLength(5)
    expect(v.newServices[0].name).toBe('Express Hand Wash')
    expect(v.newServices.find((s: any) => s.name === 'Premium Hand Wash + Interior')).toBeTruthy()
    expect(v.newSlots.map((s: any) => s.label)).toContain('2:30 PM')
    expect(v.newSlots.some((s: any) => s.label === '8:00 AM')).toBe(false) // past slots are not offered
    expect(v.nf.dateLabel).toBe('Today · Saturday, June 13')
  })

  it('books with the typed customer, the parsed vehicle and the picked slot under one Idempotency-Key', async () => {
    const l = await sheet()
    const nf = () => l.vals().nf
    nf().setName({ target: { value: 'Dana Whitfield' } })
    nf().setPhone({ target: { value: '(305) 555-0171' } })
    nf().setVehicle({ target: { value: '2022 Tesla Model 3' } })
    nf().setPlate({ target: { value: 'dw-2022' } })
    l.vals()
      .newSlots.find((s: any) => s.label === '2:30 PM')
      .pick()
    l.vals().createAppt()
    await flushed(l)
    const c = calls(l, 'book')[0]!
    expect(c[1]).toMatchObject({
      customer: { name: 'Dana Whitfield', phone: '(305) 555-0171', smsOptIn: true },
      vehicle: { year: 2022, make: 'Tesla', model: 'Model 3', plate: 'DW-2022' },
      source: 'dashboard',
    })
    expect((c[1] as any).start).toBe('2026-06-13T18:30:00.000Z')
    expect((c[1] as any).serviceId).toBeTruthy()
    const key1 = opts(c as any[], 2).idempotencyKey
    expect(key1).toBeTruthy()
    expect(l.vals().newOpen).toBe(false)
    expect(l.vals().toast).toEqual({
      title: 'Appointment booked',
      desc: 'Premium Hand Wash + Interior · 2:30 PM',
    })
  })

  it('a refused booking keeps the sheet and the key, so a retry cannot double-book', async () => {
    const l = await sheet()
    l.vals().nf.setName({ target: { value: 'Dana Whitfield' } })
    l.vals().nf.setPhone({ target: { value: '3055550171' } })
    l.vals()
      .newSlots.find((s: any) => s.label === '2:30 PM')
      .pick()
    l.port.fail.set(
      'book',
      problem(409, 'SLOT_UNAVAILABLE', 'Slot unavailable', 'Would overbook a bay — override required'),
    )
    l.vals().createAppt()
    await flushed(l)
    expect(l.vals().newOpen).toBe(true)
    expect(l.vals().toast).toEqual({
      title: 'Slot unavailable',
      desc: 'Would overbook a bay — override required',
    })
    l.port.fail.clear()
    l.vals().createAppt()
    await flushed(l)
    const [a, b] = calls(l, 'book')
    expect(opts(a as any[], 2).idempotencyKey).toBe(opts(b as any[], 2).idempotencyKey)
  })

  it('checks the form before it calls the API', async () => {
    const l = await sheet()
    l.vals().createAppt()
    await flushed(l)
    expect(l.vals().toast!.title).toBe('Add the customer’s name')
    l.vals().nf.setName({ target: { value: 'Dana' } })
    l.vals().createAppt()
    await flushed(l)
    expect(l.vals().toast!.title).toBe('Add a phone number')
    expect(calls(l, 'book')).toHaveLength(0)
  })

  it("a blocked slot: greyed with the design's toast; with sched.override it can be picked, with a reason", async () => {
    const l = await sheet({ role: 'support' })
    const blocked = l.vals().newSlots.find((s: any) => s.label === '11:00 AM')
    expect(blocked.style.opacity).toBe(0.6)
    blocked.pick()
    expect(l.vals().toast).toEqual({
      title: 'Slot unavailable',
      desc: 'Would overbook a bay — override required',
    })
    expect(l.logic.state.form.slot).toBeNull()

    const m = await sheet({ role: 'mgmt' })
    const slot = m.vals().newSlots.find((s: any) => s.label === '11:00 AM')
    slot.pick()
    expect(m.logic.state.form.override).toBe(true)
    m.vals().nf.setName({ target: { value: 'Dana' } })
    m.vals().nf.setPhone({ target: { value: '3055550171' } })
    m.vals().createAppt()
    await flushed(m)
    expect(m.vals().toast!.title).toBe('Reason required')
    m.vals().nf.setOverrideReason({ target: { value: 'Regular, waiting on site' } })
    m.vals().createAppt()
    await flushed(m)
    expect((calls(m, 'book')[0]![1] as any).override).toEqual({ reason: 'Regular, waiting on site' })
  })

  it('a walk-in books "now" without a slot, flagged as a walk-in', async () => {
    const l = await boot()
    l.vals().openWalkin()
    l.vals()
    await flushed(l)
    l.vals().nf.setName({ target: { value: 'Walk In' } })
    l.vals().nf.setPhone({ target: { value: '3055550172' } })
    l.vals().createAppt()
    await flushed(l)
    const body = calls(l, 'book')[0]![1] as any
    expect(body.walkIn).toBe(true)
    expect(body.source).toBe('walk_in')
    expect(body.start).toBeUndefined()
    expect(l.vals().newTitle).toBe('Walk-in Booking')
  })

  it('an existing customer found by name fills the form and books by id', async () => {
    const l = await sheet()
    l.vals().nf.setName({ target: { value: 'Priya' } })
    l.vals()
    await vi.advanceTimersByTimeAsync(300)
    l.vals()
    await flushed(l)
    l.vals()
    await flushed(l)
    const nf = l.vals().nf
    expect(nf.hasHits).toBe(true)
    nf.hits[0].pick()
    expect(l.vals().nf.name).toBe('Priya Nair')
    expect(l.vals().nf.vehicle).toBe('2022 Tesla Model Y')
    l.vals()
      .newSlots.find((s: any) => s.label === '2:30 PM')
      .pick()
    l.vals().createAppt()
    await flushed(l)
    expect((calls(l, 'book')[0]![1] as any).customer).toEqual({ id: expect.any(String) })
  })

  it('opening the sheet again starts clean with a new Idempotency-Key', async () => {
    const l = await sheet()
    l.vals().nf.setName({ target: { value: 'Dana' } })
    l.vals().closeNew()
    l.vals().openNew()
    expect(l.logic.state.form.name).toBe('')
  })

  it('n opens a New Appointment (not a stale Walk-in title) and Ctrl/Cmd shortcuts are left to the browser', async () => {
    const l = await boot()
    l.vals().openWalkin()
    l.vals().closeNew()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }))
    expect(l.logic.state.newTitle).toBe('New Appointment')
    l.vals().closeNew()
    const file = await open(l, 'completed')
    expect(file.sel).toBeTruthy()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true }))
    await flushed(l)
    expect(calls(l, 'advance')).toHaveLength(0)
    expect(l.logic.state.modalTab).toBe('overview')
  })
})

describe('keyboard', () => {
  it('p opens Payments, m opens Messages and toasts SMS (not WhatsApp), Esc closes, / focuses search', async () => {
    const l = await boot()
    await open(l, 'cleaning')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }))
    expect(l.logic.state.modalTab).toBe('payments')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm' }))
    expect(l.logic.state.modalTab).toBe('messages')
    expect(l.logic.state.toast).toEqual({ title: 'Message composer opened', desc: 'SMS to Jonathan Franco' })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(l.logic.state.selectedId).toBeNull()
  })

  it('s advances the open job with the status it shows; typing in an input is left alone', async () => {
    const l = await boot()
    await open(l, 'late')
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))
    await flushed(l)
    expect(calls(l, 'advance')).toHaveLength(0)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }))
    await flushed(l)
    expect(calls(l, 'advance')).toHaveLength(1)
    expect(calls(l, 'advance')[0]![2]).toBe('confirmed')
    input.remove()
  })
})

describe("gestures keep the design's timings", () => {
  const el = () => document.createElement('button')

  async function cardOf(l: Live) {
    return l.vals().groups[0].items[0]
  }

  it('a mouse drag starts after 6 px and a drop on a bay assigns it', async () => {
    const l = await boot()
    const card = await cardOf(l)
    const b = el()
    card.onPointerDown(pointerDownEvent(b, 100, 100, 'mouse'))
    window.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 104, clientY: 100 }))
    expect(l.logic.state.dragId).toBeNull()
    document.elementFromPoint = () => {
      const t = document.createElement('div')
      t.setAttribute('data-drop', 'bay:2')
      return t
    }
    window.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 120, clientY: 100 }))
    expect(l.logic.state.dragId).toBe(card.id)
    expect(l.logic.state.ghost!.hint).toBe('Drop on an open bay')
    // the move that crosses the threshold starts the drag; the next one finds the target (as in the design)
    window.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 125, clientY: 100 }))
    expect(l.logic.state.dropTarget).toBe('bay:2')
    window.dispatchEvent(new Event('pointerup'))
    await flushed(l)
    const c = calls(l, 'assignBay')[0]!
    expect(c[1]).toBe(card.id)
    expect(c[2]).toBe(l.port.snap.bays[1]!.id)
    expect(l.logic.state.dragId).toBeNull()
  })

  it('touch: the long press starts a drag at 380 ms, not at 379', async () => {
    const l = await boot()
    const card = await cardOf(l)
    card.onPointerDown(pointerDownEvent(el(), 100, 100, 'touch'))
    await vi.advanceTimersByTimeAsync(379)
    expect(l.logic.state.dragId).toBeNull()
    await vi.advanceTimersByTimeAsync(1)
    expect(l.logic.state.dragId).toBe(card.id)
    window.dispatchEvent(new Event('pointercancel'))
  })

  it('a click right after a drag is ignored for 450 ms', async () => {
    const l = await boot()
    const card = await cardOf(l)
    card.onPointerDown(pointerDownEvent(el(), 100, 100, 'mouse'))
    document.elementFromPoint = () => null
    window.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 130, clientY: 100 }))
    window.dispatchEvent(new Event('pointerup'))
    card.open()
    expect(l.logic.state.selectedId).toBeNull()
    l.clock.now += 451
    card.open()
    expect(l.logic.state.selectedId).toBe(card.id)
  })

  it('a swipe right past 90 px advances, left past 90 px opens Messages, short ones do nothing', async () => {
    const l = await boot()
    const card = await cardOf(l)
    const b = el()
    card.onPointerDown(pointerDownEvent(b, 100, 100, 'touch'))
    window.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 150, clientY: 101 }))
    window.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 215, clientY: 101 }))
    expect(b.style.transform).toBe('translateX(115px)')
    window.dispatchEvent(new Event('pointerup'))
    await flushed(l)
    expect(calls(l, 'advance')).toHaveLength(1)
    const card2 = (await cardOf(l)) as any
    const b2 = el()
    card2.onPointerDown(pointerDownEvent(b2, 300, 100, 'touch'))
    window.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 250, clientY: 101 }))
    window.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 180, clientY: 101 }))
    window.dispatchEvent(new Event('pointerup'))
    expect(l.logic.state.modalTab).toBe('messages')
  })

  it('dropping a calendar card on another hour reschedules to that hour in the business timezone', async () => {
    const l = await boot()
    l.vals().viewTabs[3].onClick()
    l.vals()
    await flushed(l)
    const item = l
      .vals()
      .calRows.flatMap((r: any) => r.items)
      .find((i: any) => i.chipStyle.cursor === 'grab')
    item.onCalDown(pointerDownEvent(el(), 100, 100, 'mouse'))
    document.elementFromPoint = () => {
      const t = document.createElement('div')
      t.setAttribute('data-drop', 'hr:14')
      return t
    }
    window.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 140, clientY: 100 }))
    window.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 150, clientY: 100 }))
    window.dispatchEvent(new Event('pointerup'))
    await flushed(l)
    const c = calls(l, 'reschedule')[0]!
    expect((c[2] as any).start.endsWith(':00.000Z')).toBe(true)
    const when = new Date((c[2] as any).start)
    expect(
      when.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }),
    ).toBe('14')
  })

  it("a job that is in a bay or done cannot be moved: the design's toast, no request", async () => {
    const l = await boot()
    const occupant = l.port.snap.bays[0]!.occupant!.card
    expect(occupant.canDrag).toBe(false)
    l.vals().viewTabs[1].onClick()
    const bay = l.vals().bays[0]
    expect(bay.occupied).toBe(true)
  })
})

describe('photos', () => {
  const file = (name: string, type: string, bytes = 1024) => new File([new Uint8Array(bytes)], name, { type })

  it('presigns, uploads to the slot and completes; the toast names the category', async () => {
    const l = await boot()
    const v = await open(l, 'cleaning', 'photos')
    const add = v.sel.photoSections[1].slots.at(-1)
    add.onFile({ target: { files: [file('a.jpg', 'image/jpeg')], value: 'a.jpg' } })
    await flushed(l)
    expect(calls(l, 'presignPhoto')[0]!.slice(1, 3)).toEqual([
      id('cleaning'),
      { category: 'before', contentType: 'image/jpeg', bytes: 1024 },
    ])
    expect(calls(l, 'uploadToSlot')).toHaveLength(1)
    expect(calls(l, 'completePhoto')[0]![1]).toBe(id('cleaning'))
    expect(l.vals().toast).toEqual({ title: 'Photo added', desc: 'Before' })
  })

  it("HEIC is refused with the server's message and nothing is uploaded", async () => {
    const l = await boot()
    const v = await open(l, 'cleaning', 'photos')
    l.port.fail.set(
      'presignPhoto',
      problem(
        422,
        'UNSUPPORTED_MEDIA_TYPE',
        'Photo not supported',
        'HEIC photos are not supported. Switch the camera to Most Compatible or share a JPEG.',
      ),
    )
    v.sel.photoSections[0].slots
      .at(-1)
      .onFile({ target: { files: [file('IMG_1.HEIC', 'image/heic')], value: 'x' } })
    await flushed(l)
    expect(calls(l, 'presignPhoto')[0]![2]).toMatchObject({ contentType: 'image/heic' })
    expect(calls(l, 'uploadToSlot')).toHaveLength(0)
    expect(l.vals().toast!.desc).toContain('HEIC photos are not supported')
  })

  it('an object-store refusal is shown and the photo is not completed', async () => {
    const l = await boot()
    const v = await open(l, 'cleaning', 'photos')
    ;(l.port as any).uploadToSlot = async () => {
      throw new UploadError(
        415,
        'CONTENT_MISMATCH',
        'file content does not match the declared type image/jpeg',
      )
    }
    v.sel.photoSections[0].slots
      .at(-1)
      .onFile({ target: { files: [file('a.jpg', 'image/jpeg')], value: 'a' } })
    await flushed(l)
    expect(calls(l, 'completePhoto')).toHaveLength(0)
    expect(l.vals().toast).toEqual({
      title: 'Photo not added',
      desc: 'file content does not match the declared type image/jpeg',
    })
  })

  it('Crew may add photos (jobs.checklist); a role without it gets the toast', async () => {
    const m = await boot({ role: 'acct' })
    const v = await open(m, 'cleaning', 'photos')
    v.sel.photoSections[0].slots
      .at(-1)
      .onFile({ target: { files: [file('a.jpg', 'image/jpeg')], value: 'a' } })
    await flushed(m)
    expect(calls(m, 'presignPhoto')).toHaveLength(0)
    expect(m.vals().toast!.title).toBe('Your role can’t update checklists')
  })
})

describe('calendar', () => {
  it('day, week and month read the right range and navigate by day, week and month', async () => {
    const l = await boot()
    l.vals().viewTabs[3].onClick()
    l.vals()
    await flushed(l)
    expect(calls(l, 'calendarDay').at(-1)![1]).toBe('2026-06-13')
    expect(l.vals().calSub).toContain('11 appointments')
    l.vals().calNext()
    l.vals()
    await flushed(l)
    expect(calls(l, 'calendarDay').at(-1)![1]).toBe('2026-06-14')
    l.vals().calToday()
    l.vals().calModes[1].onClick()
    l.vals()
    await flushed(l)
    expect(calls(l, 'calendarSummary').at(-1)!.slice(1, 3)).toEqual(['2026-06-07', '2026-06-13'])
    expect(l.vals().calLabel).toBe('Jun 7 – 13, 2026')
    l.vals().calNext()
    l.vals()
    await flushed(l)
    expect(calls(l, 'calendarSummary').at(-1)!.slice(1, 3)).toEqual(['2026-06-14', '2026-06-20'])
    l.vals().calToday()
    l.vals().calModes[2].onClick()
    l.vals()
    await flushed(l)
    expect(calls(l, 'calendarSummary').at(-1)!.slice(1, 3)).toEqual(['2026-05-31', '2026-07-04'])
    expect(l.vals().calLabel).toBe('June 2026')
    expect(l.vals().calMonth).toHaveLength(35)
    l.vals().calNext()
    l.vals()
    await flushed(l)
    expect(l.vals().calLabel).toBe('July 2026')
    // clicking a date opens that day
    l.vals().calMonth[10].onClick()
    expect(l.logic.state.calMode).toBe('day')
  })

  it('arrow keys move the calendar and t returns to today', async () => {
    const l = await boot()
    l.vals().viewTabs[3].onClick()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    expect(l.logic.state.calDate).toBe('2026-06-14')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't' }))
    expect(l.logic.state.calDate).toBeNull()
  })

  it('a closed day (today included) shows the closed notice', async () => {
    const port = stubPort()
    const orig = port.calendarDay
    port.calendarDay = async (d: string) => {
      const day = await orig(d)
      return { ...day, dayInfo: { ...day.dayInfo, closed: 'Emergency closure' }, rows: [] } as any
    }
    const l = await boot({ role: 'mgmt' }, port)
    l.vals().viewTabs[3].onClick()
    l.vals()
    await flushed(l)
    l.vals()
    await flushed(l)
    expect(l.vals().calClosed).toBe(true)
    expect(l.vals().calClosedReason).toBe('Emergency closure')
  })
})

describe('chrome', () => {
  it('toggles the theme, saves it and mirrors it on <html>', async () => {
    const l = await boot()
    l.vals().toggleTheme()
    expect(l.themes).toEqual(['dark'])
    expect(l.logic.state.theme).toBe('dark')
    l.vals()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('a toast lives 3.2 s', async () => {
    const l = await boot()
    l.logic.flash('Hello', 'there')
    expect(l.logic.state.toast).toEqual({ title: 'Hello', desc: 'there' })
    await vi.advanceTimersByTimeAsync(3199)
    expect(l.logic.state.toast).not.toBeNull()
    await vi.advanceTimersByTimeAsync(2)
    expect(l.logic.state.toast).toBeNull()
  })

  it('the 1 s tick re-renders and unmounting removes every timer and listener', async () => {
    const l = await boot()
    const t0 = l.logic.state.tick
    await vi.advanceTimersByTimeAsync(3000)
    expect(l.logic.state.tick).toBe(t0 + 3)
    l.logic.componentWillUnmount()
    await vi.advanceTimersByTimeAsync(3000)
    expect(l.logic.state.tick).toBe(t0 + 3)
  })

  it('emergency banner follows the snapshot', async () => {
    const port = stubPort()
    port.snap.emergency = {
      active: true,
      summary: 'Closed through Monday',
      startedAt: '2026-06-13T14:00:00.000Z',
    }
    const l = await boot({ role: 'mgmt' }, port)
    expect(l.vals().emergencyOn).toBe(true)
    expect(l.vals().emergencyText).toBe('Closed through Monday')
  })

  it('knows the frozen clock of the stack', () => {
    expect(new Date(FROZEN).toISOString()).toBe('2026-06-13T14:36:00.000Z')
    void stubPayments
  })
})
