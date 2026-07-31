import { appendFileSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { ChangedFact, RunAttempt, RunLog } from './types'
import type { SkippedFile } from './cliExtractor'

/**
 * Run-log persistence (C-6): one JSON Lines file per measurement campaign, appended to, never
 * rewritten. The eval harness joins against these records, so a missing value is written as null —
 * never estimated, never derived from a neighbouring field, never omitted.
 *
 * Two record types: one `run_header` per CLI invocation (written before any model call) and one
 * `llm_call` per checked file.
 */
export const LOG_SCHEMA_VERSION = '1'

export type RuleGraphMode = 'diff' | 'full'

export interface RunHeaderRecord {
  record_type: 'run_header'
  log_schema_version: string
  /** UTC ISO 8601 with milliseconds. */
  timestamp: string
  /** argv without the process name. */
  cli_args: readonly string[]
  rule_graph_mode: RuleGraphMode
  topology_path: string
  topology_sha256: string | null
  rules_path: string
  rules_sha256: string | null
  /** git HEAD of the repository under test. */
  target_repo_git_head: string | null
  /** git HEAD of this checker, null when it is not running from a git checkout. */
  checker_git_head: string | null
  base_ref: string
  src_roots: readonly string[]
  /** Null when no LLM was configured for this run — then no model was in effect at all. */
  model_requested: string | null
  /** Effective base URL, scheme + host + path only; never keys, tokens or query parameters. */
  endpoint: string | null
  seed: number | null
  temperature: number | null
  changed_files_count: number
  graph_files_count: number
  skipped: readonly SkippedFile[]
}

export interface LlmCallRecord {
  record_type: 'llm_call'
  timestamp: string
  file: string
  module: string
  model_requested: string
  /** What the provider reported; null when it reported nothing. */
  model_version: string | null
  attempts: readonly RunAttempt[]
  attempts_used: number
  valid_raw: boolean
  valid_final: boolean
  tokens_in_total: number
  tokens_out_total: number
  latency_ms_total: number
  // Aggregates carried over from RunLog — redundant with the fields above, kept for compatibility.
  temperature: number
  seed: number
  run_index: number
  tokens: { prompt: number; completion: number }
  latency_ms: number
  retries: number
  prompt_hash: string
  raw_response: string
}

export type RunLogRecord = RunHeaderRecord | LlmCallRecord

export interface RunLogWriter {
  write(record: RunLogRecord): void
}

/**
 * Open the log for appending. A log that cannot be written is fatal and must fail here, before any
 * model call is paid for — a measurement run without its log is worthless.
 */
export function createRunLogWriter(path: string): RunLogWriter {
  try {
    appendFileSync(path, '')
  } catch (err) {
    throw new Error(`cannot write run log at ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
  return {
    write(record: RunLogRecord): void {
      appendFileSync(path, `${JSON.stringify(record)}\n`)
    },
  }
}

/** sha256 of the file content, or null when it cannot be read. */
export function fileSha256(path: string): string | null {
  try {
    return createHash('sha256').update(readFileSync(path, 'utf8')).digest('hex')
  } catch {
    return null
  }
}

/** Scheme + host + path of `url`; drops credentials, query and fragment. Null when unparseable. */
export function sanitizeEndpoint(url: string): string | null {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
  } catch {
    return null
  }
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function buildLlmCallRecord(fact: ChangedFact, run: RunLog): LlmCallRecord {
  return {
    record_type: 'llm_call',
    timestamp: nowIso(),
    file: fact.path,
    module: fact.module,
    model_requested: run.model_requested,
    model_version: run.model_version_reported,
    attempts: run.attempts,
    attempts_used: run.attempts.length,
    valid_raw: run.valid_raw,
    valid_final: run.valid_final,
    tokens_in_total: run.tokens.prompt,
    tokens_out_total: run.tokens.completion,
    latency_ms_total: run.latency_ms,
    temperature: run.temperature,
    seed: run.seed,
    run_index: run.run_index,
    tokens: run.tokens,
    latency_ms: run.latency_ms,
    retries: run.retries,
    prompt_hash: run.prompt_hash,
    raw_response: run.raw_response,
  }
}
