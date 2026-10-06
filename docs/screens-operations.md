# Operations (Command Center): the typed view model

Stage 2a of the migration recipe in `docs/data-layer.md`. The Operations page no longer evaluates the design's logic
source: `src/screens/operations/Screen.tsx` renders the compiled template (`@generated/operations`, untouched) through
`DCHost` with `OperationsLogic`, a typed TypeScript port of the original `class Component extends DCLogic`. Behaviour and
pixels are unchanged (the parity harness is at zero diff, see "Verification"). Payments and Settings still run their
original classes through `createScreen`/`loadLogic`.

```
src/screens/operations/
  Logic.ts            OperationsLogic (the view model)
  data.ts             OperationsData: everything the class used to keep in fields, localStorage or the clock
  fixtures.ts         the ORIGINAL fixtures, verbatim, and FixtureData (the OperationsData the screen uses today)
  Screen.tsx          DCHost + ScreenStyle + OperationsLogic
  golden-project.ts   the data-bearing projection of renderVals() that the golden file records
  testkit.ts          test helpers: load the original class, attach a host, drive both the same way
src/lib/operations/   pure modules (no clock, no DOM, no randomness beyond the seeded generator)
  types, pricing, checklist, status, activity, alerts, kpis, board, hydrate, calendar, gesture
tests/operations/extract-golden.ts       throwaway extraction from the original bundle (Chromium)
tests/fixtures/golden/operations.json    its output (52 scenarios, committed)
```

## How the class maps to the original

`OperationsLogic` keeps the original's method names, state keys (same order), handler closures and `renderVals()` keys and
order, so a differential test can run both through the same steps and compare serialised `renderVals()` and `state`.

| Original (`logic.original.js`)                                                         | Port                                                                                                                                                                  |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| class fields `SERVICES ADDONS ADDON_TASKS HIST DEF_HOURS DEF_CLOSURES POOL_* BASE`     | assigned in the constructor from `data.catalog()`, `generatedHistory()`, `defaultHours()`, `defaultClosures()`, `pools()`, `today().base`                              |
| `state = (() => {...})()` (localStorage reads, inspection filter, seed hydration)      | `initialState()`; the reads and the filter live in `FixtureData`, the hydration in `lib/operations/hydrate.ts` (`hydrateSeed`)                                         |
| `componentDidMount` (1 s tick, `keydown` handler, non-passive `touchmove` guard)       | same, verbatim logic; in the live build it first subscribes to the session chrome (below)                                                                              |
| `componentWillUnmount`                                                                 | same: interval, both listeners, any gesture                                                                                                                           |
| `checklistFor initChecks setFrac checkAll toggleCheckKey checkVM`                      | `lib/operations/checklist.ts` (`checklistFor`, `initChecks`, `checklistProgress`, `setChecks`); the style objects stay in `checkVM`                                    |
| `dateFor offFor iso rng dayInfo dayCount countFor genDay hydrate`                      | `lib/dates` + `lib/calendar` (already shared) and `lib/operations/calendar.ts` (`infoFor`, `generateDayBase`, `generateDay`, `countFor`); `genDay` keeps the `_gen` cache and the `calAppts` overlay in the class |
| `known materialize openAppt calNav reschedule`                                         | same methods; `calNav` uses `navOffset`, `openAppt` uses `clickSuppressed`, `reschedule` uses `rescheduleAppt`                                                         |
| `calVM`                                                                                | same method; labels and grid maths from `dayHeading`, `weekHeading`, `monthGrid`, `hourLabel`, `rowRange`; swipe test from `calendarSwipe`                             |
| `canDrag gStart _gm _gu _gc gEnd beginDrag moveGhost hoverTarget dropOn`               | same members (the three handlers stay arrow-function fields so `removeEventListener` sees the same function); decisions in `lib/operations/gesture.ts`                  |
| `byId money parseT fmtT absMin nowClock stMeta hexA isLate inFacility total balance memberMeta` | thin methods over `lib/time`, `lib/money`, `lib/color`, `lib/operations/{pricing,status}`                                                                      |
| `ensureActivity update flash nextStep advance assignToBay togglePay togglePickup toggleAddon collect sendTemplate notify prepBay simArrive` | the same methods; the appointment edits are the pure commands in `lib/operations/activity.ts` (`advanceAppt`, `assignBay`, `togglePayment`, ...) applied to the working copy `update()` hands out |
| `badgeStyle lighten cardVM`                                                            | same; `cardVM` unchanged                                                                                                                                              |
| `renderVals`                                                                           | same key order. KPIs: `buildKpis`; alerts: `buildAlerts` (descriptors) + `alertVM` (styles, closures); board lists: `selectPool sortPool upcoming groupTimeline occupantOf nextForBay queueOf arrivalsOf bayProgress`; the file (`sel`) is `selVM` |
| `hintFor tagS slots`                                                                   | `lib/operations/status.ts` `hintFor`; `tagS` and `slots` stay methods                                                                                                 |
| `window.__oasisLive` bridge appended by the compiler (live variant)                    | `liveMount()` and `withLive()` inside the class, active only when `NEXT_PUBLIC_VARIANT === 'live'`                                                                    |

Handler-bearing values in `renderVals()` are closures, as before; `serializeVals` turns them into `"[fn]"`, so the parity
`renderVals` diff compares structure and data only.

## Fixtures and where each lives

Everything below is in `src/screens/operations/fixtures.ts`, copied byte for byte from the original (extracted by script,
then formatted by prettier), and pinned by `Logic.diff.test.ts` / `operations.diff.test.ts` / `golden.test.ts`.

| Original                                                      | Export / method                                                            |
| ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `SERVICES` (9 packages; `/inspection/i` steps dropped)        | `SERVICES`; `FixtureData.catalog()` applies the filter as the original does |
| `ADDONS`, `ADDON_TASKS` (add-on tasks are not filtered)       | `ADDONS`, `ADDON_TASKS`, `catalog()`                                       |
| `oasis-checklists` override (packages, add-ons)               | `catalog()` (same order: override first, then the filter)                  |
| `HIST`, `histPool`                                            | `HIST` (generated days), `HISTORY_POOL` (seeded appointments)              |
| `DEF_HOURS`, `DEF_CLOSURES`, `oasis-hours`, `oasis-closures`  | `DEF_HOURS`, `DEF_CLOSURES`; `hours()`, `closures()` (null when unset)     |
| `oasis-emergency`                                             | `emergency()`                                                              |
| `oasis-theme`                                                 | `theme()`, `saveTheme()`                                                   |
| `POOL_NAMES`, `POOL_VEH`                                      | same names; `pools()`                                                      |
| appointments a1 to a12                                        | `SEED_APPOINTMENTS`; `seedAppointments()`                                  |
| `BASE = new Date(2026,5,13)`, `NOW = 10*60+36`, `dateLabel`   | `today()` returns `{ base, nowMinutes, dateLabel }`                        |
| `Date.now()`, `new Date()` (clock label, `startedAt`, logs)   | `clock()` returns `{ nowMs(), wall() }`; FixtureData uses the system clock |
| `slotTimes`, `blocked`, `vipHeld`                             | `NEW_APPOINTMENT_SLOTS`; `availability()`                                  |
| membership perks, `renewDate`, `'Visa ···· 4421'`, `18 days`, `visits * 148`, KPI texts `12 booked` / `3.5h` / `today` | `FIXTURE_DISPLAY`; `display()`                                     |

`FixtureData` reads storage lazily and once, in the same order as the original constructor. Storage defaults to
`window.localStorage` (a throwing accessor is treated as empty); tests pass their own.

## Swapping FixtureData for LiveData (next wave)

`OperationsLogic` takes the data as its second constructor argument (`new OperationsLogic(props, data)`); `DCHost` passes
only `props`, so the live screen subclasses it (or `Screen.tsx` passes a closure class) with its own `OperationsData`.
Each method of the interface maps to a region of `src/data/ports` (docs/data-layer.md step 3):

| `OperationsData`                                      | Source in the live build                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| `catalog()`                                           | `catalog.services` (QueryStore read; structure with empty values while loading)   |
| `hours()` `closures()` `defaultHours()` `defaultClosures()` | `hours.hours`, `hours.closures`                                             |
| `emergency()`                                         | `emergency.current` (+ SSE `emergency.changed`)                                   |
| `seedAppointments()` `historyPool()` `generatedHistory()` `pools()` | replaced by `ops.snapshot` (the board) and `calendar.day`; the generator and `genDay` go away |
| `availability()`                                      | `availability.slots`                                                              |
| `today()` `clock()`                                   | `businessToday()`, `serverNow()` and `businessClock()` from `src/lib` (the tick keeps its 1 s interval) |
| `display()`                                           | server values (membership, last payment method, history aggregates, KPI sub-labels) |
| `theme()` `saveTheme()`                               | `PUT /me/preferences` with the optimistic flip and rollback                       |

The state is read once in the constructor today (as in the original); the live class reads through `QueryStore` inside
`renderVals()` instead, and each command in `Logic.ts` (`advance`, `assignToBay`, `togglePay`, ...) becomes a
`command()` whose `request` calls the matching port method. The pure commands in `lib/operations/activity.ts` then serve
as the optimistic patches; the log and message text moves server-side. Money stays whole-dollar until then:
`lib/operations/pricing.ts` is the design's float arithmetic on purpose, and `lib/money.taxCents` is the half-up
integer-cents rule the live stage switches to.

## The live build

`pnpm build:live` still compiles. In that variant the compiler appends a bridge to the original classes
(`tools/dc-compile/live-bridge.ts`); the Operations screen no longer uses them, so `OperationsLogic` does the same
itself when `process.env.NEXT_PUBLIC_VARIANT === 'live'` (inlined by Next; the code is dead in prod and parity):
`renderVals()` gets `live` from `window.__oasisLive` as its last key (`{}` without a store), `toggleTheme` reports
`themeChanged(next, prev)` and mirrors `<html data-theme>`, the screen re-renders when the store changes, and API toasts
reach `flash(title, desc)`. `Logic.live.test.ts` runs each behaviour against the original class with the compiler's own
bridge appended. The `.generated-live/operations.logic.ts` string is still emitted but unused.

## Verification

| What                                                           | Command                                                         |
| -------------------------------------------------------------- | --------------------------------------------------------------- |
| everything fast (assert:react, design:verify, dc:check, lint, tsc, vitest) | `pnpm check`                                        |
| the port against the original class, step by step             | `pnpm exec vitest run src/screens/operations/Logic.diff.test.ts` |
| the pure helpers against the original methods                 | `pnpm exec vitest run src/lib/operations`                       |
| the port against values read from the original bundle in Chromium | `pnpm exec vitest run src/screens/operations/golden.test.ts` |
| the live-build behaviours against the compiler's bridge       | `pnpm exec vitest run src/screens/operations/Logic.live.test.ts` |
| pixels, DOM, styles, renderVals, console in Chromium          | `pnpm build:parity`, then `NEXT_PUBLIC_PARITY=1 DIST_DIR=.next-parity pnpm exec next start -p 3103` and `pnpm parity --screen operations --port-url http://127.0.0.1:3103` |

`Logic.diff.test.ts` runs every scenario once on the original class and once on the port, with the same frozen clock
(2026-06-13 10:36 America/New_York, fake timers) and storage, and compares the serialised `renderVals()`, the state and
step observations after every step. Scenarios: initial render in both themes and with emergency, hours, closures and
checklist overrides in storage; every view, range, search, theme toggle; the New Appointment panel, its slots and toasts;
the tick and minute boundary; every appointment on every tab; checklist rows, sections, all; every add-on on and off;
templates, collect, notify; advancing all twelve appointments through the whole flow; the `s r p m n / Esc` keys and the
Calendar arrows and `t`; typing in inputs; bay assignment rules (busy, already in a bay, unknown), prep and arrival;
completed-column chips and every alert action; calendar day, week and month across 800 days with and without Settings
hours, closures (closed and reduced) and an emergency; opening, advancing and rescheduling generated appointments; the
450 ms click suppression. The gesture engine runs a grid: touch intent on three card contexts (25 dx by 12 dy values),
long-press timing at 379/380/381 ms, swipe commit and clamp, cancel, mouse drag threshold (0 to 100 px, three
directions) with drops on bays and hour rows stubbed through `document.elementFromPoint`, non-primary buttons, a second
`pointerdown`, the `touchmove` guard, and the calendar swipe over distance, ratio and time.

The golden file is extracted from the ORIGINAL bundle in the pinned Chromium (`tests/operations/extract-golden.ts`:
`startOriginalServer`, `launchBrowser`, `newParityContext` from `tools/parity`, then each scenario of
`golden-project.ts` is applied to the live logic instance with `setState` and its `renderVals()` is projected). It
records KPIs, alerts, timeline groups, bays, staff, queue, pickup column, calendar day, week and month counts for 29
offsets across closures and reduced days, and the totals, checklist and membership numbers of all 12 appointment files.
Re-extract with `pnpm exec tsx tests/operations/extract-golden.ts` if the oracle ever changes.

## Preserved quirks (replicated on purpose)

These are the design's behaviours; the live stages fix or replace them (see the plan's D2 and D3 lists).

- KPI placeholders: `12 booked`, `3.5h` / `today`, `of N`; "Appointments 24h" counts every appointment of days 0 and 1.
- Whole-dollar tax: `Math.round((price + add-ons) * 0.07)` on floats; the tip is untaxed; the member credit expression is always 0.
- "Now" is frozen: alerts compare against 10:36 AM (`NOW`) while the live clock label reads the real clock; `late`, `eta`, `geoIn` are static flags.
- The first timeline group is labelled "Today" even when it is tomorrow's; `next24` and `week` do not filter; `alertCount` is exposed but not rendered.
- `toggleAddon` builds its toast after the update, so it says "Removed" when it just added and "Added" when it just removed.
- `collect()` compares against status `ready`, which never occurs; "un-pay" does not touch any ledger.
- Keys ignore modifiers (Ctrl+R advances the open job), `n` keeps a Walk-in title, `m` only toasts.
- A closed today is never shown closed in the calendar (`o !== 0`); `genDay` caches a day on first use with the settings read then.
- `ensureActivity` runs inside `renderVals()` and mutates the selected appointment in `state`.
- Every channel text still says WhatsApp (the SMS relabel is a later stage and a copy-map entry).
- Mouse swipe is not supported (a mouse drag on a timeline card starts a bay drag); touch swipe is timeline-only.
- `navigator.vibrate(12)` is attempted on drag start, `document.body.style.userSelect` is toggled, the ghost is positioned through `ghostRef`.

## Differences from the original (all intentional, all tested)

- `memberMeta` and `statusMeta` do not return inherited `Object.prototype` members for keys like `constructor` (the
  original returns a function). Same difference as the shared helpers in `src/lib/color.ts`; `operations.diff.test.ts` pins it.
- Each command reads the wall clock once, so the log line and the message of one action carry the same "10:36 AM"
  (the original calls `nowClock()` twice in `collect`, `sendTemplate` and `notify`; they differ only across a minute boundary).
- `OperationsLogic` receives its data source and clock through `OperationsData`; `FixtureData` defaults to the system
  clock and `localStorage`, so the observable values are the original's.
- An unused local (`tabBtn`) in the original `renderVals()` is gone.

## Open items for the next wave

- The `Appt` record carries the file's `messages`, `log`, `history`, `photos` and `checks` as hydrated fields; the live
  wave maps `AppointmentFile` (`ops.appointment`) and `messages.thread` onto them (the DTOs in `src/data/ports/types.ts`
  are provisional) and drops `ensureActivity`, whose lines are server-written.
- `Screen.tsx` builds the logic from `FixtureData` only; the live `OperationsData` (and the `QueryStore` subscription that
  calls `forceUpdate`) is the next wave's constructor argument.
- The tick runs while the tab is hidden, as in the original; design 3.2 proposes pausing it with one catch-up render on
  `visibilitychange`, which changes no visible behaviour and belongs in this class's `componentDidMount` in the live stage.
