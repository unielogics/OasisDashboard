// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openableScreens } from '@/auth/routes'
import { makeSession } from '@/auth/test-fixtures'
import { api } from '@/data/http/client'
import NotFoundPage, { NOT_FOUND_TEXT, whoCanGo, type NotFoundState } from './NotFoundPage'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

const show = async (state: NotFoundState) => {
  await act(async () => root.render(createElement(NotFoundPage, { load: async () => state })))
}
const links = () => [...container.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])

describe('the 404 page', () => {
  it('is the locked card of the login family: "Page not found" and the sentence', async () => {
    await show({ signedOut: true })
    expect(container.querySelector('h1')!.textContent).toBe('Page not found')
    expect(container.querySelector('p')!.textContent).toBe(NOT_FOUND_TEXT)
    expect(container.querySelector('header')!.textContent).toContain('Oasis Auto Spa')
  })

  it('signed out it offers Sign in, and nothing else', async () => {
    await show({ signedOut: true })
    expect(links()).toEqual([['Sign in', '/login']])
  })

  it('signed in it links the screens the session can open', async () => {
    await show({ signedOut: false, screens: openableScreens(makeSession({ role: 'crew' })) })
    expect(links()).toEqual([['Operations', '/operations']])
    act(() => root.unmount())
    root = createRoot(container)
    await show({ signedOut: false, screens: openableScreens(makeSession({ role: 'mgmt' })) })
    expect(links()).toEqual([
      ['Operations', '/operations'],
      ['Payments', '/payments'],
      ['Settings', '/settings'],
    ])
  })

  it('signed in with no screen to open it offers Sign out', async () => {
    await show({ signedOut: false, screens: [] })
    expect(links()).toEqual([['Sign out', '/logout']])
  })

  it('shows no link until it knows who is there', async () => {
    await act(async () =>
      root.render(createElement(NotFoundPage, { load: () => new Promise<NotFoundState>(() => {}) })),
    )
    expect(container.querySelector('h1')!.textContent).toBe('Page not found')
    expect(links()).toEqual([])
  })

  it('the fixture builds have no session: every screen; the live build asks GET /me and reads a 401 as signed out', async () => {
    expect(await whoCanGo(false)).toEqual({
      signedOut: false,
      screens: expect.arrayContaining([expect.objectContaining({ path: '/settings' })]),
    })
    const get = vi.spyOn(api, 'get').mockRejectedValue(Object.assign(new Error('401'), { status: 401 }))
    expect(await whoCanGo(true)).toEqual({ signedOut: true })
    expect(get).toHaveBeenCalledWith('/me', expect.anything())
  })
})
