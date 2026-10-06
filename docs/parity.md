# Parity harness

The three Claude Design prototypes are the source of truth. The harness renders the **original** bundle (`design/original/*.bundle.html`, offline) and the **port** (the Next production build) side by side in the same pinned Chromium, performs the same scenario actions on both, and fails on any difference that is not explicitly listed in `parity/allowlist.json`.

- Code: `tools/parity/**` (TypeScript, run with `tsx`).
- Data: `parity/` (`fonts/`, `fontconfig/`, `allowlist.json`, `tolerances.json`, `console-baseline.json`).
- Output: `parity-reports/` (gitignored).

## Running it

```bash
export PATH=$HOME/.local/bin:$PATH NODE_OPTIONS=--max-old-space-size=2048   # pnpm + a 2 GB heap on the shared box
# Chromium is already installed in ~/.cache/ms-playwright; the harness sets PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-arm64 itself.

pnpm parity:selftest              # harness self-tests: determinism + sensitivity gates (about 8 minutes; --quick for a 1 minute subset)
pnpm parity --list                # the scenario catalogue
pnpm parity --screen settings --scenario sections --theme dark
pnpm parity --tag smoke           # one pass over the @smoke scenarios
pnpm parity:all                   # every scenario, both themes
pnpm parity --scenario initial --against-original      # dry run: a second copy of the ORIGINAL stands in for the port
pnpm parity --update-console-baseline                  # record the original's console warnings (see "Console baseline")
pnpm parity:fonts                 # re-vendor the fallback fonts from /usr/share/fonts (normally never needed)
```

`pnpm parity ...` needs the port running (see the contract below); default `--port-url http://127.0.0.1:3100`. Exit code 0 only when every step of every run is clean and the allow-list has no stale or over-broad entry. Run one heavy process at a time (a Next build, vitest and the parity run each use a core and ~1 GB).

`pnpm check` runs the fast unit tests of the diff utilities, normalisers, allow-list engine, serve-original and the scenario catalogue (`tools/parity/**/*.test.ts`). It never launches a browser. The browser-based self-tests are `pnpm parity:selftest`.

## The port contract (what the port must satisfy)

The harness consumes this; the port build implements it.

1. **Build and URL.** `NEXT_PUBLIC_PARITY=1 next build && next start -p 3100 -H 127.0.0.1`. Full page loads (no client-side navigation) of `/operations`, `/payments`, `/settings` (and `/settings#emergency`). A production build without the flag contains none of the parity hooks.
2. **Mount point.** `<div id="dc-root"><div class="sc-host" data-sc-name="..."> ...template DOM... </div></div>`, with the same element structure as the original runtime produces, including `span.sc-interp` wrappers and whitespace text nodes. `data-sc-name` may differ (the original derives it from the file name); the DOM check strips it.
3. **Ready flag.** After the screen has mounted and rendered, `#dc-root` has the attribute `data-oasis-ready="1"`. The harness waits for it, then for `document.fonts.ready`, then for three event-loop turns.
4. **`window.__oasisParity.getVals()`** returns the JSON-safe `renderVals()` result of the screen's logic instance. It MUST return exactly `serializeVals(renderVals())`, where `serializeVals` is the function in `tools/parity/vals-serialize.ts` (dependency-free; import it from the parity build or copy it verbatim). Format: functions become `"[fn]"`, `undefined` becomes `"[undefined]"`, React elements become `{"$el": "<tag>"|"[fragment]"|"[component]", "key": ..., "props": ...}`, DOM nodes `"[node]"`, cycles `"[circular]"`, Dates/Maps/Sets as documented in the file header. Object key order is preserved and compared.
5. **`data-dc-tpl`.** The parity build also emits `data-dc-tpl="N"` on every element, numbered like the original runtime (pre-order over every element of the template, including `sc-if`, `sc-for` and `sc-helmet` and the helmet's children). When both sides carry it, the harness compares it (structure, order and numbering) and uses it to pair elements for the computed-style and rect checks; when one side lacks it, it is stripped everywhere and pairing falls back to DOM paths.
6. **Theme.** The theme is `localStorage["oasis-theme"]` (`light` or `dark`), seeded by the harness before any page script runs (only when nothing is stored yet). `data-theme` stays on the wrapper div inside `#dc-root` (it is part of the DOM check); mirroring it on `<html>` is allowed because only `#dc-root` is compared as HTML.
7. **CSS.** Per-screen global CSS, exactly the three helmet blocks (no Tailwind, no reset, no merged sheet). `html` and `body` are included in the computed-style check (curated properties), so their CSS must match too.
8. **No timers needed to become ready or to react to clicks.** The harness freezes the clock (see below). The port must mount and re-render from events (clicks, input) without waiting on `setTimeout`, `setInterval` or `requestAnimationFrame` (batching store notifications through rAF would hang a frozen clock; the parity build must disable it). React 18's scheduler uses `MessageChannel`, which is not faked and is fine. Timer driven behaviour (the 1 s tick, 380 ms long-press, toast expiry) is exercised by scenarios that advance the clock with `runFor`.
9. **No network.** Everything except `http://127.0.0.1:3100` (and `data:`/`blob:`/`about:`) is aborted. A blocked request is reported as a console difference.
10. **Fixture data.** The parity build renders the fixture state the original starts from (frozen 2026-06-13 10:36 America/New_York); deliberate differences are allow-listed.

## Environment and determinism

| Source            | How it is pinned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chromium flags    | `--disable-dev-shm-usage --force-color-profile=srgb --font-render-hinting=none --disable-lcd-text --disable-partial-raster` (+ `--no-sandbox` if `PARITY_NO_SANDBOX=1`), deviceScaleFactor 1. `--disable-partial-raster` is load-bearing, see below. `PARITY_EXTRA_FLAGS` appends flags for experiments only                                                                                                                                                                                                                                                                                                                                                 |
| Fonts             | The designs bundle only Manrope and Bricolage Grotesque (Latin subsets). Glyphs such as `⚠ ★ ← ↑ → ↓ ↩ ± ◆ ✓ ✕ − ∞` fall back to system fonts, so `parity/fonts/` vendors DejaVu Sans (Regular, Bold), Noto Sans (Regular, Bold), Noto Sans Symbols (Regular, Bold), Noto Sans Symbols 2 and Noto Emoji (monochrome), with checksums in `parity/fonts/MANIFEST.json`. Chromium is launched with `FONTCONFIG_FILE=parity/fontconfig/fonts.conf`, which includes nothing from `/etc/fonts`, so the host's fonts are invisible. `parity-reports/.fontcache` holds fontconfig's cache. `pnpm parity:fonts` re-vendors; `parity/fonts` is verified by a unit test |
| Timezone / locale | `timezoneId: America/New_York`, `locale: en-US`, `TZ=America/New_York` for the browser process                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Clock             | `context.clock.install({time: FIXED_NOW - 1 s})` then `pauseAt(FIXED_NOW)` before the first navigation, with `FIXED_NOW = 2026-06-13T10:36:00-04:00` (the explicit offset is required; a bare local timestamp would be read as UTC and give 06:36). Time only moves through `Actions.runFor(ms)` (`clock.runFor`). `PARITY_FIXED_NOW`, `PARITY_TZ`, `PARITY_LOCALE` override for experiments                                                                                                                                                                                                                                                                 |
| Viewport          | 1480x1000 for every screen (the cc `$preview` size); other sizes are informational only and not wired up                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Storage           | a fresh browser context per run and side; `oasis-theme` seeded before load                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Network           | `context.route('**/*')` aborts everything except the two local origins; service workers blocked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Animations        | an injected `*{animation:none!important;transition:none!important;caret-color:transparent!important}` rule (kept alive across the bundler's document swap) plus `page.screenshot({animations:'disabled', caret:'hide'})`                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Branding badge    | `#__claude_design_branding` is hidden with CSS on the original (it lives in `<body>` outside `#dc-root`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Hover state       | the mouse is parked at (0,0) before every snapshot                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Settling          | after every action and before every snapshot: three `MessageChannel` round trips (not controlled by the fake clock), `document.fonts.ready` repeated until no face is loading                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Randomness        | none in the designs (`rng` is seeded mulberry32)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**Why `--disable-partial-raster`.** Without it, the first full self-test run found 5 of 128 steps (modal tab changes, the Payments KPI row in dark mode) that differed by 10 to 90 pixels between two identical loads, always at rounded-corner antialiasing. After a re-render Chromium re-rasterises only the invalidated rectangle, and the corner pixels at the rectangle's edge depend on which intermediate frames the compositor produced, which depends on machine load (this box is shared). Measured on the Payments dark "Today" step, 40 fresh loads each: default flags 2 distinct screenshots both on the shared box as it was (8/4 of 12 loads) and under 2 CPU burners (38/2 of 40), `--disable-partial-raster` 1 distinct screenshot (40/40) including under 2 CPU burners, `--disable-gpu` 1 distinct screenshot (40/40, but a different image than full raster, so the two are not interchangeable). Both sides always use the same flags, so the choice only has to be deterministic.

Headless Chromium on this box is software-rendered; the original-versus-original gate (below) is what proves that rendering is stable. If a nondeterministic region ever appears (for example `backdrop-filter` blur), the order of preference is: remove the cause; a `region-mask` allow-list entry; a scoped `parity/tolerances.json` entry with a written reason (last resort, never silent).

### The original's logic instance

The dc runtime does not expose the live logic instance (`window.__dcRegistry` holds the class and the subscriber set only). `OriginalDriver` finds it through React: the `.sc-host` div is rendered by the `StreamableComponent`, whose fiber's `stateNode.logic` is the instance, and calls `renderVals()` again (the runtime does that on every render, including every second in Operations). The result goes through `serializeVals`.

## The five checks

Each step of a scenario snapshots both sides and runs, in this order of reporting:

| Check     | What is compared                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Tolerance                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `dom`     | `#dc-root` `outerHTML`, re-parsed with parse5 and normalised: `data-sc-name` and the port's `data-oasis-ready` flag dropped, `data-dc-tpl` kept only when both sides have it, attributes sorted by name (their values, notably the whole `style` string, are compared byte for byte). Children are aligned by tag and tpl id (LCS), so a missing or extra element is reported once, a pure permutation is reported as one `reorder`, and everything else is compared pairwise                                                                                                                       | exact                                                                                  |
| `style`   | For every element, paired by `data-dc-tpl` id plus occurrence index (sc-for iterations), else by DOM path under the paired parent: `getBoundingClientRect` (x, y, width, height), scrollWidth/Height, clientWidth/Height, scrollLeft/Top, form control value/checked, `::before`/`::after` (when they generate content) and `::placeholder` style, and about 90 curated layout and paint properties (`tools/parity/collect.ts` `CURATED_PROPS`). The `initial` step of the `initial` scenario compares the full computed style set (about 490 properties). `html` and `body` are included (curated) | exact (0 px)                                                                           |
| `pixels`  | Full-viewport screenshots decoded with pngjs, `pixelmatch` threshold 0 with antialiasing NOT forgiven. A size mismatch fails                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 0 differing pixels, unless a `tolerances.json` entry or a `region-mask` says otherwise |
| `vals`    | Ordered JSON diff of `serializeVals(renderVals())`. Object key order is compared (style objects)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | exact, minus allow-list                                                                |
| `console` | Warnings, errors, uncaught page errors, dialogs, and requests the network block aborted, compared as multisets after normalisation (ports, blob and uuid ids removed; both wordings of an unresolved binding reduce to `unresolved binding {{ expr }}`)                                                                                                                                                                                                                                                                                                                                             | exact                                                                                  |

### Console baseline

`parity/console-baseline.json` lists, per screen, the normalised messages the **original** is known to emit (currently none: the originals are silent). An original message outside the baseline is reported as `baseline-drift` even when the port matches, so a browser or runtime change cannot be absorbed silently. `pnpm parity --update-console-baseline` rewrites it from a run of the originals; review the diff before committing.

### Artifacts and machine-readable results

```
parity-reports/
  summary.json                        run-level result: every run, failed steps, allow-list problems
  <screen>/<scenario>/<theme>/
    result.json                       the whole run (UnitResult)
    <step>/                           "initial" is always the first step
      step.json                       StepResult: per check {ok, rawDiffs, diffs, allowed, sample[], artifacts[]}
      orig.png port.png diff.png      always written
      dom.diff.json dom.orig.txt dom.port.txt     when the DOM differs (normalised trees, one node per line)
      style.diff.json                 when computed style or rects differ
      vals.diff.json                  when renderVals differs; vals.orig.json / vals.port.json also on every "initial" step
      pixels.diff.json                mismatch count and clustered bounding boxes
      console.json                    when either side logged anything
```

A `Diff` is `{check, kind, loc, name?, orig?, port?, tpl?, allowedBy?}`:

| check     | kinds                                                         | `loc`                                                                                                               |
| --------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `dom`     | `text`, `attr`, `element-added`, `element-removed`, `reorder` | DOM path, e.g. `div[0]#5/header[0]#6/div[1]#7/#text[0]` (tag, child index, `#<tpl id>` when present)                |
| `style`   | `rect`, `style`, `value`, `element-added`, `element-removed`  | element key: `t<tpl>#<occurrence>` or `<parent key>><tag>[<index>]`; `name` is `rect`, `scroll` or the CSS property |
| `vals`    | `value`, `reorder`                                            | JSON path, e.g. `kpis[1].sub`; values are JSON text (strings quoted)                                                |
| `console` | `console`                                                     | the normalised message                                                                                              |

## Deviations: `parity/allowlist.json`

The run fails on every difference that no entry excuses, and on every entry that is stale or over-broad. Format:

```json
{
  "version": 1,
  "entries": [
    {
      "id": "D1-pay-receipt-sms",
      "screen": "payments",
      "kind": "text",
      "reason": "D1: WhatsApp wording becomes SMS (string table, not find/replace)",
      "swap": {
        "find": "Receipt goes out by WhatsApp and email.",
        "replace": "Receipt goes out by SMS and email.",
        "count": 1
      }
    },
    {
      "id": "D2-kpi-booked-sub",
      "screen": "operations",
      "kind": "text",
      "reason": "D2: '12 booked' was hard-coded; the port counts upcoming booked and confirmed appointments",
      "scope": { "scenarios": ["*"], "steps": ["*"], "themes": ["light", "dark"], "checks": ["dom", "vals"] },
      "matcher": { "loc": "kpis[0].sub", "orig": "^12 booked$" },
      "expect": { "min": 0 }
    }
  ]
}
```

Fields: `id` (unique, `[A-Za-z0-9._-]+`), `screen` (`operations|payments|settings|*`), `kind`, `reason` (a real sentence), optional `scope`, then either `swap` (text/attr only) or `matcher`, and optional `expect`.

### Kinds

| kind            | Meaning                                                               | Covers (checks / diff kinds)                                                                                                                |
| --------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`          | different text or value                                               | dom, vals / `text`, `value`. With `swap`: applied to the original before it renders                                                         |
| `attr`          | different attribute value (hrefs, titles)                             | dom, vals / `attr`, `value`. With `swap`: before render                                                                                     |
| `reorder`       | same elements or rows in a different order                            | dom, vals, style / `reorder`, `rect`, `style`, `value`                                                                                      |
| `element-added` | an element only one side has, and the layout shift it causes          | dom, vals, style / `element-added`, `element-removed`, `rect`, `style`, `text`, `attr`, `value`                                             |
| `region-mask`   | a region excluded from the pixel diff (and its rects)                 | pixels, style / `rect`, `style`. Needs `matcher.rect` (viewport px) or `matcher.tpl` (union of that element's rects on both sides)          |
| `wiring`        | wiring-only additions with no visual change (hidden inputs, handlers) | dom, vals, console / `attr`, `element-added`, `value`, `console`. Pixels are never covered, so a "wiring" entry cannot hide a visual change |

A kind can never excuse a check or diff kind outside its row. `scope.checks` may narrow, never widen.

### Matcher

All given fields must match: `loc` (glob or list of globs; `*` stays inside one `.` or `/` segment, `**` crosses; a bare `*`/`**` is rejected as over-broad), `name` (glob on the attribute or CSS property), `orig` / `port` (regular expressions; for `vals` they see both the JSON text and the plain string), `tpl` (exact `data-dc-tpl` id). A matcher with none of these is rejected.

### Scope and expect

`scope.scenarios` / `scope.steps` are globs (`*`), `scope.themes` a list, `scope.checks` a subset of the kind's checks. An entry applies to a (run, step) only inside its scope and screen.

- **Stale**: an entry that applies to at least one executed step but matched nothing across the whole run fails the run; so does an entry that matched fewer than `expect.min` (default 1) at any step it applies to. Set `expect.min: 0` for a wildcard-scoped entry that legitimately only shows on some steps.
- **Over-broad**: matching more than `expect.max` at a step fails; a pre-render `swap` that finds a different number of occurrences than `swap.count` aborts the run before any browser starts (0 found = stale, more = over-broad).

### Pre-render swaps (text and attr)

`serve-original` decodes the bundle's template string (the `<x-dc>` markup and the logic script) and rewrites it before serving, so pixels stay at threshold 0 even when word widths change. `find` and `replace` are raw source substrings (HTML entities exactly as written in the template, for example `Holidays &amp; closures`). `attr` swaps only touch the quoted value of the named attribute. `swap.target` limits to the `template` or the `logic` region (default both). Swaps apply in order. Other kinds cannot be applied before render and fail with a clear error; use a diff-side `matcher`.

### Pixel tolerances (last resort)

`parity/tolerances.json`: `{"pixels": [{"id", "screen", "scenario?", "theme?", "step?", "maxMismatched", "reason"}]}`; every entry needs a scope and a reason of 20+ characters. The default is none. The report says when a tolerance was used.

## Scenarios

A scenario is a TypeScript object in `tools/parity/scenarios/<screen>.ts`; the same step functions run against both pages.

```ts
{
  id: 'filters',                      // kebab-case, unique per screen
  screen: 'payments',
  title: 'the five filter chips',
  hash: 'emergency',                  // optional URL hash
  themes: ['light'],                  // optional, default both
  touch: true,                        // optional hasTouch emulation
  tags: ['smoke'],
  steps: [clickBtn('filter-open-balance', 'Open balance'), { id: 'search', run: async (a) => a.fill(a.css('input'), 'Tesla') }],
}
```

The runner always snapshots an `initial` step first. Each step is `{id, title?, run?, full?}`; `full: true` compares the full computed style set at that step. `run(a: Actions)` may use `a.btn(textOrRegex)` (a `button` whose text starts with it; pass `exact('Refund')` when another button merely starts with the same word), `a.css(selector)`, `a.text(text)`, `a.click/fill/press`, `a.runFor(ms)` (advance the paused clock), `a.pointerSequence([...])` (synthetic `PointerEvent`s for touch gestures; the long-press, swipe and drag scenarios use it with `touch: true`), and `a.page` for anything else. Locators are scoped to `#dc-root` and must resolve to exactly one element, on both sides. After adding a scenario: `pnpm parity --scenario <id> --against-original` must be green (it proves the selectors work and the scenario is deterministic) and `pnpm parity:selftest` re-proves the gate.

Catalogue today (16 scenarios x 2 themes = 32 runs, 128 steps): `initial` and `theme-toggle` on every screen; Settings `sections` (all 8 via the rail) and `emergency-deeplink`; Payments `ranges` (4), `filters` (5), `select-invoice`, `refund-sheet`; Operations `view-tabs` (4), `range-tabs` (4), `appointment-file` (open the first card and each of its 8 tabs), `new-appointment` (+ Walk-in). The full ~55 scenario catalogue of `docs/reference/design/dashboard.md` section 5.5 is a later extension; the framework needs only new modules registered in `scenarios/index.ts`.

## Self-tests (`pnpm parity:selftest`)

1. **Determinism gate**: ORIGINAL vs ORIGINAL, two fresh loads per run, every scenario, both themes: zero difference on all five checks; scenarios whose actions change nothing are flagged.
2. **Sensitivity gate**: a copy of each original served as the "port" with (a) one inline `padding` 1 px larger, (b) one static label changed, (c) one `renderVals` label changed. The harness must fail, and must fail the right checks (a: dom, style, pixels; b: dom, pixels; c: vals, dom, pixels), while checks that cannot see the change must stay green.
3. **Swap gate**: a text swap on the baseline plus the same edit in the port gives zero diff; the same port edit without the swap fails.
4. **Stale gate**: an allow-list entry that matches nothing fails the run; a swap that matches nothing aborts it.
5. **Port driver gate**: `PortDriver` against `tools/parity/mock-port.ts`, a stand-in port that serves the original bundles at `/operations`, `/payments`, `/settings` and adds `#dc-root[data-oasis-ready="1"]` and `window.__oasisParity.getVals()` (implemented with the same `serializeVals`). `initial`, `theme-toggle` and `emergency-deeplink` must be zero diff through it, and a 1 px change behind that URL must fail dom, style and pixels. This proves the port-side plumbing (URL paths, hash, ready flag, hook) before the real build exists.

`--quick` runs gate 1 on the `initial` scenarios and gate 2 on Settings only.

## Verified and unverified

Verified on this box (Amazon Linux 2023 aarch64, Playwright 1.63, Chromium headless shell 1243): `clock.install` then `pauseAt` before navigation boots every page at exactly 14:36:00Z; `locator.click` and `page.screenshot` work under a paused clock; zero-diff determinism of the originals across all runs; the dc runtime does not expose the logic instance (found via the React fiber); fontconfig honours `<dir prefix="relative">` and shows only the vendored fonts.

Not exercised yet (no port exists in this worktree): `PortDriver` against a real Next build (it is exercised against the mock port only), `data-dc-tpl` parity between a real compiled port and the runtime, touch gestures (`pointerSequence` is implemented and unit-compiled but no scenario drives it yet), CDP `Input.dispatchTouchEvent`, the 1280x800 and 1920x1080 informational viewports, `backdrop-filter` stability during long modal sequences (the Operations modal and slide-over passed the determinism gate).
