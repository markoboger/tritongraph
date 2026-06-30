/**
 * Increment 3 check: the deterministic rule-engine catches the injected STRUCTURAL violation
 * (forbidden edge) and, crucially, does NOT catch the semantic one (only the LLM can). Plus cycle
 * detection on a synthetic graph.
 */
import { describe, it, expect } from 'vitest'
import {
  runRuleEngine,
  observedImportsFromFacts,
  type ObservedImport,
} from '../../../packages/triton-conformance/src/ruleEngine'
import { validateViolationRecord } from '../../../packages/triton-conformance/src/validate'
import { topology, changedFacts, expectedViolations } from '../../../packages/triton-conformance/fixtures/miniRepo'

describe('runRuleEngine — forbidden edges', () => {
  const violations = runRuleEngine(observedImportsFromFacts(changedFacts), topology)

  it('flags exactly the injected forbidden edge (domain → infra)', () => {
    const forbidden = violations.filter((v) => v.rule_id === 'DERIVED:forbidden-edge')
    expect(forbidden).toHaveLength(1)
    expect(forbidden[0].match_key).toBe(expectedViolations[0].match_key)
    expect(forbidden[0].subject).toEqual({ from: 'domain', to: 'infra' })
    expect(forbidden[0].location).toMatchObject({ module: 'app.domain.order', component: 'domain' })
  })

  it('produces self-consistent, valid records', () => {
    for (const v of violations) expect(validateViolationRecord(v).valid).toBe(true)
  })

  it('does NOT flag the semantic framework leak (out of the engine\'s reach)', () => {
    expect(violations.some((v) => v.category === 'semantic-framework-leak')).toBe(false)
  })

  it('ignores external imports and allowed/intra-component edges', () => {
    // flask (external) and api→domain (allowed) must not appear; only the one forbidden edge does.
    expect(violations.filter((v) => v.rule_id === 'DERIVED:forbidden-edge')).toHaveLength(1)
  })
})

describe('runRuleEngine — cycles', () => {
  it('reports a back-edge that closes a component cycle', () => {
    const topo = {
      moduleToComponent: { 'a.m': 'a', 'b.m': 'b' },
      components: ['a', 'b'],
      // both directions allowed, so the ONLY finding should be the cycle (not a forbidden edge)
      allowedEdges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }],
    }
    const imports: ObservedImport[] = [
      { fromModule: 'a.m', toModule: 'b.m', file: 'a/m.py' },
      { fromModule: 'b.m', toModule: 'a.m', file: 'b/m.py' },
    ]
    const violations = runRuleEngine(imports, topo)
    const cycles = violations.filter((v) => v.rule_id === 'DERIVED:cycle')
    expect(cycles.length).toBeGreaterThanOrEqual(1)
    expect(violations.some((v) => v.rule_id === 'DERIVED:forbidden-edge')).toBe(false)
  })

  it('reports no cycle on an acyclic graph', () => {
    const violations = runRuleEngine(observedImportsFromFacts(changedFacts), topology)
    expect(violations.some((v) => v.rule_id === 'DERIVED:cycle')).toBe(false)
  })
})
