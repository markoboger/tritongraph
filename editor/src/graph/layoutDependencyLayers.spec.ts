import { describe, expect, it } from 'vitest'
import { AGG_TARGET_HANDLE, DEP_SOURCE_HANDLE } from './handles'
import { applyHandleAnchorAlignment, routeSmoothstepEdgesInViewport } from './layoutDependencyLayers'

function worldAnchorY(node: any, topPct: number): number {
  return Number(node.position.y) + (Number(node.height) * topPct) / 100
}

describe('routeSmoothstepEdgesInViewport', () => {
  it('routes a left-to-right edge straight when source and target overlap vertically', () => {
    const nodes = [
      {
        id: 'left',
        type: 'module',
        position: { x: 40, y: 80 },
        width: 180,
        height: 120,
        data: {},
      },
      {
        id: 'right',
        type: 'module',
        position: { x: 320, y: 110 },
        width: 180,
        height: 120,
        data: {},
      },
    ]
    const edges = [
      {
        id: 'e1',
        source: 'left',
        target: 'right',
        sourceHandle: DEP_SOURCE_HANDLE,
        targetHandle: AGG_TARGET_HANDLE,
        label: 'depends on',
      },
    ]

    const routed = routeSmoothstepEdgesInViewport(nodes, edges, { width: 900, height: 600 })
    const alignedNodes = applyHandleAnchorAlignment(nodes, routed)
    const leftNode = alignedNodes[0]
    const rightNode = alignedNodes[1]
    const leftData = leftNode?.data as Record<string, any>
    const rightData = rightNode?.data as Record<string, any>
    const leftY = worldAnchorY(leftNode, leftData.anchorTops.aggOut['0'])
    const rightY = worldAnchorY(rightNode, rightData.anchorTops.aggIn['0'])

    expect(routed[0]).toMatchObject({ type: 'straight' })
    expect(leftY).toBeCloseTo(rightY, 4)
  })

  it('keeps stepped routing when source and target do not overlap vertically enough', () => {
    const nodes = [
      {
        id: 'left',
        type: 'module',
        position: { x: 40, y: 40 },
        width: 180,
        height: 72,
        data: {},
      },
      {
        id: 'right',
        type: 'module',
        position: { x: 320, y: 220 },
        width: 180,
        height: 72,
        data: {},
      },
    ]
    const edges = [
      {
        id: 'e1',
        source: 'left',
        target: 'right',
        sourceHandle: DEP_SOURCE_HANDLE,
        targetHandle: AGG_TARGET_HANDLE,
        label: 'depends on',
      },
    ]

    const routed = routeSmoothstepEdgesInViewport(nodes, edges, { width: 900, height: 600 })

    expect(routed[0]?.type).not.toBe('straight')
  })
})
