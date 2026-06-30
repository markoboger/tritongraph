/**
 * Increment 7b check: derive an as-is topology from a CodeModel (component = dotted prefix, allowed
 * edges = observed cross-component imports) and pick default rules by inner-layer name heuristic.
 */
import { describe, it, expect } from 'vitest'
import { deriveTopologyFromCodeModel } from '../../../packages/triton-conformance/src/deriveTopology'
import { defaultRules } from '../../../packages/triton-conformance/src/rules'
import type { CodeModel, CodeContainer } from '../../../packages/triton-core/src/languageModel'

const pkg = (id: string, children: CodeContainer[]): CodeContainer =>
  ({ id, name: id, kind: 'package', language: 'python', children, artefacts: [] })
const mod = (id: string): CodeContainer =>
  ({ id, name: id, kind: 'module', language: 'python', children: [], artefacts: [] })

const model: CodeModel = {
  id: 'app',
  name: 'app',
  language: 'python',
  root: {
    id: 'app', name: 'app', kind: 'workspace', language: 'python', artefacts: [],
    children: [
      pkg('app.domain', [mod('app.domain.order'), mod('app.domain.model')]),
      pkg('app.infra', [mod('app.infra.db')]),
    ],
  },
  relations: [
    { id: 'r1', from: 'app.domain.order', to: 'app.infra.db', kind: 'imports', scope: 'container' },
    { id: 'r2', from: 'app.domain.order', to: 'app.domain.model', kind: 'imports', scope: 'container' },
  ],
}

describe('deriveTopologyFromCodeModel', () => {
  const topology = deriveTopologyFromCodeModel(model, { componentDepth: 2 })

  it('names components by the dotted prefix at the given depth', () => {
    expect([...topology.components].sort()).toEqual(['app.domain', 'app.infra'])
  })

  it('maps every module to its component', () => {
    expect(topology.moduleToComponent['app.domain.order']).toBe('app.domain')
    expect(topology.moduleToComponent['app.infra.db']).toBe('app.infra')
  })

  it('allows exactly the observed cross-component edges (intra-component dropped)', () => {
    expect(topology.allowedEdges).toEqual([{ from: 'app.domain', to: 'app.infra' }])
  })
})

describe('defaultRules', () => {
  it('scopes the framework-leak rule to inner-layer components', () => {
    const topology = deriveTopologyFromCodeModel(model, { componentDepth: 2 })
    const rules = defaultRules(topology)
    expect(rules).toHaveLength(1)
    expect(rules[0]!.scope.components).toEqual(['app.domain'])
  })

  it('returns no rules when nothing looks like an inner layer', () => {
    const topology = { moduleToComponent: {}, components: ['app.web', 'app.infra'], allowedEdges: [] }
    expect(defaultRules(topology)).toEqual([])
  })
})
