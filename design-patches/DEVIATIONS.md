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
