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
  the search, as in the design. The detail panel keeps the last invoice it showed when a filter or search leaves the
  table empty.
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
| `d.*` header, `big`, `lines`, `creditLine`           | `GET /invoices/:id`: `statusLabel`, `calc`, `items`, `adjustments`, `taxDbp`/`taxRounding` (ADR 0173), `clientCredit`                    |
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

## Categories (ADR 0160 plan K; DV-224, DV-225)

`GET /payments/invoices` rows carry `categories` and `category` (the appointment's; an invoice without one takes the
categories of the services its items name); `GET /payments/summary` carries `byCategory[{key, label, colour, count,
grossCents, netCents, outstandingCents}]`: each invoice of the range once, every active category (zeros included), then
`mixed`, entries that add up to the KPIs. `src/lib/payments/categories.ts`:

| where | value | rule |
| --- | --- | --- |
| a row's Items cell, before the items text | `r.cat {show, label, style}` | the row's `category` as one chip in its colour (`Mixed` for two categories); a single key without the word stands for itself; none for an invoice without a category |
| under the KPI tiles | `live.hasCatSplit`, `live.catSplitLabel` (`By category · Last 7 days`), `live.catSplit[]` | per category the gross (whole dollars), the invoice count and `· $X open` when a balance remains; empty categories dimmed; hidden without `pay.reports` |

The CSV export is unchanged (its columns are a tested contract). Tests: `src/screens/payments/live-categories.test.ts`.

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

## Sizes, coverage and Square (Q2c; ADR 0170 wave Q2a, ADR 0171 wave Q2b; DV-801..DV-806)

Everything below appears only when the server sends it; with `PAYMENT_PROCESSOR=squarespace` (the default) and invoices
priced before sizes the screen is the one above. Pure builders: `src/lib/payments/square.ts` (tenders, ledger states, the
queue's words and apply targets), `src/lib/sizes.ts` (size, member % off and coverage words, shared with Operations).

| Where | Value | Source and rule |
| --- | --- | --- |
| invoice lines | `d.lines[].label` | an item's `classLabel` and `discountBp` (`Signature Hand Wash · Large SUV · 10% member price`); an adjustment's `coverage` (`Covered $40 · $20 size difference due`) |
| Collect sheet | `sh.payMethods` | `processing.processor`: `Square reader` / `Cash` / `Payment link` with Square; no URL box; the reader sends `{method: card}` (the staff entry Square confirms through the counter matcher, rule R3); the link sends `{method: payment_link}` and, when the answer carries a plain Square link (personal links off), the sheet keeps it with `Copy link` (`sh.hasSentLink`, `sh.sentLink`, `sh.copyLink`) |
| ledger meta | `d.ledger[].meta` | `processor`, `processorState`: `Awaiting Square`, `Square`, `Refund sent to Square`, `Refunded by Square`, `Refund failed · not refunded` (amount dimmed). A staff card entry carries no processor: it belongs to the invoice's; a refund without one is finished by hand where the money came in |
| ledger buttons | `d.ledger[].sqMatch*`, `sqCanMove`, `sqMove*` | a waiting Square reader entry: `Match a Square payment` opens the queue on its amount (no hand confirm); a confirmed Square payment: `Wrong invoice? Move it` → invoice number → `GET /payments/invoices?q=INV-…` (30 days) → `POST /payments/square/:paymentId/reassign` (`pay.void`) |
| banner and sheet | `live.sqHasBanner`, `live.sqBanner`, `live.sqReview`, `live.sqOpen`, `live.sqItems[]`, `live.sqFailed[]`, `live.sqInFlight` | `GET /payments/square/unmatched` (key `qk.payments('square','unmatched')`, 30 s, refetched with the family); `GET /payments/reconciliation` while the sheet is open (its `square` section) |

Commands (all with an Idempotency-Key per action, through `command()` with `key: qk.payments()`):

| Action | Request | Permission | Toast |
| --- | --- | --- | --- |
| Apply (a candidate or the invoice open on screen) | `POST /payments/square/:paymentId/apply {invoiceId, confirmEventId?}` | `pay.collect` | `Recorded on INV-20640 · $13.37` / `Square reader payment confirmed · $42.80` |
| Set aside (after a reason) | `POST /payments/square/:paymentId/ignore {reason}` | `pay.collect` | `Set aside · $13.37` (`Pick a reason first` without one) |
| Move | `POST /payments/square/:paymentId/reassign {toInvoiceId}` | `pay.void` | `Moved to INV-20641 · $42.80` (the moved-to invoice is selected) |

**Sales tax at a precise rate (ADR 0173, wave K3; DV-213).** An invoice carries its rate in thousandths of a percent
(`taxDbp`: 7000 = 7%, 6625 = 6.625%) and its rounding (`taxRounding`: `half_up`, or `half_even` once the rollout switches the
location to Square's rule); `taxBp` stays one release as the rate in whole basis points and is read only by `taxRateOf` for a
server that sends nothing else (×10, half up). `cents.ts` follows the backend's `salesTaxCents`: `n = sub × dbp`, then
`n / 100000` half up or half to even, once on `max(items + adjustments, 0)`; the by-item refund value is
`min(refundable, lines + salesTax(lines))`, the adjustment preview `newSub + salesTax(max(newSub, 0)) + tip`, and net takes
the refunds' tax part out half up at the invoice's rate. The label is `taxPercentLabel` ("6.625%"). `cents.test.ts` holds the
ADR's vectors (6.625% half to even are Square's own CalculateOrder answers, SQR-18) and an exact reference for half to even;
`src/screens/payments/live-tax.test.ts` shows the screen at 6.625% under both rules; the e2e compares the twin with the
server's `calc` on every invoice with the invoice's own `taxDbp` and `taxRounding`.

The cents twin (`cents.ts`) leaves a refund whose `processorState` is `failed` out of `refunded` and `refOrig`, like the
backend's `calc.ts` and `invoice_calc_of` (ADR 0171 D4); `cents.test.ts` holds the backend's golden vectors and the e2e
compares the twin with the server's `calc` on every invoice it reads (it now passes `processorState`).

Not shown because the backend does not send it yet (see the package report): the Square receipt number on a ledger entry
(the queue shows it), and the tier colours of the board cards' member badges (Operations).

Tests: `src/lib/payments/square.test.ts`, `src/screens/payments/live-square.test.ts` (view model, commands, permissions),
`src/screens/payments/live-square.render.test.ts` (the live template). End to end: `pnpm e2e:visits`
(docs/screens-operations-live.md, "Sizes, coverage and Square").

## Saved cards, fees and Square receipts (Q3e; ADR 0171 waves Q3a, Q3 dashapi, Q4; DV-901, DV-902, DV-904, DV-910)

Everything below shows only when the server says so. With the defaults (`PAYMENT_PROCESSOR=squarespace`, Square writes off)
the invoice's `processing.squareTenders` offers nothing new and the screen is the one above. Pure builders:
`src/lib/payments/square.ts` (`collectTenderList`, `savedCardOf`, the saved card's words, `safeReceiptUrl`, `receiptMeta`),
`src/lib/payments/live.ts` (the saved card's step in `liveSheetCalc`, the receipt link on ledger entries) and
`src/lib/operations/live/billing.ts` (`feeRows`, shared with the appointment file).

| Where | Value | Source and rule |
| --- | --- | --- |
| Collect sheet | `sh.payMethods` | `processing.squareTenders` (api-spec 30.13): `Square reader` while Square is the processor; `Saved card ••5858` only when `savedCard` is not null (Square writes on, an active unexpired card whose live consent covers balances, an open invoice); `Cash`; `Payment link` only while `link` (Square writes on). A server before wave Q3 (no `squareTenders`): the Square three of DV-802 |
| the saved card's step | `sh.scShow`, `scOk`, `scOkText`, `scToggle`, `scRowStyle`, `scBoxStyle`, `scDeclined`, `scDeclineText`, `scWaiting`, `scWaitingText` | the client's OK box (unticked, the refund sheet's item row; the submit stays blocked until it is ticked), the summary (`Balance due`, `Card`), `Charge $42.80 to Visa ••5858` → `POST /invoices/:id/card-charges {cardId, amountCents: calc.balance}` (`pay.collect`) with the sheet's Idempotency-Key. 201: the sheet closes, toast `Charged $42.80 to Visa ••5858`. 202 (`charge.state = unknown`): the sheet stays with `Waiting for Square: …` and `Done` (the server's job finishes it with the same key). 422 `CARD_DECLINED`: the sheet stays, red line with Square's reason, the box unticked; the next submit sends the same key, which the server takes as a new attempt on the same charge. Any other refusal is the server's toast |
| ledger entries | `d.ledger[].meta`, `sqHasReceipt`, `sqReceiptUrl`, `sqReceiptLabel`, `sqReceiptOpen` | `receiptNumber` / `receiptUrl` of a Square `pay` row: the meta ends `Receipt #Xy7Q`; the link (a button) opens the page in a new tab without an opener, only when the URL is https on squareup.com or squareupsandbox.com (or a subdomain) without user, password or port (checked here as on the server; a voided payment has none) |
| under a canceled invoice's actions | `live.feeShow`, `live.feeRows[]` (`title`, `line`, `lineStyle`, `canDecide`, `chargeLabel`, `charge`, `confirming`, `confirmText`, `confirm`, `waive`, `waiving`, `reason`, `setReason`, `waiveConfirm`, `back`) | `GET /invoices/:id/card-charges` (quiet, only for a canceled invoice of a visit): its no-show and late-cancel fees as on the appointment file (DV-904); `Charge $15` asks first, then `POST /appointments/:appointmentId/fee-charges/:id/charge` (`pay.collect`, a key per fee); `Waive` needs a reason (`…/waive {reason}`) |
| under an open invoice's actions (DV-910) | the same `live.feeRows[]` | `GET /invoices/:id/card-charges` (quiet) also for an open invoice Square takes card money on that still owes (`processing.processor` `square`, `calc.balance` > 0; never with Squarespace): its balance charge is listed only while it waits for Square (`unknown` or `charging`): `Balance · $42.80 on Visa ••5858`, `Waiting for Square: it is recorded as soon as Square answers, never twice.` (a charged or declined balance is the ledger's) |
| Not charged (checked Square) (DV-910) | `live.feeRows[]` (`ncShow`, `ncLabel`, `ncOpen`, `ncConfirming`, `ncText`, `ncConfirm`, `ncBack`, `ncSubmitLabel`, `ncHasNote`, `ncNote`), `live.ncButtonStyle`; the Collect sheet's `sh.scNc*` | every charge waiting for Square (a balance or a fee) with an invoice, and the Collect sheet that waited on one (202), `pay.collect` only (hidden without it): asks first (`Only if Square shows no payment for this charge.`), then `POST /invoices/:id/card-charges/:chargeId/not-charged {}` (a key per charge, renewed after a 200). 200 `charged`: `Square had the payment · $42.80 on Visa ••5858 is recorded` (the sheet closes). 200 `declined` (NOT_SENT): `Nothing was charged · Collect the balance another way` (a fee: `Charge the fee again or waive it`); the sheet is the Collect sheet again with the server's `error` line in red and the OK box unticked. A refusal is the server's toast and stays under the row or the button in its words (409 `CARD_CHARGE_IN_PROGRESS` `Square may still be answering this charge. Check again in a few minutes.`, 409 `CARD_CHARGE_NOT_WAITING`, 503 `SQUARE_UNAVAILABLE`); the next press sends the same key (the server released it), i.e. the next check |

Tests: `src/lib/payments/saved-card.test.ts`, `src/screens/payments/live-cards.test.ts` (view model, commands, keys,
permissions), `src/screens/payments/live-cards.render.test.ts` (the live template). End to end: `pnpm e2e:billing`
(below).

### Running the end to end (`pnpm e2e:billing`)

`scripts/e2e-billing-stack.sh` does it all in one shell on the test server: the backend's HTTP Square simulator (webhooks signed
with a key made for the run), a live stack (`design,website-catalog,pricing-defaults`, real clock, `--jobs`) with
`PAYMENT_PROCESSOR=square`, Square writes and memberships on, personal links on (a test `PIN_PEPPER` made for the run), the e2e,
then the stack down and its schema dropped. Neither the key nor the pepper is printed.

```bash
oasis-remote ~/oasis/wt/q3-dashapi -- true
oasis-remote ~/oasis/wt/q3-dash -- 'bash scripts/e2e-billing-stack.sh /home/ec2-user/oasis/wt/q3-dashapi [--only <step text>]'
```

The run (9 steps, as the Super Admin): three clients with a visit each (a test hook moves the visits to today and the no-show
visit two hours back, since the server takes a no-show only after the start and the grace period); Settings → Billing &
integrations: Test connection on the simulator (each check against the API), the no-show fee switched on at $100 and saved,
Sync to Square (the Gold price `On Square` in Memberships); two clients save a card on their own card page (the real link
routes: the link made with the backend's `issueClientLink`, the page verified by the code texted to it, recovered from its
hash; `cnon:card-nonce-ok` is the simulator's Visa ••5858) and the file lists it with its consent; the Collect sheet offers
`Saved card ••5858`, refuses before the client's OK and charges the balance (a Square payment on the ledger, the invoice
paid); a no-show proposes the fee, charged after a confirm (Square's payment id on the charge); a client joins Gold on their
membership page (Square subscription, first invoice paid, webhooks through the worker) and the Membership tab shows `Billed by
Square`, then `Pause` (asked first) schedules the pause at Square. Screenshots: `parity-reports/e2e-billing/`.
