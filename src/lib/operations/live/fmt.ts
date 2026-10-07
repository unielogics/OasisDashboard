// Text helpers of the live Operations screen. Money arrives as integer cents and is shown the way the design shows it
// (whole dollars, cents only when the amount is not whole: plan D2); everything else the server already labelled.
import { formatCentsCompact } from '@/lib/money'

export const opsMoney = (cents: number): string => formatCentsCompact(cents)

export const plural = (n: number, one: string, many = one + 's'): string => `${n} ${n === 1 ? one : many}`

/** "Marcus Webb" -> "MW" (the file header avatar: first letters, at most two). */
export const initialsOf = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()

/** The first word of a plan or a person's name ("Premium Care" -> "Premium"). */
export const firstWord = (s: string): string => s.trim().split(/\s+/)[0] ?? ''
