/**
 * Lightweight JSON state file for resumable runs.
 * Persisted at .state.json in the package root.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { State } from '../types.js'

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..')
const STATE_PATH = resolve(ROOT, '.state.json')

const DEFAULT_STATE: State = {
  collection_id: null,
  ingested_docs: {},
}

export function loadState(): State {
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8')) as State
  } catch {
    return { ...DEFAULT_STATE }
  }
}

export function saveState(state: State): void {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
}
