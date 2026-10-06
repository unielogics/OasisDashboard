import type { Browser, Locator, Page } from '@playwright/test'
import { newParityContext, type ParityContext } from './browser'
import {
  collectElements,
  CURATED_PROPS,
  decodeElements,
  PSEUDO_PROP_LIST,
  readRootHtml,
  settleInPage,
} from './collect'
import { PORT_PATHS, type Screen, type Side, type Theme } from './config'
import type { OriginalServer } from './serve-original'
import type { JsonValue, Snapshot } from './types'
import { serializeVals } from './vals-serialize'

export interface OpenOptions {
  screen: Screen
  theme: Theme
  hash?: string
  touch?: boolean
}

/** What a scenario step can do. The same step function runs against both pages, so it only gets this surface. */
export interface Actions {
  readonly side: Side
  readonly screen: Screen
  readonly theme: Theme
  readonly page: Page
  /** Button whose text STARTS with `text` (counts and badges are trailing spans). Must be unique unless `nth` is given. */
  btn(text: string | RegExp, nth?: number): Locator
  /** Any element inside #dc-root matching the CSS selector. */
  css(selector: string, nth?: number): Locator
  /** Smallest element inside #dc-root whose own text is exactly `text`. */
  text(text: string, nth?: number): Locator
  click(target: Locator | string | RegExp): Promise<void>
  fill(target: Locator, value: string): Promise<void>
  press(key: string): Promise<void>
  /** Advance the paused fake clock by `ms` (timers due in that window fire), then settle. */
  runFor(ms: number): Promise<void>
  settle(): Promise<void>
  /** Dispatch a synthetic PointerEvent sequence (touch gestures cannot be produced by page.touchscreen). */
  pointerSequence(
    steps: PointerStep[],
    opts?: { pointerType?: 'touch' | 'pen' | 'mouse'; pointerId?: number },
  ): Promise<void>
}

export interface PointerStep {
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel'
  x: number
  y: number
  /** advance the fake clock by this many ms BEFORE dispatching the event */
  wait?: number
}

export interface Driver {
  readonly side: Side
  readonly page: Page
  readonly actions: Actions
  open(opts: OpenOptions): Promise<void>
  snapshot(full: boolean): Promise<Snapshot>
  close(): Promise<void>
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

abstract class PageDriver implements Driver {
  abstract readonly side: Side
  protected pc!: ParityContext
  protected opened!: OpenOptions
  actions!: Actions

  constructor(protected readonly browser: Browser) {}

  get page(): Page {
    return this.pc.page
  }

  protected abstract hideBranding: boolean
  protected abstract allowedOrigins(): string[]
  protected abstract urlFor(opts: OpenOptions): string
  protected abstract waitReady(): Promise<void>
  protected abstract readVals(): Promise<JsonValue>

  async open(opts: OpenOptions): Promise<void> {
    this.opened = opts
    this.pc = await newParityContext(this.browser, {
      theme: opts.theme,
      allowedOrigins: this.allowedOrigins(),
      hideBranding: this.hideBranding,
      touch: opts.touch,
    })
    this.actions = this.buildActions(opts)
    await this.page.goto(this.urlFor(opts), { waitUntil: 'load', timeout: 45_000 })
    await this.waitReady()
    await this.settle()
  }

  protected async settle(): Promise<void> {
    await this.page.evaluate(settleInPage)
  }

  async snapshot(full: boolean): Promise<Snapshot> {
    const { page } = this
    // Park the pointer in a corner so hover styling cannot depend on where the last action ended.
    await page.mouse.move(0, 0)
    await this.settle()
    const html = await page.evaluate(readRootHtml)
    const elements = decodeElements(
      await page.evaluate(collectElements, { props: CURATED_PROPS, full, pseudoProps: PSEUDO_PROP_LIST }),
      CURATED_PROPS,
    )
    const vals = await this.readVals()
    const png = await page.screenshot({
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      timeout: 30_000,
    })
    return {
      side: this.side,
      html,
      elements,
      vals,
      png,
      console: this.pc.takeConsole(),
      blocked: this.pc.takeBlocked(),
      fullStyle: full,
    }
  }

  async close(): Promise<void> {
    await this.pc?.ctx.close()
  }

  private buildActions(opts: OpenOptions): Actions {
    const page = this.pc.page
    const ctx = this.pc.ctx
    const settle = () => this.settle()
    const scoped = (selector: string) => page.locator(`#dc-root ${selector}`)
    const pick = (loc: Locator, nth?: number) => (nth === undefined ? loc : loc.nth(nth))
    const actions: Actions = {
      side: this.side,
      screen: opts.screen,
      theme: opts.theme,
      page,
      btn: (text, nth) => {
        const re = typeof text === 'string' ? new RegExp(`^\\s*${escapeRe(text)}`) : text
        return pick(scoped('button').filter({ hasText: re }), nth)
      },
      css: (selector, nth) => pick(scoped(selector), nth),
      text: (text, nth) => pick(page.locator('#dc-root').getByText(text, { exact: true }), nth),
      click: async (target) => {
        const loc = target instanceof RegExp || typeof target === 'string' ? actions.btn(target) : target
        const n = await loc.count()
        if (n !== 1) throw new Error(`[${this.side}] expected exactly 1 match for ${String(loc)}, found ${n}`)
        await loc.click({ timeout: 10_000 })
        await settle()
      },
      fill: async (target, value) => {
        const n = await target.count()
        if (n !== 1)
          throw new Error(`[${this.side}] expected exactly 1 match for ${String(target)}, found ${n}`)
        await target.fill(value, { timeout: 10_000 })
        await settle()
      },
      press: async (key) => {
        await page.keyboard.press(key)
        await settle()
      },
      runFor: async (ms) => {
        await ctx.clock.runFor(ms)
        await settle()
      },
      settle,
      pointerSequence: async (steps, o) => {
        for (const s of steps) {
          if (s.wait) await ctx.clock.runFor(s.wait)
          await page.evaluate(
            ({ s: step, pointerType, pointerId }) => {
              const target = document.elementFromPoint(step.x, step.y) ?? document.body
              const init: PointerEventInit = {
                bubbles: true,
                cancelable: true,
                composed: true,
                clientX: step.x,
                clientY: step.y,
                pointerId,
                pointerType,
                isPrimary: true,
                button: step.type === 'pointermove' ? -1 : 0,
                buttons: step.type === 'pointerup' || step.type === 'pointercancel' ? 0 : 1,
              }
              target.dispatchEvent(new PointerEvent(step.type, init))
            },
            { s, pointerType: o?.pointerType ?? 'touch', pointerId: o?.pointerId ?? 1 },
          )
        }
        await settle()
      },
    }
    return actions
  }
}

/** Renders a design's original bundle (served by serve-original) in a pinned browser context. */
export class OriginalDriver extends PageDriver {
  protected hideBranding = true

  constructor(
    browser: Browser,
    private readonly server: OriginalServer,
    readonly side: Side = 'orig',
  ) {
    super(browser)
  }

  protected allowedOrigins(): string[] {
    return [this.server.origin]
  }

  protected urlFor(o: OpenOptions): string {
    return this.server.url(o.screen, o.hash)
  }

  protected async waitReady(): Promise<void> {
    await this.page.waitForSelector('#dc-root .sc-host', { state: 'attached', timeout: 30_000 })
  }

  /**
   * The live logic instance is not exposed by the dc runtime (window.__dcRegistry only holds the class and the
   * subscriber set), so find it through React: the .sc-host div is rendered by the StreamableComponent, whose
   * instance carries `.logic`. Calling renderVals() again is what the runtime does on every render.
   */
  protected async readVals(): Promise<JsonValue> {
    const expr = `(() => {
      const ser = ${serializeVals.toString()};
      const host = document.querySelector('#dc-root .sc-host');
      if (!host) throw new Error('no .sc-host');
      const key = Object.keys(host).find((k) => k.startsWith('__reactFiber$'));
      let fiber = key ? host[key] : null;
      while (fiber) {
        const inst = fiber.stateNode;
        if (inst && inst.logic && typeof inst.logic.renderVals === 'function') return JSON.stringify(ser(inst.logic.renderVals()));
        fiber = fiber.return;
      }
      throw new Error('logic instance not found behind .sc-host');
    })()`
    return JSON.parse((await this.page.evaluate(expr)) as string) as JsonValue
  }
}

/** Loads the Next production build (NEXT_PUBLIC_PARITY=1) and reads renderVals through window.__oasisParity. */
export class PortDriver extends PageDriver {
  readonly side: Side = 'port'
  protected hideBranding = false

  constructor(
    browser: Browser,
    private readonly baseUrl: string,
  ) {
    super(browser)
  }

  protected allowedOrigins(): string[] {
    return [new URL(this.baseUrl).origin]
  }

  protected urlFor(o: OpenOptions): string {
    const hash = o.hash ? (o.hash.startsWith('#') ? o.hash : `#${o.hash}`) : ''
    return `${this.baseUrl.replace(/\/$/, '')}${PORT_PATHS[o.screen]}${hash}`
  }

  protected async waitReady(): Promise<void> {
    await this.page.waitForSelector('#dc-root[data-oasis-ready="1"]', { state: 'attached', timeout: 30_000 })
  }

  protected async readVals(): Promise<JsonValue> {
    const vals = await this.page.evaluate(() => {
      const hook = (window as unknown as { __oasisParity?: { getVals?: () => unknown } }).__oasisParity
      if (!hook || typeof hook.getVals !== 'function')
        throw new Error('window.__oasisParity.getVals is missing (not a NEXT_PUBLIC_PARITY=1 build?)')
      return JSON.stringify(hook.getVals())
    })
    return JSON.parse(vals) as JsonValue
  }
}
