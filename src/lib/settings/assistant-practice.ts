// Settings → Oasis AI → Practice and Conversations (ADR 0174 §4, §5; design §9 tabs 3 and 5): the pure parts. The words
// of a practice turn (its status, its badges, the link markers in a reply), the banners of the tab, the persona line, and
// the words of a real conversation's turn for the training review (flags, the policy check, the tools it used).

export type BadgeKind =
  | 'rewritten'
  | 'shortened'
  | 'policy_rewrite'
  | 'handed_off'
  | 'fallback'
  | 'link'
  | 'proposal'
  | 'opted_out'
  | 'looked_up'

export type TurnStatus = 'running' | 'replied' | 'handed_off' | 'failed' | 'opted_out'

/** While a turn runs the tab reads the session again this often (the event stream also says when it is done). */
export const POLL_MS = 2000
/** What a practice text may hold (the server's limit). */
export const PRACTICE_TEXT_MAX = 640
export const CORRECTION_QUESTION_MAX = 300
export const CORRECTION_ANSWER_MAX = 500

/** A reply split around its link markers ("[booking link]"), so the markers show as chips and not as plain text. */
export function replyParts(text: string): { text: string; link: boolean }[] {
  const out: { text: string; link: boolean }[] = []
  const re = /\[(?:[^[\]\n]{1,40}\s)?link\]/gi
  let at = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > at) out.push({ text: text.slice(at, m.index), link: false })
    out.push({ text: m[0].slice(1, -1), link: true })
    at = m.index! + m[0].length
  }
  if (at < text.length) out.push({ text: text.slice(at), link: false })
  return out
}

export const badgeTone = (k: string): 'neutral' | 'accent' | 'amber' | 'red' =>
  k === 'handed_off' || k === 'fallback' || k === 'policy_rewrite'
    ? 'amber'
    : k === 'opted_out'
      ? 'red'
      : k === 'link' || k === 'proposal'
        ? 'accent'
        : 'neutral'

/** What stands under a practice turn while it runs or when it ended without a plain reply. */
export function turnNote(t: { status: TurnStatus; error: string | null }): string {
  switch (t.status) {
    case 'running':
      return 'Oasis AI is writing…'
    case 'failed':
      return 'Oasis AI could not answer this one' + (t.error ? ': ' + errorWords(t.error) : '.')
    case 'handed_off':
      return 'Oasis AI handed this chat to the team. In real life a team member would reply now.'
    case 'opted_out':
      return 'The client texted STOP. In real life Oasis AI would stop texting them.'
    default:
      return ''
  }
}

const errorWords = (e: string): string =>
  e === 'timeout'
    ? 'it took too long. Try again.'
    : /^[a-z_]+$/.test(e)
      ? 'something went wrong (' + e.replace(/_/g, ' ') + '). Try again.'
      : e

export const usd = (x: number): string => '$' + (Math.round(x * 100) / 100).toFixed(2)

export interface PracticeInfo {
  enabled: boolean
  budgetUsd: number
  spentTodayUsd: number
  actionsEnabled: boolean
  linksEnabled: boolean
}

/** The banners over the practice chat: off on the server, the day's budget used, and what the server switches change. */
export function practiceBanners(p: PracticeInfo): { text: string; tone: 'amber' | 'neutral' }[] {
  const out: { text: string; tone: 'amber' | 'neutral' }[] = []
  if (!p.enabled)
    out.push({
      tone: 'amber',
      text: 'Practice is off on the server for now. You can look around; nothing runs until it is switched on.',
    })
  else if (p.spentTodayUsd >= p.budgetUsd)
    out.push({
      tone: 'amber',
      text: `Today’s practice budget is used up (${usd(p.spentTodayUsd)} of ${usd(p.budgetUsd)}). Practice works again tomorrow.`,
    })
  if (!p.actionsEnabled)
    out.push({
      tone: 'neutral',
      text: 'Booking by text is off on the server, so Oasis AI offers a booking link here, as it would for real.',
    })
  if (!p.linksEnabled)
    out.push({
      tone: 'neutral',
      text: 'Personal links are off on the server, so Oasis AI can’t offer them here either.',
    })
  return out
}

export const practiceBlocked = (p: PracticeInfo): boolean => !p.enabled || p.spentTodayUsd >= p.budgetUsd

export const PRACTICE_EXPLAIN =
  'Text Oasis AI as a client would. It answers with everything it knows, but nothing is sent, booked or saved to a client: links show as [booking link], and a booking shows the confirmation it would text. A wrong answer? Correct it, and Oasis AI knows better next time.'

export function personaLine(s: {
  persona: 'new_texter' | 'client'
  client: { firstName: string | null } | null
  verified: boolean
  language: 'en' | 'es'
}): string {
  const who =
    s.persona === 'new_texter'
      ? 'New texter'
      : (s.client?.firstName ?? 'A client') + (s.verified ? ' · verified' : ' · not verified')
  return who + (s.language === 'es' ? ' · Spanish' : '')
}

export const turnsLabel = (n: number): string => (n === 1 ? '1 text' : n + ' texts')

/** "Jun 13, 10:20 AM" in the shop's time zone. */
export function whenLabel(iso: string, tz: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
    .format(d)
    .replace(/[\u202f\u00a0]/g, ' ')
}

// ---- Conversations (the training review of real chats) ------------------------------------------------------------------

export type ReviewFilter = 'all' | 'handed_off' | 'fallback' | 'judge' | 'corrected'

export const REVIEW_FILTERS: ReadonlyArray<{ key: ReviewFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'handed_off', label: 'Handed to the team' },
  { key: 'fallback', label: 'Fallback reply' },
  { key: 'judge', label: 'Policy check stepped in' },
  { key: 'corrected', label: 'Corrected' },
]

export const REVIEW_DAYS: readonly number[] = [7, 30, 90]

export const flagWords = (f: string): string =>
  REVIEW_FILTERS.find((x) => x.key === f)?.label ?? f.replace(/_/g, ' ')

export const clientLabel = (c: { firstName: string | null; phoneLast4: string }): string =>
  (c.firstName ?? 'Client') + ' · •••' + c.phoneLast4

export function handoffWords(h: { open: boolean; reason: string | null } | null): string {
  if (!h) return ''
  const why = h.reason ? ' (' + h.reason.replace(/_/g, ' ') + ')' : ''
  return (h.open ? 'Waiting for the team' : 'Handed to the team') + why
}

export function judgeWords(j: { verdict: 'pass' | 'fail' | 'error'; category: string | null; words: string } | null): string {
  if (!j) return ''
  if (j.verdict === 'pass') return 'Policy check: passed'
  if (j.verdict === 'error') return 'Policy check could not run'
  return 'Policy check stopped the first draft' + (j.words ? ': ' + j.words : j.category ? ' (' + j.category.replace(/_/g, ' ') + ')' : '')
}

const TOOLS: Record<string, string> = {
  check_availability: 'looked up open times',
  list_services: 'looked up services',
  get_business_info: 'looked up the shop’s details',
  get_membership_info: 'looked up memberships',
  get_balance: 'looked up the balance',
  list_my_appointments: 'looked up their appointments',
  send_link: 'texted a link',
  note_interest: 'noted their interest',
  set_my_name: 'saved their name',
  set_my_vehicle: 'saved their car',
  handoff_to_staff: 'handed to the team',
  opt_out: 'stopped texting them',
  propose_booking: 'proposed a booking',
  propose_reschedule: 'proposed a move',
  propose_cancel: 'proposed a cancel',
}

export const toolWords = (tools: readonly string[]): string =>
  [...new Set(tools.map((t) => TOOLS[t] ?? t.replace(/_/g, ' ')))].join(', ')

export const statusWords = (s: string): string =>
  s === 'replied'
    ? ''
    : s === 'handed_off'
      ? 'Handed to the team'
      : s === 'failed'
        ? 'No answer (failed)'
        : s === 'fallback'
          ? 'Fallback reply'
          : s.replace(/_/g, ' ')
