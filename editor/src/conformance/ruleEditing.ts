import type { ArchitectureRule } from '../../../packages/triton-conformance/src/types'

/**
 * Checks for a rule edited in the conformance checker's rules panel. Kept pure so the panel only
 * renders what these return.
 */

/** Why `rule` cannot be applied, given the other rules of the set; empty when it is fine. */
export function ruleProblems(rule: ArchitectureRule, otherRules: readonly ArchitectureRule[]): string[] {
  const problems: string[] = []
  const id = rule.id.trim()
  if (!id) problems.push('Id is required.')
  else if (otherRules.some((other) => other.id === id)) problems.push(`Id "${id}" is already used by another rule.`)
  if (!rule.category.trim()) problems.push('Category is required.')
  if (!rule.statement.trim()) problems.push('Statement is required.')
  if (rule.scope.components.length === 0) problems.push('Pick at least one component for the scope.')
  return problems
}

/** Problems of a whole rule set, each prefixed with its rule — e.g. duplicate ids from an imported file. */
export function ruleSetProblems(rules: readonly ArchitectureRule[]): string[] {
  return rules.flatMap((rule, i) =>
    ruleProblems(rule, rules.filter((_, j) => j !== i)).map((problem) => `${rule.id || `rule ${i + 1}`}: ${problem}`),
  )
}

/** Scope components the current target topology does not know — e.g. after switching the Soll. */
export function unknownScopeComponents(rule: ArchitectureRule, components: readonly string[]): string[] {
  return rule.scope.components.filter((component) => !components.includes(component))
}

/** A new semantic rule with an id that does not clash with `existing`. */
export function newSemanticRule(existing: readonly ArchitectureRule[]): ArchitectureRule {
  let n = existing.length + 1
  while (existing.some((rule) => rule.id === `rule-${n}`)) n++
  return {
    id: `rule-${n}`,
    category: '',
    kind: 'semantic',
    scope: { components: [] },
    statement: '',
    severity: 'error',
  }
}
