/**
 * Step 2 — Run FinanceBench questions through Dewey /research.
 *
 * Runs all 150 questions against two configurations:
 *   Config A: model=gpt-5.4,        depth=exhaustive
 *   Config B: model=claude-opus-4-6, depth=exhaustive
 *
 * Results are written to results/config-{A,B}.jsonl. The script resumes
 * automatically if interrupted — already-completed questions are skipped.
 *
 * Prerequisites:
 *   - 01-ingest.ts must have run successfully (.state.json must exist)
 *   - Both OpenAI and Anthropic BYOK keys must be configured on your Dewey
 *     project (exhaustive depth requires BYOK)
 *
 * Usage:
 *   DEWEY_API_KEY=dwy_live_... npm run run
 *   DEWEY_API_KEY=dwy_live_... npm run run -- --concurrency 3
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { streamResearch } from './lib/api.js'
import { loadState } from './lib/state.js'
import type { Question, RunResult } from './types.js'

const ROOT = resolve(fileURLToPath(import.meta.url), '../..')
const DATA_DIR = resolve(ROOT, 'data')
const RESULTS_DIR = resolve(ROOT, 'results')
const JSONL_PATH = resolve(DATA_DIR, 'questions-merged.jsonl')

// ── Config ────────────────────────────────────────────────────────────────────

interface RunConfig {
  label: string
  model: string
  depth: string
  outputPath: string
}

const CONFIGS: RunConfig[] = [
  {
    label: 'A',
    model: 'gpt-5.4',
    depth: 'exhaustive',
    outputPath: resolve(RESULTS_DIR, 'config-A.jsonl'),
  },
  {
    label: 'B',
    model: 'claude-opus-4-6',
    depth: 'exhaustive',
    outputPath: resolve(RESULTS_DIR, 'config-B.jsonl'),
  },
  {
    label: 'C',
    model: 'gemini-2.5-pro',
    depth: 'exhaustive',
    outputPath: resolve(RESULTS_DIR, 'config-C.jsonl'),
  },
]

// Parse --concurrency flag (default: 2 — conservative for exhaustive depth)
const concurrencyArg = process.argv.indexOf('--concurrency')
const CONCURRENCY =
  concurrencyArg >= 0 ? Number(process.argv[concurrencyArg + 1] ?? 2) : 2

// ── Helpers ───────────────────────────────────────────────────────────────────

function readQuestions(): Question[] {
  return readFileSync(JSONL_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Question)
}

function loadCompletedIds(outputPath: string): Set<string> {
  if (!existsSync(outputPath)) return new Set()
  return new Set(
    readFileSync(outputPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => (JSON.parse(line) as RunResult).financebench_id),
  )
}

function appendResult(outputPath: string, result: RunResult): void {
  appendFileSync(outputPath, `${JSON.stringify(result)}\n`)
}

const RETRY_DELAYS_MS = [10_000, 30_000, 60_000] // 10s, 30s, 60s

function isRateLimitError(err: unknown): boolean {
  return err instanceof Error && /429|rate.?limit|too many/i.test(err.message)
}

async function runQuestion(
  collectionId: string,
  question: Question,
  config: RunConfig,
): Promise<RunResult> {
  let lastError: unknown
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS_MS[attempt - 1] ?? 60_000
      console.log(
        `  ↻ ${question.financebench_id}: rate-limited, retrying in ${delay / 1000}s (attempt ${attempt + 1})`,
      )
      await new Promise((r) => setTimeout(r, delay))
    }

    try {
      const t0 = Date.now()
      let predictedAnswer = ''
      let toolCallCount = 0
      let sourcesCount = 0
      let sessionId: string | null = null

      for await (const event of streamResearch(
        collectionId,
        question.question,
        config.depth,
        config.model,
      )) {
        if (event.type === 'tool_call') {
          toolCallCount++
        } else if (event.type === 'chunk') {
          predictedAnswer += event.content
        } else if (event.type === 'done') {
          sessionId = event.sessionId
          sourcesCount = event.sources.length
        } else if (event.type === 'error') {
          throw new Error(`Research error: ${event.message}`)
        }
      }

      return {
        financebench_id: question.financebench_id,
        question: question.question,
        gold_answer: question.answer,
        predicted_answer: predictedAnswer.trim(),
        question_reasoning: question.question_reasoning,
        doc_name: question.doc_name,
        doc_type: question.doc_type,
        gics_sector: question.gics_sector,
        model: config.model,
        depth: config.depth,
        latency_ms: Date.now() - t0,
        tool_call_count: toolCallCount,
        sources_count: sourcesCount,
        session_id: sessionId,
      }
    } catch (err) {
      lastError = err
      if (!isRateLimitError(err) || attempt === RETRY_DELAYS_MS.length)
        throw err
    }
  }

  throw lastError
}

async function runConfig(
  collectionId: string,
  questions: Question[],
  config: RunConfig,
): Promise<void> {
  console.log(
    `\nConfig ${config.label}: model=${config.model}, depth=${config.depth}`,
  )

  mkdirSync(RESULTS_DIR, { recursive: true })
  const completed = loadCompletedIds(config.outputPath)
  const pending = questions.filter((q) => !completed.has(q.financebench_id))

  if (pending.length === 0) {
    console.log(
      `  All ${questions.length} questions already completed, skipping.`,
    )
    return
  }

  console.log(
    `  ${completed.size} already done, ${pending.length} remaining (concurrency=${CONCURRENCY})`,
  )

  let done = completed.size
  let errors = 0
  const total = questions.length

  // Process in batches of CONCURRENCY
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const batch = pending.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map((q) => runQuestion(collectionId, q, config)),
    )

    for (let j = 0; j < results.length; j++) {
      const res = results[j]
      const q = batch[j]
      if (!res || !q) continue
      if (res.status === 'fulfilled') {
        appendResult(config.outputPath, res.value)
        done++
        const pct = ((done / total) * 100).toFixed(0)
        const latency = (res.value.latency_ms / 1000).toFixed(1)
        const tools = res.value.tool_call_count
        console.log(
          `  [${done}/${total} ${pct}%] ${q.financebench_id} — ${latency}s, ${tools} tool calls`,
        )
      } else {
        errors++
        console.error(
          `  ✗ ${q.financebench_id}: ${(res as PromiseRejectedResult).reason}`,
        )
      }
    }
  }

  console.log(
    `\nConfig ${config.label} complete: ${done - completed.size} new, ${errors} errors`,
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nDewey FinanceBench — Step 2: Run\n')

  const state = loadState()
  if (!state.collection_id) {
    throw new Error('No collection found. Run "npm run ingest" first.')
  }

  const questions = readQuestions()
  console.log(`Collection: ${state.collection_id}`)
  console.log(`Questions:  ${questions.length}`)
  console.log(
    `Configs:    ${CONFIGS.map((c) => `${c.label} (${c.model})`).join(', ')}`,
  )
  console.log(
    '\nNote: exhaustive depth can take 2–8 minutes per question.',
    `Estimated total: ${Math.round((questions.length * CONFIGS.length * 4) / CONCURRENCY / 60)} hours at current concurrency.`,
  )

  for (const config of CONFIGS) {
    await runConfig(state.collection_id, questions, config)
  }

  console.log('\nAll configs complete. Run "npm run score" next.\n')
}

main().catch((err) => {
  console.error('\nFatal error:', err)
  process.exit(1)
})
