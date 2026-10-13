// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// Settings → Oasis AI → Practice and Conversations on LiveData over fakes of the api-spec 15.6e/f contract (ADR 0174 §4,
// §5): "coming soon" while the routes answer 501; the persona picker (a client on file needs cli.view); a session; a text
// as a 202 running turn, the session read again every 2 s while it runs and at once on `assistant.practice.turn`; badges,
// link markers and the confirmation it would text; "Correct this answer" (409 replace, 422 save as a draft) then "Try
// again"; the banners; the review of real chats with its filters and "This answer was wrong".
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/data/http/problem'
import { keysForEvent } from '@/data/realtime/invalidation'
import { asst, ev, fakePractice, fakeReview, makeAssistant, openTab, turn } from './assistant-testkit'

beforeAll(() => {
  process.env.TZ = 'America/New_York'
})
beforeEach(() => {
  vi.useRealTimers()
  location.hash = ''
})
afterEach(() => vi.restoreAllMocks())

type M = ReturnType<typeof makeAssistant>
const pr = (m: M): any => asst(m.logic).pr
const rv = (m: M): any => asst(m.logic).rv
const corr = (m: M): any => asst(m.logic).corr

describe('practice: the contract of this wave', () => {
  it('a 501 NOT_BUILT says "coming soon" in plain words, nothing else breaks', async () => {
    const m = makeAssistant({ practice: fakePractice(false), review: fakeReview(false) })
    await openTab(m, 'practice', () => !!pr(m).soon)
    expect(pr(m).soonText).toMatch(/^Coming soon: the practice chat is not built yet on the server\./)
    expect(m.toasts).toEqual([])
    await openTab(m, 'conversations', () => !!rv(m).soon)
    expect(rv(m).soonText).toMatch(/^Coming soon: the review of real chats is not built yet on the server\./)
  })
})

describe('practice', () => {
  it('starts a new-texter chat, sends a text, reads it again while it runs, shows the answer', async () => {
    const p = fakePractice()
    const m = makeAssistant({ practice: p })
    await openTab(m, 'practice', () => !!pr(m).ready)
    let v = pr(m)
    expect([v.picking, v.noSessions, v.hasBanners, v.spent]).toEqual([true, true, false, 'Today: $0.42 of $3.00'])
    expect(v.personaText).toMatch(/^Someone the shop has never heard from\./)
    v.start()
    await vi.waitFor(() => expect(pr(m).hasSession).toBe(true))
    expect(p.calls.find((c) => c[0] === 'createSession')![1]).toEqual({ persona: 'new_texter', language: 'en' })
    await vi.waitFor(() => expect(pr(m).noTurns).toBe(true))
    expect(pr(m).sessionTitle).toBe('New texter')
    pr(m).setDraft(ev('Do you have a waiting room?'))
    expect(pr(m).draftCount).toBe('27 / 640')
    pr(m).draftKeys(ev('', 'Enter'))
    await vi.waitFor(() => expect(pr(m).turns).toHaveLength(1))
    const send = p.calls.find((c) => c[0] === 'sendTurn')!
    expect(send.slice(1, 3)).toEqual(['s1', 'Do you have a waiting room?'])
    expect(send[3].idempotencyKey).toBeTruthy()
    v = pr(m)
    expect([v.turns[0].running, v.turns[0].note, v.draft, v.sendStyle.background]).toEqual([
      true,
      'Oasis AI is writing…',
      '',
      'var(--panel3)',
    ])
    // polled every 2 s while it runs
    expect(m.timers.pending()).toBe(1)
    const turnId = p.state.turns.get('s1')![0]!.id
    p.answer(turnId, {
      replyText: 'Yes! Wifi and coffee. Book here: [booking link]',
      extraTexts: ['Your wash is Sat Jun 13 at 10:00 AM. Reply 4821 to confirm.'],
      badges: [
        { kind: 'link', label: 'Booking link' },
        { kind: 'rewritten', label: 'Rewritten' },
      ],
    })
    m.timers.fire()
    await vi.waitFor(() => expect(pr(m).turns[0].running).toBe(false))
    const t = pr(m).turns[0]
    expect(t.parts.map((x: any) => x.text)).toEqual(['Yes! Wifi and coffee. Book here: ', 'booking link'])
    expect(t.parts[1].style.fontWeight).toBe(800)
    expect(t.badges.map((b: any) => b.label)).toEqual(['Booking link', 'Rewritten'])
    expect(t.extras.map((x: any) => x.text)).toEqual(['Your wash is Sat Jun 13 at 10:00 AM. Reply 4821 to confirm.'])
    expect([t.canCorrect, t.canRetry, t.hasNote]).toEqual([true, false, false])
    expect(m.timers.pending()).toBe(0)
  })

  it('the event of a finished turn refetches the practice chats (and the open session)', async () => {
    const p = fakePractice()
    const m = makeAssistant({ practice: p })
    await openTab(m, 'practice', () => !!pr(m).ready)
    pr(m).start()
    await vi.waitFor(() => expect(pr(m).noTurns).toBe(true))
    pr(m).setDraft(ev('Hours?'))
    pr(m).send()
    await vi.waitFor(() => expect(pr(m).turns[0]?.running).toBe(true))
    p.answer(p.state.turns.get('s1')![0]!.id, { replyText: 'Open 8 to 6 today.' })
    const keys = keysForEvent({ id: 1, channel: 'notifications', type: 'assistant.practice.turn', payload: { sessionId: 's1' }, at: '' })
    for (const k of keys) await m.qc.invalidateQueries({ queryKey: k })
    await vi.waitFor(() => expect(pr(m).turns[0].parts.map((x: any) => x.text)).toEqual(['Open 8 to 6 today.']))
  })

  it('refusals in plain words: busy, the budget used, practice off', async () => {
    const p = fakePractice()
    const m = makeAssistant({ practice: p })
    await openTab(m, 'practice', () => !!pr(m).ready)
    pr(m).start()
    await vi.waitFor(() => expect(pr(m).noTurns).toBe(true))
    p.fail.set('sendTurn', new ApiError({ status: 429, code: 'PRACTICE_BUDGET', title: 'Practice used up today', detail: 'Today’s practice budget is used up. Try again tomorrow' }))
    pr(m).setDraft(ev('Hi'))
    pr(m).send()
    await vi.waitFor(() => expect(pr(m).hasError).toBe(true))
    expect(pr(m).error).toBe('Today’s practice budget is used up. Practice works again tomorrow.')
    expect(pr(m).draft).toBe('Hi')
    expect(m.toasts).toEqual([])
    p.state.practice = { ...p.state.practice, enabled: false, actionsEnabled: false }
    await m.qc.invalidateQueries({ queryKey: ['settings', 'assistant_practice'] })
    await vi.waitFor(() => expect(pr(m).banners).toHaveLength(2))
    expect(pr(m).banners.map((b: any) => b.text)).toEqual([
      'Practice is off on the server for now. You can look around; nothing runs until it is switched on.',
      'Booking by text is off on the server, so Oasis AI offers a booking link here, as it would for real.',
    ])
    expect(pr(m).sendStyle.background).toBe('var(--panel3)')
  })

  it('a client on file: needs View client files; search, pick, verified or not', async () => {
    const p = fakePractice()
    const crewish = makeAssistant({
      practice: fakePractice(),
      permissions: { 'set.assistant': { on: true }, 'cli.view': { on: false } },
      role: 'crew',
    })
    await openTab(crewish, 'practice', () => !!pr(crewish).ready)
    pr(crewish).pickClient()
    expect(crewish.toasts.at(-1)).toEqual({ title: 'Your role can’t view client files' })
    expect(pr(crewish).isClient).toBe(false)

    const m = makeAssistant({ practice: p })
    await openTab(m, 'practice', () => !!pr(m).ready)
    pr(m).pickClient()
    expect(pr(m).isClient).toBe(true)
    pr(m).start()
    expect(pr(m).error).toBe('Find the client first: type a name or a number.')
    pr(m).setClientQuery(ev('pri'))
    expect(m.timers.pending()).toBe(1)
    m.timers.fire()
    await vi.waitFor(() => expect(pr(m).hasHits).toBe(true))
    expect(pr(m).hits.map((h: any) => h.label)).toEqual(['Priya Nair · •••0142'])
    pr(m).hits[0].onClick()
    pr(m).toggleVerified()
    pr(m).toggleSpanish()
    pr(m).start()
    await vi.waitFor(() => expect(pr(m).hasSession).toBe(true))
    expect(p.calls.find((c) => c[0] === 'createSession')![1]).toEqual({
      persona: 'client',
      language: 'es',
      customerId: 'c1',
      verified: false,
    })
    await vi.waitFor(() => expect(pr(m).sessionTitle).toBe('Priya · not verified · Spanish'))
  })

  it('Correct this answer, then Try again shows the re-run under the original', async () => {
    const p = fakePractice()
    const r = fakeReview()
    p.state.sessions.push({
      id: 's9',
      persona: 'new_texter',
      client: null,
      verified: false,
      language: 'en',
      includeEntryIds: [],
      turns: 1,
      costMicros: 0,
      createdAt: '2026-06-13T14:00:00Z',
      updatedAt: '2026-06-13T14:00:00Z',
    })
    p.state.turns.set('s9', [turn({ id: 't1', sessionId: 's9', replyText: 'Sorry, no waiting room.' , badges: [] })])
    const m = makeAssistant({ practice: p, review: r })
    await openTab(m, 'practice', () => !!pr(m).ready)
    pr(m).sessions[0].onClick()
    await vi.waitFor(() => expect(pr(m).turns).toHaveLength(1))
    pr(m).turns[0].correct()
    let c = corr(m)
    expect([c.open, c.title, c.wrong, c.question]).toEqual([
      true,
      'Correct this answer',
      'Sorry, no waiting room.',
      'Do you have a waiting room?',
    ])
    c.save()
    expect(corr(m).answerError).toBe('Write the right answer.')
    corr(m).setAnswer(ev('Yes! Our lounge has wifi and coffee. It is $5 cheaper online.'))
    expect(corr(m).warnings.map((w: any) => w.text)).toEqual([
      '“$5” is hidden from Oasis AI: it quotes prices only from Settings → Prices.',
    ])
    corr(m).save()
    await vi.waitFor(() => expect(corr(m).open).toBe(false))
    expect(r.calls.find((x) => x[0] === 'createCorrection')![1]).toEqual({
      clientText: 'Do you have a waiting room?',
      rightAnswer: 'Yes! Our lounge has wifi and coffee. It is $5 cheaper online.',
      source: 'practice',
      active: true,
      practiceTurnId: 't1',
    })
    expect(m.toasts.at(-1)).toEqual({ title: 'Correction saved', desc: 'Oasis AI uses it from the next text' })
    expect(pr(m).turns[0].canRetry).toBe(true)
    pr(m).turns[0].tryAgain()
    await vi.waitFor(() => expect(pr(m).turns[0].reruns).toHaveLength(1))
    const re = pr(m).turns[0].reruns[0]
    expect([re.rerunLabel, re.running, re.canCorrect]).toEqual(['After your correction', true, false])
    expect(p.calls.find((x) => x[0] === 'rerun')![1]).toBe('t1')
    expect(pr(m).turns[0].canRetry).toBe(false)
    // the same question again: replace the earlier one
    pr(m).turns[0].correct()
    corr(m).setAnswer(ev('Yes, the lounge is open all day.'))
    corr(m).save()
    await vi.waitFor(() => expect(corr(m).canReplace).toBe(true))
    c = corr(m)
    expect(c.error).toBe('There is already a correction for this question. Replace it with this one?')
    c.replace()
    await vi.waitFor(() => expect(corr(m).open).toBe(false))
    expect(r.calls.filter((x) => x[0] === 'createCorrection').at(-1)![1].replaceEntryId).toBe('k1')
  })

  it('knowledge full: the correction is offered as a draft', async () => {
    const r = fakeReview()
    r.fail.set(
      'createCorrection',
      new ApiError({ status: 422, code: 'KNOWLEDGE_BUDGET', title: 'Knowledge is full', detail: 'x', meta: { usedChars: 20000, maxChars: 20000, needed: 80 } }),
    )
    const p = fakePractice()
    p.state.sessions.push({ id: 's9', persona: 'new_texter', client: null, verified: false, language: 'en', includeEntryIds: [], turns: 1, costMicros: 0, createdAt: '2026-06-13T14:00:00Z', updatedAt: '2026-06-13T14:00:00Z' })
    p.state.turns.set('s9', [turn({ id: 't1', sessionId: 's9' })])
    const m = makeAssistant({ practice: p, review: r })
    await openTab(m, 'practice', () => !!pr(m).ready)
    pr(m).sessions[0].onClick()
    await vi.waitFor(() => expect(pr(m).turns).toHaveLength(1))
    pr(m).turns[0].correct()
    corr(m).setAnswer(ev('Yes, wifi and coffee.'))
    corr(m).save()
    await vi.waitFor(() => expect(corr(m).canDraft).toBe(true))
    expect(corr(m).error).toBe(
      'Knowledge is full: this needs 80 more characters than are left. Turn something off or shorten it first. Or save it as a draft and turn it on later.',
    )
    corr(m).draft()
    await vi.waitFor(() => expect(corr(m).open).toBe(false))
    expect(r.calls.filter((x) => x[0] === 'createCorrection').at(-1)![1].active).toBe(false)
    expect(m.toasts.at(-1)).toEqual({ title: 'Correction saved', desc: 'Saved as a draft in Knowledge' })
  })

  it('a role without set.assistant: locked, nothing read', async () => {
    const p = fakePractice()
    const m = makeAssistant({ role: 'support', practice: p })
    await openTab(m, 'practice', () => !!pr(m).locked)
    expect(p.calls).toEqual([])
  })
})

describe('conversations (training review)', () => {
  it('needs set.assistant and View client files', async () => {
    const r = fakeReview()
    const m = makeAssistant({ review: r, role: 'crew', permissions: { 'set.assistant': { on: true }, 'cli.view': { on: false } } })
    await openTab(m, 'conversations', () => !!rv(m).locked)
    expect(rv(m).lockedText).toMatch(/“Oasis AI assistant” and the “View client files” permissions/)
    expect(r.calls).toEqual([])
  })

  it('filters, the list, one chat in plain words, and This answer was wrong', async () => {
    const r = fakeReview()
    const m = makeAssistant({ review: r })
    await openTab(m, 'conversations', () => !!rv(m).ready)
    let v = rv(m)
    expect(r.calls[0]).toEqual(['conversations', { days: 30, filter: 'all', limit: 30 }])
    expect(v.days.map((d: any) => [d.label, d.style.background])).toEqual([
      ['7 days', 'transparent'],
      ['30 days', 'var(--accent)'],
      ['90 days', 'transparent'],
    ])
    expect(v.rows.map((x: any) => [x.label, x.flags.map((f: any) => f.label)])).toEqual([
      ['Priya · •••0142', ['Waiting for the team (asked for person)']],
      ['Client · •••0199', ['Policy check stepped in']],
    ])
    expect([v.noPick, v.pickText]).toEqual([true, 'Pick a chat on the left to read it.'])
    v.filters[3].onClick()
    await vi.waitFor(() => expect(rv(m).rows).toHaveLength(1))
    expect(r.calls.at(-1)).toEqual(['conversations', { days: 30, filter: 'judge', limit: 30 }])
    rv(m).filters[0].onClick()
    await vi.waitFor(() => expect(rv(m).rows).toHaveLength(2))
    rv(m).rows[0].onClick()
    await vi.waitFor(() => expect(rv(m).turns).toHaveLength(1))
    v = rv(m)
    expect(v.title).toBe('Priya · •••0142')
    const t = v.turns[0]
    expect(t.clientTexts.map((x: any) => x.text)).toEqual(['Do you clean engine bays?'])
    expect(t.parts.map((x: any) => x.text)).toEqual(['Sorry, we don’t do engine bays. Book a wash: ', 'link'])
    expect(t.facts.map((x: any) => x.text)).toEqual(['Policy check: passed', 'It looked up services'])
    t.wrong()
    expect([corr(m).title, corr(m).question, corr(m).wrong]).toEqual([
      'This answer was wrong',
      'Do you clean engine bays?',
      'Sorry, we don’t do engine bays. Book a wash: [link]',
    ])
    corr(m).setQuestion(ev('Do you clean the engine?'))
    corr(m).setAnswer(ev('Yes, as part of Executive Detail; the team confirms the details.'))
    corr(m).toggleActive()
    corr(m).save()
    await vi.waitFor(() => expect(corr(m).open).toBe(false))
    expect(r.calls.find((x) => x[0] === 'createCorrection')![1]).toEqual({
      clientText: 'Do you clean the engine?',
      rightAnswer: 'Yes, as part of Executive Detail; the team confirms the details.',
      source: 'live',
      active: false,
      assistantTurnId: 'at1',
    })
  })

  it('Show more reads the next page', async () => {
    const r = fakeReview()
    r.state.nextCursor = 'c2'
    const m = makeAssistant({ review: r })
    await openTab(m, 'conversations', () => !!rv(m).ready)
    expect(rv(m).hasMore).toBe(true)
    r.state.conversations = [{ id: 'v3', client: { firstName: 'Liam', phoneLast4: '0177' }, lastTurnAt: '2026-06-12T14:00:00Z', turns: 3, handoff: null, flags: [] }]
    rv(m).loadMore()
    await vi.waitFor(() => expect(rv(m).rows.map((x: any) => x.label)).toContain('Liam · •••0177'))
    expect(rv(m).hasMore).toBe(false)
  })
})
