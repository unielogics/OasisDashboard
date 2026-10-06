// Helpers for Playwright end-to-end scripts against a stack started by scripts/live-stack.ts.
import fs from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'

export interface LiveStack {
  name: string
  schema: string
  apiUrl: string
  webUrl: string
  apiPort: number
  webPort: number
  devPassword: string
  profiles: string[]
  frozen: string | null
}

export function loadStack(name: string): LiveStack {
  const file = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '.live-stack', `${name}.json`)
  if (!fs.existsSync(file)) throw new Error(`no live stack "${name}" (run: pnpm live:up --name ${name})`)
  return JSON.parse(fs.readFileSync(file, 'utf8')) as LiveStack
}

/** Seeded employees sign in with <first name>@oasisautospa.com and the stack's dev password. */
export const EMAILS = {
  superAdmin: 'amara@oasisautospa.com',
  manager: 'rafael@oasisautospa.com',
  crew: 'marco@oasisautospa.com',
  support: 'sofia@oasisautospa.com',
  accounting: 'daniel@oasisautospa.com',
} as const

/** Signs in through the real /login page and waits for the redirect to the app. */
export async function login(page: Page, stack: LiveStack, email: string, next = '/operations'): Promise<void> {
  await page.goto(`${stack.webUrl}/login?next=${encodeURIComponent(next)}`)
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/password/i).fill(stack.devPassword)
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 }),
    page.getByRole('button', { name: /sign in|log in/i }).click(),
  ])
}
