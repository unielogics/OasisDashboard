// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// The sign-in page in kiosk mode (ADR 0180 and its 2026-10-14 amendment, design 6.1; DV-1001): the gate on GET /kiosk/status,
// the PIN keypad, the 0218 way to the email form, the automatic submit at the eighth digit, PINs only at the shop's network
// (no network set yet / not at the shop: the keypad says so and sends no PIN, re-reads the status, one try from a browser that opened the kiosk) and every message of the keypad.
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
  try {
    localStorage.clear()
  } catch {
    // jsdom always has it
  }
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
  networkSet: true,
  atShop: true,
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
  it('kiosk mode on (the default): the PIN keypad; no email field anywhere', async () => {
    await mount(createElement(LoginGate, { live: true, auth: authApi(), kiosk: kioskApi() }))
    expect(container.querySelector('h1')!.textContent).toBe('Enter your PIN')
    expect(text()).toContain('Your 8-digit PIN opens the board for the whole shop.')
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
    expect(container.querySelector('h1')!.textContent).toBe('Enter your PIN')
    expect([...container.querySelectorAll('a')].map((a) => a.textContent)).toContain('Back to the board')
  })
})

describe('KeypadPage', () => {
  const page = (
    o: {
      status?: KioskStatus
      unlock?: KioskApi['unlock']
      /** GET /kiosk/status read again by the keypad (default: the same status it opened with). */
      reread?: KioskApi['status']
      recheckMs?: number
      navigate?: any
      query?: any
      auth?: AuthApi
    } = {},
  ) =>
    createElement(KeypadPage, {
      status: o.status ?? STATUS,
      kiosk: {
        unlock: o.unlock ?? vi.fn(async () => makeKioskMe()),
        status: o.reread ?? vi.fn(async () => o.status ?? STATUS),
      },
      auth: o.auth ?? authApi(),
      query: o.query ?? {},
      navigate: o.navigate ?? vi.fn(),
      recheckMs: o.recheckMs,
    })
  const wait = async (ms: number) => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, ms))
    })
    await flush()
  }
  const AWAY: KioskStatus = { ...STATUS, atShop: false }
  const NO_NETWORK: KioskStatus = { ...STATUS, networkSet: false, atShop: false }

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
    expect(container.querySelector('h1')!.textContent).toBe('Enter your PIN')
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

  it('sends the PIN by itself at the eighth digit, then opens the board; the dots empty right away', async () => {
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

  it('a wrong PIN: “That PIN didn’t work.” and the countdown; the next PIN waits for it', async () => {
    const unlock = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ status: 401, code: 'KIOSK_PIN_WRONG', title: 'Wrong PIN', meta: { retryAfterSec: 2 } }))
      .mockResolvedValueOnce(makeKioskMe())
    const navigate = vi.fn()
    await mount(page({ unlock, navigate }))
    await typeKeys('24681357')
    expect(text()).toContain('That PIN didn’t work.')
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

  it('a status that says the wait is still running counts down from it', async () => {
    const unlock = vi.fn()
    await mount(page({ unlock, status: { ...STATUS, retryAfterSec: 30 } }))
    await typeKeys('24681357')
    expect(text()).toMatch(/Try again in (29|30) s/)
    expect(unlock).not.toHaveBeenCalled()
  })

  it('locked out (this address or this browser): the manager message; a PIN is not sent, 0218 still works', async () => {
    const unlock = vi.fn()
    await mount(page({ unlock, status: { ...STATUS, lockedOut: true } }))
    expect(text()).toContain('Too many wrong PINs. A manager needs to clear it in Settings → Kiosk.')
    await typeKeys('24681357')
    expect(unlock).not.toHaveBeenCalled()
    await typeKeys('0218')
    expect(container.querySelector('input[name=email]')).not.toBeNull()
  })

  it('a lockout the server reports while typing (423): the same message, nothing more is sent', async () => {
    const unlock = vi.fn().mockRejectedValue(new ApiError({ status: 423, code: 'KIOSK_LOCKED_OUT', title: 'x' }))
    await mount(page({ unlock }))
    await typeKeys('24681357')
    expect(text()).toContain('Too many wrong PINs. A manager needs to clear it in Settings → Kiosk.')
    await typeKeys('13572468')
    expect(unlock).toHaveBeenCalledTimes(1)
  })

  it('not at the shop: the keypad still shows, says “PINs work only at the shop.” and never sends a PIN (a browser that never opened the kiosk); 0218 works', async () => {
    const unlock = vi.fn()
    await mount(page({ unlock, status: { ...STATUS, atShop: false } }))
    expect(container.querySelector('h1')!.textContent).toBe('Enter your PIN')
    expect(text()).toContain('PINs work only at the shop.')
    await typeKeys('24681357')
    expect(unlock).not.toHaveBeenCalled()
    expect(dots()).toBe(0)
    expect(text()).toContain('PINs work only at the shop.')
    await typeKeys('0218')
    expect(container.querySelector('input[name=email]')).not.toBeNull()
  })

  it('no shop network yet: “A Super Admin must set the shop network first — Settings → Kiosk” and no PIN is sent', async () => {
    const unlock = vi.fn()
    await mount(page({ unlock, status: { ...STATUS, networkSet: false, atShop: false } }))
    expect(text()).toContain('A Super Admin must set the shop network first — Settings → Kiosk')
    await typeKeys('24681357')
    expect(unlock).not.toHaveBeenCalled()
    await typeKeys('0218')
    expect(container.querySelector('input[name=email]')).not.toBeNull()
  })

  it('the network was removed while the keypad was open: the server’s 403 says so and the keypad stops sending', async () => {
    const unlock = vi
      .fn()
      .mockRejectedValue(new ApiError({ status: 403, code: 'KIOSK_NOT_AT_SHOP', title: 'x', meta: { networkSet: true } }))
    await mount(page({ unlock, reread: vi.fn(async () => AWAY) }))
    await typeKeys('24681357')
    expect(text()).toContain('PINs work only at the shop.')
    await typeKeys('13572468')
    expect(unlock).toHaveBeenCalledTimes(1)
  })

  // K-PIN-DASH review F1: a blocked keypad reads the status again, so the tablet works once the network is set (no reload)
  it('no shop network yet, then the Super Admin adds it from a phone: the keypad reads the status again by itself and says it is ready', async () => {
    const reread = vi.fn(async () => NO_NETWORK)
    const unlock = vi.fn(async () => makeKioskMe())
    const navigate = vi.fn()
    await mount(page({ status: NO_NETWORK, reread, unlock, navigate, recheckMs: 40 }))
    expect(text()).toContain('A Super Admin must set the shop network first')
    await wait(120)
    expect(reread).toHaveBeenCalled()
    expect(text()).toContain('A Super Admin must set the shop network first')
    reread.mockResolvedValue(STATUS)
    await wait(120)
    expect(text()).not.toContain('Super Admin')
    expect(container.querySelector('[role=status]')?.textContent).toBe('Ready — PINs work here now.')
    const calls = reread.mock.calls.length
    await wait(150)
    expect(reread.mock.calls.length).toBe(calls) // no more reads once it is at the shop
    await typeKeys('24681357')
    expect(unlock).toHaveBeenCalledWith('24681357')
    await flush()
    expect(navigate).toHaveBeenCalledWith('/operations')
  })

  it('blocked, a full PIN reads the status first: still away → nothing is sent; at the shop now → the PIN goes out', async () => {
    const reread = vi.fn(async () => AWAY)
    const unlock = vi.fn(async () => makeKioskMe())
    await mount(page({ status: NO_NETWORK, reread, unlock }))
    await typeKeys('24681357')
    expect(reread).toHaveBeenCalledTimes(1)
    expect(unlock).not.toHaveBeenCalled()
    expect(dots()).toBe(0)
    expect(text()).toContain('PINs work only at the shop.')
    reread.mockResolvedValue(STATUS)
    await typeKeys('13572468')
    expect(reread).toHaveBeenCalledTimes(2)
    expect(unlock).toHaveBeenCalledTimes(1)
    expect(unlock).toHaveBeenCalledWith('13572468')
  })

  it('a refused try (403 KIOSK_NOT_AT_SHOP), then the address is approved: the next PIN reads the status and goes out', async () => {
    const reread = vi.fn(async () => AWAY)
    const unlock = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ status: 403, code: 'KIOSK_NOT_AT_SHOP', title: 'x', meta: { networkSet: true } }))
      .mockResolvedValueOnce(makeKioskMe())
    await mount(page({ unlock, reread }))
    await typeKeys('24681357')
    expect(text()).toContain('PINs work only at the shop.')
    reread.mockResolvedValue(STATUS)
    await typeKeys('24681357')
    expect(unlock).toHaveBeenCalledTimes(2)
  })

  it('coming back into view (focus, visibility) reads the status again while blocked', async () => {
    const reread = vi.fn(async () => STATUS)
    await mount(page({ status: AWAY, reread, recheckMs: 60_000 }))
    expect(reread).not.toHaveBeenCalled()
    await act(async () => void window.dispatchEvent(new Event('focus')))
    await flush()
    expect(reread).toHaveBeenCalledTimes(1)
    expect(text()).not.toContain('PINs work only at the shop.')
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')))
    await flush()
    expect(reread).toHaveBeenCalledTimes(1) // at the shop now: nothing more to wait for
  })

  it('a status that cannot be read keeps the keypad as it is (still blocked, nothing sent)', async () => {
    const reread = vi.fn(async () => {
      throw new ApiError({ status: 0, kind: 'network' })
    })
    const unlock = vi.fn()
    await mount(page({ status: AWAY, reread, unlock }))
    await typeKeys('24681357')
    expect(unlock).not.toHaveBeenCalled()
    expect(text()).toContain('PINs work only at the shop.')
  })

  it('0218, then Back to keypad: a blocked keypad still says why', async () => {
    await mount(page({ status: NO_NETWORK }))
    await typeKeys('0218')
    const back = [...container.querySelectorAll('a')].find((a) => a.textContent === 'Back to keypad')!
    await act(async () => back.click())
    expect(text()).toContain('A Super Admin must set the shop network first — Settings → Kiosk')
  })

  it('kiosk mode switched off while blocked: the re-read shows the email/password card', async () => {
    const reread = vi.fn(async () => ({ ...AWAY, enabled: false }))
    await mount(page({ status: AWAY, reread }))
    await typeKeys('24681357')
    expect(container.querySelector('input[name=email]')).not.toBeNull()
    expect(text()).toContain('Kiosk mode is off.')
  })

  // K-PIN-DASH review F2: the plan's "approve it from anywhere" also after the tablet reloaded on the new address
  it('a successful unlock remembers this browser (one flag, never the PIN)', async () => {
    await mount(page())
    await typeKeys('24681357')
    expect(localStorage.getItem('oasis-kiosk-opened-here')).toBe('1')
    expect(localStorage.length).toBe(1)
  })

  it('a browser that opened the kiosk before, loaded on a new address: one PIN goes out so the try is listed, then none', async () => {
    localStorage.setItem('oasis-kiosk-opened-here', '1')
    const unlock = vi
      .fn()
      .mockRejectedValue(new ApiError({ status: 403, code: 'KIOSK_NOT_AT_SHOP', title: 'x', meta: { networkSet: true } }))
    await mount(page({ status: AWAY, unlock }))
    expect(text()).toContain('PINs work only at the shop.')
    await typeKeys('24681357')
    expect(unlock).toHaveBeenCalledTimes(1)
    expect(text()).toContain('PINs work only at the shop.')
    expect(dots()).toBe(0)
    await typeKeys('13572468')
    expect(unlock).toHaveBeenCalledTimes(1)
  })

  // K-PIN-DASH review N2: the page opened at the shop, the first PIN is refused as away (the address changed meanwhile);
  // that refusal is this page's one try, so a browser that opened the kiosk before sends no second PIN from here
  it('one PIN per page from a new network: a 403 KIOSK_NOT_AT_SHOP on a page that opened at the shop counts as the try', async () => {
    localStorage.setItem('oasis-kiosk-opened-here', '1')
    const unlock = vi
      .fn()
      .mockRejectedValue(new ApiError({ status: 403, code: 'KIOSK_NOT_AT_SHOP', title: 'x', meta: { networkSet: true } }))
    const reread = vi.fn(async () => AWAY)
    await mount(page({ status: STATUS, unlock, reread }))
    await typeKeys('24681357')
    expect(unlock).toHaveBeenCalledTimes(1)
    expect(text()).toContain('PINs work only at the shop.')
    await typeKeys('13572468')
    expect(reread).toHaveBeenCalled()
    expect(unlock).toHaveBeenCalledTimes(1)
    expect(text()).toContain('PINs work only at the shop.')
  })

  it('that browser before any shop network exists, or a browser that never opened it: no PIN is sent', async () => {
    const unlock = vi.fn()
    await mount(page({ status: AWAY, unlock }))
    await typeKeys('24681357')
    expect(unlock).not.toHaveBeenCalled()
    act(() => root.unmount())
    root = createRoot(container)
    localStorage.setItem('oasis-kiosk-opened-here', '1')
    await mount(page({ status: NO_NETWORK, unlock }))
    await typeKeys('24681357')
    expect(unlock).not.toHaveBeenCalled()
  })

  it('kiosk mode turned off meanwhile (409 KIOSK_OFF): the email/password card', async () => {
    const unlock = vi.fn().mockRejectedValue(new ApiError({ status: 409, code: 'KIOSK_OFF', title: 'x' }))
    await mount(page({ unlock }))
    await typeKeys('24681357')
    expect(container.querySelector('input[name=email]')).not.toBeNull()
    expect(text()).toContain('Kiosk mode is off.')
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
      'The kiosk locked at 9:00 PM. Enter your PIN to open it.',
    )
  })
})
