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
