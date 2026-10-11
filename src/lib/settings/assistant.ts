// Settings → Oasis AI assistant (ADR 0160, design section 8, plan G): the pure parts of the section. Owner-facing words,
// the phone numbers of the first stage (read the way the server reads them, shown the way people write them) and the
// checks the screen makes before it asks the server (the server checks everything again and has the last word).

export type AssistantStage = 'allowlist' | 'customers' | 'everyone'

export interface AssistantFields {
  enabled: boolean
  actionsEnabled: boolean
  stage: AssistantStage
  allowlist: string[]
  staffPauseHours: number
  faq: { q: string; a: string }[]
}

export const ASSISTANT_FIELD_KEYS = [
  'enabled',
  'actionsEnabled',
  'stage',
  'allowlist',
  'staffPauseHours',
  'faq',
] as const satisfies readonly (keyof AssistantFields)[]

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

/** The fields of `edits` whose value differs from the server's (what a save sends). */
export function changedFields(
  server: AssistantFields,
  edits: Partial<AssistantFields>,
): Partial<AssistantFields> {
  const out: Partial<AssistantFields> = {}
  for (const k of ASSISTANT_FIELD_KEYS) {
    if (!(k in edits)) continue
    if (JSON.stringify(edits[k]) !== JSON.stringify(server[k])) (out as Record<string, unknown>)[k] = edits[k]
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
