import { describe, it, expect } from 'vitest'
import type { CodeContainer, CodeModel } from '../../../packages/triton-core/src/languageModel'
import { rollupImportRelations } from '../../../packages/triton-core/src/codeModelToIlograph'
import { resolveTopology } from '../../../packages/triton-conformance/src/topology'
import {
  applyTargetOps,
  getOrCreateSession,
  groupIntoAbstraction,
  reconcileScope,
  resolveScopeContainerId,
  serializeTargetDocument,
  type TargetEditOps,
} from './targetEditSession'

const pkg = (id: string, children: CodeContainer[]): CodeContainer =>
  ({ id, name: id, kind: 'package', language: 'python', children, artefacts: [] })
const mod = (id: string): CodeContainer =>
  ({ id, name: id, kind: 'module', language: 'python', children: [], artefacts: [] })

function buildModel(): CodeModel {
  return {
    id: 'app',
    name: 'app',
    language: 'python',
    root: {
      id: 'app', name: 'app', kind: 'workspace', language: 'python', artefacts: [],
      children: [
        pkg('app.billing', [mod('app.billing.invoice')]),
        pkg('app.orders', [mod('app.orders.cart')]),
        pkg('app.shared', [mod('app.shared.util')]),
      ],
    },
    relations: [
      { id: 'r1', from: 'app.billing.invoice', to: 'app.orders.cart', kind: 'imports', scope: 'container' },
      { id: 'r2', from: 'app.billing.invoice', to: 'app.shared.util', kind: 'imports', scope: 'container' },
    ],
  }
}

const emptyOps: TargetEditOps = {
  removedImports: [],
  addedImports: [],
  addedContainers: [],
  renames: {},
  deletedNodes: [],
  editedScopes: [],
}

describe('applyTargetOps', () => {
  it('is a no-op with empty ops', () => {
    const base = buildModel()
    const soll = applyTargetOps(base, emptyOps)
    expect(soll.root.children.map((c) => c.id)).toEqual(['app.billing', 'app.orders', 'app.shared'])
    expect(soll.relations).toHaveLength(2)
  })

  it('drops relations covered by removedImports and appends addedImports', () => {
    const base = buildModel()
    const soll = applyTargetOps(base, {
      ...emptyOps,
      removedImports: [{ from: 'app.billing', to: 'app.orders' }],
      addedImports: [{ from: 'app.orders', to: 'app.shared' }],
    })
    const rollup = rollupImportRelations(soll.relations, soll.root.children)
    expect(rollup.map((e) => `${e.from}->${e.to}`).sort()).toEqual([
      'app.billing->app.shared',
      'app.orders->app.shared',
    ])
  })

  it('deletes a subtree and drops relations touching it', () => {
    const base = buildModel()
    const soll = applyTargetOps(base, { ...emptyOps, deletedNodes: ['app.orders'] })
    expect(soll.root.children.map((c) => c.id)).toEqual(['app.billing', 'app.shared'])
    expect(soll.relations.map((r) => r.id)).toEqual(['r2'])
  })

  it('renames a container without changing its id', () => {
    const base = buildModel()
    const soll = applyTargetOps(base, { ...emptyOps, renames: { 'app.billing': 'Billing Component' } })
    expect(soll.root.children.find((c) => c.id === 'app.billing')?.name).toBe('Billing Component')
  })

  it('groups siblings under a new container and keeps their import edges rolled up (tree-membership fix)', () => {
    const base = buildModel()
    const soll = applyTargetOps(base, {
      ...emptyOps,
      addedContainers: [
        { id: 'group:core', name: 'Core', parentId: 'app', memberIds: ['app.billing', 'app.orders'] },
      ],
    })
    const groupNode = soll.root.children.find((c) => c.id === 'group:core')
    expect(groupNode?.children.map((c) => c.id).sort()).toEqual(['app.billing', 'app.orders'])
    expect(soll.root.children.map((c) => c.id).sort()).toEqual(['app.shared', 'group:core'])

    // A prefix-based rollup would miss this: 'app.billing.invoice' does not start with 'group:core'.
    const rollup = rollupImportRelations(soll.relations, soll.root.children)
    expect(rollup.map((e) => `${e.from}->${e.to}`)).toEqual(['group:core->app.shared'])
  })
})

describe('reconcileScope + serializeTargetDocument', () => {
  it('captures an edge removal, a rename, and a new pane-drop node, then round-trips through resolveTopology', () => {
    const base = buildModel()
    const session = getOrCreateSession('/repo', 'repo', base)

    // Simulate the root scope canvas after: the billing->orders edge is deleted, orders is renamed,
    // and the user drags a new empty module onto the pane.
    reconcileScope(
      session,
      undefined,
      [
        { id: 'app.billing', label: 'app.billing' },
        { id: 'app.orders', label: 'Orders v2' },
        { id: 'app.shared', label: 'app.shared' },
        { id: 'module-abc123', label: 'new-module' },
      ],
      [{ source: 'app.billing', target: 'app.shared' }],
    )

    expect(session.ops.removedImports).toContainEqual({ from: 'app.billing', to: 'app.orders' })
    expect(session.ops.renames['app.orders']).toBe('Orders v2')
    expect(session.ops.addedContainers).toContainEqual({
      id: 'module-abc123',
      name: 'new-module',
      parentId: 'app',
      memberIds: [],
    })
    expect(session.ops.editedScopes).toEqual(['app'])
    expect(session.dirty).toBe(true)

    const doc = serializeTargetDocument(session)
    const topology = resolveTopology(doc as never)
    // resolveTopology only detects components that appear as a relation endpoint (documented gap in
    // topology.ts) — 'app.orders' and 'module-abc123' have no remaining edges, so they're absent here.
    expect([...topology.components].sort()).toEqual(['app.billing', 'app.shared'])
    expect(topology.allowedEdges).toEqual([{ from: 'app.billing', to: 'app.shared' }])
  })

  it('reconciling the same scope twice does not duplicate edge ops (idempotent)', () => {
    const base = buildModel()
    const session = getOrCreateSession('/repo-idempotent', 'repo', base)
    const nodes = [
      { id: 'app.billing', label: 'app.billing' },
      { id: 'app.orders', label: 'app.orders' },
      { id: 'app.shared', label: 'app.shared' },
    ]
    const edges = [{ source: 'app.billing', target: 'app.shared' }]
    reconcileScope(session, undefined, nodes, edges)
    reconcileScope(session, undefined, nodes, edges)
    expect(session.ops.removedImports).toEqual([{ from: 'app.billing', to: 'app.orders' }])
  })

  it('groupIntoAbstraction records the group and reconcile at the group scope still sees its edges', () => {
    const base = buildModel()
    const session = getOrCreateSession('/repo-group', 'repo', base)
    const rootScopeId = resolveScopeContainerId(session, undefined)
    groupIntoAbstraction(session, rootScopeId, 'group:core', 'Core', ['app.billing', 'app.orders'])
    reconcileScope(session, undefined, [
      { id: 'group:core', label: 'Core' },
      { id: 'app.shared', label: 'app.shared' },
    ], [{ source: 'group:core', target: 'app.shared' }])

    const soll = applyTargetOps(session.baseModel, session.ops)
    expect(soll.root.children.map((c) => c.id).sort()).toEqual(['app.shared', 'group:core'])
  })

  it('groups under the collapsed scope, not the literal root, when root single-child-wraps a package', () => {
    // Repro for a real bug: a repo with one top-level package (root -[collapses through]-> shop) must
    // group new containers under `shop`, not under the true (invisible) root — otherwise the group
    // ends up as a sibling of `shop` instead of nesting alongside the members' original siblings.
    const wrapped: CodeModel = {
      id: 'ws',
      name: 'ws',
      language: 'python',
      root: {
        id: 'ws', name: 'ws', kind: 'workspace', language: 'python', artefacts: [],
        children: [pkg('shop', [mod('shop.billing'), mod('shop.orders'), mod('shop.shared')])],
      },
      relations: [],
    }
    const session = getOrCreateSession('/repo-wrapped', 'repo', wrapped)
    const rootScopeId = resolveScopeContainerId(session, undefined)
    expect(rootScopeId).toBe('shop')
    groupIntoAbstraction(session, rootScopeId, 'group:core', 'Core', ['shop.billing', 'shop.orders'])

    const soll = applyTargetOps(session.baseModel, session.ops)
    const shop = soll.root.children.find((c) => c.id === 'shop')
    expect(shop?.children.map((c) => c.id).sort()).toEqual(['group:core', 'shop.shared'])
  })
})
