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
