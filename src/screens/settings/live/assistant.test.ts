// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// Settings → Oasis AI assistant on LiveData over a fake API (ADR 0160, design section 8, plan G): the nav entry and the
// section, the working copy over the server's view, the version handling of the Hours section (only changed fields with
// the version; 412 refetches and keeps the edits; a change saved elsewhere shows in the untouched fields), inline 422
// errors, the checks before asking the server, and "Your role can’t …" without a request.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSession } from '@/auth/test-fixtures'
import { ApiError } from '@/data/http/problem'
import { makeQueryClient } from '@/data/query'
import type { AssistantApi, AssistantView } from '@/data/ports/assistant-api'
import type { ToastSpec } from '@/data/toast'
import { createSettingsLogic } from '../Logic'
import view0 from './__fixtures__/assistant.json'
import { LiveData } from './LiveData'
import { clone, fakeApi } from './testkit'

beforeAll(() => {
  process.env.TZ = 'America/New_York'
})
beforeEach(() => {
  vi.useRealTimers()
  location.hash = ''
})
afterEach(() => vi.restoreAllMocks())

const FIELDS = ['enabled', 'actionsEnabled', 'stage', 'allowlist', 'staffPauseHours', 'faq'] as const

/** The server: one version for the section, raised by every changed setting; 412 on a stale version; 422 like api-spec 15.6b. */
function fakeAssistant() {
  const calls: any[][] = []
  const fail = new Map<string, ApiError>()
  const state = { view: clone(view0) as AssistantView }
  const api: AssistantApi = {
    get: async () => {
      calls.push(['get'])
      const e = fail.get('get')
      if (e) throw e
      return clone(state.view)
    },
    save: async (body: any, o?: any) => {
      calls.push(['save', clone(body), o])
      const e = fail.get('save')
      if (e) {
        fail.delete('save')
        throw e
      }
      if (body.version !== state.view.version)
        throw new ApiError({
          status: 412,
          code: 'VERSION_CONFLICT',
          title: 'Changed by someone else',
          detail: 'Someone saved these settings a moment ago. Your changes are kept; save again.',
          meta: { currentVersion: state.view.version },
        })
      const errors = (body.allowlist ?? [])
        .map((n: string, i: number) => (/^\+1\d{10}$/.test(n) ? null : { path: `allowlist.${i}`, message: 'The assistant texts US and Canadian numbers only.' }))
        .filter(Boolean)
      if (errors.length)
        throw new ApiError({ status: 422, code: 'VALIDATION_FAILED', title: 'Check the form', detail: errors[0].message, errors })
      const changed: string[] = []
      for (const k of FIELDS)
        if (k in body && JSON.stringify(body[k]) !== JSON.stringify((state.view as any)[k])) {
          ;(state.view as any)[k] = clone(body[k])
          changed.push('assistant.' + k)
        }
      state.view.version += changed.length
      state.view.active = state.view.server.aiEnabled && state.view.enabled
      return { ...clone(state.view), changed }
    },
  }
  return { api, calls, fail, state }
}

function make(role: 'mgmt' | 'crew' | 'super' | 'support' = 'mgmt', assistant = fakeAssistant()) {
  const f = fakeApi()
  const qc = makeQueryClient()
  qc.setDefaultOptions({ queries: { ...qc.getDefaultOptions().queries, retry: false } })
  const toasts: ToastSpec[] = []
  const session = makeSession({ role: role as 'mgmt' })
  const ref: { logic?: any } = {}
  const data = new LiveData({
    api: f.api,
    qc,
    session: () => session,
    toast: (t) => {
      toasts.push(t)
      ref.logic?.flash(t.desc ? t.title + ' · ' + t.desc : t.title)
    },
    schedule: (fn) => fn(),
    assistantApi: assistant.api,
  })
  const logic: any = (ref.logic = new (createSettingsLogic(data))({}))
  const render = () => queueMicrotask(() => logic.renderVals())
  logic.__host = {
    __setLogicState(update: any, cb?: () => void) {
      const patch = typeof update === 'function' ? update(logic.state) : update
      logic.state = { ...logic.state, ...patch }
      render()
      cb?.()
    },
    forceUpdate: render,
  }
  logic.componentDidMount()
  return { logic, data, qc, toasts, a: assistant }
}

const vals = (logic: any): any => logic.renderVals()
const asst = (logic: any): any => vals(logic).live.asst
const ev = (value = '', key = '') => ({ target: { value }, key, preventDefault() {} })

async function open(m: ReturnType<typeof make>) {
  vals(m.logic).live.asst.go()
  await vi.waitFor(() => expect(vals(m.logic).live.secAssistant).toBe(true))
  return asst(m.logic)
}
const saves = (m: ReturnType<typeof make>) => m.a.calls.filter((c) => c[0] === 'save')

describe('the nav entry and the section', () => {
  it('opens from the Texting group; the header names it; loading until the server answers', async () => {
    const a = fakeAssistant()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const get = a.api.get
    a.api.get = async () => {
      await gate
      return get()
    }
    const m = make('mgmt', a)
    const v0 = vals(m.logic)
    expect(v0.live.asst.navStyle.background).toBe('transparent')
    expect(v0.live.secAssistant).toBe(false)
    v0.live.asst.go()
    const v1 = vals(m.logic)
    expect(v1.secTitle).toBe('Oasis AI assistant')
    expect(v1.secDesc).toBe('Who the texting assistant answers, when it steps back for your team, and the answers it knows.')
    expect(v1.live.asst.navStyle.background).toBe('var(--accentSoft)')
    expect(v1.nav.hours.background).toBe('transparent')
    expect(v1.hasHeadBtn).toBe(false)
    expect([v1.live.secLoading, v1.live.secOpen]).toEqual([true, false])
    release()
    await vi.waitFor(() => expect(vals(m.logic).live.secAssistant).toBe(true))
  })

  it('a failed read shows the failed card; Try again reads it again', async () => {
    const a = fakeAssistant()
    a.fail.set('get', new ApiError({ status: 500, title: 'Server error', detail: '' }))
    const m = make('mgmt', a)
    vals(m.logic).live.asst.go()
    await vi.waitFor(() => expect(vals(m.logic).live.secFailed).toBe(true))
    a.fail.delete('get')
    vals(m.logic).live.retryLoad()
    await vi.waitFor(() => expect(vals(m.logic).live.secAssistant).toBe(true))
  })

  it('the default (everything off) says so in plain words and shows ON nowhere', async () => {
    const m = make()
    const s = await open(m)
    expect(s.badge).toBe(false)
    expect(s.statusText).toBe(
      'Oasis AI is off: texts reach the team as today. It is also off on the server for now; you can set everything up here meanwhile.',
    )
    expect(s.toggles.map((t: any) => [t.label, t.on])).toEqual([
      ['Answer texts with Oasis AI', false],
      ['Book, move and cancel by text', false],
    ])
    expect(s.toggles[1].sub).toContain('It is also off on the server for now.')
    expect(s.stages.map((o: any) => [o.label, o.style.background])).toEqual([
      ['Test numbers', 'var(--accent)'],
      ['Clients', 'transparent'],
      ['Everyone', 'transparent'],
    ])
    expect(s.stageText).toMatch(/^Only the numbers in the list get answers from Oasis AI\./)
    expect([s.pauseVal, s.numbersCount, s.noNumbers, s.faqCount, s.noFaq, s.dirty]).toEqual([
      '12 hours',
      '0 numbers',
      true,
      '0 of 40',
      true,
      false,
    ])
  })

  it('#assistant opens the section (live only)', async () => {
    location.hash = '#assistant'
    const m = make()
    expect(m.logic.state.section).toBe('assistant')
  })

  it('the nav badge reads ON while the assistant answers texts', async () => {
    const a = fakeAssistant()
    a.state.view = { ...a.state.view, enabled: true, active: true, server: { aiEnabled: true, actionsEnabled: false } }
    const m = make('mgmt', a)
    const s = await open(m)
    expect(s.badge).toBe(true)
    expect(s.statusText).toBe('Oasis AI is answering texts.')
    expect(s.statusStyle.background).toBe('var(--accentSoft)')
  })
})

describe('editing and saving', () => {
  it('switches, stage, pause, a number and an FAQ pair: one save with only the changed fields and the version', async () => {
    const m = make()
    let s = await open(m)
    s.toggles[0].toggle()
    asst(m.logic).stages[1].onClick()
    asst(m.logic).pauseInc()
    asst(m.logic).pauseInc()
    asst(m.logic).numberSet(ev('(201) 555-0142'))
    asst(m.logic).numberAdd()
    asst(m.logic).faqAdd()
    asst(m.logic).faq[0].setQ(ev('Do you take walk-ins?'))
    asst(m.logic).faq[0].setA(ev(' Yes, any time we are open. '))
    s = asst(m.logic)
    expect(s.dirty).toBe(true)
    expect(s.saveTitle).toBe('Unsaved changes to the assistant')
    expect(s.numbers.map((n: any) => n.label)).toEqual(['(201) 555-0142'])
    expect(s.stageText).toMatch(/^Every client already on file/)
    expect(s.numbersNote).toBe('Used while “Who it answers” is Test numbers. Right now it answers every client.')
    expect(s.pauseVal).toBe('14 hours')
    expect(s.faq[0].count).toBe('26 / 500')
    s.save()
    s.save() // a double click is one request
    await vi.waitFor(() => expect(asst(m.logic).dirty).toBe(false))
    expect(saves(m)).toHaveLength(1)
    const [, body, o] = saves(m)[0]!
    expect(body).toEqual({
      enabled: true,
      stage: 'customers',
      staffPauseHours: 14,
      allowlist: ['+12015550142'],
      faq: [{ q: 'Do you take walk-ins?', a: 'Yes, any time we are open.' }],
      version: 0,
    })
    expect(o.idempotencyKey).toBeTruthy()
    expect(m.toasts.at(-1)).toEqual({ title: 'Assistant settings saved', desc: 'Oasis AI is not answering texts' })
    s = asst(m.logic)
    expect(s.toggles[0].on).toBe(true)
    expect(s.faq[0].a).toBe('Yes, any time we are open.')
    // the next save starts from the server's new version
    s.toggles[1].toggle()
    asst(m.logic).save()
    await vi.waitFor(() => expect(saves(m)).toHaveLength(2))
    expect(saves(m)[1]![1]).toEqual({ actionsEnabled: true, version: 5 })
  })

  it('a change back to the server value is not a change; Discard drops the working copy', async () => {
    const m = make()
    const s = await open(m)
    s.toggles[0].toggle()
    expect(asst(m.logic).dirty).toBe(true)
    asst(m.logic).toggles[0].toggle()
    expect(asst(m.logic).dirty).toBe(false)
    asst(m.logic).pauseDec()
    expect(asst(m.logic).dirty).toBe(true)
    asst(m.logic).discard()
    expect(asst(m.logic).dirty).toBe(false)
    expect(asst(m.logic).pauseVal).toBe('12 hours')
  })

  it('the pause stays between 1 and 72 hours', async () => {
    const a = fakeAssistant()
    a.state.view.staffPauseHours = 1
    const m = make('mgmt', a)
    await open(m)
    asst(m.logic).pauseDec()
    expect(asst(m.logic).pauseVal).toBe('1 hour')
    expect(asst(m.logic).dirty).toBe(false)
    for (let i = 0; i < 80; i++) asst(m.logic).pauseInc()
    expect(asst(m.logic).pauseVal).toBe('72 hours')
  })

  it('numbers: read the way people write them, refused in plain words when they are not US/Canadian or already listed', async () => {
    const a = fakeAssistant()
    a.state.view.allowlist = ['+12015550142']
    const m = make('mgmt', a)
    await open(m)
    for (const [typed, problem] of [
      ['', 'Type a phone number first.'],
      ['+44 20 7946 0958', 'Enter a 10-digit US or Canadian number.'],
      ['555-0142', 'Enter a 10-digit US or Canadian number.'],
      ['201.555.0142', 'That number is already in the list.'],
    ]) {
      asst(m.logic).numberSet(ev(typed))
      asst(m.logic).numberAdd()
      expect(asst(m.logic).numberError, typed).toBe(problem)
      expect(asst(m.logic).hasNumberError).toBe(true)
    }
    asst(m.logic).numberSet(ev('1 (973) 555 0101'))
    expect(asst(m.logic).hasNumberError).toBe(false)
    asst(m.logic).numberKeys(ev('', 'Enter'))
    expect(asst(m.logic).numbers.map((n: any) => n.label)).toEqual(['(201) 555-0142', '(973) 555-0101'])
    expect(asst(m.logic).numberNew).toBe('')
    asst(m.logic).numbers[0].remove()
    expect(asst(m.logic).numbers.map((n: any) => n.label)).toEqual(['(973) 555-0101'])
  })

  it('FAQ: an empty or long line is caught before the server; each question once', async () => {
    const m = make()
    await open(m)
    asst(m.logic).faqAdd()
    asst(m.logic).faqAdd()
    asst(m.logic).faq[0].setQ(ev('Hours?'))
    asst(m.logic).faq[0].setA(ev('x'.repeat(501)))
    asst(m.logic).faq[1].setQ(ev(' hours? '))
    asst(m.logic).save()
    const s = asst(m.logic)
    expect(saves(m)).toHaveLength(0)
    expect([s.faq[0].hasQError, s.faq[0].aError]).toEqual([false, '500 characters at most (now 501).'])
    expect([s.faq[1].qError, s.faq[1].aError]).toEqual(['This question is already in the list.', 'Write the answer.'])
    expect(s.saveTitle).toBe('Fix the questions marked in red, then save.')
    expect(s.saveTitleStyle.color).toBe('#C2410C')
    // typing in a line clears its mark
    asst(m.logic).faq[1].setA(ev('Mon–Sat 8 to 6'))
    expect(asst(m.logic).faq[1].hasAError).toBe(false)
    asst(m.logic).faq[1].remove()
    asst(m.logic).faq[0].setA(ev('Mon–Sat 8 to 6, closed Sundays'))
    asst(m.logic).save()
    await vi.waitFor(() => expect(saves(m)).toHaveLength(1))
  })

  it('at most 40 questions', async () => {
    const a = fakeAssistant()
    a.state.view.faq = Array.from({ length: 40 }, (_, i) => ({ q: 'Q' + i, a: 'A' + i }))
    const m = make('mgmt', a)
    await open(m)
    expect(asst(m.logic).faqCount).toBe('40 of 40')
    expect(asst(m.logic).faqAddStyle.opacity).toBe(0.5)
    asst(m.logic).faqAdd()
    expect(asst(m.logic).faq).toHaveLength(40)
    expect(m.toasts.at(-1)).toEqual({ title: '40 questions at most', desc: 'Remove one to add another.' })
  })
})

describe('the version, like Working hours', () => {
  it('a change saved elsewhere shows in the fields nobody touched here; the edited ones stay', async () => {
    const m = make()
    await open(m)
    asst(m.logic).toggles[0].toggle()
    // someone else adds a number; the stream says settings.changed {section: assistant}
    m.a.state.view.allowlist = ['+19735550101']
    m.a.state.view.version = 1
    await m.qc.invalidateQueries({ queryKey: ['settings', 'assistant'] })
    await vi.waitFor(() => expect(asst(m.logic).numbers.map((n: any) => n.label)).toEqual(['(973) 555-0101']))
    expect(asst(m.logic).toggles[0].on).toBe(true)
    asst(m.logic).save()
    await vi.waitFor(() => expect(saves(m)).toHaveLength(1))
    expect(saves(m)[0]![1]).toEqual({ enabled: true, version: 1 })
  })

  it('412: the server says why, the view is read again, the edits stay and the next Save applies them', async () => {
    const m = make()
    await open(m)
    asst(m.logic).stages[2].onClick()
    // a save the stream did not announce
    m.a.state.view.staffPauseHours = 6
    m.a.state.view.version = 3
    asst(m.logic).save()
    await vi.waitFor(() =>
      expect(m.toasts.at(-1)).toEqual({
        title: 'Changed by someone else',
        desc: 'Someone saved these settings a moment ago. Your changes are kept; save again.',
      }),
    )
    await vi.waitFor(() => expect(asst(m.logic).pauseVal).toBe('6 hours'))
    expect(asst(m.logic).stages[2].style.background).toBe('var(--accent)')
    expect(asst(m.logic).dirty).toBe(true)
    asst(m.logic).save()
    await vi.waitFor(() => expect(asst(m.logic).dirty).toBe(false))
    expect(saves(m).map((c) => c[1])).toEqual([
      { stage: 'everyone', version: 0 },
      { stage: 'everyone', version: 3 },
    ])
  })

  it("422: the server's words under the field, no toast; editing that list clears them", async () => {
    const a = fakeAssistant()
    const m = make('mgmt', a)
    await open(m)
    asst(m.logic).numberSet(ev('(201) 555-0142'))
    asst(m.logic).numberAdd()
    a.fail.set(
      'save',
      new ApiError({
        status: 422,
        code: 'VALIDATION_FAILED',
        title: 'Check the form',
        detail: 'The assistant texts US and Canadian numbers only.',
        errors: [{ path: 'allowlist.0', message: 'The assistant texts US and Canadian numbers only.' }],
      }),
    )
    const before = m.toasts.length
    asst(m.logic).save()
    await vi.waitFor(() => expect(asst(m.logic).numbers[0].hasError).toBe(true))
    expect(asst(m.logic).numbers[0].error).toBe('The assistant texts US and Canadian numbers only.')
    expect(asst(m.logic).saveTitle).toBe('The assistant texts US and Canadian numbers only.')
    expect(m.toasts.length).toBe(before)
    asst(m.logic).numbers[0].remove()
    expect(asst(m.logic).numbers).toEqual([])
    expect(asst(m.logic).hasSaveError).toBe(false)
  })
})

describe('roles', () => {
  it('a role without set.hours reads the section but every change is the design toast and no request', async () => {
    const m = make('support')
    const s = await open(m)
    s.toggles[0].toggle()
    expect(m.toasts.at(-1)).toEqual({ title: 'Your role can’t change the assistant settings' })
    asst(m.logic).stages[2].onClick()
    asst(m.logic).pauseInc()
    asst(m.logic).numberSet(ev('(201) 555-0142'))
    asst(m.logic).numberAdd()
    asst(m.logic).faqAdd()
    asst(m.logic).save()
    expect(asst(m.logic).dirty).toBe(false)
    expect(asst(m.logic).numbers).toEqual([])
    expect(saves(m)).toHaveLength(0)
  })
})
