/**
 * Step 5 — Estimate LLM judge variance and compute confidence intervals.
 *
 * Re-runs the LLM judge N times on existing answers to characterise
 * judge non-determinism, then reports:
 *   - Mean accuracy ± 95% CI for each config
 *   - Two-sample t-test p-value for all pairwise comparisons
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... npx tsx src/05-ci.ts [--runs 10]
 *
 * Reads:  results/config-{A,B,A-ablation,B-ablation,A-enhanced,B-enhanced}.jsonl
 * Writes: results/ci.json  (raw per-run accuracy data)
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { llmJudge } from './lib/llm-judge.js'
import { looksNumeric, numericMatch } from './lib/parse-number.js'
import type { RunResult } from './types.js'

const ROOT = resolve(fileURLToPath(import.meta.url), '../..')
const RESULTS_DIR = resolve(ROOT, 'results')

const runsArg = process.argv.indexOf('--runs')
const N_RUNS = runsArg >= 0 ? Number(process.argv[runsArg + 1] ?? 10) : 10

const JUDGE_CONCURRENCY = 10

// ── Helpers ───────────────────────────────────────────────────────────────────

function readResults(label: string): RunResult[] | null {
  const path = resolve(RESULTS_DIR, `config-${label}.jsonl`)
  if (!existsSync(path)) return null
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as RunResult)
}

async function scoreOnce(results: RunResult[]): Promise<number> {
  let correct = 0
  for (let i = 0; i < results.length; i += JUDGE_CONCURRENCY) {
    const batch = results.slice(i, i + JUDGE_CONCURRENCY)
    const verdicts = await Promise.all(
      batch.map(async (r) => {
        if (
          !r.predicted_answer ||
          /^(not found|i (don't|do not|couldn't|could not)|unable|no (information|data|answer))/i.test(
            r.predicted_answer,
          )
        )
          return false
        if (looksNumeric(r.gold_answer) && looksNumeric(r.predicted_answer)) {
          const m = numericMatch(r.gold_answer, r.predicted_answer)
          if (m !== null) return m
        }
        const { correct } = await llmJudge(
          r.question,
          r.gold_answer,
          r.predicted_answer,
        )
        return correct
      }),
    )
    correct += verdicts.filter(Boolean).length
  }
  return correct / results.length
}

// ── Statistics ────────────────────────────────────────────────────────────────

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length
}

function std(xs: number[]): number {
  const m = mean(xs)
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}

/** Two-sample Welch's t-test, returns p-value (two-tailed). */
function welchP(a: number[], b: number[]): number {
  const ma = mean(a)
  const mb = mean(b)
  const sa = std(a)
  const sb = std(b)
  const na = a.length
  const nb = b.length
  const se = Math.sqrt(sa ** 2 / na + sb ** 2 / nb)
  if (se === 0) return 1
  const t = Math.abs(ma - mb) / se
  // Welch–Satterthwaite degrees of freedom
  const df =
    (sa ** 2 / na + sb ** 2 / nb) ** 2 /
    ((sa ** 2 / na) ** 2 / (na - 1) + (sb ** 2 / nb) ** 2 / (nb - 1))
  // Approximate p-value via Student t CDF (Hill 1970 algorithm)
  return 2 * (1 - tCDF(t, df))
}

/** Regularised incomplete beta function approximation for t-distribution CDF. */
function tCDF(t: number, df: number): number {
  const x = df / (df + t * t)
  return 1 - 0.5 * incompleteBeta(x, df / 2, 0.5)
}

function incompleteBeta(x: number, a: number, b: number): number {
  // Continued fraction expansion (Lentz method, simplified)
  if (x < 0 || x > 1) return Number.NaN
  if (x === 0) return 0
  if (x === 1) return 1
  const lbeta =
    lgamma(a + b) -
    lgamma(a) -
    lgamma(b) +
    a * Math.log(x) +
    b * Math.log(1 - x)
  const front = Math.exp(lbeta) / a
  // Use symmetry if needed
  if (x > (a + 1) / (a + b + 2)) return 1 - incompleteBeta(1 - x, b, a)
  let f = 1
  let C = 1
  let D = 1 - ((a + b) * x) / (a + 1)
  if (Math.abs(D) < 1e-30) D = 1e-30
  D = 1 / D
  f = D
  for (let m = 1; m <= 200; m++) {
    // Even step
    let num = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m))
    D = 1 + num * D
    C = 1 + num / C
    if (Math.abs(D) < 1e-30) D = 1e-30
    if (Math.abs(C) < 1e-30) C = 1e-30
    D = 1 / D
    f *= D * C
    // Odd step
    num = (-(a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1))
    D = 1 + num * D
    C = 1 + num / C
    if (Math.abs(D) < 1e-30) D = 1e-30
    if (Math.abs(C) < 1e-30) C = 1e-30
    D = 1 / D
    const delta = D * C
    f *= delta
    if (Math.abs(delta - 1) < 1e-10) break
  }
  return front * f
}

function lgamma(x: number): number {
  // Stirling series approximation
  const c = [
    76.18009172947146,
    // biome-ignore lint/correctness/noPrecisionLoss: Lanczos approximation constant
    -86.50532032941677,
    24.01409824083091, -1.231739572450155, 0.001208650973866179,
    -0.000005395239384953,
  ]
  let y = x
  let tmp = x + 5.5
  tmp -= (x + 0.5) * Math.log(tmp)
  let ser = 1.000000000190015
  for (const ci of c) ser += ci / ++y
  // biome-ignore lint/correctness/noPrecisionLoss: Lanczos approximation constant
  return -tmp + Math.log((2.5066282746310005 * ser) / x)
}

// ── Main ──────────────────────────────────────────────────────────────────────

const CONFIGS = [
  { label: 'A', desc: 'gpt-5.4 (gpt-4o-mini features)' },
  { label: 'A-ablation', desc: 'gpt-5.4 (no features)' },
  { label: 'A-enhanced', desc: 'gpt-5.4 (gpt-5.4 features)' },
  { label: 'B', desc: 'claude-opus-4-6 (gpt-4o-mini features)' },
  { label: 'B-ablation', desc: 'claude-opus-4-6 (no features)' },
  { label: 'B-enhanced', desc: 'claude-opus-4-6 (gpt-5.4 features)' },
  { label: 'D', desc: 'claude-opus-4-6 (full-context, no retrieval)' },
]

async function main() {
  console.log(
    `\nDewey FinanceBench — Step 5: Confidence Intervals (${N_RUNS} runs)\n`,
  )

  const data: Record<string, number[]> = {}
  const results: Record<string, RunResult[]> = {}

  for (const { label, desc } of CONFIGS) {
    const r = readResults(label)
    if (!r) {
      console.log(`  Skipping ${label} (not found)`)
      continue
    }
    results[label] = r
    data[label] = []
    console.log(`Scoring ${desc} × ${N_RUNS} runs...`)
    for (let i = 0; i < N_RUNS; i++) {
      const acc = await scoreOnce(r)
      data[label].push(acc)
      const pct = (acc * 100).toFixed(1)
      process.stdout.write(`  run ${i + 1}/${N_RUNS}: ${pct}%\n`)
    }
  }

  console.log('\n── Results ────────────────────────────────────────────────\n')

  for (const { label, desc } of CONFIGS) {
    const xs = data[label]
    if (!xs?.length) continue
    const m = mean(xs) * 100
    const s = std(xs) * 100
    const ci = (1.96 * s) / Math.sqrt(xs.length)
    console.log(`${desc}`)
    console.log(
      `  mean ${m.toFixed(2)}%  std ${s.toFixed(2)}%  95% CI ±${ci.toFixed(2)}%\n`,
    )
  }

  console.log('── Pairwise p-values (Welch t-test) ────────────────────────\n')

  const comparisons: [string, string, string][] = [
    ['A', 'A-ablation', 'gpt-5.4: gpt-4o-mini features vs no features'],
    ['A-enhanced', 'A-ablation', 'gpt-5.4: gpt-5.4 features vs no features'],
    ['A-enhanced', 'A', 'gpt-5.4: gpt-5.4 features vs gpt-4o-mini features'],
    ['B', 'B-ablation', 'claude-opus-4-6: gpt-4o-mini features vs no features'],
    ['B-enhanced', 'B-ablation', 'claude-opus-4-6: gpt-5.4 features vs no features'],
    ['B-enhanced', 'B', 'claude-opus-4-6: gpt-5.4 features vs gpt-4o-mini features'],
  ]

  for (const [base, comp, label] of comparisons) {
    const xs = data[base]
    const ys = data[comp]
    if (!xs?.length || !ys?.length) continue
    const p = welchP(xs, ys)
    const delta = (mean(xs) - mean(ys)) * 100
    const sig = p < 0.05 ? '✓ significant' : '✗ not significant'
    console.log(
      `${label}\n  delta ${delta > 0 ? '+' : ''}${delta.toFixed(2)}%  p=${p.toFixed(3)}  ${sig}\n`,
    )
  }

  writeFileSync(resolve(RESULTS_DIR, 'ci.json'), JSON.stringify(data, null, 2))
  console.log('\nRaw data written to results/ci.json\n')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
