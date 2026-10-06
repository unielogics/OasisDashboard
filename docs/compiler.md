# dc compiler and DCHost shim

The three Claude Design prototypes (Operations, Payments, Settings) are `<x-dc>` templates plus a `class Component
extends DCLogic` script. `tools/dc-compile` turns each template into TSX at build time; `src/dc` runs the original
logic class unchanged behind a `DCHost` component. The result renders the same DOM as the original bundles (verified
in Chromium against `design/original/*.bundle.html`, see "Verification").

## Pipeline

```
design/extracted/<screen>/template.html ──┐
design-patches/{href-map,copy-map,<screen>.patch}.json ─┤  tools/dc-compile  ──►  src/generated/<screen>.tsx
design/extracted/<screen>/helmet.*.css, fonts/ ─────────┘                         <screen>.bindings.json
design/extracted/<screen>/logic.original.js ───────────────────────────────►      <screen>.logic.ts    (source as a JSON string)
                                                                                  <screen>.screen.css  (verbatim global CSS)
                                                                                  <screen>.styles.ts   (same CSS as a string module)
                                                                       shared ──► src/styles/fonts.css, public/fonts/*.woff2
```

All generated files are committed. `pnpm dc:check` recompiles in memory and fails (exit 1) if anything differs;
`pnpm check` and `pnpm build` run it.

## Usage

```bash
pnpm dc:compile                 # write src/generated, src/styles/fonts.css, public/fonts
pnpm dc:check                   # compare a fresh compile with the committed files
pnpm dc:compile:parity          # --variant=parity --emit-tpl-ids --out .generated-parity (gitignored)
pnpm exec tsx tools/dc-compile/index.ts --screen payments --out /tmp/x     # one screen, other directory
```

Flags: `--screen operations|payments|settings|all`, `--check`, `--variant=prod|parity`, `--emit-tpl-ids`,
`--out <dir>` (per-screen files only; fonts.css and public/fonts always go to their repo paths),
`--allow-complex-expr`. Exit codes: 0 ok, 1 `--check` mismatch, 2 grammar / unknown attribute / unsupported
construct, 3 patch guard failed.

Output is deterministic (no timestamps, sorted bindings, names assigned by first use): compiling twice gives
identical bytes. The header line of each generated file carries sha256 prefixes of the template and the patch files.

## Compilation rules

Parsing: the runtime's `encodeCase` pre-pass (`helmet` becomes `sc-helmet`, camelCase attributes become
`sc-camel-*`, table tags are wrapped), then `parse5.parseFragment` with the default `<template>` context. Every
element, including `sc-if`, `sc-for`, `sc-helmet` and the helmet's children, gets a pre-order `tplId`, the same
number the runtime's `stamp()` writes into `data-dc-tpl`. Comments are dropped.

Expressions follow the strict grammar `IDENT ('.' (IDENT | DIGITS))*`. Anything else (`===`, `!`, `[]`, literals,
parentheses, and the names `true false null undefined`, which the runtime treats as literals) fails with exit 2.
With `--allow-complex-expr` the compiler emits `R(scope, "src")`, a verbatim port of the runtime's `resolve()`.
A root identifier reads `$v.name`; inside `sc-for` the innermost loop whose `as` matches wins. Loop variables are
mangled to `$L<depth>_<as>` (index `$I<depth>`), so shadowed names resolve correctly and cannot collide with `$v`.
Dotted paths use optional chaining, `a.b.0` becomes `$L1_a?.b?.[0]`. A whole-attribute binding that also contains a
second `{{` is a build error (the runtime would misparse it).

| Source                           | Emitted                                                                                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| element                          | same tag, attributes in source order; void elements self-close; `sc-name`, `data-dc-tpl`, `hint-*` skipped                                                             |
| `sc-camel-*`                     | decoded with `kebabToCamel` (`view-box` becomes `viewBox`)                                                                                                             |
| `on*`                            | `EVENT_MAP[key]` or `on` + upper(key[2]) + key.slice(3); must be a whole binding                                                                                       |
| `class`, `for`                   | `className`, `htmlFor`                                                                                                                                                 |
| `stroke-width`, `inputmode`, ... | React names (table `ATTR_RENAME`; the DOM attribute is identical); other hyphenated names fail except `data-*`, `aria-*`                                               |
| `rows`, `cols`, `tabindex`, ...  | numeric literal (React types them as numbers; same DOM)                                                                                                                |
| static `style`                   | hoisted `const S<n> = Object.freeze({...}) as CSSProperties`, keys in source order, duplicates keep first position and last value, identical styles share one constant |
| `style="{{ x }}"`                | `css($v.x)` (`css(v)` = `cssToObj` for strings, objects pass through)                                                                                                  |
| mixed `style` / attribute        | `css(\`a:${m(x)}\`)` / `` {`..${m(x)}..`} `` with `m(x) = String(x ?? '')`                                                                                             |
| `value`, `checked` binding       | `x === undefined ? "" : x` / `false`; inputs/textareas without `onChange` also get `onChange={NOOP}` (silences React's dev warning, no DOM change)                     |
| other whole binding              | raw value (handlers, `ref`, `disabled`, `title`, `data-drop`, `data-theme`, ...)                                                                                       |
| static text                      | `{"..."}` JSON literal, never JSX text. Dropped only if it has no `{{` and is newline-only without a space                                                             |
| text with `{{ }}`                | `<>{"static"}{I(expr, "src", $h)}...</>`                                                                                                                               |
| `sc-if`                          | `{cond ? <>...</> : null}` (JS truthiness: `[]` and `'0'` are truthy)                                                                                                  |
| `sc-for`                         | `{asArray(list, "src", $h).map(($L1_x, $I1) => <Fragment key={$I1}>...</Fragment>)}`                                                                                   |
| `sc-helmet`                      | never emitted (see CSS below)                                                                                                                                          |

`I(v)` (src/dc/runtime.ts) is the runtime's text rule: `undefined` renders nothing (plus a once-only dev warning
`[oasis] <screen>: {{ x }} never resolved`), React elements and arrays go through a Fragment, `null` and booleans render
nothing, everything else including `''` and `0` becomes `<span class="sc-interp">`. The spans change flex/grid item
boundaries, so they stay.

Style objects returned from `renderVals` are never memoised or reused: the Operations drag and swipe code mutates
`el.style.transform` / `transition` imperatively, which only survives re-renders while the style prop keeps the same
keys and values.

## CSS and fonts

`<screen>.screen.css` is that screen's `helmet.global.css` verbatim. Payments and Settings have no `$preview` in their
`data-props`, so the original runtime appended `FULL_PAGE_CSS` (read from `design/extracted/runtime/dc-runtime.js`, not
re-typed) before it; those two files start with it. `ScreenStyle` injects the text into `<head>` in a layout effect as
`<style data-oasis-screen="<screen>">`, deduped by that attribute and reference-counted, and removes it when the last
instance unmounts. There is no Tailwind, no reset and no merged sheet: the three global sheets differ (Operations has
the `oa-*` keyframes and a `button` rule without `color:inherit`, Payments/Settings do the opposite).

`src/styles/fonts.css` is the 42 `@font-face` blocks with each `url("<uuid>")` rewritten to `/fonts/<file>.woff2` via
`design/extracted/fonts/manifest.json`; family names, `unicode-range`, `font-display` and `font-stretch` are untouched
(`next/font` would rename the families). It has no header comment on purpose: two adjacent CSS comments crash Next's
CSS minimizer (cssnano-simple) on this file. The three screens must produce identical rewritten font CSS or the
compile fails. `_document` preloads only the two latin files.

## Patch layer (`design-patches/`)

Applied to the parsed tree before emission, using source `tplId`s (assigned before any patch, so ids stay stable).

- `href-map.json` (`{"map": {...}}`): exact-match rewrite of `href` values, currently the four design file names to
  `/operations`, `/payments`, `/settings`, `/settings#emergency`. Any remaining href containing `.dc.html` fails the
  build (exit 3).
- `copy-map.json` (`{"entries": [{id, screen, scope: "template"|"logic", from, to, count}]}`): substring replacement
  on static text and static attribute values (static parts of interpolated strings included) for `template`, and on
  the logic source for `logic`. `count` is an exact-occurrence guard. The file is empty for now (pass-through); the
  SMS relabel table goes here.
- `<screen>.patch.json` (`{"ops": [...]}`), ops with guards, a mismatch fails the build (exit 3):
  `replace-text {tpl, expect, with}` (`with` may use `{{= path }}` raw interpolation: `{path}` without the span),
  `rewrite-href {tpl, expect, to}`, `set-attr {tpl, name, expect, value}`,
  `wrap-if {tpl, expectTag?, expectTextStarts?, cond}`, `remove {tpl, expectTag?, expectTextStarts?}`.
  All three files are empty. Each active patch needs a line in `design-patches/DEVIATIONS.md`.

## Parity variant

`--variant=parity` (or `--emit-tpl-ids` on any variant) emits `data-dc-tpl="N"` first on every emitted element, so
the harness can compare `#dc-root` outerHTML against the original without stripping the attribute. The parity build:

```bash
pnpm build:parity     # assert:react, dc:compile:parity -> .generated-parity, next build with NEXT_PUBLIC_PARITY=1, distDir .next-parity
pnpm start:parity     # next start -p 3100
```

`next.config.mjs` rewrites `@generated/*` imports to `.generated-parity` when `NEXT_PUBLIC_PARITY=1` (a webpack
`NormalModuleReplacementPlugin`; a resolve alias loses against the tsconfig `paths` entry). With
`NEXT_PUBLIC_PARITY=1` the bundle also exposes, for each mounted screen:

- `window.__oasisParity = { getVals(), ready, screen }`. `getVals()` returns `serializeVals({...userProps,
...logic.renderVals()})` (src/dc/serialize.ts): functions become `"[fn]"`, React elements
  `{ $el, key, props, children }`, `createRef()` objects `"[ref]"`, DOM nodes `"[node]"`, cycles `"[circular]"`; object
  key order is preserved. `serializeVals` has no imports so the harness can inject its source into the original
  page and serialise both sides identically.
- `data-oasis-ready="1"` on `#dc-root` after mount (the reliable signal; the harness must strip it when diffing).

The production build contains none of this (the `process.env.NEXT_PUBLIC_PARITY` literal is inlined and dead-code
eliminated).

## Runtime shim (`src/dc`)

- `DCLogic` (also exported as `StreamableLogic`): `setState` patches `this.state` synchronously and then asks the host
  for a React re-render (callback fires after commit); it is a complete no-op until `__host` is attached, exactly like
  the runtime. TypeScript subclasses must use `declare` when they redeclare `props`, `state` or `__host`.
- `DCHost` (class component): constructs the logic in its constructor (a throwing constructor falls back to the base
  class and shows an error card), forwards `componentDidMount/DidUpdate/WillUnmount` in try/catch, renders
  `{...userProps, ...renderVals()}` on every render into
  `<div id="dc-root"><div class="sc-host" data-sc-name="<name>">...</div></div>`. A throwing `renderVals` or template
  renders a plain alert card (not the prototype's red `.sc-logic-error` box) and logs.
- `loadLogic(source)` evaluates the original script like the runtime:
  `new Function('DCLogic','StreamableLogic','React', src + ';return Component')`. This needs `script-src
'unsafe-eval'` until the classes are ported to typed view-model modules; keep that in mind for the CSP.
- `createScreen({meta, render, logicSource, screenCss})` ties one screen together; `src/screens/<screen>/Screen.tsx`
  is three lines.

## Next shell

Pages Router (`src/pages`): `_app` imports only `fonts.css`; `_document` sets `lang="en"` and preloads the two latin
fonts; `index` redirects to `/operations`; `operations|payments|settings` load their screen with `dynamic(...,
{ssr:false})` (the designs read `localStorage` and the clock while initialising state). Navigation stays plain `<a>`
full page loads. `reactStrictMode: false`. No login, API or auth in this stage; screens run on their in-class fixtures.

`next` 15.5.27 with `react`/`react-dom` pinned to exactly 18.3.1 (pnpm `overrides`). `scripts/assert-react.mjs`
(run by `check` and `build`, and with `--dist` after the builds) fails on more than one react/react-dom copy, any
version other than 18.3.1 or a pre-release, and a React canary marker in `.next*/static`.

## Verification

- `pnpm check`: assert-react, design:verify, dc:check, eslint, tsc (includes `src/generated`), vitest.
- Tests: golden tests per rule (`tools/dc-compile/tests/golden.test.ts`); `screens.test.ts` compiles all three screens
  (prod and parity), checks determinism, committed output, tpl-id numbering against an independent tag count, CSS and
  fonts, typechecks the output with the TS API, renders every screen with generated vals (strings for scalars,
  2-element arrays for lists, `true`/`false` for conditions, empty lists) and compares the markup with a reference
  interpreter that is a transliteration of the original runtime's `walk*` builders running on the original
  `resolve()`/`cssToObj()` (extracted from `dc-runtime.js` at test time). `src/dc/*.test.*` cover the runtime helpers
  (including `resolve` parity), `DCLogic`, `DCHost` under jsdom, the parity hook and a bindings contract against
  the original logic classes.
- Browser: with `pnpm start:parity` running, an offline Playwright run (1480x1000, clock pinned and paused,
  fonts ready) loads the original bundle and the port; `#dc-root` outerHTML was identical for all three screens
  (after stripping `data-sc-name`, `data-oasis-ready` and mapping hrefs), and screenshots were byte-identical PNGs.
  A scripted interaction run (theme toggle, tabs, search, modal, sheets, settings sections) stayed identical step by step.
