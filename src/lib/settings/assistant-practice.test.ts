// The pure parts of Settings → Oasis AI → Practice and Conversations (ADR 0174 §4, §5): link markers, badges, a turn's
// note, the banners, the persona line, and the words of a real conversation's turn.
import { describe, expect, it } from 'vitest'
import {
  badgeTone,
  clientLabel,
  flagWords,
  handoffWords,
  judgeWords,
  personaLine,
  practiceBanners,
  practiceBlocked,
  replyParts,
  toolWords,
  turnNote,
  whenLabel,
} from './assistant-practice'

const p = { enabled: true, budgetUsd: 3, spentTodayUsd: 0.4, actionsEnabled: true, linksEnabled: true }

describe('practice', () => {
  it('splits a reply around its link markers', () => {
    expect(replyParts('Sure! Book here: [booking link] or verify [verify link].')).toEqual([
      { text: 'Sure! Book here: ', link: false },
      { text: 'booking link', link: true },
      { text: ' or verify ', link: false },
      { text: 'verify link', link: true },
      { text: '.', link: false },
    ])
    expect(replyParts('No links [here]')).toEqual([{ text: 'No links [here]', link: false }])
    expect(replyParts('')).toEqual([])
  })

  it('a turn’s note while it runs or when it ended without a plain reply', () => {
    expect(turnNote({ status: 'running', error: null })).toBe('Oasis AI is writing…')
    expect(turnNote({ status: 'replied', error: null })).toBe('')
    expect(turnNote({ status: 'failed', error: 'timeout' })).toBe('Oasis AI could not answer this one: it took too long. Try again.')
    expect(turnNote({ status: 'handed_off', error: null })).toMatch(/^Oasis AI handed this chat to the team\./)
    expect(turnNote({ status: 'opted_out', error: null })).toMatch(/STOP/)
  })

  it('banners: off on the server, the budget used, and the server switches', () => {
    expect(practiceBanners(p)).toEqual([])
    expect(practiceBlocked(p)).toBe(false)
    expect(practiceBanners({ ...p, enabled: false })[0]!.text).toBe(
      'Practice is off on the server for now. You can look around; nothing runs until it is switched on.',
    )
    expect(practiceBanners({ ...p, spentTodayUsd: 3 })[0]!.text).toBe(
      'Today’s practice budget is used up ($3.00 of $3.00). Practice works again tomorrow.',
    )
    expect(practiceBlocked({ ...p, spentTodayUsd: 3.01 })).toBe(true)
    expect(practiceBanners({ ...p, actionsEnabled: false, linksEnabled: false }).map((b) => b.tone)).toEqual([
      'neutral',
      'neutral',
    ])
  })

  it('badge colours and the persona line', () => {
    expect([badgeTone('handed_off'), badgeTone('link'), badgeTone('opted_out'), badgeTone('looked_up')]).toEqual([
      'amber',
      'accent',
      'red',
      'neutral',
    ])
    expect(personaLine({ persona: 'new_texter', client: null, verified: false, language: 'en' })).toBe('New texter')
    expect(personaLine({ persona: 'client', client: { firstName: 'Priya' }, verified: true, language: 'es' })).toBe(
      'Priya · verified · Spanish',
    )
  })

  it('times in the shop’s zone', () => {
    expect(whenLabel('2026-06-13T14:20:00Z', 'America/New_York')).toBe('Jun 13, 10:20 AM')
    expect(whenLabel('nope', 'America/New_York')).toBe('')
  })
})

describe('conversations', () => {
  it('a client by first name and the last four digits only', () => {
    expect(clientLabel({ firstName: 'Priya', phoneLast4: '0142' })).toBe('Priya · •••0142')
    expect(clientLabel({ firstName: null, phoneLast4: '0142' })).toBe('Client · •••0142')
  })
  it('flags, handoffs, the policy check and tools in plain words', () => {
    expect(flagWords('judge')).toBe('Policy check stepped in')
    expect(handoffWords({ open: true, reason: 'asked_for_person' })).toBe('Waiting for the team (asked for person)')
    expect(handoffWords(null)).toBe('')
    expect(judgeWords({ verdict: 'pass', category: null, words: '' })).toBe('Policy check: passed')
    expect(judgeWords({ verdict: 'fail', category: 'price_promise', words: '' })).toBe(
      'Policy check stopped the first draft (price promise)',
    )
    expect(toolWords(['check_availability', 'send_link', 'send_link', 'mystery_tool'])).toBe(
      'looked up open times, texted a link, mystery tool',
    )
  })
})
