export interface Evidence {
  evidence_text: string
  doc_name: string
  evidence_page_num: number
  evidence_text_full_page: string
}

/** One row from financebench_open_source.jsonl */
export interface QuestionRow {
  financebench_id: string
  company: string
  doc_name: string
  question_type: string
  /** "extraction" | "numerical-single-statement" | "numerical-multi-statement" | "logical" | ... */
  question_reasoning: string
  question: string
  answer: string
  justification: string
  evidence: Evidence[]
}

/** One row from financebench_document_information.jsonl */
export interface DocInfo {
  doc_name: string
  company: string
  gics_sector: string
  /** "10k" | "10q" | "8k" | "earnings" */
  doc_type: string
  doc_period: number
  /** Direct URL to the SEC filing */
  doc_link: string
}

/** Merged question — written to data/questions-merged.jsonl by 01-ingest */
export interface Question extends QuestionRow {
  gics_sector: string
  doc_type: string
  doc_period: number
  doc_link: string
}

/** Written to results/config-{A,B}.jsonl after 02-run */
export interface RunResult {
  financebench_id: string
  question: string
  gold_answer: string
  predicted_answer: string
  question_reasoning: string
  doc_name: string
  doc_type: string
  gics_sector: string
  model: string
  depth: string
  latency_ms: number
  tool_call_count: number
  sources_count: number
  session_id: string | null
}

/** Written to results/config-{A,B}-scored.jsonl after 03-score */
export interface ScoredResult extends RunResult {
  correct: boolean
  scorer: 'numeric' | 'llm-judge'
  judge_reason?: string
}

/** Persisted between script runs in .state.json */
export interface State {
  collection_id: string | null
  /** doc_name -> Dewey document id */
  ingested_docs: Record<string, string>
}
