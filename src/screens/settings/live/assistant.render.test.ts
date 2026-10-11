// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// The LIVE Settings template (with the live patches) rendered with the view model on LiveData: the "Oasis AI assistant"
// nav entry in the Clients group, the section (status strip, switches, stage, pause, test numbers, questions and answers)
// and its own save bar (ADR 0160, DV-320..322). Every binding of the section exists in the values the view model gives.
import fs from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { compileScreens } from '../../../../tools/dc-compile/compile'
import { root } from '../../../../tools/dc-compile/tests/original-runtime'
import { makeSession } from '@/auth/test-fixtures'
import { makeQueryClient } from '@/data/query'
import type { AssistantApi } from '@/data/ports/assistant-api'
import { createSettingsLogic } from '../Logic'
import view0 from './__fixtures__/assistant.json'
import { LiveData } from './LiveData'
import { clone, fakeApi } from './testkit'

const tmp = path.join(root, 'tools/dc-compile/tests/.tmp-snippets/settings-assistant-render')
const text = (v: string | Buffer | undefined): string => (Buffer.isBuffer(v) ? v.toString('utf8') : (v ?? ''))
let render: (vals: any, ctx: { name: string }) => any
let bindings: any

beforeAll(async () => {
  process.env.TZ = 'America/New_York'
  const out = compileScreens(['settings'], { root, variant: 'live', tplIds: false, allowComplexExpr: false })
  const dir = path.join(tmp, 'gen')
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, buf] of Object.entries(out.perScreen.settings!))
    fs.writeFileSync(path.join(dir, name), text(buf))
  const mod = await import(/* @vite-ignore */ path.join(dir, 'settings.tsx'))
  render = mod.default
  bindings = JSON.parse(text(out.perScreen.settings!['settings.bindings.json']))
})
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

function make() {
  const f = fakeApi()
  const qc = makeQueryClient()
  qc.setDefaultOptions({ queries: { ...qc.getDefaultOptions().queries, retry: false } })
  const view = clone(view0) as any
  view.allowlist = ['+12015550142']
  view.faq = [{ q: 'Do you take walk-ins?', a: 'Yes, any time we are open.' }]
  const assistantApi: AssistantApi = {
    get: async () => clone(view),
    save: async () => ({ ...clone(view), changed: [] }),
  }
  const data = new LiveData({
    api: f.api,
    qc,
    session: () => makeSession({ role: 'mgmt' }),
    toast: () => {},
    schedule: (fn) => fn(),
    assistantApi,
  })
  const logic: any = new (createSettingsLogic(data))({})
  logic.__host = {
    __setLogicState(update: any, cb?: () => void) {
      const patch = typeof update === 'function' ? update(logic.state) : update
      logic.state = { ...logic.state, ...patch }
      cb?.()
    },
    forceUpdate: () => {},
  }
  logic.componentDidMount()
  return logic
}

const atPath = (vals: any, p: string): any => {
  let cur = vals
  for (const part of p.match(/[^.[\]]+/g) || []) {
    if (cur === null || cur === undefined) return undefined
    cur = cur[part]
  }
  return cur
}

describe('live Settings template: Oasis AI assistant', () => {
  it('the nav entry sits after Arrival & check-in; the section is not shown elsewhere', async () => {
    const logic = make()
    await vi.waitFor(() => expect(logic.renderVals().live.secOpen).toBe(true))
    const html = renderToStaticMarkup(render(logic.renderVals(), { name: 'settings' }))
    expect(html).toContain('Oasis AI assistant')
    expect(html.indexOf('Arrival &amp; check-in')).toBeLessThan(html.indexOf('Oasis AI assistant'))
    expect(html.indexOf('Oasis AI assistant')).toBeLessThan(html.indexOf('Packages &amp; checklists'))
    expect(html).not.toContain('Who it answers')
    expect(html).not.toContain('>ON<')
  })

  it('renders the whole section from the server view and its save bar after a change', async () => {
    const logic = make()
    logic.renderVals().live.asst.go()
    await vi.waitFor(() => expect(logic.renderVals().live.secAssistant).toBe(true))
    const vals = logic.renderVals()
    // every handler the template binds under live.asst exists
    for (const h of bindings.handlers as string[]) {
      if (!h.startsWith('live.asst.')) continue
      const parts = h.split('[]')
      if (parts.length === 1) {
        expect(typeof atPath(vals, h), h).toBe('function')
        continue
      }
      for (const item of atPath(vals, parts[0]!) as any[])
        expect(typeof atPath(item, parts[1]!.replace(/^\./, '')), h).toBe('function')
    }
    let html = renderToStaticMarkup(render(vals, { name: 'settings' }))
    for (const s of [
      'Oasis AI is off: texts reach the team as today.',
      'Answer texts with Oasis AI',
      'Book, move and cancel by text',
      'Who it answers',
      '>Test numbers<',
      '>Clients<',
      '>Everyone<',
      'Pause after a staff reply',
      '12 hours',
      '(201) 555-0142',
      'Add number',
      'Questions &amp; answers',
      'value="Do you take walk-ins?"',
      'Yes, any time we are open.',
      '1 of 40',
      'Add question',
    ])
      expect(html, s).toContain(s)
    expect(html).not.toContain('Unsaved changes to the assistant')
    vals.live.asst.toggles[0].toggle()
    html = renderToStaticMarkup(render(logic.renderVals(), { name: 'settings' }))
    expect(html).toContain('Unsaved changes to the assistant')
    expect(html).toContain('>Save changes<')
    expect(html).not.toContain('Unsaved changes to working hours')
  })
})
