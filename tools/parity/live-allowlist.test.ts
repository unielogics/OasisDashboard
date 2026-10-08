import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { checkAllowlistScopes, loadAllowlist, swapsFor, type AllowEntry } from './allowlist'
import { extractTemplate } from './bundle'
import { ALLOWLIST_FILE, ORIGINAL_DIR, SCREENS } from './config'
import { LIVE_ALLOWLIST_FILE } from './live-config'
import { LIVE_SCREENS, liveScreens } from './live-registry'
import { buildBundle } from './serve-original'
import { ALL_SCENARIOS } from './scenarios'

const base = loadAllowlist(ALLOWLIST_FILE)
const live = loadAllowlist(LIVE_ALLOWLIST_FILE)

describe('parity/allowlist.live.json', () => {
  it('has unique ids that do not collide with the fixture allow-list', () => {
    const ids = [...base, ...live].map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const e of live) expect(e.id).toMatch(/^L-(payments|settings|operations|all)-\d{2}$/)
  })

  it('gives every entry a reason that names a deviation (DV-nnn) from design-patches/DEVIATIONS.md', () => {
    const doc = fs.readFileSync(new URL('../../design-patches/DEVIATIONS.md', import.meta.url), 'utf8')
    for (const e of live) {
      const named = e.reason.match(/DV-\d{3}/g)
      expect(named, `${e.id} names no DV id`).toBeTruthy()
      for (const dv of named!)
        expect(doc, `${e.id} cites ${dv}, which DEVIATIONS.md does not list`).toContain(dv)
    }
  })

  it('has scopes that name real scenarios and steps', () => {
    expect(checkAllowlistScopes([...base, ...live], ALL_SCENARIOS)).toEqual([])
  })

  it('has swaps that match each original bundle exactly as often as declared, and still compile', () => {
    for (const screen of SCREENS) {
      const swaps = swapsFor([...base, ...live], screen)
      const { html } = buildBundle(screen, ORIGINAL_DIR, swaps) // throws on a stale or over-broad swap
      const { template } = extractTemplate(html)
      const script = /<script[^>]*data-dc-script[^>]*>([\s\S]*?)<\/script>/.exec(template)
      expect(script, `${screen}: no logic script`).toBeTruthy()
      expect(
        () => new Function('DCLogic', script![1]!),
        `${screen}: swapped logic does not compile`,
      ).not.toThrow()
    }
  })

  it('lists no entry for a screen that is not live yet', () => {
    const pending = new Set(SCREENS.filter((s) => LIVE_SCREENS[s].status === 'pending'))
    for (const e of live as AllowEntry[]) expect(pending.has(e.screen as never), e.id).toBe(false)
  })
})

describe('live registry', () => {
  it('registers every screen as live, each on its own stack with its own ports and seed profiles', () => {
    expect(Object.keys(LIVE_SCREENS).sort()).toEqual([...SCREENS].sort())
    expect(liveScreens().sort()).toEqual(['operations', 'payments', 'settings'])
    expect(LIVE_SCREENS.payments.profiles.sort()).toEqual(['design', 'parity-pay'])
    expect(LIVE_SCREENS.operations.profiles.sort()).toEqual(['design', 'parity-ops'])
    expect(LIVE_SCREENS.settings.profiles.sort()).toEqual(['design', 'parity-ops'])
    const stacks = SCREENS.map((s) => LIVE_SCREENS[s].stack)
    expect(new Set(stacks).size).toBe(stacks.length)
    const ports = SCREENS.flatMap((s) => [LIVE_SCREENS[s].ports.api, LIVE_SCREENS[s].ports.web])
    expect(new Set(ports).size).toBe(ports.length)
  })

  it('leaves out only scenarios of the catalogue, each with a reason', () => {
    for (const s of SCREENS)
      for (const [id, reason] of Object.entries(LIVE_SCREENS[s].skip ?? {})) {
        expect(
          ALL_SCENARIOS.some((x) => x.screen === s && x.id === id),
          `${s}/${id}`,
        ).toBe(true)
        expect(reason.length).toBeGreaterThan(20)
      }
  })
})
