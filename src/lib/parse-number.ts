/**
 * Financial number parser and fuzzy-match comparator.
 *
 * Handles formats like: $3.2B, $3,200 million, 15.3%, ($125M), 3,200,000
 *
 * Used by 03-score.ts to score numerical answers with ±2.5% relative tolerance
 * before falling back to the LLM judge.
 */

// Ordered longest-first so "billions" matches before "billion" before "b"
const MULTIPLIERS: [string, number][] = [
  ['trillions', 1e12],
  ['trillion', 1e12],
  ['billions', 1e9],
  ['billion', 1e9],
  ['millions', 1e6],
  ['million', 1e6],
  ['thousands', 1e3],
  ['thousand', 1e3],
  ['bn', 1e9],
  ['mm', 1e6],
  ['b', 1e9],
  ['m', 1e6],
  ['k', 1e3],
]

/**
 * Parse a financial string to a plain number.
 * Returns null if no numeric value can be extracted.
 *
 * Examples:
 *   "$3.2B"           → 3_200_000_000
 *   "$3,200 million"  → 3_200_000_000
 *   "15.3%"           → 15.3
 *   "($125M)"         → -125_000_000
 *   "3,200,000"       → 3_200_000
 */
export function parseFinancialNumber(raw: string): number | null {
  if (!raw) return null
  let s = raw.trim().toLowerCase()

  // Strip common text that precedes a number: "approximately", "about", "~"
  s = s.replace(/^(approximately|about|~|circa)\s*/i, '')

  // Strip "per share", "per diluted share", etc. — just get the number
  s = s.replace(/\s+per\s+.+$/, '')

  // Accounting negatives: (125.4) → -125.4
  const accounting = /^\(([^)]+)\)$/.exec(s)
  const negative = accounting !== null || s.startsWith('-')
  if (accounting) s = accounting[1] ?? ''
  if (!accounting && s.startsWith('-')) s = s.slice(1)

  // Strip currency symbols
  s = s.replace(/[$€£¥]/g, '').trim()

  // Percentage indicator
  const isPercent = s.endsWith('%')
  if (isPercent) s = s.slice(0, -1).trim()

  // Extract multiplier suffix
  let multiplier = 1
  for (const [suffix, mult] of MULTIPLIERS) {
    if (s.endsWith(suffix)) {
      multiplier = mult
      s = s.slice(0, -suffix.length).trim()
      break
    }
  }

  // Remove thousands separators
  s = s.replace(/,/g, '')

  const num = Number.parseFloat(s)
  if (Number.isNaN(num)) return null

  return (negative ? -1 : 1) * num * multiplier
}

/**
 * Returns true if `gold` and `predicted` represent the same financial value
 * within `tolerancePct` relative tolerance.
 *
 * Returns null if either string doesn't appear to contain a numeric value
 * (caller should fall back to LLM judge).
 */
export function numericMatch(
  gold: string,
  predicted: string,
  tolerancePct = 2.5,
): boolean | null {
  const g = parseFinancialNumber(gold)
  const p = parseFinancialNumber(predicted)

  if (g === null || p === null) return null

  // Edge case: gold is zero
  if (g === 0) return Math.abs(p) < 1e-9

  const relDiff = Math.abs(g - p) / Math.abs(g)
  return relDiff <= tolerancePct / 100
}

/**
 * Heuristic: does this string look like it contains a financial number?
 * Used to decide whether to attempt numeric scoring.
 */
export function looksNumeric(s: string): boolean {
  // Must contain at least one digit
  if (!/\d/.test(s)) return false
  // Must not be just a year (4-digit number alone is usually a year, not a value)
  if (/^\s*\d{4}\s*$/.test(s)) return false
  return true
}
