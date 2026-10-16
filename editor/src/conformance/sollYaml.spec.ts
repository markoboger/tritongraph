import { describe, it, expect } from 'vitest'
import { readRulesYaml, readSollYaml, writeRulesYaml } from './sollYaml'

const VALID_RULES = `
rules:
  - id: no-domain-framework-coupling
    category: semantic-framework-leak
    kind: semantic
    scope: { components: [domain] }
    statement: Domain logic must stay framework-agnostic.
    severity: error
`

const VALID_SOLL = `
resources:
  - id: domain
    children: [{ id: app.domain.order }]
  - id: infrastructure
perspectives:
  - name: Soll
    relations:
      - { from: infrastructure, to: domain }
`

describe('readRulesYaml', () => {
  it('reads a valid rules file', () => {
    expect(readRulesYaml(VALID_RULES).map((r) => r.id)).toEqual(['no-domain-framework-coupling'])
  })

  it('names the offending field', () => {
    expect(() => readRulesYaml(VALID_RULES.replace('severity: error', 'severity: fatal'))).toThrow(
      'rules[0].severity: must be error|warning',
    )
  })

  it('rejects a file without a rules array', () => {
    expect(() => readRulesYaml('foo: bar')).toThrow('expected an object with a `rules` array')
  })

  it('reports broken YAML syntax', () => {
    expect(() => readRulesYaml('rules: [')).toThrow(/^invalid YAML:/)
  })
})

describe('readSollYaml', () => {
  it('reads a valid target topology', () => {
    const topology = readSollYaml(VALID_SOLL)
    expect([...topology.components].sort()).toEqual(['domain', 'infrastructure'])
    expect(topology.moduleToComponent['app.domain.order']).toBe('domain')
  })

  it('rejects a document without relations', () => {
    expect(() => readSollYaml('resources: []\nperspectives: []')).toThrow('no components found')
  })

  it('rejects a document that is not an object', () => {
    expect(() => readSollYaml('just a string')).toThrow('expected an Ilograph document')
  })

  it('reports broken YAML syntax', () => {
    expect(() => readSollYaml('resources: [')).toThrow(/^invalid YAML:/)
  })
})

describe('writeRulesYaml', () => {
  it('round-trips through readRulesYaml, predicate included', () => {
    const rules = [
      ...readRulesYaml(VALID_RULES),
      {
        id: 'only-api-imports-core',
        category: 'structural-boundary',
        kind: 'structural' as const,
        scope: { components: ['core'] },
        statement: 'Only the api may import core.',
        severity: 'warning' as const,
        predicate: { type: 'import-boundary' as const, allowed_importers: ['api'] },
      },
    ]
    expect(readRulesYaml(writeRulesYaml(rules))).toEqual(rules)
  })
})
