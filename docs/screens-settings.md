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
| Oasis AI assistant      | any signed-in person (the tabs: `set.assistant`; Conversations also `cli.view`) | `set.assistant`: `Your role can’t change the assistant settings` (live only, DV-705..715) |

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
| save                    | `PUT /settings/assistant` `{changed fields, version}`                    | `set.assistant` (was `set.hours`, DV-715); only the fields that differ from the server; FAQ lines trimmed; `capabilities` and `behavior` whole |
| change saved elsewhere  | the stream refetches the view                                            | fields nobody touched here follow it, edited fields stay (Working hours' rule, DV-309)                    |
| 412 `VERSION_CONFLICT`  | `command()` refetches the view and toasts the server's words             | the edits stay over the new version; the next Save sends them with it                                    |
| 422                     | `errors[].path` (`allowlist.1`, `faq.0.a`, `staffPauseHours`, `body.stage`) | under the field and in the save bar; no toast                                                          |
| before asking           | numbers: 10-digit US/Canadian, once, 50 at most; FAQ: both lines, 500 characters, each question once, 40 pairs | inline, no request                                                        |

Owner-facing words: `Oasis AI is off: texts reach the team as today.` (+ `It is also off on the server for now; you can set
everything up here meanwhile.` while `AI_ENABLED` is off, or `Oasis AI is switched on here but still off on the server, so it
answers nobody yet.`), `Oasis AI is answering texts.`; stages `Test numbers` (only the listed numbers; start with your own phones),
`Clients` (every client on file; unknown numbers reach the team as today), `Everyone` (new numbers too; it asks a new texter's
name and adds them as a client); `Pause after a staff reply` (1 to 72 hours); `Book, move and cancel by text` (each change waits
for the client's 4-digit reply; off: a booking link instead). A role without `set.assistant` reads the section; any change toasts
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

## Settings → Oasis AI: tabs (live only; wave K2d, backend ADR 0174; DEVIATIONS.md DV-708 to DV-715)

The section gets five tabs (`live.asst.tabs`, the Prices & memberships segment control): **Status & switches** (the section
above without the Q&A), **Knowledge**, **Practice**, **Limits & tone** and **Conversations**. `/settings#assistant/<tab>`
opens a tab and the open tab is kept in the address (`history.replaceState`); `#assistant` is Status & switches. A tab reads
nothing until it is opened. The fields of the section's working copy (Status, the Q&A shown in Knowledge, Limits & tone)
share the section's save bar; knowledge entries, PDFs and corrections save one at a time.

```
src/lib/settings/assistant.ts            + Limits & tone: capability words, the "Answer questions only" preset, tones with
                                           their static example replies, lengths, Spanish modes, the three lists' checks,
                                           style notes and sign-off checks, ALWAYS_ON, LIMITS_APPLIED
src/lib/settings/assistant-knowledge.ts  meter, budget refusal, a browser copy of the server's warnings (sanitize.ts) and
                                           their words, PDF checks, SHA-256 (WebCrypto), a document's status chip and error
src/lib/settings/assistant-practice.ts   link markers, badges, a turn's note, banners, persona line, review words
src/data/ports/assistant-knowledge-api.ts  /assistant/knowledge and /documents (+ xhrUpload: presigned POST with progress)
src/data/ports/assistant-practice-api.ts   /assistant/practice, /assistant/corrections, /assistant/conversations
src/screens/settings/live/assistant.ts   the section: tabs, working copy (+ capabilities, behavior), save; owns the tabs
src/screens/settings/live/assistant-{knowledge,practice,review,limits,correction,ctx}.ts   the tabs and their dialog
src/screens/settings/live/assistant-testkit.ts  stateful fakes of api-spec 15.6c–f, manual timers (tests only)
design-patches/live/partials/settings-assistant.html (the tab strip and Status) + settings-assistant-{knowledge,practice,
  limits,conversations,correction}.html (included by it; no new op in settings.patch.json)
scripts/e2e-assistant.ts (phase `tabs`), scripts/e2e-assistant-stack.sh
```

| Tab | Reads | Writes (permission) | What is on screen |
| --- | --- | --- | --- |
| Knowledge | `GET /assistant/knowledge` (`['settings','assistant_knowledge']`, refetched on `settings.changed {section: assistant_knowledge}` and, because the Q&A counts, on `{section: assistant}`; every 3 s while a PDF is being read) | `POST /assistant/knowledge`, `PUT/DELETE /assistant/knowledge/:id` (`version`), `POST …/documents/presign`, the presigned POST, `POST …/documents/:id/complete`, `POST …/documents/:id/extract`, `DELETE …/documents/:id`, `GET …/documents/:id/file` (`set.assistant`) | the meter (`12,400 of 20,000 characters`, parts, room left); Notes (on/off, preview, Edit, Delete asked inline; `New note`); the Q&A; PDFs (drop box, upload rows with progress, status chips, errors in the server's words, Review / Open, Try again, Download, Delete); Corrections; the editor dialog (name, question for a correction, text with its count, warnings while typing, `I read this text and it is right` and the instruction box for a PDF, Save draft / Save / Save and turn on, Save as a draft after a 422 `KNOWLEDGE_BUDGET`) |
| Practice | `GET /assistant/practice/sessions` (`['settings','assistant_practice']`), `GET …/sessions/:id` (every 2 s while a turn runs; `assistant.practice.turn` on the notifications channel refetches them, src/data/realtime/invalidation.ts), `GET /customers?q=` for a client on file (`cli.view`) | `POST …/sessions`, `DELETE …/sessions/:id`, `POST …/sessions/:id/turns` (Idempotency-Key), `POST /assistant/practice/turns/:id/rerun`, `POST /assistant/corrections` (`set.assistant`) | banners (practice off, budget used, booking by text or links off on the server), my chats and the day's spend, the persona picker, the chat (bubbles, link chips, badges, `It would also text:`, `Oasis AI is writing…`, Correct this answer, Try again, `After your correction`), the composer (`n / 640`) |
| Limits & tone | the section's view (`capabilities`, `behavior`) | the section's save (`set.assistant`) | capability switches + Book, move and cancel by text, Answer questions only, tone cards with example replies, Reply length, Texts in Spanish, Words to avoid / Topics to avoid / Always hand to the team, style notes, sign-off, Always on; the note `Oasis AI starts following these limits and this tone with its next update.` while `LIMITS_APPLIED` is false |
| Conversations | `GET /assistant/conversations?days&filter&limit&cursor`, `GET …/:id` (`set.assistant` + `cli.view`) | `POST /assistant/corrections` (source `live`) | days and filter chips, the list (first name, `•••0142`, chips), Show more, one chat in plain words, This answer was wrong |

Rules:

- **Permissions.** Every tab but Status needs `set.assistant` (Conversations and a client persona also `cli.view`): without
  it the tab is a locked card in plain words and nothing is read; a write is the toast and no request. The live Roles &
  permissions matrix and the drawer's effective permissions show `Oasis AI assistant` last in the Settings group (28 rows;
  the fixture and parity builds keep the design's 27; live parity gives the oracle the same row, `L-settings-74`).
- **The contract routes.** In this backend wave practice, corrections and the review answer 501 `NOT_BUILT`: the tab says
  `Coming soon: …` in plain words (no toast, no failed card). Their schemas are final, so the tabs work unchanged once
  wave K2c builds the routes; the e2e runs them against fixtures served for those routes.
- **Knowledge entries.** Each save sends only what changed with the entry's version. A 412 keeps the editor and says
  `Someone else changed this meanwhile, so nothing was saved. Their version is on the list now; save again to keep yours.`
  (the next Save carries the server's version, so overwriting is the owner's deliberate choice). A 422 `KNOWLEDGE_BUDGET`
  names how many characters are over and offers `Save as a draft`; nothing is ever cut. Turning an unread PDF on from the
  list opens its review instead. The warnings shown are the server's while the text is as saved and the browser's copy
  of the same detectors once it is edited (the server computes them again on save). The copy's order patterns are the
  server's character for character (`INSTRUCTION_PATTERNS`, pinned by `src/lib/settings/__fixtures__/knowledge-instruction-lines.json`
  and, with `OASIS_BACKEND_PATH` set, against the backend's `sanitize.ts`). At most 50 warnings are kept, but order-like
  lines, markup and hidden text are always kept, and the 12 listed put order-like lines first. When a save gets 422
  `KNOWLEDGE_NEEDS_REVIEW` with `confirmInstructions` the box shows anyway (`Some lines read like orders to Oasis AI. …`;
  `Tick the box about lines that read like orders first.`), so the owner is never asked for a box that is not there.
- **PDFs.** Checked in the browser (PDF, 10 MB), hashed (WebCrypto SHA-256) so a file already in the knowledge is refused
  before any byte is sent (409 `DUPLICATE_DOCUMENT`: `“guide.pdf” is already in your knowledge.`), uploaded to the presigned
  POST with XMLHttpRequest (fields first, then the file; `Uploading 45%`), completed (202: `Reading the PDF…`; 200 `failed`:
  the server's sentence). The drop box is an invisible full-size file input over a dashed box: dropping works without drop
  handlers.
- **Practice.** Sending waits for the 202; the turn runs as a job; the tab reads the session every 2 s while one runs and
  stops when none does or the tab is closed. Refusals in words: `PRACTICE_BUSY`, `PRACTICE_OFF`, `PRACTICE_BUDGET` (429).
  `Try again` appears under a turn corrected from this page and re-runs it as an alternate turn.
- **Corrections.** `What the client asked` is prefilled with the client's words and may be made general; the wrong reply
  is shown to the owner only (the server loads it from the turn itself). 409 `CORRECTION_EXISTS` offers `Replace the
  earlier one` (`replaceEntryId`).
- **Limits & tone** are saved and checked now (`capabilities` and `behavior` as whole objects; client checks: list lengths,
  repeats, a topic in both lists, style notes 400, sign-off 24 with no amount, number, link or promise) but the turn applies
  them from the policy wave on: flip `LIMITS_APPLIED` in `src/lib/settings/assistant.ts` with that wave.

Running the browser check on the test server (it brings a stack of the backend up with the worker and AI_ENABLED, runs the
settings and tabs phases, and drops the stack; screenshots in `parity-reports/e2e-assistant/`, light and dark):

```bash
oasis-remote ~/oasis/wt/k-asst-core -- true
oasis-remote ~/oasis/wt/k-asst-dash --pull parity-reports/e2e-assistant -- 'bash scripts/e2e-assistant-stack.sh /home/ec2-user/oasis/wt/k-asst-core'
```

Tests: `src/lib/settings/assistant{,-knowledge,-practice}.test.ts`, `src/data/ports/assistant-ai-ports.test.ts` (routes and
the upload with a fake XHR), `src/screens/settings/live/assistant.test.ts` (tabs, Limits & tone, the Q&A budget),
`assistant-knowledge.test.ts`, `assistant-practice.test.ts` (practice polling and the event mapping, corrections, the
review), `assistant.render.test.ts` and `assistant-tabs.render.test.ts` (the live template on every tab).

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
| No-show and late-cancel fees | `feeToggle`, `feeNoShow`, `feeLate`, `feeSave` | `PUT /settings/card-fees {enabled, noShowCents, lateCancelCents, version}` (dollars and cents, `25` or `25.50`, shown and sent back exact; $0–$1,000; on needs a fee) |
| When a membership payment fails | `grace`, `cancel`, `policyText`, `policySave` | `PUT /settings/billing/renewal-policy {graceDays, cancelDays, version}` (0–60, 1–90, cancel after grace) |
| Notice before a price change | `noticeDays`, `noticeSave` | `PUT /settings/billing/price-change-notice {days, version}` (0–90) |
| Card consent | `consentVersion`, `consentText`, `consentPurposes` | read only |

Every form is a draft over the server's copy and version (lib/settings/drafts.ts): a newer copy rebases it, a 412 keeps the
edit with the usual message, a 422 is said under the block. Memberships (DV-909): each price cell's state comes from
`priceSquareText(squareState, squareError)` with the error as the tooltip; `Move members` (only with `set.billing`) shows
`moveMembersPreview` (the backend's `membership_price_change` text with the tier's lowest price, the date in the backend's
`ccc, LLL d`, the notice from `priceChangeNotice.days`; until it has loaded the box reads `Reading the notice period…` and nothing is sent) and sends `POST /catalog/tiers/:key/move-members {notice}`.

Tests: `src/lib/settings/billing.test.ts`, `src/screens/settings/live/billing.test.ts` (the section, the forms, permissions,
Move members, the live template).

## Shop floor: Kiosk and Team activity (live only; ADR 0180 and its 2026-10-14 amendment; DEVIATIONS DV-1009..DV-1012)

No nav entry (DV-1009): the design's nav is full at 1000 px (DV-322), and a group under it turned the nav into a scrolling
box, which changed how Chromium drew the whole screen (live parity: anti-aliasing pixels on every Settings step). The two
sections open from the user menu on every screen (`Kiosk…` → `/settings#kiosk` for `team.roles`; `Team
activity…` → `/settings#activity` for `team.edit`; the hash is followed while Settings is open too), and a `Kiosk` / `Team
activity` tab strip moves between them for a person who may open both. Both sections are live extras (`live/extras.ts` delegates to
`live/kiosk.ts` and `live/team-activity.ts`; pure helpers in `src/lib/settings/kiosk.ts`; endpoints in
`src/data/ports/kiosk-api.ts`, typed from the generated `schema.d.ts`).

**Kiosk** (`GET /kiosk` under `['settings', 'kiosk', 'overview']`, refetched on `settings.changed {section: kiosk |
employees}`; locked card without `team.roles`):

Left column:

- `Kiosk mode` switch → `PUT /kiosk/settings {enabled, version}` (on by default: the sign-in page is the PIN keypad); off
  ends every kiosk session; switched on the tablet itself, the manager there is signed out and the page goes to the keypad.
- `Shop network` (`PINs work only from the shop’s internet connection.`): `Your connection: 73.12.4.9` (`yourAddress`, the
  address the server sees). On a shop network: `This is the shop’s network. PINs work here.` Otherwise, **for a Super Admin
  only** (`canManageNetworks`): an optional name (`Name (optional), like Shop Wi-Fi`, ≤ 40) and `This is the shop’s network`
  → `POST /kiosk/networks {confirmAddress: <the address shown>, label}`, with `Do this from a phone or computer connected to
  the shop Wi-Fi — not mobile data. Every device on the shop Wi-Fi shares this address, so it doesn’t have to be the
  tablet.` and `Turn off any VPN or iCloud Private Relay on that device first.` (runbook section 11: the server cannot tell
  such an address from the shop's). A 409 `KIOSK_ADDRESS_CHANGED` (the phone left the Wi-Fi between reading and pressing) reads `Your connection
  changed to 172.56.1.9. Check you’re on the shop Wi-Fi, then press the button again.` and the page reads `GET /kiosk` again,
  so the line shows the new address (the next press confirms that one). A manager who is not a Super Admin sees the section
  read only: `Only a Super Admin can change the shop network` (and `This connection isn’t a shop network.` when it isn't).
  The networks: name (`Shop network` without one), `73.12.4.9 · added Oct 13 by Amara O. · last used Oct 14, 8:02 AM`, the
  address's wrong-PIN state (`3 wrong PINs`, `Locked out · too many wrong PINs`) with `Clear lockout` (any manager; `POST
  /kiosk/networks/:id/clear-lockout`), `Remove` (Super Admin; asks `Remove this network? PINs stop working from it.`;
  `DELETE /kiosk/networks/:id`). Without any: `No shop network yet. PINs don’t work anywhere until you add one.` (`… until a
  Super Admin adds one.` for a manager).
- `PIN tried from a new network` (only when there are some): a try from a known shop browser reads `Front desk tablet tried
  from a new network — your internet provider probably changed the shop’s address`; one from an unknown browser `A PIN was
  tried from a new network` with the warning `Not from a shop browser — only add it if you know this address is the shop’s`;
  each `98.4.2.1 · 3 tries · last Oct 14, 8:02 AM`. `Add this network` (Super Admin; at once for a known browser, after
  `Add 203.0.113.50 as a shop network? Anyone on it can then use a PIN.` for an unknown one) → `POST /kiosk/networks
  {address}`. A tablet's try gets here even when its keypad loaded after the address changed: a browser that once opened the
  kiosk sends one PIN per page from a new network (the server never checks it), other browsers send none (docs/auth-ui.md,
  "One try from a new network"). After `Add this network` the tablet's open keypad reads the status again within 30 s and
  says `Ready — PINs work here now.` (no reload).
- `Recent kiosk events` from the same read; an unlock names whose PIN opened it (`Oct 14, 8:02 AM · Unlocked · Front desk
  tablet · Opened by Marco R.`).

Right column:

- `Staff PINs`: a row per active or invited employee: name, `PIN set Oct 1 by Rafael M.` / `No PIN yet` (never the PIN;
  `Invited · …`, `· hidden on the kiosk`) and the `Shows on the kiosk` switch (`PUT /kiosk/staff/:id {listed}`). `Set PIN` /
  `Change PIN`: two masked 8-digit boxes (digits only), checked here first (8 digits, not starting with 0218, the same twice),
  then `PUT /kiosk/staff/:id/pin {pin}`; the server's rule (422 `KIOSK_PIN_REJECTED`, `errors[0].message`, e.g. `Choose
  another PIN.`) shows under the row. `Generate` → `{generate: true}`: `The new PIN for Marco`, the PIN in two halves, `Write
  it down now and give it to them. It isn’t shown again.`, `Copy` (`Copied`, or `This browser didn’t allow copying. Write it
  down instead.`) and `Done`, after which it is gone. `Remove PIN` asks `Remove Marco’s PIN? It stops opening the kiosk right
  away.` → `DELETE /kiosk/staff/:id/pin`.
- `Browsers at the shop` (`A browser joins this list the first time a PIN opens it at the shop.`; removed ones are not
  listed): state (`Unlocked · locks 9:00 PM` with `Opened by Marco R.`, `Locked`, `Locked · 4 wrong PINs`, `Locked out · too
  many wrong PINs`), `Last seen Oct 13, 2:14 PM · 100.64.1.7 · Chrome on Android`; `Rename` (`PATCH` with the version),
  `Lock`, `Clear lockout`, `Remove` (asks `Remove this browser? It locks now.`; `DELETE`); `Lock all kiosks` (asks first;
  `POST /kiosk/lock-all`, `2 kiosks locked`).

The shop code, `This tablet` and `Make this a kiosk` are gone (amendment: no registration step).

Every write goes through the extras' `run()` (Idempotency-Key, the "Your role can’t …" toast, the refetch; 422/409 inline,
412 "changed meanwhile").

**Team activity** (`team.edit`; reads only): chips `Today` `Yesterday` `This week` `Last week` (Sunday to Saturday, as the
Operations calendar) `Custom` (two dates, at most 31 days, checked before the read); `GET /reports/employee-activity?from&to`
under `['settings', 'activity', …]`: a row per employee with `Checked in`, `In bay`, `Finished`, `Picked up`, `Avg bay time`,
`Payments` (`2 · $90.00`; the count only, and a note, without `pay.reports`), `Texts`, `Bookings` (walk-ins included). A row
opens the person's days, the cars they touched (`?employeeId`: each step with who did it and a `Kiosk` / `Signed in` tag) and
their timeline (`…/:employeeId/events`, `Show more` pages by cursor). Until the backend builds the report (wave K2b) it answers
501 `NOT_BUILT` and the section reads `Team activity isn’t ready yet.`; another failure offers `Try again`.

Tests: `src/lib/settings/kiosk.test.ts`, `src/screens/settings/live/shopfloor.test.ts` (fixtures in
`shopfloor-fixtures.ts`; Super Admin and manager views of Shop network, the 409 path, Staff PINs), `shopfloor.render.test.ts`
(the live template), end to end `pnpm e2e:kiosk`.

## Square item library and the sales tax (live only; ADR 0172, ADR 0173, wave K3; DEVIATIONS DV-911..DV-914)

```
src/data/ports/settings-api.ts       saveSalesTax, squareItems, syncSquareItems, setSquareItemsTax, archiveSquareItems
src/lib/settings/billing.ts          the sales tax form's check (the server's parser, lib/payments/cents.ts parseTaxPercent),
                                     the rounding in words, the `Square item library` switch line, the `Sales tax` check label
src/lib/settings/square-items.ts     pure: the item sync's state, the tax check, the shop's taxes, counts, preview, Sync now's
                                     answer, the Prices by size dots and the Catalog word
src/screens/settings/live/billing.ts BillingSection: the `Sales tax` draft and the `Square item library` block and its writes
src/screens/settings/live/pricing.ts the cells' dots and the row's Square state (DV-912)
src/screens/settings/live/extras.ts  the item library read (key ['settings','squareItems'], set.billing, while the tab is
                                     open) and the Catalog list's `archived in Square` (DV-913)
design-patches/live/partials/settings-billing-tax.html, settings-billing-items.html (included by settings-billing.html),
settings-prices.html (the dot)
```

| Block | Values (`live.bill.*`) | Write |
| --- | --- | --- |
| Sales tax (right column, first) | `tax.percent`, `tax.setPercent`, `tax.rounding`, `tax.dirty`, `tax.error`, `tax.save`, `tax.discard` | `PUT /settings/billing/sales-tax {percent, version}` (the rate as typed, checked here with the server's rule first; `version` is `salesTax.version`, the version of `tax.rate_dbp`; `rounding` is never sent: the rollout sets it with 6.625%). Toast `Sales tax saved · 6.625% on new invoices` |
| Square item library (left column, under Square) | `items.headline`, `items.tax`, `items.rounding`, `items.warnings`, `items.candidates[]` (`use`), `items.taxModes[]`, `items.counts` (`hasCounts`), `items.runs`, `items.preview`, `items.failures`, `items.lastError`, `items.changed`, `items.runFailures`, `items.sync`, `items.canArchive`, `items.archiveAsk`, `items.archive`; `items.loading` / `items.failed` / `items.retry` while it is not here | `POST /integrations/square/items/sync` (with the sync off it is the read-only preview; the toast is the answer: `Preview · Would make …`, `Synced with Square · 3 made · 1 put back`, `Not synced: <reason>`); `PUT /integrations/square/items/tax {mode, squareTaxId?, version}` (`Use this tax` on a matching tax of the shop, `Automatic`, `Oasis’s own tax`); `POST /integrations/square/items/archive-all` after a confirm, offered only with writes on and the item sync off (the only state the server allows it in) |

Every item write refetches the item library and the catalog (the dots); the item library has no event of its own, so the
block shows what Oasis last recorded (the jobs run every 5 minutes and at 4:40 AM). The counts show once Oasis has items in
Square: in watch-only mode every service would read "waiting", and the preview says what the sync would do instead. The
tax check's words are the server's (backend `src/modules/catalog/square/tax.ts`).

Prices by size (DV-912): GET /catalog sends `prices[].square {state, cells {<size key>: synced|pending|failed|hidden},
error}` only while `SQUARE_WRITES_ENABLED` and `SQUARE_ITEMS_SYNC_ENABLED` are on, to `set.services` holders; then each
active size's cell gets a dot (`cellDot`), the failure's reason as its tooltip, and the row's line ends with the item's
state (`rowSquareText`; key `""`, a service sold at one price, has only that). Without the block the grid is as before.

The sales tax rate also changes Payments and the operations file (DV-213): the tax line reads `Tax (6.625%)` from the
invoice's `taxDbp`, and the sheet previews round with its `taxRounding` (`src/lib/payments/cents.ts`, docs/screens-payments-live.md).

Tests: `src/lib/settings/square-items.test.ts`, `src/lib/settings/billing.test.ts`, `src/screens/settings/live/billing-items.test.ts`
(the view model with the fake API and the live template), `src/data/ports/billing-ports.test.ts` (verbs, paths, bodies, keys).
End to end: `scripts/e2e-items-stack.sh` (`pnpm e2e:items`, below).
