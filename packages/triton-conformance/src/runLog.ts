import { appendFileSync, readFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import type { CallOutcome, ChangedFact, CheckResult, RunAttempt, RunLog, TransportFailure } from './types'
import type { SkippedFile } from './cliExtractor'
import type { InvalidCall, InvalidReason } from './reporter'

/**
 * Run-log persistence (C-6): one JSON Lines file per measurement campaign, appended to, never
 * rewritten. The eval harness joins against these records, so a missing value is written as null —
 * never estimated, never derived from a neighbouring field, never omitted.
 *
 * Two record types: one `run_header` per CLI invocation (written before any model call) and one
 * `llm_call` per checked file and repetition. Both carry `run_id`, so lines stay attributable to
 * their invocation after logs are merged, sorted or split.
 */
export const LOG_SCHEMA_VERSION = '2'

export type RuleGraphMode = 'diff' | 'full'

export interface RunHeaderRecord {
  record_type: 'run_header'
  log_schema_version: string
  /** Identifies this CLI invocation; repeated on every llm_call line of the run. */
  run_id: string
  /** UTC ISO 8601 with milliseconds. */
  timestamp: string
  /** argv without the process name. */
  cli_args: readonly string[]
  rule_graph_mode: RuleGraphMode
  topology_path: string
  topology_sha256: string | null
  rules_path: string
  rules_sha256: string | null
  /** Freeze proof, part 1: sha256 over the system-prompt template constant as it exists at runtime. */
  prompt_template_sha256: string
  /**
   * Freeze proof, part 2: sha256 over buildUserPrompt(CANARY_CONTEXT). The user prompt has no
   * template — it is assembled by code — so it is pinned by hashing its render of a frozen input.
   * Together the two hashes cover the whole prompt.
   */
  user_prompt_render_sha256: string
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
  /**
   * What was asked of the provider, not what it honoured — the same requested/delivered split as
   * model_requested vs model_version. A provider may silently ignore a seed.
   */
  seed_requested: number | null
  temperature_requested: number | null
  /** Value of --runs: how many times the LLM path was repeated within this run_id. */
  runs_requested: number
  /** Value of --timeout-ms: the budget of a single model call, not of a file or of the run. */
  timeout_ms: number
  /** Transport retries allowed per call, on top of the first try. */
  transport_max_retries: number
  /** Consecutive calls lost to transport before the run gives up on the provider. */
  transport_abort_threshold: number
  changed_files_count: number
  graph_files_count: number
  skipped: readonly SkippedFile[]
}

export interface LlmCallRecord {
  record_type: 'llm_call'
  /** Same value as the run_header of this invocation. */
  run_id: string
  timestamp: string
  file: string
  module: string
  model_requested: string
  /** What the provider reported; null when it reported nothing. */
  model_version: string | null
  attempts: readonly RunAttempt[]
  attempts_used: number
  /** Null when the call never reached the model — see `outcome`. */
  valid_raw: boolean | null
  valid_final: boolean | null
  /** `transport_failed` means: not measured. It is never a statement about the model. */
  outcome: CallOutcome
  /** Failed transport tries, successful retries included — those are cost, not measurement error. */
  transport_failures: readonly TransportFailure[]
  tokens_in_total: number
  tokens_out_total: number
  latency_ms_total: number
  /** Requested, not confirmed — see RunHeaderRecord.seed_requested. */
  temperature_requested: number
  seed_requested: number
  /** 0-based repetition index within this run_id (see --runs). */
  run_index: number
  // Aggregates carried over from RunLog — redundant with the fields above, kept for compatibility.
  tokens: { prompt: number; completion: number }
  latency_ms: number
  retries: number
  prompt_hash: string
  raw_response: string
}

/**
 * Closing record, always the last line of an invocation and written even when the run throws. A
 * header without a footer therefore means: this run died hard (or was killed) — that absence is the
 * signal, so the analysis can tell an aborted run from a completed one without guessing.
 */
export interface RunFooterRecord {
  record_type: 'run_footer'
  run_id: string
  timestamp: string
  status: 'completed' | 'aborted'
  runs_requested: number
  runs_completed: number
  calls_total: number
  /** Calls the model answered, but never validly. Transport losses are NOT in here. */
  calls_invalid: number
  /** Not just the count: which file and which repetition, so the bad calls can be looked up. */
  invalid_calls: readonly InvalidCall[]
  /** Calls that never reached the model. Kept apart from calls_invalid on purpose. */
  calls_transport_failed: number
  failed_calls: readonly InvalidCall[]
  /** Calls that only completed because a transport retry worked: cost, not a measurement error. */
  calls_with_transport_retry: number
  skipped_count: number
  /** The code the process exits with. */
  exit_code: number
  invalid_reasons: readonly InvalidReason[]
  wall_clock_ms: number
}

export type RunLogRecord = RunHeaderRecord | LlmCallRecord | RunFooterRecord

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

export function sha256Text(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** sha256 of the file content, or null when it cannot be read. */
export function fileSha256(path: string): string | null {
  try {
    return sha256Text(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Identifier for one CLI invocation: compact UTC timestamp plus 8 random hex characters, e.g.
 * `20260731T110810Z-a3f19c2b`. Sortable by time, unique enough to survive merged logs.
 */
export function newRunId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `${stamp}-${randomBytes(4).toString('hex')}`
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

/**
 * Turn check results into llm_call records, pairing each result with its fact by the file identity
 * the result carries — never by position. A result that cannot be matched aborts the run: logging a
 * guessed file identity would corrupt every join the eval harness later makes.
 */
export function llmCallRecords(
  runId: string,
  facts: readonly ChangedFact[],
  results: readonly CheckResult[],
): LlmCallRecord[] {
  const factByPath = new Map(facts.map((fact) => [fact.path, fact]))
  const seen = new Set<string>()
  const records: LlmCallRecord[] = []

  for (const result of results) {
    if (!result.run) continue
    const fact = result.file === undefined ? undefined : factByPath.get(result.file)
    if (!fact) {
      throw new Error(
        `run log: check result for ${result.file ?? '(no file)'} has no matching changed fact — refusing to log a guessed file identity`,
      )
    }
    if (seen.has(fact.path)) {
      throw new Error(`run log: two check results claim the same file ${fact.path} in one run`)
    }
    seen.add(fact.path)
    records.push(buildLlmCallRecord(runId, fact, result.run))
  }
  return records
}

function buildLlmCallRecord(runId: string, fact: ChangedFact, run: RunLog): LlmCallRecord {
  return {
    record_type: 'llm_call',
    run_id: runId,
    timestamp: nowIso(),
    file: fact.path,
    module: fact.module,
    model_requested: run.model_requested,
    model_version: run.model_version_reported,
    attempts: run.attempts,
    attempts_used: run.attempts.length,
    valid_raw: run.valid_raw,
    valid_final: run.valid_final,
    outcome: run.outcome,
    transport_failures: run.transport_failures,
    tokens_in_total: run.tokens.prompt,
    tokens_out_total: run.tokens.completion,
    latency_ms_total: run.latency_ms,
    temperature_requested: run.temperature,
    seed_requested: run.seed,
    run_index: run.run_index,
    tokens: run.tokens,
    latency_ms: run.latency_ms,
    retries: run.retries,
    prompt_hash: run.prompt_hash,
    raw_response: run.raw_response,
  }
}
