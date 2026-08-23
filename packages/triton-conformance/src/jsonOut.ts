import { writeFileSync } from 'node:fs'
import type {
  CheckPerformed,
  CheckResult,
  Severity,
  ViolationRecord,
  ViolationSource,
  ViolationSubject,
} from './types'
import type { SkippedFile } from './cliExtractor'
import type { InvalidReason } from './reporter'

/**
 * Machine-readable measurement result (`--json-out`): one object per CLI invocation, the source the
 * eval harness computes precision and recall from.
 *
 * Division of labour with the JSONL run log: this document holds WHAT was found, per repetition and
 * without any aggregation; the run log holds WHAT IT COST — attempts, tokens, latency, raw
 * responses. The two are joined on `(run_id, file, run_index)`. Nothing is duplicated between them.
 *
 * The CLI deliberately does not deduplicate, aggregate, sort differently or take a median. Two
 * findings on the same `match_key` stay two entries; whether they collapse into one hit is a
 * pre-registered decision of the analysis, and the tool must not pre-empt it.
 */
export const RESULT_SCHEMA_VERSION = '1'

/** Everything needed to interpret the result without the run log — the document is self-supporting. */
export interface ResultProvenance {
  topology_sha256: string | null
  rules_sha256: string | null
  prompt_template_sha256: string
  user_prompt_render_sha256: string
  checker_git_head: string | null
  target_repo_git_head: string | null
  base_ref: string
  rule_graph_mode: string
  model_requested: string | null
  endpoint: string | null
  seed_requested: number | null
  temperature_requested: number | null
  runs_requested: number
  timeout_ms: number
  /** Files from the diff. Part of the run acceptance rule of an injection run (protocol §6). */
  changed_files_count: number
  /** Unchanged files checked anyway (--control-files) — the false-positive denominator. */
  control_files_count: number
}

export interface JsonFinding {
  /** Verbatim from matchKey.ts. The join against the ground truth runs on this — never reformat it. */
  match_key: string
  /** Deterministic rule-engine or model: the comparison of the two paths depends on this field. */
  source: ViolationSource
  rule_id: string
  category: string
  component: string | null
  module: string
  file: string
  line: number | null
  /** The accused symbol name — qualitative evidence that would otherwise only survive in raw_response. */
  symbol: string | null
  severity: Severity
  subject: ViolationSubject
  reason: string
  suggestion: string | null
  confidence: number | null
}

/**
 * A rule that was actually evaluated — separates "checked, nothing found" from "never in scope".
 * Carries the file as well, because the distinction is per file, not per run.
 */
export interface JsonCheckPerformed extends CheckPerformed {
  file: string
}

export interface JsonRun {
  run_index: number
  findings: JsonFinding[]
  checks_performed: JsonCheckPerformed[]
}

export interface ResultValidity {
  status: 'completed' | 'aborted'
  runs_completed: number
  calls_total: number
  calls_invalid: number
  calls_transport_failed: number
  skipped_count: number
  invalid_reasons: readonly InvalidReason[]
  exit_code: number
}

export interface ConformanceResultDocument {
  result_schema_version: string
  /** Same value as the run_header — the join key between this document and the run log. */
  run_id: string
  timestamp: string
  provenance: ResultProvenance
  /** Every repetition, including the ones the printed report never sees. */
  runs: JsonRun[]
  validity: ResultValidity
  skipped: readonly SkippedFile[]
}

export interface JsonOutWriter {
  write(document: ConformanceResultDocument): void
}

/**
 * Open the output for writing. An unwritable path is fatal and must fail here, before the first
 * model call is paid for — same rule as the run log.
 */
export function createJsonOutWriter(path: string): JsonOutWriter {
  try {
    writeFileSync(path, '')
  } catch (err) {
    throw new Error(`cannot write json out at ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
  return {
    write(document: ConformanceResultDocument): void {
      writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`)
    },
  }
}

/**
 * One repetition's results as the document sees them. Order is the order the checker produced —
 * no sorting, no deduplication, no merging of repeated `match_key`s.
 */
export function toJsonRun(runIndex: number, results: readonly CheckResult[]): JsonRun {
  const findings: JsonFinding[] = []
  const checks: JsonCheckPerformed[] = []
  for (const result of results) {
    for (const violation of result.violations) findings.push(toJsonFinding(violation))
    // Only file-bound results ever carry checks_performed, so the fallback never fires in practice.
    for (const check of result.checks_performed) checks.push({ ...check, file: result.file ?? '' })
  }
  return { run_index: runIndex, findings, checks_performed: checks }
}

function toJsonFinding(v: ViolationRecord): JsonFinding {
  return {
    match_key: v.match_key,
    source: v.source,
    rule_id: v.rule_id,
    category: v.category,
    component: v.location.component,
    module: v.location.module,
    file: v.location.file,
    line: v.location.line ?? null,
    symbol: v.location.symbol ?? null,
    severity: v.severity,
    subject: v.subject,
    reason: v.reason,
    suggestion: v.suggestion,
    confidence: v.confidence ?? null,
  }
}
