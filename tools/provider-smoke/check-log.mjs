#!/usr/bin/env node
// Compact read-only summary of a conformance run log (JSONL).
// Usage: node check-log.mjs <run.jsonl>
import { readFileSync } from 'node:fs'

const path = process.argv[2]
if (!path) {
  console.error('usage: node check-log.mjs <run.jsonl>')
  process.exit(2)
}

const records = readFileSync(path, 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line, i) => {
    try {
      return JSON.parse(line)
    } catch {
      throw new Error(`line ${i + 1} is not valid JSON`)
    }
  })

for (const record of records.filter((r) => r.record_type === 'llm_call')) {
  console.log(
    [
      `${record.file} run_index=${record.run_index}`,
      `outcome=${record.outcome}`,
      `valid_raw=${record.valid_raw}`,
      `valid_final=${record.valid_final}`,
      `model_version=${record.model_version ?? 'null'}`,
      `attempts_used=${record.attempts_used}`,
      `latency_ms_total=${record.latency_ms_total}`,
      `transport_failures=${describeTransportFailures(record.transport_failures)}`,
    ].join('  '),
  )
}

const footer = records.find((r) => r.record_type === 'run_footer')
if (!footer) {
  // A header without a footer is the checker's own signal for a run that died hard.
  console.log('\nrun_footer: MISSING — the run never closed itself')
  process.exit(0)
}
console.log(
  [
    `\nfooter: status=${footer.status}`,
    `exit_code=${footer.exit_code}`,
    `calls_total=${footer.calls_total}`,
    `calls_invalid=${footer.calls_invalid}`,
    `calls_transport_failed=${footer.calls_transport_failed}`,
  ].join('  '),
)
console.log(`invalid_reasons: ${footer.invalid_reasons.length === 0 ? '(none)' : JSON.stringify(footer.invalid_reasons)}`)

/** Count plus the kinds, so a rate limit is distinguishable from a timeout at a glance. */
function describeTransportFailures(failures) {
  if (!failures || failures.length === 0) return '0'
  return `${failures.length} (${failures.map((f) => f.kind).join(',')})`
}
