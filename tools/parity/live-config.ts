import fs from 'node:fs'
import path from 'node:path'
import { PARITY_DIR, REPORTS_DIR, ROOT } from './config'
import type { LiveTarget } from './live'

export const LIVE_ALLOWLIST_FILE = path.join(PARITY_DIR, 'allowlist.live.json')
export const LIVE_REPORTS_DIR = path.join(REPORTS_DIR, 'live')
export const LIVE_FREEZE = '2026-06-13T10:36:00-04:00'

interface StackFile {
  webUrl: string
  apiUrl: string
  frozen: string | null
  devPassword: string
  profiles: string[]
}

function readStack(name: string): StackFile {
  const file = path.join(ROOT, '.live-stack', `${name}.json`)
  if (!fs.existsSync(file)) throw new Error(`no live stack "${name}" (run: pnpm live:up --name ${name} ...)`)
  return JSON.parse(fs.readFileSync(file, 'utf8')) as StackFile
}

export function loadStackTarget(name: string, email: string): LiveTarget {
  const s = readStack(name)
  if (!s.frozen)
    throw new Error(
      `stack "${name}" is not frozen: start it with --freeze ${LIVE_FREEZE} (the design's instant)`,
    )
  return { name, webUrl: s.webUrl, apiUrl: s.apiUrl, frozen: s.frozen, devPassword: s.devPassword, email }
}

export const stackProfiles = (name: string): string[] => readStack(name).profiles
