# Settings screen: typed view model (stage 2a) and live data (stage 2b)

The Settings page no longer evaluates the design's logic source. `src/screens/settings/Screen.tsx` renders the compiled
template (`@generated/settings`, untouched) through `DCHost` with `SettingsLogic`, a typed port of the design's
`class Component extends DCLogic`. Two data sources plug into it:

- `FixtureData` (default and parity builds): the design's own data and its `oasis-*` localStorage behaviour. Behaviour,
  DOM and pixels are the original's (`pnpm parity --screen settings` is at zero diff).
- `LiveData` (`pnpm build:live`): the real API through the data layer. Every section is persisted and survives a reload.

```
src/screens/settings/
  Logic.ts            SettingsLogic: state, handlers, toast timer, theme, hydration from the server model, live roots
  data.ts             SettingsData (what the class reads and writes), MaybeAsync/settle, the server-model types
  fixtures.ts         the design's data verbatim and FixtureData (localStorage as the design keeps it)
  Screen.tsx          DCHost + ScreenStyle; FixtureData, or LiveData when NEXT_PUBLIC_VARIANT=live
  testkit.ts          helpers for tests that run the ORIGINAL class beside the port (not shipped)
  live/
    LiveData.ts       SettingsData over the API: QueryStore reads, command() writes, previews, debounced checklist
    mapping.ts        pure DTO <-> design-shape mapping (cents to dollars, enums to labels, schedules, errors)
    testkit.ts        a fake SettingsApi over captured responses, for the tests
    __fixtures__/     responses captured from the real API (bundle, roles, employees, one employee)
src/lib/settings/     pure formulas (no state, no clock, no storage), differential tests against the original methods
src/data/ports/settings-api.ts       the typed Settings client (createSettingsApi); registered as DataPort.settings
src/data/ports/settings-schema.d.ts  types of the Settings endpoints, generated: pnpm tsx scripts/gen-settings-schema.ts
design-patches/live/settings.patch.json + partials/settings-*.html   the live template patches (DEVIATIONS.md DV-301..316)
scripts/e2e-settings.ts              Playwright against a live stack
```

## Stage 2a: how the class maps to the original

`SettingsLogic` keeps the original's state keys (same order), handler closures and `renderVals()` keys and order, so a
differential test can run both through the same steps and compare serialised `renderVals()`, `state` and localStorage.

| Original (`logic.original.js`)                                          | Port                                                                                                                                                |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DAYS ORDER LIMITS SKILLS PERMS`, section copy, avatar colours          | `lib/settings/constants.ts`                                                                                                                         |
| `REMAINING`, `SV`, `AD`, default roles, employees, closures, hours, VIP | `fixtures.ts`                                                                                                                                       |
| `state = (() => ...)()` (localStorage reads)                            | constructor: `data.seed()`; the reads live in `FixtureData.seed()`, same expressions, same key order                                                |
| `save(k, v)`                                                            | `FixtureData` (`save`), called through the persist calls of `SettingsData`                                                                          |
| `parseT fmtT step limKey limLabel roleName eff`                         | `lib/time` (`parseT`, `fmtTRaw`), `lib/settings/format.ts` (`step`, `limKey`, `limLabel`), `perms.ts` (`effective`, `effectiveCount`, `roleNameOf`) |
| `sw seg chip` and every inline style object                             | `lib/settings/styles.ts`                                                                                                                            |
| `setRC setHours setDraft setVip openEmp flash`                          | same behaviour as private methods (`applyVip` is the state half of `setVip`)                                                                        |
| hours rows, totals, dirty check, copy Monday                            | `lib/settings/hours.ts`                                                                                                                             |
| closure rows, fabricated sub-lines and counts                           | `lib/settings/closures.ts` (the fabrications are the fixture's only)                                                                                |
| emergency wording, preview, confirm text, affected list                 | `lib/settings/emergency.ts`                                                                                                                         |
| employee filter, new-employee template, drawer validation               | `lib/settings/employees.ts`                                                                                                                         |
| role matrix edits, custom role, removal                                 | `lib/settings/roles.ts`                                                                                                                             |
| VIP hold order, arrival explainer, checklist edits                      | `lib/settings/vip.ts`, `services.ts` (`TaskOp`, `applyTaskOp`)                                                                                      |
| `renderVals()`                                                          | same key order; `vals.live` is appended last in the live build only                                                                                 |
| `toggleTheme` (+ the compiler's bridge)                                 | `data.saveTheme`, `setState`, and in the live build `chrome.themeChanged(next, prev)` and the `<html data-theme>` mirror                            |

Preserved quirks (the design's behaviour, replicated): the toast timer is 2.8 s and a second toast restarts it; a stale
click replays against its render's closure; `addHold` and the steppers read the render's state; a duplicate custom role
id (same millisecond) is pushed twice; the stepper clamps at 5:00 AM and 11:30 PM; `Switch to Packages` selects the
second package; a role with a permission but no limit counts as $25.

Differences from the original in the fixture build: none visible. A click on `saveEmp` with the drawer closed is a no-op
(the original throws on `draft.first`; the button does not exist then).

## Stage 2b: the live data

### The seam

`SettingsData` has three kinds of members (comments in `data.ts`):

- reads: `seed()`, and live only `sync()` (the server's model by part, each with a `rev`), `status()`, `locked(section)`,
  `emergencyStrip/Access/Counters/Preview`, `closureSub/Affected`, `access()`, `today()`;
- persist calls (`setPermission`, `saveVip`, `removeHold`, `saveRule`, ...): the view model already changed its state
  (optimistic, as the design does) and the data stores the change. `false` means it failed: the screen reloads the part and the
  server's truth replaces the optimistic state;
- confirm calls (`createClosure`, `close`, `saveEmployee`, `addRole`, `addVipClient`, `saveHours`): the server decides the
  outcome (ids, validation, counts), so the view model waits for the answer (`settle`) and only then changes its state. The fixture
  answers synchronously, so the design's flows run step by step; the live data answers with a promise.

### Reading

`GET /settings/bundle` is the one call on load. It seeds one query per section (`['settings', 'hours' | 'closures' |
'emergency' | 'vip' | 'arrival' | 'services']`); roles and employees load on their own (`team.view`). The query key
prefix is what SSE invalidates (`settings.changed {section}` and `rbac.changed`, backend decisions 0030 and 0031).
While the screen is open each section has a `QueryObserver`, so an invalidation refetches at once and cancels a fetch that is
already on its way (an inactive query kept what the earlier fetch read: found by the e2e).

`SettingsLogic.hydrate()` runs at the top of `renderVals()` and copies a part into the working copies when its `rev`
changed, unless a persist of that part is in flight (`busy`) or the part would overwrite something the person is editing:

| Part        | Rule                                                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `hours`     | `savedHours` follows the server; the week is merged under unsaved edits (`rebaseHours`: days the person touched stay, the rest follow) |
| `services`  | not replaced while a checklist save is waiting (the debounce window counts as in flight)                                               |
| `emergency` | only `active` and `summary` while idle (the form keeps what was typed); the running closure's fields while active                      |
| the others  | replaced                                                                                                                               |

`reload(parts)` bumps a part's revision, so a refused change is undone even when the server's data did not change.

Until a section's parts are present it shows the loading card; after a failed load, the failed card with `Try again`.

### Writes

| Screen action                   | Call (verb, path)                                                                    | Notes                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Save hours                      | `PUT /settings/hours` `{days[7], version}`                                           | the version of the last read or response; hours and rules are saved one at a time (a queue)              |
| Rule chip                       | `PUT /settings/rules` `{slot\|buffer\|cutoff, version}`                              | saves at once; the response's version is adopted                                                         |
| Closure preview (add form)      | `POST /closures/preview`                                                             | debounced, the last form state wins, the previous line stays up meanwhile                                |
| Add closure                     | `POST /closures`                                                                     | 422 shown inline (`CLOSURE_DATE_TAKEN` as the design's text)                                             |
| Notify, remove                  | `PATCH /closures/:id` `{notify}`, `DELETE /closures/:id`                             | optimistic; an emergency row answers 409 and comes back                                                  |
| Federal holidays                | `PUT /settings/auto-federal-holidays`                                                |                                                                                                          |
| Emergency preview               | `GET /emergency/preview?...`                                                         | only while the section is open and the form changed; one toast per refused form state                    |
| Confirm closure                 | `POST /emergency/close`                                                              | `Idempotency-Key` from an `Action` created with the screen, reused by retries, renewed on success        |
| Reopen                          | `POST /emergency/reopen`                                                             |                                                                                                          |
| Open an employee                | `GET /employees/:id`                                                                 | the list rows carry a summary; the drawer needs the schedule and exceptions                              |
| Save an employee                | `POST /employees`, `PUT /employees/:id` (`If-Match`), then `deactivate`/`reactivate` | validation errors inline with the tab they belong to                                                     |
| Matrix toggle, limit chip       | `PUT /roles/:id/permissions/:key`, `PUT /roles/:id/limits/:kind`                     | limits are dollars in the design, cents in `/roles`; the PUT takes dollars                               |
| Custom role, remove role        | `POST /roles`, `DELETE /roles/:id`                                                   | the server names it (`Shift Lead 2`) and reassigns Crew to people left without a role                    |
| VIP toggles, steppers, segments | `PUT /vip` (changed keys), `PUT /arrival-settings`                                   | cadence labels become keys (`Every 2 weeks` is `biweekly`)                                               |
| Holds                           | `POST /vip/holds`, `DELETE /vip/holds/:id`                                           | the id is found from the last read                                                                       |
| Clients                         | `POST /vip/clients` `{name}` or `{customerId}`, `DELETE /vip/clients/:customerId`    | 409 `VIP_CLIENT_AMBIGUOUS` gives candidates                                                              |
| Checklist edit                  | `PUT /services/:id/checklist` `[{id?, label}]`                                       | debounced 600 ms; the ids ride the edits (rename, reorder, remove act on the id list like on the labels) |
| Theme                           | `PUT /me/preferences` (through the live chrome)                                      |                                                                                                          |

### Permissions

The route gate (`src/auth/routes.ts`) already shows the locked card for a whole screen when none of the Settings keys is
held (Crew). Inside the screen:

| Section                 | Needs to read        | Writes                                                                                             |
| ----------------------- | -------------------- | -------------------------------------------------------------------------------------------------- |
| Working hours, Closures | any signed-in person | `set.hours` (hours, rules, closures, federal toggle): `Your role can’t change hours and closures`  |
| Emergency closing       | `set.emergency`      | `set.emergency`: `Your role can’t use emergency closing`; the server's `canClose` is read too      |
| Employees               | `team.view`          | `team.edit` (add, save): `Your role can’t edit employees`; Access tab and exceptions: `team.roles` |
| Roles & permissions     | `team.view`          | `team.roles`: `Your role can’t change roles`; limit chips: Super Admin only                        |
| VIP program             | `cli.member`         | `cli.member`: `Your role can’t manage memberships`                                                 |
| Arrival & check-in      | any signed-in person | `cli.member`                                                                                       |
| Packages & checklists   | any signed-in person | `set.services`: `Your role can’t edit packages and checklists`                                     |

Sections that cannot be read show the locked card; a write that cannot be done shows the toast and sends no request. The
server enforces the same rules (403 and the Super-only guards come back as toasts if the client was wrong). Pay type and
rate are withheld by the server without `team.edit`; the drawer shows `Pay hidden`.

### Effective permissions

The drawer computes them locally with `lib/settings/perms.ts` (a port of the design's `eff()` and of the backend engine)
because the draft changes before anything is saved. The server's list is the reference:
`mapping.test.ts` compares the engine with the captured `effectivePermissions` of a person with two roles and an
exception (27 rows), and the e2e compares every person's 27 rows against the live API.

### Provenance of what the template reads (review B13)

| Roots                                                                                                         | Source                                                                        |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `hourRows ruleRows weekHours hoursDirty`                                                                      | server (`hours`, `rules`), derived client-side (totals, dirty check)          |
| `upcoming past federalSw`                                                                                     | server (`closures`); the past/upcoming split by the business date             |
| `upcoming[].sub ncAffected`                                                                                   | server (real counts); `ncAffected` from the preview call                      |
| `emActive emSummary emNotified emRebooked emBooking emHistory`                                                | server (`emergency`, counters, history)                                       |
| `emAffected emAffectedCount emPreview confirmText`                                                            | server preview; client rendering as the fallback while it loads or is refused |
| `live.emStrip live.emRequirement live.emPreviewLabel`                                                         | server (`strip`, `requirement`, `canClose`, sample name)                      |
| `empRows empCount roleFilters`                                                                                | server (`employees`, `roles`); filtering client-side                          |
| `roleCards roleCols permGroups matrixCols`                                                                    | server (`roles`: matrix, limits in cents); counts derived                     |
| `dr.*` (drawer)                                                                                               | server (one employee) + draft; `effGroups`/`effCount` derived                 |
| `vipHolds vipClients vipSteppers vipToggles releaseOpts offerOpts cadenceOpts arrToggles radiusOpts prepOpts` | server (`vip`, `arrival`)                                                     |
| `arrSteps svcMeta svcList tasks`                                                                              | server (`services`), derived text                                             |
| `secX nav goX hasHeadBtn headBtnLabel toast theme drawerOpen confirmOpen nc* new* emReasons emDurations ...`  | UI state                                                                      |
| `live.*`                                                                                                      | session chrome, loading/locked/failed cards, candidates                       |

### Wording

The live variant relabels WhatsApp to SMS (D1): `Sent by SMS` (emergency option) and `Preview · SMS to {first name}`; the
drawer's `They’ll get an SMS invite` is already SMS. The other live-only differences are in `design-patches/DEVIATIONS.md`
(DV-301 to DV-316).

## Running it

```bash
export PATH=$HOME/.local/bin:$PATH NODE_OPTIONS=--max-old-space-size=2048 PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-arm64
pnpm live:up --name settings --api-port 4021 --web-port 3221 --profile design [--backend ~/oasis/wt/d7-be]
pnpm tsx scripts/e2e-settings.ts --name settings [--only <step text>]   # screenshots in parity-reports/e2e-settings/
pnpm live:down --name settings --drop
pnpm tsx scripts/gen-settings-schema.ts [--check]    # needs OASIS_BACKEND_PATH (default ../backend)
```

`scripts/e2e-settings.ts` reads and writes through a second person's session (a Super Admin) so the page under test keeps
the per-user rate limit (300 requests a minute) and the event-stream limit (30 connects a minute) to itself.

## Verification

| What                                                                        | Command                                                                                                                                                          |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| everything fast (assert:react, design:verify, dc:check, lint, tsc, vitest)  | `pnpm check`                                                                                                                                                     |
| the port against the original class, step by step (storage, toasts, timers) | `pnpm exec vitest run src/screens/settings/Logic.diff.test.ts`                                                                                                   |
| the pure helpers against the original methods                               | `pnpm exec vitest run src/lib/settings`                                                                                                                          |
| the template roots and handlers exist; no loader                            | `pnpm exec vitest run src/screens/settings/wiring.test.ts`                                                                                                       |
| the mapping against captured API responses                                  | `pnpm exec vitest run src/screens/settings/live/mapping.test.ts`                                                                                                 |
| LiveData over a fake API                                                    | `pnpm exec vitest run src/screens/settings/live/LiveData.test.ts`                                                                                                |
| the view model on LiveData                                                  | `pnpm exec vitest run src/screens/settings/Logic.live.test.ts`                                                                                                   |
| pixels, DOM, styles, renderVals, console in Chromium (fixture build)        | `pnpm build:parity`, `NEXT_PUBLIC_PARITY=1 DIST_DIR=.next-parity pnpm exec next start -p 3101`, `pnpm parity --screen settings --port-url http://127.0.0.1:3101` |
| the whole screen against the real API and database                          | `pnpm tsx scripts/e2e-settings.ts --name settings`                                                                                                               |

`Logic.diff.test.ts` runs every scenario once on the original class and once on the port, with the frozen clock (2026-06-13
10:36 America/New_York) and the same storage: both themes and all sections, every `oasis-*` key set and garbage and
unavailable, every handler of hours, closures, emergency, employees, roles, VIP, arrival and services, the toast timer, the
deep link, and 36 seeded random walks (100 steps each, including replays of stale closures) that compare `renderVals()`
(values and key order), the whole state and localStorage after every step.

## Known limits and open items

- Per-section parity scenarios cover initial render, section switching, theme and the deep link; the mutation flows are proved by
  the differential test, not by the browser harness.
- A hash-only change on `/settings` (`#emergency` from within the page) does not switch the section, as in the design;
  a link from another page is a full load and does. Signing in through `/login?next=/settings#emergency` loses the fragment
  (the server never sees it).
- A checklist edit waits 600 ms; closing the tab inside that window sends it on unmount (`flush`), which a browser may cancel.
- The emergency preview needs `set.emergency`; the affected list is empty for anyone else (they see the locked card).
- The emergency strip is read when the section loads and after a change; it does not tick.
- The employee list refreshes elsewhere only because the backend now announces employee changes (branch `ws/d7-be`).
- A custom role cannot be renamed (the design has no field); the server names it.
- Invite resend, password reset links and the Integrations screen (`set.billing`) have no surface in the design and none here.
