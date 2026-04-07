/**
 * Step 1 — Ingest FinanceBench documents into a Dewey collection.
 *
 * Downloads financebench_open_source.jsonl and financebench_document_information.jsonl
 * from the Patronus AI GitHub repo, merges them on doc_name, then uploads all
 * unique SEC filings to Dewey using the PDFs hosted in the FinanceBench repo.
 * Resumes automatically if interrupted.
 *
 * Usage:
 *   DEWEY_API_KEY=dwy_live_... npm run ingest
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCollection, getDocument, uploadDocument } from './lib/api.js'
import { loadState, saveState } from './lib/state.js'
import type { DocInfo, Question, QuestionRow } from './types.js'

const ROOT = resolve(fileURLToPath(import.meta.url), '../..')
const DATA_DIR = resolve(ROOT, 'data')
const QUESTIONS_JSONL = resolve(DATA_DIR, 'financebench_open_source.jsonl')
const DOC_INFO_JSONL = resolve(
  DATA_DIR,
  'financebench_document_information.jsonl',
)
const MERGED_JSONL = resolve(DATA_DIR, 'questions-merged.jsonl')

const QUESTIONS_URL =
  'https://raw.githubusercontent.com/patronus-ai/financebench/main/data/financebench_open_source.jsonl'
const DOC_INFO_URL =
  'https://raw.githubusercontent.com/patronus-ai/financebench/main/data/financebench_document_information.jsonl'

// Patronus AI hosts all FinanceBench PDFs directly in their GitHub repo —
// stable, pre-curated, and already named after doc_name.
const PDFS_BASE =
  'https://raw.githubusercontent.com/patronus-ai/financebench/main/pdfs'

const POLL_MS = 5_000

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseJsonl<T>(path: string): T[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`)
  return res.text()
}

async function downloadPdf(docName: string): Promise<Uint8Array> {
  const url = `${PDFS_BASE}/${docName}.pdf`
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
  return new Uint8Array(await res.arrayBuffer())
}

async function waitForReady(
  collectionId: string,
  docIds: string[],
): Promise<void> {
  const pending = new Set(docIds)
  while (pending.size > 0) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    for (const docId of [...pending]) {
      const doc = await getDocument(docId)
      if (doc.status === 'error') {
        console.error(`  ✗ Document ${docId} failed: ${doc.errorMessage}`)
        pending.delete(docId)
      } else if (doc.status === 'ready') {
        pending.delete(docId)
      }
      // Small delay between individual polls to avoid DB connection exhaustion
      await new Promise((r) => setTimeout(r, 100))
    }
    if (pending.size > 0) {
      process.stdout.write(
        `  Waiting — ${pending.size} document(s) still processing...\r`,
      )
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nDewey FinanceBench — Step 1: Ingest\n')

  mkdirSync(DATA_DIR, { recursive: true })

  // 1. Download question and document-info files
  for (const [label, url, path] of [
    ['financebench_open_source.jsonl', QUESTIONS_URL, QUESTIONS_JSONL],
    ['financebench_document_information.jsonl', DOC_INFO_URL, DOC_INFO_JSONL],
  ] as const) {
    if (!existsSync(path)) {
      process.stdout.write(`Downloading ${label}... `)
      await writeFile(path, await fetchText(url))
      console.log('done')
    } else {
      console.log(`${label} already present`)
    }
  }

  // 2. Merge on doc_name
  const questions = parseJsonl<QuestionRow>(QUESTIONS_JSONL)
  const docInfos = parseJsonl<DocInfo>(DOC_INFO_JSONL)
  const docInfoMap = new Map(docInfos.map((d) => [d.doc_name, d]))

  const merged: Question[] = []
  let missingInfo = 0
  for (const q of questions) {
    const info = docInfoMap.get(q.doc_name)
    if (!info) {
      console.warn(`  Warning: no doc info for ${q.doc_name}, skipping`)
      missingInfo++
      continue
    }
    merged.push({
      ...q,
      gics_sector: info.gics_sector,
      doc_type: info.doc_type,
      doc_period: info.doc_period,
      doc_link: info.doc_link,
    })
  }

  await writeFile(
    MERGED_JSONL,
    `${merged.map((q) => JSON.stringify(q)).join('\n')}\n`,
  )
  console.log(
    `Merged ${merged.length} questions (${missingInfo} skipped — no doc info)`,
  )

  // 3. Deduplicate documents
  const docNames = [...new Set(merged.map((q) => q.doc_name))]
  console.log(`Unique documents: ${docNames.length}`)

  // 4. Load or create state
  const state = loadState()

  if (!state.collection_id) {
    process.stdout.write('Creating Dewey collection "FinanceBench Eval"... ')
    const col = await createCollection('FinanceBench Eval')
    state.collection_id = col.id
    saveState(state)
    console.log(`id=${col.id}`)
  } else {
    console.log(`Using existing collection: ${state.collection_id}`)
  }

  const collectionId = state.collection_id

  // 5. Upload documents (skip already-ingested)
  const newDocIds: string[] = []
  let skipped = 0
  let uploaded = 0
  let failed = 0

  for (const docName of docNames) {
    if (state.ingested_docs[docName]) {
      skipped++
      continue
    }

    process.stdout.write(`  Uploading ${docName}... `)

    try {
      const bytes = await downloadPdf(docName)
      const doc = await uploadDocument(
        collectionId,
        bytes,
        `${docName}.pdf`,
        'application/pdf',
      )

      state.ingested_docs[docName] = doc.id
      saveState(state)
      newDocIds.push(doc.id)
      uploaded++
      console.log(`✓ id=${doc.id} (${(bytes.length / 1024).toFixed(0)} KB)`)
    } catch (err) {
      console.error(`✗ ${(err as Error).message}`)
      failed++
    }
  }

  console.log(
    `\nUpload summary: ${uploaded} uploaded, ${skipped} skipped, ${failed} failed`,
  )

  // 6. Wait for new documents to finish processing
  if (newDocIds.length > 0) {
    console.log(
      `\nWaiting for ${newDocIds.length} document(s) to finish processing...`,
    )
    await waitForReady(collectionId, newDocIds)
    console.log('\nAll documents ready.')
  }

  console.log(`\nCollection ID: ${collectionId}`)
  console.log('Run "npm run run" next.\n')
}

main().catch((err) => {
  console.error('\nFatal error:', err)
  process.exit(1)
})
