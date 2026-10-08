import fs from 'node:fs'
import path from 'node:path'
import { PARITY_DIR, REPORTS_DIR, ROOT, type Screen } from './config'
import type { LiveTarget } from './live'
import { LIVE_SCREENS, liveUpCommand } from './live-registry'

export const LIVE_ALLOWLIST_FILE = path.join(PARITY_DIR, 'allowlist.live.json')
export const LIVE_REPORTS_DIR = path.join(REPORTS_DIR, 'live')
export const LIVE_FREEZE = '2026-06-13T10:36:00-04:00'

export interface StackFile {
  name: string
  schema: string
  webUrl: string
  apiUrl: string
  frozen: string | null
  devPassword: string
  profiles: string[]
  /** written by live-stack since each stack has its own dashboard build; absent on a stack started by an older script */
  distDir?: string
  backend?: string
}

export class StackError extends Error {}

export function stackFilePath(name: string): string {
  return path.join(ROOT, '.live-stack', `${name}.json`)
}

export function readStack(name: string): StackFile {
  const file = stackFilePath(name)
  if (!fs.existsSync(file))
    throw new StackError(`no live stack "${name}" (run: pnpm live:up --name ${name} ...)`)
  return JSON.parse(fs.readFileSync(file, 'utf8')) as StackFile
}

export function loadStackTarget(name: string, email: string): LiveTarget {
  const s = readStack(name)
  if (!s.frozen)
    throw new StackError(
      `stack "${name}" is not frozen: start it with --freeze ${LIVE_FREEZE} (the design's instant)`,
    )
  return { name, webUrl: s.webUrl, apiUrl: s.apiUrl, frozen: s.frozen, devPassword: s.devPassword, email }
}

export const stackProfiles = (name: string): string[] => readStack(name).profiles

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',')

/**
 * Why `stack` cannot serve `screen`'s live parity run, or an empty list when it can: it must exist, be frozen at the
 * design's instant, be seeded with exactly the screen's profiles, and serve a dashboard built for its own API.
 */
export function stackProblems(screen: Screen, s: StackFile | undefined, stackName: string): string[] {
  const want = LIVE_SCREENS[screen]
  const how = liveUpCommand(screen, LIVE_FREEZE)
  if (!s) return [`${screen}: no live stack "${stackName}". Start it with:\n    ${how}`]
  const out: string[] = []
  if (!s.frozen || new Date(s.frozen).getTime() !== new Date(LIVE_FREEZE).getTime())
    out.push(
      `${screen}: stack "${stackName}" is ${s.frozen ? `frozen at ${s.frozen}` : 'not frozen'}; the design's instant is ${LIVE_FREEZE}`,
    )
  if (!sameSet(s.profiles, want.profiles))
    out.push(
      `${screen}: stack "${stackName}" is seeded with ${s.profiles.join(',') || 'nothing'}, the screen needs exactly ${want.profiles.join(',')} (another screen's profile changes what this one shows)`,
    )
  if (s.distDir) {
    const marker = path.join(ROOT, s.distDir, 'oasis-stack.json')
    const built = fs.existsSync(marker)
      ? (JSON.parse(fs.readFileSync(marker, 'utf8')) as { apiUrl?: string }).apiUrl
      : undefined
    if (built !== s.apiUrl)
      out.push(
        `${screen}: the dashboard of stack "${stackName}" (${s.distDir}) was built for ${built ?? 'nothing (no build)'}, not for its API ${s.apiUrl}; restart the stack without --skip-build`,
      )
  } else {
    out.push(
      `${screen}: stack "${stackName}" was started by a live-stack without per-stack builds; restart it (${how})`,
    )
  }
  if (out.length) out.push(`  to recreate it: pnpm live:down --name ${stackName} --drop && ${how}`)
  return out
}

/** The stack a screen runs against (`override` = --stack), checked; throws a StackError naming every problem. */
export function screenStack(screen: Screen, email: string, override?: string): LiveTarget {
  const name = override ?? LIVE_SCREENS[screen].stack
  const file = fs.existsSync(stackFilePath(name)) ? readStack(name) : undefined
  const problems = stackProblems(screen, file, name)
  if (problems.length) throw new StackError(problems.join('\n'))
  return loadStackTarget(name, email)
}
