import { describe, it, expect } from 'vitest'
import type { ArchitectureRule } from '../../../packages/triton-conformance/src/types'
import { newSemanticRule, ruleProblems, ruleSetProblems, unknownScopeComponents } from './ruleEditing'

const rule = (overrides: Partial<ArchitectureRule> = {}): ArchitectureRule => ({
  id: 'no-framework-leak',
  category: 'semantic-framework-leak',
  kind: 'semantic',
  scope: { components: ['domain'] },
  statement: 'Domain stays framework-agnostic.',
  severity: 'error',
  ...overrides,
})

describe('ruleProblems', () => {
  it('accepts a complete rule with a unique id', () => {
    expect(ruleProblems(rule(), [rule({ id: 'other' })])).toEqual([])
  })

  it('rejects a duplicate id', () => {
    expect(ruleProblems(rule(), [rule()])).toEqual(['Id "no-framework-leak" is already used by another rule.'])
  })

  it('lists every missing field', () => {
    const empty = rule({ id: ' ', category: '', statement: '', scope: { components: [] } })
    expect(ruleProblems(empty, [])).toHaveLength(4)
  })
})

describe('unknownScopeComponents', () => {
  it('returns the scope components missing from the topology', () => {
    expect(unknownScopeComponents(rule({ scope: { components: ['domain', 'gone'] } }), ['domain', 'api'])).toEqual(['gone'])
  })
})

describe('newSemanticRule', () => {
  it('picks an id that is not taken yet', () => {
    expect(newSemanticRule([rule({ id: 'rule-2' })]).id).toBe('rule-3')
    expect(newSemanticRule([rule({ id: 'rule-1' }), rule({ id: 'rule-3' })]).id).toBe('rule-4')
  })
})

describe('ruleSetProblems', () => {
  it('flags both rules of a duplicated id', () => {
    expect(ruleSetProblems([rule(), rule({ id: 'other' }), rule()])).toEqual([
      'no-framework-leak: Id "no-framework-leak" is already used by another rule.',
      'no-framework-leak: Id "no-framework-leak" is already used by another rule.',
    ])
  })
})
