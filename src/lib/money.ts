// Money formatting reproduced from the three design logic classes. The expressions are copied, not "improved":
// the differential tests (money.diff.test.ts) run the original methods against these on a broad input set.

/** Payments r2(): round to cents the way the design does (floating point, half away from zero via Math.round). */
export const r2 = (n: number): number => Math.round(n * 100) / 100

/** Operations money(): whole dollars. A negative amount keeps the locale hyphen after the sign, as in the original. */
export const moneyWhole = (n: number): string => '$' + Math.round(n).toLocaleString('en-US')

/** Payments money(): dollars and cents with U+2212 as the minus sign. */
export const moneyCents = (n: number): string => {
  const v = r2(n)
  return (
    (v < 0 ? '−$' : '$') +
    Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  )
}

/** Payments money0(): whole dollars with U+2212 as the minus sign. */
export const moneyWhole0 = (n: number): string =>
  (n < 0 ? '−$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US')

// ---- integer cents (what the API speaks) ------------------------------------------------------------------------

/** Dollars-and-cents text for an integer number of cents, U+2212 minus (Payments style). */
export const formatCents = (cents: number): string => {
  assertCents(cents)
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100)
  const frac = abs % 100
  return (cents < 0 ? '−$' : '$') + whole.toLocaleString('en-US') + '.' + String(frac).padStart(2, '0')
}

/** Operations style: cents are shown only when the amount is not whole dollars ("$38" or "$38.50"). */
export const formatCentsCompact = (cents: number): string =>
  cents % 100 === 0 ? formatCents(cents).replace(/\.00$/, '') : formatCents(cents)

/** Tax on a subtotal in integer cents, rate in basis points (700 = 7%), rounded half up. */
export const taxCents = (subtotalCents: number, rateBp = 700): number => {
  assertCents(subtotalCents)
  if (!Number.isInteger(rateBp) || rateBp < 0)
    throw new RangeError(`rateBp must be a non-negative integer, got ${rateBp}`)
  const num = subtotalCents * rateBp
  // half up for positives; negative subtotals (adjustments) round half away from zero so tax mirrors the positive case
  const q = Math.floor((Math.abs(num) + 5000) / 10000)
  return num < 0 ? -q : q
}

function assertCents(n: number): void {
  if (!Number.isSafeInteger(n)) throw new RangeError(`expected an integer number of cents, got ${n}`)
}
