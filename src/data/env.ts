// Build flavour flags. Next inlines `process.env.NEXT_PUBLIC_*` literals, so a branch on them is dead-code
// eliminated in the other builds (the parity and fixture builds carry no session or API code path).

/** True in the live variant (`pnpm build:live`): session gate, API client, SSE and the live chrome are active. */
export const LIVE = process.env.NEXT_PUBLIC_VARIANT === 'live'
/** True in the parity build (fixture screens, window.__oasisParity). */
export const PARITY = process.env.NEXT_PUBLIC_PARITY === '1'
