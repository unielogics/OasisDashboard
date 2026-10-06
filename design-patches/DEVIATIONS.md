# Deviations from the original designs

One line per active patch: id, kind (copy | real-data | bugfix | new-surface | navigation), owner sign-off.

| id     | kind       | patch                                                                                                                 | sign-off               |
| ------ | ---------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| DV-001 | navigation | `href-map.json`: `Oasis%20*.dc.html` file links become `/operations`, `/payments`, `/settings`, `/settings#emergency` | planned (docs/plan.md) |

| DV-002 | navigation | parity harness lists the same rewrites as pre-render `attr` swaps in `parity/allowlist.json` (ids `D4-href-*`) so DOM/pixels stay at zero diff | planned (docs/plan.md) |
| DV-003 | note | `<html>` carries no `lang` attribute (the originals have none); a `lang="en"` would change every element's computed `-webkit-locale`. Revisit in the accessibility pass | open |

`copy-map.json` and the three `<screen>.patch.json` files are empty (pass-through).
