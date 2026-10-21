import { describe, expect, it } from 'vitest'

import { codeModelToIlographDocument } from '../../../packages/triton-core/src/codeModelToIlograph'
import type {
  CodeArtefact,
  CodeContainer,
  CodeModel,
  CodeRelation,
} from '../../../packages/triton-core/src/languageModel'

const art = (id: string, name: string): CodeArtefact => ({
  id,
  name,
  kind: 'class',
  language: 'python',
  declaration: `class ${name}`,
  source: { file: 'f.py', startRow: 0 },
  members: [],
})
const mod = (id: string, name: string, artefacts: CodeArtefact[] = []): CodeContainer => ({
  id,
  name,
  kind: 'module',
  language: 'python',
  children: [],
  artefacts,
})
const pkg = (id: string, name: string, children: CodeContainer[] = []): CodeContainer => ({
  id,
  name,
  kind: 'package',
  language: 'python',
  children,
  artefacts: [],
})
const imp = (from: string, to: string): CodeRelation => ({
  id: `r:${from}->${to}`,
  from,
  to,
  kind: 'imports',
  scope: 'container',
})
const model = (root: CodeContainer, relations: CodeRelation[] = []): CodeModel => ({
  id: 'm',
  name: 'M',
  language: 'python',
  root: { id: 'm', name: 'M', kind: 'workspace', language: 'python', children: [root], artefacts: [] },
  relations,
})

const pg = (m: CodeModel, scopeContainerId?: string) =>
  codeModelToIlographDocument(m, { projectionMode: 'package-graph', scopeContainerId }) as unknown as {
    resources: Array<Record<string, unknown> & { id: string }>
    perspectives: Array<{ relations: Array<{ from: string; to: string; label: string }> }>
  }

describe('codeModelToIlographDocument — package-graph projection', () => {
  it('collapses single-child wrappers and shows the top packages as drillable nodes', () => {
    const app = pkg('app', 'app', [
      pkg('app.core', 'core', [mod('app.core.db', 'db')]),
      pkg('app.vertiport', 'vertiport', [mod('app.vertiport.svc', 'svc')]),
    ])
    const doc = pg(model(app))
    expect(doc.resources.map((r) => r.id)).toEqual(['app.core', 'app.vertiport'])
    expect(doc.resources.every((r) => r['x-triton-node-type'] === 'package')).toBe(true)
  })

  it('rolls module imports up to the package level, dedups, and drops within-package edges', () => {
    const app = pkg('app', 'app', [
      pkg('app.core', 'core', [mod('app.core.db', 'db'), mod('app.core.cache', 'cache')]),
      pkg('app.vertiport', 'vertiport', [mod('app.vertiport.svc', 'svc')]),
    ])
    const rels = [
      imp('app.core.db', 'app.vertiport.svc'), // core -> vertiport
      imp('app.core.cache', 'app.vertiport.svc'), // core -> vertiport (dup after rollup)
      imp('app.core.db', 'app.core.cache'), // within core -> dropped
    ]
    const edges = pg(model(app, rels)).perspectives[0]!.relations
    expect(edges).toEqual([{ from: 'app.core', to: 'app.vertiport', label: 'imports' }])
  })

  it('scopes to a package and shows its immediate children', () => {
    const app = pkg('app', 'app', [
      pkg('app.core', 'core', [mod('app.core.db', 'db'), mod('app.core.cache', 'cache')]),
    ])
    const doc = pg(model(app), 'app.core')
    expect(doc.resources.map((r) => r.id)).toEqual(['app.core.db', 'app.core.cache'])
  })

  it('renders classes when the scope is a leaf module', () => {
    const db = mod('app.core.db', 'db', [art('app.core.db::class:Conn', 'Conn')])
    const app = pkg('app', 'app', [pkg('app.core', 'core', [db, mod('app.core.cache', 'cache')])])
    const doc = pg(model(app), 'app.core.db')
    expect(doc.resources).toHaveLength(1)
    const inner = doc.resources[0]!['x-triton-inner-artefacts'] as Array<{ name: string }>
    expect(inner.map((a) => a.name)).toContain('Conn')
  })
})

describe('codeModelToIlographDocument — package-graph tiles', () => {
  const app = pkg('app', 'app', [
    pkg('app.billing', 'billing', [
      pkg('app.billing.services', 'services', [mod('app.billing.services.invoice', 'invoice')]),
      pkg('app.billing.repository', 'repository', [mod('app.billing.repository.repo', 'repo')]),
      mod('app.billing.config', 'config'),
    ]),
    pkg('app.orders', 'orders', [mod('app.orders.checkout', 'checkout')]),
    pkg('app.core', 'core', [mod('app.core.settings', 'settings')]),
  ])
  const relations = [
    imp('app.orders.checkout', 'app.billing.services.invoice'),
    imp('app.core.settings', 'app.billing.repository.repo'),
    imp('app.orders.checkout', 'app.billing.repository.repo'),
    imp('app.billing.services.invoice', 'app.billing.repository.repo'), // inside billing: ignored
    imp('app.billing.services.invoice', 'flask'), // to an unknown module: ignored
  ]
  const tilesOf = (id: string) =>
    pg(model(app, relations)).resources.find((r) => r.id === id)?.['x-triton-inner-packages'] as
      | Array<{ id: string; fixed?: boolean; accessedFrom?: string[]; innerPackages?: unknown }>
      | undefined

  it('gives every box its direct children as fixed tiles, one level deep', () => {
    const tiles = tilesOf('app.billing')!
    expect(tiles.map((t) => t.id)).toEqual(['app.billing.services', 'app.billing.repository', 'app.billing.config'])
    expect(tiles.every((t) => t.fixed === true && t.innerPackages === undefined)).toBe(true)
  })

  it('lists the sibling boxes that import into each tile, not imports from inside the box', () => {
    const byId = new Map(tilesOf('app.billing')!.map((t) => [t.id, t.accessedFrom]))
    expect(byId.get('app.billing.services')).toEqual(['app.orders'])
    expect(byId.get('app.billing.repository')).toEqual(['app.core', 'app.orders'])
    expect(byId.get('app.billing.config')).toBeUndefined()
  })
})
