# Deviations from the original designs

One line per active patch: id, kind (copy | real-data | bugfix | new-surface | navigation), owner sign-off.

| id     | kind       | patch                                                                                                                 | sign-off               |
| ------ | ---------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| DV-001 | navigation | `href-map.json`: `Oasis%20*.dc.html` file links become `/operations`, `/payments`, `/settings`, `/settings#emergency` | planned (docs/plan.md) |

| DV-002 | navigation | parity harness lists the same rewrites as pre-render `attr` swaps in `parity/allowlist.json` (ids `D4-href-*`) so DOM/pixels stay at zero diff | planned (docs/plan.md) |
| DV-003 | note | `<html>` carries no `lang` attribute (the originals have none); a `lang="en"` would change every element's computed `-webkit-locale`. Revisit in the accessibility pass | open |

`copy-map.json` and the three `<screen>.patch.json` files are empty (pass-through).

## Live variant (`--variant=live`, `design-patches/live/`)

Applied only by `pnpm build:live` (`dc:compile:live`). The default, prod and parity builds never read these files, so
`pnpm parity:all` still compares the unpatched port against the originals. Guards (`expectTag`, `expect`,
`expectTextStarts`) fail the build (exit 3) when a template changes under a patch.

| id     | kind        | patch                                                                                                                                                                                                                                | sign-off |
| ------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| DV-101 | real-data   | Operations and Settings header chip: `RM` / `Rafael M.` / role title become the session user's initials, short name and role title (`replace-text` with `{{= live.user.* }}`)                                                        | open     |
| DV-102 | new-surface | sign-out menu on the chip: wraps the chip, adds a dropdown built from the Payments role-menu primitive (absolute, `top:52px`, 250px, `--shadowLg`) with name, email and "Sign out" (docs/auth-ui.md)                                 | open     |
| DV-103 | new-surface | Payments gets the same user chip and menu (the design has no chip there): inserted after the theme button, copied from the Settings chip markup                                                                                      | open     |
| DV-104 | real-data   | Payments "Preview as": shown only when `session.viewAs.canViewAs` (`wrap-if`), label and role list come from the session, selecting a role calls `POST /me/view-as` (`set-attr` on the toggle, list, menu)                           | open     |
| DV-105 | new-surface | persistent "Viewing as X" bar under the header on all three screens while view-as is active, with an Exit button (existing `--accentSoft` / `--accentBrd` tokens)                                                                    | open     |
| DV-106 | wiring      | the three original logic classes get a bridge (`tools/dc-compile/live-bridge.ts`): `live` values in `renderVals()`, re-render on store change, theme toggle saved to the server, API toasts shown through the screen's own `flash()` | open     |
| DV-107 | new-surface | `/login`, `/forgot`, `/reset/[token]`, `/invite/[token]`, `/logout`, the boot splash, the failure card and the locked-screen card (docs/auth-ui.md); not compiler output, listed here for the veto list                              | open     |

New patch ops used by the live files: `insert-after`, `insert-before` and `wrap` (markup may come from
`design-patches/live/partials/*.html`, which can `@include(other.html)`).

## Payments live (`src/screens/payments/LiveLogic.ts`, `design-patches/live/payments.patch.json`)

Live variant only: the parity and default builds run the fixture class and the unpatched template (`pnpm parity --screen
payments` stays at zero diff). Provenance of every root and the wording tables: `docs/screens-payments-live.md`.

| id     | kind        | patch                                                                                                                                                                                                                                                                                   | sign-off |
| ------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| DV-201 | real-data   | every money figure, label and list comes from the ledger API (`GET /payments/summary`, `/payments/invoices`, `/invoices/:id`) in integer cents; the live class renders the server's calc and never rebuilds a balance from events. The default selection is the first row of the table  | open     |
| DV-210 | bugfix      | singular forms ("1 invoice", "1 client", "1 open balance") and "Credits issued" counts distinct clients, as its label says (D3)                                                                                                                                                         | open     |
| DV-211 | real-data   | "Collected by method" shows an "Other" row only when something was collected by another method (D6)                                                                                                                                                                                     | open     |
| DV-212 | new-surface | an invoice with card money recorded by staff and not yet confirmed in Squarespace shows the amber pill text "Payment pending" (a refund: "Refund pending") in the table and in the detail header, instead of "Paid" (D5)                                                                | open     |
| DV-213 | real-data   | the tax line label carries the invoice's own rate ("Tax (7%)" from `taxBp`)                                                                                                                                                                                                             | open     |
| DV-214 | new-surface | a ledger entry waiting on Squarespace ends its meta line with " · Awaiting Squarespace" and gets a "Confirm in Squarespace" button (the Approve button's style) with a note line, calling `POST /ledger-events/:id/confirm-processor`; gated by `pay.collect` / `pay.refund` (D5)       | open     |
| DV-215 | new-surface | Collect sheet, "Payment link": one extra input in the sheet's own input style ("Squarespace invoice or checkout URL", prefilled with the link already attached) and an inline red line for the server's host or missing-link error (D6)                                                 | open     |
| DV-216 | copy        | a refund to the original card adds " Card refunds are completed in Squarespace; confirm it here once done." to the permission box                                                                                                                                                       | open     |
| DV-217 | copy        | SMS wording (D1): "Receipt goes out by SMS and email."; for a payment link: "The link is texted to the client by SMS. The payment is recorded once Squarespace confirms it."                                                                                                            | open     |
| DV-218 | copy        | "Send receipt" toast: "Receipt sent to {client} via SMS + email" (D1), naming only the channels the server queued, or "Receipt not sent · {client} has no SMS or email to reach"                                                                                                        | open     |
| DV-219 | bugfix      | the banner's Review clears the filter and the search and switches to the narrowest range that shows the invoice (D3); the banner text is the server's ("2 refunds awaiting approval — ...")                                                                                             | open     |
| DV-220 | real-data   | ledger entries use the server's stamp ("Yesterday 4:40 PM", "Jun 11 · 9:12 AM"), the card label is the brand only (never an invented last4), a voided payment is its own entry ("Payment voided"), meta adds "Denied by" and "Voided", and a self-approval note reads the server's text | open     |
| DV-221 | real-data   | toasts after a command are built from the server's answer (refund "Sent for approval" or "Refunded", adjust shows the server's new total, collect shows the amount applied, a payment link says when the client could not be texted)                                                    | open     |
| DV-222 | real-data   | Export CSV downloads the real file (`GET /payments/export.csv` with the active range, filter and search); the toast keeps "CSV export started · N invoices" (singular fixed)                                                                                                            | open     |
| DV-223 | wiring      | a refund by item lists only items that were not refunded yet (the server tracks them); adjust sends percent as basis points; the sheet's Idempotency-Key is created when it opens and reused until it succeeds                                                                          | open     |
