// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const session = { current: null as any }
const viewAs = vi.fn()
vi.mock('@/auth/session', () => ({ useSession: () => ({ session: session.current, viewAs }) }))

import { makeSession } from '@/auth/test-fixtures'
import { ErrorBoundary } from './ErrorBoundary'
import { RouteGate } from './RouteGate'

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
const mount = (el: any) => act(async () => root.render(el))

describe('<RouteGate>', () => {
  it('renders the screen when the session may open it', async () => {
    session.current = makeSession({ role: 'mgmt' })
    await mount(createElement(RouteGate, { pathname: '/payments' }, createElement('div', { id: 'screen' })))
    expect(container.querySelector('#screen')).not.toBeNull()
  })
  it('renders the Payments-style locked card with the role title, the other screens and Sign out when it may not', async () => {
    session.current = makeSession({ role: 'crew' })
    session.current.roleTitle = 'Crew'
    await mount(createElement(RouteGate, { pathname: '/payments' }, createElement('div', { id: 'screen' })))
    expect(container.querySelector('#screen')).toBeNull()
    expect(container.querySelector('h1')!.textContent).toBe('No payment access')
    expect(container.textContent).toContain(
      'The Crew role doesn\'t include "View payment reports". A Super Admin can grant it in Settings.',
    )
    const links = [...container.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])
    expect(links).toEqual([
      ['Operations', '/operations'],
      ['Sign out', '/logout'],
    ])
  })
  it('a Super Admin who views as a role without access can exit view-as from the locked card', async () => {
    session.current = makeSession({
      role: 'super',
      viewAs: { active: true, canViewAs: true, roleId: 'role-crew', roleName: 'Crew', options: [] },
      permissions: { 'pay.reports': { on: false } },
    })
    await mount(createElement(RouteGate, { pathname: '/payments' }, createElement('div', { id: 'screen' })))
    expect(container.querySelector('#screen')).toBeNull()
    const exit = [...container.querySelectorAll('a')].find((a) => a.textContent === 'Exit view-as')!
    expect(exit).toBeDefined()
    await act(async () => exit.click())
    expect(viewAs).toHaveBeenCalledWith(null)
    session.current = makeSession({ role: 'crew' })
    await mount(createElement(RouteGate, { pathname: '/payments' }, createElement('div', { id: 'screen' })))
    expect([...container.querySelectorAll('a')].map((a) => a.textContent)).not.toContain('Exit view-as')
  })
  it('Settings and Operations have their own locked cards; unknown paths pass through', async () => {
    session.current = makeSession({ role: 'crew' })
    await mount(createElement(RouteGate, { pathname: '/settings' }, createElement('div', { id: 'screen' })))
    expect(container.querySelector('h1')!.textContent).toBe('No settings access')
    const none = makeSession({ role: 'crew', permissions: {} })
    session.current = none
    await mount(createElement(RouteGate, { pathname: '/operations' }, createElement('div', { id: 'screen' })))
    expect(container.querySelector('h1')!.textContent).toBe('No schedule access')
    expect([...container.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['Sign out'])
    await mount(createElement(RouteGate, { pathname: '/somewhere' }, createElement('div', { id: 'screen' })))
    expect(container.querySelector('#screen')).not.toBeNull()
  })
})

describe('<ErrorBoundary>', () => {
  it('shows the failure card instead of a blank page when a child throws, and logs it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const Boom = () => {
      throw new Error('kaboom')
    }
    await mount(createElement(ErrorBoundary, null, createElement(Boom)))
    expect(container.querySelector('[role=alert]')).not.toBeNull()
    expect(container.querySelector('h1, div')!.textContent).toContain('This screen failed to load')
    expect(container.textContent).toContain('Try again')
    expect(log).toHaveBeenCalled()
  })
  it('renders its children when nothing throws', async () => {
    await mount(createElement(ErrorBoundary, null, createElement('p', { id: 'ok' }, 'fine')))
    expect(container.querySelector('#ok')).not.toBeNull()
  })
})
