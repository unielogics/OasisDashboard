// Settings → Oasis AI → Practice, corrections and the review of real chats over the API (backend api-spec 15.6e, 15.6f; ADR
// 0174 §4, §5). The backend of this wave answers these routes 501 NOT_BUILT (their schemas are final): the tabs are built
// against the contract and say "coming soon" until wave K2c builds them. Types from the full generated schema.
import type { ApiClient, RequestOptions } from '../http/client'
import type { operations } from '../http/schema'

type JsonBody<R> = R extends { content: { 'application/json': infer B } } ? B : never
type Res<Op, S extends number> = Op extends { responses: { [K in S]: infer R } } ? JsonBody<R> : never
type Req<Op> = Op extends { requestBody: { content: { 'application/json': infer B } } } ? B : never
type Query<Op> = Op extends { parameters: { query?: infer Q } } ? NonNullable<Q> : never

export type PracticeList = Res<operations['listAssistantPracticeSessions'], 200>
export type PracticeSession = PracticeList['sessions'][number]
export type PracticeServer = PracticeList['practice']
export type PracticeSessionCreate = Req<operations['createAssistantPracticeSession']>
export type PracticeDetail = Res<operations['getAssistantPracticeSession'], 200>
export type PracticeTurn = PracticeDetail['turns'][number]
export type PracticeBadge = PracticeTurn['badges'][number]

export type ConversationList = Res<operations['listAssistantConversations'], 200>
export type ConversationSummary = ConversationList['conversations'][number]
export type ConversationQuery = Query<operations['listAssistantConversations']>
export type ConversationDetail = Res<operations['getAssistantConversation'], 200>
export type ConversationTurn = ConversationDetail['turns'][number]

export type CorrectionCreate = Req<operations['createAssistantCorrection']>
export type CorrectionSaved = Res<operations['createAssistantCorrection'], 201>

/** A client found by name or number, for "A client on file" (GET /customers, cli.view). */
export interface ClientHit {
  id: string
  fullName: string
  phone: string | null
}

type Opts = Pick<RequestOptions, 'idempotencyKey' | 'signal'>

export interface AssistantPracticeApi {
  sessions(): Promise<PracticeList>
  createSession(body: PracticeSessionCreate, o?: Opts): Promise<{ session: PracticeSession }>
  session(id: string): Promise<PracticeDetail>
  deleteSession(id: string, o?: Opts): Promise<void>
  /** 202 {turn} (running); 409 PRACTICE_BUSY / PRACTICE_OFF, 429 PRACTICE_BUDGET. Idempotency-Key required. */
  sendTurn(sessionId: string, text: string, o?: Opts): Promise<{ turn: PracticeTurn }>
  /** "Try again" after a correction: the same client text over the session's earlier turns (rerunOf set). */
  rerun(turnId: string, o?: Opts): Promise<{ turn: PracticeTurn }>
  findClients(q: string): Promise<ClientHit[]>
}

export interface AssistantReviewApi {
  conversations(q: ConversationQuery): Promise<ConversationList>
  conversation(id: string): Promise<ConversationDetail>
  /** 409 CORRECTION_EXISTS {entryId} for the same question unless replaceEntryId names it; 422 KNOWLEDGE_BUDGET. */
  createCorrection(body: CorrectionCreate, o?: Opts): Promise<CorrectionSaved>
}

const enc = encodeURIComponent

export function createAssistantPracticeApi(c: ApiClient): AssistantPracticeApi {
  const base = '/assistant/practice'
  return {
    sessions: () => c.get(`${base}/sessions`),
    createSession: (body, o) => c.post(`${base}/sessions`, body, o),
    session: (id) => c.get(`${base}/sessions/${enc(id)}`),
    deleteSession: (id, o) => c.delete(`${base}/sessions/${enc(id)}`, o),
    sendTurn: (id, text, o) => c.post(`${base}/sessions/${enc(id)}/turns`, { text }, o),
    rerun: (turnId, o) => c.post(`${base}/turns/${enc(turnId)}/rerun`, undefined, o),
    findClients: async (q) => {
      const r = await c.get<{ items: ClientHit[] }>('/customers', { query: { q, limit: 8 } })
      return r.items.map((x) => ({ id: x.id, fullName: x.fullName, phone: x.phone }))
    },
  }
}

export function createAssistantReviewApi(c: ApiClient): AssistantReviewApi {
  return {
    conversations: (q) => c.get('/assistant/conversations', { query: { ...q } }),
    conversation: (id) => c.get(`/assistant/conversations/${enc(id)}`),
    createCorrection: (body, o) => c.post('/assistant/corrections', body, o),
  }
}
