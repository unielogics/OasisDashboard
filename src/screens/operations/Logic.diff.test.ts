// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// Differential tests: the typed view model against the ORIGINAL class (design/extracted/operations/logic.original.js,
// evaluated by the screens' own loader). Each scenario runs once per implementation with the same frozen clock and the
// same storage; the serialised renderVals() and the state must be identical after every step.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { call, implementations, mount, pointer, read, snap } from './testkit'
import type { Ctor } from './testkit'

const FROZEN = new Date('2026-06-13T10:36:00-04:00')

beforeAll(() => {
  process.env.TZ = 'America/New_York'
})
beforeEach(() => {
  vi.useFakeTimers({ now: FROZEN })
  localStorage.clear()
})
afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
  document.body.style.userSelect = ''
})
afterAll(() => vi.useRealTimers())

type Step = [name: string, run: (l: any) => unknown]

/** Runs the steps on one implementation and returns a snapshot after each (and before the first). */
function trace(Ctor: Ctor, steps: Step[], opts: { storage?: Record<string, unknown> } = {}) {
  vi.setSystemTime(FROZEN)
  localStorage.clear()
  for (const [k, v] of Object.entries(opts.storage ?? {}))
    localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v))
  const { logic, dispose } = mount(Ctor)
  try {
    const out: Array<[string, ReturnType<typeof snap> & { extra?: unknown }]> = [['initial', snap(logic)]]
    for (const [name, run] of steps) {
      const extra = run(logic)
      out.push([name, { ...snap(logic), extra }])
    }
    return out
  } finally {
    dispose()
  }
}

function same(steps: Step[], opts: { storage?: Record<string, unknown> } = {}) {
  const [[, O], [, P]] = implementations()
  const a = trace(O!, steps, opts)
  const b = trace(P!, steps, opts)
  expect(b.map(([n]) => n)).toEqual(a.map(([n]) => n))
  a.forEach(([name, sa], i) => {
    const sb = b[i]![1] as typeof sa
    expect(sb.state, `state after ${name}`).toEqual(sa.state)
    expect(sb.vals, `renderVals after ${name}`).toEqual(sa.vals)
    expect(sb.extra, `observations after ${name}`).toEqual(sa.extra)
  })
  return a
}

describe('initial render', () => {
  it('matches in light', () => {
    same([])
  })
  it('matches in dark (theme from storage)', () => {
    same([], { storage: { 'oasis-theme': 'dark' } })
  })
  it('matches with an emergency banner, custom hours, closures and checklist overrides', () => {
    same([['tick', () => vi.advanceTimersByTime(1000)]], {
      storage: {
        'oasis-emergency': { active: true, summary: 'Closed for a storm' },
        'oasis-hours': [
          { open: false, from: '9:00 AM', to: '3:00 PM' },
          { open: true, from: '7:00 AM', to: '7:30 PM' },
          { open: true, from: '8:00 AM', to: '6:00 PM' },
          { open: true, from: '8:00 AM', to: '6:00 PM' },
          { open: true, from: '8:00 AM', to: '6:00 PM' },
          { open: true, from: '8:00 AM', to: '6:00 PM' },
          { open: true, from: '8:00 AM', to: '5:00 PM' },
        ],
        'oasis-closures': [{ date: '2026-06-14', name: 'Storm', type: 'closed' }],
        'oasis-checklists': {
          packages: { 'Express Hand Wash': ['Rinse', 'Final inspection', 'Dry'], Nope: ['x'] },
          addons: { Wax: ['Wax it', 'Buff inspection'] },
        },
      },
    })
  })
  it('tolerates unreadable storage values', () => {
    same([], { storage: { 'oasis-hours': 'not json {', 'oasis-emergency': 'also {not json' } })
  })
})

describe('sanity of the harness', () => {
  it('the snapshot is not trivially empty', () => {
    const [[, O]] = implementations()
    const t = trace(O!, [])
    const vals = t[0]![1].vals as any
    expect(vals.kpis).toHaveLength(7)
    expect(vals.alerts.length).toBeGreaterThan(5)
    expect(read(mount(O!).logic, 'bays.0.occupied')).toBe(true)
    void call
  })
})

const ALL_IDS = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12']
const TABS = ['overview', 'checklist', 'addons', 'photos', 'messages', 'payments', 'membership', 'history']
const open = (id: string, tab = 'overview'): Step => [
  `open ${id} ${tab}`,
  (l) => l.setState({ selectedId: id, modalTab: tab }),
]

describe('board controls', () => {
  it('view tabs, range tabs, search and theme', () => {
    const steps: Step[] = []
    for (let i = 0; i < 4; i++) steps.push([`view ${i}`, (l) => call(l, `viewTabs.${i}.onClick`)])
    for (let i = 0; i < 4; i++) steps.push([`range ${i}`, (l) => call(l, `rangeTabs.${i}.onClick`)])
    for (const q of ['marcus', 'BMW', ' 786 ', 'zzzz', 'express', 'abc-1234', '']) {
      steps.push([`search ${q}`, (l) => call(l, 'onSearch', { target: { value: q } })])
    }
    steps.push(['view bay', (l) => call(l, 'viewTabs.1.onClick')])
    steps.push(['view staff', (l) => call(l, 'viewTabs.2.onClick')])
    steps.push(['search in staff', (l) => call(l, 'onSearch', { target: { value: 'lena' } })])
    steps.push(['theme', (l) => call(l, 'toggleTheme')])
    steps.push(['stored theme', () => localStorage.getItem('oasis-theme')])
    steps.push(['theme back', (l) => call(l, 'toggleTheme')])
    same(steps)
  })

  it('new appointment and walk-in panel, service and slot picking, toasts expire', () => {
    const steps: Step[] = [
      ['open', (l) => call(l, 'openNew')],
      ['walkin', (l) => call(l, 'openWalkin')],
      ['n key resets nothing', (l) => l.setState({ newOpen: false })],
      ['key n', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }))],
    ]
    for (let i = 0; i < 5; i++) steps.push([`service ${i}`, (l) => call(l, `newServices.${i}.pick`)])
    for (let i = 0; i < 8; i++) steps.push([`slot ${i}`, (l) => call(l, `newSlots.${i}.pick`)])
    steps.push(['toast stays', () => vi.advanceTimersByTime(3000)])
    steps.push(['toast gone', () => vi.advanceTimersByTime(300)])
    steps.push(['book', (l) => call(l, 'createAppt')])
    steps.push(['close', (l) => call(l, 'closeNew')])
    same(steps)
  })

  it('the one second tick and the minute boundary', () => {
    const steps: Step[] = []
    for (let i = 0; i < 5; i++) steps.push([`tick ${i}`, () => vi.advanceTimersByTime(1000)])
    steps.push(['60s', () => vi.advanceTimersByTime(60000)])
    steps.push(['10 min', () => vi.advanceTimersByTime(600000)])
    steps.push(['to 75 min', () => vi.advanceTimersByTime(60 * 60000)])
    same(steps)
  })
})

describe('appointment file and commands', () => {
  it('every appointment, every tab', () => {
    const steps: Step[] = []
    for (const id of ALL_IDS) for (const tab of TABS) steps.push(open(id, tab))
    steps.push(['close', (l) => call(l, 'closeModal')])
    same(steps)
  })

  it('modal tab buttons, quick message, scrim handlers', () => {
    const steps: Step[] = [open('a4')]
    for (let i = 0; i < 8; i++) steps.push([`tab ${i}`, (l) => call(l, `sel.tabs.${i}.onClick`)])
    steps.push(['quick message', (l) => call(l, 'sel.quickMsg')])
    steps.push(['stop', (l) => call(l, 'stop', { stopPropagation() {} })])
    steps.push(['close', (l) => call(l, 'closeModal')])
    same(steps)
  })

  it('checklist: single, section, all, for packages with add-ons', () => {
    const steps: Step[] = [open('a4', 'checklist')]
    steps.push(['row 0', (l) => call(l, 'sel.checkSections.0.items.0.toggle')])
    steps.push(['row 0 again', (l) => call(l, 'sel.checkSections.0.items.0.toggle')])
    steps.push(['row 3', (l) => call(l, 'sel.checkSections.0.items.3.toggle')])
    steps.push(['section 1', (l) => call(l, 'sel.checkSections.1.toggle')])
    steps.push(['section 0', (l) => call(l, 'sel.checkSections.0.toggle')])
    steps.push(['all', (l) => call(l, 'sel.checkAllToggle')])
    steps.push(['all again', (l) => call(l, 'sel.checkAllToggle')])
    steps.push(['all third', (l) => call(l, 'sel.checkAllToggle')])
    steps.push(open('a9', 'checklist'))
    steps.push(['a9 all', (l) => call(l, 'sel.checkAllToggle')])
    same(steps)
  })

  it('add-ons: toggle every row on and off, totals and checklist follow', () => {
    const steps: Step[] = [open('a8', 'addons')]
    for (let i = 0; i < 10; i++) steps.push([`on ${i}`, (l) => call(l, `sel.addonCatalog.${i}.toggle`)])
    steps.push(open('a8', 'payments'))
    steps.push(open('a8', 'checklist'))
    for (let i = 0; i < 10; i++) steps.push([`off ${i}`, (l) => call(l, `sel.addonCatalog.${i}.toggle`)])
    same(steps)
  })

  it('message templates, collect, notify and payment link', () => {
    const steps: Step[] = [open('a8', 'messages')]
    for (let i = 0; i < 7; i++) steps.push([`template ${i}`, (l) => call(l, `sel.templates.${i}.send`)])
    steps.push(open('a8', 'payments'))
    steps.push(['link', (l) => call(l, 'sel.sendLink')])
    steps.push(['collect', (l) => call(l, 'sel.collect')])
    steps.push(['notify a3', (l) => l.notify('a3')])
    steps.push(open('a3', 'messages'))
    steps.push(['collect a5', (l) => l.collect('a5')])
    steps.push(['collect unknown', (l) => l.collect('nope')])
    same(steps)
  })

  it('advance every appointment through its whole flow', () => {
    const steps: Step[] = []
    for (const id of ALL_IDS) {
      for (let i = 0; i < 7; i++) steps.push([`advance ${id} ${i}`, (l) => l.advance(id)])
    }
    steps.push(['advance unknown', (l) => l.advance('nope')])
    for (const id of ['a1', 'a5', 'a8']) steps.push(open(id, 'messages'))
    same(steps)
  })

  it('modal doNext and the s, r, p, m keys', () => {
    const key = (k: string, init: KeyboardEventInit = {}) =>
      [`key ${k}`, () => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ...init }))] as Step
    const steps: Step[] = [
      key('s'),
      open('a8'),
      key('m'),
      key('p'),
      key('s'),
      key('r'),
      key('S'),
      key('R'),
      ['doNext', (l) => call(l, 'sel.doNext')],
      ['doNext', (l) => call(l, 'sel.doNext')],
      key('r', { ctrlKey: true }),
      key('Escape'),
      key('n'),
      key('Escape'),
      key('/'),
      key('ArrowLeft'),
      ['view calendar', (l) => call(l, 'viewTabs.3.onClick')],
      key('ArrowLeft'),
      key('ArrowLeft'),
      key('ArrowRight'),
      key('t'),
      key('T'),
      key('x'),
      open('a2'),
      key('ArrowLeft'),
      key('t'),
      key('Escape'),
    ]
    same(steps)
  })

  it('typing in an input swallows shortcuts except Escape, which blurs', () => {
    const [[, O], [, P]] = implementations()
    const run = (C: Ctor) => {
      const { logic, dispose } = mount(C)
      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()
      const out: unknown[] = []
      for (const k of ['n', 's', '/', 'Escape']) {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
        out.push([k, logic.state.newOpen, logic.state.selectedId, document.activeElement === input])
      }
      const ta = document.createElement('textarea')
      document.body.appendChild(ta)
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }))
      out.push(['textarea n', logic.state.newOpen])
      dispose()
      return out
    }
    expect(run(P!)).toEqual(run(O!))
  })

  it('bays: assign by drop rules, busy, already in a bay, prep and arrival', () => {
    const steps: Step[] = [
      ['free bay assign opens the next queued file', (l) => call(l, 'bays.1.assign')],
      ['close', (l) => call(l, 'closeModal')],
      ['assign a8 to bay 1 (busy)', (l) => l.assignToBay('a8', 1)],
      ['assign a4 again', (l) => l.assignToBay('a4', 2)],
      ['assign none', (l) => l.assignToBay(null, 2)],
      ['assign unknown', (l) => l.assignToBay('nope', 2)],
      ['finish a4', (l) => l.advance('a4')],
      ['assign a8 to bay 1', (l) => l.assignToBay('a8', 1)],
      ['assign a7 to bay 1 (busy again)', (l) => l.assignToBay('a7', 1)],
      ['assign a7 to bay 2', (l) => l.assignToBay('a7', 2)],
      ['prep a6', (l) => l.prepBay('a6')],
      ['prep a8', (l) => l.prepBay('a8')],
      ['arrive a6', (l) => l.simArrive('a6')],
      ['arrive unknown', (l) => l.simArrive('nope')],
      ['arrivals prep button', (l) => (read(l, 'arrivals.0') ? call(l, 'arrivals.0.prep') : 'none')],
      ['arrivals arrive button', (l) => (read(l, 'arrivals.0') ? call(l, 'arrivals.0.arrive') : 'none')],
      ['view bay', (l) => call(l, 'viewTabs.1.onClick')],
      [
        'free bay assign if any',
        (l) => (typeof read(l, 'bays.1.assign') === 'function' ? call(l, 'bays.1.assign') : 'occupied'),
      ],
      ['bay open', (l) => call(l, 'bays.0.open')],
      ['bay doNext', (l) => call(l, 'bays.0.doNext')],
      ['minute passes', () => vi.advanceTimersByTime(25 * 60000)],
    ]
    same(steps)
  })

  it('completed column chips, alert actions and member credit', () => {
    const steps: Step[] = []
    steps.push(['pay chip 0', (l) => call(l, 'completedJobs.0.togglePay')])
    steps.push(['pay chip 0 again', (l) => call(l, 'completedJobs.0.togglePay')])
    steps.push(['pickup chip 2', (l) => call(l, 'completedJobs.2.togglePickup')])
    steps.push(['open completed 1', (l) => call(l, 'completedJobs.1.open')])
    steps.push(['close', (l) => call(l, 'closeModal')])
    for (let i = 0; i < 12; i++) {
      steps.push([
        `alert ${i} action`,
        (l) => (read(l, `alerts.${i}`) ? call(l, `alerts.${i}.action`) : 'none'),
      ])
      steps.push([`alert ${i} open`, (l) => (read(l, `alerts.${i}`) ? call(l, `alerts.${i}.open`) : 'none')])
      steps.push([`close ${i}`, (l) => call(l, 'closeModal')])
    }
    same(steps)
  })
})

describe('calendar', () => {
  const sweep = (mode: number, offsets: number[]): Step[] => {
    const steps: Step[] = [
      ['mode', (l) => call(l, `calModes.${mode}.onClick`)],
      ['calendar', (l) => call(l, 'viewTabs.3.onClick')],
    ]
    for (const o of offsets) steps.push([`offset ${o}`, (l) => l.setState({ calOffset: o })])
    return steps
  }
  const range = (a: number, b: number, step: number) => {
    const out: number[] = []
    for (let i = a; i <= b; i += step) out.push(i)
    return out
  }

  it('day mode across past, today, tomorrow and 400 days either side (closed days, reduced days)', () => {
    same(sweep(0, range(-400, 400, 11).concat([0, 1, 2, -1, 24, 25, 83, 84])))
  })
  it('week mode', () => {
    same(sweep(1, range(-380, 380, 7).concat([0, 1, 3])))
  })
  it('month mode', () => {
    same(sweep(2, range(-400, 420, 30).concat([0, 20, -13])))
  })
  it('navigation by buttons and arrow keys in each mode, jumping from week and month cells', () => {
    const steps: Step[] = [['calendar', (l) => call(l, 'viewTabs.3.onClick')]]
    for (let m = 0; m < 3; m++) {
      steps.push([`mode ${m}`, (l) => call(l, `calModes.${m}.onClick`)])
      for (let i = 0; i < 4; i++) steps.push([`next ${i}`, (l) => call(l, 'calNext')])
      for (let i = 0; i < 9; i++) steps.push([`prev ${i}`, (l) => call(l, 'calPrev')])
      steps.push(['today', (l) => call(l, 'calToday')])
      steps.push([
        'arrow right',
        () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })),
      ])
      steps.push([
        'arrow left x2',
        () => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
        },
      ])
    }
    steps.push(['week mode', (l) => call(l, 'calModes.1.onClick')])
    steps.push(['week cell 3', (l) => call(l, 'calWeek.3.onClick')])
    steps.push(['month mode', (l) => call(l, 'calModes.2.onClick')])
    steps.push(['month cell 20', (l) => call(l, 'calMonth.20.onClick')])
    same(steps)
  })
  it('with Settings hours, closures (including reduced) and an emergency in storage', () => {
    const hours = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      open: d !== 3,
      from: '7:30 AM',
      to: d === 6 ? '2:15 PM' : '6:45 PM',
    }))
    const closures = [
      { date: '2026-06-15', name: 'Water main', type: 'closed' },
      { date: '2026-06-16', name: 'Inventory', type: 'reduced', from: '10:00 AM', to: '1:30 PM' },
      { date: '2026-06-14', name: 'Open late', type: 'reduced', from: '12:00 PM', to: '8:00 PM' },
    ]
    same([...sweep(0, range(-3, 30, 1)), ...sweep(1, [0, 7, 14]), ...sweep(2, [0, 30])], {
      storage: {
        'oasis-hours': hours,
        'oasis-closures': closures,
        'oasis-emergency': { active: true, summary: 'Storm' },
      },
    })
  })
  it('opening generated appointments, advancing them, rescheduling by drop', () => {
    const steps: Step[] = [
      ['calendar', (l) => call(l, 'viewTabs.3.onClick')],
      ['tomorrow', (l) => call(l, 'calNext')],
      ['open first chip', (l) => call(l, 'calRows.2.items.0.open')],
      ['advance it', (l) => call(l, 'sel.doNext')],
      ['advance it again', (l) => call(l, 'sel.doNext')],
      ['close', (l) => call(l, 'closeModal')],
      ['next', (l) => call(l, 'calNext')],
      ['next', (l) => call(l, 'calNext')],
    ]
    const list = (l: any) => l.genDay(l.state.calOffset) as any[]
    steps.push(['reschedule first to 3 PM', (l) => l.dropOn({ id: list(l)[0].id, a: list(l)[0] }, 'hr:15')])
    steps.push([
      'reschedule first to the same hour',
      (l) => l.dropOn({ id: list(l)[0].id, a: list(l)[0] }, 'hr:15'),
    ])
    steps.push(['reschedule second to 8 AM', (l) => l.dropOn({ id: list(l)[1].id, a: list(l)[1] }, 'hr:8')])
    steps.push(['past day', (l) => l.setState({ calOffset: -5 })])
    steps.push(['reschedule a completed one', (l) => l.dropOn({ id: list(l)[0].id, a: list(l)[0] }, 'hr:10')])
    steps.push(['tomorrow real appointment to 4 PM', (l) => l.setState({ calOffset: 1 })])
    steps.push(['reschedule a12', (l) => l.dropOn({ id: 'a12', a: l.byId('a12') }, 'hr:16')])
    steps.push(['reschedule a7 (today, late)', (l) => l.dropOn({ id: 'a7', a: l.byId('a7') }, 'hr:14')])
    steps.push(['reschedule a4 (in bay)', (l) => l.dropOn({ id: 'a4', a: l.byId('a4') }, 'hr:14')])
    steps.push(['drop on bay', (l) => l.dropOn({ id: 'a7', a: l.byId('a7') }, 'bay:2')])
    steps.push(['drop on nothing', (l) => l.dropOn({ id: 'a7', a: l.byId('a7') }, 'zzz:1')])
    same(steps)
  })
  it('clicks inside the 450 ms window after a gesture do not open the file', () => {
    const steps: Step[] = [
      ['sup', (l) => (l._sup = Date.now())],
      ['click soon', (l) => call(l, 'groups.0.items.0.open')],
      ['click later', () => vi.advanceTimersByTime(449)],
      ['click at 449', (l) => call(l, 'groups.0.items.0.open')],
      ['click at 450', () => vi.advanceTimersByTime(1)],
      ['click opens', (l) => call(l, 'groups.0.items.0.open')],
    ]
    same(steps)
  })
})

describe('gesture engine', () => {
  const fire = (type: string, x: number, y: number) => window.dispatchEvent(pointer(type, x, y))

  /** elementFromPoint stub: left of x=150 is bay 2, right of x=250 is bay 1, y<50 is an hour row, else a plain element. */
  function stubHitTest() {
    const mk = (drop?: string) => {
      const outer = document.createElement('div')
      if (drop) outer.setAttribute('data-drop', drop)
      const inner = document.createElement('span')
      outer.appendChild(inner)
      document.body.appendChild(outer)
      return inner
    }
    const bay1 = mk('bay:1')
    const bay2 = mk('bay:2')
    const hr = mk('hr:15')
    const none = mk()
    ;(document as any).elementFromPoint = (x: number, y: number) =>
      y < 50 ? hr : x < 150 ? bay2 : x >= 250 ? bay1 : none
    return () => delete (document as any).elementFromPoint
  }

  function gestureRun(
    Ctor: Ctor,
    o: {
      appt: string
      handler: 'onPointerDown' | 'onQDown' | 'onCalDown'
      kind: 'touch' | 'mouse'
      moves: Array<[number, number]>
      holdMs?: number
      end?: 'up' | 'cancel' | 'none'
      button?: number
      ghost?: boolean
      calendarDay?: number
    },
  ) {
    const { logic, dispose } = mount(Ctor)
    const unstub = stubHitTest()
    try {
      if (o.calendarDay !== undefined) logic.setState({ view: 'calendar', calOffset: o.calendarDay })
      const el = document.createElement('div')
      document.body.appendChild(el)
      if (o.ghost) {
        const g = document.createElement('div')
        document.body.appendChild(g)
        logic.ghostRef.current = g
      }
      const a = logic.byId(o.appt) ?? logic.genDay(logic.state.calOffset).find((x: any) => x.id === o.appt)
      logic.materialize?.(a)
      const vm = logic.cardVM(a)
      const trail: unknown[] = []
      const note = (label: string) =>
        trail.push([
          label,
          logic._g ? logic._g.mode : 'no gesture',
          logic.state.dragId,
          logic.state.dropTarget,
          logic.state.toast,
          logic.state.selectedId,
          logic.state.modalTab,
          logic.state.ghost,
          el.style.transition,
          el.style.transform,
          document.body.style.userSelect,
          (logic.ghostRef.current as HTMLElement | null)?.style.transform ?? null,
          [...logic.state.appts, ...logic.state.calAppts].map((x: any) => [x.id, x.status, x.bay, x.time]),
        ])
      vm[o.handler]({
        button: o.button ?? 0,
        clientX: 200,
        clientY: 200,
        pointerType: o.kind,
        currentTarget: el,
      })
      note('down')
      if (o.holdMs) {
        vi.advanceTimersByTime(o.holdMs)
        note('held')
      }
      o.moves.forEach(([x, y], i) => {
        fire('pointermove', x, y)
        note(`move ${i}`)
      })
      if (o.end === 'cancel') fire('pointercancel', 0, 0)
      else if (o.end !== 'none') fire('pointerup', 0, 0)
      note('end')
      vi.advanceTimersByTime(400)
      note('later')
      vi.advanceTimersByTime(4000)
      note('toast over')
      return trail
    } finally {
      unstub()
      dispose()
      document.body.innerHTML = ''
    }
  }

  const compare = (o: Parameters<typeof gestureRun>[1]) => {
    const [[, O], [, P]] = implementations()
    const a = gestureRun(O!, o)
    const b = gestureRun(P!, o)
    expect(b, JSON.stringify(o)).toEqual(a)
    return a
  }

  it('touch long-press drag onto each target, drop and wait out the toast', () => {
    for (const handler of ['onPointerDown', 'onQDown', 'onCalDown'] as const)
      for (const target of [
        [100, 120],
        [300, 120],
        [200, 20],
        [200, 200],
      ] as Array<[number, number]>) {
        const trail = compare({
          appt: 'a8',
          handler,
          kind: 'touch',
          moves: [[205, 202], target],
          holdMs: 381,
          ghost: true,
        })
        expect(trail.length).toBeGreaterThan(5)
      }
  })

  it('touch: the long-press timer fires at 380 ms and not before', () => {
    for (const holdMs of [100, 379, 380, 381, 700])
      compare({
        appt: 'a8',
        handler: 'onPointerDown',
        kind: 'touch',
        moves: [[203, 203]],
        holdMs,
        ghost: true,
      })
  })

  it('touch intent grid: swipe, cancel and wait, on every context', () => {
    const dxs = [
      -200, -151, -150, -149, -95, -91, -90, -89, -30, -13, -12, -11, 0, 5, 11, 12, 13, 30, 89, 90, 91, 149,
      150, 151, 200,
    ]
    const dys = [-30, -13, -12, -9, -8, 0, 8, 9, 12, 13, 30, 60]
    for (const handler of ['onPointerDown', 'onQDown', 'onCalDown'] as const)
      for (const dx of dxs)
        for (const dy of dys) compare({ appt: 'a8', handler, kind: 'touch', moves: [[200 + dx, 200 + dy]] })
  })

  it('touch swipe: commit thresholds, release, multi-step moves, cancel', () => {
    for (const total of [-200, -120, -91, -90, -89, 0, 89, 90, 91, 120, 160, 400]) {
      compare({
        appt: 'a8',
        handler: 'onPointerDown',
        kind: 'touch',
        moves: [
          [200 + total / 3, 200],
          [200 + total, 202],
        ],
      })
      compare({
        appt: 'a8',
        handler: 'onPointerDown',
        kind: 'touch',
        moves: [[200 + total, 200]],
        end: 'cancel',
      })
    }
    compare({ appt: 'a8', handler: 'onPointerDown', kind: 'touch', moves: [[320, 200]], end: 'none' })
  })

  it('swiping an ineligible card still swipes; long-press does not drag it', () => {
    for (const appt of ['a1', 'a4', 'a3']) {
      compare({ appt, handler: 'onPointerDown', kind: 'touch', moves: [[320, 200]] })
      compare({ appt, handler: 'onPointerDown', kind: 'touch', moves: [[203, 202]], holdMs: 500 })
      compare({
        appt,
        handler: 'onPointerDown',
        kind: 'mouse',
        moves: [
          [260, 260],
          [100, 100],
        ],
      })
    }
  })

  it('mouse: drag threshold grid then drop on bays and hour rows', () => {
    const steps = [0, 3, 5, 6, 7, 8, 12, 40, 100]
    for (const handler of ['onPointerDown', 'onQDown', 'onCalDown'] as const)
      for (const d of steps)
        for (const [ux, uy] of [
          [1, 0],
          [0, 1],
          [-1, -1],
        ]) {
          const dx = d * ux
          const dy = d * uy
          compare({ appt: 'a8', handler, kind: 'mouse', moves: [[200 + dx, 200 + dy]], ghost: true })
          compare({
            appt: 'a8',
            handler,
            kind: 'mouse',
            moves: [
              [200 + dx, 200 + dy],
              [100, 120],
              [300, 120],
              [200, 20],
              [140, 120],
            ],
            ghost: true,
          })
        }
  })

  it('mouse: non-primary buttons are ignored; a second gesture replaces the first', () => {
    compare({ appt: 'a8', handler: 'onPointerDown', kind: 'mouse', button: 2, moves: [[300, 300]] })
    compare({ appt: 'a8', handler: 'onPointerDown', kind: 'mouse', button: 1, moves: [[300, 300]] })
    compare({ appt: 'a8', handler: 'onPointerDown', kind: 'mouse', moves: [[300, 300]], end: 'none' })
  })

  it('calendar drag to reschedule (chips of a generated day and of today)', () => {
    for (const [appt, day] of [
      ['g1_0', 1],
      ['g2_1', 2],
      ['g-3_0', -3],
      ['a8', 0],
      ['a12', 1],
    ] as Array<[string, number]>)
      for (const kind of ['mouse', 'touch'] as const)
        compare({
          appt,
          handler: 'onCalDown',
          kind,
          calendarDay: day,
          moves: [
            [205, 205],
            [200, 20],
          ],
          holdMs: kind === 'touch' ? 381 : 0,
          ghost: true,
        })
  })

  it('a second pointerdown ends the first gesture; unmount mid-gesture cleans up', () => {
    const [[, O], [, P]] = implementations()
    const run = (C: Ctor) => {
      const { logic, dispose } = mount(C)
      const el = document.createElement('div')
      const vm = logic.cardVM(logic.byId('a8'))
      vm.onPointerDown({ button: 0, clientX: 1, clientY: 1, pointerType: 'touch', currentTarget: el })
      const first = logic._g
      vm.onPointerDown({ button: 0, clientX: 5, clientY: 5, pointerType: 'mouse', currentTarget: el })
      const out = [first === logic._g, logic._g.touch]
      dispose()
      out.push(logic._g)
      vi.advanceTimersByTime(1000)
      out.push(logic.state.dragId)
      return out
    }
    expect(run(P!)).toEqual(run(O!))
  })

  it('the touchmove guard only prevents default while a gesture has a mode', () => {
    const [[, O], [, P]] = implementations()
    const run = (C: Ctor) => {
      const { logic, dispose } = mount(C)
      const el = document.createElement('div')
      const results: boolean[] = []
      const ev = () => {
        const e = new Event('touchmove', { cancelable: true, bubbles: true })
        document.dispatchEvent(e)
        return e.defaultPrevented
      }
      results.push(ev())
      logic
        .cardVM(logic.byId('a8'))
        .onPointerDown({ button: 0, clientX: 1, clientY: 1, pointerType: 'touch', currentTarget: el })
      results.push(ev())
      fire('pointermove', 60, 3)
      results.push(ev())
      fire('pointerup', 60, 3)
      results.push(ev())
      dispose()
      results.push(ev())
      return results
    }
    expect(run(P!)).toEqual(run(O!))
  })

  it('calendar swipe: distance, ratio and time thresholds, mouse ignored, drag mode ignored', () => {
    const [[, O], [, P]] = implementations()
    const run = (C: Ctor, type: string, dx: number, dy: number, dt: number, mode?: string) => {
      const { logic, dispose } = mount(C)
      logic.setState({ view: 'calendar', calOffset: 3 })
      call(logic, 'calSwipeStart', { pointerType: type, clientX: 400, clientY: 300 })
      vi.advanceTimersByTime(dt)
      if (mode) logic._g = { mode }
      call(logic, 'calSwipeEnd', { clientX: 400 + dx, clientY: 300 + dy })
      const out = [logic.state.calOffset, logic._sup > 0, logic._cs]
      dispose()
      return out
    }
    for (const type of ['touch', 'mouse', 'pen'])
      for (const dx of [-100, -71, -70, -69, 0, 69, 70, 71, 100])
        for (const dy of [0, 20, 46, 47, 48, 100])
          for (const dt of [10, 799, 800, 801])
            expect(run(P!, type, dx, dy, dt)).toEqual(run(O!, type, dx, dy, dt))
    expect(run(P!, 'touch', -100, 0, 10, 'drag')).toEqual(run(O!, 'touch', -100, 0, 10, 'drag'))
    expect(run(P!, 'touch', -100, 0, 10, 'swipe')).toEqual(run(O!, 'touch', -100, 0, 10, 'swipe'))
  })
})
