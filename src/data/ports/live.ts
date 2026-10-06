// LiveDataPort: the real API, region by region (paths from backend design section 5). Skeleton status: every region
// below is wired to its endpoint with the DTOs of ./types; the screens switch over one by one (docs/data-layer.md,
// "migration recipe"). Nothing here formats text or computes money; the server does.
import type { ApiClient } from '../http/client'
import { createLivePaymentsPort } from './payments'
import type { DataPort } from './ports'

const enc = encodeURIComponent

export function createLiveDataPort(c: ApiClient): DataPort {
  return {
    kind: 'live',
    catalog: {
      services: () => c.get('/services'),
      saveChecklist: (id, tasks, o) => c.put(`/services/${enc(id)}/checklist`, { tasks }, o),
    },
    hours: {
      hours: () => c.get('/settings/hours'),
      saveHours: (next, o) => c.put('/settings/hours', next, o),
      closures: (range) => c.get('/closures', { query: { from: range?.from, to: range?.to } }),
      previewClosure: (input) => c.post('/closures/preview', input),
      createClosure: (input, o) => c.post('/closures', input, o),
      deleteClosure: (id, o) => c.delete(`/closures/${enc(id)}`, o),
    },
    emergency: {
      current: () => c.get('/emergency'),
      preview: (q) => c.get('/emergency/preview', { query: q }),
      close: (input, o) => c.post('/emergency/close', input, o),
      reopen: (o) => c.post('/emergency/reopen', undefined, o),
    },
    calendar: {
      summary: (from, to) => c.get('/calendar/summary', { query: { from, to } }),
      day: (date) => c.get('/calendar/day', { query: { date } }),
    },
    availability: {
      slots: (q) =>
        c.get('/availability', {
          query: { date: q.date, serviceId: q.serviceId, addonIds: q.addonIds?.join(',') },
        }),
    },
    ops: {
      snapshot: (q) => c.get('/ops/snapshot', { query: { window: q.window, q: q.q } }),
      appointment: (id) => c.get(`/appointments/${enc(id)}`),
      advance: (id, input, o) => c.post(`/appointments/${enc(id)}/advance`, input, o),
      assignBay: (id, bayId, o) => c.post(`/appointments/${enc(id)}/assign-bay`, { bayId }, o),
      toggleChecklistItem: (id, itemId, done, o) =>
        c.put(`/appointments/${enc(id)}/checklist/items/${enc(itemId)}`, { done }, o),
      toggleAddon: (id, serviceId, on, o) =>
        on
          ? c.put(`/appointments/${enc(id)}/addons/${enc(serviceId)}`, undefined, o)
          : c.delete(`/appointments/${enc(id)}/addons/${enc(serviceId)}`, o),
      reschedule: (id, input, o) => c.post(`/appointments/${enc(id)}/reschedule`, input, o),
    },
    messages: {
      thread: (id) => c.get(`/appointments/${enc(id)}/messages`),
      send: (id, input, o) => c.post(`/appointments/${enc(id)}/messages`, input, o),
    },
    payments: createLivePaymentsPort(c),
    people: {
      employees: (q) => c.get('/employees', { query: { q: q?.q, role: q?.role } }),
      roles: () => c.get('/roles'),
      setRolePermission: (roleId, key, granted, o) =>
        c.put(`/roles/${enc(roleId)}/permissions/${enc(key)}`, { granted }, o),
      setRoleLimit: (roleId, kind, value, o) =>
        c.put(`/roles/${enc(roleId)}/limits/${enc(kind)}`, { value }, o),
    },
  }
}
