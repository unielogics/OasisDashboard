import type { Browser, Page, Request } from '@playwright/test'
import type { ParityContextOptions } from './browser'
import { LOCALE, PORT_PATHS, TIMEZONE, VIEWPORT, type Theme } from './config'
import { PageDriver, readValsViaFiber, type OpenOptions } from './drivers'
import type { JsonValue } from './types'

/** A running stack from `pnpm live:up` (scripts/live-stack.ts writes .live-stack/<name>.json). */
export interface LiveTarget {
  name: string
  webUrl: string
  apiUrl: string
  /** the instant the stack's API clock is frozen at (ISO with offset); the browser's Date is pinned to the same instant */
  frozen: string
  devPassword: string
  /** who signs in; the design's chip reads "Rafael M." */
  email: string
}

export const LIVE_USER = 'rafael@oasisautospa.com'

/** How long the page must stay unchanged, with no API request in flight, before a snapshot is taken (real time). */
const QUIET_MS = 900

const API_PREFIX = '/api/v1/'
const EVENTS_PATH = '/api/v1/events'

/**
 * Page timers of at least this many milliseconds are held by the harness and fire only when a scenario advances time
 * (`runFor`), like every timer of the originals on their paused clock: the long-press (380 ms), the click suppression
 * after a gesture (450 ms), a toast (3.2 s). Shorter ones (react-query's batching, the 200/250 ms debounces) also run in
 * real time, because the live screens need them to load. Without this a toast could expire, or a long-press arm, in
 * real time while the harness waits for the page to settle, at a moment the pinned Date does not know.
 */
export const HELD_TIMER_MS = 300

/**
 * Installed before the page's scripts. Every setTimeout is recorded with its due instant on the pinned Date; a short one
 * also runs in real time (react-query, debounces, the long-press), a long one waits. A setInterval of a second or more
 * (the 1 s tick) never runs in real time. `__parityDue(t)` lists the timers
 * due by instant t in order and `__parityFire(id)` runs one now, so the harness can step the pinned Date through them
 * like a fake clock does.
 */
export function timerControlScript(threshold: number): string {
  return `(function () {
  if (window.__parityFire) return;
  var realSet = window.setTimeout.bind(window), realClear = window.clearTimeout.bind(window);
  var timers = new Map(), next = 2e9;
  window.setTimeout = function (fn, ms) {
    if (typeof fn !== 'function') return realSet.apply(window, arguments);
    var args = Array.prototype.slice.call(arguments, 2), wait = Math.max(0, Number(ms) || 0), id = ++next;
    var t = { fn: fn, args: args, due: Date.now() + wait, seq: id, real: null };
    if (wait < ${threshold})
      t.real = realSet(function () { if (timers.delete(id)) fn.apply(window, args); }, wait);
    timers.set(id, t);
    return id;
  };
  window.clearTimeout = function (id) {
    var t = timers.get(id);
    if (!t) return realClear(id);
    timers.delete(id);
    if (t.real !== null) realClear(t.real);
  };
  // intervals of a second or more (the screens' 1 s tick, polls) only move with the scenario clock, like the originals'
  var realSetI = window.setInterval.bind(window), realClearI = window.clearInterval.bind(window);
  window.setInterval = function (fn, ms) {
    if (typeof fn !== 'function') return realSetI.apply(window, arguments);
    var args = Array.prototype.slice.call(arguments, 2), every = Math.max(0, Number(ms) || 0);
    if (every < 1000) return realSetI.apply(window, arguments);
    var id = ++next;
    timers.set(id, { fn: fn, args: args, due: Date.now() + every, seq: id, real: null, every: every });
    return id;
  };
  window.clearInterval = function (id) {
    if (timers.has(id)) timers.delete(id);
    else realClearI(id);
  };
  window.__parityDue = function (until) {
    var out = [];
    timers.forEach(function (t, id) { if (t.due <= until) out.push([id, t.due, t.seq]); });
    out.sort(function (a, b) { return a[1] - b[1] || a[2] - b[2]; });
    return out.map(function (x) { return [x[0], x[1]]; });
  };
  window.__parityFire = function (id) {
    var t = timers.get(id);
    if (!t) return false;
    if (t.every) {
      t.due += t.every;
      t.seq = ++next;
    } else {
      timers.delete(id);
      if (t.real !== null) realClear(t.real);
    }
    t.fn.apply(window, t.args);
    return true;
  };
})();`
}

/** Texts that mean the screen is still waiting for data (boot splash, loading cards). */
const LOADING_RE = /Loading settings|Loading payments|Loading…|Loading\.\.\.|Reconnecting|Connection lost/

export class LiveNotReadyError extends Error {}

/**
 * Drives the live dashboard build served against a real API stack. The same scenario steps run on it as on the
 * original; what differs is how it gets to a stable state:
 *  - sign in through the real /login page in a throwaway context (cookie jar per run), and save the theme as the
 *    user's server preference (the server value wins over localStorage in the live variant);
 *  - the browser's Date is pinned to the stack's frozen instant but timers run for real (react-query, rAF, SSE);
 *  - "ready" = the screen mounted, the event stream is connected, no API request is in flight and the DOM stopped
 *    changing for QUIET_MS, with no loading text on screen.
 */
export class LiveDriver extends PageDriver {
  readonly side = 'port' as const
  protected hideBranding = false
  private pending = new Set<Request>()
  private sseConnected = false
  private apiFailures: string[] = []
  /** the pinned instant of the page's Date (moves only with runFor) */
  private now = 0

  constructor(
    browser: Browser,
    private readonly target: LiveTarget,
  ) {
    super(browser)
    this.ignoreTpl = true
  }

  protected allowedOrigins(): string[] {
    return [...new Set([new URL(this.target.webUrl).origin, new URL(this.target.apiUrl).origin])]
  }

  protected urlFor(o: OpenOptions): string {
    const hash = o.hash ? (o.hash.startsWith('#') ? o.hash : `#${o.hash}`) : ''
    return `${this.target.webUrl.replace(/\/$/, '')}${PORT_PATHS[o.screen]}${hash}`
  }

  protected async prepare(o: OpenOptions): Promise<Partial<ParityContextOptions>> {
    const cookies = await signIn(this.browser, this.target, o.theme, PORT_PATHS[o.screen])
    return { clock: 'fixed', fixedNow: this.target.frozen, cookies }
  }

  protected async attach(): Promise<void> {
    const { page } = this
    this.now = new Date(this.target.frozen).getTime()
    await page.addInitScript(timerControlScript(HELD_TIMER_MS))
    page.on('request', (r) => {
      const u = new URL(r.url())
      if (u.pathname.startsWith(API_PREFIX) && u.pathname !== EVENTS_PATH) this.pending.add(r)
    })
    const done = (r: Request) => void this.pending.delete(r)
    page.on('requestfinished', done)
    page.on('requestfailed', done)
    page.on('response', (r) => {
      const u = new URL(r.url())
      if (u.pathname === EVENTS_PATH && r.status() === 200) this.sseConnected = true
      if (u.pathname.startsWith(API_PREFIX) && r.status() >= 400)
        this.apiFailures.push(`${r.status()} ${r.request().method()} ${u.pathname}`)
    })
  }

  /**
   * Time moves like on the originals' paused clock: the timers due within `ms` fire in order, each with the pinned Date
   * set to its own due instant (a long-press fires at +380 ms, not at +400), then the Date rests at the end of the span.
   */
  protected async advance(ms: number): Promise<void> {
    const { page } = this
    const end = this.now + ms
    type W = { __parityDue(t: number): Array<[number, number]>; __parityFire(id: number): boolean }
    for (let i = 0; i < 10_000; i++) {
      const due = await page.evaluate((t) => (window as unknown as W).__parityDue(t), end)
      if (!due.length) break
      const [id, at] = due[0]!
      if (at > this.now) {
        this.now = at
        await page.clock.setFixedTime(new Date(at))
      }
      await page.evaluate((x) => (window as unknown as W).__parityFire(x), id)
    }
    this.now = end
    await page.clock.setFixedTime(new Date(end))
  }

  protected async waitReady(): Promise<void> {
    const { page } = this
    try {
      await page.waitForSelector('#dc-root .sc-host', { state: 'attached', timeout: 45_000 })
    } catch {
      throw new LiveNotReadyError(
        `the screen did not mount (url ${page.url()}, api failures: ${this.apiFailures.join(', ') || 'none'})`,
      )
    }
    const t0 = Date.now()
    while (!this.sseConnected) {
      if (Date.now() - t0 > 20_000)
        throw new LiveNotReadyError('the event stream (/api/v1/events) never connected')
      await page.waitForTimeout(100)
    }
  }

  protected override async settle(): Promise<void> {
    await super.settle()
    await this.waitIdle()
  }

  /**
   * No API request in flight, no loading text, and #dc-root unchanged for QUIET_MS. The quiet window must outlast the
   * screens' own debounce timers (Settings asks for the emergency preview 250 ms after the form changes), otherwise a
   * request that is about to start is missed and the snapshot shows the client's stand-in text.
   */
  private async waitIdle(): Promise<void> {
    const { page } = this
    const deadline = Date.now() + 40_000
    let last = ''
    let stableSince = 0
    // let a click's handler start its request before the first look
    await page.waitForTimeout(120)
    while (Date.now() < deadline) {
      if (this.pending.size > 0) {
        stableSince = 0
        await page.waitForTimeout(80)
        continue
      }
      const snap = await page.evaluate(settleInPageState, LOADING_RE.source)
      if (snap.loading || snap.html !== last) {
        stableSince = 0
        last = snap.html
      } else {
        stableSince ||= Date.now()
        if (Date.now() - stableSince >= QUIET_MS) return
      }
      await page.waitForTimeout(100)
    }
    throw new LiveNotReadyError(
      `the live screen never settled (pending ${[...this.pending].map((r) => r.url()).join(', ') || 'none'}, loading text ${LOADING_RE.source})`,
    )
  }

  protected async readVals(): Promise<JsonValue> {
    return readValsViaFiber(this.page)
  }

  /** Leave the page first so the browser drops its event stream before the context goes away. */
  override async close(): Promise<void> {
    try {
      await this.page?.goto('about:blank', { timeout: 5_000 })
    } catch {
      // the context is closed next either way
    }
    await super.close()
  }

  /** 4xx/5xx answers of the API seen since the page opened (the console check also sees the browser's own message). */
  failures(): readonly string[] {
    return this.apiFailures
  }
}

/** Evaluated in the page; kept free of closures (Playwright serialises the function source). */
function settleInPageState(loadingSource: string): { html: string; loading: boolean } {
  const root = document.querySelector('#dc-root')
  return { html: root?.outerHTML ?? '', loading: new RegExp(loadingSource).test(root?.textContent ?? '') }
}

export interface Cookie {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  httpOnly: boolean
  secure: boolean
  sameSite: 'Strict' | 'Lax' | 'None'
}

/**
 * Signs in through the real /login page (unclocked context, so its timers run) and returns the session cookies of
 * that jar. The theme is stored as the user's server preference first, because the live variant takes the theme from
 * the server and only uses localStorage as a cache.
 */
export async function signIn(browser: Browser, t: LiveTarget, theme: Theme, next: string): Promise<Cookie[]> {
  const ctx = await browser.newContext({
    viewport: { ...VIEWPORT },
    timezoneId: TIMEZONE,
    locale: LOCALE,
    serviceWorkers: 'block',
  })
  try {
    // the sign-in context only needs the cookie: it must not leave an event stream open behind it (the API allows 8
    // streams per person and the dashboard's proxy keeps a dropped one alive for a while)
    await ctx.route('**/api/v1/events*', (route) => route.abort())
    const page = await ctx.newPage()
    await page.goto(`${t.webUrl}/login?next=${encodeURIComponent(next)}`, { waitUntil: 'load' })
    await page.getByLabel(/email/i).fill(t.email)
    await page.getByLabel(/password/i).fill(t.devPassword)
    await Promise.all([
      page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 }),
      page.getByRole('button', { name: /sign in|log in/i }).click(),
    ])
    await setServerTheme(page, t, theme)
    return (await ctx.cookies()) as Cookie[]
  } finally {
    await ctx.close()
  }
}

async function setServerTheme(page: Page, t: LiveTarget, theme: Theme): Promise<void> {
  const origin = new URL(t.webUrl).origin
  const me = await page.context().request.get(`${t.webUrl}/api/v1/me`, { headers: { origin } })
  if (!me.ok()) throw new Error(`GET /me failed with ${me.status()}`)
  const body = (await me.json()) as { csrfToken?: string; preferences?: { theme: string | null } }
  if (body.preferences?.theme === theme) return
  const res = await page.context().request.put(`${t.webUrl}/api/v1/me/preferences`, {
    headers: { origin, 'x-csrf-token': body.csrfToken ?? '', 'content-type': 'application/json' },
    data: { theme },
  })
  if (!res.ok()) throw new Error(`PUT /me/preferences failed with ${res.status()}: ${await res.text()}`)
}
