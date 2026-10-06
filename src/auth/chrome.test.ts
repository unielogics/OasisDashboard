import { describe, expect, it, vi } from 'vitest'
import { LiveChrome, shortName } from './chrome'
import { SUPER_OPTIONS, makeMe, makeSession } from './test-fixtures'

describe('shortName', () => {
  it('first name and last initial, like the designs’ chip', () => {
    expect(shortName('Rafael Mendes')).toBe('Rafael M.')
    expect(shortName('  alex   rivera ')).toBe('alex R.')
    expect(shortName('Maria de la Cruz')).toBe('Maria C.')
    expect(shortName('Cher')).toBe('Cher')
    expect(shortName('')).toBe('')
  })
})

describe('LiveChrome store', () => {
  it('is empty without a session and fills in from one', () => {
    const c = new LiveChrome()
    expect(c.vals().user).toEqual({ initials: '', name: '', short: '', email: '', roleTitle: '' })
    expect(c.vals().canViewAs).toBe(false)
    c.setSession(makeSession({ role: 'mgmt' }))
    expect(c.vals().user).toEqual({
      initials: 'RM',
      name: 'Rafael Mendes',
      short: 'Rafael M.',
      email: 'rafael@oasis.test',
      roleTitle: 'Management',
    })
    expect(c.hasSession).toBe(true)
  })

  it('vals() is stable between changes and new after one; subscribers hear every change', () => {
    const c = new LiveChrome()
    const l = vi.fn()
    const off = c.subscribe(l)
    const a = c.vals()
    expect(c.vals()).toBe(a)
    c.setSession(makeSession())
    expect(l).toHaveBeenCalledTimes(1)
    expect(c.vals()).not.toBe(a)
    c.toggleUserMenu()
    expect(c.vals().menu.open).toBe(true)
    c.toggleUserMenu()
    expect(c.vals().menu.open).toBe(false)
    expect(l).toHaveBeenCalledTimes(3)
    off()
    c.toggleUserMenu()
    expect(l).toHaveBeenCalledTimes(3)
  })

  it('the two menus are exclusive and closeMenus() only notifies when something was open', () => {
    const c = new LiveChrome()
    c.setSession(makeSession({ role: 'super' }))
    const l = vi.fn()
    c.subscribe(l)
    c.closeMenus()
    expect(l).not.toHaveBeenCalled()
    c.toggleUserMenu()
    c.toggleViewAsMenu()
    expect(c.vals().menu.open).toBe(false)
    expect(c.vals().viewAs.menuOpen).toBe(true)
    c.closeMenus()
    expect(c.vals().viewAs.menuOpen).toBe(false)
  })

  it('sign out and view-as call the bound actions; picking an option closes the menu', () => {
    const c = new LiveChrome()
    const actions = { signOut: vi.fn(), viewAs: vi.fn(async () => undefined), themeChanged: vi.fn() }
    c.bind(actions)
    c.setSession(makeSession({ role: 'super' }))
    c.vals().menu.signOut()
    expect(actions.signOut).toHaveBeenCalledTimes(1)
    c.toggleViewAsMenu()
    const crew = c.vals().viewAs.options.find((o) => o.name === 'Crew')!
    crew.onClick()
    expect(actions.viewAs).toHaveBeenCalledWith('role-crew')
    expect(c.vals().viewAs.menuOpen).toBe(false)
    c.vals()
      .viewAs.options.find((o) => o.name === 'Super Admin')!
      .onClick()
    expect(actions.viewAs).toHaveBeenLastCalledWith(null) // the locked role means "stop viewing as"
    c.vals().viewAs.exit()
    expect(actions.viewAs).toHaveBeenLastCalledWith(null)
    c.themeChanged('dark', 'light')
    expect(actions.themeChanged).toHaveBeenCalledWith('dark', 'light')
  })

  it('view-as options: design wording and the selected highlight', () => {
    const c = new LiveChrome()
    c.setSession(makeSession({ role: 'super' }))
    let o = c.vals().viewAs.options
    expect(o.map((x) => [x.name, x.lim])).toEqual([
      ['Super Admin', 'refunds no limit'],
      ['Management', 'refunds ≤ $1000'],
      ['Crew', 'refunds ≤ $25'],
    ])
    // not viewing anyone: the person's own (locked) role is the highlighted one
    expect(o.map((x) => x.style.background)).toEqual(['var(--accentSoft)', 'transparent', 'transparent'])
    expect(o[0]!.style).toMatchObject({
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      padding: '9px 10px',
      borderRadius: '10px',
    })
    c.setSession(
      makeSession({
        role: 'super',
        viewAs: {
          active: true,
          canViewAs: true,
          roleId: 'role-crew',
          roleName: 'Crew',
          options: SUPER_OPTIONS,
        },
      }),
    )
    o = c.vals().viewAs.options
    expect(o.map((x) => x.style.background)).toEqual(['transparent', 'transparent', 'var(--accentSoft)'])
    expect(c.vals().viewAs.active).toBe(true)
    expect(c.vals().viewAs.label).toBe('Crew')
  })

  it('a role without refund permission reads "no refunds"; the label is the person’s role when not viewing', () => {
    const c = new LiveChrome()
    c.setSession(
      makeSession({
        role: 'super',
        viewAs: {
          active: false,
          canViewAs: true,
          roleId: null,
          roleName: null,
          options: [{ id: 'r', key: null, name: 'Intern', locked: false, limits: {} }],
        },
      }),
    )
    expect(c.vals().viewAs.options[0]!.lim).toBe('no refunds')
    expect(c.vals().viewAs.label).toBe('Super Admin')
  })

  it('a non-Super session cannot view as anyone', () => {
    const c = new LiveChrome()
    c.setSession(makeSession({ role: 'mgmt' }))
    expect(c.vals().canViewAs).toBe(false)
    expect(c.vals().viewAs.options).toEqual([])
    expect(makeMe({ role: 'crew' }).viewAs.canViewAs).toBe(false)
  })
})
