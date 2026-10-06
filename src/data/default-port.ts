// The data port a screen gets: the fixture port in fixture builds (default and parity), the live port in the live
// variant. The logic classes are not React components, so they ask for it here instead of using hooks.
import { LIVE } from './env'
import { api } from './http/client'
import { createFixtureDataPort } from './ports/fixture'
import { createLiveDataPort } from './ports/live'
import type { DataPort } from './ports/ports'

let port: DataPort | null = null

export function getDataPort(): DataPort {
  return (port ??= LIVE ? createLiveDataPort(api) : createFixtureDataPort())
}

/** Test seam. */
export function setDataPort(p: DataPort | null): void {
  port = p
}
