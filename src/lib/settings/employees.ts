// Employees: the list filter, the new-employee template, the drawer's validation.
import { roleNameOf } from './perms'
import type { Draft, Employee, RolesConfig } from './types'

/** Search matches first, last, phone, title and role names (not email); the role filter is an id or "all". */
export function visibleEmployees(
  employees: Employee[],
  rc: RolesConfig,
  roleFilter: string,
  query: string,
): { e: Employee; i: number }[] {
  const q = query.trim().toLowerCase()
  return employees
    .map((e, i) => ({ e, i }))
    .filter(
      ({ e }) =>
        (roleFilter === 'all' || e.roles.includes(roleFilter)) &&
        (!q ||
          [e.first, e.last, e.phone, e.title, ...e.roles.map((r) => roleNameOf(rc, r))]
            .join(' ')
            .toLowerCase()
            .includes(q)),
    )
}

/** The blank employee the drawer starts from ("Add employee"). `crewId` is the default role. */
export function blankDraft(crewId: string): Draft {
  return {
    id: null,
    first: '',
    last: '',
    title: '',
    phone: '',
    email: '',
    roles: [crewId],
    status: 'invited',
    type: 'Full-time',
    payType: 'Hourly',
    rate: '',
    skills: [],
    sched: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ on: d > 0 && d < 6, from: '8:00 AM', to: '6:00 PM' })),
    overrides: {},
  }
}

/** The design's drawer validation: null when the draft can be saved, else the message and the tab to jump to. */
export function validateDraft(d: Draft): { error: string; tab: 'profile' | 'access' } | null {
  if (!d.first.trim() || !d.phone.trim())
    return { error: 'First name and mobile number are required.', tab: 'profile' }
  if (!d.roles.length) return { error: 'Assign at least one role.', tab: 'access' }
  return null
}

export const initialsOf = (first: string, last: string): string => (first[0] || '') + (last[0] || '')

export const statusLabel = (st: Employee['status']): string =>
  st === 'active' ? 'Active' : st === 'invited' ? 'Invite sent' : 'Inactive'

export const rateHint = (payType: Draft['payType']): string =>
  payType === 'Hourly' ? '$ / hour' : payType === 'Commission' ? '% per job' : '$ / year'
