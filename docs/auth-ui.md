# Auth surfaces (login family, session chrome)

The three designs have no sign-in, no sign-out, no invite and no "view as" outside Payments. These are the surfaces the
plan adds (D4) and how each is built. Rule for all of them: **only the designs' own primitives** (same CSS variables,
fonts and radii, light and dark). There are no new colours, shadows, animations or hover states. The veto list is
`design-patches/DEVIATIONS.md` (DV-101 to DV-107).

## Pages

| Route                                      | Page                            | Backend call                 | Notes                                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | ------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/login?next=`                             | `components/auth/LoginPage.tsx` | `POST /auth/login`           | validates, then a full page load to `safeNext(next)` (default `/operations`). `?reset=1` and `?expired=1` show a toast.                                                                                                                                                                |
| `/forgot`                                  | `ForgotPage.tsx`                | `POST /auth/password/forgot` | the confirmation is identical for every address (the API always answers 202).                                                                                                                                                                                                          |
| `/reset/<token>`, `/reset-password?token=` | `ResetPage.tsx`                 | `POST /auth/password/reset`  | 12-128 characters and a confirmation. A dead link swaps the form for a "Link expired" card. Success goes to `/login?reset=1`.                                                                                                                                                          |
| `/invite/<token>`, `/invite?token=`        | `InvitePage.tsx`                | `POST /auth/invite/accept`   | **email is required** (review B23/B47: an employee may have none until now) plus password and confirmation. `EMAIL_TAKEN` lands under the email field, `INVITE_INVALID` swaps in an "Invite not valid" card. Success: welcome toast, then `/operations` (the API signs the person in). |
| `/logout`                                  | `LogoutPage.tsx`                | `POST /auth/logout`          | clears the theme cache and client state, then `/login`. Also what "Sign out" does.                                                                                                                                                                                                     |

The backend's notification links are `/invite?token=...` and `/reset-password?token=...` (api-spec 14.2); the
spec'd routes are `/invite/[token]` and `/reset/[token]`. All four work: `pages/invite/[token].tsx` re-exports
`pages/invite.tsx`, and `next.config.mjs` rewrites `/reset/:token` to `/reset?token=:token` and `/reset-password` to
`/reset`. The pages set `<meta name="referrer" content="no-referrer">` so a token in the URL never leaks.

Where each primitive comes from (all in `components/auth/styles.ts`, each commented with its source):

| Part                                             | Source in the designs                                                                                                             |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| root wrapper, header bar, logo tile and wordmark | the screens' root `<div>` and `<header>`                                                                                          |
| card, icon tile, title, sentence                 | Payments "No payment access" locked card (`max-width:440px`, radius 22, padding 36, `--shadow`)                                   |
| field label and input (46px, radius 11)          | Settings drawer fields (`dr.fields`), including the red error border                                                              |
| inline error text                                | Settings drawer error line (12.5px/700); `var(--red)` is `#C2410C` in light and stays legible in dark                             |
| primary button                                   | Settings drawer "Save changes" (50px, radius 13, accent, 800); busy = the Payments sheet's blocked submit (`--panel3` / `--ink3`) |
| toast                                            | the Payments and Settings toast (bottom centre, `--ink` on `--bg`, 3 s)                                                           |
| links                                            | the global `a{color:var(--accent)}` rule                                                                                          |

The screens' global CSS is injected from the Payments sheet (`ScreenStyle id="oasis-auth"`): it carries the tokens, the
fonts and the `input:focus` / `button` rules these controls were designed against. It is removed again when the page
unmounts, so it never mixes with a screen's own sheet. The pages are client-only (`dynamic ssr:false`) like the
screens, otherwise they would paint before the CSS exists. The theme is read from the `oasis-theme` cache.

### Screenshots reviewed

Playwright against `pnpm start:live` + `pnpm fake-api`, 1480x1000, light and dark: empty login, validation errors,
wrong password, throttled, forgot (form and confirmation), reset (errors), invite (form, errors, dead link), the
login redirect with `next`. They sit next to the real screens as follows. The card, icon tile, title and sentence are
pixel-for-pixel the Payments locked card; fields and button match the Settings drawer (46px inputs, 50px primary
button, same radii). Light and dark both use the screens' tokens. Visible differences, all deliberate: the title is an
`<h1>` (the design uses a `div`; same font, size and weight), the wordmark's second line says "Back office" instead of
the screen name, and the success toast has no `oa-rise` animation (Payments and Settings toasts have none either).
One known quirk replicated from the designs: dark mode keeps the fixed colours of the design's controls.

## Session and middleware

- `GET /api/v1/me` once per page load (`src/auth/session.tsx`, TanStack `['me']`), with `GET /api/v1/meta/now` for the
  server clock when `/me` carries no `serverTime` (it does not today). The result is the `Session` of
  `src/auth/session-model.ts`: user (id, employee id, email, name, initials, title), effective roles, `roleTitle`,
  `isSuperAdmin` (the REAL person), the permission map, limits in cents, `prefs.theme`, `viewAs`
  (`active`, `canViewAs`, `roleId`, `roleName`, `options`), `csrfToken`, `serverTime`, `businessTz`, `devTools`.
- Gate: boot splash while loading, `/login?next=<path>&expired=1` on a 401 (once), a failure card with "Try again" on
  any other failure. The screens only mount after the session is loaded and the server theme has been written to the
  `oasis-theme` cache (the verbatim classes read that key in their constructor).
- `src/middleware.ts` (Next only finds middleware in `src/` when the project has a `src` directory) does the cheap
  check: any of `__Host-oasis_sid`, `oasis_sid` or `OASIS_SESSION_COOKIE_NAME` present, else a redirect to
  `/login?next=<path+query>`. It never validates the session. Matcher excludes `/_next`, `/fonts`, `/api`,
  favicon and robots; the login family is public. It does nothing in the default and parity builds.
- `RouteGate` (inside the live providers): a person who cannot open a screen sees the Payments locked card instead of an
  empty board: Operations needs `sched.view`, Payments `pay.reports` (the design's rule), Settings any of the `set.*`,
  `team.*` or `cli.member` keys. The text is the design's: `The Crew role doesn't include "View payment reports". A
Super Admin can grant it in Settings.` with links to the screens that person can open and "Sign out". Section-level
  gating inside Settings is a later step.
- `ErrorBoundary` shows the same card ("This screen failed to load", Try again) on a render error.
- `can(session, key)`, `limit(session, kind)` (`{ has, maxCents }`, `null` = unlimited, missing = $25) and
  `withinLimit(session, kind, cents)` mirror Payments `lim()`/`canApprove` but in cents; `useCan`, `useLimit`,
  `useSession` are the React forms. `toastForError` words a 403 as "Your role can't <verb>" from `error.meta.required`.

## Header chip, sign-out menu and view-as (live variant only)

Compiled by `--variant=live` from `design-patches/live/*.patch.json` (the patch layer is described in
`docs/compiler.md`; the live ops and the bridge are in `docs/data-layer.md`, section "The live variant").

- Operations and Settings: the chip shows the session user's initials, short name ("Rafael M.") and role title. It is
  wrapped and made clickable; the dropdown is the Payments role-menu primitive: name, email, "Sign out". It closes on
  a click outside (`data-live-menu`), which the designs' own role menu does not do (quirk replicated there).
- Payments has no chip in the design; the same chip and menu are inserted after the theme button (DV-103).
- Payments "Preview as": wrapped in `wrap-if live.canViewAs`, so only a real Super Admin sees it (`canViewAs` is the real
  identity, so choosing Crew does not remove the menu: review C5). The label, the role list ("refunds ≤ $1000", "refunds
  no limit", "no refunds") and the click handlers come from the session; choosing a role calls `POST /me/view-as`
  with an Idempotency-Key, then `/me` and every other query family are refetched. Choosing Super Admin clears
  view-as. The server evaluates reads and writes as the viewed role and records both identities in the audit log.
- While view-as is active every screen shows a bar under the header: "Viewing as Crew — actions use that role's
  permissions" and an Exit button (accent tokens only). It survives reloads and navigation (it lives on the server
  session), and `rbac.changed` events refresh `/me` in other tabs.

## Fake API

`pnpm fake-api` (port 4000) implements the identity endpoints, `/meta/now` and the `/events` SSE stream with
`alex@oasis.test` (Super Admin), `rafael@oasis.test` (Management + Accounting, dark theme) and `marco@oasis.test`
(Crew), password `oasis-demo-1234`; invite `invite-demo-token` (single use) and `invite-expired`; reset
`reset-demo-token` (single use) and `reset-expired`. Test hooks: `POST /__fake/emit`, `/__fake/drop-streams`,
`/__fake/expire-sessions`, `/__fake/reset`, `GET /__fake/state`. It has a CSRF token per session, login throttling
after 5 failures (429 + `Retry-After`) and real view-as, so everything above can be exercised without the backend:

```bash
pnpm fake-api &                 # :4000
API_ORIGIN=http://localhost:4000 pnpm build:live   # /api is proxied only when API_ORIGIN is set at build time (baked in)
pnpm start:live                 # :3200 (PORT=... to change)
```

`scripts/fake-api.test.ts` runs the real `ApiClient`, the identity endpoints and the `RealtimeClient` against it over
a socket (login, throttle, CSRF heal, view-as, invite, reset, SSE resume and resync).

## Kiosk mode (ADR 0180 and its 2026-10-14 amendment; DEVIATIONS DV-1001, DV-1002, DV-1003, DV-1008, DV-1012, DV-1014)

The shop's shared tablet stays open all day without an email login. Kiosk mode is **on by default**: the sign-in page is a PIN
keypad. Every employee has their own 8-digit PIN (set by a manager in Settings → Kiosk → Staff PINs); any listed employee's PIN,
typed **on the shop's internet connection**, opens the tablet into a **kiosk session** for everyone until closing + 2 hours,
recorded as "Opened by Marco R." (api-spec 31). The shop's connection is set once by a Super Admin, from any device on the shop
Wi-Fi (Settings → Kiosk → Shop network, docs/screens-settings.md). There is no registration step: a browser gets its device
cookie (HttpOnly, never seen by the page) at its first unlock at the shop. Everything below is live-only.

**The sign-in page** (`pages/login.tsx` → `components/auth/LoginGate.tsx`) asks `GET /kiosk/status` (public) first:

| status                                     | `/login` shows                                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| kiosk mode off, unreadable, fixture build  | today's `LoginPage`, unchanged (its card is `EmailPasswordCard`, extracted so the keypad can show it) |
| on (the default)                           | the keypad (`KeypadPage`)                                                                            |
| on, this tablet unlocked, no `?admin=1`    | `/operations` at once                                                                                |

The keypad (`KeypadPage`, pure rules in `src/auth/keypad.ts`): title `Enter your PIN`, `Your 8-digit PIN opens the board for
the whole shop.`, eight dots, keys 1-9 / Clear / 0 / Delete (76 px tall), the physical keyboard (digits, Backspace, Esc or
Delete = Clear). At the eighth digit the PIN goes to `POST /kiosk/unlock {pin}` by itself and the dots empty; the PIN lives
only in component state and is never logged. **0218:** when the first four digits typed since the last Clear are `0218`
(Backspace does not take a typed digit back; `10218` does not count) the email/password card replaces the keypad at once and
nothing is sent; `Back to keypad` returns. No PIN starts with 0218 (the server refuses one).

**Only at the shop.** `GET /kiosk/status` says whether a shop network exists (`networkSet`) and whether this connection is one
(`atShop`). Without a network the keypad says `A Super Admin must set the shop network first — Settings → Kiosk`; on another
connection `PINs work only at the shop.` In both cases the keypad still shows, 0218 still works, and a PIN is **not sent**
(the dots just empty; the one exception below). A 403 `KIOSK_NOT_AT_SHOP` (the network was removed, or the address changed,
while the keypad was open) says the same (`meta.networkSet` picks the line) and the keypad stops sending.

While blocked the keypad **reads `GET /kiosk/status` again** (K-PIN-DASH review F1): every 30 s (`RECHECK_MS`), when the
page comes back into view or online (`focus`, `visibilitychange`, `online`), and before it acts on a full PIN. Once the
status says the connection is a shop network (the Super Admin added it from a phone, or approved the tablet's try), the
warning goes, the toast says `Ready — PINs work here now.` and PINs are sent again, with no reload (a tablet in Guided
Access has no reload button). A re-read that finds kiosk mode switched off shows the email/password card; an unreadable one
leaves the keypad as it is. The reads stop once it is at the shop. `Back to keypad` after 0218 shows the reason again.

**One try from a new network** (review F2): a browser that once opened the kiosk remembers it in one localStorage flag
(`oasis-kiosk-opened-here` = `1`, set after a successful unlock; never the PIN or a name; storage that is blocked just means
no flag). On a connection the status calls "not at the shop" (a shop network exists), such a browser sends **one** full PIN
per page, after re-reading the status, so the server lists it under Settings → Kiosk → `PIN tried from a new network` with
the browser's name ("Front desk tablet tried from a new network — your internet provider probably changed the shop's
address") and the Super Admin can add it from anywhere, also when the tablet reloaded after the address changed. The server
never checks that PIN (403 `KIOSK_NOT_AT_SHOP`); the keypad then says `PINs work only at the shop.` and sends no more. Before
any shop network exists, and in a browser that never opened the kiosk, nothing is sent. This deviates from the K-PIN-DASH
brief's literal "never sends a PIN" to keep the plan's promise (the try is listed and approved from anywhere); removing the
exception is one line (`mayTryFromHere` in `src/auth/keypad.ts`).

The server's other answers, in the keypad's words: `That PIN didn’t work.` and `Try again in 8 s` (401 `KIOSK_PIN_WRONG`,
`meta.retryAfterSec`; a PIN typed during the wait is sent when it ends; a wait still running when the page opens counts down
too), `Too many tries. Wait a moment.` (429, Retry-After), `Too many wrong PINs. A manager needs to clear it in Settings →
Kiosk.` (423 `KIOSK_LOCKED_OUT`, this address or this browser, or `lockedOut` in the status; PINs are no longer sent, 0218
still works), and kiosk mode turned off meanwhile (409 `KIOSK_OFF`) shows the email card with `Kiosk mode is off. Sign in with
your email and password.` After a lock the page opens with `?locked=1[&at=9:00 PM]`: `The kiosk locked at 9:00 PM. Enter your
PIN to open it.`

**The kiosk session** (`src/auth/session.tsx`): `GET /me` answers 403 `KIOSK_SESSION` on an unlocked tablet, and the session
is then `GET /kiosk/me` (`toKioskSession`: kind `kiosk`, a synthetic user named after the tablet with initials `K`, the
kiosk's permission set, no money limits, no view-as, the server clock from `serverTime`). A refetch (focus, `refresh()`,
the event stream's auth probe) finds the client already in kiosk mode, which refuses `GET /me` itself: that also reads
`GET /kiosk/me`, so an ended kiosk session (its 401) still sends the tablet to the keypad. While it lasts:

- the API client refuses, without sending them, the routes the kiosk may not call (`src/data/http/kiosk-routes.ts`, generated
  by `pnpm gen:api` from the backend's `x-oasis-kiosk` marks, `--check` guards it) with `Not on the kiosk · Ask a manager`;
- a write of an `actor` route carries `X-Oasis-Employee` (`RequestOptions.actor`; the Operations commands pass the name the
  employee tapped, see docs/screens-operations-live.md); one sent without it asks the picker (`Who’s doing this?`), a
  fallback no Operations command reaches (a test proves it); cancelling is silent (`KioskCancelled`, an aborted request);
- `RouteGate` sends every page but `/operations` there; the middleware counts the kiosk session cookie
  (`__Host-oasis_ksid` / `oasis_ksid`), never the device cookie alone;
- a 401 (locked here or elsewhere, removed, kiosk mode off) goes to `/login?locked=1`, not "session expired"; at `locksAt`
  (server clock) the page goes to `/login?locked=1&at=…` by itself;
- the picker list follows Settings: `GET /kiosk/staff` under `['settings', 'kiosk', 'staff']`, refetched on
  `settings.changed {section: kiosk | employees}`; the theme is kept on the tablet only (no `PUT /me/preferences`).

**Header chip and menu** (`src/auth/chrome.ts`, partial `user-menu.html`): on a kiosk `K`, the tablet's name and `Opened by
Marco R. · Locks at 9:00 PM` (`KioskMe.openedBy`, whose PIN opened it; without it `Locks at 9:00 PM`); the menu reads the
tablet and `Opened by Marco R. at 7:58 AM · locks 9:00 PM`, then `Manager sign-in` (`/login?admin=1`: the keypad, where 0218
reveals the form, and `Back to the board`) and `Lock kiosk`, which asks first (`Lock the kiosk now? A PIN opens it again.`
`Lock` / `Cancel`) → `POST /kiosk/lock` → the keypad. Payments, Settings and the "Manage" links are not rendered
(`live.showAdminNav`). For everyone else the menu reads `Sign out` as before, plus `Kiosk…` for people with `team.roles`
(→ `/settings#kiosk`; also on a shop browser, so a Super Admin on the tablet itself can set the shop network) and `Team
activity…` for `team.edit` (→ `/settings#activity`; the Settings nav has no room for a Shop floor group, DV-1009). A person
signed in on a shop browser (the short session of ADR 0180: 15 minutes idle,
4 hours at most; `/me` `kioskDevice`) sees a bar on all three screens: `Signed in as Rafael M. on Front desk tablet · signs
out after 15 minutes without use` and `Sign out`.

Tests: `src/auth/keypad.test.ts`, `kiosk-picker.test.ts`, `chrome.test.ts`, `session.test.tsx`, `middleware-logic.test.ts`,
`src/components/auth/kiosk.test.tsx` (every keypad state: at the shop, not at the shop, no network yet, locked out, wrong PIN,
0218; the status read again by itself, on focus and before a full PIN; the one try from a browser that opened the kiosk), `gate.test.tsx`, `src/data/http/kiosk.test.ts`; end to end `pnpm e2e:kiosk` (`scripts/e2e-kiosk.ts`, on a stack
started with `--trust-proxy` so each browser says which address it comes from; `bash scripts/e2e-kiosk-stack.sh <backend>`
runs it start to end). With kiosk mode on by default, the e2e and live-parity sign-ins type 0218 on the keypad first
(`revealEmailForm` in `scripts/live-e2e.ts`, `signIn` in `tools/parity/live.ts`).
