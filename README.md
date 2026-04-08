# Dewey FinanceBench Evaluation

[Evaluating agentic RAG for financial analysis: a FinanceBench study](https://meetdewey.com/blog/financebench-eval)

This repository evaluates [Dewey](https://meetdewey.com)'s `/research` endpoint on the [FinanceBench](https://github.com/patronus-ai/financebench) benchmark — a 150-question test of financial document QA over SEC filings (10-K, 10-Q, 8-K, and earnings press releases).

We test three configurations:

| Config | Model | Depth |
|---|---|---|
| A | GPT-5.4 | exhaustive (agentic RAG) |
| B | Claude Opus 4.6 | exhaustive (agentic RAG) |
| D | Claude Opus 4.6 | full-context (no retrieval) |

## Results

Accuracy figures for configs A and B are means across 10 independent LLM-judge scoring runs to account for judge non-determinism (see [Step 5](#step-5--confidence-intervals-optional)).

| System | Accuracy | Notes |
|---|---|---|
| GPT-4-Turbo, vector RAG | 19% | FinanceBench paper, 2023 |
| **Dewey + GPT-5.4** (exhaustive) | **62.9%** | This repo |
| FinSage (agentic RAG) | ~70% | arXiv 2504.14493, 2025 |
| Claude Opus 4.6, full context | 76.0%* | This repo |
| GPT-4-Turbo, long-context | 78% | FinanceBench paper, 2023 |
| **Dewey + Claude Opus 4.6** (exhaustive) | **83.7%** | This repo |
| LinqAlpha (specialized) | 97.2% | LinqAlpha blog, 2024 |

\*Six PepsiCo 10-K filings exceed Claude's 1M-token context limit and are scored as incorrect. Accuracy on the 144 answerable documents is 79.2%.

Full breakdown by question type and document type: [results/report.md](results/report.md)

## What is FinanceBench?

FinanceBench ([Patronus AI, arXiv 2311.11944](https://arxiv.org/abs/2311.11944)) is an open benchmark of 150 expert-written questions over public SEC filings from 40 US companies. Questions test extraction, numerical reasoning (single and multi-statement), and logical inference. Scoring is binary — correct or incorrect — with ±2.5% tolerance for numerical answers.

## What is Dewey?

[Dewey](https://meetdewey.com) is a managed document backend: you upload PDFs and Dewey handles conversion, chunking, embedding, and hybrid retrieval behind a single API. The `/research` endpoint runs a multi-step agentic loop — searching, reading sections, and reasoning across documents — before producing a grounded, cited answer.

At `exhaustive` depth, the agent can make up to 50 tool calls using three tools:
- `search_collection` — hybrid BM25 + vector search over chunk content
- `scan_sections` — full-text search over section titles and summaries
- `get_section_chunks` — fetch all chunks from a specific section

## Prerequisites

1. **A Dewey account** — free at [meetdewey.com](https://meetdewey.com)
2. **BYOK configured** — `exhaustive` depth requires bringing your own API keys. In your Dewey project settings, add:
   - An **OpenAI** provider key (for Config A — GPT-5.4)
   - An **Anthropic** provider key (for Config B — Claude Opus 4.6)
3. **Node.js 20+**
4. **An OpenAI API key** for the `gpt-4o-mini` judge in the scoring step (separate from BYOK — this is called directly by the eval script, not through Dewey)

## Setup

```bash
git clone https://github.com/meetdewey/financebench-eval
cd financebench-eval
npm install
cp .env.example .env
# Edit .env — fill in DEWEY_API_KEY and OPENAI_API_KEY
```

## Running the Benchmark

The pipeline has four required steps plus two optional ones. Each step writes output to disk so you can resume if interrupted.

### Step 1 — Ingest

Downloads the FinanceBench question set and uploads all 85 unique SEC filings to a new Dewey collection. PDFs are sourced directly from the [FinanceBench GitHub repo](https://github.com/patronus-ai/financebench/tree/main/pdfs) — the same files the benchmark authors used. Skips already-uploaded documents on re-runs.

```bash
npm run ingest
```

Expected time: ~30 minutes (GitHub download + Dewey processing).

### Step 2 — Run

Runs all 150 questions against both model configurations. Results are appended to `results/config-A.jsonl` and `results/config-B.jsonl` as they complete, so the script can be safely interrupted and resumed.

```bash
npm run run
# Optional: increase concurrency (default: 2)
npm run run -- --concurrency 3
```

Expected time: **5–10 hours** at `exhaustive` depth. The agent makes 10–40 tool calls per question depending on complexity.

Estimated cost (rough): ~$150–$250 per configuration at current API pricing. Check [OpenAI pricing](https://openai.com/pricing) and [Anthropic pricing](https://www.anthropic.com/pricing) for current rates.

**Tip:** Run `npm run live` in a separate terminal to see a live accuracy estimate as results come in, without waiting for Step 3.

### Step 3 — Score

Scores each predicted answer against the gold answer using:
1. **Numeric scorer** — parses financial values (handles `$3.2B`, `3,200M`, percentages, accounting negatives) and applies ±2.5% relative tolerance
2. **LLM judge** — `gpt-4o-mini` evaluates semantic correctness for non-numeric answers and edge cases

```bash
OPENAI_API_KEY=sk-... npm run score
```

Expected time: ~5 minutes.

### Step 4 — Report

Generates `results/report.md` with accuracy breakdowns by question type, document type, and latency statistics.

```bash
npm run report
```

### Run everything in sequence

```bash
npm run all
```

### Step 5 — Confidence intervals (optional)

Re-runs the LLM judge N times on existing scored answers to estimate judge non-determinism, then reports mean accuracy ± 95% CI for each config and pairwise Welch t-test p-values. Writes raw per-run data to `results/ci.json`.

```bash
OPENAI_API_KEY=sk-... npm run ci
# Optional: set number of re-scoring runs (default: 10)
npm run ci -- --runs 5
```

Expected time: ~10–20 minutes depending on `--runs`.

## Ablation and Enhanced Variants

Two additional run modes test the effect of Dewey's post-processing features (section summarization and AI captioning) on accuracy.

| Mode | Flag | Description |
|---|---|---|
| Default | _(none)_ | Summarization and captioning enabled (collection defaults) |
| Ablation | `--ablation` | Summarization and captioning disabled — tests baseline chunked retrieval |
| Enhanced | `--enhanced` | Summarization and captioning run with GPT-5.4 (higher quality than default) |

```bash
# Run ablation (A and B only, no post-processing features)
npm run run:ablation && npm run score:ablation && npm run report:ablation

# Run enhanced (A and B only, GPT-5.4 summarization/captioning)
npm run run:enhanced && npm run score:enhanced && npm run report:enhanced
```

Results are written to `results/config-{A,B}-{ablation,enhanced}.jsonl` and scored to `config-{A,B}-{ablation,enhanced}-scored.jsonl`.

## Live Monitor (optional)

Run alongside Step 2 to see a live accuracy estimate that updates as each question completes:

```bash
# In a separate terminal while 02-run.ts is running:
OPENAI_API_KEY=sk-... npm run live            # all configs
OPENAI_API_KEY=sk-... npm run live:ablation   # ablation run
OPENAI_API_KEY=sk-... npm run live:enhanced   # enhanced run
```

The monitor polls result files every 10 seconds, scores completed answers incrementally, and prints a running accuracy table. It does not modify any result files.

## How Scoring Works

**Numerical answers** (~66% of questions): Both the gold and predicted answers are parsed to a common numeric form. A match is recorded if the relative difference is within 2.5%:

```
|gold - predicted| / |gold| ≤ 0.025
```

The parser handles: `$3.2B` → 3,200,000,000; `($125M)` → -125,000,000; `15.3%` → 15.3; `3,200 thousand` → 3,200,000.

**Text and logical answers** (~34%): Scored by `gpt-4o-mini` using a prompt that checks semantic equivalence, with explicit rules for unit normalization and partial-credit rejection.

Refusals, "not found" responses, and empty answers are always marked incorrect.

## Repository Structure

```
financebench-eval/
├── src/
│   ├── 01-ingest.ts        # Download dataset + upload PDFs to Dewey
│   ├── 02-run.ts           # Run /research for all questions × all configs
│   ├── 02-run-fullcontext.ts # Config D: Claude Opus 4.6 full-context (no retrieval)
│   ├── 03-score.ts         # Score predicted vs gold answers
│   ├── 04-report.ts        # Generate report.md
│   ├── 05-ci.ts            # Confidence intervals + Welch t-test across configs
│   ├── live-score.ts       # Live accuracy monitor (run alongside 02-run.ts)
│   ├── types.ts            # Shared TypeScript types
│   └── lib/
│       ├── api.ts          # Dewey REST API client
│       ├── parse-number.ts # Financial number parser
│       ├── llm-judge.ts    # gpt-4o-mini judge
│       └── state.ts        # Resumable run state (.state.json)
├── data/
│   └── financebench_open_source.jsonl        # Downloaded by 01-ingest (150 questions)
├── results/
│   ├── config-A-scored.jsonl                 # GPT-5.4 results with correctness labels
│   ├── config-B-scored.jsonl                 # Opus 4.6 results with correctness labels
│   ├── config-A-ablation-scored.jsonl        # GPT-5.4 ablation results
│   ├── config-B-ablation-scored.jsonl        # Opus 4.6 ablation results
│   ├── config-A-enhanced-scored.jsonl        # GPT-5.4 enhanced results
│   ├── config-B-enhanced-scored.jsonl        # Opus 4.6 enhanced results
│   ├── config-D-scored.jsonl                 # Opus 4.6 full-context results
│   ├── ci.json                               # Per-run accuracy data from 05-ci.ts
│   └── report.md                             # Final report
├── .env.example
├── package.json
└── tsconfig.json
```

## Citation

If you use these results or scripts, please cite:

```bibtex
@misc{dewey-financebench-2026,
  title        = {Dewey FinanceBench Evaluation},
  author       = {Dewey},
  year         = {2026},
  howpublished = {\url{https://github.com/meetdewey/financebench-eval}},
}

@article{islam2023financebench,
  title   = {FinanceBench: A New Benchmark for Financial Question Answering},
  author  = {Islam, Pranab and others},
  journal = {arXiv preprint arXiv:2311.11944},
  year    = {2023},
}
```

## License

MIT. The FinanceBench dataset is licensed separately by Patronus AI — see [their repository](https://github.com/patronus-ai/financebench) for terms.
