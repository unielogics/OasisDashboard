// Settings → Oasis AI: the "Correct this answer" dialog (ADR 0174 §5, design §9 tabs 3 and 5), opened from a practice turn
// or from a real conversation's turn ("This answer was wrong"). It saves a correction (POST /assistant/corrections): a
// knowledge entry that Oasis AI reads only as the question and the right answer; the wrong reply is loaded by the server
// from the named turn and never shown to the model. The question can be made general ("Do you have a waiting room?").
// The same question corrected before: 409 CORRECTION_EXISTS, and the dialog offers to replace the earlier one. Knowledge
// full: 422 KNOWLEDGE_BUDGET, and the dialog offers to save it as a draft.
import { ApiError } from '@/data/http/problem'
import type { AssistantReviewApi } from '@/data/ports/assistant-practice-api'
import { budgetRefusal, textWarnings, warningText, warningTone } from '@/lib/settings/assistant-knowledge'
import { CORRECTION_ANSWER_MAX, CORRECTION_QUESTION_MAX } from '@/lib/settings/assistant-practice'
import { sw } from '@/lib/settings/styles'
import type { AiCtx, InputEvent, Vals } from './assistant-ctx'
import {
  countStyle,
  ghostStyle,
  inputStyle,
  isNotBuilt,
  primaryStyle,
  problemText,
  run,
  settingsKey,
  textareaStyle,
  warnStyle,
} from './assistant-ctx'

export const KNOWLEDGE_KEY = settingsKey('assistant_knowledge')

export interface CorrectionStart {
  /** The client's words (prefilled; the owner may make them general). */
  clientText: string
  /** What Oasis AI said, for the owner's eyes only. */
  wrongReply: string | null
  source: 'practice' | 'live'
  practiceTurnId?: string
  assistantTurnId?: string
  /** Called once the correction is saved (Practice then offers "Try again"). */
  saved?: (entryId: string, active: boolean) => void
}

const DENIED = 'Your role can’t change the Oasis AI settings'

export class CorrectionDialog {
  private start: CorrectionStart | null = null
  private question = ''
  private answer = ''
  private active = true
  private errors: { question?: string; answer?: string } = {}
  private error = ''
  private existing: string | null = null
  private full = false
  private saving = false

  constructor(
    private readonly ctx: AiCtx,
    private readonly api: () => AssistantReviewApi | undefined,
  ) {}

  isOpen(): boolean {
    return !!this.start
  }

  open(s: CorrectionStart): void {
    if (!this.ctx.can('set.assistant')) {
      this.ctx.emit({ title: DENIED })
      return
    }
    this.start = s
    this.question = s.clientText.trim().slice(0, CORRECTION_QUESTION_MAX)
    this.answer = ''
    this.active = true
    this.errors = {}
    this.error = ''
    this.existing = null
    this.full = false
    this.ctx.changed()
  }

  close(): void {
    this.start = null
    this.ctx.changed()
  }

  private problems(): { question?: string; answer?: string } {
    const q = this.question.trim()
    const a = this.answer.trim()
    const out: { question?: string; answer?: string } = {}
    if (!q) out.question = 'Write what the client asked.'
    else if (q.length > CORRECTION_QUESTION_MAX)
      out.question = `${CORRECTION_QUESTION_MAX} characters at most (now ${q.length}).`
    if (!a) out.answer = 'Write the right answer.'
    else if (a.length > CORRECTION_ANSWER_MAX) out.answer = `${CORRECTION_ANSWER_MAX} characters at most (now ${a.length}).`
    return out
  }

  async save(o: { replace?: boolean; draft?: boolean } = {}): Promise<boolean> {
    const s = this.start
    const api = this.api()
    if (!s || !api || this.saving) return false
    this.errors = this.problems()
    if (this.errors.question || this.errors.answer) {
      this.error = ''
      this.ctx.changed()
      return false
    }
    const active = o.draft ? false : this.active
    const body = {
      clientText: this.question.trim(),
      rightAnswer: this.answer.trim(),
      source: s.source,
      active,
      ...(s.practiceTurnId ? { practiceTurnId: s.practiceTurnId } : {}),
      ...(s.assistantTurnId ? { assistantTurnId: s.assistantTurnId } : {}),
      ...(o.replace && this.existing ? { replaceEntryId: this.existing } : {}),
    }
    this.saving = true
    this.error = ''
    this.ctx.changed()
    const r = await run(this.ctx, {
      key: KNOWLEDGE_KEY,
      request: (idem) => api.createCorrection(body, { idempotencyKey: idem }),
      denyLabel: 'change the Oasis AI settings',
      ok: (d) => ({
        title: 'Correction saved',
        desc: d.entry.active ? 'Oasis AI uses it from the next text' : 'Saved as a draft in Knowledge',
      }),
    })
    this.saving = false
    if (r.ok) {
      this.start = null
      s.saved?.(r.data.entry.id, r.data.entry.active)
    } else {
      const e = r.error
      this.existing = null
      this.full = false
      if (e.code === 'CORRECTION_EXISTS') {
        this.existing = typeof e.meta.entryId === 'string' ? e.meta.entryId : null
        this.error = 'There is already a correction for this question.' + (this.existing ? ' Replace it with this one?' : '')
      } else if (e.code === 'KNOWLEDGE_BUDGET') {
        this.full = true
        this.error = budgetRefusal(e.meta) + ' Or save it as a draft and turn it on later.'
      } else if (e instanceof ApiError && e.status === 422 && e.errors.length) {
        for (const fe of e.errors) {
          const k = fe.path.replace(/^body\./, '')
          if (k === 'clientText') this.errors.question = fe.message
          else if (k === 'rightAnswer') this.errors.answer = fe.message
        }
        this.error = problemText(e)
      } else if (isNotBuilt(e) || e.status === 409 || e.status === 412 || e.status === 422 || e.status === 429) {
        this.error = problemText(e)
      }
    }
    this.ctx.changed()
    return r.ok
  }

  vals(): Vals {
    const s = this.start
    if (!s) return { open: false }
    const warnings = textWarnings(this.answer).map((w) => ({
      text: warningText({ ...w, line: 0 }),
      style: warnStyle(warningTone(w)),
    }))
    const a = this.answer.trim().length
    const q = this.question.trim().length
    const t = sw(this.active)
    return {
      open: true,
      title: s.source === 'practice' ? 'Correct this answer' : 'This answer was wrong',
      sub: 'Write the answer Oasis AI should give. It reads your correction as the question and the right answer, and uses it from the next text.',
      hasWrong: !!s.wrongReply,
      wrong: s.wrongReply ?? '',
      question: this.question,
      setQuestion: (e: InputEvent) => {
        this.question = e.target.value
        delete this.errors.question
        this.ctx.changed()
      },
      questionStyle: inputStyle(!!this.errors.question),
      questionError: this.errors.question ?? '',
      hasQuestionError: !!this.errors.question,
      questionCount: q + ' / ' + CORRECTION_QUESTION_MAX,
      questionCountStyle: countStyle(q > CORRECTION_QUESTION_MAX),
      answer: this.answer,
      setAnswer: (e: InputEvent) => {
        this.answer = e.target.value
        delete this.errors.answer
        this.ctx.changed()
      },
      answerStyle: textareaStyle(!!this.errors.answer, 4),
      answerError: this.errors.answer ?? '',
      hasAnswerError: !!this.errors.answer,
      answerCount: a + ' / ' + CORRECTION_ANSWER_MAX,
      answerCountStyle: countStyle(a > CORRECTION_ANSWER_MAX),
      warnings,
      activeLabel: 'Use it now',
      activeSub: 'Off: it is saved as a draft in Knowledge.',
      activeTrack: t.track,
      activeKnob: t.knob,
      toggleActive: () => {
        this.active = !this.active
        this.ctx.changed()
      },
      error: this.error,
      hasError: !!this.error,
      canReplace: !!this.existing,
      replace: () => void this.save({ replace: true }),
      canDraft: this.full,
      draft: () => void this.save({ draft: true }),
      cancel: () => this.close(),
      stop: (e: { stopPropagation(): void }) => e.stopPropagation(),
      save: () => void this.save(),
      saveLabel: this.saving ? 'Saving…' : 'Save correction',
      saveStyle: { ...primaryStyle(), opacity: this.saving ? 0.6 : 1 },
      ghost: ghostStyle(),
    }
  }
}
