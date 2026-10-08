# Live parity: the live screens against the original designs

`pnpm parity` proves that the **fixture build** renders exactly like the original bundles (docs/parity.md). This is the
second half of the proof: the **live build**, fed by the real API and a real Postgres, renders the same on equivalent
data. The original bundle stays the oracle on its own fixture state; the live side is the dashboard built with
`pnpm build:live` (the build people use), served against a stack from `pnpm live:up` that is seeded with the design's
data and frozen at the design's instant.

Covered: **Operations**, **Payments** and **Settings**, every scenario of the catalogue in both themes: 19 scenarios x 2
themes = 38 runs, 152 steps (Operations 9 scenarios, 78 steps; Payments 6, 48; Settings 4, 26). Each screen runs against **its own stack**, seeded with exactly the profiles the registry
declares (`tools/parity/live-registry.ts`), because one screen's seed changes what another shows (parity-ops puts twelve
invoices on the design day, which the Payments design does not have):

| screen     | stack   | API / web   | seed profiles (exactly) | what the seed mirrors                                                                                           |
| ---------- | ------- | ----------- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| operations | `lpops` | 4064 / 3264 | `design,parity-ops`     | the Command Center day: a1-a12 with invoices, members, checklists, texts, and the generated calendar days       |
| payments   | `lppay` | 4065 / 3265 | `design,parity-pay`     | the 105-invoice set of the Payments design                                                                      |
| settings   | `lpset` | 4066 / 3266 | `design,parity-ops`     | the design seed (hours, closures, staff, roles, VIP, packages); the emergency preview lists the day's customers |

## Running it

```bash
export PATH=$HOME/.local/bin:$PATH NODE_OPTIONS=--max-old-space-size=2048
F=2026-06-13T10:36:00-04:00 BE=~/oasis/wt/w5c-be

# 1. three frozen stacks with the design's data (each migrates and seeds its own schema and builds its own dashboard)
pnpm live:up --name lpops --api-port 4064 --web-port 3264 --profile design,parity-ops --freeze $F --backend $BE
pnpm live:up --name lppay --api-port 4065 --web-port 3265 --profile design,parity-pay --freeze $F --backend $BE
pnpm live:up --name lpset --api-port 4066 --web-port 3266 --profile design,parity-ops --freeze $F --backend $BE

# 2. the proof
pnpm parity:live:all                                   # every screen on its own stack, every scenario, both themes
pnpm parity:live --screen operations --scenario appointment-file --theme dark
pnpm parity:live --list                                # scenarios, the stack of each screen
pnpm parity:live:selftest                              # sensitivity, on the same three stacks

# 3. clean up
for s in lpops lppay lpset; do pnpm live:down --name $s --drop; done
```

`pnpm parity:live:all` checks every stack before the first browser starts and stops with every problem named: a missing
stack, a stack not frozen at the design's instant, a stack seeded with other profiles (more or fewer), or a dashboard
built for another API than the stack's (each stack records the API its build was made for). The message prints the
`live:up` command that fixes it. `live-stack` builds each stack into `.next-live/stacks/<name>` (`LIVE_DIST_DIR`), so the
three stacks of one worktree run side by side, and `--skip-build` reuses a build only for the same API origin.

Options of `pnpm parity:live`: `--screen`, `--scenario`, `--theme`, `--stack <name>` (with `--screen` only: another stack
for that screen, still checked as above), `--user <email>` (default `rafael@oasisautospa.com`, whose chip reads "Rafael
M." like the design), `--out <dir>` (default `parity-reports/live`), `--all`. Exit code 0 only when every step is clean
or only allow-listed, no allow-list entry is stale or over-broad (stale entries are judged once over all the runs of an
`--all` invocation) and no run errored. Everything is written to `parity-reports/live/<screen>/<scenario>/<theme>/<step>/`
exactly like the fixture harness (screenshots of both sides, diff images, `step.json`, `dom|style|vals.diff.json`), plus
`parity-reports/live/matrix.json` and `summary.json`.

The same heavy-command rules as the fixture harness apply: one Chromium at a time on the shared box (use the lock).

### Scenarios that write

Three Operations scenarios change server data when they run live: the touch long-press drag and the mouse drag onto the
open bay (`POST /assign-bay`) and the swipe (`POST /advance`). They are marked `writes: true` in the catalogue. The live
run saves the stack's schema before each run of such a scenario (`pg_dump` of the stack's own schema) and restores it
afterwards (drop and `pg_restore`, also when the run throws), so every run starts from the seeded design state
(`tools/parity/live-db.ts`). The database URL comes from the stack's backend checkout and is never printed.

## How the live mode differs from the fixture mode

It reuses the five checks, the scenario catalogue, the allow-list engine and the artifact layout unchanged
(`tools/parity/harness.ts` has a `{kind: 'live'}` port; `drivers.ts`, `browser.ts` and `collect.ts` have opt-in hooks,
the fixture path is the old behaviour: `pnpm parity:all` is still 38 runs, 152 steps, zero diff). What is live-only is
in `tools/parity/live.ts` (`LiveDriver`):

| Concern         | Fixture mode                                                  | Live mode                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network         | everything but the port origin is aborted                     | the dashboard origin (it proxies `/api`) and the API origin are allowed, everything else is aborted and reported                                                                                                                                                                                                                                                                                                                                                      |
| Session         | none                                                          | sign-in through the real `/login` page in a throwaway context (its event stream is blocked so it leaves nothing open), then only the cookies move to the run's context: a cookie jar per run. The theme is stored as the person's server preference first, because the live variant takes the theme from the server and `localStorage` is only its cache                                                                                                              |
| Clock           | `clock.install` + `pauseAt`, time only moves through `runFor` | `Date` is pinned to the stack's frozen instant (so `serverNow()` equals the server's frozen clock and "Today 10:36 AM" is stable) but short timers run, because react-query batching, `requestAnimationFrame` and the event stream's back-off need them. Page timers of 3 s or more (a toast lives 3.2 s) are **held** and fire only when a scenario calls `runFor`, which also moves the pinned `Date` on by the same span, exactly like the originals' paused clock |
| Ready           | `#dc-root[data-oasis-ready=1]` set by the parity build        | no hook exists in the live build: the harness waits for `#dc-root .sc-host`, for the event stream (`/api/v1/events`) to answer 200, then for **quiet**: no `/api/v1` request in flight, no loading text, and `#dc-root` unchanged for 900 ms of real time (longer than the screens' 250 ms debounce timers, so a request that is about to start is not missed)                                                                                                        |
| `renderVals`    | `window.__oasisParity.getVals()`                              | the logic instance is found through the React fiber behind `.sc-host` (as for the originals) and `serializeVals(renderVals())` is compared, including the live-only `live` root                                                                                                                                                                                                                                                                                       |
| Element pairing | by `data-dc-tpl` id                                           | by DOM position on both sides (the live build carries no `data-dc-tpl`; the originals' ids are ignored for pairing in this mode)                                                                                                                                                                                                                                                                                                                                      |
| Float noise     | exact                                                         | a computed decimal with at least nine fractional digits that differs from its twin only in the last digits (relative 1e-12, same unit) is not a difference; the API gives integer cents and the live class divides, the design accumulated floats. Counted and shown in the step's `vals` note. Short or typed values are always exact                                                                                                                                |
| Allow-list      | `parity/allowlist.json`                                       | `parity/allowlist.json` (the D4 link swaps) plus `parity/allowlist.live.json`; ids `L-<screen>-<nn>`                                                                                                                                                                                                                                                                                                                                                                  |

### How a difference is allow-listed

A live difference is listed in `parity/allowlist.live.json` with **a DV id and a one-line reason** (a unit test,
`tools/parity/live-allowlist.test.ts`, fails when an entry names no DV line that `design-patches/DEVIATIONS.md` lists).
Two techniques, narrowest first:

1. **A pre-render swap of the oracle** (kinds `text` and `attr` with `swap`): the original's logic or template is edited
   before it renders so that it does what the live screen deliberately does (cent tax, the server's counts, SMS wording,
   the seeded phone numbers, ...). The five checks, pixels at threshold 0 included, then compare the two sides on the
   same content, so a swap hides nothing but the stated difference. Each swap declares how many replacements it makes
   and the run aborts before launching a browser when the original no longer contains exactly that many. The test above
   also compiles every swapped logic.
2. **A diff-side entry** with the narrowest locator, name and value regexes (`element-added`, `wiring`, `reorder`,
   `computed-style`, `text`), and a `region-mask` for pixels, always scoped to the scenarios and steps where the
   difference shows.

Nothing is covered by a tolerance (`parity/tolerances.json` is untouched and empty).

## Result

`pnpm parity:live:all` on the three stacks (frozen 2026-06-13 10:36 America/New_York, signed in as Rafael M.), on
dashboard `ws/w5c-dash` and backend `ws/w5c-be` (the commits are in the final report of this work):

| screen / scenario                  | steps | light             | dark              |
| ---------------------------------- | ----- | ----------------- | ----------------- |
| operations / initial               | 1     | allow-listed 233  | allow-listed 266  |
| operations / view-tabs             | 5     | allow-listed 910  | allow-listed 947  |
| operations / range-tabs            | 5     | allow-listed 1010 | allow-listed 1047 |
| operations / appointment-file      | 10    | allow-listed 2712 | allow-listed 2754 |
| operations / new-appointment       | 4     | allow-listed 940  | allow-listed 976  |
| operations / theme-toggle          | 2     | allow-listed 406  | allow-listed 438  |
| operations / touch-long-press-drag | 5     | allow-listed 921  | allow-listed 958  |
| operations / touch-swipe-advance   | 3     | allow-listed 577  | allow-listed 612  |
| operations / mouse-drag-to-bay     | 4     | allow-listed 749  | allow-listed 785  |
| payments / initial                 | 1     | allow-listed 43   | allow-listed 84   |
| payments / ranges                  | 5     | allow-listed 199  | allow-listed 244  |
| payments / filters                 | 6     | allow-listed 238  | allow-listed 284  |
| payments / select-invoice          | 3     | allow-listed 121  | allow-listed 164  |
| payments / refund-sheet            | 7     | allow-listed 297  | allow-listed 344  |
| payments / theme-toggle            | 2     | allow-listed 83   | allow-listed 123  |
| settings / initial                 | 1     | allow-listed 150  | allow-listed 183  |
| settings / sections                | 9     | allow-listed 806  | allow-listed 847  |
| settings / theme-toggle            | 2     | allow-listed 240  | allow-listed 272  |
| settings / emergency-deeplink      | 1     | allow-listed 142  | allow-listed 175  |

38 runs, 152 steps: 0 zero, 152 allow-listed (22280 differences), 0 unresolved steps (0 differences); 0 allow-list
problems (no entry stale or over-broad). The dark column is the dark theme of each screen against the original in dark.

"allow-listed N" counts the listed differences in the cell (a masked pixel region counts once). Every step of every run
has the header difference of the live chrome (the signed-in user chip; DV-101 to DV-104), and every Operations step the
renderVals keys the live class adds or fills lazily (ids, the calendar and slot lists built only while open), so no step
is literally "zero"; steps whose only allow-listed differences are those have nothing else to show. Everything else is
identical to the pixel or covered by an entry below.

### Allow-list usage in that run

| id              | screen     | kind           | DV                                             | use                                  |
| --------------- | ---------- | -------------- | ---------------------------------------------- | ------------------------------------ |
| L-payments-01   | payments   | text           | DV-501                                         | swap, 1 replacement(s) in payments   |
| L-payments-02   | payments   | text           | DV-502                                         | swap, 1 replacement(s) in payments   |
| L-payments-03   | payments   | text           | DV-210                                         | swap, 1 replacement(s) in payments   |
| L-payments-04   | payments   | text           | DV-220                                         | swap, 1 replacement(s) in payments   |
| L-payments-05   | payments   | element-added  | DV-103, DV-104                                 | 192 differences over 48 steps        |
| L-payments-06   | payments   | element-added  | DV-103, DV-104                                 | 1056 differences over 48 steps       |
| L-payments-07   | payments   | region-mask    | DV-103, DV-104                                 | 48 differences over 48 steps         |
| L-payments-08   | payments   | element-added  | DV-104                                         | 240 differences over 48 steps        |
| L-payments-09   | payments   | wiring         | DV-106                                         | 48 differences over 48 steps         |
| L-payments-10   | payments   | wiring         | DV-201, DV-214                                 | 336 differences over 48 steps        |
| L-payments-11   | payments   | text           | DV-210                                         | swap, 1 replacement(s) in payments   |
| L-payments-12   | payments   | text           | DV-210                                         | swap, 1 replacement(s) in payments   |
| L-payments-13   | payments   | text           | DV-210                                         | swap, 1 replacement(s) in payments   |
| L-payments-14   | payments   | text           | DV-504                                         | swap, 6 replacement(s) in payments   |
| L-payments-15   | payments   | text           | DV-216                                         | swap, 1 replacement(s) in payments   |
| L-payments-16   | payments   | wiring         | DV-215                                         | 40 differences over 48 steps         |
| L-settings-01   | settings   | text           | DV-101                                         | swap, 1 replacement(s) in settings   |
| L-settings-02   | settings   | element-added  | DV-102                                         | 312 differences over 26 steps        |
| L-settings-03   | settings   | wiring         | DV-106                                         | 26 differences over 26 steps         |
| L-settings-04   | settings   | element-added  | DV-102                                         | 2256 differences over 26 steps       |
| L-settings-05   | settings   | text           | DV-301                                         | swap, 1 replacement(s) in settings   |
| L-settings-06   | settings   | text           | DV-301                                         | swap, 1 replacement(s) in settings   |
| L-settings-07   | settings   | text           | DV-304                                         | swap, 1 replacement(s) in settings   |
| L-settings-08   | settings   | text           | DV-302                                         | swap, 1 replacement(s) in settings   |
| L-settings-09   | settings   | text           | DV-305                                         | swap, 1 replacement(s) in settings   |
| L-settings-10   | settings   | text           | DV-304                                         | 60 differences over 26 steps         |
| L-settings-11   | settings   | text           | DV-304                                         | 20 differences over 26 steps         |
| L-all-01        | *          | computed-style | DV-503                                         | 76 differences over 152 steps        |
| L-all-02        | *          | computed-style | DV-503                                         | 656 differences over 152 steps       |
| L-operations-01 | operations | text           | DV-101                                         | swap, 1 replacement(s) in operations |
| L-operations-02 | operations | text           | DV-401                                         | swap, 1 replacement(s) in operations |
| L-operations-03 | operations | text           | DV-401                                         | swap, 1 replacement(s) in operations |
| L-operations-04 | operations | text           | DV-401                                         | swap, 1 replacement(s) in operations |
| L-operations-05 | operations | text           | DV-412                                         | swap, 1 replacement(s) in operations |
| L-operations-06 | operations | text           | DV-414                                         | swap, 1 replacement(s) in operations |
| L-operations-07 | operations | text           | DV-401                                         | swap, 1 replacement(s) in operations |
| L-operations-08 | operations | text           | DV-401                                         | swap, 1 replacement(s) in operations |
| L-operations-09 | operations | element-added  | DV-102                                         | 936 differences over 78 steps        |
| L-operations-10 | operations | element-added  | DV-102                                         | 6402 differences over 78 steps       |
| L-operations-11 | operations | wiring         | DV-106                                         | 78 differences over 78 steps         |
| L-operations-12 | operations | text           | DV-414                                         | swap, 1 replacement(s) in operations |
| L-operations-13 | operations | wiring         | DV-401                                         | 2384 differences over 78 steps       |
| L-operations-14 | operations | wiring         | DV-401                                         | 1332 differences over 78 steps       |
| L-operations-15 | operations | wiring         | DV-413                                         | 1672 differences over 78 steps       |
| L-operations-16 | operations | wiring         | DV-402                                         | 1206 differences over 78 steps       |
| L-operations-17 | operations | wiring         | DV-401                                         | 230 differences over 78 steps        |
| L-operations-18 | operations | wiring         | DV-403, DV-106                                 | 156 differences over 78 steps        |
| L-operations-19 | operations | reorder        | DV-106                                         | 76 differences over 78 steps         |
| L-operations-20 | operations | text           | DV-401, DV-413                                 | swap, 1 replacement(s) in operations |
| L-operations-21 | operations | text           | DV-411                                         | swap, 1 replacement(s) in operations |
| L-operations-22 | operations | text           | DV-411                                         | swap, 1 replacement(s) in operations |
| L-operations-23 | operations | text           | DV-401                                         | swap, 1 replacement(s) in operations |
| L-operations-24 | operations | text           | DV-404                                         | swap, 1 replacement(s) in operations |
| L-operations-25 | operations | text           | DV-405, DV-404                                 | swap, 1 replacement(s) in operations |
| L-operations-26 | operations | text           | DV-404                                         | swap, 1 replacement(s) in operations |
| L-operations-27 | operations | text           | DV-402                                         | swap, 1 replacement(s) in operations |
| L-operations-28 | operations | text           | DV-402                                         | swap, 1 replacement(s) in operations |
| L-operations-29 | operations | text           | DV-402, DV-420                                 | swap, 1 replacement(s) in operations |
| L-operations-30 | operations | element-added  | DV-403                                         | 180 differences over 4 steps         |
| L-operations-31 | operations | wiring         | DV-403, DV-404                                 | 4 differences over 4 steps           |
| L-operations-32 | operations | wiring         | DV-405, DV-406, DV-408, DV-410, DV-415, DV-417 | 594 differences over 18 steps        |
| L-operations-33 | operations | wiring         | DV-406, DV-417                                 | 126 differences over 18 steps        |
| L-operations-34 | operations | wiring         | DV-407                                         | 804 differences over 18 steps        |
| L-operations-35 | operations | reorder        | DV-407                                         | 84 differences over 18 steps         |
| L-operations-36 | operations | text           | DV-415, DV-401                                 | 90 differences over 18 steps         |
| L-operations-38 | operations | wiring         | DV-407                                         | 2 differences over 2 steps           |
| L-operations-39 | operations | element-added  | DV-407                                         | 68 differences over 2 steps          |
| L-operations-40 | operations | element-added  | DV-408                                         | 40 differences over 2 steps          |
| L-operations-41 | operations | region-mask    | DV-408                                         | 2 differences over 2 steps           |
| L-operations-42 | operations | wiring         | DV-417                                         | 20 differences over 4 steps          |
| L-operations-43 | operations | wiring         | DV-417                                         | 4 differences over 4 steps           |
| L-operations-44 | operations | element-added  | DV-406                                         | 8 differences over 2 steps           |
| L-operations-45 | operations | region-mask    | DV-406                                         | 2 differences over 2 steps           |
| L-operations-46 | operations | text           | DV-402                                         | swap, 1 replacement(s) in operations |
| L-operations-47 | operations | text           | DV-402                                         | swap, 1 replacement(s) in operations |
| L-operations-48 | operations | text           | DV-402                                         | swap, 1 replacement(s) in operations |
| L-operations-49 | operations | text           | DV-402                                         | swap, 1 replacement(s) in operations |
| L-operations-50 | operations | wiring         | DV-402                                         | 156 differences over 78 steps        |
| L-operations-51 | operations | text           | DV-415                                         | swap, 1 replacement(s) in operations |
| L-operations-37 | operations | text           | DV-416, DV-401                                 | swap, 1 replacement(s) in operations |
| L-operations-52 | operations | element-added  | DV-402                                         | 236 differences over 2 steps         |
| L-operations-53 | operations | region-mask    | DV-402                                         | 2 differences over 2 steps           |
| L-operations-54 | operations | region-mask    | DV-403                                         | 4 differences over 4 steps           |
| L-operations-55 | operations | region-mask    | DV-403                                         | 4 differences over 4 steps           |
| L-operations-56 | operations | region-mask    | DV-403                                         | 4 differences over 4 steps           |
| L-operations-57 | operations | region-mask    | DV-403                                         | 4 differences over 4 steps           |
| L-operations-58 | operations | text           | DV-401                                         | swap, 1 replacement(s) in operations |
| L-operations-59 | operations | text           | DV-401                                         | swap, 1 replacement(s) in operations |
| L-operations-60 | operations | text           | DV-401                                         | 12 differences over 6 steps          |
| L-operations-61 | operations | region-mask    | DV-401                                         | 6 differences over 6 steps           |
| L-operations-62 | operations | text           | DV-414                                         | swap, 1 replacement(s) in operations |

## The allow-listed differences

All of them rest on a DV line in `design-patches/DEVIATIONS.md`: DV-101 to DV-106 (live chrome), DV-210 to DV-223
(Payments), DV-301 to DV-316 (Settings), DV-401 to DV-421 (Operations) and DV-501 to DV-504. The Payments and Settings
entries (`L-payments-*`, `L-settings-*`, `L-all-*`) are unchanged from the first live parity work; their reasons are in
`parity/allowlist.live.json`. The Operations entries, new with this work, each with its DV id:

| id              | kind            | DV                                             | where                                                              | what and why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------- | --------------- | ---------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-operations-01 | swap (template) | DV-101                                         | every step                                                         | the header chip shows the session's role title (GET /me displayRole, Rafael's first role 'Management'); the Command Center design prints 'Manager'. The oracle gets the same title before it renders.                                                                                                                                                                                                                                                                                                         |
| L-operations-02 | swap (logic)    | DV-401                                         | every step                                                         | money arrives in integer cents and shows cents only when the amount is not whole (formatCentsCompact); the design rounded every amount to whole dollars. The oracle's money() gets the same rule before it renders.                                                                                                                                                                                                                                                                                           |
| L-operations-03 | swap (logic)    | DV-401                                         | every step                                                         | the 'N booked' sub-label is the server's count of the window's upcoming booked and confirmed appointments (review B29: 7 on the design day, 6 once a gesture starts or checks in Marcus Webb); the design printed the literal '12 booked'. The oracle counts its own appointments the same way before it renders.                                                                                                                                                                                             |
| L-operations-04 | swap (logic)    | DV-401                                         | every step                                                         | 'Bay time free' is the server's open bay time left today (2.8h on the design day); the design printed the literal '3.5h'.                                                                                                                                                                                                                                                                                                                                                                                     |
| L-operations-05 | swap (template) | DV-412                                         | every step                                                         | 'Simulate arrival' is 'Check in', the real arrive command.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| L-operations-06 | swap (logic)    | DV-414                                         | every step                                                         | the bay timer and its estimated completion run on the server's start instant (finish = max(start + duration, now)); the design added the duration to the booked time. The oracle computes the same finish from its own start before it renders.                                                                                                                                                                                                                                                               |
| L-operations-07 | swap (logic)    | DV-401                                         | every step                                                         | Aisha Rahman is a VIP client in the Settings design and in the seed (plan default 'Aisha Rahman VIP in seed (per Settings)'); the Command Center fixture forgot the flag. The oracle's a9 gets vip:true before it renders.                                                                                                                                                                                                                                                                                    |
| L-operations-08 | swap (logic)    | DV-401                                         | every step                                                         | tax is 7% half-up to the cent on every invoice (the server's calc); the design rounded the tax to whole dollars, so its totals, balances and KPIs were whole. The oracle's total() gets the cent tax before it renders (L-operations-02 then prints the cents).                                                                                                                                                                                                                                               |
| L-operations-09 | element-added   | DV-102                                         | dom                                                                | the chip is wrapped in the sign-out menu (a relative wrapper with data-live-menu and the closed dropdown); the chip itself is the design's.                                                                                                                                                                                                                                                                                                                                                                   |
| L-operations-10 | element-added   | DV-102                                         | style                                                              | the chip sits inside the sign-out menu wrapper, so everything under the header's chip slot is one level deeper than in the design (identical boxes: pixels are at zero).                                                                                                                                                                                                                                                                                                                                      |
| L-operations-11 | wiring          | DV-106                                         | every step                                                         | the live class adds the `live` root (user chip, sign-out, view-as) to renderVals.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| L-operations-12 | swap (logic)    | DV-414                                         | every step                                                         | a staff column's avatar colour is the employee record's (the Settings design colours its employees by list position, and the seed follows it: Marco #7A3B8A, Lena #C2740B, Sofia #0D9488); the Command Center design used its own fixed map. The oracle gets the employees' colours before it renders.                                                                                                                                                                                                        |
| L-operations-13 | wiring          | DV-401                                         | every step                                                         | appointments carry the server's ids (UUIDv7) where the fixture had a1..a12 and its calendar generator g<day>_<n>; ids are never rendered.                                                                                                                                                                                                                                                                                                                                                                     |
| L-operations-14 | wiring          | DV-401                                         | every step                                                         | the timeline groups are keyed by the real business date and start instant (the first divider is the real day); the fixture keyed them by a day offset and the time label. Keys are never rendered.                                                                                                                                                                                                                                                                                                            |
| L-operations-15 | wiring          | DV-413                                         | every step                                                         | the calendar's rows, headings and modes come from GET /calendar/* and are built only while the Calendar view is open; until then they are empty (opened, they must equal the design's).                                                                                                                                                                                                                                                                                                                       |
| L-operations-16 | wiring          | DV-402                                         | every step                                                         | the New Appointment packages and slots come from GET /services and GET /availability and are built only while the sheet is open; until then they are empty (opened, they must equal the design's).                                                                                                                                                                                                                                                                                                            |
| L-operations-17 | wiring          | DV-401                                         | every step                                                         | a card's hasNotes is the server's boolean flag; the fixture passed the note text itself as the truthy value. Only the sc-if reads it.                                                                                                                                                                                                                                                                                                                                                                         |
| L-operations-18 | wiring          | DV-403, DV-106                                 | every step                                                         | the live class adds the New Appointment form state (`nf`) and its `loading` flag to renderVals.                                                                                                                                                                                                                                                                                                                                                                                                               |
| L-operations-19 | reorder         | DV-106                                         | vals                                                               | the live class builds renderVals with the bridge's keys (`live`, `nf`, `loading`) in its own order; the template binds by name, so the order is never rendered.                                                                                                                                                                                                                                                                                                                                               |
| L-operations-20 | swap (logic)    | DV-401, DV-413                                 | every step                                                         | the Week range lists the week's real appointments: the seed creates the days after tomorrow from the design's own calendar generator (tomorrow keeps the fixture only, backend test/golden/ops deviation 11) as bookings only, without invoices, add-ons or memberships, so their cards read 'No invoice' with no member or add-on chip. The design's Week timeline only had the twelve fixture appointments. The oracle's Week pool gets its generated appointments for days 2 to 6, as the seed holds them. |
| L-operations-21 | swap (logic)    | DV-411                                         | every step                                                         | the timeline puts a divider before every new day (Today, Tomorrow, then the date: 'Monday, June 15'); the design only knew Today and Tomorrow. The oracle gets the same dividers before it renders.                                                                                                                                                                                                                                                                                                           |
| L-operations-22 | swap (logic)    | DV-411                                         | every step                                                         | the divider of every new day is shown (see L-operations-21).                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| L-operations-23 | swap (logic)    | DV-401                                         | every step                                                         | the file's phone line is the customer's number on record; the seeded design customers carry synthetic 555-01xx numbers (the plan's guard so a seed never texts a stranger) instead of the fixture's. The oracle shows the seeded numbers before it renders.                                                                                                                                                                                                                                                   |
| L-operations-24 | swap (template) | DV-404                                         | every step                                                         | SMS only; the file header chip reads 'SMS opted-in'.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| L-operations-25 | swap (logic)    | DV-405, DV-404                                 | every step                                                         | an outgoing bubble ends its time with the delivery state (the seeded design texts are delivered: ' · Delivered') and an automated text is tagged 'Automated · SMS' (SMS only). The oracle's bubbles get the same before it renders.                                                                                                                                                                                                                                                                           |
| L-operations-26 | swap (template) | DV-404                                         | every step                                                         | the sheet's opt-in toggle reads 'SMS' (SMS only).                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| L-operations-27 | swap (logic)    | DV-402                                         | every step                                                         | the slot grid is the day's real bay-aware availability (GET /availability on the seeded day: past slots hidden, 11:00 AM to 2:00 PM would overbook a bay, 2:30 PM first free, last start 4:00 PM by the cutoff; backend test/golden/ops deviation 10); the design hard-coded eight slots. The oracle gets the same grid before it renders.                                                                                                                                                                    |
| L-operations-28 | swap (logic)    | DV-402                                         | every step                                                         | the blocked slots are the server's (no seeded VIP hold falls on these slots of the day, see L-operations-27).                                                                                                                                                                                                                                                                                                                                                                                                 |
| L-operations-29 | swap (logic)    | DV-402, DV-420                                 | every step                                                         | a greyed slot stays pickable for a role with sched.override (it then asks for the override reason), so its cursor is the pointer for Rafael; the design showed not-allowed.                                                                                                                                                                                                                                                                                                                                   |
| L-operations-30 | element-added   | DV-403                                         | new-appointment; steps open-new, open-walkin; dom, style           | the sheet's static name, phone, vehicle and plate boxes are real inputs in the design's box style (an <input> where the design had a <div> with placeholder text).                                                                                                                                                                                                                                                                                                                                            |
| L-operations-31 | wiring          | DV-403, DV-404                                 | new-appointment; steps open-new, open-walkin                       | the SMS opt-in toggle of the sheet is a real control and says what it does (title 'Text this customer').                                                                                                                                                                                                                                                                                                                                                                                                      |
| L-operations-32 | wiring          | DV-405, DV-406, DV-408, DV-410, DV-415, DV-417 | appointment-file; steps open-file, tab-*                           | the live file view model adds the composer, the SMS chip, the Payment pending box, the tender choice, the payment link input, Apply credit, the upgrade line and the pickup state; only keys the design does not have.                                                                                                                                                                                                                                                                                        |
| L-operations-33 | wiring          | DV-406, DV-417                                 | appointment-file; steps open-file, tab-*                           | the quick-reply pills carry their style (the disabled look for a role without msg.send); the design styled them in the template.                                                                                                                                                                                                                                                                                                                                                                              |
| L-operations-34 | wiring          | DV-407                                         | appointment-file; steps open-file, tab-*; vals                     | a photo slot is a real photo (thumbnail URL, note) or the add tile (file input: accept, busy, disabled, onFile); the design's slots were grey icons.                                                                                                                                                                                                                                                                                                                                                          |
| L-operations-35 | reorder         | DV-407                                         | appointment-file; steps open-file, tab-*; vals                     | the photo slot style objects list their properties in another order (the add tile is positioned for its file input); the template binds by name.                                                                                                                                                                                                                                                                                                                                                              |
| L-operations-36 | text            | DV-415, DV-401                                 | appointment-file; steps open-file, tab-*; vals                     | the membership figures are the membership port's (renewal, credits left and used, months, retention label); Marcus Webb is not a member, so they are empty, where the design computed fixed values (Jul 12, 1 credit, 8 + visits % 6 months, 'Loyal' by visit count) for everyone.                                                                                                                                                                                                                            |
| L-operations-37 | swap (logic)    | DV-416, DV-401                                 | every step                                                         | History is the customer's real completed visits followed by the appointment's activity log, with real totals; for Marcus Webb (the file the scenarios open) that is no completed visit, $20 paid (today's deposit), no cadence, and the two log lines of yesterday. The design invented three past visits, visits*148 and '18 days'. The oracle gets those values before it renders.                                                                                                                          |
| L-operations-38 | wiring          | DV-407                                         | appointment-file; steps tab-photos; console                        | the seeded photo rows have no object behind them, so their thumbnail requests answer 404 (the browser logs it) before the slot falls back to the design's tile.                                                                                                                                                                                                                                                                                                                                               |
| L-operations-39 | element-added   | DV-407                                         | appointment-file; steps tab-photos; dom, style                     | the photo slots are real: a photo is an image (falling back to the design's tile when it cannot load) and the add tile carries a file input over it (positioned, overflow hidden).                                                                                                                                                                                                                                                                                                                            |
| L-operations-40 | element-added   | DV-408                                         | appointment-file; steps tab-payments; dom, style                   | Mark Paid first asks Card or Cash: the tender row sits above Send payment link, so the two buttons under it move down 58 px and the panel grows.                                                                                                                                                                                                                                                                                                                                                              |
| L-operations-41 | region-mask     | DV-408                                         | appointment-file; steps tab-payments                               | pixels of the Payments tab's right column under the balance card (the Card/Cash row and the two buttons it moves down, with their shadows).                                                                                                                                                                                                                                                                                                                                                                   |
| L-operations-42 | wiring          | DV-417                                         | appointment-file; steps tab-messages, tab-payments; dom            | the file's commands carry their enabled look in the style (opacity 1, pointer; a role that cannot use them gets the disabled look) and an empty title (the role's reason when disabled).                                                                                                                                                                                                                                                                                                                      |
| L-operations-43 | wiring          | DV-417                                         | appointment-file; steps tab-messages, tab-payments; dom            | see L-operations-42 (the empty title of an enabled command).                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| L-operations-44 | element-added   | DV-406                                         | appointment-file; steps tab-messages; dom, style                   | the 'Type a message…' box is a real input (Enter sends) in the design's box style.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| L-operations-45 | region-mask     | DV-406                                         | appointment-file; steps tab-messages                               | the composer's placeholder is an input placeholder, which the browser draws a fraction of a pixel off the design's plain text.                                                                                                                                                                                                                                                                                                                                                                                |
| L-operations-46 | swap (template) | DV-402                                         | every step                                                         | a walk-in has no slot grid (it takes the next slot of the grid) and books with 'Check in walk-in'. The oracle's sheet hides the slot section and changes the button for its Walk-in title before it renders (template part 1 of 3).                                                                                                                                                                                                                                                                           |
| L-operations-47 | swap (template) | DV-402                                         | every step                                                         | see L-operations-46 (template part 2 of 3: the end of the slot section).                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| L-operations-48 | swap (template) | DV-402                                         | every step                                                         | see L-operations-46 (template part 3 of 3: the button label).                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| L-operations-49 | swap (logic)    | DV-402                                         | every step                                                         | see L-operations-46 (the oracle's logic says which sheet is open).                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| L-operations-50 | wiring          | DV-402                                         | vals                                                               | the two flags the oracle gets from L-operations-49 for its sheet; the live sheet reads nf.showSlots and nf.submitLabel instead.                                                                                                                                                                                                                                                                                                                                                                               |
| L-operations-51 | swap (template) | DV-415                                         | every step                                                         | a non-member gets the server's upgrade line, which offers a plan only with 3 or more visits in 60 days; Marcus Webb (the file the scenarios open) has fewer in the seed, so it reads 'Marcus Webb is not a member yet. Offer a plan at check-out.' where the design printed a fixed '4 visits in 60 days' candidate line. The oracle gets that sentence before it renders.                                                                                                                                    |
| L-operations-52 | element-added   | DV-402                                         | new-appointment; steps open-new; dom, style                        | a date row (Today · Saturday, June 13 with ‹ ›) sits between the slot heading and the grid, so the grid and the note under it move down 58 px and the sheet body grows.                                                                                                                                                                                                                                                                                                                                       |
| L-operations-53 | region-mask     | DV-402                                         | new-appointment; steps open-new                                    | pixels of the slot area under its heading (the date row and the grid it moves down, to the footer).                                                                                                                                                                                                                                                                                                                                                                                                           |
| L-operations-54 | region-mask     | DV-403                                         | new-appointment; steps open-new, open-walkin                       | the Full name box is an input; the browser draws its placeholder a fraction of a pixel off the design's plain text.                                                                                                                                                                                                                                                                                                                                                                                           |
| L-operations-55 | region-mask     | DV-403                                         | new-appointment; steps open-new, open-walkin                       | the Phone number box is an input (placeholder drawn a fraction of a pixel off, see L-operations-54).                                                                                                                                                                                                                                                                                                                                                                                                          |
| L-operations-56 | region-mask     | DV-403                                         | new-appointment; steps open-new, open-walkin                       | the Year / Make / Model box is an input (placeholder drawn a fraction of a pixel off, see L-operations-54).                                                                                                                                                                                                                                                                                                                                                                                                   |
| L-operations-57 | region-mask     | DV-403                                         | new-appointment; steps open-new, open-walkin                       | the License plate box is an input (placeholder drawn a fraction of a pixel off, see L-operations-54).                                                                                                                                                                                                                                                                                                                                                                                                         |
| L-operations-58 | swap (logic)    | DV-401                                         | every step                                                         | a card's pay line is the server's; an appointment with no invoice (the seed's generated days, see L-operations-20) reads 'No invoice'. The oracle's card gets that label for such an appointment.                                                                                                                                                                                                                                                                                                             |
| L-operations-59 | swap (logic)    | DV-401                                         | every step                                                         | 'No invoice' is drawn in the muted ink (see L-operations-58).                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| L-operations-60 | text            | DV-401                                         | touch-long-press-drag/mouse-drag-to-bay; steps drop, toast-expired | 'Bay time free' is the server's free bay time left today; when a gesture puts Marcus Webb's job in Bay 2 it drops from 2.8h to 2.4h, while the design's figure is a literal (L-operations-04 gives the oracle the 2.8h of the untouched day).                                                                                                                                                                                                                                                                 |
| L-operations-61 | region-mask     | DV-401                                         | touch-long-press-drag/mouse-drag-to-bay; steps drop, toast-expired | pixels of the 'Bay time free' figure after a drop (see L-operations-60).                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| L-operations-62 | swap (logic)    | DV-414                                         | every step                                                         | the bay timer runs on the server's start instant: a job dropped onto a bay is stamped by the server's clock, which on the parity stack is frozen at the design's instant (10:36:00), while the oracle stamped it with its own clock after the scenario's long-press. The oracle stamps the drop with the same frozen instant before it renders.                                                                                                                                                               |

## Triage of the Operations run: where every difference went

Every difference of the first Operations runs went into exactly one bucket.

**(a) Deliberate live difference already declared by a DV line**: the entries above (DV-101/102/106 for the chrome,
DV-401 to DV-417 for the screen). Most are oracle swaps, so the comparison stays exact on the rest: cent tax and cents in
money (DV-401), the server's 'N booked' rule and Bay time free, Aisha Rahman's VIP flag (the Settings design's VIP list),
the seeded synthetic phone numbers, SMS wording (DV-404/405), the Bay 1 finish from the start instant (DV-414), the
employees' avatar colours (DV-414), a divider for every day and the generated week (DV-411/413), the New Appointment
slot grid of the seeded day and the walk-in sheet without slots (DV-402), the upgrade line and History of the opened
file (DV-415/416).

**(b) Live bugs, fixed in the live code with a test**

- A free bay's "Next" line ignored the range tab: on Tomorrow it named today's car. It now follows the range and the
  search like the design (`withWindowNextUp`, `src/screens/operations/live-nextup.test.ts`).
- A photo whose thumbnail cannot load (the seeded rows have no object behind them; a signed link can expire) showed the
  browser's broken-image box; it now falls back to the design's grey tile (`src/screens/operations/live-photo-fallback.test.ts`).
- A job in a bay with nobody assigned showed a dash as its avatar; the design derives "U" from "Unassigned" (test in
  `live-nextup.test.ts`).

**(c) Seed mismatch, fixed in the backend branch with its test**

- `ws/w5c-be`: the parity-ops threads opened with the booking thanks as an automated text; the design's first message
  is a staff message (solid bubble, no "Automated" tag). The seed now sends it as staff (`test/golden/ops/seed.test.ts`).

**(d) Harness artifacts, fixed in the harness**

- Per-screen stacks: one combined stack seeded `design,parity-ops,parity-pay` made Payments show twelve extra invoices of
  the Operations day. Each screen now runs on its own stack, checked before the run (profiles, freeze, build).
- Writing scenarios: the drop and swipe gestures change server data; the schema is saved and restored around each run.
- The clock: the live page ran its timers in real time while the harness waited, so a toast could expire and a
  long-press could arm before the snapshot, at an instant the pinned Date did not know. Page timers of 300 ms or more and
  intervals of a second or more now move only with the scenario's `runFor`, each fired at its own instant on the pinned
  Date, like the originals' fake clock (`tools/parity/live-timers.test.ts`).
- Stale entries are judged once over the runs of the whole invocation (a `*` entry that only shows in some screens is
  not stale in the others).

## Design contradictions the run surfaced (listed for the owner)

1. **Invoice ids** (Payments, review B11), **one person with two roles**, **Preview as**, **fabricated counts** and **the
   reschedule link**: as before (DV-501, DV-101/DV-504, DV-104, DV-302/305, DV-304).
2. **Aisha Rahman** is a VIP client in the Settings design and not in the Command Center fixture; the seed follows
   Settings (plan default), so her card has the VIP badge and the Up Next queue puts her first.
3. **Staff colours**: the Command Center design gives Marco, Lena and Sofia fixed avatar colours; the Settings design
   colours employees by list position. Live follows the employee record (Settings).
4. **Tomorrow and the week**: the design's calendar generates four jobs for tomorrow that its own board never lists, and
   its Week range lists only the fixture jobs while the calendar generates the rest. The seed keeps tomorrow to the
   fixture and creates the days after it as bookings only (no invoice, add-on or membership), so their cards read
   "No invoice".
5. **Bay time free and the 'booked' count** are computed (review B29); the design's '3.5h' and '12 booked' were literals.

## The self-test (sensitivity)

`pnpm parity:live:selftest` proves the live mode can fail, on every screen's own stack. It (1) runs a baseline
(Operations initial, Payments initial, Settings "Packages & checklists"), (2) applies six seed changes **one at a time**
straight to the schema of the screen's stack, runs that screen and requires the DOM, renderVals and pixel checks to fail,
and (3) reverts them (even when a phase throws) and requires a clean pass again:

| change                                                                | seen by                  |
| --------------------------------------------------------------------- | ------------------------ |
| Operations: the first item of Marcus Webb's invoice gets $1.00 dearer | dom, style, vals, pixels |
| Operations: the customer Marcus Webb is renamed                       | dom, style, vals, pixels |
| Payments: the first item of INV-20608 gets $1.00 dearer               | dom, style, vals, pixels |
| Payments: the client of INV-20608 is renamed                          | dom, style, vals, pixels |
| Settings: every package gets $1.00 dearer                             | dom, vals, pixels        |
| Settings: the package Express Hand Wash is renamed                    | dom, style, vals, pixels |

It took about two minutes on the shared box.

## Not verified, and limits

- Scenarios are the catalogue of docs/parity.md. Writes beyond the three gestures (sheets submitted, Settings edited)
  are covered by `pnpm e2e:payments`, `pnpm e2e:operations` and `scripts/e2e-settings.ts`, not by this proof.
- One persona (Rafael, Management and Accounting) in a 1480x1000 Chromium; other roles, view-as and locked screens are
  not compared (the originals have no equivalent).
- The oracle swaps encode what the seeds hold on the design day (the opened file is Marcus Webb's, the slot grid of
  that day, the week's generated bookings); a different seed needs different swaps, and the run refuses a stack seeded
  with other profiles.
- The harness trusts the quiet window: a screen that fetches later than 900 ms after its last change would be
  snapshotted early. Nothing on the three screens does today.
- The server's clock stays frozen while a scenario's `runFor` moves the page's: a job the server starts during a
  scenario is stamped with the frozen instant (the oracle is given the same, `L-operations-62`).
- The live build is compared as built by `pnpm build:live`; `design/` and the fixture build are untouched.
