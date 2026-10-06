# Oasis Auto Spa — dashboard

Operations, Payments and Settings screens, compiled from three Claude Design prototypes with identical DOM/CSS and wired to
the Oasis API. See [`docs/plan.md`](docs/plan.md); research in [`docs/reference/`](docs/reference).

## Layout
- `design/original/` — the three original bundles (immutable; `pnpm design:verify` checks `design/CHECKSUMS.sha256`).
- `scripts/parity-setup.mjs` — renders each original offline in headless Chromium (arm64) with a pinned clock/tz/locale; `pnpm parity:setup`.
- Coming in M1: `tools/dc-compile` (template → TSX), `src/dc/DCHost`, the parity harness, then the live data layer.

```bash
pnpm install
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-arm64 pnpm exec playwright install chromium   # once (Amazon Linux 2023 aarch64)
pnpm check            # design:verify + lint + typecheck + tests
pnpm parity:setup     # smoke-render the originals (screenshots in parity-reports/setup/)
```
