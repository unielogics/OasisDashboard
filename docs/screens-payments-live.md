# Payments screen on the live ledger API

The live variant (`pnpm build:live`) renders the Payments template from the real ledger API. The server is the single
source of truth for every money figure (review B13): the live view model keeps UI state only (range, filter, search,
selection, the open sheet and its form) and renders the server's computed fields. The fixture class (`Logic.ts`) is
untouched, so the parity and default builds are byte for byte what they were (`pnpm parity --screen payments`: 12 runs,
48 steps, zero diff; the parity bundle contains none of the live code, checked by grepping `.next-parity/static`).

```
src/data/ports/payments.ts     DTOs of the ledger API (cents), PaymentsPort, createLivePaymentsPort (ApiClient)
src/lib/payments/cents.ts      the cents twin of the server calc: previews only (by-item value, adjust preview, amount checks)
src/lib/payments/live.ts       pure view builders from the DTOs: KPIs, bars, rows, detail, ledger, sheets, toasts
src/lib/payments/download.ts   saveBlob() for the CSV
src/screens/payments/LiveLogic.ts      LivePaymentsLogic + createLivePaymentsLogic(): the live view model
src/screens/payments/Screen.tsx        `LIVE ? createLivePaymentsLogic() : createPaymentsLogic(new FixtureData())`
src/screens/payments/live-testkit.ts   DTO builders and a stub PaymentsPort for the tests (not shipped)
design-patches/live/payments.patch.json + partials/pay-ledger-confirm.html, pay-collect-link.html
scripts/e2e-payments.ts        the Playwright run on a live stack (pnpm e2e:payments)
```

## How data flows

- Reads go through the `QueryStore` (docs/data-layer.md): `qk.payments('summary', range)`, `qk.payments('invoices', range,
filter, q)` (the port follows the keyset cursors, 500 per page, so the table shows everything like the design) and
  `qk.payments('invoice', id)`. The SSE `payments` channel (`invoice.updated`, `ledger.event`, `refund.pending`,
  `refund.resolved`) invalidates the whole family and the screen re-reads; a second browser's change shows up without a
  reload (e2e: two browsers).
- Nothing is read while the screen is locked (`pay.reports` missing in the session). The route gate
  (`src/components/auth/RouteGate.tsx`) answers first, so a person without `pay.reports` sees its "No payment access"
  card and the screen never mounts; the class's own `locked` branch is the fallback.
- A role change or view-as (the session's `rbacVersion` or `viewAs.roleId` moves) invalidates the family and closes an
  open sheet, because `canApprove`, `caller` and the limits are answers for the effective role.
- Search is the server's: `q` joins invoice id, client, vehicle and item names (the design's haystack). While a new
  answer loads, the previous list of the same range stays on screen. Filter chip counts come from the summary and ignore
  the search, as in the design.
- Money is formatted from integer cents with two helpers that match the design's strings: `money()` (two decimals,
  U+2212 minus) and `money0()` (whole dollars, half away from zero). Nothing on the screen is a client-side sum of
  cents. The only arithmetic is `cents.ts`, used for sheet previews; `cents.test.ts` proves it equals the design's float
  calc on the 105 fixtures and on 3,000 random invoices, and the e2e proves it equals the server's `calc` on all 105
  seeded invoices.

## Provenance of the template's roots

| Root                                                 | Source                                                                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `theme`, `toggleTheme`                               | UI state; cache `localStorage['oasis-theme']`, saved through `liveChrome.themeChanged` (`PUT /me/preferences`)                            |
| `roleName`, `roleMenu`, `roleOpts`, `toggleRoleMenu` | `roleName` from the session (`live.viewAs.label`); the menu itself is the live patch DV-104 (`live.viewAs.*`), the three others are inert |
| `locked`, `unlocked`                                 | session: `permissions['pay.reports']`                                                                                                     |
| `ranges`, `rangeLabel`                               | UI state; label = `summary.range.label` (business timezone)                                                                               |
| `kpis`                                               | `summary.kpis` (+ `counts`)                                                                                                               |
| `bars`                                               | `summary.chart.buckets` (labels, titles, net and loss cents), `maxCents`                                                                  |
| `methods`                                            | `summary.byMethod` (card, applePay, cash, storeCredit, other when non-zero)                                                               |
| `filters`                                            | UI state + `summary.filterCounts`                                                                                                         |
| `rows`, `noRows`, `query`, `onQuery`                 | `GET /payments/invoices` rows; `query` is UI state                                                                                        |
| `hasPending`, `pendingText`, `openPending`           | `summary.pendingApprovals` (global, not range filtered); Review selects `first.invoiceId`                                                 |
| `d.*` header, `big`, `lines`, `creditLine`           | `GET /invoices/:id`: `statusLabel`, `calc`, `items`, `adjustments`, `taxBp`, `clientCredit`                                               |
| `d.actions`                                          | the detail's `calc` (balance, refundable, credit) and the session (permissions); titles are the design's                                  |
| `d.ledger`                                           | `detail.ledger` (newest first, `atLabel`, `canApprove`, `approveBlock`, `awaitingProcessor`); Approve/Deny/Confirm are commands           |
| `sheetOpen`, `sh.*`                                  | UI form state + the detail; summary rows are the cents previews, the server has the last word on submit                                   |
| `exportCsv`                                          | `GET /payments/export.csv` (range, filter, search) as a download                                                                          |
| `toast`                                              | UI state, 3 s; API errors reach it through the toast bus (`command()`)                                                                    |
| `live`                                               | `liveChrome.vals()` (user chip, sign-out, view-as button and bar)                                                                         |

## Commands

All go through `command()` with `key: qk.payments()` (the family is refetched on success, 409 and 412), are never
optimistic, and answer with the refreshed invoice, which is put into the cache at once.

| Action                           | Request                                                                                             | Toast (success)                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Collect: Card on file / Cash     | `POST /invoices/:id/payments {method: card\|cash}`                                                  | `Collected $X`                                                                                             |
| Collect: Payment link            | `{method: payment_link, url}`                                                                       | `Payment link sent to {client}` or `Payment link saved · {client} opted out of SMS / has no phone on file` |
| Apply credit                     | `POST /invoices/:id/credit-applications {}`                                                         | `$X credit applied`                                                                                        |
| Refund (full / by item / custom) | `POST /invoices/:id/refunds {mode, itemIds?, amountCents?, dest, reason, note}`                     | `Refunded $X to {method\|store credit\|cash}` or `Sent for approval · $X`                                  |
| Approve / Deny                   | `POST /invoices/:id/refunds/:eventId/approve\|deny {}`                                              | `Refund approved · $X to {method}` / `Refund request denied`                                               |
| Adjust ($ or %)                  | `POST /invoices/:id/adjustments {kind, unit, value (cents or basis points), reason, note, settle?}` | `Discount\|Surcharge applied · new total $X` (the server's total)                                          |
| Issue credit                     | `POST /invoices/:id/credits {amountCents, reason, note, expiry}`                                    | `$X credit issued to {client}`                                                                             |
| Send receipt                     | `POST /invoices/:id/receipt {}`                                                                     | `Receipt sent to {client} via SMS + email` (only the channels that queued)                                 |
| Confirm in Squarespace           | `POST /ledger-events/:id/confirm-processor {}`                                                      | `Payment\|Refund confirmed in Squarespace · $X`                                                            |
| Export CSV                       | `GET /payments/export.csv?range&filter&q`                                                           | `CSV export started · N invoices`                                                                          |

Idempotency: a sheet creates an `Action` when it opens and every submit of that sheet uses its key until one succeeds
(a rejected link followed by a corrected one reuses the key; the server releases the key of a failed command). Approve,
Deny, Confirm and Send receipt have a key per (action, id), renewed on success. The submit button keeps its disabled
style while a request is in flight and a second click is ignored.

Permissions: buttons are disabled with the design's titles from the session (`pay.collect`, `pay.refund`, `pay.adjust`,
`pay.credit`; limits per transaction from `session.limits`, strictly greater than the limit means "send for approval"
for refunds and "blocked" for adjust and credit). `canApprove` and the note come from the server's per-event answer. When
the session says no, the click shows "Your role can’t ..." (`deniedTitle`) or "Your role can’t approve $X" and never
calls the API; a 403 that still arrives is mapped by `toastForError`.

## View-as

The "Preview as" button, its role list and the persistent "Viewing as X" bar are the live patches DV-104/105 over
`liveChrome` (the options come from `GET /me` `viewAs.options`, which carries each role's limits for a Super Admin).
Choosing a role calls `POST /me/view-as`; the session refresh flips the screen to that role's authority.

## Squarespace states

An entry with `processorState = awaiting_processor` (card money staff recorded, or a done card refund) counts at once in
every figure, ends its meta line with " · Awaiting Squarespace", and has a "Confirm in Squarespace" button (gated like
the original action). The table and the detail header read "Payment pending" / "Refund pending" in amber while any entry
waits (the list rows carry `awaiting`, a field added to the backend list in `ws/d8-be`). A card label is the brand the
server knows (`Card`, `Visa`), never an invented last4; the seeded design history keeps its `Visa ••4421` labels.

## Running it

```bash
export PATH=$HOME/.local/bin:$PATH NODE_OPTIONS=--max-old-space-size=2048
pnpm live:up --name payments --api-port 4022 --web-port 3222 --profile design,parity-pay --backend ~/oasis/wt/d8-be
pnpm e2e:payments --name payments --phase read      # repeatable
pnpm e2e:payments --name payments --phase write     # changes data: reseed (live:down --drop, live:up) before running it again
pnpm e2e:payments --name payments --phase roles
pnpm live:down --name payments --drop
```

The e2e compares every visible figure with the API through independent formatters, the original bundle's golden values
(`~/oasis/backend/test/golden/pay`: today, 7 days and 30 days, every filter; month to date is skipped because the
design's June 1-13 is not the real month), the 16 golden invoice panels, and the API after each command and after a
reload; it fails on a page error, an API 5xx or an unexpected 4xx. Screenshots go to `parity-reports/e2e-payments/`.

## Known limits and notes

- A stack started with `--freeze` cannot be used with a browser: the session cookie's `Expires` is computed from the
  frozen clock (June) and is already in the past for the real one (verified with curl, not with Chromium). Use the real
  clock; the seed is clock independent after the `ws/d8-be` fix (explicit dates such as "Jun 11" keep their distance from
  today).
- The route gate card has no header. A Super Admin who picks Crew or Support in "Preview as" on `/payments` lands on the
  gate's locked card and finds the "Viewing as" bar and its Exit on the other screens (the card links to them). The
  gate is outside this screen's files; adding an "Exit view as" button to `RouteGate` would close the loop.
- The list is not virtualised: 105 rows today, up to 20,000 (the CSV ceiling) in the worst case. Review B54 asks for
  infinite scroll or virtualisation when real volumes arrive.
- Void (`POST /invoices/:id/void`) and tip are in the port but have no button (the designs have none).
