// Packages and add-ons: the meta line and the checklist edits.
import type { Addon, Package, SvcKind } from './types'

export const packageMeta = (item: Package): string =>
  '$' + item.price + ' · ' + item.dur + ' min · ' + item.tasks.length + ' tasks'

export const addonMeta = (item: Addon): string => '+$' + item.price + ' · ' + item.tasks.length + ' tasks'

export const SERVICE_NOTE: Record<SvcKind, string> = {
  pkg: 'Every job booked with this package starts with these tasks. Selected add-ons append their own tasks underneath.',
  addon:
    'When this add-on is on a job — booked, approved in the app, or added at the desk — these tasks are appended to the job checklist.',
}

/** One edit of the checklist editor. */
export type TaskOp =
  | { kind: 'add'; label: string }
  | { kind: 'edit'; i: number; label: string }
  | { kind: 'up'; i: number }
  | { kind: 'down'; i: number }
  | { kind: 'remove'; i: number }

/** The edit applied to the list of labels the editor shows (a copy; the design's own array logic). */
export function applyTaskOp(tasks: string[], op: TaskOp): string[] {
  const t = [...tasks]
  switch (op.kind) {
    case 'add':
      return [...t, op.label]
    case 'edit':
      t[op.i] = op.label
      return t
    case 'up':
      if (op.i > 0) [t[op.i - 1], t[op.i]] = [t[op.i]!, t[op.i - 1]!]
      return t
    case 'down':
      if (op.i < t.length - 1) [t[op.i + 1], t[op.i]] = [t[op.i]!, t[op.i + 1]!]
      return t
    case 'remove':
      return t.filter((_, j) => j !== op.i)
  }
}

/** The same edit on a list that runs alongside the labels (task ids; a new task has none yet). */
export function followTaskOp<T>(list: T[], op: TaskOp, fresh: T): T[] {
  switch (op.kind) {
    case 'add':
      return [...list, fresh]
    case 'edit':
      return [...list]
    default:
      return applyTaskOp(list as unknown as string[], op) as unknown as T[]
  }
}
