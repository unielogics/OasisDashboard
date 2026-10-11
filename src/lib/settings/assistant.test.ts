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
  }
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
