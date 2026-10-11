// The AI assistant and the phone identity in the live Operations screen (ADR 0160, design section 8, plan G): the "Oasis
// AI" tag on the assistant's texts, the "AI paused" line of a thread, the tab an alert opens, and the client file's
// "Website PIN" cell. Pure: the server sends every fact (who wrote a text, the pause, the handoff, the PIN and the trust);
// this file only words them. Live variant only; nothing here runs in the fixture or parity builds.
import type { ClientIdentity, OpsAlert, Thread, ThreadMessage } from '@/data/ports/operations'
import { addDays, businessClock, businessToday, parseIso } from '@/lib/tz'

type VM = Record<string, unknown>

/** The tag over the assistant's own texts (the message DTO's `senderName` for `author: 'ai'`). */
export const AI_TAG = 'Oasis AI'

const channelName = (c: string): string => (c === 'email' ? 'Email' : c === 'sms' ? 'SMS' : 'Internal')

/**
 * The small line over a bubble: "Oasis AI · SMS" for the assistant, "Automated · SMS" for the shop's other automatic
 * texts (DV-404), nothing for staff and the customer.
 */
export function channelTagOf(m: Pick<ThreadMessage, 'from' | 'author' | 'channel'>): string | null {
  if (m.author === 'ai') return AI_TAG + ' · ' + channelName(m.channel)
  if (m.from === 'system') return 'Automated · ' + channelName(m.channel)
  return null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Nov 9" (the business date of an instant), with the year when it is not this year's. */
export function shortDate(iso: string, tz: string, today: string): string {
  const day = businessToday(Date.parse(iso), tz)
  const [y, mo, d] = parseIso(day)
  const [ty] = parseIso(today)
  return MONTHS[mo - 1] + ' ' + d + (y === ty ? '' : ', ' + y)
}

/** "10:15 PM" today, "tomorrow 8:15 AM", else "Nov 9 · 8:15 AM". */
export function whenText(iso: string, tz: string, today: string): string {
  const ms = Date.parse(iso)
  const day = businessToday(ms, tz)
  const clock = businessClock(ms, tz)
  if (day === today) return clock
  if (day === addDays(today, 1)) return 'tomorrow ' + clock
  return shortDate(iso, tz, today) + ' · ' + clock
}

/** "at 10:15 PM" today, "tomorrow at 8:15 AM", else "on Nov 9 at 8:15 AM". */
export function atText(iso: string, tz: string, today: string): string {
  const ms = Date.parse(iso)
  const day = businessToday(ms, tz)
  const clock = 'at ' + businessClock(ms, tz)
  if (day === today) return clock
  if (day === addDays(today, 1)) return 'tomorrow ' + clock
  return 'on ' + shortDate(iso, tz, today) + ' ' + clock
}

export interface AiLine {
  show: boolean
  text: string
  sub: string
}

const HIDDEN: AiLine = { show: false, text: '', sub: '' }

/**
 * The line under a thread while the assistant stands back. Only while the assistant answers texts at all
 * (`assistantActive`: AI_ENABLED and Settings → Assistant on), so with the assistant off nothing changes on screen:
 * an open handoff (the client asked for a person, or the assistant could not help) waits for staff; a staff reply
 * pauses the assistant on the thread until `aiPausedUntil`.
 */
export function aiThreadLine(thread: Thread | undefined, now: number, tz: string, today: string): AiLine {
  if (!thread?.assistantActive) return HIDDEN
  if (thread.handoff?.open) {
    const at = thread.handoff.since ? ' at ' + businessClock(Date.parse(thread.handoff.since), tz) : ''
    return {
      show: true,
      text: 'AI paused — waiting for a staff reply',
      sub:
        thread.handoff.reason === 'agent_keyword'
          ? 'The client asked for a person' + at + '.'
          : 'Oasis AI handed this chat to the team' + at + '.',
    }
  }
  const until = thread.aiPausedUntil
  if (until && Date.parse(until) > now)
    return {
      show: true,
      text: 'AI paused — staff replying',
      sub: 'Oasis AI answers again ' + atText(until, tz, today) + '.',
    }
  return HIDDEN
}

/** The tab of the file an alert opens: a text from the client (a reply, a picture, an AI handoff) opens Messages. */
export function alertTab(kind: OpsAlert['kind']): 'messages' | 'payments' | 'overview' {
  if (kind === 'new_reply' || kind === 'ai_handoff' || kind === 'sms.picture_message') return 'messages'
  if (kind === 'awaiting_processor') return 'payments'
  return 'overview'
}

// ---- the client file's "Website PIN" cell ---------------------------------------------------------------------------

export interface IdentityUi {
  dark: boolean
  tz: string
  today: string
  /** The client's first name, for the confirmation. */
  first: string
  confirming: boolean
  busy: boolean
}

export interface IdentityHandlers {
  clear(): void
  confirm(): void
  cancel(): void
}

/** The PIN part of the cell's value. */
export function pinText(i: ClientIdentity, tz: string, today: string): string {
  switch (i.pin.status) {
    case 'set':
      return 'Set'
    case 'locked':
      return i.pin.lockedUntil ? 'Locked until ' + whenText(i.pin.lockedUntil, tz, today) : 'Locked'
    case 'disabled':
      return 'Locked after too many wrong tries'
    case 'cleared':
      return 'Cleared'
    default:
      return 'Not set'
  }
}

/** "Set · trusted to Nov 9", "Not set · trusted to Nov 9", "Cleared · not trusted". */
export function identityValue(i: ClientIdentity, tz: string, today: string): string {
  const trust = i.trust.trusted && i.trust.until ? 'trusted to ' + shortDate(i.trust.until, tz, today) : 'not trusted'
  return pinText(i, tz, today) + ' · ' + trust
}

/**
 * Shown only when there is something to say (a PIN was ever set, or the number is trusted). While personal links are off
 * (PUBLIC_LINKS_ENABLED=false) nobody can set a PIN or verify, so the file looks exactly as it did.
 */
export function identityShown(i: ClientIdentity | undefined): i is ClientIdentity {
  return !!i && (i.pin.status !== 'none' || i.trust.trusted)
}

export function identityVM(i: ClientIdentity | undefined, ui: IdentityUi, h: IdentityHandlers): VM {
  const shown = identityShown(i)
  const canClear = shown && (i.pin.status === 'set' || i.pin.status === 'locked' || i.pin.status === 'disabled')
  return {
    idShow: shown,
    idValue: shown ? identityValue(i, ui.tz, ui.today) : '',
    idCanClear: canClear,
    idClear: () => h.clear(),
    idConfirming: canClear && ui.confirming,
    idConfirmText:
      'Clear ' +
      (ui.first ? ui.first + '’s' : 'the') +
      ' website PIN? Their personal links stop working and they confirm with a texted code next time.',
    idConfirm: () => h.confirm(),
    idCancel: () => h.cancel(),
    idConfirmStyle: {
      gridColumn: '1/3',
      padding: '12px 14px',
      background: ui.dark ? 'rgba(194,65,12,.14)' : '#FBEAE0',
      border: '1px solid rgba(194,65,12,.25)',
      borderRadius: '12px',
    },
    idConfirmBtnStyle: {
      height: '38px',
      padding: '0 14px',
      borderRadius: '10px',
      background: '#C2410C',
      color: '#fff',
      fontWeight: 700,
      fontSize: '12.5px',
      opacity: ui.busy ? 0.5 : 1,
    },
  }
}
