// Settings → Oasis AI → Knowledge (ADR 0174 §1, §2; design §9 tab 2): the pure parts. The budget meter in plain words, a
// client-side copy of the server's warnings (sanitize.ts) so the editor warns while the owner types (the server computes
// them again on every save and has the last word), the checks of a PDF before it is uploaded, its SHA-256 (WebCrypto,
// for the duplicate check before any byte is sent) and the words of a document's status.

export type WarningKind =
  | 'amount'
  | 'link'
  | 'phone'
  | 'email'
  | 'instruction'
  | 'promise'
  | 'hidden'
  | 'markup'
  | 'long'

export interface KnowledgeWarningLike {
  kind: WarningKind
  sample: string
  /** 1-based; 0 = the title or the entry as a whole. */
  line: number
}

export interface BudgetLike {
  usedChars: number
  maxChars: number
  parts: { faq: number; notes: number; documents: number; corrections: number }
}

export interface DocumentLike {
  status: 'pending_upload' | 'extracting' | 'ready' | 'failed'
  errorCode: string | null
  error: string | null
}

export interface EntryLike {
  active: boolean
  reviewedAt: string | null
}

/** What the server allows (GET /assistant/knowledge `limits`); the screen's defaults until the first read. */
export const DEFAULT_LIMITS = {
  titleMax: 120,
  noteMax: 4000,
  documentStoreMax: 60000,
  documentActiveMax: 20000,
  correctionAnswerMax: 500,
  questionMax: 300,
  documentMaxBytes: 10 * 1024 * 1024,
  documentMaxPages: 60,
} as const

const n = (x: number): string => x.toLocaleString('en-US')

// ---- the meter ---------------------------------------------------------------------------------------------------------------

/** "12,400 of 20,000 characters" with the parts and the bar's fill, colour and explanation. */
export function meter(b: BudgetLike): {
  text: string
  parts: string
  percent: number
  tone: 'ok' | 'near' | 'full'
  left: string
} {
  const pct = b.maxChars > 0 ? Math.min(100, Math.round((b.usedChars / b.maxChars) * 100)) : 100
  const free = Math.max(0, b.maxChars - b.usedChars)
  return {
    text: `${n(b.usedChars)} of ${n(b.maxChars)} characters`,
    parts: `Q&A ${n(b.parts.faq)} · notes ${n(b.parts.notes)} · documents ${n(b.parts.documents)} · corrections ${n(b.parts.corrections)}`,
    percent: pct,
    tone: b.usedChars >= b.maxChars ? 'full' : pct >= 85 ? 'near' : 'ok',
    left:
      free === 0
        ? 'Knowledge is full. Turn something off or shorten it to add more.'
        : `${n(free)} characters left.`,
  }
}

export const METER_EXPLAIN =
  'Oasis AI reads everything that is on each time it answers, together with your Settings (hours, services, prices, memberships). Drafts don’t count.'

/** What a 422 KNOWLEDGE_BUDGET says, with the server's numbers. */
export function budgetRefusal(meta: Record<string, unknown>): string {
  const needed = Number(meta.needed)
  return Number.isFinite(needed) && needed > 0
    ? `Knowledge is full: this needs ${n(needed)} more characters than are left. Turn something off or shorten it first.`
    : 'Knowledge is full. Turn something off or shorten it first.'
}

/** What an entry counts against the budget (the server's rule: title + question + body). */
export const entryChars = (e: { title: string; question?: string | null; body: string }): number =>
  e.title.length + (e.question?.length ?? 0) + e.body.length

// ---- warnings (a copy of the server's detectors, sanitize.ts) ---------------------------------------------------------------

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const URL_TAIL = String.raw`(?:[^\s<>"')\]]*[^\s<>"')\].,;:!?])?`
const URL_SCHEME = new RegExp(String.raw`\b(?:https?|ftp):\/\/` + URL_TAIL, 'gi')
const URL_WWW = new RegExp(String.raw`\bwww\.` + URL_TAIL, 'gi')
const URL_BARE = new RegExp(
  String.raw`\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.(?:com|net|org|io|co|us|info|biz|app|shop|me|ly|gl|ai|site|online|store|xyz|link|page)\b(?:\/` +
    URL_TAIL +
    ')?',
  'gi',
)
const NUM = String.raw`\d(?:,?\d)*(?:\.\d+)?`
const AMOUNT = new RegExp(
  String.raw`[$€£¥¢]\s?${NUM}|\b${NUM}\s?(?:[$€£¥¢]|dollars?\b|d[oó]lares\b|bucks?\b|usd\b|cents?\b|centavos?\b|pesos?\b)|\b(?:usd|us\$)\s?${NUM}`,
  'gi',
)
/** A US/Canadian phone number written the usual ways ("(201) 555-0199", "201-555-0199", "+1 201 555 0199"). */
const PHONE = /(?:\+?1[\s.-]?)?\(?\b[2-9]\d{2}\)?[\s.-]?[2-9]\d{2}[\s.-]?\d{4}\b/g
const MARKUP = /<\s*\/?\s*[a-z!?][^>]*>/gi
const HIDDEN = /[\p{Cc}\p{Cf}\p{Co}\u2028\u2029]/gu
const PROMISE = /\b(?:free|guarantee[ds]?|for life|lifetime|always included|no charge|complimentary)\b/i

const INSTRUCTION: readonly RegExp[] = [
  /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:rules?|instructions?|prompts?|guidelines?|above|previous)\b/i,
  /\byou\s+are\s+(?:now|an?|the)\b/i,
  /\bsystem\s*(?:prompt|message|:)/i,
  /\b(?:assistant|ai|model|bot|chatbot|oasis\s+ai)\s+(?:must|should|will|shall|has\s+to|needs\s+to)\b/i,
  /\bdo\s+not\s+tell\b|\bdon'?t\s+tell\b/i,
  /\breveal\b/i,
  /\brespond\s+with\b|\breply\s+with\b|\banswer\s+with\b/i,
  /\bnew\s+(?:rules?|instructions?)\b/i,
  /^\s*(?:#+\s*)?(?:SHOP\s+FACTS|SHOP\s+KNOWLEDGE|TURN\s+CONTEXT|RULES?|SYSTEM|INSTRUCTIONS?|HOW\s+TO\s+WRITE|WHAT\s+IS\s+DATA)\b\s*[:(]?/i,
  /[⟦⟧]|<\/?\s*(?:message|own-text|server-record|trusted)\b|\[\/?trusted\]/i,
]

const clip = (s: string): string => (s.length > 40 ? `${s.slice(0, 39)}…` : s)
const digits = (s: string): string => s.replace(/\D/g, '').slice(-10)

/**
 * The warnings of a text while it is typed: amounts, links, e-mail addresses and phone numbers other than the shop's
 * (hidden from Oasis AI), promise words, instruction-like lines, markup and hidden characters. Line order, at most 50.
 */
export function textWarnings(text: string, shopNumbers: readonly string[] = []): KnowledgeWarningLike[] {
  const shop = new Set(shopNumbers.map(digits).filter((d) => d.length === 10))
  const out: KnowledgeWarningLike[] = []
  const add = (kind: WarningKind, sample: string, line: number): void => {
    const s = clip(sample.trim())
    if (out.length >= 50 || out.some((w) => w.kind === kind && w.line === line && w.sample === s)) return
    out.push({ kind, sample: s, line })
  }
  text.split('\n').forEach((raw, i) => {
    const line = i + 1
    if (!raw.trim()) return
    const hidden = (raw.replace(/[\t\r]/g, '').match(HIDDEN) ?? []).length
    if (hidden) add('hidden', `${hidden} hidden character${hidden === 1 ? '' : 's'}`, line)
    for (const m of raw.match(MARKUP) ?? []) add('markup', m, line)
    const flat = raw.replace(HIDDEN, '')
    for (const m of flat.match(EMAIL) ?? []) add('email', m, line)
    let rest = flat.replace(EMAIL, ' ')
    for (const re of [URL_SCHEME, URL_WWW, URL_BARE]) {
      for (const m of rest.match(re) ?? []) add('link', m, line)
      rest = rest.replace(re, ' ')
    }
    for (const m of rest.match(AMOUNT) ?? []) add('amount', m, line)
    for (const m of rest.replace(AMOUNT, ' ').match(PHONE) ?? []) if (!shop.has(digits(m))) add('phone', m, line)
    const promise = PROMISE.exec(flat)
    if (promise) add('promise', promise[0], line)
    if (INSTRUCTION.some((re) => re.test(flat))) add('instruction', flat, line)
  })
  return out
}

/** One warning in plain words. */
export function warningText(w: KnowledgeWarningLike): string {
  const at = w.line > 0 ? `Line ${w.line}: ` : ''
  switch (w.kind) {
    case 'amount':
      return `${at}“${w.sample}” is hidden from Oasis AI: it quotes prices only from Settings → Prices.`
    case 'link':
      return `${at}“${w.sample}” is hidden from Oasis AI: it never texts links from your notes.`
    case 'email':
      return `${at}“${w.sample}” is hidden from Oasis AI.`
    case 'phone':
      return `${at}“${w.sample}” is hidden from Oasis AI: only the shop’s own number is kept.`
    case 'promise':
      return `${at}“${w.sample}” sounds like a promise. Oasis AI never promises what the shop hasn’t set up.`
    case 'instruction':
      return `${at}“${w.sample}” reads like an order to Oasis AI. It treats your text as information, never as orders.`
    case 'hidden':
      return `${at}${w.sample}: invisible characters are taken out.`
    case 'markup':
      return `${at}“${w.sample}” looks like web code and is taken out.`
    case 'long':
      return `This text is ${w.sample.replace(/^(\d+)/, (d) => n(Number(d)))} long. Shorten it to ${n(DEFAULT_LIMITS.documentActiveMax)} characters or fewer to turn it on.`
  }
}

export const hasInstruction = (ws: readonly KnowledgeWarningLike[]): boolean =>
  ws.some((w) => w.kind === 'instruction')

/** The tone of a warning line: an instruction or hidden text in red, the rest amber. */
export const warningTone = (w: KnowledgeWarningLike): 'red' | 'amber' =>
  w.kind === 'instruction' || w.kind === 'markup' || w.kind === 'hidden' ? 'red' : 'amber'

// ---- PDFs ----------------------------------------------------------------------------------------------------------------------

export function bytesLabel(b: number): string {
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`
  if (b >= 1024) return `${Math.round(b / 1024)} KB`
  return `${b} bytes`
}

/** Why a picked file cannot be uploaded, or null. */
export function fileProblem(f: { name: string; type: string; size: number }, maxBytes: number = DEFAULT_LIMITS.documentMaxBytes): string | null {
  const pdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
  if (!pdf) return `“${clip(f.name)}” is not a PDF. Only PDF files can be added.`
  if (f.size <= 0) return `“${clip(f.name)}” is empty.`
  if (f.size > maxBytes) return `“${clip(f.name)}” is ${bytesLabel(f.size)}. PDFs can be up to ${bytesLabel(maxBytes)}.`
  return null
}

/** The filename the server accepts (1..120 characters, no path). */
export const cleanFilename = (name: string): string =>
  (name.split(/[\\/]/).pop() ?? 'document.pdf').replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(-120) || 'document.pdf'

/** SHA-256 of the file's bytes as lowercase hex (WebCrypto). */
export async function sha256Hex(data: ArrayBuffer, subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<string> {
  const d = new Uint8Array(await subtle.digest('SHA-256', data))
  return Array.from(d, (x) => x.toString(16).padStart(2, '0')).join('')
}

export type ChipTone = 'neutral' | 'accent' | 'amber' | 'red' | 'green'

/** A document's status chip: the upload in this browser first, then the server's state. */
export function documentChip(
  d: DocumentLike,
  entry: EntryLike | null,
  uploadPercent: number | null,
): { label: string; tone: ChipTone; busy: boolean } {
  if (uploadPercent !== null) return { label: `Uploading ${uploadPercent}%`, tone: 'accent', busy: true }
  if (d.status === 'pending_upload') return { label: 'Not uploaded', tone: 'amber', busy: false }
  if (d.status === 'extracting') return { label: 'Reading the PDF…', tone: 'accent', busy: true }
  if (d.status === 'failed')
    return d.errorCode === 'no_text'
      ? { label: 'Can’t read: scanned', tone: 'red', busy: false }
      : { label: 'Failed', tone: 'red', busy: false }
  if (!entry) return { label: 'Ready', tone: 'neutral', busy: false }
  if (entry.active) return { label: 'On', tone: 'green', busy: false }
  if (!entry.reviewedAt) return { label: 'Ready to review', tone: 'amber', busy: false }
  return { label: 'Off', tone: 'neutral', busy: false }
}

/** The plain message of a failed document (the server's own words when it sent them). */
export function documentError(d: DocumentLike): string {
  if (d.error) return d.error
  switch (d.errorCode) {
    case 'no_text':
      return 'This PDF is a scan (pictures of pages), so Oasis AI can’t read it. Upload the original file, or type the important parts as a note.'
    case 'encrypted':
      return 'This PDF is locked with a password. Upload a copy without one.'
    case 'too_many_pages':
      return 'This PDF has more than 60 pages. Upload the pages Oasis AI needs, or type them as a note.'
    case 'not_pdf':
      return 'This file is not a PDF.'
    case 'too_large':
      return 'This PDF is over 10 MB.'
    case 'timeout':
      return 'Reading this PDF took too long. Try again.'
    default:
      return 'This PDF could not be read. Try again, or upload another copy.'
  }
}

/** Whether "Try again" can read a failed document again (never a file that is not a PDF). */
export const canRetry = (d: DocumentLike): boolean => d.status === 'failed' && d.errorCode !== 'not_pdf'

export const chipStyle = (tone: ChipTone): Record<string, string | number> => {
  const c: Record<ChipTone, [string, string]> = {
    neutral: ['var(--panel3)', 'var(--ink2)'],
    accent: ['var(--accentSoft)', 'var(--accentInk)'],
    amber: ['rgba(217,119,6,.14)', '#B45309'],
    red: ['rgba(194,65,12,.14)', '#C2410C'],
    green: ['rgba(22,163,74,.14)', '#15803D'],
  }
  const [bg, fg] = c[tone]
  return {
    fontSize: '11px',
    fontWeight: 800,
    padding: '3px 8px',
    borderRadius: '7px',
    background: bg,
    color: fg,
    whiteSpace: 'nowrap',
    flex: 'none',
  }
}
