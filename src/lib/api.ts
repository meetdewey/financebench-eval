/**
 * Minimal Dewey API client for the eval scripts.
 * Uses the raw REST API so this package has no Dewey SDK dependency.
 */

const API_URL = (
  process.env.DEWEY_API_URL ?? 'https://api.meetdewey.com/v1'
).replace(/\/$/, '')

function apiKey(): string {
  const key = process.env.DEWEY_API_KEY
  if (!key) throw new Error('DEWEY_API_KEY environment variable is not set')
  return key
}

async function request<T>(path: string, opts: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      ...(opts.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(`Dewey API ${res.status} at ${path}: ${text}`)
  }
  return res.json() as Promise<T>
}

// ── Collections ───────────────────────────────────────────────────────────────

export async function createCollection(name: string): Promise<{ id: string }> {
  return request('/collections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export async function deleteCollection(collectionId: string): Promise<void> {
  await request(`/collections/${collectionId}`, { method: 'DELETE' })
}

// ── Documents ─────────────────────────────────────────────────────────────────

export interface DocumentRecord {
  id: string
  status:
    | 'uploading'
    | 'processing'
    | 'sectioned'
    | 'embedded'
    | 'ready'
    | 'error'
  errorMessage: string | null
}

export async function uploadDocument(
  collectionId: string,
  bytes: Uint8Array,
  filename: string,
  contentType: string,
): Promise<DocumentRecord> {
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: contentType }), filename)
  return request(`/collections/${collectionId}/documents`, {
    method: 'POST',
    body: form,
  })
}

export async function getDocument(docId: string): Promise<DocumentRecord> {
  return request(`/documents/${docId}`, { method: 'GET' })
}

// ── Research (SSE) ────────────────────────────────────────────────────────────

export type ResearchSource = {
  chunkId: string
  sectionTitle: string
  filename: string
}

export type ResearchEvent =
  | { type: 'tool_call'; query: string; tool?: string }
  | { type: 'chunk'; content: string }
  | { type: 'done'; sessionId: string; sources: ResearchSource[] }
  | { type: 'error'; message: string }

/**
 * Streams a /research response as an async generator of typed SSE events.
 * Times out after 15 minutes (generous for exhaustive depth).
 */
export async function* streamResearch(
  collectionId: string,
  question: string,
  depth: string,
  model: string,
): AsyncGenerator<ResearchEvent> {
  const res = await fetch(`${API_URL}/collections/${collectionId}/research`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ q: question, depth, model }),
    signal: AbortSignal.timeout(15 * 60 * 1000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(`Research API ${res.status}: ${text}`)
  }

  const reader = res.body?.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue
        const raw = trimmed.slice(6)
        if (raw === '[DONE]') return
        try {
          yield JSON.parse(raw) as ResearchEvent
        } catch {
          // skip malformed lines
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
