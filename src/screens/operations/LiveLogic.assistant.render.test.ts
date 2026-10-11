// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
// The LIVE Operations template (with the live patches) rendered with the live view model: the Website PIN cell and its
// confirmation on the Overview, the "AI paused" line above the composer and the "Oasis AI" tag (ADR 0160). With the
// production defaults (assistant off, no PIN anywhere) none of it is in the DOM.
import fs from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compileScreens } from '../../../tools/dc-compile/compile'
import { root } from '../../../tools/dc-compile/tests/original-runtime'
import type { ClientIdentity } from '@/data/ports/operations'
import { FILES, clone, fixtures, makeLive, makeSession, stubPort } from './live-testkit'
import type { StubPort } from './live-testkit'

const tmp = path.join(root, 'tools/dc-compile/tests/.tmp-snippets/operations-assistant-render')
const text = (v: string | Buffer | undefined): string => (Buffer.isBuffer(v) ? v.toString('utf8') : (v ?? ''))
let render: (vals: any, ctx: { name: string }) => any

beforeAll(async () => {
  const out = compileScreens(['operations'], { root, variant: 'live', tplIds: false, allowComplexExpr: false })
  const dir = path.join(tmp, 'gen')
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, buf] of Object.entries(out.perScreen.operations!))
    fs.writeFileSync(path.join(dir, name), text(buf))
  const mod = await import(/* @vite-ignore */ path.join(dir, 'operations.tsx'))
  render = mod.default
})
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

const fileId = (FILES.completed as any).id as string
const customerId = (FILES.completed as any).customer.id as string

async function html(tab: string, setup: (p: StubPort) => void = () => {}, after?: (vals: any) => void) {
  const port = stubPort()
  setup(port)
  const l = makeLive(makeSession({ role: 'mgmt' }), port)
  l.vals()
  await l.settle()
  l.logic.select(fileId, tab)
  for (let i = 0; i < 2; i++) {
    l.vals()
    await l.settle()
  }
  if (after) {
    after(l.vals())
    l.vals()
    await l.settle()
  }
  return renderToStaticMarkup(render(l.vals(), { name: 'operations' }))
}

const pinSet = (p: StubPort) => {
  const i: ClientIdentity = clone(fixtures.identityNone)
  i.pin = { status: 'set', setAt: '2026-06-10T14:00:00.000Z', lockedUntil: null, resetHoldUntil: null }
  i.trust = { ...i.trust, trusted: true, until: '2026-07-10T14:00:00.000Z', reason: null, verifiedBy: 'pin' }
  p.identities.set(customerId, i)
}

describe('live template: AI assistant and phone identity', () => {
  it('the production defaults add nothing to the file: no PIN cell, no AI line, no Oasis AI tag', async () => {
    const overview = await html('overview')
    expect(overview).toContain('Membership')
    expect(overview).not.toContain('Website PIN')
    expect(overview).not.toContain('Clear PIN')
    const messages = await html('messages')
    expect(messages).not.toContain('AI paused')
    expect(messages).not.toContain('Oasis AI')
  })

  it('the Website PIN cell sits under the appointment facts, with Clear PIN and its question', async () => {
    const overview = await html('overview', pinSet)
    expect(overview).toContain('Website PIN')
    expect(overview).toContain('Set · trusted to Jul 10')
    expect(overview).toContain('>Clear PIN<')
    expect(overview).not.toContain('Keep it')
    const asking = await html('overview', pinSet, (v) => v.sel.idClear())
    expect(asking).toContain('Clear Priya’s website PIN?')
    expect(asking).toContain('>Keep it<')
  })

  it('a paused thread shows the line above the composer; the assistant’s texts carry the tag', async () => {
    const messages = await html('messages', (p) => {
      const t = clone(fixtures.thread)
      ;(t as any).assistantActive = true
      ;(t as any).aiPausedUntil = '2026-06-13T22:36:00-04:00'
      ;(t as any).items = [
        {
          id: 'm1',
          text: 'We are closed on Sundays.',
          time: '10:00 AM',
          at: '2026-06-13T14:00:00.000Z',
          direction: 'out',
          from: 'system',
          author: 'ai',
          senderName: 'Oasis AI',
          status: 'delivered',
          channel: 'sms',
          kind: 'sms',
          attachments: [],
        },
      ]
      p.threads.set(fileId, t)
    })
    expect(messages).toContain('AI paused — staff replying')
    expect(messages).toContain('Oasis AI answers again at 10:36 PM.')
    expect(messages).toContain('Oasis AI · SMS')
    expect(messages.indexOf('AI paused')).toBeLessThan(messages.indexOf('placeholder="Type a message…"'))
  })
})
