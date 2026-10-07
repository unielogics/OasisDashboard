// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// The live view model's style objects against the FIXTURE class's, on the same appointments of the design day: the live
// builders re-type the design's literals (they cannot import the fixture class's private methods), so this fails the
// moment either side drifts. Only styles and labels whose inputs agree are compared; what the API changes on purpose
// (cents, `Payment pending`, avatar colours from the employee) is covered by LiveLogic.test.ts and DEVIATIONS.md.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSession } from '@/auth/test-fixtures'
import { FILES, FROZEN, clone, makeLive, stubPort } from './live-testkit'
import { PortClass, attach } from './testkit'

beforeAll(() => {
  process.env.TZ = 'America/New_York'
})
beforeEach(() => {
  vi.useFakeTimers({ now: new Date(FROZEN) })
  localStorage.clear()
})
afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

const pick = (o: any, keys: string[]): any => Object.fromEntries(keys.map((k) => [k, o?.[k]]))

function fixtureLogic(theme: 'light' | 'dark') {
  localStorage.setItem('oasis-theme', theme)
  const C = PortClass()
  const logic = new C({})
  attach(logic)
  return logic
}

async function liveLogic(theme: 'light' | 'dark', port = stubPort()) {
  const l = makeLive(makeSession({ role: 'mgmt' }), port)
  l.logic.setState({ theme })
  l.vals()
  await l.settle()
  l.vals()
  return l
}

const flat = (vals: any): any[] => [
  ...vals.groups.flatMap((g: any) => g.items),
  ...vals.staffCols.flatMap((s: any) => s.jobs),
]

describe.each(['light', 'dark'] as const)('styles match the fixture class (%s)', (theme) => {
  it('cards: card, rail, chip, badge, member, icon wrap and next row', async () => {
    const f = fixtureLogic(theme).renderVals()
    const l = await liveLogic(theme)
    const lv = l.vals()
    const fc = new Map(flat(f).map((c: any) => [c.name, c]))
    const keys = [
      'cardStyle',
      'railStyle',
      'chipStyle',
      'badgeStyle',
      'iconWrap',
      'nextStyle',
      'statusColor',
      'badgeLabel',
      'vip',
      'member',
      'memberLabel',
      'bayLabel',
      'hasNotes',
      'hasPhotos',
      'hasAddons',
      'addonCount',
      'nextLabel',
      'nextColor',
      'short',
      'service',
      'time',
    ]
    let n = 0
    for (const c of flat(lv)) {
      const want = fc.get(c.name)
      if (!want) continue
      // the design's Aisha Rahman is not a VIP in its fixture; the seed (and Settings) make her one
      const k = c.name === 'Aisha Rahman' ? keys.filter((x) => x !== 'vip') : keys
      const bool = (o: any) => ({ ...o, hasNotes: !!o.hasNotes })
      expect(bool(pick(c, k)), c.name).toEqual(bool(pick(want, k)))
      n++
    }
    expect(n).toBeGreaterThan(8)
  })

  it('card styles while a card is dragged (opacity)', async () => {
    const fl = fixtureLogic(theme)
    const a = fl.state.appts.find((x: any) => x.cust.name === 'Marcus Webb')
    fl.setState({ dragId: a.id })
    const f = flat(fl.renderVals()).find((c: any) => c.name === 'Marcus Webb')
    const l = await liveLogic(theme)
    const card = l.port.snap.timeline.groups
      .flatMap((g) => g.items)
      .find((c) => c.customer.name === 'Marcus Webb')!
    l.logic.setState({ dragId: card.id })
    const c = flat(l.vals()).find((x: any) => x.name === 'Marcus Webb')
    expect(pick(c, ['cardStyle', 'chipStyle'])).toEqual(pick(f, ['cardStyle', 'chipStyle']))
  })

  it('bays, arrivals, pickup column, alerts and the tabs', async () => {
    const f = fixtureLogic(theme).renderVals()
    const l = await liveLogic(theme)
    const lv = l.vals()
    for (let i = 0; i < 2; i++) {
      const keys = lv.bays[i].occupied
        ? [
            'tagStyle',
            'badgeStyle',
            'progressStyle',
            'shellStyle',
            'primaryStyle',
            'elapsed',
            'progressLabel',
            'durLabel',
            'badgeLabel',
            'statusColor',
            'nextLabel',
            'drop',
          ]
        : ['tagStyle', 'shellStyle', 'dropZoneStyle', 'drop']
      expect(pick(lv.bays[i], keys), `bay ${i + 1}`).toEqual(pick(f.bays[i], keys))
    }
    lv.arrivals.forEach((a: any, i: number) => {
      expect(pick(a, ['style', 'dot', 'prepStyle', 'prepLabel', 'title', 'desc'])).toEqual(
        pick(f.arrivals[i], ['style', 'dot', 'prepStyle', 'prepLabel', 'title', 'desc']),
      )
    })
    const fa = new Map(f.alerts.map((a: any) => [a.title, a]))
    let matched = 0
    for (const a of lv.alerts) {
      const w = fa.get(a.title) as any
      if (!w) continue
      expect(pick(a, ['shellStyle', 'iconStyle', 'actionStyle', 'glyph', 'actionLabel'])).toEqual(
        pick(w, ['shellStyle', 'iconStyle', 'actionStyle', 'glyph', 'actionLabel']),
      )
      matched++
    }
    expect(matched).toBeGreaterThan(5)
    const fd = new Map(f.completedJobs.map((c: any) => [c.name, c]))
    for (const c of lv.completedJobs) {
      const w = fd.get(c.name) as any
      // pay/pickup states differ between the seed and the fixture only through cents and a card status: compare the layout
      expect(pick(c, ['shellStyle', 'vehicleLine', 'service', 'time'])).toEqual(
        pick(w, ['shellStyle', 'vehicleLine', 'service', 'time']),
      )
      expect(Object.keys(c.payChipStyle)).toEqual(Object.keys(w.payChipStyle))
    }
    lv.viewTabs.forEach((t: any, i: number) => expect(t.style).toEqual(f.viewTabs[i].style))
    lv.rangeTabs.forEach((t: any, i: number) => expect(t.style).toEqual(f.rangeTabs[i].style))
    expect(lv.kpis.map((k: any) => k.accent)).toEqual(f.kpis.map((k: any) => k.accent))
  })

  it('the calendar: mode buttons, week cells and month cells', async () => {
    const fl = fixtureLogic(theme)
    fl.setState({ view: 'calendar', calMode: 'week' })
    const fw = fl.renderVals()
    fl.setState({ calMode: 'month' })
    const fm = fl.renderVals()
    const l = await liveLogic(theme)
    l.logic.setState({ view: 'calendar', calMode: 'week' })
    l.vals()
    await l.settle()
    const lw = l.vals()
    l.logic.setState({ calMode: 'month' })
    l.vals()
    await l.settle()
    const lm = l.vals()
    expect(lw.calModes.map((m: any) => m.style)).toEqual(fw.calModes.map((m: any) => m.style))
    lw.calWeek.forEach((c: any, i: number) => {
      expect(pick(c, ['style', 'dow', 'num', 'isToday'])).toEqual(
        pick(fw.calWeek[i], ['style', 'dow', 'num', 'isToday']),
      )
    })
    expect(lm.calMonth.length).toBe(fm.calMonth.length)
    lm.calMonth.forEach((c: any, i: number) => {
      const w = fm.calMonth[i]
      expect(pick(c, ['numStyle', 'pillStyle', 'num']), `cell ${i}`).toEqual(
        pick(w, ['numStyle', 'pillStyle', 'num']),
      )
      // an open cell's frame depends on whether the day is closed, which the design's June has for one date
      if (!c.closed && !w.closed) expect(c.style).toEqual(w.style)
    })
    expect(lm.calLabel).toBe(fm.calLabel)
    expect(lw.calLabel).toBe(fw.calLabel)
    expect(lm.calDow).toEqual(fm.calDow)
  })

  it('the file: stages, tabs, checklist, add-ons, photos, payments, membership styles', async () => {
    const fl = fixtureLogic(theme)
    const a = fl.state.appts.find((x: any) => x.cust.name === 'Priya Nair')
    const l = await liveLogic(theme)
    const id = (FILES.completed as any).id
    for (const tab of [
      'overview',
      'checklist',
      'addons',
      'photos',
      'messages',
      'payments',
      'membership',
      'history',
    ]) {
      fl.setState({ selectedId: a.id, modalTab: tab })
      const f = fl.renderVals().sel
      l.logic.setState({ selectedId: id, modalTab: tab })
      l.vals()
      await l.settle()
      l.vals()
      await l.settle()
      const s = l.vals().sel
      expect(
        s.stages.map((x: any) => pick(x, ['label', 'mark', 'dotStyle', 'labelStyle', 'lineStyle'])),
        `stages ${tab}`,
      ).toEqual(f.stages.map((x: any) => pick(x, ['label', 'mark', 'dotStyle', 'labelStyle', 'lineStyle'])))
      expect(
        s.tabs.map((x: any) => pick(x, ['label', 'style', 'countStyle'])),
        `tabs ${tab}`,
      ).toEqual(f.tabs.map((x: any) => pick(x, ['label', 'style', 'countStyle'])))
      expect(
        pick(s, [
          'badgeStyle',
          'memberStyle',
          'memberLabel',
          'vip',
          'checkAllStyle',
          'memberCardStyle',
          'creditsLeft',
          'creditsUsed',
          'memberMonths',
          'perks',
          'renewDate',
        ]),
      ).toEqual(
        pick(f, [
          'badgeStyle',
          'memberStyle',
          'memberLabel',
          'vip',
          'checkAllStyle',
          'memberCardStyle',
          'creditsLeft',
          'creditsUsed',
          'memberMonths',
          'perks',
          'renewDate',
        ]),
      )
      if (tab === 'checklist') {
        const keep = (sec: any) => ({
          ...pick(sec, ['title', 'kind', 'countLabel', 'kindStyle', 'btnLabel']),
          items: sec.items.map((i: any) => pick(i, ['label', 'done', 'rowStyle', 'boxStyle', 'labelStyle'])),
        })
        expect(s.checkSections.map(keep)).toEqual(f.checkSections.map(keep))
      }
      if (tab === 'addons')
        expect(s.addonCatalog.map((x: any) => pick(x, ['name', 'rowStyle', 'boxStyle', 'on']))).toEqual(
          f.addonCatalog.map((x: any) => pick(x, ['name', 'rowStyle', 'boxStyle', 'on'])),
        )
      if (tab === 'photos')
        expect(s.photoSections.map((p: any) => pick(p, ['title', 'tagStyle']))).toEqual(
          f.photoSections.map((p: any) => pick(p, ['title', 'tagStyle'])),
        )
      if (tab === 'payments') {
        expect(s.payRows.map((r: any) => pick(r, ['style', 'labelStyle', 'valStyle']))).toEqual(
          f.payRows.map((r: any) => pick(r, ['style', 'labelStyle', 'valStyle'])).slice(0, s.payRows.length),
        )
        expect(pick(s, ['payCardStyle', 'payStatusLabel'])).toEqual(
          pick(f, ['payCardStyle', 'payStatusLabel']),
        )
      }
    }
  })

  it("the retention card: the watch tone is the design's orange pair, the loyal tone the accent pair", async () => {
    const fl = fixtureLogic(theme)
    const a = fl.state.appts.find((x: any) => x.cust.name === 'Priya Nair')
    fl.setState({ selectedId: a.id, modalTab: 'membership' })
    const f = fl.renderVals().sel
    const port = stubPort()
    ;(port.files.get(id())!.membership as any).retention = {
      label: 'Watch · 1 missed visit',
      desc: 'Down from 3 to 1 visit last month',
      tone: 'red',
    }
    const l = await liveLogic(theme, port)
    l.logic.setState({ selectedId: id(), modalTab: 'membership' })
    l.vals()
    await l.settle()
    l.vals()
    await l.settle()
    const s = l.vals().sel
    expect(pick(s, ['riskStyle', 'riskLabel', 'riskDesc'])).toEqual(
      pick(f, ['riskStyle', 'riskLabel', 'riskDesc']),
    )
  })

  it('messages: bubble and row styles by sender', async () => {
    const fl = fixtureLogic(theme)
    const a = fl.state.appts.find((x: any) => x.cust.name === 'Priya Nair')
    fl.setState({ selectedId: a.id, modalTab: 'messages' })
    const f = fl.renderVals().sel.messages
    const port = stubPort()
    const th = clone((await port.thread(id())) as any)
    th.items = [
      { text: 'a', time: '9:00 AM', direction: 'out', from: 'staff', status: 'sent', channel: 'sms' },
      { text: 'b', time: '9:01 AM', direction: 'out', from: 'system', status: 'sent', channel: 'sms' },
      { text: 'c', time: '9:02 AM', direction: 'in', from: 'customer', status: 'received', channel: 'sms' },
    ]
    port.threads.set(id(), th)
    const l = await liveLogic(theme, port)
    l.logic.setState({ selectedId: id(), modalTab: 'messages' })
    l.vals()
    await l.settle()
    l.vals()
    await l.settle()
    const m = l.vals().sel.messages
    const staff = f.find((x: any) => x.channelTag === null)
    const system = f.find((x: any) => x.channelTag)
    const keys = ['rowStyle', 'bubbleStyle', 'tagStyle', 'timeStyle']
    expect(pick(m[0], keys)).toEqual(pick(staff, keys))
    expect(pick(m[1], keys)).toEqual(pick(system, keys))
    // a customer's reply: left-aligned, the panel colour
    expect(m[2].rowStyle.justifyContent).toBe('flex-start')
    expect(m[2].bubbleStyle.background).toBe('var(--panel)')
    expect(m[1].channelTag).toBe('Automated · SMS')
  })
})

const id = (): string => (FILES.completed as any).id
