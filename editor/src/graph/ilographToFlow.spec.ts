import { describe, expect, it } from 'vitest'
import { ilographDocumentToFlow } from './ilographToFlow'
import type { IlographDocument } from '../ilograph/types'

describe('ilographDocumentToFlow', () => {
  it('prefers the explicitly requested perspective when present', () => {
    const doc: IlographDocument = {
      resources: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      perspectives: [
        {
          name: 'dependencies',
          relations: [{ from: 'a', to: 'b', label: 'depends on' }],
        },
        {
          id: 'runtime-view',
          name: 'Runtime View',
          relations: [{ from: 'c', to: 'a', label: 'calls' }],
        },
      ],
    }

    const flow = ilographDocumentToFlow(doc, { preferredPerspectiveName: 'runtime-view' })

    expect(flow.perspectiveName).toBe('Runtime View')
    expect(flow.edges).toHaveLength(1)
    expect(flow.edges[0]).toMatchObject({
      source: 'c',
      target: 'a',
      label: 'calls',
    })
  })

  it('falls back to a named dependency perspective when the preferred id is missing', () => {
    const doc: IlographDocument = {
      resources: [{ id: 'x', name: 'X' }],
      perspectives: [
        { name: 'Empty', relations: [] },
        { name: 'dependencies', relations: [{ from: 'x', to: 'x', label: 'aggregate' }] },
      ],
    }
    const flow = ilographDocumentToFlow(doc, { preferredPerspectiveName: 'no-such-perspective' })
    expect(flow.perspectiveName).toBe('dependencies')
    expect(flow.edges).toHaveLength(1)
  })

  it('copies x-triton-preferred-leaf-height into node data', () => {
    const doc: IlographDocument = {
      resources: [{ id: 'leaf', name: 'Leaf', 'x-triton-preferred-leaf-height': 240 }],
    }
    const flow = ilographDocumentToFlow(doc)
    const node = flow.nodes.find((n) => n.id === 'leaf')
    expect((node?.data as Record<string, unknown>)?.preferredLeafHeight).toBe(240)
  })

  it('honors moduleNodeType for non-group resources', () => {
    const doc: IlographDocument = {
      resources: [{ id: 'p', name: 'Pkg' }],
    }
    const flow = ilographDocumentToFlow(doc, { moduleNodeType: 'package' })
    expect(flow.nodes.find((n) => n.id === 'p')?.type).toBe('package')
  })

  it('normalizes inner packages onto node data', () => {
    const doc: IlographDocument = {
      resources: [
        {
          id: 'root',
          name: 'Root',
          'x-triton-inner-packages': [{ id: 'c1', name: 'Child', subtitle: '  sub  ' }],
        },
      ],
    }
    const flow = ilographDocumentToFlow(doc)
    const inner = (flow.nodes.find((n) => n.id === 'root')?.data as Record<string, unknown>)?.innerPackages as
      | { id: string; name: string; subtitle?: string }[]
      | undefined
    expect(inner?.[0]).toMatchObject({ id: 'c1', name: 'Child', subtitle: '  sub  ' })
  })

  it('parses method signatures from strings and objects', () => {
    const doc = {
      resources: [
        {
          id: 'm',
          name: 'M',
          'x-triton-method-signatures': ['def foo: Unit', { signature: 'val x: Int', startRow: 12 }],
        },
      ],
    } as IlographDocument
    const flow = ilographDocumentToFlow(doc)
    const sigs = (flow.nodes.find((n) => n.id === 'm')?.data as Record<string, unknown>)?.methodSignatures as
      | { signature: string; startRow: number }[]
      | undefined
    expect(sigs).toHaveLength(2)
    expect(sigs?.[0]).toEqual({ signature: 'def foo: Unit', startRow: 0 })
    expect(sigs?.[1]).toEqual({ signature: 'val x: Int', startRow: 12 })
  })

  it('expands comma-separated relation endpoints into multiple edges', () => {
    const doc: IlographDocument = {
      resources: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
      ],
      perspectives: [
        {
          name: 'dependencies',
          relations: [{ from: 'a, b', to: 'c', label: 'link' }],
        },
      ],
    }
    const flow = ilographDocumentToFlow(doc)
    expect(flow.edges).toHaveLength(2)
    const targets = new Set(flow.edges.map((e) => e.target))
    expect(targets).toEqual(new Set(['c']))
  })

  it('marks bidirectional relations on flow edges', () => {
    const doc: IlographDocument = {
      resources: [
        { id: 'u', name: 'U' },
        { id: 'v', name: 'V' },
      ],
      perspectives: [
        {
          name: 'dependencies',
          relations: [
            { from: 'u', to: 'v', label: 'peer', arrowDirection: 'bidirectional' as const },
          ],
        },
      ],
    }
    const flow = ilographDocumentToFlow(doc)
    expect(flow.edges[0]?.markerStart).toBeDefined()
    expect(flow.edges[0]?.markerEnd).toBeDefined()
  })

  it('applies saved positions when preferSavedPositions is true', () => {
    const doc = {
      resources: [{ id: 'n', name: 'N' }],
      'x-triton-editor': { positions: { n: { x: 123, y: 456 } } },
    } as IlographDocument
    const flow = ilographDocumentToFlow(doc, { preferSavedPositions: true })
    expect(flow.nodes.find((x) => x.id === 'n')?.position).toEqual({ x: 123, y: 456 })
  })

  it('marks group containers and nests children under parent id', () => {
    const doc: IlographDocument = {
      resources: [
        {
          id: 'root',
          name: 'Root',
          children: [{ id: 'inner', name: 'Inner' }],
        },
      ],
    }
    const flow = ilographDocumentToFlow(doc)
    const root = flow.nodes.find((n) => n.id === 'root')
    const inner = flow.nodes.find((n) => n.id === 'inner')
    expect(root?.type).toBe('group')
    expect(inner?.parentNode).toBe('root')
  })

  it('sets pinned when id appears in editor pinned list', () => {
    const doc = {
      resources: [{ id: 'p', name: 'P' }],
      'x-triton-editor': { pinnedModuleIds: ['p'] },
    } as IlographDocument
    const flow = ilographDocumentToFlow(doc)
    expect((flow.nodes.find((n) => n.id === 'p')?.data as Record<string, unknown>)?.pinned).toBe(true)
  })

  it('maps inner artefact relations onto node data', () => {
    const doc = {
      resources: [
        {
          id: 'pkg',
          name: 'Pkg',
          'x-triton-inner-artefacts': [{ id: 'x', name: 'X' }],
          'x-triton-inner-artefact-relations': [{ from: 'x', to: 'x', label: 'creates' }],
        },
      ],
    } as IlographDocument
    const flow = ilographDocumentToFlow(doc)
    const rels = (flow.nodes.find((n) => n.id === 'pkg')?.data as Record<string, unknown>)?.innerArtefactRelations as
      | { from: string; to: string; label: string }[]
      | undefined
    expect(rels?.[0]).toMatchObject({ from: 'x', to: 'x', label: 'creates' })
  })

  it('includes project compartments when present', () => {
    const doc = {
      resources: [
        {
          id: 'proj',
          name: 'Proj',
          'x-triton-project-compartments': [
            { id: 'c1', title: 'Main', rows: [{ label: 'L', value: 'V' }] },
          ],
        },
      ],
    } as IlographDocument
    const flow = ilographDocumentToFlow(doc)
    const comps = (flow.nodes.find((n) => n.id === 'proj')?.data as Record<string, unknown>)?.projectCompartments as
      | { id: string; title: string }[]
      | undefined
    expect(comps?.[0]).toMatchObject({ id: 'c1', title: 'Main' })
    expect((flow.nodes.find((n) => n.id === 'proj')?.data as Record<string, unknown>)?.preferredFocusWidth).toBe(
      460,
    )
  })
})
