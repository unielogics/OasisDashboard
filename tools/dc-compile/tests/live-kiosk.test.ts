// Kiosk mode's live patches (ADR 0180; DEVIATIONS DV-1003..DV-1009): their guards fail the build (exit 3) when the design
// template they target changes, they never reach the prod or parity output, and the patched templates still compile.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { compileScreens } from '../compile'
import { CompileError } from '../errors'
import { applyPatches, loadPatchConfig } from '../patches'
import { parseTemplate } from '../parse'
import { root } from './original-runtime'

const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8')
const text = (v: string | Buffer | undefined): string => (Buffer.isBuffer(v) ? v.toString('utf8') : (v ?? ''))

const exit3 = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(CompileError)
    expect((e as CompileError).exit).toBe(3)
    return
  }
  throw new Error('expected the patch guard to fail the build')
}

describe('kiosk live patches', () => {
  it('Operations: the hidden tabs and Manage links, the picker and the acting chip are guarded', () => {
    const cfg = loadPatchConfig(root, 'operations', 'live')
    const html = read('design/extracted/operations/template.html')
    applyPatches(parseTemplate(html).nodes, cfg, 'operations')
    for (const [from, to] of [
      ['font-weight:700;color:var(--ink2);">Payments</a>', 'font-weight:700;color:var(--ink2);">Payouts</a>'],
      ['font-weight:700;color:var(--ink2);">Settings</a>', 'font-weight:700;color:var(--ink2);">Setup</a>'],
      ['color:#C2410C;font-weight:800;font-size:13px;">Manage</a>', 'color:#C2410C;font-weight:800;font-size:13px;">Edit</a>'],
      ['Manage hours &amp; holidays →', 'Hours →'],
      ['Capture arrival condition', 'Take arrival photos'],
      ['>Conversation</div>', '>Chat</div>'],
    ] as const) {
      expect(html, from).toContain(from)
      exit3(() => applyPatches(parseTemplate(html.replace(from, to)).nodes, cfg, 'operations'))
    }
  })

  it('Settings: no nav entry is added (DV-1009); the sections sit with the other live sections', () => {
    const ops = (JSON.parse(read('design-patches/live/settings.patch.json')) as { ops: Array<{ tpl: number; htmlFile?: string }> }).ops
    const shop = ops.filter((o) => /shopfloor/.test(o.htmlFile ?? ''))
    expect(shop.map((o) => o.tpl)).toEqual([415])
  })

  it('never reaches the prod or parity output; the live output has them', () => {
    const marks = ['data-kiosk-picker', 'live?.showAdminNav', 'live?.adminKiosk', 'live?.shopTabs', 'Lock the kiosk now?']
    for (const variant of ['prod', 'parity'] as const) {
      const out = compileScreens(['operations', 'settings'], { root, variant, tplIds: variant === 'parity', allowComplexExpr: false })
      for (const s of ['operations', 'settings'] as const)
        for (const m of marks) expect(text(out.perScreen[s]![`${s}.tsx`]), `${variant} ${s} ${m}`).not.toContain(m)
    }
    const live = compileScreens(['operations', 'settings', 'payments'], { root, variant: 'live', tplIds: false, allowComplexExpr: false })
    const ops = text(live.perScreen.operations!['operations.tsx'])
    for (const m of ['data-kiosk-picker', 'live?.showAdminNav', 'live?.adminKiosk', 'live?.acting', 'Lock the kiosk now?'])
      expect(ops, m).toContain(m)
    expect(text(live.perScreen.settings!['settings.tsx'])).toContain('live?.shopTabs')
    expect(text(live.perScreen.payments!['payments.tsx'])).toContain('live?.adminKiosk')
  })
})
