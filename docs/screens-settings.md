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
| Catalog, Categories     | any signed-in person | `set.services` (live only, DV-317, DV-318)                                                          |
| Vehicle sizes, Prices by size, Memberships | any signed-in person | `set.services` (live only, DV-322..DV-326)                                     |
| Reminders & texts       | any signed-in person | `set.hours`: `Your role can’t change hours and closures` (live only, DV-319)                        |

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

## Settings → Oasis AI assistant (live only; W3g, ADR 0160; DEVIATIONS.md DV-705 to DV-707)

A section the design does not have, built from its own primitives (nav button, Arrival strip, VIP toggles, segments and
stepper, the VIP clients list and input, the emergency textarea, the Working hours save bar). The fixture and parity builds
never show it (`SectionKey` gains `assistant`, reachable only through the live patches and `#assistant` in the live data).

```
src/lib/settings/assistant.ts              pure: stages and their words, numbers (E.164 <-> "(201) 555-0142"), FAQ checks, changed fields, status
src/data/ports/assistant-api.ts            GET/PUT /settings/assistant (types from src/data/http/schema.d.ts)
src/screens/settings/live/assistant.ts     AssistantSection: its read, the working copy, the save; vals() = what live.asst.* binds
src/screens/settings/live/LiveData.ts      builds the section when Screen.tsx passes `assistantApi` (its query: ['settings', 'assistant'])
src/screens/settings/Logic.ts              gate('assistant'), live.secAssistant, live.asst (+ go, navStyle, dirty), #assistant
design-patches/live/partials/settings-nav-assistant.html, settings-assistant.html, settings-assistant-save.html (after tpl 72, 415, 444)
  nav after Packages: Catalog, Categories, then the Texting group (a later insert-after lands nearer its anchor,
  so the assistant ops come before the Catalog ones in settings.patch.json)
```

| What                    | API                                                                       | Rule                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| read                    | `GET /settings/assistant` (any signed-in person), refetched on `settings.changed {section: assistant}` | loading and failed cards like the other sections; the nav `ON` badge is `active` (server switch and section) |
| save                    | `PUT /settings/assistant` `{changed fields, version}`                    | `set.hours`; only the fields that differ from the server; FAQ lines trimmed                               |
| change saved elsewhere  | the stream refetches the view                                            | fields nobody touched here follow it, edited fields stay (Working hours' rule, DV-309)                    |
| 412 `VERSION_CONFLICT`  | `command()` refetches the view and toasts the server's words             | the edits stay over the new version; the next Save sends them with it                                    |
| 422                     | `errors[].path` (`allowlist.1`, `faq.0.a`, `staffPauseHours`, `body.stage`) | under the field and in the save bar; no toast                                                          |
| before asking           | numbers: 10-digit US/Canadian, once, 50 at most; FAQ: both lines, 500 characters, each question once, 40 pairs | inline, no request                                                        |

Owner-facing words: `Oasis AI is off: texts reach the team as today.` (+ `It is also off on the server for now; you can set
everything up here meanwhile.` while `AI_ENABLED` is off, or `Oasis AI is switched on here but still off on the server, so it
answers nobody yet.`), `Oasis AI is answering texts.`; stages `Test numbers` (only the listed numbers; start with your own phones),
`Clients` (every client on file; unknown numbers reach the team as today), `Everyone` (new numbers too; it asks a new texter's
name and adds them as a client); `Pause after a staff reply` (1 to 72 hours); `Book, move and cancel by text` (each change waits
for the client's 4-digit reply; off: a booking link instead). A role without `set.hours` reads the section; any change toasts
`Your role can’t change the assistant settings` and sends nothing.

Running the browser check (it changes data; reseed before running it again):

```bash
export AI_ENABLED=true ALLOW_DEV_ENDPOINTS=true SMS_ALLOWLIST=<the seeded numbers: "Running it" in screens-operations-live.md>
pnpm live:up --name asst --api-port 4031 --web-port 3231 --profile design,parity-ops \
     --freeze 2026-06-13T10:36:00-04:00 --backend ~/oasis/wt/ai-w3-dashapi
pnpm e2e:assistant --name asst          # screenshots in parity-reports/e2e-assistant/
pnpm live:down --name asst --drop
```

It writes three fixtures straight to the stack's database because nothing in this backend creates them yet: a PIN row and a
30-day trust for Priya Nair (the link pages are wave 3) and one text with `sender_kind = 'ai'` (the assistant's turn is wave 3).

## Catalog, Categories and Reminders & texts (live only; ADR 0160 plan A, I, K; DV-317..DV-321)

Three sections the design does not have. They exist only in the live variant: the nav buttons and the sections are live
template patches (`design-patches/live/partials/settings-{nav-catalog,nav-reminders,catalog,categories,reminders,
reminders-bar,services-price-note,extra-sections}.html`), and the fixture and parity builds never open them (`SectionKey`
gains `catalog`, `categories`, `reminders`; nothing in the design's view model state changes, so the differential test
still compares the port with the original class key by key).

```
src/screens/settings/live/extras.ts        SettingsExtras: reads, drafts, writes and the live.* values of the three sections
src/screens/settings/live/extras-testkit.ts  GET /catalog and /settings/reminders shapes and a stateful fake of their endpoints
src/lib/settings/catalog.ts                dollars <-> cents, the PUT bodies, the server's limits in plain words, keys from names
src/lib/settings/reminders.ts              the reminders draft, its PUT body, offset and delay labels, the steppers' bounds
src/lib/categories.ts                      chips, swatches, labels and the board filter rule (shared with Operations, Payments)
```

`SettingsExtras` is created by `Screen.tsx` in the live variant and handed to `createSettingsLogic(data, extras)`. The view
model binds it on mount (section, navigation, toast, re-render) and spreads `extras.vals(section, gate, dark)` into `live`;
`gate()` asks it whether a section's read is there (loading card, failed card with `Try again`). Its drafts live in the
extras object, never in `SettingsLogic.state`.

| Section | Reads | Writes (permission) | What is on screen |
| --- | --- | --- | --- |
| Catalog | `GET /catalog` (`['settings','catalog']`) | `PUT /catalog/services/:id` (the six website fields + version; no price since ADR 0170) (`set.services`) | the note that prices are set per vehicle size in Prices by size and what members get in Memberships; Packages / Add-ons list with category swatch, the starting price by size (`from $40 · 2 sizes not set`, `No prices yet · books at $38`, `quote only`), `hidden`, `unsaved`; the selected service's website name, description, category chips, a `Prices by vehicle size` box with that line and `Edit prices` (opens Prices by size with the row outlined), shown on the website, quote only, order |
| Categories | the same read | `POST`, `PATCH /:key` (label, colour, sort, active; version), `DELETE /:key` (version) (`set.services`) | one row per category: swatch, name, `#RRGGBB` box, eight swatches, order ↑ ↓, on/off, remove for custom ones, key, built in and how many active services use it; `+ Add category` (the key is made from the name; `mixed` and taken names refused) |
| Reminders & texts | `GET /settings/reminders` (`['settings','reminders']`); `POST /settings/reminders/preview` with the draft, 300 ms after the last edit | `PUT /settings/reminders` (all three groups + version) (`set.hours`) | quiet hours; reminder offsets (≤ 5) and add chips, Ask to confirm, Review request; a preparation line per active category (≤ 160 characters); the status texts with their waits; the lead follow-up; the preview of every text with its timing, `OFF` when off, segments and encoding; the Save bar of the hours section (`Unsaved changes to reminders and texts`) |

| Vehicle sizes | the same read | `POST /catalog/vehicle-classes`, `PATCH /:key` (label, sort, active; version), `DELETE /:key` (version) (`set.services`) | the note; one row per size in size order: name box (a draft, Save / Discard, Enter saves), ↑ ↓, on/off, ✕, `Key compact_car · 3 services priced` (`· off: not offered, its prices are kept`); `+ Add size` (key from the name, up to 12); a size in use cannot be removed: `Compact car is in use (9 prices, 1 membership price), so it can’t be removed. Turn it off instead.` (409 `CLASS_IN_USE` counts) |
| Prices by size | the same read | `PUT /catalog/prices` (changed rows with their service's version, changed cells only), `PUT /catalog/guest-fee` (cents, collect, version) (`set.services`) | the note; `N prices not set` (follows the typing; quote-only rows not counted); the grid: rows = packages then add-ons grouped by category, columns = the sizes that are on, whole dollars (rounded half up when the stored price has cents; an untouched cell is never sent, so its cents stay, and in a from–to cell an untouched box sends its stored cents); a draft covers every size, on or off (a size turned on meanwhile shows its kept price; an edit at a size turned off is kept, sent, and the row reads `also changed: Truck (off)`), `—` when not set, tint rows and rows holding a range from–to; the save bar `N services changed` · Discard · Save prices; `Booking fee for guests` (whole dollars $0..$1,000, At the counter / By payment link, Save fee) |
| Memberships | the same read | `POST /catalog/tiers`, `PUT /catalog/tiers/:key` (the whole tier + version; order re-sends the tier whole), `DELETE /catalog/tiers/:key` (never sold only), `PUT /catalog/tier-prices` (changed tiers with their priceVersion) (`set.services`) | the note (plan size, size difference paid at the shop, % off, no price = not sold online); the tier list and `+ Add tier`; the editor (name, badge colour, On / On the website / VIP booking, Member % off with its example, Cars on one membership, perks, inclusions: name, on/off, Per month N / Unlimited / Every wash, the services it covers, Apply by itself; the Squarespace link kept until Square billing; ↑ ↓; ✕ when never sold; Save tier); `Monthly price by plan size`: tiers × sizes that are on, `Price version N`, each price's Square state read only (`Not synced yet` until wave Q3b syncs it); drafts cover every size as in Prices by size |

The three pricing sections share one nav button, `Prices & memberships` (after Categories), which opens Prices by size;
a tab strip over them (`Prices by size`, `Memberships`, `Vehicle sizes`; `live.pricingTabs`) switches between them and the
nav button stays lit (three nav buttons would push the nav past a 1000 px screen next to the Texting group, DV-322).

Prices by size and Memberships (ADR 0170, `src/screens/settings/live/{pricing,memberships,ui}.ts`, the pure halves in
`src/lib/settings/{sizes,tiers}.ts`). The grid keeps one draft per row (a map size → `{from, to}`), rebased like every
other draft; Save sends the changed rows only, each with the version of the copy its draft was rebased on, and the server
saves all or nothing. A 412 names the row from the server's `meta` (`Someone else changed the prices of Signature Hand Wash
meanwhile, so nothing was saved. Their change is on screen now with your edits kept: check and save again.`); the catalog
is read again, that row rebases (their cells show, the edited ones stay, `changed meanwhile` on the row) and the next Save
carries the new version. What is refused before sending names the service and size (`Exterior Hand Wash · Compact car:
enter whole dollars, like 40.`, `… set the price before the “up to” price.`, `… the “up to” price can’t be below the
price.`). A tier is saved whole (its inclusions keep their ids, new ones go without; one removed is deleted or turned off by
the server when credits name it); the monthly grid saves apart with each tier's `priceVersion` (append-only on the server:
each changed price is a new price version, members keep the price they joined at; a 412 names the tier). The member price
is never typed: the example under `Member % off` computes it like the server (whole dollars, half up, no % off on the size
difference). Square: the sync state of each tier price is shown read only (`squareState`, only to `set.services`
holders); nothing here talks to Square (wave Q3b/Q3e).

Rules: edits are drafts until Save (an edit back to the saved value is clean again); a person without the write
permission gets `Your role can’t …` on the first edit and nothing is sent; what the server would refuse is said in the
form before sending (a guest price below the member price, a checkout link off squarespace.com, a half-filled tint row, a
category colour that is not `#RRGGBB`, a prep line over 160 characters); the server's own 422/409 answer shows in the
form or the Save bar; on success the toast names what was saved and the event stream refreshes everything else (DV-321:
`services` and `catalog` events also refetch the catalog, `ops` and `payments`; `reviews`, `status_texts`, `leads` and
`catalog` refetch the reminders).

Someone else saving meanwhile (review W3h F1; `src/lib/settings/drafts.ts`): every draft (a service, a plan, the tint
table, the guest markup, a category's name and colour, the reminders) remembers the server copy and version it started
from. When the event stream brings a newer copy, the draft is rebased on it: the fields this person did not touch take
the newer values at once, the ones they changed stay, and a Save sends the version of the copy the draft was merged with.
A field both people changed keeps this person's value and the form says `Someone else changed this too meanwhile. …
Save keeps yours, Discard shows theirs.` A Save made before the newer copy arrived is refused by the server (412):
nothing is saved, the copy is read again and rebased the same way, and the form says `Someone else saved a change
meanwhile, so nothing was saved. Their change is on screen now with your edits kept: check and save again.` On/off, order
and remove of a category are sent at once on the copy on screen; a 412 there says `Someone else changed this meanwhile.
The screen shows their change now: try again.` A draft is never sent with a version newer than the copy it was built on,
so another person's change is never undone without the form saying so.

Packages & checklists gets one line (DV-320): `Prices are set by vehicle size in Prices by size: …` with `Open Prices by
size`. The plain service price (`price_cents`, what a booking charges until wave Q2 prices visits by size) is never edited
in the dashboard: the backend keeps it equal to the service's starting price by size (ADR 0170, `syncBookingPrices`); a
service without any price by size keeps its last one, and the Catalog line says so (`No prices yet · books at $38`).

e2e: `pnpm e2e:pricing --name <stack>` (`scripts/e2e-pricing.ts`) on a `design,website-catalog,pricing-defaults` stack of the
pricing backend renames a size and restores it, checks that Compact car (the $40 wash) cannot be removed, opens a row from
Catalog's `Edit prices`, fills a price and checks `GET /catalog` and `GET /public/catalog`'s starting price, sees a price saved
elsewhere arrive under an unsaved edit, turns Truck on from elsewhere while both grids hold unsaved edits (the prices Truck kept
while off show and survive both saves), saves the booking fee, edits Gold's Compact car monthly price (priceVersion moves, Square
state `pending` / `Not synced yet`, the public plan price follows) and Gold's % off (the public member starting price follows),
and screenshots the three sections in dark.

`pnpm e2e:catalog --name <stack>` (`scripts/e2e-catalog.ts`) on a `design,demo` stack edits each section in the page,
reloads and compares with the API, recolours Wash and checks the board's chips, makes an add-on of an open visit a tint
and checks the Mixed chips, counts and file header, filters the board and checks the Payments split.

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

## Billing & integrations, and Move members (live only; ADR 0171 wave Q3 dashapi; DEVIATIONS DV-908, DV-909)

```
src/data/ports/settings-api.ts       billing(), saveLinkTipping, saveRenewalPolicy, savePriceNotice, saveCardFees, testSquare,
                                     syncSquareCatalog, moveMembers (types from the full API schema)
src/lib/settings/billing.ts          pure: the Square row and checks in words, the switches, the forms' checks, Sync's answer,
                                     Move members' notice text and date, a price's Square state
src/screens/settings/live/billing.ts BillingSection: the panel's drafts (each block with its own version) and writes
src/screens/settings/live/memberships.ts  the price cells' Square state and Move members (MoveHooks: set.billing, the notice)
design-patches/live/partials/settings-billing.html (included by settings-extra-sections.html), settings-pricing-tabs.html (720 px)
```

Navigation: the fourth tab of the `Prices & memberships` nav button (`live.pricingTabs`), section key `billing`; the nav keeps
its height (DV-322). `/settings#billing` opens it. Reading needs `set.billing` (`GET /settings/billing`, key
`['settings','billing']`; without it the section is the locked card and nothing is read). The event stream refreshes it on
`settings.changed` of sections `booking`, `payments`, `memberships` and `fees` (`src/data/realtime/invalidation.ts`).

| Block | Values (`live.bill.*`) | Write |
| --- | --- | --- |
| Square | `sqHeadline`, `sqMissing`, `sqWarnings`, `sqLastTest`, `sqChecks`, `test`, `sync`, `syncNote` | `POST /integrations/square/test` (the checks show at once, `Square connection OK` / `… check(s) failed`); `POST /integrations/square/catalog/sync` (`Synced to Square · 5 made`, `Not synced: <reason>`) |
| How payments run | `switches[]` | read only (server environment) |
| Booking fee | `bookingFee`, `collectOpts`, `collectDirty`, `collectSave` | `PUT /catalog/guest-fee {cents (unchanged), collect, version}` (`set.services`; the amount is edited in Prices by size) |
| Tips on payment links | `tipTrack`, `tipToggle` | `PUT /settings/billing/link-tipping {enabled, version}` at once |
| No-show and late-cancel fees | `feeToggle`, `feeNoShow`, `feeLate`, `feeSave` | `PUT /settings/card-fees {enabled, noShowCents, lateCancelCents, version}` (whole dollars, $0–$1,000; on needs a fee) |
| When a membership payment fails | `grace`, `cancel`, `policyText`, `policySave` | `PUT /settings/billing/renewal-policy {graceDays, cancelDays, version}` (0–60, 1–90, cancel after grace) |
| Notice before a price change | `noticeDays`, `noticeSave` | `PUT /settings/billing/price-change-notice {days, version}` (0–90) |
| Card consent | `consentVersion`, `consentText`, `consentPurposes` | read only |

Every form is a draft over the server's copy and version (lib/settings/drafts.ts): a newer copy rebases it, a 412 keeps the
edit with the usual message, a 422 is said under the block. Memberships (DV-909): each price cell's state comes from
`priceSquareText(squareState, squareError)` with the error as the tooltip; `Move members` (only with `set.billing`) shows
`moveMembersPreview` (the backend's `membership_price_change` text with the tier's lowest price, the date in the backend's
`ccc, LLL d`, the notice from `priceChangeNotice.days`, else 30) and sends `POST /catalog/tiers/:key/move-members {notice}`.

Tests: `src/lib/settings/billing.test.ts`, `src/screens/settings/live/billing.test.ts` (the section, the forms, permissions,
Move members, the live template).
