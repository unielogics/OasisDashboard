// Settings → Oasis AI assistant, live variant only (ADR 0160, design section 8, plan G; DEVIATIONS.md DV-705..707; ADR 0174
// and DV-708..715 for the tabs). One section over GET/PUT /settings/assistant: the on/off switch, in-chat actions, the stage
// (who it answers), the test numbers of the first stage, how long a staff reply pauses it, the FAQ it answers from, and
// (ADR 0174) what it may do and how it writes (Limits & tone).
//
// Five tabs over the section (the pricing tabs' segment control; `#assistant/<tab>`): Status & switches, Knowledge (the
// FAQ of this working copy plus the knowledge entries and PDFs, live/assistant-knowledge.ts), Practice
// (live/assistant-practice.ts), Limits & tone (live/assistant-limits.ts, saved by this section) and Conversations
// (live/assistant-review.ts). The "Correct this answer" dialog (live/assistant-correction.ts) is shared by Practice and
// Conversations. The fields of this working copy (Status, Q&A, Limits & tone) share one save bar; knowledge entries save
// one at a time.
//
// Like Working hours (DV-309) the screen keeps a working copy: the fields the person changed sit over the server's view, so
// a change saved elsewhere (SSE `settings.changed {section: assistant}` refetches the view) shows in the fields nobody
// touched here while the edited ones stay. Save sends only the changed fields with the version the view had; a 412
// (someone saved in between and the stream missed it) refetches the view, shows the server's words and keeps the edits
// over the new version, so a second Save applies them. 422 field errors are shown inline under their field.
import type { QueryClient } from '@tanstack/react-query'
import { command } from '@/data/command'
import type { ApiError } from '@/data/http/problem'
import { qk } from '@/data/query'
import type { AssistantApi, AssistantView } from '@/data/ports/assistant-api'
import type { AssistantKnowledgeApi } from '@/data/ports/assistant-knowledge-api'
import type { AssistantPracticeApi, AssistantReviewApi } from '@/data/ports/assistant-practice-api'
import type { ToastSpec } from '@/data/toast'
import {
  ACTIONS_SUB,
  DEFAULT_BEHAVIOR,
  DEFAULT_CAPABILITIES,
  MAX_FAQ,
  MAX_FAQ_CHARS,
  STAGES,
  answerOnlyCapabilities,
  assistantStatus,
  behaviorProblems,
  changedFields,
  clampPause,
  faqProblems,
  formatPhone,
  isAnswerOnly,
  listItemProblem,
  numberProblem,
  pauseLabel,
  stageOf,
  toE164,
} from '@/lib/settings/assistant'
import type {
  AssistantBehavior,
  AssistantFields,
  AssistantLength,
  AssistantSpanish,
  AssistantStage,
  AssistantTone,
  BehaviorListKey,
  CapabilityKey,
} from '@/lib/settings/assistant'
import { budgetRefusal } from '@/lib/settings/assistant-knowledge'
import { seg, sw } from '@/lib/settings/styles'
import type { AiCtx, ReadState, Timers } from './assistant-ctx'
import { realTimers } from './assistant-ctx'
import { CorrectionDialog, KNOWLEDGE_KEY } from './assistant-correction'
import { KnowledgeSection } from './assistant-knowledge'
import { limitsVals } from './assistant-limits'
import { PracticeSection } from './assistant-practice'
import { ReviewSection } from './assistant-review'

export const ASSISTANT_KEY = qk.settings('assistant')

/** Saving the section takes its own permission (backend ADR 0174 D3: `set.assistant`, given to every role that held set.hours). */
export const ASSISTANT_PERMISSION = 'set.assistant'
export const ASSISTANT_DENIED = 'Your role can’t change the assistant settings'

export type AssistantTab = 'status' | 'knowledge' | 'practice' | 'limits' | 'conversations'
export const ASSISTANT_TABS: ReadonlyArray<readonly [AssistantTab, string]> = [
  ['status', 'Status & switches'],
  ['knowledge', 'Knowledge'],
  ['practice', 'Practice'],
  ['limits', 'Limits & tone'],
  ['conversations', 'Conversations'],
]
export const isAssistantTab = (t: string): t is AssistantTab => ASSISTANT_TABS.some(([k]) => k === t)

export interface AssistantDeps {
  api: AssistantApi
  qc: QueryClient
  /** The server's view (starts the read when it is missing; the caller keeps it fresh through the event stream). */
  read(): AssistantView | undefined
  /** The read's state: pending, error or success. */
  status(): 'pending' | 'error' | 'success'
  /** Whether the signed-in person holds a permission. */
  can(key: string): boolean
  emit(t: ToastSpec): void
  /** Something the screen shows changed (re-render). */
  changed(): void
  /** The tabs of ADR 0174: their APIs (without one the tab shows the locked card). */
  ai?: { knowledge?: AssistantKnowledgeApi; practice?: AssistantPracticeApi; review?: AssistantReviewApi }
  /** Reads under ['settings', ...key] through the screen's store (the tabs' lists). */
  query?: {
    read<T>(key: readonly unknown[], fetcher: () => Promise<T>): T | undefined
    status(key: readonly unknown[]): ReadState
    error(key: readonly unknown[]): unknown
  }
  /** The shop's time zone. */
  tz?: () => string
  timers?: Timers
  /** Opens a download (a PDF's presigned link). */
  open?: (url: string) => void
}

const fieldsOf = (v: AssistantView): AssistantFields => {
  const b = (v as Partial<AssistantView>).behavior ?? DEFAULT_BEHAVIOR
  return {
    enabled: v.enabled,
    actionsEnabled: v.actionsEnabled,
    stage: v.stage,
    allowlist: [...v.allowlist],
    staffPauseHours: v.staffPauseHours,
    faq: v.faq.map((p) => ({ q: p.q, a: p.a })),
    capabilities: { ...((v as Partial<AssistantView>).capabilities ?? DEFAULT_CAPABILITIES) },
    behavior: {
      ...b,
      avoidWords: [...b.avoidWords],
      avoidTopics: [...b.avoidTopics],
      handoffTopics: [...b.handoffTopics],
    },
  }
}

/** 422 field paths of the server ("body.stage", "allowlist.1", "faq.0.a") as the screen keys them. */
const fieldPath = (p: string): string => p.replace(/^body\./, '')

export class AssistantSection {
  private edits: Partial<AssistantFields> = {}
  private errors: Record<string, string> = {}
  private numberNew = ''
  private numberError = ''
  private saveError = ''
  private saving = false
  private tab: AssistantTab = 'status'
  private listNew: Record<BehaviorListKey, string> = { avoidWords: '', avoidTopics: '', handoffTopics: '' }
  private listError: Record<BehaviorListKey, string> = { avoidWords: '', avoidTopics: '', handoffTopics: '' }
  readonly ctx: AiCtx
  readonly correction: CorrectionDialog
  readonly knowledge: KnowledgeSection
  readonly practice: PracticeSection
  readonly review: ReviewSection

  constructor(private readonly d: AssistantDeps) {
    const none = (): undefined => undefined
    this.ctx = {
      qc: d.qc,
      read: d.query ? (k, f) => d.query!.read(k, f) : none,
      status: d.query ? (k) => d.query!.status(k) : () => 'pending',
      error: d.query ? (k) => d.query!.error(k) : () => null,
      can: (k) => d.can(k),
      emit: (t) => d.emit(t),
      changed: () => d.changed(),
      tz: d.tz ?? (() => 'America/New_York'),
      timers: d.timers ?? realTimers,
      open:
        d.open ??
        ((url) => {
          if (typeof window !== 'undefined') window.location.assign(url)
        }),
    }
    this.correction = new CorrectionDialog(this.ctx, () => d.ai?.review)
    this.knowledge = new KnowledgeSection(this.ctx, d.ai?.knowledge)
    this.practice = new PracticeSection(this.ctx, d.ai?.practice, this.correction)
    this.review = new ReviewSection(this.ctx, d.ai?.review, this.correction)
  }

  // ---- the tabs ---------------------------------------------------------------------------------------------------------

  /** The rest of `#assistant/<tab>` on load (an unknown tab opens Status & switches). */
  openFromHash(rest: string): void {
    const t = rest.replace(/^\//, '')
    if (isAssistantTab(t)) this.setTab(t, false)
  }

  currentTab(): AssistantTab {
    return this.tab
  }

  /** Switches the tab; `remember` writes `#assistant/<tab>` so a reload comes back to it. */
  setTab(t: AssistantTab, remember = true): void {
    if (this.tab === t) return
    this.tab = t
    if (remember && typeof window !== 'undefined' && window.history?.replaceState) {
      try {
        window.history.replaceState(window.history.state, '', '#assistant' + (t === 'status' ? '' : '/' + t))
      } catch {
        /* a sandboxed frame: the tab still switches */
      }
    }
    this.d.changed()
  }

  view(): AssistantView | undefined {
    return this.d.read()
  }

  /** What stands in for the section: loading until the first answer, failed when it could not be read. */
  state(): 'loading' | 'failed' | 'ready' {
    if (this.d.read()) return 'ready'
    return this.d.status() === 'error' ? 'failed' : 'loading'
  }

  /** The working copy: the server's values with this person's unsaved changes over them. */
  current(): AssistantFields | undefined {
    const v = this.view()
    return v ? { ...fieldsOf(v), ...this.edits } : undefined
  }

  dirty(): boolean {
    const v = this.view()
    return !!v && Object.keys(changedFields(fieldsOf(v), this.edits)).length > 0
  }

  isSaving(): boolean {
    return this.saving
  }

  error(path: string): string {
    return this.errors[path] ?? ''
  }

  errorUnder(prefix: string): string {
    const k = Object.keys(this.errors).find((p) => p === prefix || p.startsWith(prefix + '.'))
    return k ? this.errors[k]! : ''
  }

  allowed(): boolean {
    if (this.d.can(ASSISTANT_PERMISSION)) return true
    this.d.emit({ title: ASSISTANT_DENIED })
    return false
  }

  private edit(patch: Partial<AssistantFields>, clear: (path: string) => boolean = () => false): void {
    if (!this.allowed()) return
    this.edits = { ...this.edits, ...patch }
    for (const k of Object.keys(this.errors)) if (clear(k)) delete this.errors[k]
    this.saveError = ''
    this.d.changed()
  }

  // ---- the controls ---------------------------------------------------------------------------------------------------

  toggle(field: 'enabled' | 'actionsEnabled'): void {
    const c = this.current()
    if (c) this.edit({ [field]: !c[field] })
  }

  setStage(stage: AssistantStage): void {
    if (this.current()) this.edit({ stage }, (k) => k === 'stage')
  }

  pauseBy(delta: number): void {
    const c = this.current()
    if (!c) return
    const next = clampPause(c.staffPauseHours + delta)
    if (next !== c.staffPauseHours) this.edit({ staffPauseHours: next }, (k) => k === 'staffPauseHours')
  }

  setNumberNew(text: string): void {
    this.numberNew = text
    this.numberError = ''
    this.d.changed()
  }

  addNumber(): void {
    const c = this.current()
    if (!c || !this.allowed()) return
    const problem = numberProblem(this.numberNew, c.allowlist)
    if (problem) {
      this.numberError = problem
      this.d.changed()
      return
    }
    const e164 = toE164(this.numberNew)!
    this.numberNew = ''
    this.numberError = ''
    this.edit({ allowlist: [...c.allowlist, e164] })
  }

  removeNumber(i: number): void {
    const c = this.current()
    if (c) this.edit({ allowlist: c.allowlist.filter((_, j) => j !== i) }, (k) => k.startsWith('allowlist'))
  }

  addFaq(): void {
    const c = this.current()
    if (!c) return
    if (c.faq.length >= MAX_FAQ) {
      if (this.allowed()) this.d.emit({ title: `${MAX_FAQ} questions at most`, desc: 'Remove one to add another.' })
      return
    }
    this.edit({ faq: [...c.faq, { q: '', a: '' }] })
  }

  setFaq(i: number, part: 'q' | 'a', text: string): void {
    const c = this.current()
    if (!c || !c.faq[i]) return
    this.edit(
      { faq: c.faq.map((p, j) => (j === i ? { ...p, [part]: text } : p)) },
      (k) => k === `faq.${i}.${part}`,
    )
  }

  removeFaq(i: number): void {
    const c = this.current()
    if (c) this.edit({ faq: c.faq.filter((_, j) => j !== i) }, (k) => k.startsWith('faq'))
  }

  // ---- Limits & tone (ADR 0174 §3) ---------------------------------------------------------------------------------------

  toggleCapability(k: CapabilityKey): void {
    const c = this.current()
    if (c) this.edit({ capabilities: { ...c.capabilities, [k]: !c.capabilities[k] } }, (p) => p.startsWith('capabilities'))
  }

  /** "Answer questions only": every capability and booking by text off; pressed again, back to the defaults. */
  answerOnly(): void {
    const c = this.current()
    if (!c) return
    if (isAnswerOnly(c.capabilities, c.actionsEnabled))
      this.edit({ capabilities: { ...DEFAULT_CAPABILITIES } }, (p) => p.startsWith('capabilities'))
    else this.edit({ capabilities: answerOnlyCapabilities(), actionsEnabled: false }, (p) => p.startsWith('capabilities'))
  }

  private behave(patch: Partial<AssistantBehavior>, clear: (p: string) => boolean = () => false): void {
    const c = this.current()
    if (c) this.edit({ behavior: { ...c.behavior, ...patch } }, clear)
  }

  setTone(t: AssistantTone): void {
    this.behave({ tone: t }, (p) => p === 'behavior.tone')
  }
  setLength(l: AssistantLength): void {
    this.behave({ length: l }, (p) => p === 'behavior.length')
  }
  setSpanish(s: AssistantSpanish): void {
    this.behave({ spanish: s }, (p) => p === 'behavior.spanish')
  }
  setStyleNotes(text: string): void {
    this.behave({ styleNotes: text }, (p) => p === 'behavior.styleNotes')
  }
  setSignOff(text: string): void {
    this.behave({ signOff: text }, (p) => p === 'behavior.signOff')
  }

  listInput(k: BehaviorListKey): { text: string; error: string } {
    return { text: this.listNew[k], error: this.listError[k] }
  }

  setListNew(k: BehaviorListKey, text: string): void {
    this.listNew[k] = text
    this.listError[k] = ''
    this.d.changed()
  }

  addListItem(k: BehaviorListKey): void {
    const c = this.current()
    if (!c || !this.allowed()) return
    const problem = listItemProblem(c.behavior, k, this.listNew[k])
    if (problem) {
      this.listError[k] = problem
      this.d.changed()
      return
    }
    const item = this.listNew[k].trim().replace(/\s+/g, ' ')
    this.listNew[k] = ''
    this.listError[k] = ''
    this.behave({ [k]: [...c.behavior[k], item] }, (p) => p.startsWith('behavior.' + k))
  }

  removeListItem(k: BehaviorListKey, i: number): void {
    const c = this.current()
    if (c) this.behave({ [k]: c.behavior[k].filter((_, j) => j !== i) }, (p) => p.startsWith('behavior.' + k))
  }

  discard(): void {
    this.edits = {}
    this.errors = {}
    this.saveError = ''
    this.numberNew = ''
    this.numberError = ''
    this.listNew = { avoidWords: '', avoidTopics: '', handoffTopics: '' }
    this.listError = { avoidWords: '', avoidTopics: '', handoffTopics: '' }
    this.d.changed()
  }

  async save(): Promise<boolean> {
    if (this.saving) return false
    const v = this.view()
    if (!v || !this.allowed()) return false
    const cur = { ...fieldsOf(v), ...this.edits }
    const problems = faqProblems(cur.faq)
    if (Object.keys(problems).length) {
      this.errors = problems
      this.saveError = 'Fix the questions marked in red, then save.'
      this.d.changed()
      return false
    }
    const limits = behaviorProblems(cur.behavior)
    if (Object.keys(limits).length) {
      this.errors = limits
      this.saveError = 'Fix what is marked in red in Limits & tone, then save.'
      this.d.changed()
      return false
    }
    const patch = changedFields(fieldsOf(v), this.edits)
    if (!Object.keys(patch).length) {
      this.discard()
      return true
    }
    const body = {
      ...patch,
      ...(patch.faq ? { faq: patch.faq.map((p) => ({ q: p.q.trim(), a: p.a.trim() })) } : {}),
      version: v.version,
    }
    this.saving = true
    this.saveError = ''
    this.d.changed()
    let inline = false
    const r = await command({
      key: ASSISTANT_KEY,
      queryClient: this.d.qc,
      request: (idem) => this.d.api.save(body, { idempotencyKey: idem }),
      // the Q&A counts against the knowledge budget the Knowledge tab shows
      invalidate: [KNOWLEDGE_KEY],
      denyLabel: 'change the assistant settings',
      onOk: (res) => ({
        title: 'Assistant settings saved',
        desc: assistantStatus(res).on ? 'Oasis AI is answering texts' : 'Oasis AI is not answering texts',
      }),
      onFail: (e: ApiError) => {
        if (e.status === 422) inline = true
        return undefined
      },
      toast: (t) => {
        if (!inline) this.d.emit(t)
      },
    })
    this.saving = false
    if (r.ok) {
      const view: Partial<typeof r.data> = { ...r.data }
      delete view.changed
      this.d.qc.setQueryData(ASSISTANT_KEY, view)
      this.edits = {}
      this.errors = {}
    } else if (r.error.status === 422) {
      this.errors = {}
      for (const e of r.error.errors) this.errors[fieldPath(e.path)] = e.message
      this.saveError =
        r.error.code === 'KNOWLEDGE_BUDGET'
          ? 'The questions and answers: ' + budgetRefusal(r.error.meta).replace(/^Knowledge is full: /, 'knowledge is full, ')
          : r.error.detail || 'Check the fields marked in red.'
    }
    // a 412 refetched the view (command): the edits stay over the new version and the server said why
    this.d.changed()
    return r.ok
  }

  // ---- what the template reads (live.asst) -------------------------------------------------------------------------------

  vals(open = true): Record<string, unknown> {
    const v = this.view()
    const c = this.current()
    const ready = !!v && !!c
    const tab = this.tab
    const on = (t: AssistantTab): boolean => open && tab === t
    if (!on('knowledge')) this.knowledge.stop()
    if (!on('practice')) this.practice.stop()
    const status = v ? assistantStatus(v) : { on: false, text: '' }
    const stage = stageOf(c?.stage ?? 'allowlist')
    const actionsSub = ACTIONS_SUB + (v && !v.server.actionsEnabled ? ' It is also off on the server for now.' : '')
    const toggles = c
      ? [
          {
            label: 'Answer texts with Oasis AI',
            sub: 'Off: every text reaches the team, as today.',
            on: c.enabled,
            ...sw(c.enabled),
            toggle: () => this.toggle('enabled'),
          },
          {
            label: 'Book, move and cancel by text',
            sub: actionsSub,
            on: c.actionsEnabled,
            ...sw(c.actionsEnabled),
            toggle: () => this.toggle('actionsEnabled'),
          },
        ]
      : []
    const numbers = (c?.allowlist ?? []).map((n, i) => ({
      label: formatPhone(n),
      remove: () => this.removeNumber(i),
      error: this.error(`allowlist.${i}`),
      hasError: !!this.error(`allowlist.${i}`),
    }))
    const faq = (c?.faq ?? []).map((p, i) => ({
      num: String(i + 1),
      q: p.q,
      a: p.a,
      setQ: (e: { target: { value: string } }) => this.setFaq(i, 'q', e.target.value),
      setA: (e: { target: { value: string } }) => this.setFaq(i, 'a', e.target.value),
      remove: () => this.removeFaq(i),
      qError: this.error(`faq.${i}.q`),
      hasQError: !!this.error(`faq.${i}.q`),
      aError: this.error(`faq.${i}.a`),
      hasAError: !!this.error(`faq.${i}.a`),
      count: p.a.trim().length + ' / ' + MAX_FAQ_CHARS,
    }))
    const nFaq = c?.faq.length ?? 0
    return {
      ready,
      tabs: ASSISTANT_TABS.map(([k, label]) => ({ label, style: seg(tab === k), onClick: () => this.setTab(k) })),
      tabStatus: tab === 'status',
      tabKnowledge: tab === 'knowledge',
      tabPractice: tab === 'practice',
      tabLimits: tab === 'limits',
      tabConversations: tab === 'conversations',
      kn: on('knowledge') ? this.knowledge.vals(true) : { ready: false, ed: { open: false } },
      pr: on('practice') ? this.practice.vals(true) : { ready: false },
      rv: on('conversations') ? this.review.vals() : { ready: false },
      lim: limitsVals(this),
      corr: this.correction.vals(),
      badge: !!v?.active,
      statusText: status.text,
      statusStyle: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '14px 16px',
        borderRadius: '14px',
        marginBottom: '18px',
        fontSize: '13.5px',
        fontWeight: 700,
        lineHeight: 1.45,
        background: status.on ? 'var(--accentSoft)' : 'var(--panel2)',
        border: '1px solid ' + (status.on ? 'var(--accentBrd)' : 'var(--line)'),
        color: status.on ? 'var(--accentInk)' : 'var(--ink2)',
      },
      toggles,
      stages: STAGES.map((s) => ({
        label: s.label,
        style: seg(c?.stage === s.key),
        onClick: () => this.setStage(s.key),
      })),
      stageText: stage.explain,
      stageError: this.error('stage'),
      hasStageError: !!this.error('stage'),
      pauseVal: pauseLabel(c?.staffPauseHours ?? 12),
      pauseDec: () => this.pauseBy(-1),
      pauseInc: () => this.pauseBy(1),
      pauseError: this.error('staffPauseHours'),
      hasPauseError: !!this.error('staffPauseHours'),
      numbers,
      numbersCount: numbers.length === 1 ? '1 number' : numbers.length + ' numbers',
      noNumbers: ready && numbers.length === 0,
      numbersNote:
        c?.stage === 'allowlist'
          ? 'Only these numbers get answers while “Who it answers” is Test numbers.'
          : 'Used while “Who it answers” is Test numbers. Right now it answers ' +
            (c?.stage === 'customers' ? 'every client' : 'everyone') +
            '.',
      numberNew: this.numberNew,
      numberSet: (e: { target: { value: string } }) => this.setNumberNew(e.target.value),
      numberKeys: (e: { key: string; preventDefault(): void }) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          this.addNumber()
        }
      },
      numberAdd: () => this.addNumber(),
      numberError: this.numberError,
      hasNumberError: !!this.numberError,
      faq,
      faqCount: nFaq + ' of ' + MAX_FAQ,
      noFaq: ready && nFaq === 0,
      faqAdd: () => this.addFaq(),
      faqAddStyle: {
        height: '44px',
        padding: '0 16px',
        borderRadius: '11px',
        background: 'var(--accent)',
        color: '#fff',
        fontWeight: 800,
        fontSize: '13px',
        opacity: nFaq >= MAX_FAQ ? 0.5 : 1,
      },
      dirty: this.dirty(),
      discard: () => this.discard(),
      save: () => void this.save(),
      saveLabel: this.saving ? 'Saving…' : 'Save changes',
      saveStyle: {
        height: '46px',
        padding: '0 22px',
        borderRadius: '12px',
        background: 'var(--accent)',
        color: '#fff',
        fontWeight: 800,
        fontSize: '14px',
        opacity: this.saving ? 0.6 : 1,
      },
      saveError: this.saveError,
      hasSaveError: !!this.saveError,
      saveTitle: this.saveError || 'Unsaved changes to the assistant',
      saveTitleStyle: {
        flex: 1,
        fontWeight: 700,
        fontSize: '14px',
        color: this.saveError ? '#C2410C' : 'var(--ink)',
      },
    }
  }
}
