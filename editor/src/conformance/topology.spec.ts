/**
 * Increment 2 check: the topology reader compiles the refined Ilograph Soll back into the resolved
 * lookups, and the rules loader validates architecture-rules.yaml shape.
 */
import { describe, it, expect } from 'vitest'
import { resolveTopology, componentOf } from '../../../packages/triton-conformance/src/topology'
import { parseArchitectureRules } from '../../../packages/triton-conformance/src/rules'
import { topology, topologyDocument, sollModel } from '../../../packages/triton-conformance/fixtures/miniRepo'

describe('resolveTopology', () => {
  const resolved = resolveTopology(topologyDocument)

  it('maps every module to its owning component', () => {
    expect(resolved.moduleToComponent).toEqual(topology.moduleToComponent)
  })

  it('detects components from relation endpoints', () => {
    expect([...resolved.components].sort()).toEqual([...topology.components].sort())
  })

  it('reads the allowed-edge whitelist from perspectives', () => {
    expect(resolved.allowedEdges).toEqual(topology.allowedEdges)
  })

  it('componentOf resolves mapped and unmapped modules', () => {
    expect(componentOf(resolved, 'app.domain.order')).toBe('domain')
    expect(componentOf(resolved, 'flask')).toBeNull()
  })
})

describe('parseArchitectureRules', () => {
  it('parses a well-formed rules object', () => {
    const raw = {
      rules: [
        {
          id: 'no-domain-framework-coupling',
          category: 'semantic-framework-leak',
          kind: 'semantic',
          scope: { components: ['domain'] },
          statement: sollModel.rules[0].statement,
          severity: 'error',
        },
      ],
    }
    expect(parseArchitectureRules(raw)).toEqual(sollModel.rules)
  })

  it('parses an import-boundary predicate', () => {
    const raw = {
      rules: [
        {
          id: 'api-only-entrypoint',
          category: 'visibility-break',
          kind: 'structural',
          scope: { components: ['catalog-service'] },
          statement: 'Only the api module may be imported from outside this component.',
          severity: 'error',
          predicate: { type: 'import-boundary', allowed_importers: ['api'] },
        },
      ],
    }
    expect(parseArchitectureRules(raw)[0].predicate).toEqual({
      type: 'import-boundary',
      allowed_importers: ['api'],
    })
  })

  it('throws on a missing rules array', () => {
    expect(() => parseArchitectureRules({})).toThrow(/rules/)
  })

  it('throws with a field path on an invalid kind', () => {
    const raw = { rules: [{ id: 'x', category: 'c', kind: 'bogus', scope: { components: [] }, statement: 's', severity: 'error' }] }
    expect(() => parseArchitectureRules(raw)).toThrow(/rules\[0\]\.kind/)
  })
})
