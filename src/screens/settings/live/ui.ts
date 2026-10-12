// What the live-only Settings sections (live/extras.ts, live/pricing.ts, live/memberships.ts) share: the context a section
// works in (its API, the write wrapper, the permission check, the toast and re-render), the inline error rules and the
// few styles the design has no class for. Built from the design's primitives (accent button, panel inputs, swatches).
import type { SectionKey } from '@/lib/settings/types'
import type { SettingsApi } from '@/data/ports/settings-api'
import type { ApiError } from '@/data/http/problem'
import type { QueryKey } from '@tanstack/react-query'
import { CONFLICT_MESSAGE, STALE_DRAFT_MESSAGE } from '@/lib/settings/drafts'
import type { DraftEntry } from '@/lib/settings/drafts'

export type Vals = Record<string, unknown>
export type InputEvent = { target: { value: string } }
export type KeyEvent = { key: string }
export type Style = Record<string, string | number>

export type RunResult<T> = { ok: true; data: T } | { ok: false; message: string }

export interface RunOptions {
  /** Further queries to refetch after the write. */
  invalidate?: QueryKey[]
  /** What a 412 says (the draft was made on an older copy). */
  staleMessage?: string
  /** A refusal in the section's own words (409 with counts, 412 naming a row); null falls back to the rules. */
  explain?: (e: ApiError) => string | null
}

/** What a section needs from SettingsExtras: one write wrapper, the permission, the busy flags, toast and re-render. */
export interface SectionCtx {
  api: SettingsApi
  /** A write under `name` (a second one while it runs does nothing); refetches GET /catalog afterwards. */
  run<T>(name: string, request: (idem: string) => Promise<T>, o?: RunOptions): Promise<RunResult<T>>
  /** set.services, or the "Your role can’t …" toast and false. */
  allowed(): boolean
  busy(name: string): boolean
  changed(): void
  flash(text: string): void
  go(k: SectionKey): void
}

/** The form's message: the refusal, or that someone else changed a field this person changed too. */
export function formError(err: string, entry: DraftEntry<unknown> | undefined): string {
  if (entry?.conflict && (!err || err === STALE_DRAFT_MESSAGE)) return CONFLICT_MESSAGE
  return err
}

/** The design's accent button; dimmed while there is nothing to save. */
export function saveButtonStyle(on: boolean): Style {
  return {
    height: '44px',
    padding: '0 18px',
    borderRadius: '11px',
    background: on ? 'var(--accent)' : 'var(--panel3)',
    color: on ? '#fff' : 'var(--ink3)',
    fontWeight: 800,
    fontSize: '13px',
    flex: 'none',
  }
}

export function swatchButtonStyle(hex: string, on: boolean): Style {
  return {
    width: '28px',
    height: '28px',
    borderRadius: '8px',
    background: hex,
    border: on ? '2px solid var(--ink)' : '2px solid var(--panel)',
    boxShadow: on ? '0 0 0 1px var(--panel)' : '0 0 0 1px var(--line)',
    flex: 'none',
  }
}

/** A price box of a grid: the design's input, tinted while changed, amber while someone else changed it too. */
export function cellInputStyle(changed: boolean, conflict = false): Style {
  return {
    width: '100%',
    minWidth: 0,
    height: '42px',
    padding: '0 10px',
    borderRadius: '10px',
    border: '1px solid ' + (conflict ? '#C2410C' : changed ? 'var(--accentBrd)' : 'var(--line)'),
    background: changed ? 'var(--accentSoft)' : 'var(--panel)',
    color: 'var(--ink)',
    fontFamily: 'inherit',
    fontSize: '13.5px',
    fontWeight: 700,
    textAlign: 'right',
  }
}

/** The columns of a grid: the name column, then one per size. */
export function gridColumns(n: number, first = 'minmax(170px,1.5fr)', cell = 'minmax(84px,1fr)'): Style {
  return {
    display: 'grid',
    gridTemplateColumns: first + (n ? ' repeat(' + n + ',' + cell + ')' : ''),
    gap: '8px',
    alignItems: 'center',
  }
}

/** A row of a grid; the one opened from Catalog ("Edit prices") is outlined. */
export function gridRowStyle(n: number, focused: boolean): Style {
  return {
    ...gridColumns(n),
    padding: '6px 8px',
    margin: '0 -8px',
    borderRadius: '12px',
    background: focused ? 'var(--accentSoft)' : 'transparent',
    border: '1px solid ' + (focused ? 'var(--accentBrd)' : 'transparent'),
  }
}
