// A photo whose thumbnail fails to load (no object behind the seeded row, or an expired link) shows the design's grey
// tile instead of the browser's broken-image box; found by the live parity run of the Photos tab.
import { describe, expect, it } from 'vitest'
import { photoSections, type PhotoHandlers } from '@/lib/operations/live/file'
import { FILES, clone } from './live-testkit'

function handlers(): PhotoHandlers & { broken: Set<string> } {
  const broken = new Set<string>()
  return {
    broken,
    upload: () => {},
    thumb: (p) => p.thumbUrl || p.url || '',
    thumbFailed: (url) => void broken.add(url),
    isThumbBroken: (url) => broken.has(url),
  }
}

const DESIGN_TILE = {
  aspectRatio: '4/3',
  borderRadius: '11px',
  background: 'var(--panel3)',
  border: '1px solid var(--line)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

describe('photo slots', () => {
  it('a loadable thumbnail is an image with an error handler', () => {
    const h = handlers()
    const arrival = photoSections(clone(FILES.cleaning), false, true, new Set(), h)[0]!
    const first = (arrival.slots as Array<Record<string, unknown>>)[0]!
    expect(first.icon).toBe(false)
    expect(String(first.thumb)).toMatch(/dev-storage/)
    expect(typeof first.onError).toBe('function')
  })

  it('after the image fails, the slot is the design tile (icon, no image) and the others keep their thumbnails', () => {
    const h = handlers()
    const f = clone(FILES.cleaning)
    const before = photoSections(f, false, true, new Set(), h)[0]!
    ;(before.slots as Array<{ onError: () => void }>)[0]!.onError()
    const arrival = photoSections(f, false, true, new Set(), h)[0]!
    const [a, b] = arrival.slots as Array<Record<string, unknown>>
    expect(a).toEqual({ icon: true, thumb: '', note: '', add: false, style: DESIGN_TILE })
    expect(b!.icon).toBe(false)
    expect(String(b!.thumb)).toMatch(/dev-storage/)
  })
})
