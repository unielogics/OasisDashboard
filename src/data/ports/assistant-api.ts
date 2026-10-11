// Settings → Oasis AI assistant over the API (backend api-spec 15.6b, ADR 0160): GET and PUT /settings/assistant, one
// version for the six assistant.* settings (ETag), typed from the full generated schema (src/data/http/schema.d.ts).
import type { ApiClient, RequestOptions } from '../http/client'
import type { operations } from '../http/schema'

type JsonBody<R> = R extends { content: { 'application/json': infer B } } ? B : never
type Ok<Op> = Op extends { responses: { 200: infer R } } ? JsonBody<R> : never
type Req<Op> = Op extends { requestBody: { content: { 'application/json': infer B } } } ? B : never

export type AssistantView = Ok<operations['getSettingsAssistant']>
export type AssistantSaveReq = Req<operations['putSettingsAssistant']>
export type AssistantSaved = Ok<operations['putSettingsAssistant']>

type Opts = Pick<RequestOptions, 'idempotencyKey' | 'signal'>

export interface AssistantApi {
  get(): Promise<AssistantView>
  /** Only the changed fields plus the version the edit started from (412 VERSION_CONFLICT when someone saved since). */
  save(body: AssistantSaveReq, o?: Opts): Promise<AssistantSaved>
}

export function createAssistantApi(c: ApiClient): AssistantApi {
  return {
    get: () => c.get('/settings/assistant'),
    save: (body, o) => c.put('/settings/assistant', body, o),
  }
}
