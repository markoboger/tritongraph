import type { ViolationRecord } from '../../../packages/triton-conformance/src/types'

/**
 * Phase 3: split head violations against the previous revision by `match_key` (Plan: neu/legacy/behoben).
 * `added` are the regressions this commit introduced, `legacy` the pre-existing debt, `fixed` what the
 * commit removed. The join is exact because every `ViolationRecord.match_key` is normalized from
 * (category, location, subject) — see triton-conformance/matchKey.ts.
 */
export interface ViolationHistory {
  added: ViolationRecord[]
  legacy: ViolationRecord[]
  fixed: ViolationRecord[]
}

export function splitViolationsByHistory(
  head: readonly ViolationRecord[],
  base: readonly ViolationRecord[],
): ViolationHistory {
  const baseKeys = new Set(base.map((v) => v.match_key))
  const headKeys = new Set(head.map((v) => v.match_key))
  return {
    added: head.filter((v) => !baseKeys.has(v.match_key)),
    legacy: head.filter((v) => baseKeys.has(v.match_key)),
    fixed: base.filter((v) => !headKeys.has(v.match_key)),
  }
}
