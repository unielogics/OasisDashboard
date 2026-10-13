// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { KIOSK_STAFF } from './test-fixtures'
import { KioskPicker, STICKY_MS, carOf } from './kiosk-picker'

const make = () => {
  const clock = { now: 1_000_000 }
  const p = new KioskPicker(() => clock.now)
  p.setStaff(KIOSK_STAFF)
  let changes = 0
  p.subscribe(() => changes++)
  return { p, clock, changes: () => changes }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('the kiosk employee picker (DV-1005)', () => {
  it('opens with every name in the server order (bay staff first), nothing preselected; a tap answers', async () => {
    const { p } = make()
    expect(p.vals().open).toBe(false)
    const answer = p.pick({ title: 'Who’s putting Maria’s Camry in Bay 2?' })
    const v = p.vals()
    expect(v.open).toBe(true)
    expect(v.title).toBe('Who’s putting Maria’s Camry in Bay 2?')
    expect(v.tiles.map((t) => t.name)).toEqual(['Marco R.', 'Lena K.', 'Sofia P.'])
    expect(v.tiles.map((t) => t.title)).toEqual(['Detailer', 'Detailer', 'Front desk'])
    // the server's colour, else one of the design's avatar colours
    expect(v.tiles[0]!.avatarStyle.background).toBe('#2563EB')
    expect(v.tiles[1]!.avatarStyle.background).toMatch(/^#/)
    expect(v.tiles[0]!.avatarStyle.width).toBe('48px')
    v.tiles[1]!.onClick()
    await expect(answer).resolves.toBe('emp-lena')
    expect(p.vals().open).toBe(false)
  })

  it('Cancel, a tap outside or Esc answers null', async () => {
    const { p } = make()
    const a = p.pick({ title: 'x' })
    p.vals().cancel()
    await expect(a).resolves.toBeNull()
    const b = p.pick({ title: 'x' })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await expect(b).resolves.toBeNull()
    expect(p.isOpen).toBe(false)
  })

  it('a second question replaces the first, which is cancelled', async () => {
    const { p } = make()
    const a = p.pick({ title: 'first' })
    const b = p.pick({ title: 'second' })
    await expect(a).resolves.toBeNull()
    expect(p.vals().title).toBe('second')
    p.choose('emp-marco')
    await expect(b).resolves.toBe('emp-marco')
  })

  it('a name that is not listed cannot be chosen', async () => {
    const { p } = make()
    const a = p.pick({ title: 'x' })
    p.choose('emp-nobody')
    expect(p.isOpen).toBe(true)
    p.choose('emp-sofia')
    await expect(a).resolves.toBe('emp-sofia')
  })

  it('sticky per open file: 2 minutes of activity, each use starts them again; another file asks', async () => {
    const { p, clock } = make()
    const a = p.pick({ title: 'Who’s texting Maria?', sticky: 'appt-1' })
    p.choose('emp-marco')
    await a
    expect(p.acting('appt-1')?.name).toBe('Marco R.')
    clock.now += STICKY_MS - 1000
    await expect(p.pick({ title: 'again', sticky: 'appt-1' })).resolves.toBe('emp-marco')
    expect(p.isOpen).toBe(false)
    // the use above started the two minutes again
    clock.now += STICKY_MS - 1000
    expect(p.acting('appt-1')?.id).toBe('emp-marco')
    // another file asks
    const other = p.pick({ title: 'x', sticky: 'appt-2' })
    expect(p.isOpen).toBe(true)
    p.cancel()
    await expect(other).resolves.toBeNull()
    // two quiet minutes: asked again
    clock.now += STICKY_MS + 1
    expect(p.acting('appt-1')).toBeNull()
    const again = p.pick({ title: 'x', sticky: 'appt-1' })
    expect(p.isOpen).toBe(true)
    p.choose('emp-lena')
    await expect(again).resolves.toBe('emp-lena')
  })

  it('Change asks again for that file; closing the file forgets it; a person no longer listed is dropped', async () => {
    const { p } = make()
    const a = p.pick({ title: 'x', sticky: 'appt-1' })
    p.choose('emp-marco')
    await a
    const c = p.change('appt-1')
    p.choose('emp-sofia')
    await expect(c).resolves.toBe('emp-sofia')
    expect(p.acting('appt-1')?.name).toBe('Sofia P.')
    p.forget('appt-1')
    expect(p.acting('appt-1')).toBeNull()
    const b = p.pick({ title: 'x', sticky: 'appt-3' })
    p.choose('emp-lena')
    await b
    p.setStaff(KIOSK_STAFF.filter((s) => s.id !== 'emp-lena'))
    expect(p.acting('appt-3')).toBeNull()
  })

  it('car steps (no sticky key) ask every time', async () => {
    const { p } = make()
    for (let i = 0; i < 2; i++) {
      const a = p.pick({ title: 'Who’s starting Maria’s Camry?' })
      expect(p.isOpen).toBe(true)
      p.choose('emp-marco')
      await a
    }
  })

  it('an empty list says how to add names', () => {
    const { p } = make()
    p.setStaff([])
    void p.pick({ title: 'x' })
    expect(p.vals().empty).toBe(true)
    p.cancel()
  })

  it('keeps the board’s shortcuts from acting behind the dialog and keeps Tab inside it', async () => {
    const { p } = make()
    const seen: string[] = []
    const onKey = (e: KeyboardEvent) => seen.push(e.key)
    window.addEventListener('keydown', onKey)
    const dialog = document.createElement('div')
    dialog.setAttribute('data-kiosk-picker', '1')
    const b1 = document.createElement('button')
    const b2 = document.createElement('button')
    dialog.append(b1, b2)
    document.body.append(dialog)
    const a = p.pick({ title: 'x' })
    b2.focus()
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    expect(document.activeElement).toBe(b1)
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
    expect(document.activeElement).toBe(b2)
    expect(seen).toEqual([])
    p.cancel()
    await a
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))
    expect(seen).toEqual(['s'])
    window.removeEventListener('keydown', onKey)
  })

  it('tells its listeners when it changes', () => {
    const { p, changes } = make()
    const before = changes()
    void p.pick({ title: 'x' })
    p.cancel()
    expect(changes()).toBeGreaterThan(before)
  })
})

describe('carOf', () => {
  it('names the client’s car the way staff say it', () => {
    expect(carOf('Maria Lopez', 'Camry')).toBe('Maria’s Camry')
    expect(carOf('Maria Lopez', 'Toyota Camry')).toBe('Maria’s Toyota Camry')
    expect(carOf('Maria Lopez', '2021 Toyota Camry · Silver')).toBe('Maria’s Toyota Camry')
    expect(carOf('Maria', '')).toBe('Maria’s car')
    expect(carOf('', 'Camry')).toBe('this car')
    expect(carOf(null, null)).toBe('this car')
  })
})
