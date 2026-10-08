# Live parity: the live screens against the original designs

`pnpm parity` proves that the **fixture build** renders exactly like the original bundles (docs/parity.md). This is the
second half of the proof: the **live build**, fed by the real API and a real Postgres, renders the same on equivalent
data. The original bundle stays the oracle on its own fixture state; the live side is the dashboard built with
`pnpm build:live` (the build people use), served against a stack from `pnpm live:up` that is seeded with the design's
data and frozen at the design's instant.

Covered: **Operations**, **Payments** and **Settings**, every scenario of the catalogue in both themes: 22 scenarios x 2
themes = 44 runs, 178 steps. Each screen runs against **its own stack**, seeded with exactly the profiles the registry
declares (`tools/parity/live-registry.ts`), because one screen's seed changes what another shows (parity-ops puts twelve
invoices on the design day, which the Payments design does not have):

| screen     | stack   | API / web  | seed profiles (exactly)  | what the seed mirrors                                                                                        |
| ---------- | ------- | ---------- | ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| operations | `lpops` | 4064 / 3264 | `design,parity-ops`      | the Command Center day: a1-a12 with invoices, members, checklists, texts, and the generated calendar days      |
| payments   | `lppay` | 4065 / 3265 | `design,parity-pay`      | the 105-invoice set of the Payments design                                                                    |
| settings   | `lpset` | 4066 / 3266 | `design,parity-ops`      | the design seed (hours, closures, staff, roles, VIP, packages); the emergency preview lists the day's customers |

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

| Concern         | Fixture mode                                                  | Live mode                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network         | everything but the port origin is aborted                     | the dashboard origin (it proxies `/api`) and the API origin are allowed, everything else is aborted and reported                                                                                                                                                                                                                                                                                    |
| Session         | none                                                          | sign-in through the real `/login` page in a throwaway context (its event stream is blocked so it leaves nothing open), then only the cookies move to the run's context: a cookie jar per run. The theme is stored as the person's server preference first, because the live variant takes the theme from the server and `localStorage` is only its cache                                            |
| Clock           | `clock.install` + `pauseAt`, time only moves through `runFor` | `Date` is pinned to the stack's frozen instant (so `serverNow()` equals the server's frozen clock and "Today 10:36 AM" is stable) but short timers run, because react-query batching, `requestAnimationFrame` and the event stream's back-off need them. Page timers of 3 s or more (a toast lives 3.2 s) are **held** and fire only when a scenario calls `runFor`, which also moves the pinned `Date` on by the same span, exactly like the originals' paused clock |
| Ready           | `#dc-root[data-oasis-ready=1]` set by the parity build        | no hook exists in the live build: the harness waits for `#dc-root .sc-host`, for the event stream (`/api/v1/events`) to answer 200, then for **quiet**: no `/api/v1` request in flight, no loading text, and `#dc-root` unchanged for 900 ms of real time (longer than the screens' 250 ms debounce timers, so a request that is about to start is not missed)                                      |
| `renderVals`    | `window.__oasisParity.getVals()`                              | the logic instance is found through the React fiber behind `.sc-host` (as for the originals) and `serializeVals(renderVals())` is compared, including the live-only `live` root                                                                                                                                                                                                                     |
| Element pairing | by `data-dc-tpl` id                                           | by DOM position on both sides (the live build carries no `data-dc-tpl`; the originals' ids are ignored for pairing in this mode)                                                                                                                                                                                                                                                                    |
| Float noise     | exact                                                         | a computed decimal with at least nine fractional digits that differs from its twin only in the last digits (relative 1e-12, same unit) is not a difference; the API gives integer cents and the live class divides, the design accumulated floats. Counted and shown in the step's `vals` note. Short or typed values are always exact                                                            |
| Allow-list      | `parity/allowlist.json`                                       | `parity/allowlist.json` (the D4 link swaps) plus `parity/allowlist.live.json`; ids `L-<screen>-<nn>`                                                                                                                                                                                                                                                                                                |

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

RESULT_PLACEHOLDER
