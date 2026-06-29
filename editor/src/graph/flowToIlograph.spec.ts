import { describe, expect, it } from 'vitest'
import { flowToIlographDocument } from './flowToIlograph'
import { ilographDocumentToFlow } from './ilographToFlow'
import type { ExportFlowNode } from './flowExportModel'

describe('flowToIlographDocument language round-trip', () => {
  it('preserves a leaf artefact language and its inner artefacts languages through YAML export', () => {
    const nodes: ExportFlowNode[] = [
      {
        id: 'app.analysis',
        type: 'package',
        position: { x: 0, y: 0 },
        data: {
          label: 'analysis',
          subtitle: 'module',
          innerArtefacts: [
            { id: 'app.analysis::function:get_analysis', name: 'get_analysis', subtitle: 'function', language: 'python' },
          ],
        },
      },
      {
        id: 'app.analysis::function:get_analysis',
        type: 'artefact',
        position: { x: 0, y: 0 },
        data: { label: 'get_analysis', subtitle: 'function', language: 'python' },
      },
    ]

    const doc = flowToIlographDocument(nodes, [])

    const pkg = doc.resources?.find((r) => (r as { id?: string }).id === 'app.analysis')
    expect((pkg as { 'x-triton-inner-artefacts'?: Array<{ language?: string }> })?.['x-triton-inner-artefacts']?.[0])
      .toMatchObject({ language: 'python' })

    const leaf = doc.resources?.find((r) => (r as { id?: string }).id === 'app.analysis::function:get_analysis')
    expect(leaf).toMatchObject({ 'x-triton-language': 'python' })

    // ...and re-importing the exported doc yields a flow node that still knows it's Python
    // (so the focused box keeps its language profile instead of the generic grey fallback).
    const flow = ilographDocumentToFlow(doc)
    const leafNode = flow.nodes.find((n) => n.id === 'app.analysis::function:get_analysis')
    expect(leafNode?.data).toMatchObject({ language: 'python' })
  })

  it('does not emit x-triton-language for non-artefact leaves (decorative hash must not round-trip)', () => {
    const nodes: ExportFlowNode[] = [
      { id: 'app.core', type: 'package', position: { x: 0, y: 0 }, data: { label: 'core', subtitle: 'module', language: 'ruby' } },
    ]
    const doc = flowToIlographDocument(nodes, [])
    const pkg = doc.resources?.find((r) => (r as { id?: string }).id === 'app.core')
    expect(pkg).not.toHaveProperty('x-triton-language')
  })
})
