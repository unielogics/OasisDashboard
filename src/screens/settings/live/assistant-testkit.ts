/* eslint-disable @typescript-eslint/no-explicit-any */
// Shared by the tests of Settings → Oasis AI's tabs (ADR 0174): stateful fakes of the knowledge, practice and review APIs
// that answer like backend api-spec 15.6c–f (versions, the budget, the review gate, duplicates, 501 until built), manual
// timers, and the view model on LiveData for a role. Not shipped.
import { makeSession } from '@/auth/test-fixtures'
import { ApiError } from '@/data/http/problem'
import { makeQueryClient } from '@/data/query'
import type { AssistantApi, AssistantView } from '@/data/ports/assistant-api'
import type {
  AssistantKnowledgeApi,
  KnowledgeDocument,
  KnowledgeEntry,
  KnowledgeView,
} from '@/data/ports/assistant-knowledge-api'
import type {
  AssistantPracticeApi,
  AssistantReviewApi,
  ConversationDetail,
  ConversationList,
  PracticeDetail,
  PracticeList,
  PracticeTurn,
} from '@/data/ports/assistant-practice-api'
import type { ToastSpec } from '@/data/toast'
import { createSettingsLogic } from '../Logic'
import view0 from './__fixtures__/assistant.json'
import type { Timers } from './assistant-ctx'
import { LiveData } from './LiveData'
import { clone, fakeApi } from './testkit'

export const notBuilt = (): ApiError =>
  new ApiError({ status: 501, code: 'NOT_BUILT', title: 'Coming soon', detail: 'This part of Oasis AI is not built yet' })

const FIELDS = ['enabled', 'actionsEnabled', 'stage', 'allowlist', 'staffPauseHours', 'faq', 'capabilities', 'behavior']

/** GET/PUT /settings/assistant: one version, 412 when stale, the FAQ against the knowledge budget. */
export function fakeSettings(k?: ReturnType<typeof fakeKnowledge>) {
  const calls: any[][] = []
  const fail = new Map<string, ApiError>()
  const state = { view: clone(view0) as AssistantView }
  const api: AssistantApi = {
    get: async () => {
      calls.push(['get'])
      return clone(state.view)
    },
    save: async (body: any, o?: any) => {
      calls.push(['save', clone(body), o])
      const e = fail.get('save')
      if (e) {
        fail.delete('save')
        throw e
      }
      if (body.version !== state.view.version)
        throw new ApiError({ status: 412, code: 'VERSION_CONFLICT', title: 'Changed by someone else', detail: 'Someone saved these settings a moment ago. Your changes are kept; save again.' })
      const changed: string[] = []
      for (const f of FIELDS)
        if (f in body && JSON.stringify(body[f]) !== JSON.stringify((state.view as any)[f])) {
          ;(state.view as any)[f] = clone(body[f])
          changed.push('assistant.' + f)
        }
      state.view.version += changed.length
      if (k) k.state.faqChars = state.view.faq.reduce((n, p) => n + p.q.length + p.a.length, 0)
      return { ...clone(state.view), changed }
    },
  }
  return { api, calls, fail, state }
}

const NOW = '2026-06-13T14:30:00.000Z'
const LIMITS = {
  titleMax: 120,
  noteMax: 4000,
  documentStoreMax: 60000,
  documentActiveMax: 20000,
  correctionAnswerMax: 500,
  questionMax: 300,
  documentMaxBytes: 10 * 1024 * 1024,
  documentMaxPages: 60,
}

export const entry = (o: Partial<KnowledgeEntry> & { id: string }): KnowledgeEntry => ({
  kind: 'note',
  title: 'Waiting area',
  body: 'We have a lounge with wifi and coffee.',
  question: null,
  wrongReply: null,
  source: 'manual',
  active: false,
  documentId: null,
  reviewedAt: null,
  warnings: [],
  chars: 0,
  sort: 0,
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
  ...o,
})

export const doc = (o: Partial<KnowledgeDocument> & { id: string }): KnowledgeDocument => ({
  filename: 'Ceramic care guide.pdf',
  bytes: 250_000,
  status: 'ready',
  errorCode: null,
  error: null,
  pageCount: 3,
  removedChars: 0,
  entryId: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...o,
})

/** The knowledge API: the budget over active entries plus the Q&A, versions, the review gate, duplicates by sha256. */
export function fakeKnowledge() {
  const calls: any[][] = []
  const fail = new Map<string, Error>()
  const state = {
    entries: [] as KnowledgeEntry[],
    documents: [] as KnowledgeDocument[],
    faqChars: 0,
    maxChars: 20000,
    shas: new Map<string, string>(),
    seq: 0,
    progress: [] as number[],
  }
  const chars = (e: { title: string; question?: string | null; body: string }) =>
    e.title.length + (e.question?.length ?? 0) + e.body.length
  const budget = () => {
    const sum = (k: string) => state.entries.filter((e) => e.active && e.kind === k).reduce((n, e) => n + e.chars, 0)
    const parts = { faq: state.faqChars, notes: sum('note'), documents: sum('document'), corrections: sum('correction') }
    return { usedChars: parts.faq + parts.notes + parts.documents + parts.corrections, maxChars: state.maxChars, parts }
  }
  const over = (add: number) => {
    const b = budget()
    if (b.usedChars + add > b.maxChars)
      throw new ApiError({
        status: 422,
        code: 'KNOWLEDGE_BUDGET',
        title: 'Knowledge is full',
        detail: 'This would go over what Oasis AI can read. Turn something off or shorten it first',
        meta: { usedChars: b.usedChars, maxChars: b.maxChars, needed: b.usedChars + add - b.maxChars },
      })
  }
  const step =
    <A extends unknown[], R>(name: string, fn: (...a: A) => R) =>
    async (...a: A): Promise<R> => {
      calls.push([name, ...clone(a.filter((x) => typeof x !== 'object' || !(x instanceof Blob)))])
      const e = fail.get(name)
      if (e) {
        fail.delete(name)
        throw e
      }
      return fn(...a)
    }
  const api: AssistantKnowledgeApi = {
    get: step('get', (): KnowledgeView => clone({ entries: state.entries, documents: state.documents, budget: budget(), limits: LIMITS }) as any),
    createNote: step('createNote', (b: any) => {
      const e = entry({ id: 'n' + ++state.seq, title: b.title, body: b.body, active: !!b.active })
      e.chars = chars(e)
      if (e.active) over(e.chars)
      state.entries.push(e)
      return clone({ entry: e, budget: budget() })
    }),
    update: step('update', (id: string, b: any) => {
      const e = state.entries.find((x) => x.id === id)
      if (!e) throw new ApiError({ status: 404, code: 'NOT_FOUND', title: 'Not found' })
      if (b.version !== e.version)
        throw new ApiError({ status: 412, code: 'VERSION_CONFLICT', title: 'Changed by someone else', detail: 'Someone saved this a moment ago', meta: { currentVersion: e.version } })
      const next = { ...e, ...(b.title !== undefined ? { title: b.title } : {}), ...(b.body !== undefined ? { body: b.body } : {}), ...(b.question !== undefined ? { question: b.question } : {}) }
      const active = b.active ?? e.active
      if (e.kind === 'document' && active) {
        const reviewed = b.reviewed || (e.reviewedAt && b.body === undefined)
        const needs: string[] = []
        if (!reviewed) needs.push('reviewed')
        if (next.warnings.some((w) => w.kind === 'instruction') && !b.confirmInstructions && (b.body !== undefined || !e.active)) needs.push('confirmInstructions')
        if (needs.length)
          throw new ApiError({ status: 422, code: 'KNOWLEDGE_NEEDS_REVIEW', title: 'Read it first', detail: 'Read the text from the PDF and confirm it before Oasis AI uses it', meta: { needs } })
      }
      const c = chars(next)
      if (active) over(c - (e.active ? e.chars : 0))
      Object.assign(e, next, { active, chars: c, version: e.version + 1, reviewedAt: b.reviewed ? NOW : b.body !== undefined ? null : e.reviewedAt })
      return clone({ entry: e, budget: budget() })
    }),
    remove: step('remove', (id: string) => {
      const e = state.entries.find((x) => x.id === id)
      state.entries = state.entries.filter((x) => x.id !== id)
      if (e?.documentId) state.documents = state.documents.filter((d) => d.id !== e.documentId)
    }),
    presign: step('presign', (b: any) => {
      const dup = state.shas.get(b.sha256)
      if (dup)
        throw new ApiError({ status: 409, code: 'DUPLICATE_DOCUMENT', title: 'Already uploaded', detail: 'This PDF is already in your knowledge', meta: { documentId: dup, entryId: null } })
      const id = 'd' + ++state.seq
      state.shas.set(b.sha256, id)
      state.documents.push(doc({ id, filename: b.filename, bytes: b.bytes, status: 'pending_upload', pageCount: null }))
      return { documentId: id, upload: { key: `kb/loc/${id}.pdf`, url: 'https://bucket.example/up', fields: { key: `kb/loc/${id}.pdf` }, expiresAt: NOW } }
    }),
    upload: async (_slot, _file, o) => {
      calls.push(['upload'])
      for (const p of [0, 45, 100]) {
        state.progress.push(p)
        o?.onProgress?.(p)
      }
      const e = fail.get('upload')
      if (e) {
        fail.delete('upload')
        throw e
      }
    },
    complete: step('complete', (id: string) => {
      const d = state.documents.find((x) => x.id === id)!
      d.status = 'extracting'
      return { status: 'extracting' as const }
    }),
    retry: step('retry', (id: string) => {
      const d = state.documents.find((x) => x.id === id)!
      d.status = 'extracting'
      d.errorCode = null
      d.error = null
      return { status: 'extracting' as const }
    }),
    removeDocument: step('removeDocument', (id: string) => {
      state.documents = state.documents.filter((d) => d.id !== id)
    }),
    file: step('file', (id: string) => ({ url: 'https://bucket.example/' + id + '.pdf?sig', expiresInSeconds: 600 })),
  }
  /** The extraction job finished: the document is ready with one inactive, unreviewed entry. */
  const extracted = (id: string, body: string, warnings: KnowledgeEntry['warnings'] = []) => {
    const d = state.documents.find((x) => x.id === id)!
    d.status = 'ready'
    d.pageCount = 2
    const e = entry({ id: 'e' + ++state.seq, kind: 'document', title: d.filename, body, documentId: id, warnings })
    e.chars = chars(e)
    d.entryId = e.id
    state.entries.push(e)
    return e
  }
  return { api, calls, fail, state, budget, extracted }
}

export const turn = (o: Partial<PracticeTurn> & { id: string }): PracticeTurn => ({
  sessionId: 's1',
  seq: 1,
  rerunOf: null,
  clientText: 'Do you have a waiting room?',
  status: 'replied',
  replyText: 'Yes! Wifi and coffee while you wait. Book here: [booking link]',
  extraTexts: [],
  badges: [{ kind: 'link', label: 'Booking link' }],
  error: null,
  latencyMs: 2100,
  startedAt: NOW,
  finishedAt: NOW,
  ...o,
})

/** The practice API, or 501 everywhere while `built` is false (the contract of this wave). */
export function fakePractice(built = true) {
  const calls: any[][] = []
  const fail = new Map<string, ApiError>()
  const state = {
    practice: { enabled: true, budgetUsd: 3, spentTodayUsd: 0.42, actionsEnabled: true, linksEnabled: true },
    sessions: [] as PracticeList['sessions'],
    turns: new Map<string, PracticeTurn[]>(),
    seq: 0,
    hits: [{ id: 'c1', fullName: 'Priya Nair', phone: '+12015550142' }],
  }
  const step =
    <A extends unknown[], R>(name: string, fn: (...a: A) => R) =>
    async (...a: A): Promise<R> => {
      calls.push([name, ...clone(a)])
      if (!built) throw notBuilt()
      const e = fail.get(name)
      if (e) {
        fail.delete(name)
        throw e
      }
      return fn(...a)
    }
  const api: AssistantPracticeApi = {
    sessions: step('sessions', () => clone({ sessions: state.sessions, practice: state.practice })),
    createSession: step('createSession', (b: any) => {
      const s = {
        id: 's' + ++state.seq,
        persona: b.persona,
        client: b.customerId ? { id: b.customerId, firstName: 'Priya' } : null,
        verified: !!b.verified,
        language: b.language ?? 'en',
        includeEntryIds: [],
        turns: 0,
        costMicros: 0,
        createdAt: NOW,
        updatedAt: NOW,
      }
      state.sessions.unshift(s as any)
      state.turns.set(s.id, [])
      return clone({ session: s as any })
    }),
    session: step('session', (id: string): PracticeDetail => {
      const s = state.sessions.find((x) => x.id === id)
      if (!s) throw new ApiError({ status: 404, code: 'NOT_FOUND', title: 'Not found' })
      return clone({ session: s, turns: state.turns.get(id) ?? [] })
    }),
    deleteSession: step('deleteSession', (id: string) => {
      state.sessions = state.sessions.filter((s) => s.id !== id)
    }),
    sendTurn: step('sendTurn', (id: string, text: string) => {
      const list = state.turns.get(id)!
      if (list.some((t) => t.status === 'running'))
        throw new ApiError({ status: 409, code: 'PRACTICE_BUSY', title: 'Still answering', detail: 'Oasis AI is still answering the last text. Wait a moment' })
      const t = turn({ id: 't' + ++state.seq, sessionId: id, seq: list.length + 1, clientText: text, status: 'running', replyText: null, badges: [], finishedAt: null })
      list.push(t)
      return clone({ turn: t })
    }),
    rerun: step('rerun', (turnId: string) => {
      for (const [sid, list] of state.turns) {
        const t = list.find((x) => x.id === turnId)
        if (t) {
          const r = turn({ id: 'r' + ++state.seq, sessionId: sid, seq: t.seq, rerunOf: t.id, clientText: t.clientText, status: 'running', replyText: null, badges: [] })
          list.push(r)
          return clone({ turn: r })
        }
      }
      throw new ApiError({ status: 404, code: 'NOT_FOUND', title: 'Not found' })
    }),
    findClients: async (q: string) => {
      calls.push(['findClients', q])
      return clone(state.hits.filter((h) => h.fullName.toLowerCase().includes(q.toLowerCase())))
    },
  }
  /** The job finished a turn. */
  const answer = (turnId: string, patch: Partial<PracticeTurn> = {}) => {
    for (const list of state.turns.values()) {
      const t = list.find((x) => x.id === turnId)
      if (t) Object.assign(t, { status: 'replied', replyText: 'Yes! Wifi and coffee. Book here: [booking link]', badges: [{ kind: 'link', label: 'Booking link' }], finishedAt: NOW }, patch)
    }
  }
  return { api, calls, fail, state, answer }
}

/** Corrections and the review of real chats, or 501 while `built` is false. */
export function fakeReview(built = true) {
  const calls: any[][] = []
  const fail = new Map<string, ApiError>()
  const state = {
    conversations: [
      {
        id: 'v1',
        client: { firstName: 'Priya', phoneLast4: '0142' },
        lastTurnAt: NOW,
        turns: 2,
        handoff: { open: true, reason: 'asked_for_person' },
        flags: ['handed_off'],
      },
      { id: 'v2', client: { firstName: null, phoneLast4: '0199' }, lastTurnAt: NOW, turns: 1, handoff: null, flags: ['judge'] },
    ] as ConversationList['conversations'],
    nextCursor: null as string | null,
    detail: {
      conversation: null as any,
      turns: [
        {
          id: 'at1',
          startedAt: NOW,
          status: 'replied',
          clientTexts: ['Do you clean engine bays?'],
          reply: 'Sorry, we don’t do engine bays. Book a wash: [link]',
          handoffReason: null,
          guard: [],
          judge: { verdict: 'pass', category: null, words: '' },
          tools: ['list_services'],
          model: 'sonnet',
          promptVersion: 'p7',
          correctionEntryId: null,
        },
      ] as ConversationDetail['turns'],
    },
    corrections: [] as any[],
  }
  const step =
    <A extends unknown[], R>(name: string, fn: (...a: A) => R) =>
    async (...a: A): Promise<R> => {
      calls.push([name, ...clone(a)])
      if (!built) throw notBuilt()
      const e = fail.get(name)
      if (e) {
        fail.delete(name)
        throw e
      }
      return fn(...a)
    }
  const api: AssistantReviewApi = {
    conversations: step('conversations', (q: any) => {
      const rows = state.conversations.filter((c) => q.filter === 'all' || !q.filter || c.flags.includes(q.filter))
      return clone({ conversations: rows, nextCursor: q.cursor ? null : state.nextCursor })
    }),
    conversation: step('conversation', (id: string) =>
      clone({ conversation: state.conversations.find((c) => c.id === id)!, turns: state.detail.turns }),
    ),
    createCorrection: step('createCorrection', (b: any) => {
      const same = state.corrections.find((c) => c.question.toLowerCase() === b.clientText.toLowerCase())
      if (same && b.replaceEntryId !== same.id)
        throw new ApiError({ status: 409, code: 'CORRECTION_EXISTS', title: 'Already corrected', detail: 'There is already a correction for this question', meta: { entryId: same.id } })
      const e = entry({ id: 'k' + (state.corrections.length + 1), kind: 'correction', title: b.clientText.slice(0, 60), question: b.clientText, body: b.rightAnswer, active: b.active !== false, source: b.source })
      state.corrections = state.corrections.filter((c) => c.id !== b.replaceEntryId)
      state.corrections.push(e)
      return clone({ entry: e, budget: { usedChars: 0, maxChars: 20000, parts: { faq: 0, notes: 0, documents: 0, corrections: 0 } } })
    }),
  }
  return { api, calls, fail, state }
}

/** Manual timers: the test fires what the screen scheduled. */
export function manualTimers(): Timers & { pending(): number; fire(): void } {
  let next = 1
  const due = new Map<number, () => void>()
  return {
    set: (fn) => {
      const id = next++
      due.set(id, fn)
      return id
    },
    clear: (h) => void due.delete(h as number),
    pending: () => due.size,
    fire: () => {
      const all = [...due.entries()]
      due.clear()
      for (const [, fn] of all) fn()
    },
  }
}

export type Role = 'mgmt' | 'crew' | 'super' | 'support' | 'acct'

/** The Settings view model on LiveData with the assistant and its tabs over the fakes. */
export function makeAssistant(
  o: {
    role?: Role
    permissions?: Record<string, { on: boolean }>
    knowledge?: ReturnType<typeof fakeKnowledge>
    practice?: ReturnType<typeof fakePractice>
    review?: ReturnType<typeof fakeReview>
    settings?: ReturnType<typeof fakeSettings>
  } = {},
) {
  const knowledge = o.knowledge ?? fakeKnowledge()
  const practice = o.practice ?? fakePractice()
  const review = o.review ?? fakeReview()
  const settings = o.settings ?? fakeSettings(knowledge)
  const timers = manualTimers()
  const opened: string[] = []
  const f = fakeApi()
  const qc = makeQueryClient()
  qc.setDefaultOptions({ queries: { ...qc.getDefaultOptions().queries, retry: false } })
  const toasts: ToastSpec[] = []
  const session = makeSession({ role: (o.role ?? 'mgmt') as 'mgmt', ...(o.permissions ? { permissions: o.permissions as any } : {}) })
  const ref: { logic?: any } = {}
  const data = new LiveData({
    api: f.api,
    qc,
    session: () => session,
    toast: (t) => {
      toasts.push(t)
      ref.logic?.flash(t.desc ? t.title + ' · ' + t.desc : t.title)
    },
    schedule: (fn) => fn(),
    assistantApi: settings.api,
    assistantAi: { knowledge: knowledge.api, practice: practice.api, review: review.api },
    assistantTimers: timers,
    assistantOpen: (url) => opened.push(url),
  })
  const logic: any = (ref.logic = new (createSettingsLogic(data))({}))
  const render = () => queueMicrotask(() => logic.renderVals())
  logic.__host = {
    __setLogicState(update: any, cb?: () => void) {
      const patch = typeof update === 'function' ? update(logic.state) : update
      logic.state = { ...logic.state, ...patch }
      render()
      cb?.()
    },
    forceUpdate: render,
  }
  logic.componentDidMount()
  return { logic, data, qc, toasts, knowledge, practice, review, settings, timers, opened }
}

export const asst = (logic: any): any => logic.renderVals().live.asst
export const ev = (value = '', key = '', shiftKey = false) => ({ target: { value }, key, shiftKey, preventDefault() {} })

/** Opens the section on a tab and waits for the section's own read. */
export async function openTab(m: ReturnType<typeof makeAssistant>, tab: string, wait: () => boolean = () => true) {
  const { vi, expect } = await import('vitest')
  m.logic.renderVals().live.asst.go()
  await vi.waitFor(() => expect(m.logic.renderVals().live.secAssistant).toBe(true))
  const t = asst(m.logic).tabs.find((x: any) => x.label.toLowerCase().startsWith(tab))
  t.onClick()
  await vi.waitFor(() => expect(wait()).toBe(true))
  return asst(m.logic)
}
