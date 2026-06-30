import { describe, it, expect } from 'vitest'
import { buildLayerBandNodes, graphNodesOnly } from './layerBands'
import type { TritonFlowNode, TritonFlowEdge } from './flowTypes'

function node(id: string, x: number): TritonFlowNode {
  return { id, type: 'package', position: { x, y: 0 }, width: 100, height: 60, data: { label: id } } as TritonFlowNode
}
function importEdge(from: string, to: string): TritonFlowEdge {
  return { id: `${from}->${to}`, source: from, target: to, label: 'imports' } as TritonFlowEdge
}

describe('buildLayerBandNodes', () => {
  it('emits one band per depth column with the column bounds', () => {
    // a → b → c  ⇒ depths a=0, b=1, c=2 (source depends on target)
    const nodes = [node('a', 0), node('b', 200), node('c', 400)]
    const edges = [importEdge('a', 'b'), importEdge('b', 'c')]

    const bands = buildLayerBandNodes(nodes, edges)

    expect(bands.map((b) => b.id)).toEqual(['layer-band:0', 'layer-band:1', 'layer-band:2'])
    const first = bands[0]!
    // Column 0 = node 'a' at x∈[0,100], padded horizontally by 18 on each side.
    expect(first.position.x).toBe(-18)
    expect(first.width).toBe(136)
    expect(first.data!.depth).toBe(0)
  })

  it('returns no bands when there is no real layering', () => {
    expect(buildLayerBandNodes([node('solo', 0)], [])).toEqual([])
  })
})

describe('graphNodesOnly', () => {
  it('strips layer-band nodes', () => {
    const mixed = [node('a', 0), { id: 'layer-band:0', type: 'layer-band' } as TritonFlowNode]
    expect(graphNodesOnly(mixed).map((n) => n.id)).toEqual(['a'])
  })
})
