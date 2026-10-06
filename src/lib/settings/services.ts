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

/** The checklist edits of the task editor, on the label list. */
export const taskOps = {
  add: (tasks: string[], label: string): string[] => [...tasks, label],
  edit: (tasks: string[], i: number, label: string): string[] => {
    const t = [...tasks]
    t[i] = label
    return t
  },
  up: (tasks: string[], i: number): string[] => {
    const t = [...tasks]
    if (i > 0) [t[i - 1], t[i]] = [t[i]!, t[i - 1]!]
    return t
  },
  down: (tasks: string[], i: number): string[] => {
    const t = [...tasks]
    if (i < t.length - 1) [t[i + 1], t[i]] = [t[i]!, t[i + 1]!]
    return t
  },
  remove: (tasks: string[], i: number): string[] => tasks.filter((_, j) => j !== i),
}
