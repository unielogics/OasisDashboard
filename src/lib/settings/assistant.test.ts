// The pure parts of Settings → Oasis AI assistant: numbers read like the server reads them, the checks before a save,
// the changed fields a save sends, and the plain words of the status strip.
import { describe, expect, it } from 'vitest'
import {
  MAX_NUMBERS,
  STAGES,
  assistantStatus,
  changedFields,
  clampPause,
  faqProblems,
  formatPhone,
  numberProblem,
  pauseLabel,
  stageOf,
  toE164,
  ALWAYS_ON,
  BEHAVIOR_LISTS,
  CAPABILITIES,
  DEFAULT_BEHAVIOR,
  DEFAULT_CAPABILITIES,
  LIMITS_APPLIED,
  TONES,
  answerOnlyCapabilities,
  behaviorProblems,
  isAnswerOnly,
  listItemProblem,
  signOffProblem,
  styleNotesProblem,
} from './assistant'
import type { AssistantFields } from './assistant'

describe('numbers', () => {
  it('reads the ways people write a US or Canadian number', () => {
    for (const t of ['(201) 555-0142', '201-555-0142', '201.555.0142', '2015550142', '+1 201 555 0142', '1-201-555-0142'])
      expect(toE164(t), t).toBe('+12015550142')
  })

  it('refuses what is not one', () => {
    for (const t of ['', '555-0142', '+44 20 7946 0958', '(101) 555-0142', '(201) 155-0142', '201555014', 'call me', '+1 201 555 01423'])
      expect(toE164(t), t).toBeNull()
  })

  it('shows E.164 the way people write it', () => {
    expect(formatPhone('+12015550142')).toBe('(201) 555-0142')
    expect(formatPhone('+442079460958')).toBe('+442079460958')
    // a reader without set.hours gets the numbers masked by the server
    expect(formatPhone('+1******0142')).toBe('(•••) •••-0142')
  })

  it('says why a number cannot join the list', () => {
    const list = ['+12015550142']
    expect(numberProblem('  ', list)).toBe('Type a phone number first.')
    expect(numberProblem('12345', list)).toBe('Enter a 10-digit US or Canadian number.')
    expect(numberProblem('(201) 555-0142', list)).toBe('That number is already in the list.')
    expect(numberProblem('(973) 555-0101', list)).toBeNull()
    const full = Array.from({ length: MAX_NUMBERS }, (_, i) => '+1201555' + String(1000 + i))
    expect(numberProblem('(973) 555-0101', full)).toBe('The list holds 50 numbers at most.')
  })
})

describe('stages and the pause', () => {
  it('three stages in rollout order, explained in plain words', () => {
    expect(STAGES.map((s) => s.label)).toEqual(['Test numbers', 'Clients', 'Everyone'])
    expect(stageOf('customers').explain).toContain('A number the shop doesn’t know reaches the team as today.')
    expect(stageOf('everyone').explain).toContain('new numbers too')
    expect(stageOf('nonsense').key).toBe('allowlist')
  })

  it('1 to 72 hours', () => {
    expect([clampPause(0), clampPause(12.4), clampPause(99)]).toEqual([1, 12, 72])
    expect([pauseLabel(1), pauseLabel(12)]).toEqual(['1 hour', '12 hours'])
  })
})

describe('FAQ checks', () => {
  it('both lines written, 500 characters at most, each question once (case and spaces ignored)', () => {
    expect(
      faqProblems([
        { q: 'Do you take walk-ins?', a: 'Yes.' },
        { q: '  ', a: 'x'.repeat(501) },
        { q: 'do you  take walk-ins?', a: 'Yes' },
        { q: 'y'.repeat(501), a: '' },
      ]),
    ).toEqual({
      'faq.1.q': 'Write the question.',
      'faq.1.a': '500 characters at most (now 501).',
      'faq.2.q': 'This question is already in the list.',
      'faq.3.q': '500 characters at most (now 501).',
      'faq.3.a': 'Write the answer.',
    })
    expect(faqProblems([{ q: ' Hours? ', a: ' Mon–Sat 8–6 ' }])).toEqual({})
  })
})

describe('changed fields', () => {
  const server: AssistantFields = {
    enabled: false,
    actionsEnabled: false,
    stage: 'allowlist',
    allowlist: ['+12015550142'],
    staffPauseHours: 12,
    faq: [{ q: 'Q', a: 'A' }],
    capabilities: { ...DEFAULT_CAPABILITIES },
    behavior: { ...DEFAULT_BEHAVIOR, avoidWords: [], avoidTopics: [], handoffTopics: [] },
  }
  it('limits and tone compare whole, whatever the key order', () => {
    const reordered = Object.fromEntries(Object.entries(server.behavior).reverse()) as typeof server.behavior
    expect(changedFields(server, { behavior: reordered, capabilities: { ...server.capabilities } })).toEqual({})
    expect(changedFields(server, { behavior: { ...server.behavior, tone: 'warm' } })).toEqual({
      behavior: { ...server.behavior, tone: 'warm' },
    })
  })
  it('only what differs from the server, lists compared whole', () => {
    expect(changedFields(server, {})).toEqual({})
    expect(changedFields(server, { enabled: false, allowlist: ['+12015550142'] })).toEqual({})
    expect(changedFields(server, { enabled: true, faq: [{ q: 'Q', a: 'B' }] })).toEqual({
      enabled: true,
      faq: [{ q: 'Q', a: 'B' }],
    })
  })
})

describe('the status strip', () => {
  const server = (aiEnabled: boolean) => ({ aiEnabled, actionsEnabled: false })
  it('says whether texts get AI answers now, and why not', () => {
    expect(assistantStatus({ enabled: true, active: true, server: server(true) })).toEqual({
      on: true,
      text: 'Oasis AI is answering texts.',
    })
    expect(assistantStatus({ enabled: false, active: false, server: server(true) }).text).toBe(
      'Oasis AI is off: texts reach the team as today.',
    )
    expect(assistantStatus({ enabled: true, active: false, server: server(false) }).text).toBe(
      'Oasis AI is switched on here but still off on the server, so it answers nobody yet. Texts reach the team as today.',
    )
    expect(assistantStatus({ enabled: false, active: false, server: server(false) }).on).toBe(false)
  })
})

describe('limits and tone (ADR 0174 §3)', () => {
  const b = () => ({ ...DEFAULT_BEHAVIOR, avoidWords: [] as string[], avoidTopics: [] as string[], handoffTopics: [] as string[] })

  it('the defaults are today: every capability on, friendly, standard, Spanish answered, no lists, no sign-off', () => {
    expect(Object.values(DEFAULT_CAPABILITIES).every(Boolean)).toBe(true)
    expect(CAPABILITIES.map((c) => c.key)).toEqual(['availability', 'bookingLinks', 'membershipLinks', 'paymentLinks', 'accountInfo'])
    expect(DEFAULT_BEHAVIOR).toEqual({
      tone: 'friendly',
      length: 'standard',
      styleNotes: '',
      spanish: 'on',
      avoidWords: [],
      avoidTopics: [],
      handoffTopics: [],
      signOff: '',
    })
    // the turn applies them from the policy wave on; until then the tab says so
    expect(LIMITS_APPLIED).toBe(false)
  })

  it('"Answer questions only" is every capability and booking by text off', () => {
    expect(isAnswerOnly(answerOnlyCapabilities(), false)).toBe(true)
    expect(isAnswerOnly(answerOnlyCapabilities(), true)).toBe(false)
    expect(isAnswerOnly({ ...answerOnlyCapabilities(), accountInfo: true }, false)).toBe(false)
    expect(isAnswerOnly({ ...DEFAULT_CAPABILITIES }, false)).toBe(false)
  })

  it('four tones, each with a static example reply; the always-on rules in plain words', () => {
    expect(TONES.map((t) => t.key)).toEqual(['friendly', 'professional', 'warm', 'concise'])
    for (const t of TONES) expect(t.example.length).toBeLessThan(160)
    expect(ALWAYS_ON.join(' ')).toMatch(/Settings → Prices/)
    expect(ALWAYS_ON.join(' ')).toMatch(/STOP always works/)
  })

  it('a word or topic: plain, its length, once (case and spaces ignored), never in both topic lists, a maximum', () => {
    const x = b()
    expect(listItemProblem(x, 'avoidWords', ' ')).toBe('Type a word first.')
    expect(listItemProblem(x, 'avoidTopics', '')).toBe('Type a topic first.')
    expect(listItemProblem(x, 'avoidWords', 'a')).toBe('Use 2 to 40 characters.')
    expect(listItemProblem(x, 'avoidTopics', 'ab')).toBe('Use 3 to 80 characters.')
    expect(listItemProblem(x, 'avoidWords', 'cheap<b>')).toBe('Use plain text.')
    expect(listItemProblem(x, 'avoidWords', 'che\u200bap')).toBe('Use plain text.')
    x.avoidWords = ['Cheap  deal']
    expect(listItemProblem(x, 'avoidWords', ' cheap deal ')).toBe('That’s already in the list.')
    x.handoffTopics = ['Insurance claim']
    expect(listItemProblem(x, 'avoidTopics', 'insurance claim')).toBe(
      'That topic is already in “Always hand to the team”. A topic is either avoided or handed to the team.',
    )
    x.avoidTopics = ['competitors']
    expect(listItemProblem(x, 'handoffTopics', 'Competitors')).toMatch(/already in “Topics to avoid”/)
    x.avoidWords = Array.from({ length: 30 }, (_, i) => 'word' + i)
    expect(listItemProblem(x, 'avoidWords', 'dude')).toBe('The list holds 30 at most.')
    expect(listItemProblem(b(), 'avoidWords', 'dude')).toBeNull()
    expect(BEHAVIOR_LISTS.map((l) => [l.key, l.most])).toEqual([
      ['avoidWords', 30],
      ['avoidTopics', 15],
      ['handoffTopics', 15],
    ])
  })

  it('the sign-off: 24 characters, no amount, number, link or promise; style notes 400', () => {
    expect(signOffProblem('')).toBeNull()
    expect(signOffProblem('– Oasis Auto Spa')).toBeNull()
    expect(signOffProblem('x'.repeat(25))).toBe('24 characters at most (now 25).')
    for (const t of ['$5 off today', 'Call 555', 'oasis.com', 'Free wash!', '10% off'])
      expect(signOffProblem(t), t).toBe('The sign-off cannot hold an amount, a number, a link or a promise.')
    expect(styleNotesProblem('x'.repeat(400))).toBeNull()
    expect(styleNotesProblem('x'.repeat(401))).toBe('400 characters at most (now 401).')
    expect(behaviorProblems({ ...b(), signOff: 'Free!', styleNotes: 'x'.repeat(401) })).toEqual({
      'behavior.styleNotes': '400 characters at most (now 401).',
      'behavior.signOff': 'The sign-off cannot hold an amount, a number, a link or a promise.',
    })
  })
})
