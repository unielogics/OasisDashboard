// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// The sign-in page in kiosk mode (ADR 0180, design 6.1; DV-1001): the gate on GET /kiosk/status, the keypad, the 0218
// way to the email form, the automatic submit at the eighth digit and every message of the keypad.
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/data/http/problem'
import type { AuthApi, KioskApi } from '@/data/http/endpoints'
import type { KioskStatus } from '@/data/http/auth-types'
import { makeKioskMe } from '@/auth/test-fixtures'

const router = {
  isReady: true,
  query: {} as Record<string, string | string[] | undefined>,
  pathname: '/login',
}
vi.mock('next/router', () => ({ useRouter: () => router }))

import LoginGate from './LoginGate'
import { KeypadPage } from './KeypadPage'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  router.isReady = true
  router.query = {}
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const flush = async () => {
  for (let i = 0; i < 4; i++)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
}
const mount = async (el: any) => {
  await act(async () => root.render(el))
  await flush()
}

const STATUS: KioskStatus = {
  enabled: true,
  device: { name: 'Front desk tablet' },
  unlocked: null,
  lockedOut: false,
  retryAfterSec: 0,
}

const authApi = (): AuthApi =>
  ({
    login: vi.fn(async () => ({ user: { id: 'u', employeeId: 'e', email: 'a@b.c', name: 'A' }, csrfToken: 'c' })),
    logout: vi.fn(),
    csrf: vi.fn(),
    acceptInvite: vi.fn(),
    forgot: vi.fn(),
    reset: vi.fn(),
    changePassword: vi.fn(),
  }) as any

const kioskApi = (status: KioskStatus | Error = STATUS, unlock: KioskApi['unlock'] = vi.fn(async () => makeKioskMe())): KioskApi => ({
  status: vi.fn(async () => {
    if (status instanceof Error) throw status
    return status
  }),
  unlock,
  me: vi.fn(),
  staff: vi.fn(),
  lock: vi.fn(),
})

const text = () => container.textContent ?? ''
const dots = () => [...container.querySelectorAll('[data-dot="on"]')].length
const key = async (k: string) => {
  const b = container.querySelector(`[data-key="${k}"]`) as HTMLButtonElement
  await act(async () => b.click())
}
const typeKeys = async (keys: string) => {
  for (const k of keys) await key(k === 'C' ? 'clear' : k === '<' ? 'back' : k)
  await flush()
}

describe('LoginGate', () => {
  it('kiosk mode off: today’s sign-in form, unchanged', async () => {
    await mount(createElement(LoginGate, { live: true, auth: authApi(), kiosk: kioskApi({ ...STATUS, enabled: false }) }))
    expect(container.querySelector('h1')!.textContent).toBe('Sign in')
    expect(container.querySelector('input[name=email]')).not.toBeNull()
    expect(container.querySelector('[data-key]')).toBeNull()
  })
  it('the status cannot be read (older server, offline): the sign-in form', async () => {
    await mount(createElement(LoginGate, { live: true, auth: authApi(), kiosk: kioskApi(new ApiError({ status: 404 })) }))
    expect(container.querySelector('input[name=email]')).not.toBeNull()
  })
  it('a build without the API never asks', async () => {
    const k = kioskApi()
    await mount(createElement(LoginGate, { live: false, auth: authApi(), kiosk: k }))
    expect(k.status).not.toHaveBeenCalled()
    expect(container.querySelector('input[name=email]')).not.toBeNull()
  })
  it('kiosk mode on: the keypad, titled with the tablet’s name; no email field anywhere', async () => {
    await mount(createElement(LoginGate, { live: true, auth: authApi(), kiosk: kioskApi() }))
    expect(container.querySelector('h1')!.textContent).toBe('Enter the shop code')
    expect(text()).toContain('Front desk tablet')
    expect(container.querySelector('input')).toBeNull()
    expect([...container.querySelectorAll('[data-key]')].map((b) => b.getAttribute('data-key'))).toEqual([
      '1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back',
    ])
    expect(container.querySelectorAll('[data-dot]')).toHaveLength(8)
    // keys at least 72 px tall
    const h = parseInt((container.querySelector('[data-key="5"]') as HTMLElement).style.height, 10)
    expect(h).toBeGreaterThanOrEqual(72)
  })
  it('already unlocked: straight to the board; with ?admin=1 (Manager sign-in) the keypad', async () => {
    const replace = vi.fn()
    const unlocked = { ...STATUS, unlocked: { locksAt: '2026-06-14T01:00:00Z', locksAtLabel: '9:00 PM' } }
    await mount(createElement(LoginGate, { live: true, auth: authApi(), kiosk: kioskApi(unlocked), replace }))
    expect(replace).toHaveBeenCalledWith('/operations')
    router.query = { admin: '1' }
    replace.mockClear()
    await mount(createElement(LoginGate, { live: true, auth: authApi(), kiosk: kioskApi(unlocked), replace }))
    expect(replace).not.toHaveBeenCalled()
    expect(container.querySelector('h1')!.textContent).toBe('Enter the shop code')
    expect([...container.querySelectorAll('a')].map((a) => a.textContent)).toContain('Back to the board')
  })
})

describe('KeypadPage', () => {
  const page = (o: { status?: KioskStatus; unlock?: KioskApi['unlock']; navigate?: any; query?: any; auth?: AuthApi } = {}) =>
    createElement(KeypadPage, {
      status: o.status ?? STATUS,
      kiosk: { unlock: o.unlock ?? vi.fn(async () => makeKioskMe()) },
      auth: o.auth ?? authApi(),
      query: o.query ?? {},
      navigate: o.navigate ?? vi.fn(),
    })

  it('0218 swaps in the email/password card at once and sends nothing; Back to keypad returns', async () => {
    const unlock = vi.fn(async () => makeKioskMe())
    await mount(page({ unlock }))
    await typeKeys('021')
    expect(dots()).toBe(3)
    await typeKeys('8')
    expect(container.querySelector('h1')!.textContent).toBe('Sign in')
    expect(container.querySelector('input[name=email]')).not.toBeNull()
    expect(unlock).not.toHaveBeenCalled()
    const back = [...container.querySelectorAll('a')].find((a) => a.textContent === 'Back to keypad')!
    await act(async () => back.click())
    expect(container.querySelector('h1')!.textContent).toBe('Enter the shop code')
    expect(dots()).toBe(0)
  })

  it('only the first four digits since the last Clear: 1 0218 does not, Clear 0218 does', async () => {
    await mount(page())
    await typeKeys('10218')
    expect(container.querySelector('input[name=email]')).toBeNull()
    await typeKeys('C0218')
    expect(container.querySelector('input[name=email]')).not.toBeNull()
  })

  it('the email card signs in like the plain page (POST /auth/login, then the next page)', async () => {
    const auth = authApi()
    const navigate = vi.fn()
    await mount(page({ auth, navigate, query: { next: '/settings' } }))
    await typeKeys('0218')
    const set = (name: string, v: string) => {
      const el = container.querySelector(`input[name=${name}]`) as HTMLInputElement
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await act(async () => {
      set('email', 'rafael@oasisautospa.com')
      set('password', 'secret-password-1')
    })
    await act(async () => (container.querySelector('form') as HTMLFormElement).requestSubmit())
    await flush()
    expect(auth.login).toHaveBeenCalledWith({ email: 'rafael@oasisautospa.com', password: 'secret-password-1' })
    expect(navigate).toHaveBeenCalledWith('/settings')
  })

  it('sends the code by itself at the eighth digit, then opens the board; the dots empty right away', async () => {
    let release: () => void = () => {}
    const unlock = vi.fn(() => new Promise<any>((r) => (release = () => r(makeKioskMe()))))
    const navigate = vi.fn()
    await mount(page({ unlock, navigate }))
    await typeKeys('2468135')
    expect(unlock).not.toHaveBeenCalled()
    await typeKeys('7')
    expect(unlock).toHaveBeenCalledWith('24681357')
    await act(async () => release())
    await flush()
    expect(navigate).toHaveBeenCalledWith('/operations')
    expect(dots()).toBe(0)
  })

  it('a wrong code: “That code didn’t work.” and the countdown; the next code waits for it', async () => {
    const unlock = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ status: 401, code: 'KIOSK_CODE_WRONG', title: 'Wrong code', meta: { retryAfterSec: 2 } }))
      .mockResolvedValueOnce(makeKioskMe())
    const navigate = vi.fn()
    await mount(page({ unlock, navigate }))
    await typeKeys('24681357')
    expect(text()).toContain('That code didn’t work.')
    expect(text()).toMatch(/Try again in [12] s/)
    expect(dots()).toBe(0)
    // typed while waiting: held until the wait is over, then sent
    await typeKeys('13572468')
    expect(unlock).toHaveBeenCalledTimes(1)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 2300))
    })
    await flush()
    expect(unlock).toHaveBeenCalledTimes(2)
    expect(unlock).toHaveBeenLastCalledWith('13572468')
    expect(navigate).toHaveBeenCalledWith('/operations')
  }, 10_000)

  it('locked out: the manager message; a code is not sent, 0218 still works', async () => {
    const unlock = vi.fn()
    await mount(page({ unlock, status: { ...STATUS, lockedOut: true } }))
    expect(text()).toContain('Too many wrong codes. A manager needs to sign in on this tablet.')
    await typeKeys('24681357')
    expect(unlock).not.toHaveBeenCalled()
    await typeKeys('0218')
    expect(container.querySelector('input[name=email]')).not.toBeNull()
  })

  it('a browser that is not a kiosk: “Codes work only on the shop’s kiosk tablet.” and the code is not sent', async () => {
    const unlock = vi.fn()
    await mount(page({ unlock, status: { ...STATUS, device: null } }))
    expect(text()).toContain('Oasis kiosk')
    await typeKeys('24681357')
    expect(text()).toContain('Codes work only on the shop’s kiosk tablet.')
    expect(unlock).not.toHaveBeenCalled()
  })

  it('a tablet removed while the keypad was open: the server says so', async () => {
    const unlock = vi.fn().mockRejectedValue(new ApiError({ status: 403, code: 'KIOSK_DEVICE_UNKNOWN', title: 'x' }))
    await mount(page({ unlock }))
    await typeKeys('24681357')
    expect(text()).toContain('Codes work only on the shop’s kiosk tablet.')
  })

  it('the physical keyboard: digits, Backspace, Escape', async () => {
    await mount(page())
    const press = async (k: string) => {
      await act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k })))
    }
    for (const k of ['1', '2', '3']) await press(k)
    expect(dots()).toBe(3)
    await press('Backspace')
    expect(dots()).toBe(2)
    await press('Escape')
    expect(dots()).toBe(0)
    for (const k of ['0', '2', '1', '8']) await press(k)
    expect(container.querySelector('input[name=email]')).not.toBeNull()
  })

  it('after the kiosk locked: the toast names the time it locked', async () => {
    await mount(page({ query: { locked: '1', at: '9:00 PM' } }))
    expect(container.querySelector('[role=status]')!.textContent).toBe(
      'The kiosk locked at 9:00 PM. Enter the code to open it.',
    )
  })
})
