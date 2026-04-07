/**
 * Live benchmark monitor — polls result files and scores as questions complete.
 * Run alongside 02-run.ts: NODE_EXTRA_CA_CERTS=... OPENAI_API_KEY=... npx tsx src/live-score.ts
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { llmJudge } from './lib/llm-judge.js'
import { looksNumeric, numericMatch } from './lib/parse-number.js'
import type { RunResult } from './types.js'

const ROOT = resolve(fileURLToPath(import.meta.url), '../..')
const RESULTS_DIR = resolve(ROOT, 'results')

const ABLATION = process.argv.includes('--ablation')
const ENHANCED = process.argv.includes('--enhanced')
const suffix = ABLATION ? '-ablation' : ENHANCED ? '-enhanced' : ''

const CONFIGS = [
  { label: 'A', model: 'gpt-5.4', file: `config-A${suffix}.jsonl` },
  { label: 'B', model: 'claude-opus-4-6', file: `config-B${suffix}.jsonl` },
]

// Per-config state
const state = new Map<
  string,
  { seen: Set<string>; correct: number; total: number }
>()
for (const c of CONFIGS) {
  state.set(c.label, { seen: new Set(), correct: 0, total: 0 })
}

async function scoreResult(result: RunResult): Promise<boolean> {
  const { gold_answer, predicted_answer, question } = result

  if (
    !predicted_answer ||
    /^(not found|i (don't|do not|couldn't|could not)|unable|no (information|data|answer))/i.test(
      predicted_answer,
    )
  ) {
    return false
  }

  if (looksNumeric(gold_answer) && looksNumeric(predicted_answer)) {
    const match = numericMatch(gold_answer, predicted_answer)
    if (match !== null) return match
  }

  const { correct } = await llmJudge(question, gold_answer, predicted_answer)
  return correct
}

function render() {
  const lines: string[] = [
    `\x1b[2J\x1b[H\x1b[1mDewey FinanceBench — Live Scores${ABLATION ? ' (ablation)' : ENHANCED ? ' (enhanced)' : ''}\x1b[0m\n`,
  ]
  for (const c of CONFIGS) {
    const s = state.get(c.label)
    if (!s) continue
    const pct =
      s.total === 0 ? '—' : `${((s.correct / s.total) * 100).toFixed(1)}%`
    lines.push(`  ${c.model}: ${s.correct} / ${s.total} correct  (${pct})`)
  }
  process.stdout.write(`${lines.join('\n')}\n`)
}

async function poll() {
  for (const c of CONFIGS) {
    const path = resolve(RESULTS_DIR, c.file)
    if (!existsSync(path)) continue
    const s = state.get(c.label)
    if (!s) continue
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean)
    for (const line of lines) {
      let result: RunResult
      try {
        result = JSON.parse(line)
      } catch {
        continue
      }
      if (s.seen.has(result.financebench_id)) continue
      s.seen.add(result.financebench_id)
      s.total++
      render()
      // Score asynchronously — don't block polling
      scoreResult(result)
        .then((correct) => {
          if (correct) s.correct++
          render()
        })
        .catch((err) => { process.stderr.write(`  judge error: ${err}\n`) })
    }
  }
}

render()
// Poll every 5 seconds
setInterval(poll, 5000)
poll()
