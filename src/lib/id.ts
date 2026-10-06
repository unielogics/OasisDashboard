// Random identifiers for idempotency keys, from the Web Crypto API (no Math.random).

export function randomUuid(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  if (!c || typeof c.getRandomValues !== 'function')
    throw new Error('Web Crypto is not available in this environment')
  const b = c.getRandomValues(new Uint8Array(16))
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** A new Idempotency-Key. Generate it when a user action STARTS and reuse it across retries of that action. */
export const newIdempotencyKey = (): string => randomUuid()

/** A uniform number in [0, 1) from Web Crypto, for retry jitter (no Math.random). */
export function randomUnit(): number {
  const c = globalThis.crypto
  if (!c || typeof c.getRandomValues !== 'function') return 0.5
  return c.getRandomValues(new Uint32Array(1))[0]! / 4294967296
}
