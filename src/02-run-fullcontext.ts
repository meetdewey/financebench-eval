/**
 * Full-context baseline — Run FinanceBench questions by feeding entire PDFs
 * directly into Claude Opus 4.6's context window, with no retrieval step.
 *
 * This replicates (and extends to a current frontier model) the
 * "long-context, context-first" baseline from the original FinanceBench paper,
 * which achieved 78% with GPT-4-Turbo. We use Claude Opus 4.6's native PDF
 * support so the model reads the raw filing layout, tables, and figures
 * without any chunking or embedding.
 *
 * Output: results/config-D.jsonl  (same RunResult schema as 02-run.ts)
 *   model           = "claude-opus-4-6"
 *   depth           = "full-context"
 *   tool_call_count = 0
 *   sources_count   = 0
 *   session_id      = null
 *
 * PDFs are cached to data/pdfs/ — subsequent runs skip re-downloading.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... npm run run:fullcontext
 *   ANTHROPIC_API_KEY=sk-ant-... npm run run:fullcontext -- --concurrency 3
 */

import Anthropic from '@anthropic-ai/sdk'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Question, RunResult } from './types.js'

const ROOT = resolve(fileURLToPath(import.meta.url), '../..')
const DATA_DIR = resolve(ROOT, 'data')
const PDF_DIR = resolve(DATA_DIR, 'pdfs')
const RESULTS_DIR = resolve(ROOT, 'results')
const QUESTIONS_PATH = resolve(DATA_DIR, 'questions-merged.jsonl')
const OUTPUT_PATH = resolve(RESULTS_DIR, 'config-D.jsonl')

const PDFS_BASE =
  'https://raw.githubusercontent.com/patronus-ai/financebench/main/pdfs'

const MODEL = 'claude-opus-4-6'
const DEPTH = 'full-context'

// Parse --concurrency flag (default: 2 — PDF requests are large and slow)
const concurrencyArg = process.argv.indexOf('--concurrency')
const CONCURRENCY =
  concurrencyArg >= 0 ? Number(process.argv[concurrencyArg + 1] ?? 2) : 2

const RETRY_DELAYS_MS = [15_000, 45_000, 90_000]

// ── Anthropic client ──────────────────────────────────────────────────────────

function getClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY environment variable is not set')
  return new Anthropic({ apiKey: key })
}

// ── PDF cache ─────────────────────────────────────────────────────────────────

async function fetchPdf(docName: string): Promise<Buffer> {
  const cachePath = resolve(PDF_DIR, `${docName}.pdf`)
  if (existsSync(cachePath)) {
    return readFileSync(cachePath)
  }

  const url = `${PDFS_BASE}/${docName}.pdf`
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  writeFileSync(cachePath, bytes)
  return bytes
}

// ── Question runner ───────────────────────────────────────────────────────────

async function runQuestion(
  client: Anthropic,
  question: Question,
): Promise<RunResult> {
  let lastError: unknown

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS_MS[attempt - 1] ?? 90_000
      console.log(
        `  ↻ ${question.financebench_id}: rate-limited, retrying in ${delay / 1000}s`,
      )
      await new Promise((r) => setTimeout(r, delay))
    }

    try {
      const pdfBytes = await fetchPdf(question.doc_name)
      const pdfBase64 = pdfBytes.toString('base64')

      const t0 = Date.now()

      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system:
          'You are a precise financial analyst. Answer the question based solely on the provided SEC filing. ' +
          'Be concise — give the exact figure or a direct answer. ' +
          'If the question asks for a number, state it directly. ' +
          'If it asks for a qualitative assessment, give a clear yes/no or short phrase followed by supporting figures.',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: pdfBase64,
                },
              },
              {
                type: 'text',
                text: question.question,
              },
            ],
          },
        ],
      })

      const latency_ms = Date.now() - t0
      const predictedAnswer =
        response.content
          .filter((b) => b.type === 'text')
          .map((b) => (b as { type: 'text'; text: string }).text)
          .join('') ?? ''

      return {
        financebench_id: question.financebench_id,
        question: question.question,
        gold_answer: question.answer,
        predicted_answer: predictedAnswer.trim(),
        question_reasoning: question.question_reasoning,
        doc_name: question.doc_name,
        doc_type: question.doc_type,
        gics_sector: question.gics_sector,
        model: MODEL,
        depth: DEPTH,
        latency_ms,
        tool_call_count: 0,
        sources_count: 0,
        session_id: null,
      }
    } catch (err) {
      lastError = err
      const msg = err instanceof Error ? err.message : String(err)
      const isRetryable = /429|rate.?limit|too many|overloaded|529/i.test(msg)
      if (!isRetryable || attempt === RETRY_DELAYS_MS.length) throw err
    }
  }

  throw lastError
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function readQuestions(): Question[] {
  return readFileSync(QUESTIONS_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Question)
}

function loadCompletedIds(): Set<string> {
  if (!existsSync(OUTPUT_PATH)) return new Set()
  return new Set(
    readFileSync(OUTPUT_PATH, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => (JSON.parse(line) as RunResult).financebench_id),
  )
}

function appendResult(result: RunResult): void {
  appendFileSync(OUTPUT_PATH, `${JSON.stringify(result)}\n`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nFinanceBench — Full-context baseline (Claude Opus 4.6)\n')

  if (!existsSync(QUESTIONS_PATH)) {
    throw new Error(
      'questions-merged.jsonl not found. Run "npm run ingest" first.',
    )
  }

  mkdirSync(PDF_DIR, { recursive: true })
  mkdirSync(RESULTS_DIR, { recursive: true })

  const client = getClient()
  const questions = readQuestions()
  const completed = loadCompletedIds()
  const pending = questions.filter((q) => !completed.has(q.financebench_id))

  console.log(`Questions:   ${questions.length}`)
  console.log(`Completed:   ${completed.size}`)
  console.log(`Remaining:   ${pending.length}`)
  console.log(`Concurrency: ${CONCURRENCY}`)
  console.log(`Output:      config-D.jsonl\n`)

  if (pending.length === 0) {
    console.log('All questions already completed.')
    return
  }

  let done = completed.size
  let errors = 0
  const total = questions.length

  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const batch = pending.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map((q) => runQuestion(client, q)),
    )

    for (let j = 0; j < results.length; j++) {
      const res = results[j]
      const q = batch[j]
      if (!res || !q) continue

      if (res.status === 'fulfilled') {
        appendResult(res.value)
        done++
        const pct = ((done / total) * 100).toFixed(0)
        const latency = (res.value.latency_ms / 1000).toFixed(1)
        console.log(
          `  [${done}/${total} ${pct}%] ${q.financebench_id} — ${latency}s`,
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
    `\nDone: ${done - completed.size} new results, ${errors} errors.`,
  )
  console.log('Run "npm run score:fullcontext" next.\n')
}

main().catch((err) => {
  console.error('\nFatal error:', err)
  process.exit(1)
})
