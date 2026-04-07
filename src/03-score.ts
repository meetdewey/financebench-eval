/**
 * Step 3 — Score predicted answers against gold answers.
 *
 * Two-stage scoring:
 *   1. Numeric: parse both answers as financial numbers and apply ±2.5% tolerance
 *   2. LLM judge: gpt-4o-mini evaluates semantic correctness for all other cases
 *
 * Reads:  results/config-{A,B}.jsonl
 * Writes: results/config-{A,B}-scored.jsonl
 *
 * Usage:
 *   DEWEY_API_KEY=dwy_live_... OPENAI_API_KEY=sk-... npm run score
 *
 * The OPENAI_API_KEY here is used only for the gpt-4o-mini judge calls.
 * It is not the same key used for the benchmark itself (which goes through BYOK).
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { llmJudge } from './lib/llm-judge.js'
import { looksNumeric, numericMatch } from './lib/parse-number.js'
import type { RunResult, ScoredResult } from './types.js'

const ROOT = resolve(fileURLToPath(import.meta.url), '../..')
const RESULTS_DIR = resolve(ROOT, 'results')

// LLM judge concurrency (gpt-4o-mini is fast and cheap)
const JUDGE_CONCURRENCY = 10

// ── Helpers ───────────────────────────────────────────────────────────────────

function readResults(path: string): RunResult[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RunResult)
}

async function scoreResult(result: RunResult): Promise<ScoredResult> {
  const { gold_answer, predicted_answer, question } = result

  // If the predicted answer is empty or clearly a refusal, mark incorrect immediately
  if (
    !predicted_answer ||
    /^(not found|i (don't|do not|couldn't|could not)|unable|no (information|data|answer))/i.test(
      predicted_answer,
    )
  ) {
    return {
      ...result,
      correct: false,
      scorer: 'llm-judge',
      judge_reason: 'Empty or refusal response',
    }
  }

  // Stage 1: numeric scoring
  if (looksNumeric(gold_answer) && looksNumeric(predicted_answer)) {
    const match = numericMatch(gold_answer, predicted_answer)
    if (match !== null) {
      return {
        ...result,
        correct: match,
        scorer: 'numeric',
        judge_reason: match
          ? 'Numeric match within 2.5% tolerance'
          : `Numeric mismatch: gold="${gold_answer}" predicted="${predicted_answer}"`,
      }
    }
  }

  // Stage 2: LLM judge
  const { correct, reason } = await llmJudge(
    question,
    gold_answer,
    predicted_answer,
  )
  return { ...result, correct, scorer: 'llm-judge', judge_reason: reason }
}

async function scoreConfig(label: string): Promise<void> {
  const inputPath = resolve(RESULTS_DIR, `config-${label}.jsonl`)
  const outputPath = resolve(RESULTS_DIR, `config-${label}-scored.jsonl`)

  if (!existsSync(inputPath)) {
    console.log(`  config-${label}.jsonl not found, skipping`)
    return
  }

  const results = readResults(inputPath)
  console.log(`\nScoring config ${label}: ${results.length} results`)

  const scored: ScoredResult[] = []
  let numericCount = 0
  let judgeCount = 0

  // Process in batches (rate-limit LLM judge calls)
  for (let i = 0; i < results.length; i += JUDGE_CONCURRENCY) {
    const batch = results.slice(i, i + JUDGE_CONCURRENCY)
    const batchScored = await Promise.all(batch.map(scoreResult))
    scored.push(...batchScored)

    for (const s of batchScored) {
      if (s.scorer === 'numeric') numericCount++
      else judgeCount++
    }

    const done = Math.min(i + JUDGE_CONCURRENCY, results.length)
    process.stdout.write(`  ${done}/${results.length} scored...\r`)
  }

  console.log(`\n  Numeric scorer: ${numericCount}, LLM judge: ${judgeCount}`)

  writeFileSync(
    outputPath,
    `${scored.map((r) => JSON.stringify(r)).join('\n')}\n`,
  )
  console.log(`  Written to config-${label}-scored.jsonl`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nDewey FinanceBench — Step 3: Score\n')

  const ablation = process.argv.includes('--ablation')
  const enhanced = process.argv.includes('--enhanced')
  const suffix = ablation ? '-ablation' : enhanced ? '-enhanced' : ''
  const labels = ablation || enhanced ? ['A', 'B'] : ['A', 'B', 'C']
  for (const label of labels.map((l) => `${l}${suffix}`)) {
    await scoreConfig(label)
  }

  console.log('\nScoring complete. Run "npm run report" next.\n')
}

main().catch((err) => {
  console.error('\nFatal error:', err)
  process.exit(1)
})
