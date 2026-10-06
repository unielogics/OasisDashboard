// The server-offset clock: serverNow() = clientNow() + (serverTime - clientAtLoad). It is the ONLY place in the
// dashboard that reads the wall clock; everything else asks serverNow() so a wrong device clock cannot shift
// "today", elapsed timers or "late" flags. Tests inject clientNow.

export type ClientNow = () => number

export class ServerClock {
  private offsetMs = 0
  private synced = false

  constructor(private clientNow: ClientNow = () => Date.now()) {}

  /** Records the offset from a server instant. `requestedAtMs`/`receivedAtMs` (client time) bracket the request so the
   * midpoint approximates the instant the server stamped. */
  sync(serverTimeIso: string | number, requestedAtMs?: number, receivedAtMs?: number): void {
    const server = typeof serverTimeIso === 'number' ? serverTimeIso : Date.parse(serverTimeIso)
    if (!Number.isFinite(server)) return
    const recv = receivedAtMs ?? this.clientNow()
    const sent = requestedAtMs ?? recv
    const mid = sent + (recv - sent) / 2
    this.offsetMs = server - mid
    this.synced = true
  }

  /** Milliseconds to add to the client clock to get server time. */
  get offset(): number {
    return this.offsetMs
  }

  get isSynced(): boolean {
    return this.synced
  }

  now(): number {
    return this.clientNow() + this.offsetMs
  }

  /** The raw client clock (for bracketing a request when syncing). */
  rawNow(): number {
    return this.clientNow()
  }

  reset(): void {
    this.offsetMs = 0
    this.synced = false
  }

  /** Test seam. */
  setClientNow(fn: ClientNow): void {
    this.clientNow = fn
  }
}

export const serverClock = new ServerClock()

/** Server time in epoch milliseconds. */
export const serverNow = (): number => serverClock.now()
