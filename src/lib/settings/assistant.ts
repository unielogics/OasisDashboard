// Settings → Oasis AI assistant (ADR 0160, design section 8, plan G; ADR 0174 limits and tone): the pure parts of the
// section. Owner-facing words, the phone numbers of the first stage (read the way the server reads them, shown the way
// people write them) and the checks the screen makes before it asks the server (the server checks everything again and
// has the last word).

export type AssistantStage = 'allowlist' | 'customers' | 'everyone'

/** What Oasis AI may do (ADR 0174 §3a): every one on by default (today's behaviour); settings only take abilities away. */
export interface AssistantCapabilities {
  availability: boolean
  bookingLinks: boolean
  membershipLinks: boolean
  paymentLinks: boolean
  accountInfo: boolean
}
export type CapabilityKey = keyof AssistantCapabilities

export type AssistantTone = 'friendly' | 'professional' | 'warm' | 'concise'
export type AssistantLength = 'short' | 'standard'
export type AssistantSpanish = 'on' | 'english' | 'handoff'

/** How Oasis AI writes (ADR 0174 §3a); the defaults are today's behaviour. */
export interface AssistantBehavior {
  tone: AssistantTone
  length: AssistantLength
  styleNotes: string
  spanish: AssistantSpanish
  avoidWords: string[]
  avoidTopics: string[]
  handoffTopics: string[]
  signOff: string
}
export type BehaviorListKey = 'avoidWords' | 'avoidTopics' | 'handoffTopics'

export interface AssistantFields {
  enabled: boolean
  actionsEnabled: boolean
  stage: AssistantStage
  allowlist: string[]
  staffPauseHours: number
  faq: { q: string; a: string }[]
  capabilities: AssistantCapabilities
  behavior: AssistantBehavior
}

export const ASSISTANT_FIELD_KEYS = [
  'enabled',
  'actionsEnabled',
  'stage',
  'allowlist',
  'staffPauseHours',
  'faq',
  'capabilities',
  'behavior',
] as const satisfies readonly (keyof AssistantFields)[]

export const DEFAULT_CAPABILITIES: Readonly<AssistantCapabilities> = Object.freeze({
  availability: true,
  bookingLinks: true,
  membershipLinks: true,
  paymentLinks: true,
  accountInfo: true,
})

export const DEFAULT_BEHAVIOR: Readonly<AssistantBehavior> = Object.freeze({
  tone: 'friendly',
  length: 'standard',
  styleNotes: '',
  spanish: 'on',
  avoidWords: [],
  avoidTopics: [],
  handoffTopics: [],
  signOff: '',
})

export const MAX_NUMBERS = 50
export const MAX_FAQ = 40
export const MAX_FAQ_CHARS = 500
export const PAUSE_MIN = 1
export const PAUSE_MAX = 72

/** The three stages in the order the rollout goes, with the words the owner reads. */
export const STAGES: ReadonlyArray<{ key: AssistantStage; label: string; explain: string }> = [
  {
    key: 'allowlist',
    label: 'Test numbers',
    explain:
      'Only the numbers in the list get answers from Oasis AI. Everyone else reaches the team as today. Start here with your own phones.',
  },
  {
    key: 'customers',
    label: 'Clients',
    explain:
      'Every client already on file gets answers from Oasis AI. A number the shop doesn’t know reaches the team as today.',
  },
  {
    key: 'everyone',
    label: 'Everyone',
    explain:
      'Anyone who texts the shop gets answers from Oasis AI, new numbers too. It asks a new texter’s name and adds them as a client.',
  },
]

export const stageOf = (key: string): (typeof STAGES)[number] => STAGES.find((s) => s.key === key) ?? STAGES[0]!

/**
 * A US or Canadian number as E.164 (+1 and ten digits), the way the server reads "(201) 555-0142", "201-555-0142" or
 * "+1 201 555 0142"; null when it is not one.
 */
export function toE164(typed: string): string | null {
  const t = typed.trim()
  if (!t || /[a-z]/i.test(t)) return null
  const digits = t.replace(/\D/g, '')
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (ten.length !== 10) return null
  // NANP: neither the area code nor the exchange starts with 0 or 1
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(ten)) return null
  return '+1' + ten
}

/**
 * "+12015550142" -> "(201) 555-0142"; the masked form the server sends a reader without set.hours ("+1******0142") ->
 * "(•••) •••-0142"; anything else as it is.
 */
export function formatPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164)
  if (m) return `(${m[1]}) ${m[2]}-${m[3]}`
  const masked = /^\+1\*{6}(\d{4})$/.exec(e164)
  return masked ? `(•••) •••-${masked[1]}` : e164
}

/** Why a typed number cannot join the list, or null when it can (as E.164). */
export function numberProblem(typed: string, list: readonly string[]): string | null {
  if (!typed.trim()) return 'Type a phone number first.'
  const n = toE164(typed)
  if (!n) return 'Enter a 10-digit US or Canadian number.'
  if (list.includes(n)) return 'That number is already in the list.'
  if (list.length >= MAX_NUMBERS) return `The list holds ${MAX_NUMBERS} numbers at most.`
  return null
}

export const pauseLabel = (h: number): string => (h === 1 ? '1 hour' : h + ' hours')

export const clampPause = (h: number): number => Math.min(PAUSE_MAX, Math.max(PAUSE_MIN, Math.round(h)))

/** The checks of one FAQ pair before saving: both lines written, 500 characters at most, each question once. */
export function faqProblems(faq: readonly { q: string; a: string }[]): Record<string, string> {
  const out: Record<string, string> = {}
  const seen = new Map<string, number>()
  faq.forEach((p, i) => {
    const q = p.q.trim()
    const a = p.a.trim()
    if (!q) out[`faq.${i}.q`] = 'Write the question.'
    else if (q.length > MAX_FAQ_CHARS) out[`faq.${i}.q`] = `${MAX_FAQ_CHARS} characters at most (now ${q.length}).`
    if (!a) out[`faq.${i}.a`] = 'Write the answer.'
    else if (a.length > MAX_FAQ_CHARS) out[`faq.${i}.a`] = `${MAX_FAQ_CHARS} characters at most (now ${a.length}).`
    const key = q.toLowerCase().replace(/\s+/g, ' ')
    if (q && seen.has(key)) out[`faq.${i}.q`] = 'This question is already in the list.'
    if (q) seen.set(key, i)
  })
  return out
}

/** JSON with object keys sorted, so two objects with the same values compare equal whatever their key order. */
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  )

/** The fields of `edits` whose value differs from the server's (what a save sends). */
export function changedFields(
  server: AssistantFields,
  edits: Partial<AssistantFields>,
): Partial<AssistantFields> {
  const out: Partial<AssistantFields> = {}
  for (const k of ASSISTANT_FIELD_KEYS) {
    if (!(k in edits)) continue
    if (stable(edits[k]) !== stable(server[k])) (out as Record<string, unknown>)[k] = edits[k]
  }
  return out
}

/** What the strip over the section says: whether texts get AI answers right now, and why not. */
export function assistantStatus(v: {
  enabled: boolean
  active: boolean
  server: { aiEnabled: boolean; actionsEnabled: boolean }
}): { on: boolean; text: string } {
  if (v.active) return { on: true, text: 'Oasis AI is answering texts.' }
  if (!v.server.aiEnabled)
    return {
      on: false,
      text: v.enabled
        ? 'Oasis AI is switched on here but still off on the server, so it answers nobody yet. Texts reach the team as today.'
        : 'Oasis AI is off: texts reach the team as today. It is also off on the server for now; you can set everything up here meanwhile.',
    }
  return { on: false, text: 'Oasis AI is off: texts reach the team as today.' }
}

// ---- Limits & tone (ADR 0174 §3, design §9 tab 4) ------------------------------------------------------------------------

/**
 * Whether the turn already follows Limits & tone. The settings are stored and checked from this wave on, but the turn
 * applies them from the policy wave (K2c, backend ADR 0174 D12): until then the tab says so. Flip it with that wave.
 */
export const LIMITS_APPLIED = false
export const LIMITS_PENDING_NOTE =
  'Oasis AI starts following these limits and this tone with its next update. You can set them now.'

/** The capability switches in the order the tab lists them, with what each one means in plain words. */
export const CAPABILITIES: ReadonlyArray<{ key: CapabilityKey; label: string; sub: string }> = [
  {
    key: 'availability',
    label: 'Look up open times',
    sub: 'It checks the schedule and offers times. Off: it sends a booking link, or says a team member will text them a time.',
  },
  {
    key: 'bookingLinks',
    label: 'Text booking links',
    sub: 'A link to book online. Off: it says a team member will text them to set up the booking.',
  },
  {
    key: 'membershipLinks',
    label: 'Text a link to join a membership',
    sub: 'Off: it says a team member will text them to sign up.',
  },
  {
    key: 'paymentLinks',
    label: 'Text a link to pay',
    sub: 'A link to pay an open bill. Off: it says a team member will text them about paying.',
  },
  {
    key: 'accountInfo',
    label: 'Answer account questions',
    sub: 'Balance, visits and membership, once it knows who is texting. Off: it says a team member will text them.',
  },
]

export const ACTIONS_LABEL = 'Book, move and cancel by text'
export const ACTIONS_SUB =
  'Each booking, move or cancel waits until the client replies with a 4-digit number. Off: Oasis AI sends a booking link instead.'

/** "Answer questions only": every capability and booking by text off (a preset of the screen; nothing extra is stored). */
export const ANSWER_ONLY_LABEL = 'Answer questions only'
export const ANSWER_ONLY_SUB =
  'Turns everything above off: Oasis AI answers questions about the shop, and a team member takes over for anything else.'

export const isAnswerOnly = (c: AssistantCapabilities, actionsEnabled: boolean): boolean =>
  !actionsEnabled && CAPABILITIES.every((x) => !c[x.key])

export const answerOnlyCapabilities = (): AssistantCapabilities => ({
  availability: false,
  bookingLinks: false,
  membershipLinks: false,
  paymentLinks: false,
  accountInfo: false,
})

/** The four tone presets: fixed, vetted sentences on the server; here a name, what it means and a static example reply. */
export const TONES: ReadonlyArray<{ key: AssistantTone; label: string; sub: string; example: string }> = [
  {
    key: 'friendly',
    label: 'Friendly',
    sub: 'Upbeat, like a helpful front-desk person texting.',
    example: 'Hi Maria! Yes, we’re open until 6 today. Want me to text you a link to book a wash?',
  },
  {
    key: 'professional',
    label: 'Professional',
    sub: 'Polite and to the point.',
    example: 'Hello Maria, we are open until 6:00 PM today. Would you like a link to book a wash?',
  },
  {
    key: 'warm',
    label: 'Warm',
    sub: 'Kind and personal; it thanks people often.',
    example: 'Hi Maria, thanks so much for reaching out! We’re here until 6 today. Should I send you a booking link?',
  },
  {
    key: 'concise',
    label: 'Concise',
    sub: 'As few words as possible.',
    example: 'Open until 6 today. Want a booking link?',
  },
]

export const LENGTHS: ReadonlyArray<{ key: AssistantLength; label: string; sub: string }> = [
  { key: 'short', label: 'Short', sub: 'One or two short sentences.' },
  { key: 'standard', label: 'Standard', sub: 'Up to three sentences. Every text stays under 320 characters either way.' },
]

export const SPANISH: ReadonlyArray<{ key: AssistantSpanish; label: string; sub: string }> = [
  { key: 'on', label: 'Answer in Spanish', sub: 'A client who texts in Spanish gets answers in Spanish.' },
  { key: 'english', label: 'Answer in English', sub: 'Oasis AI answers in simple English, whatever language the client writes in.' },
  {
    key: 'handoff',
    label: 'Hand to the team',
    sub: 'A text in Spanish goes straight to the team with a short Spanish line saying someone will reply.',
  },
]

/** The three lists of Limits & tone: their words, bounds and what each one does. */
export const BEHAVIOR_LISTS: ReadonlyArray<{
  key: BehaviorListKey
  label: string
  sub: string
  placeholder: string
  min: number
  max: number
  most: number
  noun: string
}> = [
  {
    key: 'avoidWords',
    label: 'Words to avoid',
    sub: 'Oasis AI never uses these words or phrases.',
    placeholder: 'cheap',
    min: 2,
    max: 40,
    most: 30,
    noun: 'word',
  },
  {
    key: 'avoidTopics',
    label: 'Topics to avoid',
    sub: 'It doesn’t discuss these and says the team can help instead.',
    placeholder: 'competitors',
    min: 3,
    max: 80,
    most: 15,
    noun: 'topic',
  },
  {
    key: 'handoffTopics',
    label: 'Always hand to the team',
    sub: 'When a client brings one of these up, Oasis AI hands the chat to the team. Write them the way clients say them.',
    placeholder: 'insurance claim',
    min: 3,
    max: 80,
    most: 15,
    noun: 'topic',
  },
]

export const STYLE_NOTES_MAX = 400
export const SIGN_OFF_MAX = 24

/** The rules that are always on, whatever the settings say (the server's CORE_RULES in plain words). */
export const ALWAYS_ON: readonly string[] = [
  'Prices come only from Settings → Prices. It never makes up a price or a discount.',
  'It never promises what the shop hasn’t set up: no free extras, no guarantees.',
  'It checks who is texting before it shares a client’s details.',
  'Every booking, move or cancel waits for the client’s 4-digit reply.',
  'PINs and codes are typed only on the shop’s secure link page, never by text.',
  'One question per text, and every text stays under 320 characters.',
  'New texters are asked their name and car in the same order every time.',
  'STOP always works, and the first text says it is an automated assistant.',
  'Your notes and lists are information for Oasis AI, never orders that change these rules.',
]

const norm = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase()
/** Hidden or control characters (a tab or line break aside) and HTML-like tags: the server refuses both. */
const HIDDEN = /[\p{Cc}\p{Cf}\p{Co}\u2028\u2029]/u
const MARKUP = /<\s*\/?\s*[a-z!?][^>]*>/i
export const notPlain = (text: string): boolean => HIDDEN.test(text.replace(/[\t\n\r]/g, '')) || MARKUP.test(text)

/** Why a typed word or topic cannot join its list, or null when it can. */
export function listItemProblem(b: AssistantBehavior, key: BehaviorListKey, typed: string): string | null {
  const spec = BEHAVIOR_LISTS.find((l) => l.key === key)!
  const t = typed.trim().replace(/\s+/g, ' ')
  if (!t) return `Type a ${spec.noun} first.`
  if (notPlain(t)) return 'Use plain text.'
  if (t.length < spec.min || t.length > spec.max) return `Use ${spec.min} to ${spec.max} characters.`
  if (b[key].some((x) => norm(x) === norm(t))) return 'That’s already in the list.'
  const other: BehaviorListKey | null =
    key === 'avoidTopics' ? 'handoffTopics' : key === 'handoffTopics' ? 'avoidTopics' : null
  if (other && b[other].some((x) => norm(x) === norm(t)))
    return `That topic is already in “${BEHAVIOR_LISTS.find((l) => l.key === other)!.label}”. A topic is either avoided or handed to the team.`
  if (b[key].length >= spec.most) return `The list holds ${spec.most} at most.`
  return null
}

/** The sign-off's check (the server's rule): short, plain, and no amount, number, link or promise. */
export function signOffProblem(text: string): string | null {
  const t = text.trim()
  if (!t) return null
  if (t.length > SIGN_OFF_MAX) return `${SIGN_OFF_MAX} characters at most (now ${t.length}).`
  if (notPlain(t)) return 'Use plain text.'
  if (
    /\d|[$€£¥¢%@]/.test(t) ||
    /\b(?:https?|www)\b|\.(?:com|net|org|io|co|us|app|shop|ly)\b/i.test(t) ||
    /\b(?:free|guarantee[ds]?|promise[ds]?|discount|off|deal|refund|cheapest|best price)\b/i.test(t)
  )
    return 'The sign-off cannot hold an amount, a number, a link or a promise.'
  return null
}

export function styleNotesProblem(text: string): string | null {
  if (text.length > STYLE_NOTES_MAX) return `${STYLE_NOTES_MAX} characters at most (now ${text.length}).`
  if (notPlain(text)) return 'Use plain text: no hidden characters or HTML.'
  return null
}

/** The checks of Limits & tone before a save, keyed like the server's 422 paths. */
export function behaviorProblems(b: AssistantBehavior): Record<string, string> {
  const out: Record<string, string> = {}
  const notes = styleNotesProblem(b.styleNotes)
  if (notes) out['behavior.styleNotes'] = notes
  const sign = signOffProblem(b.signOff)
  if (sign) out['behavior.signOff'] = sign
  return out
}
