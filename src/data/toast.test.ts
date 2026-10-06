import { describe, expect, it, vi } from 'vitest'
import { ApiError } from './http/problem'
import { ToastBus, toastForError, toastText } from './toast'

const err = (status: number, code: string, title: string, detail = '', meta: Record<string, unknown> = {}) =>
  new ApiError({ status, code, title, detail, meta })

describe('toastForError', () => {
  it('shows the server title and detail unchanged for guard failures (they are the design strings)', () => {
    expect(
      toastForError(
        err(409, 'SLOT_UNAVAILABLE', 'Slot unavailable', 'Would overbook a bay — override required'),
      ),
    ).toEqual({
      title: 'Slot unavailable',
      desc: 'Would overbook a bay — override required',
    })
    expect(toastForError(err(422, 'OVER_LIMIT', 'Over your limit'))).toEqual({ title: 'Over your limit' })
  })
  it('403 FORBIDDEN becomes "Your role can’t …" with the permission the server named', () => {
    expect(
      toastForError(
        err(403, 'FORBIDDEN', 'Not allowed', "You don't have permission to do that", {
          required: 'pay.refund',
        }),
      ),
    ).toEqual({ title: 'Your role can’t issue refunds' })
    expect(
      toastForError(err(403, 'FORBIDDEN', 'Not allowed', '', { required: ['sched.edit', 'jobs.status'] })),
    ).toEqual({ title: 'Your role can’t edit appointments' })
  })
  it('falls back to the command’s denyLabel, then to a generic phrase, when no permission is named', () => {
    expect(toastForError(err(403, 'FORBIDDEN', 'Not allowed'), { denyLabel: 'approve $12.00' })).toEqual({
      title: 'Your role can’t approve $12.00',
    })
    expect(toastForError(err(403, 'FORBIDDEN', 'Not allowed'))).toEqual({ title: 'Your role can’t do that' })
    expect(toastForError(err(403, 'FORBIDDEN', 'Not allowed', '', { required: 'bogus.key' }))).toEqual({
      title: 'Your role can’t do that',
    })
  })
  it('other 403s (CSRF, origin) keep the server text', () => {
    expect(
      toastForError(err(403, 'CSRF_INVALID', 'Request blocked', 'The security token is missing')),
    ).toEqual({ title: 'Request blocked', desc: 'The security token is missing' })
  })
  it('network and server errors never leak internals', () => {
    expect(toastForError(new ApiError({ status: 0, kind: 'network' }))).toEqual({
      title: 'Connection lost',
      desc: 'Check your connection and try again.',
    })
    expect(
      toastForError(err(500, 'INTERNAL', 'Something went wrong', 'pg: relation does not exist')),
    ).toEqual({ title: 'Something went wrong', desc: 'Please try again in a moment.' })
    expect(toastForError(new Error('boom'))).toEqual({
      title: 'Something went wrong',
      desc: 'Please try again.',
    })
  })
  it('toastText joins title and description on one line for the single-line toasts', () => {
    expect(toastText({ title: 'Connection lost', desc: 'retrying' })).toBe('Connection lost · retrying')
    expect(toastText({ title: 'Saved' })).toBe('Saved')
  })
})

describe('ToastBus', () => {
  it('delivers to subscribers until they unsubscribe', () => {
    const bus = new ToastBus()
    const a = vi.fn()
    const off = bus.subscribe(a)
    bus.emit({ title: 'x' })
    off()
    bus.emit({ title: 'y' })
    expect(a).toHaveBeenCalledTimes(1)
    expect(bus.size).toBe(0)
  })
})
