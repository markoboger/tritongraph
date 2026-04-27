import { describe, expect, it } from 'vitest'
import { AGG_TARGET_HANDLE, DEP_SOURCE_HANDLE } from './handles'
import {
  applyHandleAnchorAlignment,
  annotateAggregateVerticalPaths,
  annotateParallelAggregateEdgeOffsets,
  computeLayerDrillColumnLayout,
  computeModuleHiddenForDependencyLayout,
  dependencyDepthsInRegion,
  focusedModuleWidthForDrill,
  fullWidthFocusBoundsForLayerDrill,
  layoutDepthInViewport,
  mergeEdgeHiddenForInvisibleEndpoints,
  regionStackMetrics,
  relayoutSubtreeIntoBounds,
  routeSmoothstepEdgesInViewport,
  verticalBandForLayerDrill,
} from './layoutDependencyLayers'

function worldAnchorY(node: any, topPct: number): number {
  return Number(node.position.y) + (Number(node.height) * topPct) / 100
}

describe('routeSmoothstepEdgesInViewport', () => {
  it('uses smoothstep centerY for a horizontal band when source and target overlap vertically', () => {
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

    expect(routed[0]).toMatchObject({ type: 'smoothstep' })
    const centerY = (routed[0] as { pathOptions?: { centerY?: number } }).pathOptions?.centerY
    expect(centerY).toBeDefined()
    expect(centerY).toBeCloseTo(155, 4)
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

describe('dependencyDepthsInRegion', () => {
  it('increments depth along a classpath chain in the root region', () => {
    const nodes = [
      { id: 'a', type: 'module' },
      { id: 'b', type: 'module' },
      { id: 'c', type: 'module' },
    ]
    const edges = [
      { source: 'a', target: 'b', label: 'depends on' },
      { source: 'b', target: 'c', label: 'depends on' },
    ]
    const depths = dependencyDepthsInRegion(nodes, edges, undefined)
    expect(depths.get('a')).toBe(0)
    expect(depths.get('b')).toBe(1)
    expect(depths.get('c')).toBe(2)
  })

  it('scopes edges to one parent region', () => {
    const nodes = [
      { id: 'x', type: 'module', parentNode: 'grp' },
      { id: 'y', type: 'module', parentNode: 'grp' },
    ]
    const edges = [{ source: 'x', target: 'y', label: 'r' }]
    const depths = dependencyDepthsInRegion(nodes, edges, 'grp')
    expect(depths.get('x')).toBe(0)
    expect(depths.get('y')).toBe(1)
  })
})

describe('mergeEdgeHiddenForInvisibleEndpoints', () => {
  it('hides edges when a hidden endpoint is involved', () => {
    const nodes = [
      { id: 'a', hidden: true },
      { id: 'b', hidden: false },
    ]
    const edges = [{ id: 'e1', source: 'a', target: 'b', label: 'x' }]
    expect(mergeEdgeHiddenForInvisibleEndpoints(edges, nodes)[0]?.hidden).toBe(true)
  })

  it('honors hideEdgeForRelation', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }]
    const edges = [{ id: 'e1', source: 'a', target: 'b', label: 'x' }]
    expect(
      mergeEdgeHiddenForInvisibleEndpoints(edges, nodes, { hideEdgeForRelation: () => true })[0]?.hidden,
    ).toBe(true)
    expect(
      mergeEdgeHiddenForInvisibleEndpoints(edges, nodes, { hideEdgeForRelation: () => false })[0]?.hidden,
    ).toBe(false)
  })
})

describe('computeModuleHiddenForDependencyLayout', () => {
  it('hides non-pinned peers on a depth that contains a pin', () => {
    const nodes = [
      { id: 'a', type: 'module', data: { pinned: true } },
      { id: 'b', type: 'module', data: {} },
    ]
    const edges: { source: string; target: string; label: string }[] = []
    const m = computeModuleHiddenForDependencyLayout(nodes, edges)
    expect(m.get('a')).toBe(false)
    expect(m.get('b')).toBe(true)
  })

  it('keeps the layer-drill focus node visible and hides same-depth peers', () => {
    const nodes = [
      { id: 'a', type: 'module', data: { layerDrillFocus: true } },
      { id: 'b', type: 'module', data: {} },
    ]
    const edges: { source: string; target: string; label: string }[] = []
    const m = computeModuleHiddenForDependencyLayout(nodes, edges)
    expect(m.get('a')).toBe(false)
    expect(m.get('b')).toBe(true)
  })
})

describe('regionStackMetrics', () => {
  it('uses root margins when parentId is undefined', () => {
    const m = regionStackMetrics(800, undefined)
    expect(m.padTop).toBe(36)
    expect(m.padBottom).toBe(36)
    expect(m.stackBand).toBeGreaterThanOrEqual(44)
  })

  it('uses inner padding for nested regions', () => {
    const m = regionStackMetrics(640, 'g1')
    expect(m.padTop).toBe(52)
    expect(m.padBottom).toBe(52)
    expect(m.laneTopCenterY).toBeLessThan(m.stackTop)
  })
})

describe('layer drill geometry helpers', () => {
  it('verticalBandForLayerDrill uses viewport height at root', () => {
    const band = verticalBandForLayerDrill([], undefined, 720)
    expect(band.padTop).toBe(36)
    expect(band.usable).toBe(720 - 72)
  })

  it('verticalBandForLayerDrill reads parent pixel height for nested groups', () => {
    const nodes = [
      { id: 'grp', type: 'group', height: 500, style: { height: '500px' } },
    ]
    const band = verticalBandForLayerDrill(nodes, 'grp', 900)
    expect(band.padTop).toBe(52)
    expect(band.usable).toBeGreaterThan(80)
  })

  it('fullWidthFocusBoundsForLayerDrill spans root viewport minus margins', () => {
    const b = fullWidthFocusBoundsForLayerDrill({ width: 1000, height: 600 }, undefined, [])
    expect(b.x).toBe(28)
    expect(b.width).toBe(1000 - 56)
  })

  it('focusedModuleWidthForDrill respects preferred width when provided', () => {
    const w = focusedModuleWidthForDrill({ width: 1200, height: 800 }, 4, 200, undefined, [], 900)
    expect(w).toBe(900)
  })

  it('focusedModuleWidthForDrill can exceed the viewport for large inner diagrams', () => {
    const w = focusedModuleWidthForDrill({ width: 1200, height: 800 }, 4, 200, undefined, [], 5100)
    expect(w).toBe(5100)
  })
})

describe('computeLayerDrillColumnLayout', () => {
  it('widens the focus column and returns rects for each module', () => {
    const layout = computeLayerDrillColumnLayout({
      regionModules: [
        { id: 'm0', depth: 0, position: { x: 40, y: 60 }, width: 180, height: 72 },
        { id: 'm1', depth: 1, position: { x: 420, y: 60 }, width: 180, height: 72 },
      ],
      focusId: 'm0',
      focusWidth: 520,
      siblingWidthScale: 0.9,
    })
    expect(layout.size).toBe(2)
    const focus = layout.get('m0')
    expect(focus?.width).toBeGreaterThanOrEqual(180)
    expect(layout.get('m1')?.position.x).toBeGreaterThan(focus!.position.x)
  })

  it('allows a preferred focus width to expand the drilled region while siblings stay compact', () => {
    const layout = computeLayerDrillColumnLayout({
      regionModules: [
        { id: 'a', depth: 0, position: { x: 40, y: 60 }, width: 180, height: 72 },
        { id: 'b', depth: 1, position: { x: 320, y: 60 }, width: 180, height: 72 },
        { id: 'c', depth: 2, position: { x: 600, y: 60 }, width: 180, height: 72 },
      ],
      focusId: 'b',
      focusWidth: 900,
      siblingWidthScale: 0.42,
      allowFocusTrackExpansion: true,
    })

    expect(layout.get('b')?.width).toBeGreaterThanOrEqual(900)
    expect(layout.get('a')?.width).toBeLessThan(layout.get('b')!.width)
    expect(layout.get('c')?.width).toBeLessThan(layout.get('b')!.width)
  })

  it('returns an empty map when the focus id is missing', () => {
    expect(
      computeLayerDrillColumnLayout({
        regionModules: [{ id: 'a', depth: 0, position: { x: 0, y: 0 }, width: 100, height: 50 }],
        focusId: 'missing',
        focusWidth: 400,
        siblingWidthScale: 1,
      }).size,
    ).toBe(0)
  })
})

describe('layoutDepthInViewport', () => {
  it('lays out two root modules with a classpath edge', () => {
    const nodes = [
      { id: 'a', type: 'module', position: { x: 0, y: 0 }, width: 200, height: 72, data: {} },
      { id: 'b', type: 'module', position: { x: 0, y: 0 }, width: 200, height: 72, data: {} },
    ]
    const edges = [{ source: 'a', target: 'b', label: 'uses' }]
    const out = layoutDepthInViewport(nodes, edges, { width: 1200, height: 800 })
    expect(out).toHaveLength(2)
    const a = out.find((n) => n.id === 'a')
    const b = out.find((n) => n.id === 'b')
    expect(a?.position.x).not.toBe(b?.position.x)
    expect(typeof a?.width).toBe('number')
    expect((a?.width as number) > 0).toBe(true)
  })

  it('stretches a single root leaf to the viewport', () => {
    const nodes = [{ id: 'solo', type: 'package', position: { x: 10, y: 10 }, data: {} }]
    const out = layoutDepthInViewport(nodes, [], { width: 900, height: 700 })
    expect(out).toHaveLength(1)
    expect(out[0]?.position.x).toBe(28)
    expect(out[0]?.width).toBeGreaterThan(400)
  })
})

describe('annotateParallelAggregateEdgeOffsets', () => {
  it('assigns distinct agg-out/agg-in slots for parallel edges', () => {
    const nodes = [
      { id: 'a', type: 'module', position: { x: 40, y: 40 }, width: 180, height: 72, data: {} },
      { id: 'b', type: 'module', position: { x: 320, y: 40 }, width: 180, height: 72, data: {} },
      { id: 'c', type: 'module', position: { x: 320, y: 160 }, width: 180, height: 72, data: {} },
    ]
    const edges = [
      { id: 'e1', source: 'a', target: 'b', sourceHandle: DEP_SOURCE_HANDLE, targetHandle: AGG_TARGET_HANDLE, label: 'depends on' },
      { id: 'e2', source: 'a', target: 'c', sourceHandle: DEP_SOURCE_HANDLE, targetHandle: AGG_TARGET_HANDLE, label: 'depends on' },
    ]
    const out = annotateParallelAggregateEdgeOffsets(nodes, edges)
    const sh = new Set(out.map((e) => String(e.sourceHandle)))
    const th = new Set(out.map((e) => String(e.targetHandle)))
    expect([...sh].filter((x) => x.startsWith('agg-out-')).length).toBe(2)
    // Target slots only spread when multiple parallel edges terminate at the same target.
    expect([...th].filter((x) => x.startsWith('agg-in-')).length).toBe(1)
  })
})

describe('annotateAggregateVerticalPaths', () => {
  it('adds a centerY detour lane when skipping depth columns', () => {
    const nodes = [
      { id: 'a', type: 'module', position: { x: 40, y: 80 }, width: 180, height: 72, data: {} },
      { id: 'b', type: 'module', position: { x: 320, y: 80 }, width: 180, height: 72, data: {} },
      { id: 'c', type: 'module', position: { x: 600, y: 80 }, width: 180, height: 72, data: {} },
    ]
    // Depths: a=0, b=1, c=2. a->c skips one column (delta 2) -> detour should apply.
    const edges = [{ id: 'e1', source: 'a', target: 'c', sourceHandle: 'agg-out-0', targetHandle: 'agg-in-0', label: 'depends on' }]
    const out = annotateAggregateVerticalPaths(nodes, edges, { width: 900, height: 600 })
    expect(out[0]?.type).toBe('smoothstep')
    expect((out[0] as any)?.pathOptions?.centerY).toBeDefined()
  })

  it('returns a plain edge (no smoothstep) when no detour is needed and no straight-overlap exists', () => {
    const nodes = [
      { id: 'a', type: 'module', position: { x: 40, y: 40 }, width: 180, height: 72, data: {} },
      { id: 'b', type: 'module', position: { x: 320, y: 260 }, width: 180, height: 72, data: {} },
    ]
    // Depth delta is 1 (no detour). Vertical overlap is 0, so straightY is undefined.
    const edges = [
      {
        id: 'e1',
        source: 'a',
        target: 'b',
        sourceHandle: 'agg-out-0',
        targetHandle: 'agg-in-0',
        label: 'depends on',
      },
    ]
    const out = annotateAggregateVerticalPaths(nodes, edges, { width: 900, height: 600 })
    expect(out[0]?.type).toBeUndefined()
    expect((out[0] as any)?.pathOptions?.centerY).toBeUndefined()
  })

  it('skips hidden edges entirely', () => {
    const nodes = [
      { id: 'a', type: 'module', position: { x: 40, y: 80 }, width: 180, height: 72, data: {} },
      { id: 'c', type: 'module', position: { x: 600, y: 80 }, width: 180, height: 72, data: {} },
    ]
    const edges = [
      {
        id: 'e1',
        source: 'a',
        target: 'c',
        sourceHandle: 'agg-out-0',
        targetHandle: 'agg-in-0',
        label: 'depends on',
        hidden: true,
      },
    ]
    const out = annotateAggregateVerticalPaths(nodes, edges, { width: 900, height: 600 })
    expect(out[0]?.hidden).toBe(true)
    // Hidden edges should remain hidden; routing may still be annotated for consistency.
  })
})

describe('relayoutSubtreeIntoBounds', () => {
  it('keeps the root group at the requested bounds and relays out its child', () => {
    const nodes = [
      { id: 'grp', type: 'group', position: { x: 28, y: 36 }, style: { width: '520px', height: '360px' }, data: { packageScope: true } },
      { id: 'leaf', type: 'module', parentNode: 'grp', position: { x: 0, y: 0 }, width: 200, height: 72, data: {} },
    ]
    const edges = [] as { source: string; target: string; label?: unknown }[]
    const out = relayoutSubtreeIntoBounds('grp', nodes, edges, { width: 800, height: 600 })
    const grp = out.find((n) => n.id === 'grp')
    expect(grp?.style?.width).toBe('800px')
    expect(grp?.style?.height).toBe('600px')
    const leaf = out.find((n) => n.id === 'leaf')
    expect(typeof leaf?.position?.x).toBe('number')
    expect(typeof leaf?.position?.y).toBe('number')
  })

  it('does not shrink root below requested bounds when exactRootBounds is false', () => {
    const nodes = [
      {
        id: 'grp',
        type: 'group',
        position: { x: 28, y: 36 },
        style: { width: '520px', height: '360px' },
        data: { packageScope: true },
      },
      { id: 'leaf', type: 'module', parentNode: 'grp', position: { x: 0, y: 0 }, width: 240, height: 120, data: {} },
    ]
    const edges = [] as { source: string; target: string; label?: unknown }[]
    const out = relayoutSubtreeIntoBounds('grp', nodes, edges, { width: 400, height: 300 }, { exactRootBounds: false })
    const grp = out.find((n) => n.id === 'grp') as any
    const w = Number(String(grp?.style?.width ?? '').replace('px', ''))
    const h = Number(String(grp?.style?.height ?? '').replace('px', ''))
    expect(w).toBeGreaterThanOrEqual(400)
    expect(h).toBeGreaterThanOrEqual(300)
  })
})

describe('applyHandleAnchorAlignment', () => {
  it('removes anchorTops when there are no qualifying edges', () => {
    const nodes = [
      { id: 'a', type: 'module', position: { x: 40, y: 80 }, width: 180, height: 72, data: { anchorTops: { aggOut: { 0: 50 } } } },
      { id: 'b', type: 'module', position: { x: 320, y: 80 }, width: 180, height: 72, data: { anchorTops: { aggIn: { 0: 50 } } } },
    ]
    // No label => not a classpath depth relation => alignment should clear anchorTops.
    const edges = [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'agg-out-0', targetHandle: 'agg-in-0', label: '' }]
    const out = applyHandleAnchorAlignment(nodes, edges)
    expect((out[0] as any)?.data?.anchorTops).toBeUndefined()
    expect((out[1] as any)?.data?.anchorTops).toBeUndefined()
  })
})
