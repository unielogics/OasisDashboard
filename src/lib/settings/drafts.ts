// Drafts of the live-only Settings sections (Catalog, Categories, Reminders & texts) that stay right when someone else
// saves meanwhile. A draft remembers the server copy it started from (its base and version). When the event stream
// brings a newer copy, the draft is rebased on it: what this person did not touch follows the newer copy, what they
// changed stays; a field both changed is a conflict (the person's value stays on screen and the form says so, so Save
// keeps it knowingly and Discard takes theirs). A save always sends
// the version the draft was last rebased on, so a save made before the newer copy arrived is refused (412) instead of
// quietly undoing the other person's change. Pure apart from the small map in DraftSet; no clock, no API.

export interface Tracked<T> {
  /** The server copy the draft is based on, in the draft's shape. */
  base: T
  /** That copy's version: what a save sends. */
  version: number
  /** What is on screen. */
  value: T
}

const isMap = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)

/** Leaves compare as JSON; a missing map entry is the same as an empty one ('' prep line, no tint row). */
const sameLeaf = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? '') === JSON.stringify(b ?? '')

function merge(base: unknown, mine: unknown, theirs: unknown, conflicts: string[], path: string): unknown {
  const maps = [base, mine, theirs].filter((x) => x !== undefined)
  if (maps.length && maps.every(isMap)) {
    const b = (base ?? {}) as Record<string, unknown>
    const m = (mine ?? {}) as Record<string, unknown>
    const t = (theirs ?? {}) as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of new Set([...Object.keys(t), ...Object.keys(m), ...Object.keys(b)])) {
      const v = merge(b[k], m[k], t[k], conflicts, path ? path + '.' + k : k)
      if (v !== undefined) out[k] = v
    }
    return out
  }
  if (sameLeaf(mine, base)) return theirs
  if (sameLeaf(theirs, base) || sameLeaf(theirs, mine)) return mine
  conflicts.push(path)
  return mine
}

/**
 * The draft rebased on a newer server copy: untouched fields take the server's values, changed ones stay. `conflicts`
 * names the fields both sides changed to different values (the draft keeps the person's value there).
 */
export function rebase<T>(t: Tracked<T>, server: T, version: number): { tracked: Tracked<T>; conflicts: string[] } {
  if (version === t.version) return { tracked: t, conflicts: [] }
  const conflicts: string[] = []
  const value = merge(t.base, t.value, server, conflicts, '') as T
  return { tracked: { base: server, version, value }, conflicts }
}

export interface DraftEntry<T> extends Tracked<T> {
  /** A newer copy changed a field this person changed too: the form says so until Save or Discard. */
  conflict: boolean
}

/** The drafts of one form kind by id (a service, a plan, a category, the tint table, the reminders). */
export class DraftSet<T> {
  private readonly m = new Map<string, DraftEntry<T>>()
  constructor(private readonly same: (a: T, b: T) => boolean = (a, b) => JSON.stringify(a) === JSON.stringify(b)) {}

  /** The unsaved draft of `id` on the server's current copy, or undefined when there is nothing unsaved. */
  get(id: string, server: T, version: number): DraftEntry<T> | undefined {
    const cur = this.m.get(id)
    if (!cur || cur.version === version) return cur
    const r = rebase(cur, server, version)
    if (this.same(r.tracked.value, server)) {
      this.m.delete(id)
      return undefined
    }
    const next = { ...r.tracked, conflict: cur.conflict || r.conflicts.length > 0 }
    this.m.set(id, next)
    return next
  }

  /** What the form shows: the draft, or the server's copy. */
  value(id: string, server: T, version: number): T {
    return this.get(id, server, version)?.value ?? server
  }

  /** The person changed the form: the draft is now `next`, based on the server's current copy (none when equal). */
  set(id: string, server: T, version: number, next: T): void {
    const cur = this.get(id, server, version)
    if (this.same(next, server)) this.m.delete(id)
    else this.m.set(id, { base: server, version, value: next, conflict: cur?.conflict ?? false })
  }

  has(id: string): boolean {
    return this.m.has(id)
  }

  drop(id: string): void {
    this.m.delete(id)
  }
}

/** What a form says when a newer copy changed a field the person changed too. */
export const CONFLICT_MESSAGE =
  'Someone else changed this too meanwhile. Their other changes are on screen; where you both changed the same thing, yours is shown. Save keeps yours, Discard shows theirs.'

/** What a form says when the server refused a save made on an older copy (412). */
export const STALE_DRAFT_MESSAGE =
  'Someone else saved a change meanwhile, so nothing was saved. Their change is on screen now with your edits kept: check and save again.'

/** What an immediate action (on/off, order, remove) says when it was made on an older copy (412). */
export const STALE_ACTION_MESSAGE = 'Someone else changed this meanwhile. The screen shows their change now: try again.'
