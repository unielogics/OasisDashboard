import { describe, expect, it, vi } from 'vitest'
import { LiveChrome, shortName } from './chrome'
import { SUPER_OPTIONS, makeKioskSession, makeMe, makeSession } from './test-fixtures'

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

describe('LiveChrome in kiosk mode (ADR 0180)', () => {
  it('the chip names the tablet and its lock time; the menu says Lock kiosk and Manager sign-in (DV-1003)', () => {
    const c = new LiveChrome()
    c.setSession(makeKioskSession())
    const v = c.vals()
    expect(v.user).toEqual({
      initials: 'K',
      name: 'Front desk tablet',
      short: 'Front desk tablet',
      email: 'Unlocked 7:58 AM · locks 9:00 PM',
      roleTitle: 'Locks at 9:00 PM',
    })
    expect(v.menu.signOutLabel).toBe('Lock kiosk')
    expect(v.menu.isKiosk).toBe(true)
    expect(v.menu.canMakeKiosk).toBe(false)
    expect(v.showAdminNav).toBe(false)
    expect(v.kiosk.on).toBe(true)
    expect(v.adminKiosk.on).toBe(false)
    expect(v.canViewAs).toBe(false)
  })

  it('Lock kiosk asks first; Lock locks (the session’s sign-out), Cancel keeps it open', () => {
    const signOut = vi.fn()
    const c = new LiveChrome()
    c.bind({ signOut, viewAs: vi.fn() })
    c.setSession(makeKioskSession())
    c.toggleUserMenu()
    c.vals().menu.signOut()
    expect(signOut).not.toHaveBeenCalled()
    expect(c.vals().menu.confirming).toBe(true)
    expect(c.vals().menu.showSignOut).toBe(false)
    c.vals().menu.cancelLock()
    expect(c.vals().menu.confirming).toBe(false)
    expect(c.vals().menu.showSignOut).toBe(true)
    c.vals().menu.signOut()
    c.vals().menu.confirmLock()
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(c.vals().menu.open).toBe(false)
  })

  it('Manager sign-in opens the sign-in page with ?admin=1 (the email form stays behind 0218)', () => {
    const navigate = vi.fn()
    const c = new LiveChrome()
    c.bind({ signOut: vi.fn(), viewAs: vi.fn(), navigate })
    c.setSession(makeKioskSession())
    c.vals().menu.managerSignIn()
    expect(navigate).toHaveBeenCalledWith('/login?admin=1')
  })

  it('the picker list follows the session; a signed-in person has none', () => {
    const c = new LiveChrome()
    c.setSession(makeKioskSession())
    expect(c.picker.people().map((p) => p.name)).toEqual(['Marco R.', 'Lena K.', 'Sofia P.'])
    c.setSession(makeSession())
    expect(c.picker.people()).toEqual([])
    expect(c.vals().kiosk).toMatchObject({ on: false })
    expect(c.vals().showAdminNav).toBe(true)
    expect(c.vals().menu.signOutLabel).toBe('Sign out')
  })

  it('“Make this a kiosk…” for people who may manage kiosks (team.roles), opening Settings → Kiosk (DV-1012)', () => {
    const navigate = vi.fn()
    const c = new LiveChrome()
    c.bind({ signOut: vi.fn(), viewAs: vi.fn(), navigate })
    c.setSession(makeSession({ role: 'mgmt' }))
    expect(c.vals().menu.canMakeKiosk).toBe(true)
    c.vals().menu.makeKiosk()
    expect(navigate).toHaveBeenCalledWith('/settings#kiosk')
    // Team activity… for team.edit (DV-1009: the Settings nav has no room for a Shop floor group)
    expect(c.vals().menu.canTeamActivity).toBe(true)
    c.vals().menu.teamActivity()
    expect(navigate).toHaveBeenCalledWith('/settings#activity')
    c.setSession(makeSession({ role: 'crew' }))
    expect(c.vals().menu.canMakeKiosk).toBe(false)
    expect(c.vals().menu.canTeamActivity).toBe(false)
    c.setSession(makeKioskSession())
    expect(c.vals().menu.canTeamActivity).toBe(false)
  })

  it('a person signed in on a kiosk tablet sees the bar; no “Make this a kiosk…” there (DV-1008)', () => {
    const signOut = vi.fn()
    const c = new LiveChrome()
    c.bind({ signOut, viewAs: vi.fn() })
    c.setSession(makeSession({ role: 'mgmt', kioskDevice: { id: 'dev-1', name: 'Front desk tablet' } }))
    const v = c.vals()
    expect(v.adminKiosk.on).toBe(true)
    expect(v.adminKiosk.text).toBe(
      'Signed in as Rafael M. on Front desk tablet · signs out after 15 minutes without use',
    )
    expect(v.menu.canMakeKiosk).toBe(false)
    expect(v.showAdminNav).toBe(true)
    v.adminKiosk.signOut()
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('a picker question re-renders the screens (its values are under kiosk.picker)', async () => {
    const c = new LiveChrome()
    c.setSession(makeKioskSession())
    const l = vi.fn()
    c.subscribe(l)
    const a = c.picker.pick({ title: 'Who’s starting Maria’s Camry?' })
    expect(l).toHaveBeenCalled()
    expect(c.vals().kiosk.picker.open).toBe(true)
    expect(c.vals().kiosk.picker.title).toBe('Who’s starting Maria’s Camry?')
    c.vals().kiosk.picker.tiles[0]!.onClick()
    await expect(a).resolves.toBe('emp-marco')
    expect(c.vals().kiosk.picker.open).toBe(false)
  })
})
