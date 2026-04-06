/**
 * Step 4 — Generate the evaluation report.
 *
 * Reads:  results/config-{A,B}-scored.jsonl
 * Writes: results/report.md  (and prints a summary to stdout)
 *
 * Usage:
 *   npm run report
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ScoredResult } from './types.js'

const ROOT = resolve(fileURLToPath(import.meta.url), '../..')
const RESULTS_DIR = resolve(ROOT, 'results')

// Published baselines from the FinanceBench paper and follow-up work
const BASELINES = [
  {
    system: 'GPT-4-Turbo (vector RAG)',
    accuracy: 0.19,
    note: 'FinanceBench paper, 2023',
  },
  {
    system: 'GPT-4-Turbo (long-context, context-first)',
    accuracy: 0.78,
    note: 'FinanceBench paper, 2023',
  },
  {
    system: 'FinSage (agentic RAG)',
    accuracy: 0.7,
    note: 'arXiv 2504.14493, 2025',
  },
  {
    system: 'LinqAlpha (specialized)',
    accuracy: 0.9723,
    note: 'LinqAlpha blog, 2024',
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function readScored(label: string): ScoredResult[] | null {
  const path = resolve(RESULTS_DIR, `config-${label}-scored.jsonl`)
  if (!existsSync(path)) return null
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ScoredResult)
}

function accuracy(results: ScoredResult[]): number {
  return results.filter((r) => r.correct).length / results.length
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    const arr = map.get(k) ?? []
    arr.push(item)
    map.set(k, arr)
  }
  return map
}

function pLatency(results: ScoredResult[], p: number): number {
  const sorted = [...results].sort((a, b) => a.latency_ms - b.latency_ms)
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]?.latency_ms ?? 0
}

function mdTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  )
  const pad = (s: string, w: number) => s.padEnd(w)
  const hr = widths.map((w) => '-'.repeat(w))
  return [
    `| ${headers.map((h, i) => pad(h, widths[i] ?? 0)).join(' | ')} |`,
    `| ${hr.join(' | ')} |`,
    ...rows.map(
      (r) => `| ${r.map((c, i) => pad(c ?? '', widths[i] ?? 0)).join(' | ')} |`,
    ),
  ].join('\n')
}

// ── Report generation ─────────────────────────────────────────────────────────

function buildReport(
  a: ScoredResult[] | null,
  b: ScoredResult[] | null,
  c: ScoredResult[] | null,
): string {
  const configs: { label: string; model: string; results: ScoredResult[] }[] =
    []
  if (a) configs.push({ label: 'A', model: 'gpt-5.4', results: a })
  if (b) configs.push({ label: 'B', model: 'claude-opus-4-6', results: b })
  if (c) configs.push({ label: 'C', model: 'gemini-2.5-pro', results: c })

  if (configs.length === 0) return '# No results found\n'

  const lines: string[] = []

  lines.push('# Dewey FinanceBench Evaluation Results\n')
  lines.push('**Endpoint:** `/research` (depth=exhaustive)  ')
  lines.push(
    '**Dataset:** [FinanceBench open-source sample](https://github.com/patronus-ai/financebench) — 150 questions  ',
  )
  lines.push(`**Date:** ${new Date().toISOString().slice(0, 10)}\n`)

  // ── Overall accuracy ──────────────────────────────────────────────────────
  lines.push('## Overall Accuracy\n')

  const overallRows: string[][] = []
  for (const { model, results } of configs) {
    const acc = accuracy(results)
    const correct = results.filter((r) => r.correct).length
    overallRows.push([
      `Dewey /research (${model})`,
      pct(acc),
      `${correct}/${results.length}`,
      'exhaustive',
    ])
  }
  for (const b of BASELINES) {
    overallRows.push([b.system, pct(b.accuracy), '—', b.note])
  }

  lines.push(
    mdTable(['System', 'Accuracy', 'Correct / Total', 'Notes'], overallRows),
  )
  lines.push('')

  // ── Breakdown by question_reasoning ──────────────────────────────────────
  lines.push('## Accuracy by Question Type\n')

  const reasoningHeaders = [
    'Question Type',
    ...configs.map((c) => c.model),
    'n',
  ]
  const allReasonings = [
    ...new Set([
      ...configs.flatMap((c) => c.results.map((r) => r.question_reasoning)),
    ]),
  ].sort()

  const reasoningRows = allReasonings.map((reasoning) => {
    const cols = configs.map((c) => {
      const subset = c.results.filter((r) => r.question_reasoning === reasoning)
      return subset.length > 0 ? pct(accuracy(subset)) : '—'
    })
    const n =
      configs[0]?.results.filter((r) => r.question_reasoning === reasoning)
        .length ?? 0
    return [reasoning, ...cols, String(n)]
  })

  lines.push(mdTable(reasoningHeaders, reasoningRows))
  lines.push('')

  // ── Breakdown by doc_type ─────────────────────────────────────────────────
  lines.push('## Accuracy by Document Type\n')

  const docTypes = [
    ...new Set(configs.flatMap((c) => c.results.map((r) => r.doc_type))),
  ].sort()
  const docTypeRows = docTypes.map((dt) => {
    const cols = configs.map((c) => {
      const subset = c.results.filter((r) => r.doc_type === dt)
      return subset.length > 0 ? pct(accuracy(subset)) : '—'
    })
    const n = configs[0]?.results.filter((r) => r.doc_type === dt).length ?? 0
    return [dt, ...cols, String(n)]
  })

  lines.push(
    mdTable(['Doc Type', ...configs.map((c) => c.model), 'n'], docTypeRows),
  )
  lines.push('')

  // ── Latency & tool use ────────────────────────────────────────────────────
  lines.push('## Latency & Tool Use (exhaustive depth)\n')

  const latencyRows = configs.map(({ model, results }) => {
    const mean = results.reduce((s, r) => s + r.latency_ms, 0) / results.length
    const meanTools =
      results.reduce((s, r) => s + r.tool_call_count, 0) / results.length
    return [
      model,
      `${(mean / 1000).toFixed(1)}s`,
      `${(pLatency(results, 50) / 1000).toFixed(1)}s`,
      `${(pLatency(results, 95) / 1000).toFixed(1)}s`,
      meanTools.toFixed(1),
    ]
  })

  lines.push(
    mdTable(['Model', 'Mean', 'p50', 'p95', 'Avg tool calls'], latencyRows),
  )
  lines.push('')

  // ── Failure analysis ──────────────────────────────────────────────────────
  lines.push('## Sample Failures (Config A — GPT-5.4)\n')

  const failures = (a ?? configs[0]?.results ?? [])
    .filter((r) => !r.correct)
    .slice(0, 10)

  for (const f of failures) {
    lines.push(`**${f.financebench_id}** (${f.question_reasoning})  `)
    lines.push(`Q: ${f.question}  `)
    lines.push(`Gold: \`${f.gold_answer}\`  `)
    lines.push(`Predicted: \`${f.predicted_answer.slice(0, 200)}\`  `)
    if (f.judge_reason) lines.push(`Judge: ${f.judge_reason}  `)
    lines.push('')
  }

  // ── Scoring methodology ───────────────────────────────────────────────────
  lines.push('## Scoring Methodology\n')
  lines.push(
    'Each answer is scored in two stages: (1) a numeric parser that applies a ±2.5% relative tolerance for financial figures, and (2) a GPT-4o-mini LLM judge for all remaining cases. Because the LLM judge is non-deterministic, re-running the scorer on the same answers can shift results by ±1–2 questions (~1%). The numbers reported above reflect a single scoring pass; treat them as accurate to within roughly ±1%.\n',
  )

  // ── Reproducibility ───────────────────────────────────────────────────────
  lines.push('## Reproducing These Results\n')
  lines.push('See the [README](../README.md) for full setup instructions.\n')
  lines.push('```bash')
  lines.push(
    'cp .env.example .env   # fill in DEWEY_API_KEY and OPENAI_API_KEY',
  )
  lines.push('npm install')
  lines.push('npm run ingest         # ~30 min — uploads SEC filings to Dewey')
  lines.push(
    'npm run run            # ~5–8 hrs — runs 150 questions × 2 models',
  )
  lines.push(
    'npm run score          # ~5 min  — scores with numeric + LLM judge',
  )
  lines.push('npm run report         # instant  — generates this report')
  lines.push('```\n')

  return lines.join('\n')
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main() {
  console.log('\nDewey FinanceBench — Step 4: Report\n')

  const ablation = process.argv.includes('--ablation')
  const sfx = ablation ? '-ablation' : ''

  const a = readScored(`A${sfx}`)
  const b = readScored(`B${sfx}`)
  const c = ablation ? null : readScored('C')

  if (!a && !b && !c) {
    console.error('No scored results found. Run "npm run score" first.')
    process.exit(1)
  }

  // Print summary to stdout
  for (const [label, results] of [
    [`A${sfx} (gpt-5.4)`, a],
    [`B${sfx} (claude-opus-4-6)`, b],
    ...(c ? [['C (gemini-2.5-pro)', c] as const] : []),
  ] as const) {
    if (!results) continue
    const acc = accuracy(results)
    const correct = results.filter((r) => r.correct).length
    console.log(`Config ${label}: ${pct(acc)} (${correct}/${results.length})`)
  }

  const report = buildReport(a, b, c)
  const reportPath = resolve(RESULTS_DIR, 'report.md')
  writeFileSync(reportPath, report)
  console.log('\nReport written to results/report.md\n')
}

main()
