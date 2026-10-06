// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/data/http/problem'
import type { AuthApi } from '@/data/http/endpoints'
import { THEME_KEY } from '@/data/theme'

const router = {
  isReady: true,
  query: {} as Record<string, string | string[] | undefined>,
  pathname: '/login',
}
vi.mock('next/router', () => ({ useRouter: () => router }))

import ForgotPage from './ForgotPage'
import InvitePage from './InvitePage'
import LoginPage from './LoginPage'
import LogoutPage from './LogoutPage'
import ResetPage from './ResetPage'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  router.isReady = true
  router.query = {}
  localStorage.clear()
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const apiErr = (
  status: number,
  code: string,
  detail = '',
  extra: Partial<ConstructorParameters<typeof ApiError>[0]> = {},
) => new ApiError({ status, code, title: 'T', detail, ...extra })
const auth = (over: Partial<AuthApi> = {}): AuthApi & Record<keyof AuthApi, ReturnType<typeof vi.fn>> => {
  const base = {
    login: vi.fn(async () => ({
      user: { id: 'u', employeeId: 'e', email: 'a@b.c', name: 'A B' },
      csrfToken: 'c',
    })),
    logout: vi.fn(async () => undefined),
    csrf: vi.fn(async () => ({ csrfToken: 'c' })),
    acceptInvite: vi.fn(async () => ({
      user: { id: 'u', employeeId: 'e', email: 'a@b.c', name: 'A B' },
      csrfToken: 'c',
    })),
    forgot: vi.fn(async () => ({ accepted: true as const })),
    reset: vi.fn(async () => undefined),
    changePassword: vi.fn(async () => undefined),
    ...over,
  }
  return base as any
}

const mount = (el: any) => act(async () => root.render(el))
const q = <T extends Element = HTMLElement>(sel: string): T => container.querySelector(sel) as T
const input = (name: string) => q<HTMLInputElement>(`input[name=${name}]`)
const type = (name: string, value: string) =>
  act(() => {
    const el = input(name)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
const submit = async () => {
  await act(async () => {
    q('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}
const alerts = () => [...container.querySelectorAll('[role=alert]')].map((e) => e.textContent)
const button = () => q<HTMLButtonElement>('button[type=submit]')

describe('/login', () => {
  const setup = async (a = auth()) => {
    const navigate = vi.fn()
    await mount(createElement(LoginPage, { auth: a, navigate }))
    return { a, navigate }
  }

  it('renders the card, both fields, a forgot link and no error', async () => {
    await setup()
    expect(q('h1').textContent).toBe('Sign in')
    expect(input('email').type).toBe('email')
    expect(input('password').type).toBe('password')
    expect(input('email').autocomplete).toBe('username')
    expect(input('password').autocomplete).toBe('current-password')
    expect(q<HTMLAnchorElement>('a').getAttribute('href')).toBe('/forgot')
    expect(alerts()).toEqual([])
    expect(button().textContent).toBe('Sign in')
  })

  it('validates before calling the API', async () => {
    const { a } = await setup()
    await submit()
    expect(alerts()).toEqual(['Enter your email address.'])
    await type('email', 'nope')
    await submit()
    expect(alerts()).toEqual(['Enter a valid email address.'])
    await type('email', 'rafael@oasis.test')
    await submit()
    expect(alerts()).toEqual(['Enter your password.'])
    expect(a.login).not.toHaveBeenCalled()
  })

  it('signs in with the trimmed email and goes to the default landing page', async () => {
    const { a, navigate } = await setup()
    await type('email', '  rafael@oasis.test ')
    await type('password', 'correct horse battery')
    await submit()
    expect(a.login).toHaveBeenCalledWith({ email: 'rafael@oasis.test', password: 'correct horse battery' })
    expect(navigate).toHaveBeenCalledWith('/operations')
  })

  it('honours a same-origin next and ignores everything else', async () => {
    for (const [next, want] of [
      ['/payments', '/payments'],
      ['/settings#emergency', '/settings#emergency'],
      ['https://evil.test/', '/operations'],
      ['//evil.test', '/operations'],
      ['/login', '/operations'],
    ] as const) {
      act(() => root.unmount())
      root = createRoot(container)
      router.query = { next }
      const { navigate } = await setup()
      await type('email', 'a@b.co')
      await type('password', 'x')
      await submit()
      expect(navigate, next).toHaveBeenCalledWith(want)
    }
  })

  it('shows the server sentence for wrong credentials and lets the person retry', async () => {
    const a = auth({
      login: vi.fn(async () => {
        throw apiErr(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect')
      }) as any,
    })
    const { navigate } = await setup(a)
    await type('email', 'a@b.co')
    await type('password', 'wrong')
    await submit()
    expect(alerts()).toEqual(['Email or password is incorrect'])
    expect(button().disabled).toBe(false)
    expect(button().textContent).toBe('Sign in')
    expect(navigate).not.toHaveBeenCalled()
    expect(q('input[name=email]').getAttribute('aria-invalid')).toBeNull()
  })

  it('throttle and network failures are worded for staff', async () => {
    const a = auth({
      login: vi
        .fn()
        .mockRejectedValueOnce(apiErr(429, 'LOGIN_THROTTLED', '', { retryAfterMs: 3000 }))
        .mockRejectedValueOnce(new ApiError({ status: 0, kind: 'network' })) as any,
    })
    await setup(a)
    await type('email', 'a@b.co')
    await type('password', 'x')
    await submit()
    expect(alerts()).toEqual(['Too many attempts. Try again in 3 s.'])
    await submit()
    expect(alerts()).toEqual(['Can’t reach the server. Check your connection and try again.'])
  })

  it('while the request is in flight the button is disabled (design blocked colours) and a second submit is ignored', async () => {
    let finish!: () => void
    const a = auth({
      login: vi.fn(() => new Promise((r) => (finish = () => r({ user: {}, csrfToken: 'c' })))) as any,
    })
    const { navigate } = await setup(a)
    await type('email', 'a@b.co')
    await type('password', 'x')
    await submit()
    expect(button().disabled).toBe(true)
    expect(button().textContent).toBe('Signing in…')
    expect(button().style.background).toBe('var(--panel3)')
    await submit()
    expect(a.login).toHaveBeenCalledTimes(1)
    await act(async () => finish())
    expect(navigate).toHaveBeenCalledWith('/operations')
  })

  it('after a password reset the page greets with a success toast in the Payments/Settings toast style', async () => {
    router.query = { reset: '1' }
    await setup()
    const toast = q('[role=status]')
    expect(toast.textContent).toBe('Password updated. Sign in with your new password.')
    expect(toast.style.background).toBe('var(--ink)')
    expect(toast.style.position).toBe('fixed')
  })

  it('wraps the card in the designs’ root with the cached theme', async () => {
    localStorage.setItem(THEME_KEY, 'dark')
    await setup()
    expect(q('[data-theme]').getAttribute('data-theme')).toBe('dark')
    expect(q('[data-theme]').style.fontFamily).toContain('Manrope')
    expect(document.head.querySelector('style[data-oasis-screen="oasis-auth"]')).not.toBeNull()
  })
})

describe('/forgot', () => {
  it('validates the email, sends the request and shows the same confirmation whatever the address', async () => {
    const a = auth()
    await mount(createElement(ForgotPage, { auth: a }))
    await submit()
    expect(alerts()).toEqual(['Enter your email address.'])
    await type('email', 'ghost@nowhere.test')
    await submit()
    expect(a.forgot).toHaveBeenCalledWith({ email: 'ghost@nowhere.test' })
    expect(q('h1').textContent).toBe('Check your email')
    expect(container.textContent).toContain('If that address matches an account')
    expect(q('[role=status]').textContent).toBe('Reset link sent')
    expect(q<HTMLAnchorElement>('a').getAttribute('href')).toBe('/login')
  })
  it('shows a failure and keeps the form', async () => {
    const a = auth({
      forgot: vi.fn(async () => {
        throw new ApiError({ status: 0, kind: 'network' })
      }) as any,
    })
    await mount(createElement(ForgotPage, { auth: a }))
    await type('email', 'a@b.co')
    await submit()
    expect(alerts()).toEqual(['Can’t reach the server. Check your connection and try again.'])
    expect(q('h1').textContent).toBe('Reset your password')
    expect(button().disabled).toBe(false)
  })
})

describe('/reset/[token]', () => {
  const setup = async (a = auth(), token: string | undefined = 'tok-1') => {
    const navigate = vi.fn()
    await mount(createElement(ResetPage, { auth: a, token, navigate }))
    return { a, navigate }
  }
  it('without a token the page says the link is not valid and offers a new one', async () => {
    await setup(auth(), '')
    expect(q('h1').textContent).toBe('Link expired')
    expect(container.querySelectorAll('a')).toHaveLength(2)
  })
  it('reads the token from the router when none is passed, and waits for the router to be ready', async () => {
    router.isReady = false
    const a = auth()
    await mount(createElement(ResetPage, { auth: a }))
    expect(container.querySelector('form')).toBeNull()
    router.isReady = true
    router.query = { token: 'from-router' }
    act(() => root.unmount())
    root = createRoot(container)
    await mount(createElement(ResetPage, { auth: a, navigate: vi.fn() }))
    await type('password', 'a long enough password')
    await type('confirm', 'a long enough password')
    await submit()
    expect(a.reset).toHaveBeenCalledWith({ token: 'from-router', password: 'a long enough password' })
  })
  it('checks length and confirmation before calling the API', async () => {
    const { a } = await setup()
    await type('password', 'short')
    await type('confirm', 'different')
    await submit()
    expect(alerts()).toEqual(['Password must be at least 12 characters.', 'Passwords don’t match.'])
    await type('password', 'a long enough password')
    await submit()
    expect(alerts()).toEqual(['Passwords don’t match.'])
    expect(a.reset).not.toHaveBeenCalled()
  })
  it('sets the password and returns to sign-in with the success flag', async () => {
    const { a, navigate } = await setup()
    await type('password', 'a long enough password')
    await type('confirm', 'a long enough password')
    await submit()
    expect(a.reset).toHaveBeenCalledWith({ token: 'tok-1', password: 'a long enough password' })
    expect(navigate).toHaveBeenCalledWith('/login?reset=1')
  })
  it('an expired or used link swaps the form for the Link expired card', async () => {
    const a = auth({
      reset: vi.fn(async () => {
        throw apiErr(410, 'RESET_INVALID')
      }) as any,
    })
    await setup(a)
    await type('password', 'a long enough password')
    await type('confirm', 'a long enough password')
    await submit()
    expect(q('h1').textContent).toBe('Link expired')
    expect(container.textContent).toContain('Request a new one')
    expect(container.querySelector('form')).toBeNull()
  })
  it('a server field error lands under the password field', async () => {
    const a = auth({
      reset: vi.fn(async () => {
        throw apiErr(422, 'VALIDATION_FAILED', '', {
          errors: [{ path: 'body.password', message: 'Too common' }],
        })
      }) as any,
    })
    await setup(a)
    await type('password', 'a long enough password')
    await type('confirm', 'a long enough password')
    await submit()
    expect(alerts()).toEqual(['Too common'])
    expect(input('password').getAttribute('aria-invalid')).toBe('true')
  })
})

describe('/invite/[token]', () => {
  const setup = async (a = auth(), token: string | undefined = 'inv-1') => {
    const navigate = vi.fn()
    await mount(createElement(InvitePage, { auth: a, token, navigate, landingDelayMs: 1200 }))
    return { a, navigate }
  }
  const fill = async (over: Record<string, string> = {}) => {
    const v = {
      email: 'kevin@oasis.test',
      password: 'a long enough password',
      confirm: 'a long enough password',
      ...over,
    }
    for (const [k, val] of Object.entries(v)) await type(k, val)
  }

  it('email is required (the Settings form leaves it optional, login needs it)', async () => {
    const { a } = await setup()
    await fill({ email: '' })
    await submit()
    expect(alerts()).toEqual(['Email is required to sign in.'])
    expect(a.acceptInvite).not.toHaveBeenCalled()
    expect(q('h1').textContent).toBe('Set up your login')
  })
  it('validates email shape, password length and confirmation together', async () => {
    await setup()
    await fill({ email: 'bad', password: 'short', confirm: 'nope' })
    await submit()
    expect(alerts()).toEqual([
      'Enter a valid email address.',
      'Password must be at least 12 characters.',
      'Passwords don’t match.',
    ])
  })
  it('accepts the invite with token, trimmed email and password, then welcomes and leaves for the app', async () => {
    vi.useFakeTimers()
    const { a, navigate } = await setup()
    await fill({ email: ' kevin@oasis.test ' })
    await submit()
    expect(a.acceptInvite).toHaveBeenCalledWith({
      token: 'inv-1',
      email: 'kevin@oasis.test',
      password: 'a long enough password',
    })
    expect(q('[role=status]').textContent).toBe('Welcome to Oasis · you’re signed in')
    expect(navigate).not.toHaveBeenCalled()
    await act(async () => void vi.advanceTimersByTime(1200))
    expect(navigate).toHaveBeenCalledWith('/operations')
  })
  it('EMAIL_TAKEN appears under the email field', async () => {
    const a = auth({
      acceptInvite: vi.fn(async () => {
        throw apiErr(409, 'EMAIL_TAKEN', 'That email address is already in use')
      }) as any,
    })
    await setup(a)
    await fill()
    await submit()
    expect(alerts()).toEqual(['That email address is already in use'])
    expect(input('email').getAttribute('aria-invalid')).toBe('true')
    expect(button().disabled).toBe(false)
  })
  it('an expired, used or revoked invite replaces the form with an Invite not valid card', async () => {
    const a = auth({
      acceptInvite: vi.fn(async () => {
        throw apiErr(410, 'INVITE_INVALID')
      }) as any,
    })
    await setup(a)
    await fill()
    await submit()
    expect(q('h1').textContent).toBe('Invite not valid')
    expect(container.textContent).toContain('Ask a manager to send a new one')
    expect(container.querySelector('form')).toBeNull()
  })
  it('a missing token (a bare /invite) shows the same card', async () => {
    await setup(auth(), '')
    expect(q('h1').textContent).toBe('Invite not valid')
  })
  it('reads the token from /invite?token= or /invite/<token> through the router', async () => {
    router.query = { token: 'abc' }
    const a = auth()
    await mount(createElement(InvitePage, { auth: a, navigate: vi.fn() }))
    await fill()
    await submit()
    expect(a.acceptInvite).toHaveBeenCalledWith(expect.objectContaining({ token: 'abc' }))
  })
})

describe('/logout', () => {
  it('signs out, clears the cached theme and lands on /login', async () => {
    localStorage.setItem(THEME_KEY, 'dark')
    const a = auth()
    const navigate = vi.fn()
    await mount(createElement(LogoutPage, { auth: a, navigate }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(a.logout).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('/login')
    expect(localStorage.getItem(THEME_KEY)).toBeNull()
    expect(q('[role=status]').getAttribute('aria-label')).toBe('Signing out')
  })
})
