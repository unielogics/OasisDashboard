// Settings → Oasis AI → Knowledge (ADR 0174 §1, §2; design §9 tab 2; DEVIATIONS DV-709, DV-710). What Oasis AI knows
// besides Settings: the budget meter, notes, PDFs and corrections, each an entry that is on (Oasis AI reads it) or a draft.
// The Q&A of the section is shown in this tab too but stays in the section's working copy and its save bar
// (live/assistant.ts). Entries save one at a time:
//   notes        the editor (name, text with its count and live warnings), Save / Save and turn on, on/off, delete;
//   PDFs         a dashed drop box with an invisible full-size file input over it (dropping works without drop handlers,
//                the photo slot's trick); each file is checked (PDF, 10 MB), hashed in the browser (WebCrypto SHA-256, so a
//                file already in the knowledge is refused before any byte is sent), uploaded to the presigned POST with
//                XMLHttpRequest ("Uploading 45%"), then completed; the server reads it in a job ("Reading the PDF…", the tab
//                reads the list again every 3 s meanwhile) and its text waits for the owner's review ("Ready to review");
//   review       the extracted text, editable, with its warnings; turning it on needs "I read this text" and, when a line
//                reads like an order to Oasis AI, the second confirmation;
//   corrections  the question and the right answer (made from Practice or Conversations), on/off, edit, delete.
// A 412 keeps the editor and says someone else changed it; a 422 KNOWLEDGE_BUDGET says how much is over; nothing is cut.
import type { ApiError } from '@/data/http/problem'
import type {
  AssistantKnowledgeApi,
  KnowledgeDocument,
  KnowledgeEntry,
  KnowledgeView,
} from '@/data/ports/assistant-knowledge-api'
import { UploadError } from '@/data/ports/assistant-knowledge-api'
import {
  DEFAULT_LIMITS,
  METER_EXPLAIN,
  budgetRefusal,
  bytesLabel,
  canRetry,
  chipStyle,
  cleanFilename,
  documentChip,
  documentError,
  capWarnings,
  fileProblem,
  hasInstruction,
  meter,
  sha256Hex,
  shownWarnings,
  textWarnings,
  warningText,
  warningTone,
} from '@/lib/settings/assistant-knowledge'
import type { KnowledgeWarningLike } from '@/lib/settings/assistant-knowledge'
import { sw } from '@/lib/settings/styles'
import type { AiCtx, FileEvent, InputEvent, Vals } from './assistant-ctx'
import {
  ERR,
  bannerStyle,
  countStyle,
  fmt,
  ghostStyle,
  inputStyle,
  isNotBuilt,
  primaryStyle,
  problemText,
  run,
  textareaStyle,
  warnStyle,
} from './assistant-ctx'
import { KNOWLEDGE_KEY } from './assistant-correction'

export { KNOWLEDGE_KEY }

/** While a PDF is being read the tab reads the list again this often (the event stream also announces the end). */
export const EXTRACT_POLL_MS = 3000
const PERMISSION = 'set.assistant'
const DENY = 'change the Oasis AI settings'
const DENIED = 'Your role can’t change the Oasis AI settings'
const STALE =
  'Someone else changed this meanwhile, so nothing was saved. Their version is on the list now; save again to keep yours.'
const MAX_WARNINGS_SHOWN = 12
const CONFIRM_FIRST = 'Tick the box under the lines marked in red first.'
const CONFIRM_FIRST_UNMARKED = 'Tick the box about lines that read like orders first.'
const NEVER_ORDERS = '(Oasis AI never follows orders written in your text.)'

type Kind = KnowledgeEntry['kind']

interface Editor {
  id: string | null
  kind: Kind
  title: string
  body: string
  question: string
  version: number
  active: boolean
  reviewedAt: string | null
  /** The entry as the server has it (to send only what changed and to show its warnings while unchanged). */
  base: { title: string; body: string; question: string; warnings: KnowledgeWarningLike[] }
  reviewed: boolean
  confirm: boolean
  /** The server asked for confirmInstructions (its detectors found an order-like line): the box shows from then on. */
  needsConfirm: boolean
  errors: { title?: string; body?: string; question?: string }
  error: string
  draftOnly: boolean
  saving: boolean
}

interface Upload {
  name: string
  percent: number | null
  phase: 'checking' | 'uploading' | 'finishing'
  documentId: string | null
}

export class KnowledgeSection {
  private editor: Editor | null = null
  private notice: { text: string; tone: 'amber' | 'red' | 'accent' } | null = null
  private confirming: string | null = null
  private busy = new Set<string>()
  private uploads = new Map<string, Upload>()
  private uploadErrors: string[] = []
  private seq = 0
  private poll: unknown = null

  constructor(
    private readonly ctx: AiCtx,
    private readonly api: AssistantKnowledgeApi | undefined,
  ) {}

  private allowed(): boolean {
    if (this.ctx.can(PERMISSION)) return true
    this.ctx.emit({ title: DENIED })
    return false
  }

  view(): KnowledgeView | undefined {
    const api = this.api
    if (!api || !this.ctx.can(PERMISSION)) return undefined
    return this.ctx.read(['assistant_knowledge'], () => api.get())
  }

  state(): 'locked' | 'loading' | 'failed' | 'soon' | 'ready' {
    if (!this.ctx.can(PERMISSION) || !this.api) return 'locked'
    if (this.view()) return 'ready'
    const st = this.ctx.status(['assistant_knowledge'])
    if (st !== 'error') return 'loading'
    return isNotBuilt(this.ctx.error(['assistant_knowledge'])) ? 'soon' : 'failed'
  }

  retry(): void {
    void this.ctx.qc.invalidateQueries({ queryKey: KNOWLEDGE_KEY })
  }

  private refresh(): void {
    void this.ctx.qc.invalidateQueries({ queryKey: KNOWLEDGE_KEY })
  }

  private limits() {
    return this.view()?.limits ?? DEFAULT_LIMITS
  }

  private entry(id: string): KnowledgeEntry | undefined {
    return this.view()?.entries.find((e) => e.id === id)
  }

  /** Reads the list again while a PDF is being read, only while the tab is on screen. */
  private schedulePoll(v: KnowledgeView | undefined, visible: boolean): void {
    const reading = !!v?.documents.some((d) => d.status === 'extracting')
    if (!visible || !reading) {
      if (this.poll !== null) this.ctx.timers.clear(this.poll)
      this.poll = null
      return
    }
    if (this.poll !== null) return
    this.poll = this.ctx.timers.set(() => {
      this.poll = null
      this.refresh()
    }, EXTRACT_POLL_MS)
  }

  stop(): void {
    if (this.poll !== null) this.ctx.timers.clear(this.poll)
    this.poll = null
  }

  // ---- the editor --------------------------------------------------------------------------------------------------------

  newNote(): void {
    if (!this.allowed()) return
    this.notice = null
    this.editor = {
      id: null,
      kind: 'note',
      title: '',
      body: '',
      question: '',
      version: 0,
      active: false,
      reviewedAt: null,
      base: { title: '', body: '', question: '', warnings: [] },
      reviewed: false,
      confirm: false,
      needsConfirm: false,
      errors: {},
      error: '',
      draftOnly: false,
      saving: false,
    }
    this.ctx.changed()
  }

  open(id: string, hint = ''): void {
    const e = this.entry(id)
    if (!e) return
    this.editor = {
      id: e.id,
      kind: e.kind,
      title: e.title,
      body: e.body,
      question: e.question ?? '',
      version: e.version,
      active: e.active,
      reviewedAt: e.reviewedAt,
      base: { title: e.title, body: e.body, question: e.question ?? '', warnings: e.warnings },
      reviewed: false,
      confirm: false,
      needsConfirm: false,
      errors: {},
      error: hint,
      draftOnly: false,
      saving: false,
    }
    this.ctx.changed()
  }

  close(): void {
    this.editor = null
    this.ctx.changed()
  }

  private set(patch: Partial<Editor>, clear: keyof Editor['errors'] | null = null): void {
    const ed = this.editor
    if (!ed) return
    if (!this.allowed()) return
    Object.assign(ed, patch)
    if (clear) delete ed.errors[clear]
    ed.error = ''
    ed.draftOnly = false
    this.ctx.changed()
  }

  /** The warnings shown in the editor: the server's while the text is as saved, the browser's copy once it is edited. */
  private editorWarnings(ed: Editor): KnowledgeWarningLike[] {
    const changed = ed.body !== ed.base.body || ed.title !== ed.base.title || ed.question !== ed.base.question
    if (ed.id && !changed) return ed.base.warnings
    const head = [ed.title, ed.question].flatMap((t) => textWarnings(t.replace(/\n/g, ' ')).map((w) => ({ ...w, line: 0 })))
    const extra: KnowledgeWarningLike[] = ed.base.warnings.filter((w) => w.kind === 'hidden' && w.line === 0)
    if (ed.kind === 'document' && ed.body.length > this.limits().documentActiveMax)
      extra.push({ kind: 'long', sample: `${ed.body.length} characters`, line: 0 })
    return capWarnings([...extra, ...head, ...textWarnings(ed.body)])
  }

  private bodyMax(kind: Kind): number {
    const l = this.limits()
    return kind === 'note' ? l.noteMax : kind === 'correction' ? l.correctionAnswerMax : l.documentStoreMax
  }

  async save(turnOn: boolean, o: { draft?: boolean } = {}): Promise<boolean> {
    const ed = this.editor
    const api = this.api
    if (!ed || !api || ed.saving || !this.allowed()) return false
    const l = this.limits()
    const title = ed.title.replace(/\s+/g, ' ').trim()
    const body = ed.body.trim()
    const question = ed.question.trim()
    const errors: Editor['errors'] = {}
    if (!title) errors.title = 'Give it a name.'
    else if (title.length > l.titleMax) errors.title = `${l.titleMax} characters at most (now ${title.length}).`
    const max = this.bodyMax(ed.kind)
    if (!body) errors.body = ed.kind === 'correction' ? 'Write the right answer.' : 'Write something for Oasis AI to know.'
    else if (body.length > max) errors.body = `Keep it to ${fmt(max)} characters or fewer (now ${fmt(body.length)}).`
    if (ed.kind === 'correction') {
      if (!question) errors.question = 'Write what the client asked.'
      else if (question.length > l.questionMax) errors.question = `${l.questionMax} characters at most (now ${question.length}).`
    }
    const willBeOn = !o.draft && (turnOn || (ed.active && !!ed.id))
    if (!errors.body && ed.kind === 'document' && willBeOn && body.length > l.documentActiveMax)
      errors.body = `Shorten this text to ${fmt(l.documentActiveMax)} characters or fewer to turn it on (now ${fmt(body.length)}).`
    ed.errors = errors
    if (Object.keys(errors).length) {
      ed.error = 'Fix what is marked in red, then save.'
      this.ctx.changed()
      return false
    }
    const bodyChanged = body !== ed.base.body
    const warnings = this.editorWarnings(ed)
    if (ed.kind === 'document' && willBeOn) {
      const needsReview = !ed.reviewedAt || bodyChanged
      if (needsReview && !ed.reviewed) {
        ed.error = 'Tick “I read this text and it is right” first.'
        this.ctx.changed()
        return false
      }
      const instr = hasInstruction(warnings)
      if (((instr && (needsReview || title !== ed.base.title)) || ed.needsConfirm) && !ed.confirm) {
        ed.error = instr ? CONFIRM_FIRST : CONFIRM_FIRST_UNMARKED
        this.ctx.changed()
        return false
      }
    }
    let request: (idem: string) => Promise<unknown>
    let title0 = 'Saved'
    if (!ed.id) {
      const create = { title, body, active: !o.draft && turnOn }
      request = (idem) => api.createNote(create, { idempotencyKey: idem })
      title0 = create.active ? 'Note saved and on' : 'Note saved as a draft'
    } else {
      const id = ed.id
      const patch: Record<string, unknown> = { version: ed.version }
      if (title !== ed.base.title) patch.title = title
      if (bodyChanged) patch.body = body
      if (ed.kind === 'correction' && question !== ed.base.question) patch.question = question
      if (o.draft && ed.active) patch.active = false
      else if (!o.draft && turnOn && !ed.active) patch.active = true
      if (ed.kind === 'document' && ed.reviewed) patch.reviewed = true
      if (ed.kind === 'document' && ed.confirm) patch.confirmInstructions = true
      if (Object.keys(patch).length === 1) {
        this.close()
        return true
      }
      request = (idem) => api.update(id, patch as never, { idempotencyKey: idem })
      title0 =
        patch.active === true ? 'Saved and on' : patch.active === false ? 'Saved as a draft' : ed.active ? 'Saved' : 'Draft saved'
    }
    ed.saving = true
    ed.error = ''
    this.ctx.changed()
    const r = await run(this.ctx, {
      key: KNOWLEDGE_KEY,
      request,
      denyLabel: DENY,
      ok: () => ({ title: title0, desc: title }),
    })
    ed.saving = false
    if (r.ok) {
      if (this.editor === ed) this.editor = null
    } else this.explain(ed, r.error)
    this.ctx.changed()
    return r.ok
  }

  private explain(ed: Editor, e: ApiError): void {
    ed.draftOnly = false
    if (e.code === 'KNOWLEDGE_BUDGET') {
      ed.error = budgetRefusal(e.meta)
      ed.draftOnly = true
    } else if (e.code === 'KNOWLEDGE_NEEDS_REVIEW') {
      const needs = Array.isArray(e.meta.needs) ? (e.meta.needs as string[]) : []
      if (needs.includes('confirmInstructions') && ed.kind === 'document') ed.needsConfirm = true
      ed.error = needs.includes('reviewed')
        ? 'Tick “I read this text and it is right” first.'
        : hasInstruction(this.editorWarnings(ed))
          ? CONFIRM_FIRST
          : CONFIRM_FIRST_UNMARKED
    } else if (e.code === 'VERSION_CONFLICT' || e.status === 412) {
      const cur = Number(e.meta.currentVersion)
      if (Number.isFinite(cur)) ed.version = cur
      ed.error = STALE
    } else if (e.status === 422 && e.errors.length) {
      for (const fe of e.errors) {
        const k = fe.path.replace(/^body\./, '')
        if (k === 'title' || k === 'body' || k === 'question') ed.errors[k] = fe.message
      }
      ed.error = problemText(e)
    } else if (e.status === 409 || e.status === 422 || e.status === 429 || isNotBuilt(e)) {
      ed.error = problemText(e)
    }
  }

  // ---- the lists ---------------------------------------------------------------------------------------------------------

  async toggle(id: string): Promise<void> {
    const e = this.entry(id)
    const api = this.api
    if (!e || !api || this.busy.has(id) || !this.allowed()) return
    if (e.kind === 'document' && !e.active && !e.reviewedAt) {
      this.open(id, 'Read the text first. Tick “I read this text and it is right”, then Save and turn on.')
      return
    }
    this.busy.add(id)
    this.notice = null
    this.ctx.changed()
    const on = !e.active
    const r = await run(this.ctx, {
      key: KNOWLEDGE_KEY,
      request: (idem) => api.update(id, { active: on, version: e.version }, { idempotencyKey: idem }),
      denyLabel: DENY,
      ok: () => ({ title: on ? 'On' : 'Off', desc: e.title + (on ? ' · Oasis AI reads it now' : ' · Oasis AI no longer reads it') }),
    })
    this.busy.delete(id)
    if (!r.ok) {
      const err = r.error
      if (err.code === 'KNOWLEDGE_BUDGET') this.notice = { tone: 'red', text: budgetRefusal(err.meta) }
      else if (err.code === 'KNOWLEDGE_NEEDS_REVIEW') this.open(id, 'Read the text first, then Save and turn on.')
      else if (err.status === 412)
        this.notice = { tone: 'amber', text: 'Someone else changed this meanwhile. The list shows their change now: try again.' }
      else if (err.status === 409 || err.status === 422 || isNotBuilt(err))
        this.notice = { tone: 'red', text: problemText(err) }
    }
    this.ctx.changed()
  }

  askRemove(key: string): void {
    if (!this.allowed()) return
    this.confirming = key
    this.ctx.changed()
  }

  /** Deletes an entry (a PDF's entry deletes the PDF too) or a document without an entry. */
  async remove(key: string): Promise<void> {
    const api = this.api
    if (!api || this.busy.has(key) || !this.allowed()) return
    const [kind, id] = key.split(':') as ['entry' | 'doc', string]
    this.busy.add(key)
    this.confirming = null
    this.ctx.changed()
    const name =
      kind === 'entry' ? (this.entry(id)?.title ?? '') : (this.view()?.documents.find((d) => d.id === id)?.filename ?? '')
    const r = await run(this.ctx, {
      key: KNOWLEDGE_KEY,
      request: (idem) =>
        kind === 'entry' ? api.remove(id, { idempotencyKey: idem }) : api.removeDocument(id, { idempotencyKey: idem }),
      denyLabel: DENY,
      ok: () => ({ title: 'Deleted', desc: name }),
    })
    this.busy.delete(key)
    if (!r.ok && (r.error.status === 409 || isNotBuilt(r.error))) this.notice = { tone: 'red', text: problemText(r.error) }
    if (this.editor?.id === id) this.editor = null
    this.ctx.changed()
  }

  async retryDocument(id: string): Promise<void> {
    const api = this.api
    if (!api || this.busy.has('doc:' + id) || !this.allowed()) return
    this.busy.add('doc:' + id)
    this.ctx.changed()
    const r = await run(this.ctx, {
      key: KNOWLEDGE_KEY,
      request: (idem) => api.retry(id, { idempotencyKey: idem }),
      denyLabel: DENY,
    })
    this.busy.delete('doc:' + id)
    if (!r.ok && (r.error.status === 409 || isNotBuilt(r.error))) this.notice = { tone: 'red', text: problemText(r.error) }
    this.ctx.changed()
  }

  async download(id: string): Promise<void> {
    const api = this.api
    if (!api) return
    try {
      const f = await api.file(id)
      this.ctx.open(f.url)
    } catch (e) {
      const err = e as ApiError
      this.notice = { tone: 'red', text: err?.detail || 'The PDF could not be opened. Try again.' }
      this.ctx.changed()
    }
  }

  // ---- uploads -----------------------------------------------------------------------------------------------------------

  onFiles(e: FileEvent): void {
    const files = Array.from(e.target.files ?? [])
    try {
      e.target.value = ''
    } catch {
      /* a test event */
    }
    if (!files.length || !this.allowed()) return
    this.uploadErrors = []
    this.notice = null
    for (const f of files) void this.upload(f)
    this.ctx.changed()
  }

  async upload(file: File): Promise<boolean> {
    const api = this.api
    if (!api) return false
    const name = cleanFilename(file.name)
    const problem = fileProblem(file, this.limits().documentMaxBytes)
    if (problem) {
      this.uploadErrors.push(problem)
      this.ctx.changed()
      return false
    }
    const id = 'u' + ++this.seq
    const u: Upload = { name, percent: null, phase: 'checking', documentId: null }
    this.uploads.set(id, u)
    this.ctx.changed()
    const fail = (text: string): false => {
      this.uploads.delete(id)
      this.uploadErrors.push(text)
      this.refresh()
      this.ctx.changed()
      return false
    }
    let sha: string
    try {
      sha = await sha256Hex(await file.arrayBuffer())
    } catch {
      return fail(`“${name}” could not be read on this device. Try another copy.`)
    }
    const pre = await run(this.ctx, {
      key: KNOWLEDGE_KEY,
      request: (idem) => api.presign({ filename: name, bytes: file.size, sha256: sha }, { idempotencyKey: idem }),
      denyLabel: DENY,
    })
    if (!pre.ok) {
      if (pre.error.code === 'DUPLICATE_DOCUMENT') return fail(`“${name}” is already in your knowledge.`)
      return fail(
        pre.error.status === 422 || pre.error.status === 409 || isNotBuilt(pre.error)
          ? `“${name}”: ${problemText(pre.error)}`
          : `“${name}” was not uploaded.`,
      )
    }
    u.documentId = pre.data.documentId
    u.phase = 'uploading'
    u.percent = 0
    this.ctx.changed()
    try {
      await api.upload(pre.data.upload, file, {
        onProgress: (p) => {
          u.percent = p
          this.ctx.changed()
        },
      })
    } catch (err) {
      return fail(`“${name}”: ${err instanceof UploadError ? err.message : 'the upload failed. Try again.'}`)
    }
    u.phase = 'finishing'
    u.percent = 100
    this.ctx.changed()
    const done = await run(this.ctx, {
      key: KNOWLEDGE_KEY,
      request: (idem) => api.complete(pre.data.documentId, { idempotencyKey: idem }),
      denyLabel: DENY,
    })
    this.uploads.delete(id)
    if (!done.ok) {
      if (done.error.code === 'DUPLICATE_DOCUMENT') return fail(`“${name}” is already in your knowledge.`)
      return fail(`“${name}”: ${problemText(done.error)}`)
    }
    this.refresh()
    this.ctx.changed()
    return true
  }

  // ---- what the template reads (live.asst.kn) ------------------------------------------------------------------------------

  vals(visible: boolean): Vals {
    const st = this.state()
    const v = st === 'ready' ? this.view() : undefined
    this.schedulePoll(v, visible)
    const base: Vals = {
      locked: st === 'locked',
      lockedText: 'Ask an administrator to give your role the “Oasis AI assistant” permission to see and change what Oasis AI knows.',
      loading: st === 'loading',
      failed: st === 'failed',
      soon: st === 'soon',
      retry: () => this.retry(),
      ready: !!v,
    }
    if (!v) return { ...base, notes: [], docs: [], uploadRows: [], corrections: [], ed: { open: false } }
    const m = meter(v.budget)
    const tone = m.tone === 'full' ? ERR : m.tone === 'near' ? '#B45309' : 'var(--accent)'
    const entries = v.entries
    const byDoc = new Map(entries.filter((e) => e.documentId).map((e) => [e.documentId!, e]))
    const uploadsByDoc = new Map([...this.uploads.values()].filter((u) => u.documentId).map((u) => [u.documentId!, u]))
    const rowOf = (key: string, on: boolean) => {
      const t = sw(on)
      return {
        on,
        track: { ...t.track, opacity: this.busy.has(key) ? 0.6 : 1 },
        knob: t.knob,
        confirming: this.confirming === key,
        askRemove: () => this.askRemove(key),
        remove: () => void this.remove(key),
        keep: () => {
          this.confirming = null
          this.ctx.changed()
        },
      }
    }
    const warnCount = (e: KnowledgeEntry): string =>
      e.warnings.length ? e.warnings.length + (e.warnings.length === 1 ? ' warning' : ' warnings') : ''
    const notes = entries
      .filter((e) => e.kind === 'note')
      .map((e) => ({
        ...rowOf('entry:' + e.id, e.active),
        title: e.title,
        sub: (e.active ? 'On' : 'Draft') + ' · ' + fmt(e.chars) + ' characters' + (warnCount(e) ? ' · ' + warnCount(e) : ''),
        preview: e.body.length > 140 ? e.body.slice(0, 139) + '…' : e.body,
        toggle: () => void this.toggle(e.id),
        edit: () => this.open(e.id),
      }))
    const docs = v.documents.map((d: KnowledgeDocument) => {
      const e = d.entryId ? (entries.find((x) => x.id === d.entryId) ?? byDoc.get(d.id) ?? null) : (byDoc.get(d.id) ?? null)
      const up = uploadsByDoc.get(d.id)
      const chip = documentChip(d, e, up ? (up.percent ?? 0) : null)
      const key = e ? 'entry:' + e.id : 'doc:' + d.id
      const failed = d.status === 'failed' && !up
      return {
        ...rowOf(key, !!e?.active),
        name: d.filename,
        sub: [bytesLabel(d.bytes), d.pageCount ? d.pageCount + (d.pageCount === 1 ? ' page' : ' pages') : '', e ? fmt(e.chars) + ' characters' : '']
          .filter(Boolean)
          .join(' · '),
        chip: chip.label,
        chipStyle: chipStyle(chip.tone),
        hasError: failed,
        error: failed ? documentError(d) : '',
        canRetry: failed && canRetry(d),
        retry: () => void this.retryDocument(d.id),
        hasToggle: !!e && d.status === 'ready',
        toggle: () => (e ? void this.toggle(e.id) : undefined),
        canReview: !!e && d.status === 'ready',
        reviewLabel: e && !e.reviewedAt ? 'Review' : 'Open',
        review: () => (e ? this.open(e.id) : undefined),
        canDownload: d.status === 'ready' || d.status === 'failed',
        download: () => void this.download(d.id),
        canRemove: !up && d.status !== 'extracting',
        confirmText: 'Delete this PDF and its text?',
      }
    })
    const listed = new Set(v.documents.map((d) => d.id))
    const uploadRows = [...this.uploads.values()]
      .filter((u) => !u.documentId || !listed.has(u.documentId))
      .map((u) => {
        const chip =
          u.phase === 'checking'
            ? { label: 'Checking…', tone: 'accent' as const }
            : u.phase === 'finishing'
              ? { label: 'Finishing…', tone: 'accent' as const }
              : { label: `Uploading ${u.percent ?? 0}%`, tone: 'accent' as const }
        return { name: u.name, chip: chip.label, chipStyle: chipStyle(chip.tone), barStyle: barFill(u.percent ?? 0, 'var(--accent)') }
      })
    const corrections = entries
      .filter((e) => e.kind === 'correction')
      .map((e) => ({
        ...rowOf('entry:' + e.id, e.active),
        q: e.question ?? e.title,
        a: e.body,
        sub: (e.active ? 'On' : 'Draft') + ' · ' + (e.source === 'live' ? 'from a real chat' : e.source === 'practice' ? 'from practice' : 'written here'),
        toggle: () => void this.toggle(e.id),
        edit: () => this.open(e.id),
      }))
    return {
      ...base,
      meterText: m.text,
      meterParts: m.parts,
      meterLeft: m.left,
      meterExplain: METER_EXPLAIN,
      meterFill: barFill(m.percent, tone),
      hasNotice: !!this.notice,
      notice: this.notice?.text ?? '',
      noticeStyle: bannerStyle(this.notice?.tone ?? 'amber'),
      notes,
      noNotes: notes.length === 0,
      addNote: () => this.newNote(),
      docs,
      uploadRows,
      noDocs: docs.length === 0 && uploadRows.length === 0,
      onFiles: (e: FileEvent) => this.onFiles(e),
      dropTitle: 'Drop PDFs here, or tap to choose',
      dropSub: `PDF files up to ${bytesLabel(this.limits().documentMaxBytes)} and ${this.limits().documentMaxPages} pages. Oasis AI reads the text; you check it before it is used. Scans (pictures of pages) can’t be read.`,
      uploadErrors: this.uploadErrors.map((text) => ({ text })),
      hasUploadErrors: this.uploadErrors.length > 0,
      clearUploadErrors: () => {
        this.uploadErrors = []
        this.ctx.changed()
      },
      corrections,
      noCorrections: corrections.length === 0,
      ed: this.editorVals(),
    }
  }

  private editorVals(): Vals {
    const ed = this.editor
    if (!ed) return { open: false }
    const l = this.limits()
    const warnings = this.editorWarnings(ed)
    const shown = shownWarnings(warnings, MAX_WARNINGS_SHOWN).map((w) => ({ text: warningText(w), style: warnStyle(warningTone(w)) }))
    const more = warnings.length - shown.length
    const isDoc = ed.kind === 'document'
    const bodyLen = ed.body.trim().length
    const max = this.bodyMax(ed.kind)
    const bodyChanged = ed.body.trim() !== ed.base.body
    const needsReview = isDoc && (!ed.reviewedAt || bodyChanged)
    const instr = hasInstruction(warnings)
    const heading = !ed.id
      ? 'New note'
      : isDoc
        ? (ed.reviewedAt ? 'Document · ' : 'Review · ') + ed.title
        : ed.kind === 'correction'
          ? 'Edit correction'
          : 'Edit note'
    const intro = isDoc
      ? 'This is the text Oasis AI read from the PDF. Check it and fix anything wrong. Amounts, links and other numbers stay hidden from Oasis AI.'
      : ed.kind === 'correction'
        ? 'The question as a client asks it, and the answer Oasis AI should give.'
        : 'Anything Oasis AI should know about the shop, in plain words: the waiting area, what a service includes, how long a coating cures. Prices always come from Settings → Prices.'
    return {
      open: true,
      heading,
      intro,
      isCorrection: ed.kind === 'correction',
      titleLabel: isDoc ? 'Name' : ed.kind === 'correction' ? 'Short name' : 'Name',
      title: ed.title,
      setTitle: (e: InputEvent) => this.set({ title: e.target.value }, 'title'),
      titleStyle: inputStyle(!!ed.errors.title),
      titleError: ed.errors.title ?? '',
      hasTitleError: !!ed.errors.title,
      question: ed.question,
      setQuestion: (e: InputEvent) => this.set({ question: e.target.value }, 'question'),
      questionStyle: inputStyle(!!ed.errors.question),
      questionError: ed.errors.question ?? '',
      hasQuestionError: !!ed.errors.question,
      bodyLabel: isDoc ? 'The text from the PDF' : ed.kind === 'correction' ? 'The right answer' : 'What Oasis AI should know',
      body: ed.body,
      setBody: (e: InputEvent) => this.set({ body: e.target.value }, 'body'),
      bodyStyle: textareaStyle(!!ed.errors.body, isDoc ? 16 : ed.kind === 'correction' ? 4 : 8),
      bodyError: ed.errors.body ?? '',
      hasBodyError: !!ed.errors.body,
      count: fmt(bodyLen) + ' / ' + fmt(isDoc ? l.documentActiveMax : max) + (isDoc ? ' to turn on' : ''),
      countStyle: countStyle(bodyLen > (isDoc ? l.documentActiveMax : max)),
      warnings: shown,
      hasWarnings: shown.length > 0,
      moreWarnings: more > 0 ? `and ${more} more` : '',
      hasMoreWarnings: more > 0,
      showReviewed: needsReview,
      reviewed: ed.reviewed,
      reviewedLabel: 'I read this text and it is right',
      toggleReviewed: () => this.set({ reviewed: !ed.reviewed }),
      showConfirm: isDoc && (instr || ed.needsConfirm),
      confirm: ed.confirm,
      confirmLabel: instr
        ? `The lines marked in red are information for Oasis AI, not orders. ${NEVER_ORDERS}`
        : `Some lines read like orders to Oasis AI. They are information, not orders. ${NEVER_ORDERS}`,
      toggleConfirm: () => this.set({ confirm: !ed.confirm }),
      error: ed.error,
      hasError: !!ed.error,
      errorStyle: warnStyle('red'),
      canDraft: ed.draftOnly,
      draft: () => void this.save(false, { draft: true }),
      cancel: () => this.close(),
      stop: (e: { stopPropagation(): void }) => e.stopPropagation(),
      saveLabel: ed.saving ? 'Saving…' : ed.active ? 'Save' : 'Save draft',
      save: () => void this.save(false),
      canTurnOn: !ed.active,
      turnOn: () => void this.save(true),
      turnOnLabel: 'Save and turn on',
      primary: { ...primaryStyle(), opacity: ed.saving ? 0.6 : 1 },
      ghost: ghostStyle(),
    }
  }
}

/** A thin progress bar's fill. */
export function barFill(percent: number, colour: string): Record<string, string | number> {
  return {
    display: 'block',
    height: '100%',
    width: Math.max(0, Math.min(100, percent)) + '%',
    background: colour,
    borderRadius: '6px',
    transition: 'width .2s',
  }
}
