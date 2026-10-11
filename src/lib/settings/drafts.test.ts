import { describe, expect, it } from 'vitest'
import { DraftSet, rebase } from './drafts'

type Svc = { name: string; member: string; visible: boolean }
type Rem = { reminders: { offsetsMin: number[]; categoryPrep: Record<string, string> }; leads: { on: boolean; delay: number } }

describe('rebase', () => {
  const base: Svc = { name: 'Signature', member: '45', visible: true }

  it('same version: nothing changes', () => {
    const t = { base, version: 3, value: { ...base, member: '46' } }
    expect(rebase(t, { ...base, name: 'X' }, 3)).toEqual({ tracked: t, conflicts: [] })
  })

  it('untouched fields follow the newer copy, changed ones stay, the version moves on', () => {
    const t = { base, version: 3, value: { ...base, member: '46' } }
    const r = rebase(t, { ...base, name: 'Signature Wash', visible: false }, 4)
    expect(r.conflicts).toEqual([])
    expect(r.tracked).toEqual({
      base: { name: 'Signature Wash', member: '45', visible: false },
      version: 4,
      value: { name: 'Signature Wash', member: '46', visible: false },
    })
  })

  it('the same change on both sides is no conflict; different changes to one field are', () => {
    const t = { base, version: 3, value: { ...base, member: '46', name: 'A' } }
    const r = rebase(t, { ...base, member: '46', name: 'B' }, 4)
    expect(r.conflicts).toEqual(['name'])
    expect(r.tracked.value).toEqual({ name: 'A', member: '46', visible: true })
  })

  it('nested groups merge field by field; arrays are one value; an emptied prep line is the same as none', () => {
    const b: Rem = { reminders: { offsetsMin: [1440, 120], categoryPrep: {} }, leads: { on: true, delay: 180 } }
    const mine: Rem = { reminders: { offsetsMin: [1440, 120, 30], categoryPrep: { wash: '' } }, leads: { on: false, delay: 180 } }
    const theirs: Rem = {
      reminders: { offsetsMin: [1440, 120], categoryPrep: { tint: 'Plan for 2 hours.' } },
      leads: { on: true, delay: 240 },
    }
    const r = rebase({ base: b, version: 16, value: mine }, theirs, 17)
    expect(r.conflicts).toEqual([])
    expect(r.tracked.value).toEqual({
      reminders: { offsetsMin: [1440, 120, 30], categoryPrep: { tint: 'Plan for 2 hours.' } },
      leads: { on: false, delay: 240 },
    })
  })

  it('a prep line both wrote differently is a conflict named by its path', () => {
    const b: Rem = { reminders: { offsetsMin: [], categoryPrep: {} }, leads: { on: true, delay: 1 } }
    const r = rebase(
      { base: b, version: 1, value: { ...b, reminders: { offsetsMin: [], categoryPrep: { tint: 'Mine' } } } },
      { ...b, reminders: { offsetsMin: [], categoryPrep: { tint: 'Theirs' } } },
      2,
    )
    expect(r.conflicts).toEqual(['reminders.categoryPrep.tint'])
  })
})

describe('DraftSet', () => {
  const s1: Svc = { name: 'Signature', member: '45', visible: true }

  it('a draft keeps the version it started from until a newer copy is seen', () => {
    const d = new DraftSet<Svc>()
    d.set('p', s1, 3, { ...s1, member: '46' })
    expect(d.get('p', s1, 3)).toMatchObject({ version: 3, value: { member: '46' }, conflict: false })
    const s2 = { ...s1, visible: false }
    expect(d.get('p', s2, 4)).toMatchObject({ version: 4, value: { member: '46', visible: false }, conflict: false })
  })

  it('an edit back to the server copy, or a newer copy that equals the draft, leaves nothing unsaved', () => {
    const d = new DraftSet<Svc>()
    d.set('p', s1, 3, { ...s1, member: '46' })
    d.set('p', s1, 3, s1)
    expect(d.has('p')).toBe(false)
    d.set('p', s1, 3, { ...s1, member: '46' })
    expect(d.get('p', { ...s1, member: '46' }, 4)).toBeUndefined()
    expect(d.has('p')).toBe(false)
  })

  it('a conflict stays flagged through later edits until the draft is dropped', () => {
    const d = new DraftSet<Svc>()
    d.set('p', s1, 3, { ...s1, name: 'Mine' })
    const s2 = { ...s1, name: 'Theirs' }
    expect(d.get('p', s2, 4)).toMatchObject({ conflict: true, value: { name: 'Mine' }, version: 4 })
    d.set('p', s2, 4, { ...s1, name: 'Mine!' })
    expect(d.get('p', s2, 4)?.conflict).toBe(true)
    d.drop('p')
    expect(d.value('p', s2, 4)).toEqual(s2)
  })

  it('takes the form’s own idea of “unchanged”', () => {
    const d = new DraftSet<{ colour: string }>((a, b) => a.colour.toUpperCase() === b.colour.toUpperCase())
    d.set('c', { colour: '#ABCDEF' }, 1, { colour: '#abcdef' })
    expect(d.has('c')).toBe(false)
  })
})
