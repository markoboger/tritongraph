/**
 * Increment 1 check: the conformance contracts hold against the synthetic fixture, BEFORE any LLM
 * runs. Lives here because the editor owns the vitest runner; it imports the standalone
 * triton-conformance package by relative path (same pattern App.vue uses for triton-core).
 */
import { describe, it, expect } from 'vitest'
import { buildMatchKey, matchKeyOf } from '../../../packages/triton-conformance/src/matchKey'
import { validateViolationRecord } from '../../../packages/triton-conformance/src/validate'
import {
  topology,
  changedFacts,
  expectedViolations,
} from '../../../packages/triton-conformance/fixtures/miniRepo'

describe('match_key', () => {
  it('matches the documented example for a semantic type leak', () => {
    expect(
      buildMatchKey(
        'semantic-framework-leak',
        { component: 'domain', module: 'app.domain.order' },
        { offending_type: 'flask.Request' },
      ),
    ).toBe('semantic-framework-leak|domain|app.domain.order|flask.Request')
  })

  it('encodes forbidden edges as from->to', () => {
    expect(
      buildMatchKey('layer-violation', { component: 'domain', module: 'app.domain.order' }, { from: 'domain', to: 'infra' }),
    ).toBe('layer-violation|domain|app.domain.order|domain->infra')
  })

  it('uses empty component slot when unmapped', () => {
    expect(
      buildMatchKey('x', { component: null, module: 'm' }, { offending_type: 't' }),
    ).toBe('x||m|t')
  })

  it('falls through to the edge key when offending_type is an empty string', () => {
    // Validation allows offending_type: '' next to a valid from/to edge; the edge must still
    // distinguish the key, otherwise different forbidden edges collapse to one match_key.
    expect(
      buildMatchKey('layer-violation', { component: 'domain', module: 'm' }, { offending_type: '', from: 'a', to: 'b' }),
    ).toBe('layer-violation|domain|m|a->b')
  })
})

describe('validateViolationRecord', () => {
  it('accepts every fixture violation and they are self-consistent', () => {
    for (const v of expectedViolations) {
      const result = validateViolationRecord(v)
      expect(result.errors).toEqual([])
      expect(result.valid).toBe(true)
      expect(v.match_key).toBe(matchKeyOf(v))
    }
  })

  it('rejects a record missing the mandatory suggestion', () => {
    const broken = { ...expectedViolations[0], suggestion: '' }
    expect(validateViolationRecord(broken).valid).toBe(false)
  })

  it('rejects a record whose match_key is inconsistent', () => {
    const tampered = { ...expectedViolations[0], match_key: 'wrong' }
    const result = validateViolationRecord(tampered)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('match_key'))).toBe(true)
  })

  it('rejects confidence outside [0,1]', () => {
    const bad = { ...expectedViolations[1], confidence: 1.5 }
    expect(validateViolationRecord(bad).valid).toBe(false)
  })
})

describe('fixture integrity', () => {
  it('every changed fact resolves its component via the topology map (or is null)', () => {
    for (const fact of changedFacts) {
      const expected = topology.moduleToComponent[fact.module] ?? null
      expect(fact.component).toBe(expected)
    }
  })

  it('every import target_component is consistent with the topology map', () => {
    for (const fact of changedFacts) {
      for (const imp of fact.imports) {
        const expected = topology.moduleToComponent[imp.target] ?? null
        expect(imp.target_component).toBe(expected)
      }
    }
  })
})
