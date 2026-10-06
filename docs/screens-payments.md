# Payments screen: typed view model (stage 2a)

The Payments page no longer evaluates the design's logic source. `src/screens/payments/Screen.tsx` builds the screen from
`createPaymentsLogic(new FixtureData())` and the compiled template (`@generated/payments`), which is untouched. Behaviour,
DOM and pixels are the original's: `pnpm parity --screen payments` is at zero diff in both themes (see "Proof").

```
src/screens/payments/
  Logic.ts        PaymentsLogic extends DCLogic<PaymentsState>; state, handlers, toast timer, theme, live chrome
  data.ts         PaymentsData + PaymentsSeed: everything the screen reads (the seam the live wave replaces)
  fixtures.ts     FixtureData: DEF_ROLES, PRICE, ADD, the 105 invoices (hand-written + seeded PRNG), frozen day, range labels
  Screen.tsx      DCHost + ScreenStyle around PaymentsLogic; no loadLogic, no logic source string
  testkit.ts      helpers for the tests that run the ORIGINAL class beside the port (not shipped)
src/lib/payments/ pure formulas (no state, no clock, no storage), unit and differential tests
  calc.ts         TAX, calcInvoice (original calc), clientCredit
  limits.ts       limitFor (original lim), canViewReports/canCollectPayments, roleName, limitText, roleMenuLimit
  summary.ts      range windows, kpiCards, chartBuckets/chartBars, methodBars
  filters.ts      FILTERS, visibleInvoices (filter + search + sort), invoiceRowView, pendingApprovals, rangeForPending
  invoice.ts      invoiceLines, bigNumbers, invoiceActions, ledgerEntries, detailHeader, creditLine
  sheet.ts        SheetForm, calcSheet: summary rows, permission text, blocked flag, submit plan for the five sheets
  styles.ts       every inline style object of the template (key order as designed)
  dates.ts        dateOf, fmtDate
```

Money formatting comes from `src/lib/money` (`moneyCents` = `money()`, `moneyWhole0` = `money0()`, `r2`) and the status pill
from `src/lib/color` (`invoicePill`); `todayStamp` from `src/lib/time` formats the ledger stamp.

## How the class maps to the original

| Original member (`logic.original.js`)                                | Port                                                                                                                                                                                  |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TAX`, `DEF_ROLES`, `PRICE`, `ADD`                                   | `TAX` in `lib/payments/calc.ts`; the other three in `fixtures.ts`                                                                                                                     |
| `r2`, `money`, `money0`                                              | methods delegating to `lib/money` (kept so each can be diffed against the original)                                                                                                   |
| `state = (() => ...)()` incl. the PRNG history, `localStorage` reads | constructor: `data.seed()`; same keys in the same order (`theme, rc, role, roleMenu, txs, range, filter, query, selId, sheet, f, toast`)                                              |
| `calc`, `clientCredit`, `lim`, `roleName`                            | `calcInvoice`, `clientCredit`, `limitFor`, `roleName` in the lib; methods remain on the class                                                                                         |
| `nowT`                                                               | `data.stampNow()` (fixture: `todayStamp` of the device clock through `serverNow()`)                                                                                                   |
| `flash`, `addEvent`, `openSheet`, `setF`                             | same names and semantics (synchronous `setState`, 3 s toast timer, event `{ t, by, ...ev }`)                                                                                          |
| `dateOf`, `fmtDate`, `pill`, `seg`, `chip`                           | `lib/payments/dates.ts`, `invoicePill`, `styles.ts`                                                                                                                                   |
| `renderVals()` KPIs, chart, methods, filters, rows                   | `kpiCards`, `chartBars`, `methodBars`, `FILTERS`/`visibleInvoices`/`invoiceRowView`                                                                                                   |
| `renderVals()` detail (`d`)                                          | `detailHeader`, `bigNumbers`, `invoiceLines`, `invoiceActions`, `ledgerEntries`; handlers stay in the class                                                                           |
| `renderVals()` sheet (`sh`)                                          | `calcSheet` computes; the class adds the `onClick`/`setAmount`/`submit` closures and keeps the key order                                                                              |
| `toggleTheme` (+ bridge)                                             | `data.saveTheme`, `setState`, and in the live variant `chrome.themeChanged(next, prev)`                                                                                               |
| the live bridge appended by `tools/dc-compile/live-bridge.ts`        | in `Logic.ts`, only when `LIVE`: `live` last in the vals, `<html data-theme>` mirror, `subscribe` and `subscribeToasts` in `componentDidMount`, unsubscribe in `componentWillUnmount` |

The lib returns data (strings, flags, style objects); the class turns it into the template's objects by adding handlers at the
position the original had them, because the parity harness compares vals with key order. Handlers capture the render's `state`
exactly like the original closures (`approve` uses the role of that render, `openPending` the range of that render).

## Fixtures and where each lives

`fixtures.ts` holds the design's data verbatim and nothing else reads it: the roles bundle (`DEF_ROLES`, overridden by
`localStorage['oasis-roles']`, which the Settings screen writes), `PRICE` and `ADD`, 16 hand-written invoices, the mulberry-style
PRNG history for days -1..-29 (day -10 skipped), the frozen "today" (Saturday 2026-06-13, `FROZEN_TODAY`), the four range labels
(`RANGE_LABELS`), the default role `mgmt` and the preselected invoice `INV-20603`. `FixtureData.seed()` builds fresh invoices
on every call; `stampNow()` and `saveTheme()` are the only clock and storage touches. `fixtures.test.ts` compares each with the
original class (`JSON.stringify` of 105 invoices, constants, labels).

## Swapping FixtureData for LiveData (next wave)

1. Implement `PaymentsData` over `getDataPort().payments` plus the session: `today` and `rangeLabels` from the business-tz
   summary (`businessToday`, `rangeLabel`), `stampNow()` = `businessStamp(serverNow())`, `saveTheme` = the theme preference call
   (the class already reports the change to `liveChrome`), `seed().role` from `session.viewAs`, `roles` from `people.roles`.
2. `seed()` is synchronous today. For the live data replace it by `QueryStore` reads inside `renderVals()` (recipe in
   `docs/data-layer.md` step 3); `Logic.ts` only touches data through `this.data` and `this.state.txs`, so the read sites are the
   constructor and the places that call `this.setState({ txs })`: `addEvent` and the two `setState` calls in `approve`/`deny`.
3. Mutations are concentrated in three seams, each already a single method or closure: `calcSheet(...).plan` (events to append
   and the toast: send each event through `command()` with the sheet's `Action` key and use the response for the toast),
   `approve`, `deny`. Money actions are never optimistic. The lib's totals (`calcInvoice`, `calcSheet` summary) become server
   values; keep `calcSheet`'s wording (permission text, labels), which the live design keeps.
4. Amounts here are floating point dollars exactly like the design (parity needs the same rounding). The API speaks integer
   cents: convert at the data adapter (`cents / 100`) and keep the lib formulas for previews only.
5. Wording changes owed to the plan (D1, WhatsApp becomes SMS) live in two places: `lib/payments/sheet.ts` ("Receipt goes out
   by WhatsApp and email.") and `Logic.ts` (the "Send receipt" toast). They are verbatim now so parity stays at zero; change them
   together with a parity allow-list entry.

## Quirks preserved on purpose

- Money is float dollars with `Math.round(n*100)/100`, so half-cent cases follow the design, not the backend's integer cents.
- The generated history reuses invoice ids of the hand-written ones (`INV-20608` twice); the detail panel and `approve` act on
  the first match.
- A by-item refund selection left over from another invoice with more items makes `renderVals()` throw
  (`Cannot read properties of undefined (reading 'price')`), as in the original; `DCHost` shows its error card. The UI cannot
  reach it (the sheet covers the table), the differential test pins it.
- A missing limit is $25 (except for `super`: no limit); a `null` limit is no limit; `limitFor` does not use `hasOwnProperty`.
- The Collect sheet always records "Visa ••4421" for anything but Cash. "Apply credit" has no validation. The Preview-as menu
  prints raw numbers (`≤ $1000`), the sheets print `$1,000`.
- `Credits issued` counts credit events' dollars; its sub-label says "clients" (the design's wording).
- A pending refund shows "Refund pending" with the "Partially paid" amber pill.
- Differences from the original, none visible: the toast timer is cleared on unmount (the original leaves it running), and the
  live bridge's behaviour lives in the class instead of an appended script.

## Proof

- `src/screens/payments/Logic.diff.test.ts`: the original class (same loader as production used to use) and the port, built
  from the same storage and clock, compared on `renderVals()` serialised with `serializeVals` (values and key order) plus the
  state after every step: all 5 roles x 4 ranges x 5 filters x 6 queries, every one of the 105 invoices selected, nine sheet and
  approval flows, and seeded random walks (default and custom role bundles with holes, both themes, stale closures replayed).
  The walks assert that every sheet, the locked screen, blocked submits and every toast were reached.
- `src/lib/payments/calc.diff.test.ts`: `calcInvoice`, `clientCredit`, `limitFor`, `roleName`, `roleMenuLimit`, `dateOf`, `fmtDate`
  against the original methods on the design data and on 5000 random invoices (every status reached) and 61 role bundles.
- `Logic.live.test.ts`: the live behaviour against the original with the compiler's bridge appended.
- `wiring.test.ts`: the screen files never reference `loadLogic`, the logic source or `new Function`; every root and handler the
  compiled template binds exists in `renderVals()`.
- Parity: build the parity variant and run `pnpm parity --screen payments --port-url http://127.0.0.1:3102` (commands in the
  worktree report).

The oracle values were produced by running the original class itself (no extraction script is needed: `tools/parity` is not used
by the unit tests). The golden extraction through `OriginalDriver` is replaced by the in-process comparison above, which covers
more states than the five parity scenarios.
