import type { ChangedFact, CheckResult, SollModel, ViolationRecord } from './types'
import { runRuleEngine, type ObservedImport } from './ruleEngine'
import { checkFactWithLlm, type LlmCheckOptions } from './llmChecker'
import type { LlmClient } from './llmClient'

/**
 * The single core entry both shapes call: the CLI measurement core and (Increment 7) the runtime
 * server. Combines the deterministic rule-engine [3a] and the LLM-checker [3b] into per-file
 * CheckResults — per-file granularity is the OD-3 default. Each violation already carries `source`
 * so the analysis can separate deterministic from model-based findings.
 */
export interface CheckInput {
  soll: SollModel
  changedFacts: readonly ChangedFact[]
  /**
   * Observed imports for the rule-engine. Per plan Correction 1 this should be the FULL graph
   * (cycles need it); a diff-only run can pass observedImportsFromFacts(changedFacts).
   */
  observedImports: readonly ObservedImport[]
  /** When present, in-scope rules are also checked by the LLM. */
  llm?: { client: LlmClient; options: LlmCheckOptions }
}

export async function check(input: CheckInput): Promise<CheckResult[]> {
  const structural = runRuleEngine(input.observedImports, input.soll.topology)
  const byFile = groupByFile(structural)

  const results: CheckResult[] = []
  for (const fact of input.changedFacts) {
    const structuralForFile = byFile.get(fact.path) ?? []
    byFile.delete(fact.path)

    const violations: ViolationRecord[] = [...structuralForFile]
    let checks_performed: CheckResult['checks_performed'] = []
    let run: CheckResult['run']

    if (input.llm) {
      const out = await checkFactWithLlm(fact, input.soll, input.llm.client, input.llm.options)
      violations.push(...out.violations)
      checks_performed = out.checks_performed
      run = out.run
    }
    // The file identity travels with the result; nothing downstream may re-derive it from an index.
    results.push({ file: fact.path, module: fact.module, violations, checks_performed, run })
  }

  // Structural findings in files not part of the diff (only happens in full-graph mode).
  for (const [file, viols] of byFile) results.push({ file, violations: viols, checks_performed: [] })
  return results
}

function groupByFile(violations: readonly ViolationRecord[]): Map<string, ViolationRecord[]> {
  const byFile = new Map<string, ViolationRecord[]>()
  for (const v of violations) {
    const list = byFile.get(v.location.file) ?? []
    list.push(v)
    byFile.set(v.location.file, list)
  }
  return byFile
}
