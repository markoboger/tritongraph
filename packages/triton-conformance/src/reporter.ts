import type { CheckResult, ViolationRecord } from './types'

/**
 * Reporter [4]: readable output grouped by file, and a CI exit code. Exit 0 when there are no
 * `error`-severity violations, non-zero otherwise (warnings don't fail the build). This is the
 * CLI/CI deployment shape — the measurement happens in the core, not here.
 */
export function allViolations(results: readonly CheckResult[]): ViolationRecord[] {
  return results.flatMap((r) => r.violations)
}

export function exitCode(results: readonly CheckResult[]): number {
  return allViolations(results).some((v) => v.severity === 'error') ? 1 : 0
}

/** One model call, identified the way the run log identifies it. */
export interface InvalidCall {
  file: string
  run_index: number
}

export type InvalidReason =
  | 'invalid_final_response'
  | 'transport_failure'
  | 'incomplete_runs'
  | 'skipped_files'

/**
 * Live tally of one run's model calls, filled where the calls happen instead of reconstructed
 * afterwards — so a run that dies mid-batch can still say what it paid for and what it got.
 * `consecutiveTransportFailures` doubles as the outage brake (see TRANSPORT_ABORT_THRESHOLD).
 */
export interface CallTally {
  total: number
  /** Calls whose final response never validated: a statement about the model. */
  invalid: InvalidCall[]
  /** Calls that never got an answer: a statement about the infrastructure, kept strictly apart. */
  transportFailed: InvalidCall[]
  /** Calls that only completed because a transport retry worked — cost information, not an error. */
  withTransportRetry: number
  consecutiveTransportFailures: number
}

export function newCallTally(): CallTally {
  return { total: 0, invalid: [], transportFailed: [], withTransportRetry: 0, consecutiveTransportFailures: 0 }
}

/** Everything the CLI knows about whether the run itself was a sound measurement. */
export interface RunValidity {
  invalid_calls: readonly InvalidCall[]
  /** Calls lost to transport. Unsound for a different reason, so never merged into invalid_calls. */
  failed_calls: readonly InvalidCall[]
  runs_requested: number
  runs_completed: number
  skipped_count: number
}

/** Each condition alone is enough to make the run unsound; the list is the footer's evidence. */
export function invalidReasons(validity: RunValidity): InvalidReason[] {
  const reasons: InvalidReason[] = []
  if (validity.invalid_calls.length > 0) reasons.push('invalid_final_response')
  if (validity.failed_calls.length > 0) reasons.push('transport_failure')
  if (validity.runs_completed < validity.runs_requested) reasons.push('incomplete_runs')
  if (validity.skipped_count > 0) reasons.push('skipped_files')
  return reasons
}

/**
 * Exit code including measurement validity:
 *   0 no violations, 1 violations, 2 program/config error (thrown elsewhere), 3 unsound measurement.
 *
 * 3 takes precedence over 0 and 1 — a run that found violations AND produced an invalid call exits
 * 3, never 1, because otherwise the finding would hide the fact that the measurement is not
 * trustworthy. Code 3 is an attention signal for unattended runs, not a verdict: whether a
 * configuration stays usable is for the eval harness to decide in aggregate, not for the CLI.
 */
export function exitCodeFor(results: readonly CheckResult[], validity: RunValidity): number {
  if (invalidReasons(validity).length > 0) return 3
  return exitCode(results)
}

/** Plain-text explanation of exit code 3: one line per reason, with the numbers behind it. */
export function formatValidityWarnings(validity: RunValidity): string[] {
  const lines: string[] = []
  for (const reason of invalidReasons(validity)) {
    if (reason === 'invalid_final_response') {
      const calls = validity.invalid_calls.map((c) => `${c.file}#${c.run_index}`).join(', ')
      lines.push(`measurement not clean [invalid_final_response]: ${validity.invalid_calls.length} call(s) never returned a valid response — ${calls}`)
    } else if (reason === 'transport_failure') {
      const calls = validity.failed_calls.map((c) => `${c.file}#${c.run_index}`).join(', ')
      lines.push(`measurement not clean [transport_failure]: ${validity.failed_calls.length} call(s) never reached the model — ${calls}`)
    } else if (reason === 'incomplete_runs') {
      lines.push(`measurement not clean [incomplete_runs]: ${validity.runs_completed} of ${validity.runs_requested} repetition(s) completed`)
    } else {
      lines.push(`measurement not clean [skipped_files]: ${validity.skipped_count} file(s) could not be parsed`)
    }
  }
  return lines
}

export function formatReport(results: readonly CheckResult[]): string {
  const violations = allViolations(results)
  if (violations.length === 0) return 'Conformance OK — no violations.'

  const byFile = new Map<string, ViolationRecord[]>()
  for (const v of violations) {
    const list = byFile.get(v.location.file) ?? []
    list.push(v)
    byFile.set(v.location.file, list)
  }

  const lines: string[] = []
  const errors = violations.filter((v) => v.severity === 'error').length
  const warnings = violations.length - errors
  lines.push(`Conformance: ${violations.length} violation(s) — ${errors} error(s), ${warnings} warning(s)`)
  lines.push('')

  for (const [file, fileViolations] of [...byFile.entries()].sort()) {
    lines.push(`${file}`)
    for (const v of fileViolations) {
      const where = v.location.symbol ? ` ${v.location.symbol}` : ''
      lines.push(`  [${v.severity}] ${v.category} (${v.rule_id}, ${v.source})${where}`)
      lines.push(`    ${v.reason}`)
      lines.push(`    fix: ${v.suggestion}`)
    }
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}
