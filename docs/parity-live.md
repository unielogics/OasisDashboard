# Live parity: the live screens against the original designs

`pnpm parity` proves that the **fixture build** renders exactly like the original bundles (docs/parity.md). This is the
second half of the proof: the **live build**, fed by the real API and a real Postgres, renders the same on equivalent
data. The original bundle stays the oracle on its own fixture state; the live side is the dashboard built with
`pnpm build:live` (the build people use), served against a stack from `pnpm live:up` that is seeded with the design's
data and frozen at the design's instant.

Covered today: **Payments** (seed profile `parity-pay`: the 105-invoice set) and **Settings**
(`design` and `parity-ops`, whose six remaining customers the emergency preview lists), 10 scenarios x 2 themes = 20 runs, 74 steps. **Operations is registered as pending**
(`tools/parity/live-registry.ts`): it is still a typed view model on fixtures, so `pnpm parity:live --screen operations`
refuses to run and the matrix does not list it.

## Running it

```bash
export PATH=$HOME/.local/bin:$PATH NODE_OPTIONS=--max-old-space-size=2048

# 1. a frozen stack with the design's data (migrates and seeds an isolated schema, builds the live dashboard)
pnpm live:up --name lparity --api-port 4024 --web-port 3224 --profile design,parity-ops,parity-pay \
  --freeze 2026-06-13T10:36:00-04:00 --backend ~/oasis/wt/d10-be

# 2. the proof
pnpm parity:live:all                                   # every live screen, scenario and theme (5.5 minutes on the shared box)
pnpm parity:live --screen payments --scenario filters --theme dark
pnpm parity:live --list                                # scenarios, and which screens are live or pending
pnpm parity:live:selftest --stack lparity --backend ~/oasis/wt/d10-be   # sensitivity (about 75 seconds)

# 3. clean up
pnpm live:down --name lparity --drop
```

Options of `pnpm parity:live`: `--stack <name>` (default `lparity`; the stack must have been started with `--freeze`),
`--screen`, `--scenario`, `--theme`, `--user <email>` (default `rafael@oasisautospa.com`, whose chip reads "Rafael M."
like the design), `--out <dir>` (default `parity-reports/live`), `--all`. Exit code 0 only when every step is clean or
only allow-listed, no allow-list entry is stale or over-broad (checked on `--all` runs, which see every scenario), and
no run errored. Everything is written to `parity-reports/live/<screen>/<scenario>/<theme>/<step>/` exactly like the
fixture harness (screenshots of both sides, diff images, `step.json`, `dom|style|vals.diff.json`), plus
`parity-reports/live/matrix.json` (the cells and how every entry was used).

The same heavy-command rules as the fixture harness apply: one Chromium at a time on the shared box (use the lock).

## How the live mode differs from the fixture mode

It reuses the five checks, the scenario catalogue, the allow-list engine and the artifact layout unchanged
(`tools/parity/harness.ts` gained a `{kind: 'live'}` port; `drivers.ts`, `browser.ts` and `collect.ts` gained opt-in
hooks, the fixture path is byte for byte the old behaviour: `pnpm parity:all` is still 38 runs, 152 steps, zero diff).
What is new is in `tools/parity/live.ts` (`LiveDriver`):

| Concern         | Fixture mode                                                  | Live mode                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network         | everything but the port origin is aborted                     | the dashboard origin (it proxies `/api`) and the API origin are allowed, everything else is aborted and reported                                                                                                                                                                                                                                                                                    |
| Session         | none                                                          | sign-in through the real `/login` page in a throwaway context (its event stream is blocked so it leaves nothing open), then only the cookies move to the run's context: a cookie jar per run. The theme is stored as the person's server preference first, because the live variant takes the theme from the server and `localStorage` is only its cache                                            |
| Clock           | `clock.install` + `pauseAt`, time only moves through `runFor` | `clock.setFixedTime`: `Date` is pinned to the stack's frozen instant (so `serverNow()` equals the server's frozen clock and "Today 10:36 AM" is stable) but **timers run**, because react-query batching, `requestAnimationFrame` and the event stream's back-off need them. `runFor(ms)` is a real wait                                                                                            |
| Ready           | `#dc-root[data-oasis-ready=1]` set by the parity build        | no hook exists in the live build: the harness waits for `#dc-root .sc-host`, for the event stream (`/api/v1/events`) to answer 200, then for **quiet**: no `/api/v1` request in flight, no loading text, and `#dc-root` unchanged for 900 ms of real time (longer than the screens' 250 ms debounce timers, so a request that is about to start is not missed)                                      |
| `renderVals`    | `window.__oasisParity.getVals()`                              | the logic instance is found through the React fiber behind `.sc-host` (as for the originals) and `serializeVals(renderVals())` is compared, including the live-only `live` root                                                                                                                                                                                                                     |
| Element pairing | by `data-dc-tpl` id                                           | by DOM position on both sides (the live build carries no `data-dc-tpl`; the originals' ids are ignored for pairing in this mode)                                                                                                                                                                                                                                                                    |
| Float noise     | exact                                                         | a computed decimal with at least nine fractional digits that differs from its twin only in the last digits (relative 1e-12, same unit) is not a difference; the API gives integer cents and the live class divides, the design accumulated floats (for example `35.342997615581005%` and `35.34299761558102%`). Counted and shown in the step's `vals` note. Short or typed values are always exact |
| Allow-list      | `parity/allowlist.json`                                       | `parity/allowlist.json` (the D4 link swaps) plus `parity/allowlist.live.json`; ids `L-<screen>-<nn>`                                                                                                                                                                                                                                                                                                |

### How a difference is allow-listed

A live difference is listed in `parity/allowlist.live.json` with **a DV id and a one-line reason** (a unit test,
`tools/parity/live-allowlist.test.ts`, fails when an entry names no DV line that `design-patches/DEVIATIONS.md` lists).
Two techniques, narrowest first:

1. **A pre-render swap of the oracle** (kinds `text` and `attr` with `swap`): the original's logic or template is edited
   before it renders so that it does what the live screen deliberately does (singular forms, the server's ledger stamp,
   SMS wording, ...). The five checks, pixels at threshold 0 included, then compare the two sides on the same content, so
   a swap hides nothing but the stated difference. Each swap declares how many replacements it makes and the run aborts
   before launching a browser when the original no longer contains exactly that many. The test above also compiles every
   swapped logic.
2. **A diff-side entry** with the narrowest locator, name and value regexes (`element-added`, `wiring`,
   `computed-style`, `text`), and a `region-mask` for pixels. The only mask is the header's right-hand cluster of Payments
   (`L-payments-07`, 330 x 77 px).

Nothing is covered by a tolerance (`parity/tolerances.json` is untouched and empty).

## Result

Run on the code of the final commit (only this document was added after it), `pnpm parity:live:all` (stack `lparity`, frozen 2026-06-13 10:36 America/New_York, signed in as
Rafael M.):

| screen / scenario             | steps | light            | dark             |
| ----------------------------- | ----- | ---------------- | ---------------- |
| payments / initial            | 1     | allow-listed 43  | allow-listed 84  |
| payments / ranges             | 5     | allow-listed 199 | allow-listed 244 |
| payments / filters            | 6     | allow-listed 238 | allow-listed 284 |
| payments / select-invoice     | 3     | allow-listed 121 | allow-listed 164 |
| payments / refund-sheet       | 7     | allow-listed 297 | allow-listed 344 |
| payments / theme-toggle       | 2     | allow-listed 83  | allow-listed 123 |
| settings / initial            | 1     | allow-listed 150 | allow-listed 183 |
| settings / sections           | 9     | allow-listed 806 | allow-listed 847 |
| settings / theme-toggle       | 2     | allow-listed 240 | allow-listed 272 |
| settings / emergency-deeplink | 1     | allow-listed 142 | allow-listed 175 |

20 runs, 74 steps: 0 zero, 74 allow-listed (5039 differences), 0 unresolved steps (0 differences)

"allow-listed N" counts the listed differences in the cell (a masked pixel region counts once). Every step of every run
has the header difference of the live chrome (the signed-in user chip; DV-101 to DV-104), so no step is literally
"zero"; steps whose only allow-listed differences are those header entries have nothing else to show. Everything else is
either identical to the pixel or covered by an entry below. 0 steps are unresolved and 0 allow-list entries are stale or
over-broad.

### Allow-list usage in that run

| id            | screen   | kind           | DV             | use                                |
| ------------- | -------- | -------------- | -------------- | ---------------------------------- |
| L-payments-01 | payments | text           | DV-501         | swap, 1 replacement(s) in payments |
| L-payments-02 | payments | text           | DV-502         | swap, 1 replacement(s) in payments |
| L-payments-03 | payments | text           | DV-210         | swap, 1 replacement(s) in payments |
| L-payments-04 | payments | text           | DV-220         | swap, 1 replacement(s) in payments |
| L-payments-05 | payments | element-added  | DV-103, DV-104 | 192 differences over 48 steps      |
| L-payments-06 | payments | element-added  | DV-103, DV-104 | 1056 differences over 48 steps     |
| L-payments-07 | payments | region-mask    | DV-103, DV-104 | 48 differences over 48 steps       |
| L-payments-08 | payments | element-added  | DV-104         | 240 differences over 48 steps      |
| L-payments-09 | payments | wiring         | DV-106         | 48 differences over 48 steps       |
| L-payments-10 | payments | wiring         | DV-201, DV-214 | 336 differences over 48 steps      |
| L-payments-11 | payments | text           | DV-210         | swap, 1 replacement(s) in payments |
| L-payments-12 | payments | text           | DV-210         | swap, 1 replacement(s) in payments |
| L-payments-13 | payments | text           | DV-210         | swap, 1 replacement(s) in payments |
| L-payments-14 | payments | text           | DV-504         | swap, 6 replacement(s) in payments |
| L-payments-15 | payments | text           | DV-216         | swap, 1 replacement(s) in payments |
| L-payments-16 | payments | wiring         | DV-215         | 40 differences over 48 steps       |
| L-settings-01 | settings | text           | DV-101         | swap, 1 replacement(s) in settings |
| L-settings-02 | settings | element-added  | DV-102         | 312 differences over 26 steps      |
| L-settings-03 | settings | wiring         | DV-106         | 26 differences over 26 steps       |
| L-settings-04 | settings | element-added  | DV-102         | 2256 differences over 26 steps     |
| L-settings-05 | settings | text           | DV-301         | swap, 1 replacement(s) in settings |
| L-settings-06 | settings | text           | DV-301         | swap, 1 replacement(s) in settings |
| L-settings-07 | settings | text           | DV-304         | swap, 1 replacement(s) in settings |
| L-settings-08 | settings | text           | DV-302         | swap, 1 replacement(s) in settings |
| L-settings-09 | settings | text           | DV-305         | swap, 1 replacement(s) in settings |
| L-settings-10 | settings | text           | DV-304         | 60 differences over 26 steps       |
| L-settings-11 | settings | text           | DV-304         | 20 differences over 26 steps       |
| L-all-01      | *        | computed-style | DV-503         | 37 differences over 74 steps       |
| L-all-02      | *        | computed-style | DV-503         | 368 differences over 74 steps      |

## The allow-listed differences

All of them rest on a DV line in `design-patches/DEVIATIONS.md`: DV-101 to DV-106 (live chrome), DV-210 to DV-223
(Payments), DV-301 to DV-316 (Settings) and DV-501 to DV-504 (found by this work).

| id            | screen   | kind           | what and why                                                                                                                                                                                                                                                                                                                    |
| ------------- | -------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-payments-01 | payments | text (swap)    | DV-501: the design's generated history reuses INV-20608..INV-20591 for two invoices (review B11); the live seed numbers the generated invoices downward from 20608 skipping ids in use. The oracle gets the same numbering before it renders.                                                                                   |
| L-payments-02 | payments | text (swap)    | DV-502: the screen opens on the newest invoice of the list; the design preselects the fixture literal INV-20603 (a row in the middle of the list).                                                                                                                                                                              |
| L-payments-03 | payments | text (swap)    | DV-210: singular forms ('1 client'); the oracle's plural-only label is fixed before it renders.                                                                                                                                                                                                                                 |
| L-payments-04 | payments | text (swap)    | DV-220: ledger entries carry the server's stamp (Today/Yesterday/Mon d, then the time) for every entry; the design printed the bare invoice time. The oracle gets the same stamp before it renders.                                                                                                                             |
| L-payments-05 | payments | element-added  | DV-103/DV-104: the live header shows the signed-in user chip, and 'Preview as' only to a person allowed to view as another role (Rafael M. is not), so the right-hand cluster differs in structure and shifts the theme button.                                                                                                 |
| L-payments-06 | payments | element-added  | DV-103/DV-104: header right-hand cluster (spacer width, Preview-as wrapper replaced by the user chip, theme button position).                                                                                                                                                                                                   |
| L-payments-07 | payments | region-mask    | DV-103/DV-104: pixels of the header's right-hand cluster (user chip instead of 'Preview as', shifted theme button).                                                                                                                                                                                                             |
| L-payments-08 | payments | element-added  | DV-104: the design's 'Preview as' role menu (roleOpts) has no live counterpart for a person who cannot view as another role; the live menu is driven by live.viewAs.                                                                                                                                                            |
| L-payments-09 | payments | wiring         | DV-106: the live class adds the `live` root (user chip, sign-out, view-as) to renderVals.                                                                                                                                                                                                                                       |
| L-payments-10 | payments | wiring         | DV-201/DV-214: ledger entries that are not pending refunds carry no approval answer from the server (approveNote empty, Approve style disabled), and every entry has the Squarespace confirm fields; none of these is rendered for such an entry.                                                                               |
| L-payments-11 | payments | text (swap)    | DV-210: singular forms ('1 invoice', '1 open balance'); the oracle's plural-only label is fixed before it renders.                                                                                                                                                                                                              |
| L-payments-12 | payments | text (swap)    | DV-210: singular forms ('1 invoice', '1 open balance'); the oracle's plural-only label is fixed before it renders.                                                                                                                                                                                                              |
| L-payments-13 | payments | text (swap)    | DV-210: singular forms ('1 invoice', '1 open balance'); the oracle's plural-only label is fixed before it renders.                                                                                                                                                                                                              |
| L-payments-14 | payments | text (swap)    | DV-504: the permission line names every role of the signed-in person ('Management + Accounting'); the design's Rafael has one role in Payments but two in the Settings design (Management and Accounting), and the live seed follows Settings. The oracle gets the same label before it renders.                                |
| L-payments-15 | payments | text (swap)    | DV-216: a refund to the original card adds 'Card refunds are completed in Squarespace; confirm it here once done.' to the permission box. The oracle gets the same sentence before it renders.                                                                                                                                  |
| L-payments-16 | payments | wiring         | DV-215: the sheet's view model carries the payment-link URL field and its error (needsUrl, urlRaw, setUrl, urlError, hasUrlError); only the Collect sheet's Payment link mode renders it.                                                                                                                                       |
| L-settings-01 | settings | text (swap)    | DV-101: the header chip shows the session's role title, which is the person's first role (GET /me displayRole); the design prints both of Rafael's roles ('Management · Accounting'). The oracle gets the same single role before it renders.                                                                                   |
| L-settings-02 | settings | element-added  | DV-102: the chip is wrapped in the sign-out menu (a relative wrapper with data-live-menu and the closed dropdown); the chip itself is the design's.                                                                                                                                                                             |
| L-settings-03 | settings | wiring         | DV-106: the live class adds the `live` root (user chip, sign-out, view-as) to renderVals.                                                                                                                                                                                                                                       |
| L-settings-04 | settings | element-added  | DV-102: the chip sits inside the sign-out menu wrapper, so everything under the header's chip slot is one level deeper than in the design (identical boxes: pixels are at zero).                                                                                                                                                |
| L-settings-05 | settings | text (swap)    | DV-301: the notify option reads 'Sent by SMS' (SMS only, no WhatsApp). The oracle gets the same sub-line before it renders.                                                                                                                                                                                                     |
| L-settings-06 | settings | text (swap)    | DV-301: the preview label names the channel and the first affected customer ('Preview · SMS to Marcus'). The oracle gets the label of the design day (its first affected customer is Marcus Webb).                                                                                                                              |
| L-settings-07 | settings | text (swap)    | DV-304: with the Emergency section open the preview is the message as it will be sent, and until a reschedule landing page exists the server drops the sentence that carries the link (every other state, and the editable template, keep the {link} sentence). The oracle's preview drops the same sentence in the same state. |
| L-settings-08 | settings | text (swap)    | DV-302: closure sub-lines show the server's real booking counts and nothing for a past closure; the design printed date-hash numbers. The seed has no bookings on a closure day, so the oracle gets 0 and an empty past line.                                                                                                   |
| L-settings-09 | settings | text (swap)    | DV-305: the emergency counters are the server's (nothing is notified or rebooked while no closure is active); the design showed the six remaining customers and a fixed 2.                                                                                                                                                      |
| L-settings-10 | settings | text           | DV-304: the affected list is the server's preview, requested when the Emergency section is open; until then the live list is empty. Steps with the section open show the same six customers.                                                                                                                                    |
| L-settings-11 | settings | text           | DV-304: count and confirm sentence come from the same lazily requested preview ('6 customers' once the Emergency section is open, '0 customers' before).                                                                                                                                                                        |
| L-all-01      | *        | computed-style | DV-503: the live pages mirror the theme on <html data-theme> (boot script, so a dark user never sees a light flash); the body background and the two outer wrappers therefore inherit the dark custom properties that the original only defines on its own theme wrapper. Nothing visible changes (pixels stay at zero).        |
| L-all-02      | *        | computed-style | DV-503: custom properties inherited from <html data-theme> on the two outer wrappers (see L-all-01).                                                                                                                                                                                                                            |

## Triage: what the first runs found and where each difference went

Every difference of the first runs was put in exactly one bucket.

**(a) Deliberate live difference already declared by a DV line**: the entries above.

**(b) Live bug or mapping error, fixed with a test**

- Payments kept the detail panel on "the first row of whatever the list shows now": after the first look a filter, a range
  or a search moved the open invoice. The design's selection is sticky. `LiveLogic.renderVals` now uses
  `selId ?? shownId ?? rows[0]` (DV-502; `LiveLogic.test.ts` "the selection is sticky", it fails without the fix).

**(c) Seed or formula mismatch with the design's data, fixed in the backend branch with a test**

- `ws/d10-be` `336d1a7`: the design's four VIP clients were all added in the same transaction, so the list came back
  alphabetical (Aisha, Elena, Jonathan, Liam) instead of the design's order (Jonathan, Liam, Aisha, Elena). The seed now
  adds them one second apart in the design's order (`test/domain-schema/seeds.test.ts`).

**(c') A backend defect the live run exposed**

- `ws/d10-be` `c0fa657`: `GET /events` incremented the person's open-stream counter before it registered its `close`
  listener. A client that left while authentication was still running had already emitted `close`, so its slot was never
  released; eight of those and the person got 429 on every event stream until the process restarted. Closing a page soon
  after opening it (what the harness does for every run, and a browser tab does in real life) triggers it. The handler now
  checks for an already-gone socket and releases the slot (`test/integration/sse.test.ts` reproduces it with a slow
  authorizer; it fails without the fix).

**(d) Harness artifacts, fixed in the harness**

- The live build has no `data-dc-tpl`, so the originals' ids made every element look added or removed: pairing is by DOM
  position on both sides in live mode.
- Two reads of the settled page were racing the screens' own debounce timers (the emergency preview): the quiet window
  is 900 ms of real time.
- The sign-in context's own event stream and a page that closed abruptly left streams open (see c').
- The theme: the server preference wins over `localStorage`, so the harness saves it through `PUT /me/preferences`.
- Last-digit float noise in computed percentages (above).

## Design contradictions the run surfaced (nothing to fix in the live code, listed for the owner)

1. **Invoice ids.** The Payments fixtures reuse `INV-20608`..`INV-20591` for two different invoices (review B11). The
   seed renumbers the generated ones (DV-501); the oracle gets the same numbering.
2. **One person, two roles.** The Settings design gives Rafael Mendes two roles (Management and Accounting) and prints
   "Management · Accounting" in its chip; Payments has a single "Management" role. `GET /me` returns `displayRole` = the
   first role, so the live chip reads "Management" (DV-101, `L-settings-01`) and the Payments permission line lists both
   roles (DV-504). If the chip should list every role, change `displayRole` in the backend (existing tests pin the
   single-role behaviour, so it is a decision, not a fix).
3. **Preview as.** The design shows "Preview as Management" to everyone; live shows it only to a Super Admin (DV-104).
4. **Fabricated counts.** Closure sub-lines, the emergency counters and `emRebooked` are hash or constants in the design.
   The live values are real; on the parity seed there are no bookings on a closure day, so the real count is 0
   (`L-settings-08`, `L-settings-09`). If the closure rows should show the design's 1, 2, 3 on parity data, the seed would
   have to create those bookings; it does not.
5. **The reschedule link in the emergency message.** The server drops the sentence with `{link}` until a landing page
   exists, so with the Emergency section open the live preview ends at "...inconvenience." while the editable template
   still carries `{link}` (`L-settings-07`).

## The self-test (sensitivity)

`pnpm parity:live:selftest` proves the live mode can fail. On the running stack it (1) runs a baseline (Payments initial
and Settings "Packages & checklists"), (2) applies four seed changes **one at a time** straight to the stack's schema, runs
the affected screen and requires the DOM, renderVals and pixel checks to fail:

| change                                                  | seen by                  |
| ------------------------------------------------------- | ------------------------ |
| Payments: the first item of INV-20608 gets $1.00 dearer | dom, style, vals, pixels |
| Payments: the client of INV-20608 is renamed            | dom, style, vals, pixels |
| Settings: every package gets $1.00 dearer               | dom, vals, pixels        |
| Settings: the package Express Hand Wash is renamed      | dom, style, vals, pixels |

and (3) reverts them (even when a phase throws) and requires a clean pass again. It took 75 seconds on the shared box.

## Not verified, and limits

- **Operations** is not covered (pending).
- Scenarios are the read-only catalogue of docs/parity.md: no scenario submits a sheet, edits Settings or opens an
  appointment. Writes are covered by `pnpm e2e:payments` and `scripts/e2e-settings.ts`, not by this proof.
- One persona (Rafael, Management and Accounting) in a 1480x1000 Chromium; other roles, view-as and locked screens are
  not compared (the originals have no equivalent).
- The oracle swaps encode what the live seed contains (no bookings on closure days, six customers left today); a
  different seed needs different swaps. The run needs the profiles above and fails on a stack without them.
- The harness trusts the quiet window: a screen that fetches later than 900 ms after its last change would be
  snapshotted early. Nothing on Payments or Settings does today.
- The live build is compared as built by `pnpm build:live`; `design/` and the fixture build are untouched.
