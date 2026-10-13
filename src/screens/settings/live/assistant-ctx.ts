// What the tabs of Settings → Oasis AI share (ADR 0174, design §9): the context each tab works in (reads through the
// screen's query store, the permission check, the toast, re-render, the shop's time zone, timers), one write wrapper whose
// form errors stay in the form, the "coming soon" answer of the contract routes (501 NOT_BUILT until wave K2c), and the
// few styles the design has no class for (built from its primitives: panel cards, inputs, the accent button).
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { command } from '@/data/command'
import type { CommandResult } from '@/data/command'
import { ApiError } from '@/data/http/problem'
import type { ToastSpec } from '@/data/toast'

export type Vals = Record<string, unknown>
export type Style = Record<string, string | number>
export type InputEvent = { target: { value: string } }
export type KeyEvent = { key: string; shiftKey?: boolean; preventDefault(): void }
export type FileEvent = { target: { files?: ArrayLike<File> | null; value: string } }

export type ReadState = 'pending' | 'error' | 'success'

export interface Timers {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

export const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

export interface AiCtx {
  qc: QueryClient
  /** The query under ['settings', ...key], fetched when missing and watched while the screen is open. */
  read<T>(key: readonly unknown[], fetcher: () => Promise<T>): T | undefined
  status(key: readonly unknown[]): ReadState
  error(key: readonly unknown[]): unknown
  can(key: string): boolean
  emit(t: ToastSpec): void
  changed(): void
  tz(): string
  timers: Timers
  /** Opens a download (a presigned GET that saves the file). */
  open(url: string): void
}

export const settingsKey = (...key: unknown[]): QueryKey => ['settings', ...key]

/** A contract route of this wave: 501 NOT_BUILT until the practice wave builds it. */
export const isNotBuilt = (e: unknown): boolean =>
  e instanceof ApiError && (e.status === 501 || e.code === 'NOT_BUILT')

export const COMING_SOON = 'Coming soon: this part of Oasis AI is not built yet. Everything else here works.'

export interface RunSpec<T> {
  key: QueryKey
  invalidate?: QueryKey[]
  request: (idem: string) => Promise<T>
  idempotencyKey?: string
  denyLabel: string
  ok?: (d: T) => ToastSpec | void
  /** Errors the form shows itself (no toast); the default keeps 409, 412, 422, 429 and 501 in the form. */
  inline?: (e: ApiError) => boolean
}

const inlineDefault = (e: ApiError): boolean =>
  e.status === 409 || e.status === 412 || e.status === 422 || e.status === 429 || isNotBuilt(e)

/** One write: command() with its idempotency, refetches and 403 wording, the form's own errors kept out of the toast. */
export async function run<T>(ctx: AiCtx, s: RunSpec<T>): Promise<CommandResult<T>> {
  let handled = false
  const inline = s.inline ?? inlineDefault
  return command<T>({
    key: s.key,
    queryClient: ctx.qc,
    request: s.request,
    ...(s.idempotencyKey ? { idempotencyKey: s.idempotencyKey } : {}),
    ...(s.invalidate ? { invalidate: s.invalidate } : {}),
    denyLabel: s.denyLabel,
    onOk: s.ok,
    onFail: (e) => {
      handled = inline(e)
      return undefined
    },
    toast: (t) => {
      if (!handled) ctx.emit(t)
    },
  })
}

/** The server's words for a refusal the form shows. */
export const problemText = (e: ApiError): string =>
  isNotBuilt(e) ? COMING_SOON : e.detail ? (/[.!?]$/.test(e.detail) ? e.detail : e.detail + '.') : e.title

// ---- styles built from the design's primitives -----------------------------------------------------------------------------

export const ERR = '#C2410C'

export const inputStyle = (bad = false): Style => ({
  width: '100%',
  minWidth: 0,
  height: '44px',
  padding: '0 14px',
  borderRadius: '11px',
  border: '1px solid ' + (bad ? ERR : 'var(--line)'),
  background: 'var(--panel)',
  color: 'var(--ink)',
  fontFamily: 'inherit',
  fontSize: '14px',
  fontWeight: 600,
})

export const textareaStyle = (bad = false, rows = 6): Style => ({
  width: '100%',
  minHeight: rows * 22 + 24 + 'px',
  padding: '12px 14px',
  borderRadius: '12px',
  border: '1px solid ' + (bad ? ERR : 'var(--line)'),
  background: 'var(--panel)',
  color: 'var(--ink)',
  fontFamily: 'inherit',
  fontSize: '13.5px',
  fontWeight: 600,
  lineHeight: 1.5,
  resize: 'vertical',
})

export const primaryStyle = (on = true): Style => ({
  height: '44px',
  padding: '0 16px',
  borderRadius: '11px',
  background: on ? 'var(--accent)' : 'var(--panel3)',
  color: on ? '#fff' : 'var(--ink3)',
  fontWeight: 800,
  fontSize: '13px',
  flex: 'none',
})

export const ghostStyle = (danger = false): Style => ({
  height: '40px',
  padding: '0 14px',
  borderRadius: '10px',
  background: 'var(--panel)',
  border: '1px solid var(--line)',
  fontWeight: 700,
  fontSize: '12.5px',
  color: danger ? ERR : 'var(--ink2)',
  flex: 'none',
})

export const bannerStyle = (tone: 'amber' | 'neutral' | 'accent' | 'red'): Style => ({
  padding: '12px 16px',
  borderRadius: '14px',
  marginBottom: '14px',
  fontSize: '13px',
  fontWeight: 700,
  lineHeight: 1.45,
  background:
    tone === 'amber'
      ? 'rgba(217,119,6,.10)'
      : tone === 'red'
        ? 'rgba(194,65,12,.10)'
        : tone === 'accent'
          ? 'var(--accentSoft)'
          : 'var(--panel2)',
  border:
    '1px solid ' +
    (tone === 'amber'
      ? 'rgba(217,119,6,.35)'
      : tone === 'red'
        ? 'rgba(194,65,12,.35)'
        : tone === 'accent'
          ? 'var(--accentBrd)'
          : 'var(--line)'),
  color:
    tone === 'amber' ? '#B45309' : tone === 'red' ? ERR : tone === 'accent' ? 'var(--accentInk)' : 'var(--ink2)',
})

export const listRowStyle = (on: boolean): Style => ({
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  width: '100%',
  padding: '10px 12px',
  borderRadius: '12px',
  textAlign: 'left',
  background: on ? 'var(--accentSoft)' : 'transparent',
  border: '1px solid ' + (on ? 'var(--accentBrd)' : 'transparent'),
  color: 'var(--ink)',
})

export const countStyle = (over: boolean): Style => ({
  marginLeft: 'auto',
  fontSize: '11.5px',
  fontWeight: 700,
  color: over ? ERR : 'var(--ink3)',
  whiteSpace: 'nowrap',
})

export const warnStyle = (tone: 'red' | 'amber'): Style => ({
  fontSize: '12.5px',
  fontWeight: 700,
  lineHeight: 1.45,
  color: tone === 'red' ? ERR : '#B45309',
})

export const fmt = (n: number): string => n.toLocaleString('en-US')
