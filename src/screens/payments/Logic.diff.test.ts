// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// Differential tests: the typed view model against the ORIGINAL class (evaluated from design/extracted) on the same
// data, clock and storage. renderVals() must serialise identically (values AND key order), handlers must produce the
// same state, and the toasts and timers must agree, across scripted flows and thousands of seeded random steps.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEF_ROLES } from './fixtures'
import { serializeVals } from '@/dc/serialize'
import { atPath, firstDiff, handlerPaths, makePair, seeded, serial } from './testkit'

beforeAll(() => {
  process.env.TZ = 'America/New_York'
})
beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-06-13T10:36:00-04:00') })
  localStorage.clear()
})
afterEach(() => vi.useRealTimers())
afterAll(() => vi.useRealTimers())

type P = ReturnType<typeof makePair>

/** Renders both sides. When the original throws, the port must throw the same message (the host then shows its error card). */
function renderBoth(p: P): { vo: any; vp: any } | null {
  let vo: any, vp: any, eo: any, ep: any
  try {
    vo = p.orig.renderVals()
  } catch (e) {
    eo = e
  }
  try {
    vp = p.port.renderVals()
  } catch (e) {
    ep = e
  }
  if (eo || ep) {
    expect(ep?.message, 'port render result differs from the original (threw vs not)').toBe(eo?.message)
    return null
  }
  return { vo, vp }
}

/** Renders both sides, asserts they serialise identically (key order included) and that the states agree. */
function compare(p: P, what = ''): { vo: any; vp: any } | null {
  const r = renderBoth(p)
  if (r) {
    const d = firstDiff(serializeVals(r.vo), serializeVals(r.vp))
    expect(d, `renderVals differ ${what}: ${d}`).toBeNull()
  }
  expect(JSON.stringify(p.port.state), `state differs ${what}`).toBe(JSON.stringify(p.orig.state))
  return r
}

const same = (p: P, what = ''): void => void compare(p, what)

const ev = (value = '') => ({ target: { value }, stopPropagation() {}, preventDefault() {} })

/** Clicks the unique handler found at `path` on both sides (paths come from the original's vals). */
function click(p: ReturnType<typeof makePair>, path: string, value?: string): void {
  const fo = atPath(p.orig.renderVals(), path)
  const fn = atPath(p.port.renderVals(), path)
  expect(typeof fo, `original has no handler at ${path}`).toBe('function')
  expect(typeof fn, `port has no handler at ${path}`).toBe('function')
  fo(ev(value))
  fn(ev(value))
}

/** Clicks the detail action whose label starts with `label` ("Refund", "Collect", "Apply", "Adjust", "Issue", "Send"). */
function action(p: ReturnType<typeof makePair>, label: string): void {
  const acts = p.orig.renderVals().d.actions as { label: string }[]
  const i = acts.findIndex((a) => a.label.startsWith(label))
  expect(i, `no action "${label}" among ${acts.map((a) => a.label).join(', ')}`).toBeGreaterThanOrEqual(0)
  click(p, `d.actions[${i}].onClick`)
}

describe('initial render', () => {
  it('serialises identically to the original, key order included', () => {
    const p = makePair()
    same(p, 'initial')
    expect(serial(p.port)).toBeTruthy()
  })

  it('starts from the same state, with the same key order', () => {
    const p = makePair()
    expect(Object.keys(p.port.state)).toEqual(Object.keys(p.orig.state))
    expect(JSON.stringify(p.port.state)).toBe(JSON.stringify(p.orig.state))
  })

  it('reads the theme and the roles from localStorage like the original', () => {
    localStorage.setItem('oasis-theme', 'dark')
    const custom = JSON.parse(JSON.stringify(DEF_ROLES))
    custom.roles.push({ id: 'ops', name: 'Ops Lead' })
    custom.perms.ops = { 'pay.reports': 1, 'pay.refund': 1 }
    custom.limits.ops = { refund: 75 }
    localStorage.setItem('oasis-roles', JSON.stringify(custom))
    const p = makePair()
    same(p, 'custom roles')
    expect(p.port.state.theme).toBe('dark')
    expect(p.port.state.rc.roles.map((r: any) => r.id)).toContain('ops')
  })

  it('falls back to the defaults when storage holds garbage', () => {
    localStorage.setItem('oasis-roles', '{not json')
    const p = makePair()
    same(p, 'garbage roles')
    expect(p.port.state.rc).toEqual(DEF_ROLES)
  })

  it('every combination of range, filter, query and role matches', () => {
    const p = makePair()
    for (const role of ['super', 'mgmt', 'acct', 'support', 'crew']) {
      for (const range of ['today', '7d', '30d', 'mtd']) {
        for (const filter of ['all', 'unpaid', 'refunds', 'adjusted', 'credits']) {
          for (const query of ['', 'tesla', 'INV-2060', '  Priya  ', 'wax', 'zzzz']) {
            for (const logic of [p.orig, p.port]) logic.state = { ...logic.state, role, range, filter, query }
            same(p, `${role}/${range}/${filter}/${query}`)
          }
        }
      }
    }
  })

  it('every invoice selected shows the same detail, ledger and actions', () => {
    const p = makePair()
    const ids = p.orig.state.txs.map((t: any) => t.id) as string[]
    expect(ids.length).toBeGreaterThan(100)
    for (const id of ids) {
      for (const logic of [p.orig, p.port]) logic.state = { ...logic.state, selId: id }
      same(p, id)
    }
  })

  it('an unknown selection falls back to the first invoice, and so does the original', () => {
    const p = makePair()
    for (const logic of [p.orig, p.port]) logic.state = { ...logic.state, selId: 'INV-NOPE' }
    same(p, 'unknown selection')
  })
})

describe('methods match the original member by member', () => {
  it('calc, clientCredit, lim, roleName, fmtDate, dateOf, pill, seg, chip, money on every invoice and client', () => {
    const p = makePair()
    for (const tx of p.orig.state.txs) {
      expect(p.port.calc(tx)).toEqual(p.orig.calc(tx))
      expect(p.port.clientCredit(tx.client)).toBe(p.orig.clientCredit(tx.client))
      expect(p.port.fmtDate(tx.off)).toBe(p.orig.fmtDate(tx.off))
    }
    for (const role of ['super', 'mgmt', 'acct', 'support', 'crew', 'nobody', undefined]) {
      for (const kind of ['refund', 'adjust', 'credit', 'collect', 'reports']) {
        expect(p.port.lim(kind, role)).toEqual(p.orig.lim(kind, role))
      }
      if (role) expect(p.port.roleName(role)).toBe(p.orig.roleName(role))
    }
    for (let off = -40; off <= 3; off++)
      expect(p.port.dateOf(off).getTime()).toBe(p.orig.dateOf(off).getTime())
    for (const st of [
      'Paid',
      'Unpaid',
      'Partially paid',
      'Refunded',
      'Canceled · refunded',
      'Partially refunded',
      'x',
    ])
      expect(p.port.pill(st)).toEqual(p.orig.pill(st))
    for (const on of [true, false]) {
      expect(p.port.seg(on)).toEqual(p.orig.seg(on))
      expect(p.port.chip(on)).toEqual(p.orig.chip(on))
    }
    for (const n of [0, -0, 0.005, 1.005, -3.456, 1234567.891, 37.45, 1e9])
      expect([p.port.money(n), p.port.money0(n), p.port.r2(n)]).toEqual([
        p.orig.money(n),
        p.orig.money0(n),
        p.orig.r2(n),
      ])
    expect(p.port.nowT()).toBe(p.orig.nowT())
  })
})

describe('scripted flows', () => {
  const flow = (name: string, steps: (p: ReturnType<typeof makePair>) => void) =>
    it(name, () => {
      const p = makePair()
      steps(p)
      same(p, name)
    })

  flow('refund an invoice in full, then see the pending state and the toast expire', (p) => {
    for (const logic of [p.orig, p.port]) logic.state = { ...logic.state, selId: 'INV-20601' }
    action(p, 'Refund')
    same(p, 'sheet open')
    expect(p.port.state.sheet).toBe('refund')
    click(p, 'sh.submit')
    same(p, 'submitted')
    expect(p.port.state.toast).toMatch(/^Refunded \$/)
    vi.advanceTimersByTime(3000)
    same(p, 'toast expired')
    expect(p.port.state.toast).toBeNull()
  })

  flow('a refund over the role limit goes to approval, and Management can approve it', (p) => {
    click(p, 'roleOpts[3].onClick')
    for (const logic of [p.orig, p.port]) logic.state = { ...logic.state, selId: 'INV-20608' }
    action(p, 'Refund')
    click(p, 'sh.submit')
    expect(p.port.state.toast).toMatch(/^Sent for approval/)
    click(p, 'roleOpts[1].onClick')
    same(p, 'switched to management')
    const ledger = p.orig.renderVals().d.ledger
    const idx = ledger.findIndex((e: any) => e.pending)
    expect(idx).toBeGreaterThanOrEqual(0)
    click(p, `d.ledger[${idx}].approve`)
    expect(p.port.state.toast).toMatch(/^Refund approved/)
  })

  flow('approving the seeded pending refund as a role without enough limit is refused', (p) => {
    click(p, 'roleOpts[3].onClick')
    click(p, 'openPending')
    same(p, 'after openPending')
    const ledger = p.orig.renderVals().d.ledger
    const idx = ledger.findIndex((e: any) => e.pending)
    click(p, `d.ledger[${idx}].approve`)
    expect(p.port.state.toast).toMatch(/can’t approve/)
  })

  flow('deny the seeded pending refund', (p) => {
    click(p, 'openPending')
    const idx = p.orig.renderVals().d.ledger.findIndex((e: any) => e.pending)
    click(p, `d.ledger[${idx}].deny`)
    expect(p.port.state.toast).toBe('Refund request denied')
  })

  flow('collect the balance on the unpaid invoice by card and by cash and by link', (p) => {
    action(p, 'Collect')
    click(p, 'sh.payMethods[1].onClick')
    same(p, 'cash chosen')
    click(p, 'sh.submit')
    same(p, 'collected')
    click(p, 'ranges[0].onClick')
    same(p, 'today')
  })

  flow('payment link sends no ledger event', (p) => {
    action(p, 'Collect')
    click(p, 'sh.payMethods[2].onClick')
    click(p, 'sh.submit')
    expect(p.port.state.toast).toMatch(/^Payment link sent/)
  })

  flow('apply store credit on an invoice whose client holds credit', (p) => {
    for (const logic of [p.orig, p.port]) logic.state = { ...logic.state, selId: 'INV-20603' }
    action(p, 'Apply')
    same(p, 'apply sheet')
    expect(p.port.state.sheet).toBe('apply')
    click(p, 'sh.submit')
    expect(p.port.state.toast).toMatch(/credit applied$/)
  })

  flow('adjust with a percentage discount on a paid invoice and settle to card', (p) => {
    for (const logic of [p.orig, p.port]) logic.state = { ...logic.state, selId: 'INV-20601' }
    action(p, 'Adjust')
    click(p, 'sh.units[1].onClick')
    click(p, 'sh.setAmount', '10')
    click(p, 'sh.settles[1].onClick')
    same(p, 'discount previewed')
    click(p, 'sh.submit')
    same(p, 'discount applied')
  })

  flow('surcharge then credit with a custom note', (p) => {
    action(p, 'Adjust')
    click(p, 'sh.kinds[1].onClick')
    click(p, 'sh.setAmount', '12.5')
    click(p, 'sh.setNote', 'oversize')
    click(p, 'sh.submit')
    action(p, 'Issue')
    click(p, 'sh.setAmount', '30')
    click(p, 'sh.expiries[2].onClick')
    click(p, 'sh.reasons[2].onClick')
    click(p, 'sh.submit')
  })

  flow('refund by item toggles rows on and off', (p) => {
    for (const logic of [p.orig, p.port]) logic.state = { ...logic.state, selId: 'INV-20602' }
    action(p, 'Refund')
    click(p, 'sh.modes[1].onClick')
    click(p, 'sh.itemRows[0].onClick')
    click(p, 'sh.itemRows[1].onClick')
    click(p, 'sh.itemRows[0].onClick')
    same(p, 'items toggled')
    click(p, 'sh.dests[1].onClick')
    click(p, 'sh.submit')
  })

  flow('locked state, role menu, theme toggle and search', (p) => {
    click(p, 'toggleRoleMenu')
    same(p, 'menu open')
    click(p, 'roleOpts[4].onClick')
    same(p, 'crew is locked')
    expect(p.port.renderVals().locked).toBe(true)
    click(p, 'toggleTheme')
    same(p, 'dark')
    expect(localStorage.getItem('oasis-theme')).toBe('dark')
    click(p, 'roleOpts[0].onClick')
    click(p, 'onQuery', 'tesla')
    same(p, 'searched')
    click(p, 'exportCsv')
    expect(p.port.state.toast).toMatch(/^CSV export started · \d+ invoices$/)
  })

  flow('a second toast replaces the first and the timer restarts', (p) => {
    click(p, 'exportCsv')
    vi.advanceTimersByTime(2000)
    action(p, 'Send')
    vi.advanceTimersByTime(2000)
    same(p, 'second toast still up')
    expect(p.port.state.toast).toMatch(/^Receipt sent/)
    vi.advanceTimersByTime(1000)
    same(p, 'both expired')
    expect(p.port.state.toast).toBeNull()
  })

  flow('ledger stamps follow the clock when an event is added', (p) => {
    vi.setSystemTime(new Date('2026-06-13T15:07:00-04:00'))
    for (const logic of [p.orig, p.port]) logic.state = { ...logic.state, selId: 'INV-20601' }
    action(p, 'Issue')
    click(p, 'sh.setAmount', '10')
    click(p, 'sh.submit')
    const last = p.port.state.txs.find((t: any) => t.id === 'INV-20601').events.at(-1)
    expect(last.t).toBe('Today 3:07 PM')
  })
})

describe('quirks kept on purpose', () => {
  it('a stale by-item selection on a smaller invoice throws the same TypeError in both classes', () => {
    const p = makePair()
    const one = p.orig.state.txs.find((t: any) => t.items.length === 1).id
    for (const logic of [p.orig, p.port])
      logic.state = {
        ...logic.state,
        selId: one,
        sheet: 'refund',
        f: { mode: 'items', items: [2], dest: 'card', reason: null, note: '', amount: '' },
      }
    expect(() => p.orig.renderVals()).toThrow(TypeError)
    expect(() => p.port.renderVals()).toThrow(TypeError)
    expect(renderBoth(p)).toBeNull()
  })

  it('the generated history reuses invoice ids of the hand-written ones, and the first match wins', () => {
    const p = makePair()
    const ids = p.port.state.txs.map((t: any) => t.id) as string[]
    expect(ids.length).toBeGreaterThan(new Set(ids).size)
    expect(ids.filter((i) => i === 'INV-20608').length).toBeGreaterThan(1)
  })
})

const AMOUNTS = [
  '',
  '0',
  '5',
  '12.5',
  '25',
  '26',
  '49.99',
  '50',
  '51',
  '100',
  '250',
  '499',
  '501',
  '1000',
  '1001',
  'abc',
  '$30',
  '1e3',
  '.5',
  '10.555',
  '-5',
  '999999',
  '37.45',
  '80',
]
const QUERIES = ['', 'tesla', 'INV-206', 'Priya', 'wax', '  BMW ', 'zzzz', 'Detail', 'victor']
const NOTES = ['', 'x', 'long note about the stain']

function customRoles(seed: number): unknown {
  const r = seeded(seed)
  const rc = JSON.parse(JSON.stringify(DEF_ROLES))
  for (const id of ['mgmt', 'acct', 'support', 'crew']) {
    for (const k of ['refund', 'adjust', 'credit']) {
      const x = r()
      if (x < 0.2) delete rc.limits[id][k]
      else if (x < 0.3) rc.limits[id][k] = null
      else if (x < 0.4) rc.limits[id][k] = Math.round(r() * 100) / 4
    }
    if (r() < 0.2) delete rc.limits[id]
    if (r() < 0.25) rc.perms[id]['pay.reports'] = 1
    if (r() < 0.2) delete rc.perms[id]['pay.collect']
  }
  if (r() < 0.3) delete rc.perms.crew
  return rc
}

describe('random interaction walks', () => {
  const covered = new Set<string>()
  const toasts = new Set<string>()

  const walk = (seed: number, steps: number) => {
    const rng = seeded(seed)
    if (seed % 3 === 1) localStorage.setItem('oasis-roles', JSON.stringify(customRoles(seed)))
    if (seed % 4 === 0) localStorage.setItem('oasis-theme', 'dark')
    const p = makePair()
    const histO: any[] = []
    const histP: any[] = []
    for (let i = 0; i < steps; i++) {
      const both = compare(p, `seed ${seed} step ${i}`)
      if (!both) {
        covered.add('render-throws')
        break
      }
      const { vo, vp } = both
      histO.push(vo)
      histP.push(vp)
      if (histO.length > 5) {
        histO.shift()
        histP.shift()
      }
      const sheetOpen = vo.sheetOpen as boolean
      if (sheetOpen)
        covered.add(
          'sheet:' +
            (vo.sh.isRefund
              ? 'refund'
              : vo.sh.isAdjust
                ? 'adjust'
                : vo.sh.isCredit
                  ? 'credit'
                  : vo.sh.isCollect
                    ? 'collect'
                    : 'apply'),
        )
      if (vo.locked) covered.add('locked')
      if (vo.hasPending) covered.add('hasPending')
      if (vo.noRows) covered.add('noRows')
      if (vo.sh?.blocked) covered.add('blocked')
      if (vo.sh?.showSettle) covered.add('showSettle')
      if (vo.toast) toasts.add(String(vo.toast).replace(/[$−0-9.,]+/g, '#'))
      const paths = handlerPaths(vo)
      const weights = paths.map((pth) =>
        sheetOpen && pth.startsWith('sh.')
          ? 5
          : pth.startsWith('d.actions')
            ? 3
            : pth === 'toggleTheme'
              ? 0.3
              : 1,
      )
      let pick = rng() * weights.reduce((a, b) => a + b, 0)
      let k = 0
      while (k < paths.length - 1 && (pick -= weights[k]!) > 0) k++
      const path = paths[k]!
      const value =
        path === 'onQuery'
          ? QUERIES[Math.floor(rng() * QUERIES.length)]
          : path === 'sh.setNote'
            ? NOTES[Math.floor(rng() * NOTES.length)]
            : AMOUNTS[Math.floor(rng() * AMOUNTS.length)]
      // sometimes fire a handler captured a few renders ago (a stale closure), on both sides alike
      const j = rng() < 0.12 && histO.length > 1 ? Math.floor(rng() * (histO.length - 1)) : histO.length - 1
      const fo = atPath(histO[j], path) ?? atPath(vo, path)
      const fp = atPath(histP[j], path) ?? atPath(vp, path)
      fo(ev(value))
      fp(ev(value))
      if (rng() < 0.3) vi.advanceTimersByTime(Math.floor(rng() * 5000))
    }
    same(p, `seed ${seed} end`)
  }

  it('250 steps on each of 16 seeds (default and custom roles, both themes) stay identical', () => {
    for (let seed = 1; seed <= 16; seed++) {
      localStorage.clear()
      vi.setSystemTime(new Date('2026-06-13T10:36:00-04:00'))
      walk(seed, 250)
    }
  }, 300_000)

  it('the walks reached every sheet, the locked screen, blocked submits and every kind of toast', () => {
    for (const c of [
      'sheet:refund',
      'sheet:adjust',
      'sheet:credit',
      'sheet:collect',
      'sheet:apply',
      'locked',
      'hasPending',
      'blocked',
      'showSettle',
    ])
      expect(covered, c).toContain(c)
    const text = [...toasts].join('\n')
    const want = [
      'Refunded',
      'Sent for approval',
      'Discount applied',
      'Surcharge applied',
      'credit issued',
      'Collected',
      'credit applied',
      'Refund approved',
      'Refund request denied',
      'can’t approve',
      'Receipt sent',
      'CSV export started',
    ]
    expect(want.filter((t) => !text.includes(t))).toEqual([])
  })
})
