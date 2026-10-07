# Operations (Command Center) on the real API

The live variant (`pnpm build:live`) renders the Operations template from the real API. The server is the single source of
truth for every status, price, balance, KPI, alert, availability slot and activity line: `LiveOperationsLogic` keeps UI
state only (view, range, search, selection, tab, the New Appointment form, the composer), the gesture engine and the 1 s
tick. The fixture class (`Logic.ts`) is untouched, so the parity and default builds are byte for byte what they were
(`pnpm parity --screen operations`: zero diff; the parity bundle contains none of the live code, checked by grepping
`.next-parity/static` for `LiveOperationsLogic`, `oa-last-tender` and `/ops/snapshot`).

```
src/data/ports/operations-schema.d.ts   generated from the backend openapi (scripts/gen-operations-schema.ts), Operations paths only
src/data/ports/operations.ts            OperationsPort over those types + createLiveOperationsPort + the presigned upload
src/lib/operations/live/                pure builders: board.ts, calendar.ts, file.ts, newAppt.ts, optimistic.ts, fmt.ts
src/screens/operations/LiveLogic.ts     LiveOperationsLogic + createLiveOperationsLogic(): the live view model
src/screens/operations/live/commands.ts OpsCommands: one method per control (permission, Idempotency-Key, server toast)
src/screens/operations/Screen.tsx       `LIVE ? createLiveOperationsLogic() : OperationsLogic`
src/screens/operations/live-testkit.ts  stub ports over responses captured from the API (live/__fixtures__), not shipped
design-patches/live/operations.patch.json + partials/ops-*.html   the live template patches (DEVIATIONS.md DV-401..419)
scripts/e2e-operations.ts               the Playwright run on a live stack (pnpm e2e:operations)
```

## How data flows

- Reads go through the `QueryStore` (docs/data-layer.md). Keys: `qk.ops('snapshot', window, q)`, `qk.ops('file', id)`,
  `qk.ops('membership', customerId)`, `qk.ops('calendar', 'day' | 'summary', ...)`, `qk.ops('availability', date, serviceId,
customerId)`, `qk.ops('customers', q)`, `qk.ops('catalog')` and `qk.messages('thread', id)`. A read counts as fresh for
  60 s (the safety net while the stream is down); the SSE `ops` events (`appointment.updated`, `bay.changed`,
  `availability.changed`, `kpi.dirty`, `alerts.changed`), the `messages` events (`message.in`, `message.out`,
  `message.status`) and, since `ws/d9-be`, every payment change (an `ops` `appointment.updated {change: "payment"}` plus
  `kpi.dirty` next to the `payments` events) invalidate the family and the screen re-reads. A second browser sees every
  change without a reload (e2e: two browsers).
- The snapshot follows the range tab (`window`) and the search box (`q`, debounced 200 ms, the server's matcher; the phone
  only with `cli.contact`). While a new answer loads, the previous snapshot stays on screen.
- The clock is the synced server clock (`serverNow()`): the header clock, the business date, the bay timers (elapsed and
  percent from the server's ISO start of the job, finish = `max(start + duration, now)`) and "today" for the Calendar.
- Money arrives in integer cents and shows cents only when the amount is not whole (`formatCentsCompact`).
- The file opens as soon as `GET /appointments/:id` answers (the read starts on pointer-down of the card, so a click opens
  it at once). Its thread (`GET /appointments/:id/messages`, `{items, customer, unread}`), the membership view and the
  catalog are separate reads. Entering the Messages tab marks the customer's replies read (once, with `msg.send`).

## Provenance of every `renderVals` key

S = the server supplies the value (a field of a response), D = derived in the browser from server values and the synced
clock, U = UI state. Style objects are the design's literals (the fixture class's), built in `lib/operations/live` and
compared with the fixture class by `board.test.ts`/`file.test.ts`.

| Root                                                                                                      | Source                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `theme isDark isLight toggleTheme`                                                                        | U; cache `localStorage['oasis-theme']`, saved through `liveChrome.themeChanged` (`PUT /me/preferences`)                                                                                     |
| `view isTimeline isBay isStaff isCalendar viewTabs rangeTabs showRange search onSearch`                   | U                                                                                                                                                                                           |
| `kpis`                                                                                                    | S `snapshot.kpis` (label, value, sub; the accent colours are the design's); `—` placeholders until the first answer                                                                         |
| `emergencyOn emergencyText`                                                                               | S `snapshot.emergency`                                                                                                                                                                      |
| `clockLabel dateLabel`                                                                                    | D server clock and business tz                                                                                                                                                              |
| `groups[]` (`dividerLabel time ampm items`)                                                               | S `snapshot.timeline.groups` (the divider is the real day: Today, Tomorrow or the date)                                                                                                     |
| `groups[].items[]` / `queue[]` / `staffCols[].jobs[]` / `calRows[].items[]` (the card)                    | S `OpsCard` (name, vehicle line, service, time, bay label, duration label, pay label and kind, badge label and colour, flags, next label, canDrag); D styles, `memberStyle`; U drag opacity |
| `apptCount`                                                                                               | S `snapshot.timeline.count`                                                                                                                                                                 |
| `bays[]` free                                                                                             | S `bays[]` (name, status, nextUp, nextUpAppointmentId); D drop styles from the drag state                                                                                                   |
| `bays[]` occupied (`elapsed eta progressStyle progressLabel`)                                             | S the occupant card, worker, `startedAt`, `durationMin`, `durLabel`; D elapsed, percent and finish from the clock                                                                           |
| `arrivals[]`                                                                                              | S `snapshot.arrivals` (title, description, VIP, prep label, prepped); D styles                                                                                                              |
| `inFacilityLabel`                                                                                         | S                                                                                                                                                                                           |
| `completedJobs[] completedCount noCompleted`                                                              | S `snapshot.completed` (pay kind, pickup state); D chips and accent                                                                                                                         |
| `alerts[] alertCount`                                                                                     | S `snapshot.alerts` (including the SMS alerts: new reply, device down, Squarespace money waiting); D tone styles; the action is chosen by `alert.action.type`                               |
| `staffCols[]`                                                                                             | S `snapshot.staff` (employees with the Crew role or `jobs.status`, plus Unassigned; title and colour from the employee)                                                                     |
| `calLabel calSub calRows calWeek calMonth calClosed calClosedReason`                                      | S `GET /calendar/day` (sub, rows, outside hours, dayInfo) and `GET /calendar/summary` (counts, closed reasons); D headings and the grid                                                     |
| `calModes calDow calIsDay/Week/Month calPrev calNext calToday calHint calSwipe*`                          | U (the offset is days from the business today)                                                                                                                                              |
| `dragging ghost* preventCtx stop`                                                                         | U gesture state                                                                                                                                                                             |
| `openNew openWalkin closeNew newOpen newTitle createAppt`                                                 | U; `createAppt` = `POST /appointments` (Idempotency-Key from an `Action` created when the sheet opens)                                                                                      |
| `newServices`                                                                                             | S `GET /services` first five packages (name, duration, price)                                                                                                                               |
| `newSlots`                                                                                                | S `GET /availability` (state per slot: available, blocked, vip_held, closed, past, cutoff, outside_window; overridable)                                                                     |
| `nf.*` (fields, SMS toggle, hits, date row, note, override, submit label)                                 | U form + S customer search (`GET /customers?q=`)                                                                                                                                            |
| `modalOpen closeModal`                                                                                    | U `selectedId` once the file answered                                                                                                                                                       |
| `sel` header (`name initials vehicleLine plate phone when badge member vip`)                              | S file customer, vehicle, overview, membership; phone masked by the server without `cli.contact`                                                                                            |
| `sel.smsChip*`                                                                                            | S `customer.smsOptedIn`, `smsOptedOut`                                                                                                                                                      |
| `sel.stages`                                                                                              | D from the status                                                                                                                                                                           |
| `sel.tabs`                                                                                                | D counts: checklist progress and add-ons from the file, messages from the thread                                                                                                            |
| Overview (`vehicle color plate bayLabel worker service time durLabel payLabel memberPlain notes special`) | S file overview                                                                                                                                                                             |
| Checklist (`checkDone checkTotal checkPct checkSections`)                                                 | S `file.checklist` (stable task ids); D styles; U optimistic ticks                                                                                                                          |
| Add-ons (`addonCatalog addonTotal`)                                                                       | S `file.addons` (catalog with the server's prices, selected flag, total)                                                                                                                    |
| Photos (`photoSections`)                                                                                  | S `file.photos` (counts, items, presigned thumbnails); D slots (photos then the add tile)                                                                                                   |
| Messages (`messages templates composer*`)                                                                 | S thread items (status, time, channel), customer flags; U composer text; the pills are the server's quick replies                                                                           |
| Payments (`payRows payStatusLabel payBig payMethod showCollect isPaid isPending collect sendLink`)        | S `file.invoice` (items, tip, tax, total, paid, balance, awaiting, tax rate) and `overview.pay`; U tender, link text                                                                        |
| Membership (`memberCardStyle renewDate creditsLeft creditsUsed memberMonths perks risk*`)                 | S `file.membership` (the real port); upgrade line S `GET /customers/:id/membership`                                                                                                         |
| History (`visitCount lifetimeSpend avgFreq history`)                                                      | S membership `history` (visits, lifetime spend, average days between visits), `file.history.recent`, `file.activity`                                                                        |
| `nextLabel hasNext done nextHint doNext`                                                                  | S `file.next`; D the hint by step                                                                                                                                                           |
| `toast toastTitle toastDesc`                                                                              | U; API errors reach it through `command()`'s toast, success text is the server's `toast`                                                                                                    |
| `live`                                                                                                    | `liveChrome.vals()` (user chip, sign-out, view-as bar)                                                                                                                                      |

## Commands

All go through `OpsCommands` and `command()` with `key: qk.ops()` (the family is refetched on success, 409 and 412). A
role that may not do the action gets `Your role can’t …` (the permission's own wording) and nothing is sent. A sheet or
action keeps its Idempotency-Key until it succeeds (a retried booking or payment cannot apply twice; a double click joins
the request in flight).

| Control                                         | Request                                                                                                                      | Permission                                        | Toast (success)                                                                                      |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Primary button of the file, bay button, `s` `r` | `POST /appointments/:id/advance {expectedStatus}` (the status the screen showed)                                             | `jobs.status` (confirm, arrive also `sched.edit`) | the server's                                                                                         |
| `Collect Payment` (completed with a balance)    | opens the Payments tab                                                                                                       | none                                              |                                                                                                      |
| Swipe right on a card                           | advance                                                                                                                      | as above                                          |                                                                                                      |
| Drag onto a bay                                 | `POST /assign-bay {bayId}`                                                                                                   | `jobs.status`                                     | the server's (`Moved to Bay 2`)                                                                      |
| Drag onto an hour (Calendar)                    | `POST /reschedule {start}` (business-tz instant, minutes kept, capacity checked by the server)                               | `sched.edit`                                      | the server's                                                                                         |
| `Prep Bay`, `Check in`                          | `POST /prep-bay`, `POST /arrive {source: manual}`                                                                            | `jobs.status` or `sched.edit`                     | the server's                                                                                         |
| `Needs pickup` / `Picked up`                    | `POST /pickup {state}`                                                                                                       | `jobs.status`                                     | the server's                                                                                         |
| Checklist task, section, `Check all`            | `PUT /checklist/items/:id`, `POST /checklist/bulk`                                                                           | `jobs.checklist`                                  | none for a task or a section; `All tasks checked` / `Checklist cleared`                              |
| Add-on row                                      | `PUT` / `DELETE /addons/:serviceId` (409 `ADDON_REMOVE_OVERPAID` when a removal would overpay)                               | `sched.edit`                                      | the server's                                                                                         |
| Photo add tile                                  | `POST /photos/presign`, POST to the slot, `POST /photos/:id/complete`                                                        | `jobs.checklist`                                  | `Photo added · {category}`                                                                           |
| Composer, pills                                 | `POST /messages {text}` or `{templateKey: qr_*}`                                                                             | `msg.send`                                        | `Message sent · Queued via SMS to {first}` (or the quiet-hours hold)                                 |
| `Ready for pickup` pill on a completed job      | `POST /notify-ready`                                                                                                         | `msg.send`                                        | the server's                                                                                         |
| `Mark Paid` (Card or Cash)                      | `POST /invoices/:id/payments {method}`, then `POST /invoices/:id/receipt`                                                    | `pay.collect`                                     | `Payment collected` / `Card payment recorded · Waiting for Squarespace …`, with the receipt channels |
| `Send payment link`                             | `POST /invoices/:id/payments {method: payment_link, url}`                                                                    | `pay.collect`                                     | `Payment link sent · Secure link via SMS`; the host error is shown inline                            |
| `Paid` chip (un-pay)                            | `GET /invoices/:id`, `POST /invoices/:id/void {eventId}` of the last payment                                                 | `pay.void`                                        | `Marked unpaid`                                                                                      |
| `Apply credit`                                  | `POST /appointments/:id/membership-perks/apply`                                                                              | `cli.member`                                      | `Credit applied`                                                                                     |
| New Appointment, Walk-in                        | `POST /appointments` (customer by id or `{name, phone, smsOptIn}`, parsed vehicle, `start` or `walkIn`, `override {reason}`) | `sched.edit` (+ `sched.override`)                 | the server's (`Appointment booked`)                                                                  |
| Alert actions                                   | by `alert.action.type`: pickup, prep bay, reminder SMS (`confirm_request`), arrive, start, apply credit, or open the file    | the command's                                     | the command's                                                                                        |

`cancel` and `no-show` are in the port (`sched.cancel`) and have no control: the design has none.

## Squarespace states (DV-212, DV-409)

Card money staff recorded and Squarespace has not confirmed counts toward the balance at once and reads `Payment pending`
(amber) everywhere an invoice status shows: the card's pay line, the pickup chip, the file header, the Payments tab (a
pending box with the amount) and `Payment pending · $X due` while a balance remains. The server sends it
(`pay.kind: "pending"`, `pay.awaitingCents`, added in `ws/d9-be`); it becomes `Paid` when the Transactions feed or staff
confirm the payment (`POST /ledger-events/:id/confirm-processor`, the Payments screen's button), which also pushes the
change to every open board.

## Running it

```bash
export PATH=$HOME/.local/bin:$PATH NODE_OPTIONS=--max-old-space-size=2048
# SMS_ALLOWLIST: seeded customers have synthetic numbers that the API never texts unless they are allow-listed outside
# production; ALLOW_DEV_ENDPOINTS exposes /dev/sms/inbound for the STOP check. Both are read from the environment by the API.
export SMS_ALLOWLIST=+17865550110,+17865550103,+17865550112,+13055550109,+13055550105,+13055550107,+17865550108,+13055550102,+13055550113,+13055550104,+17865550106,+13055550111,+13055550171,+13055550172
export ALLOW_DEV_ENDPOINTS=true
pnpm live:up --name ops --api-port 4023 --web-port 3223 --profile design,parity-ops --freeze 2026-06-13T10:36:00-04:00 --backend ~/oasis/wt/d9-be
pnpm e2e:operations --name ops --phase visual      # original bundle vs live, repeatable
pnpm e2e:operations --name ops --phase read        # repeatable
pnpm e2e:operations --name ops --phase write       # changes data: reseed (live:down --drop, live:up) before running it again
pnpm e2e:operations --name ops --phase roles
pnpm live:down --name ops --drop
```

Log in at the web URL with `<first>@oasisautospa.com` and `oasis-dev-pass-1234`: `amara` Super Admin (can "view as"), `rafael`
Management + Accounting, `sofia` Support + Crew, `marco` Crew, `daniel` Accounting. To review from another machine start the
stack with `--host <tailnet ip> --origin http://<tailnet ip>:3223`. A stack started with `--freeze` freezes the
**server** clock; the page's own clock keeps running from the server's time at load, so bay timers move.

Backend (branch `ws/d9-be`) changes this screen needed: see "Backend changes" below.

## Backend changes (`ws/d9-be`)

- `InvoiceSummary.awaitingCents` and `PayView.kind = "pending"` (Payment pending, DV-212 on the board), plus `taxBp`.
- Payment commands and Squarespace confirmations also publish `ops` events (`appointment.updated {change: "payment"}`,
  `kpi.dirty`), so the board refreshes by itself.
- The `parity-ops` seed creates one invoice per design appointment (`PARITY_OPS_MONEY`: paid, deposit, unpaid, tips) and
  the design members, so the seeded board has real balances (Pending payments `$1,298.53`, Revenue today `$1,487.48`).
- `/dev-storage/*` (the simulator object store of `STORAGE_PROVIDER=fs`) is mounted outside production: the presigned
  photo POST and the signed thumbnails 404ed before.

## Known limits

- The calendar `Outside hours` row, the date row of the sheet, the composer counter and the tender choice are the only new
  elements; each is listed in DEVIATIONS.md.
- The five-package limit of the New Appointment sheet is the design's (review B30 asks for more).
- `cancel` and `no-show` have endpoints and tests, no control.
- A maintenance bay reads `Out of service`; nothing in the design shows one.
