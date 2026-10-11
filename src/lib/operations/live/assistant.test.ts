/* eslint-disable @typescript-eslint/no-explicit-any */
// The AI assistant and phone identity wording of the live Operations screen (ADR 0160, design section 8): the "Oasis AI"
// tag, the "AI paused" line (only while the assistant answers texts at all), the tab an alert opens, and the "Website
// PIN" cell (hidden while nothing was ever set, so the file looks as it did with personal links off).
import { describe, expect, it, vi } from 'vitest'
import type { ClientIdentity, Thread } from '@/data/ports/operations'
import {
  aiThreadLine,
  alertTab,
  atText,
  channelTagOf,
  identityShown,
  identityValue,
  identityVM,
  shortDate,
} from './assistant'

const TZ = 'America/New_York'
const TODAY = '2026-06-13'
const NOW = Date.parse('2026-06-13T10:36:00-04:00')

const thread = (over: Partial<Thread> = {}): Thread =>
  ({
    items: [],
    customer: null,
    unread: 0,
    assistantActive: true,
    aiPausedUntil: null,
    handoff: { open: false, since: null, reason: null },
    ...over,
  }) as unknown as Thread

const identity = (over: { pin?: Partial<ClientIdentity['pin']>; trust?: Partial<ClientIdentity['trust']> } = {}) =>
  ({
    customerId: 'c1',
    phone: '+1******0104',
    pin: { status: 'none', setAt: null, lockedUntil: null, resetHoldUntil: null, ...over.pin },
    trust: {
      trusted: false,
      until: null,
      verifiedAt: null,
      verifiedBy: null,
      reason: 'none',
      revokeReason: null,
      ...over.trust,
    },
    links: { live: 0, byKind: {}, lastIssuedAt: null },
    sessions: { live: 0 },
    pendingAction: null,
    stale: null,
  }) as ClientIdentity

describe('the Oasis AI tag', () => {
  it('names the assistant on its own texts, the shop on its automatic texts, nobody on staff and client texts', () => {
    expect(channelTagOf({ from: 'system', author: 'ai', channel: 'sms' })).toBe('Oasis AI · SMS')
    expect(channelTagOf({ from: 'system', author: 'system', channel: 'sms' })).toBe('Automated · SMS')
    expect(channelTagOf({ from: 'system', author: 'system', channel: 'email' })).toBe('Automated · Email')
    expect(channelTagOf({ from: 'staff', author: 'staff', channel: 'sms' })).toBeNull()
    expect(channelTagOf({ from: 'customer', author: 'customer', channel: 'sms' })).toBeNull()
  })
})

describe('the AI paused line', () => {
  it('stays hidden while the assistant answers nobody, whatever the thread says (nothing changes with AI off)', () => {
    const t = thread({
      assistantActive: false,
      aiPausedUntil: '2026-06-13T22:36:00-04:00',
      handoff: { open: true, since: '2026-06-13T10:00:00-04:00', reason: 'agent_keyword' },
    })
    expect(aiThreadLine(t, NOW, TZ, TODAY).show).toBe(false)
    expect(aiThreadLine(undefined, NOW, TZ, TODAY).show).toBe(false)
    // a thread read from a server older than the assistant
    expect(aiThreadLine({ items: [] } as any, NOW, TZ, TODAY).show).toBe(false)
  })

  it('a staff reply pauses it until the time the server says, in plain words', () => {
    const tonight = aiThreadLine(thread({ aiPausedUntil: '2026-06-13T22:36:00-04:00' }), NOW, TZ, TODAY)
    expect(tonight).toEqual({
      show: true,
      text: 'AI paused — staff replying',
      sub: 'Oasis AI answers again at 10:36 PM.',
    })
    expect(aiThreadLine(thread({ aiPausedUntil: '2026-06-14T08:15:00-04:00' }), NOW, TZ, TODAY).sub).toBe(
      'Oasis AI answers again tomorrow at 8:15 AM.',
    )
    expect(aiThreadLine(thread({ aiPausedUntil: '2026-06-16T09:00:00-04:00' }), NOW, TZ, TODAY).sub).toBe(
      'Oasis AI answers again on Jun 16 at 9:00 AM.',
    )
  })

  it('a pause that is over shows nothing', () => {
    expect(aiThreadLine(thread({ aiPausedUntil: '2026-06-13T10:35:59-04:00' }), NOW, TZ, TODAY).show).toBe(false)
  })

  it('an open handoff waits for staff and says why', () => {
    const asked = aiThreadLine(
      thread({ handoff: { open: true, since: '2026-06-13T10:02:00-04:00', reason: 'agent_keyword' } }),
      NOW,
      TZ,
      TODAY,
    )
    expect(asked).toEqual({
      show: true,
      text: 'AI paused — waiting for a staff reply',
      sub: 'The client asked for a person at 10:02 AM.',
    })
    const fell = aiThreadLine(
      thread({ handoff: { open: true, since: null, reason: 'fallback' }, aiPausedUntil: '2026-06-13T22:00:00-04:00' }),
      NOW,
      TZ,
      TODAY,
    )
    expect(fell.text).toBe('AI paused — waiting for a staff reply')
    expect(fell.sub).toBe('Oasis AI handed this chat to the team.')
  })
})

describe('alerts open what they are about', () => {
  it('a reply, a picture message and an AI handoff open Messages; money waiting opens Payments', () => {
    expect(alertTab('new_reply')).toBe('messages')
    expect(alertTab('ai_handoff')).toBe('messages')
    expect(alertTab('sms.picture_message')).toBe('messages')
    expect(alertTab('awaiting_processor')).toBe('payments')
    expect(alertTab('running_late')).toBe('overview')
  })
})

describe('dates', () => {
  it('short dates carry the year only when it is not this year', () => {
    expect(shortDate('2026-11-09T15:00:00Z', TZ, TODAY)).toBe('Nov 9')
    expect(shortDate('2027-01-02T15:00:00Z', TZ, TODAY)).toBe('Jan 2, 2027')
    // the business date, not the UTC one
    expect(shortDate('2026-11-10T03:00:00Z', TZ, TODAY)).toBe('Nov 9')
    expect(atText('2026-06-13T18:00:00-04:00', TZ, TODAY)).toBe('at 6:00 PM')
  })
})

describe('the Website PIN cell', () => {
  it('is hidden while the client never set a PIN and the number is not trusted (personal links off)', () => {
    expect(identityShown(undefined)).toBe(false)
    expect(identityShown(identity())).toBe(false)
    const vm = identityVM(identity(), ui(), handlers())
    expect(vm.idShow).toBe(false)
    expect(vm.idCanClear).toBe(false)
    expect(vm.idConfirming).toBe(false)
  })

  it('says the PIN state and the trust in one line', () => {
    const until = '2026-07-13T14:36:00Z'
    expect(identityValue(identity({ pin: { status: 'set' }, trust: { trusted: true, until } }), TZ, TODAY)).toBe(
      'Set · trusted to Jul 13',
    )
    expect(identityValue(identity({ trust: { trusted: true, until } }), TZ, TODAY)).toBe('Not set · trusted to Jul 13')
    expect(identityValue(identity({ pin: { status: 'set' } }), TZ, TODAY)).toBe('Set · not trusted')
    expect(identityValue(identity({ pin: { status: 'cleared' } }), TZ, TODAY)).toBe('Cleared · not trusted')
    expect(
      identityValue(identity({ pin: { status: 'locked', lockedUntil: '2026-06-13T10:51:00-04:00' } }), TZ, TODAY),
    ).toBe('Locked until 10:51 AM · not trusted')
    expect(identityValue(identity({ pin: { status: 'disabled' } }), TZ, TODAY)).toBe(
      'Locked after too many wrong tries · not trusted',
    )
  })

  it('offers Clear PIN only while there is a PIN, and asks first', () => {
    const h = handlers()
    for (const status of ['set', 'locked', 'disabled'] as const) {
      const vm = identityVM(identity({ pin: { status } }), ui(), h)
      expect(vm.idCanClear, status).toBe(true)
    }
    for (const status of ['cleared', 'none'] as const) {
      const vm = identityVM(identity({ pin: { status }, trust: { trusted: true, until: '2026-07-13T14:36:00Z' } }), ui(), h)
      expect(vm.idShow, status).toBe(true)
      expect(vm.idCanClear, status).toBe(false)
    }
    const asking = identityVM(identity({ pin: { status: 'set' } }), ui({ confirming: true }), h)
    expect(asking.idConfirming).toBe(true)
    expect(asking.idConfirmText).toBe(
      'Clear Priya’s website PIN? Their personal links stop working and they confirm with a texted code next time.',
    )
    ;(asking.idClear as () => void)()
    ;(asking.idConfirm as () => void)()
    ;(asking.idCancel as () => void)()
    expect(h.clear).toHaveBeenCalledTimes(1)
    expect(h.confirm).toHaveBeenCalledTimes(1)
    expect(h.cancel).toHaveBeenCalledTimes(1)
    expect((asking.idConfirmStyle as any).background).toBe('#FBEAE0')
    expect((identityVM(identity({ pin: { status: 'set' } }), ui({ dark: true }), h).idConfirmStyle as any).background).toBe(
      'rgba(194,65,12,.14)',
    )
    expect((identityVM(identity({ pin: { status: 'set' } }), ui({ busy: true }), h).idConfirmBtnStyle as any).opacity).toBe(0.5)
  })
})

function ui(over: Partial<Parameters<typeof identityVM>[1]> = {}) {
  return { dark: false, tz: TZ, today: TODAY, first: 'Priya', confirming: false, busy: false, ...over }
}
function handlers() {
  return { clear: vi.fn(), confirm: vi.fn(), cancel: vi.fn() }
}
