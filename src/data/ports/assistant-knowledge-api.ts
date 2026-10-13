// Settings → Oasis AI → Knowledge over the API (backend api-spec 15.6c, 15.6d; ADR 0174 §1, §2): the entries (notes, the
// reviewed text of PDFs, corrections), the shared budget, and the PDF upload (presign, the upload itself, complete, read
// again, delete, download). Types from the full generated schema (src/data/http/schema.d.ts).
//
// The upload goes straight to the presigned POST (S3, or the dev store), like a photo, but with XMLHttpRequest: fetch has no
// upload progress, and the owner sees "Uploading 45%".
import type { ApiClient, RequestOptions } from '../http/client'
import type { operations } from '../http/schema'

type JsonBody<R> = R extends { content: { 'application/json': infer B } } ? B : never
type Res<Op, S extends number> = Op extends { responses: { [K in S]: infer R } } ? JsonBody<R> : never
type Req<Op> = Op extends { requestBody: { content: { 'application/json': infer B } } } ? B : never

export type KnowledgeView = Res<operations['getAssistantKnowledge'], 200>
export type KnowledgeEntry = KnowledgeView['entries'][number]
export type KnowledgeDocument = KnowledgeView['documents'][number]
export type KnowledgeBudget = KnowledgeView['budget']
export type KnowledgeLimits = KnowledgeView['limits']
export type KnowledgeWarning = KnowledgeEntry['warnings'][number]
export type NoteCreate = Req<operations['createAssistantKnowledgeNote']>
export type EntryUpdate = Req<operations['putAssistantKnowledge']>
export type EntrySaved = Res<operations['putAssistantKnowledge'], 200>
export type PresignReq = Req<operations['presignAssistantKnowledgeDocument']>
export type Presigned = Res<operations['presignAssistantKnowledgeDocument'], 201>
export type UploadSlot = Presigned['upload']
export type Completed =
  | Res<operations['completeAssistantKnowledgeDocument'], 200>
  | Res<operations['completeAssistantKnowledgeDocument'], 202>
export type FileLink = Res<operations['getAssistantKnowledgeDocumentFile'], 200>

type Opts = Pick<RequestOptions, 'idempotencyKey' | 'signal'>

/** An upload refused by the store or cut by the network, in words for the owner. */
export class UploadError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'UploadError'
  }
}

/** The parts of XMLHttpRequest the upload uses (tests pass a fake). */
export interface XhrLike {
  open(method: string, url: string): void
  send(body: FormData): void
  abort(): void
  status: number
  responseText: string
  upload: { onprogress: ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null }
  onload: (() => void) | null
  onerror: (() => void) | null
  onabort: (() => void) | null
}

export interface UploadOptions {
  /** Whole percent 0..100 as the bytes go out. */
  onProgress?: (percent: number) => void
  signal?: AbortSignal
}

export interface AssistantKnowledgeApi {
  get(): Promise<KnowledgeView>
  createNote(body: NoteCreate, o?: Opts): Promise<EntrySaved>
  /** `version` is required (412 VERSION_CONFLICT when someone saved since). */
  update(id: string, body: EntryUpdate, o?: Opts): Promise<EntrySaved>
  remove(id: string, o?: Opts): Promise<void>
  /** 409 DUPLICATE_DOCUMENT {documentId, entryId} when the same file is already in the knowledge. */
  presign(body: PresignReq, o?: Opts): Promise<Presigned>
  upload(slot: UploadSlot, file: Blob, o?: UploadOptions): Promise<void>
  complete(documentId: string, o?: Opts): Promise<Completed>
  retry(documentId: string, o?: Opts): Promise<unknown>
  removeDocument(documentId: string, o?: Opts): Promise<void>
  file(documentId: string): Promise<FileLink>
}

const enc = encodeURIComponent

/** POST the presigned fields, then the file (S3 ignores everything after `file`), reporting progress. */
export function xhrUpload(
  slot: UploadSlot,
  file: Blob,
  o: UploadOptions = {},
  makeXhr: () => XhrLike = () => new XMLHttpRequest() as unknown as XhrLike,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    for (const [k, v] of Object.entries(slot.fields)) form.append(k, v)
    form.append('file', file)
    const xhr = makeXhr()
    let last = -1
    const progress = (p: number): void => {
      const pct = Math.max(0, Math.min(100, Math.floor(p)))
      if (pct !== last) {
        last = pct
        o.onProgress?.(pct)
      }
    }
    const onAbort = (): void => xhr.abort()
    const done = (): void => o.signal?.removeEventListener('abort', onAbort)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) progress((e.loaded / e.total) * 100)
    }
    xhr.onload = () => {
      done()
      if (xhr.status >= 200 && xhr.status < 300) {
        progress(100)
        return resolve()
      }
      let code = 'UPLOAD_FAILED'
      let message = 'The PDF could not be uploaded. Try again.'
      try {
        const j = JSON.parse(xhr.responseText) as { error?: { code?: string; message?: string } }
        if (j.error?.message) message = j.error.message
        if (j.error?.code) code = j.error.code
      } catch {
        // S3 answers XML; the plain message stands
      }
      reject(new UploadError(xhr.status, code, message))
    }
    xhr.onerror = () => {
      done()
      reject(new UploadError(0, 'NETWORK', 'The PDF could not be uploaded. Check your connection and try again.'))
    }
    xhr.onabort = () => {
      done()
      reject(new UploadError(0, 'ABORTED', 'The upload was stopped.'))
    }
    if (o.signal?.aborted) {
      reject(new UploadError(0, 'ABORTED', 'The upload was stopped.'))
      return
    }
    o.signal?.addEventListener('abort', onAbort)
    xhr.open('POST', slot.url)
    progress(0)
    xhr.send(form)
  })
}

export function createAssistantKnowledgeApi(
  c: ApiClient,
  makeXhr?: () => XhrLike,
): AssistantKnowledgeApi {
  const base = '/assistant/knowledge'
  return {
    get: () => c.get(base),
    createNote: (body, o) => c.post(base, body, o),
    update: (id, body, o) => c.put(`${base}/${enc(id)}`, body, o),
    remove: (id, o) => c.delete(`${base}/${enc(id)}`, o),
    presign: (body, o) => c.post(`${base}/documents/presign`, body, o),
    upload: (slot, file, o) => xhrUpload(slot, file, o, makeXhr),
    complete: (id, o) => c.post(`${base}/documents/${enc(id)}/complete`, undefined, o),
    retry: (id, o) => c.post(`${base}/documents/${enc(id)}/extract`, undefined, o),
    removeDocument: (id, o) => c.delete(`${base}/documents/${enc(id)}`, o),
    file: (id) => c.get(`${base}/documents/${enc(id)}/file`),
  }
}
