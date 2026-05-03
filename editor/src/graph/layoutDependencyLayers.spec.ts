import { describe, expect, it } from 'vitest'
import { AGG_TARGET_HANDLE, DEP_SOURCE_HANDLE } from './handles'
import {
  applyHandleAnchorAlignment,
  annotateAggregateVerticalPaths,
  annotateParallelAggregateEdgeOffsets,
  computeLayerDrillColumnLayout,
  computeModuleHiddenForDependencyLayout,
  dependencyDepthsInRegion,
  distributeHeightsToBand,
  focusedModuleWidthForDrill,
  fullWidthFocusBoundsForLayerDrill,
  packageInnerLayoutPressure01ForOuterDrill,
  layoutDepthInViewport,
  mergeEdgeHiddenForInvisibleEndpoints,
  preferredPackageFocusWidth,
  regionStackMetrics,
  compressRelationLaneGuttersForBand,
  RELATION_LANE_MIN_PX,
  relayoutSubtreeIntoBounds,
  routeSmoothstepEdgesInViewport,
  scaleRelationLaneGuttersForInnerDrillPressure,
  shrinkLayerDrillUnfocusedPackageRect,
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

describe('distributeHeightsToBand', () => {
  it('shrinks natural heights into a smaller band while respecting minimums', () => {
    const natural = [120, 120, 120]
    const mins = [40, 40, 40]
    const fitted = distributeHeightsToBand(200, natural, mins)
    expect(fitted.length).toBe(3)
    expect(fitted.reduce((a, b) => a + b, 0)).toBe(200)
    for (let i = 0; i < 3; i++) {
      expect(fitted[i]).toBeGreaterThanOrEqual(40)
      expect(fitted[i]).toBeLessThanOrEqual(natural[i]!)
    }
  })

  it('keeps per-row floors when the band is shorter than the sum of minimums (no equal split below min)', () => {
    const natural = [132, 132, 132, 132]
    const mins = [40, 40, 40, 40]
    const fitted = distributeHeightsToBand(100, natural, mins)
    expect(fitted).toEqual([40, 40, 40, 40])
    expect(fitted.reduce((a, b) => a + b, 0)).toBeGreaterThan(100)
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

  it('focusedModuleWidthForDrill breathes preferred width up when inner drill pressure is low', () => {
    const roomy = focusedModuleWidthForDrill({ width: 1200, height: 800 }, 4, 200, undefined, [], 1000, 0)
    const tight = focusedModuleWidthForDrill({ width: 1200, height: 800 }, 4, 200, undefined, [], 1000, 1)
    expect(roomy).toBeGreaterThan(tight)
    expect(roomy).toBeGreaterThanOrEqual(1000)
  })
})

describe('shrinkLayerDrillUnfocusedPackageRect', () => {
  it('shrinks width and recenters horizontally, leaving height + y untouched', () => {
    const out = shrinkLayerDrillUnfocusedPackageRect({
      position: { x: 100, y: 200 },
      width: 400,
      height: 300,
      style: { width: '400px', height: '300px', border: '1px solid red' },
    })
    /** Width: 0.68 of 400 → 272 (focused package needs the horizontal track). */
    expect(out.width).toBe(272)
    /** Height stays at the peer's preferred footprint — height is not the focused package's to take. */
    expect(out.height).toBe(300)
    expect(out.position).toEqual({ x: 164, y: 200 })
    expect(out.style?.width).toBe('272px')
    expect(out.style?.height).toBe('300px')
    expect(out.style?.border).toBe('1px solid red')
  })

  it('keeps the peer height intact even at full outer-drill pressure', () => {
    const base = shrinkLayerDrillUnfocusedPackageRect({
      position: { x: 0, y: 0 },
      width: 400,
      height: 300,
      style: { width: '400px', height: '300px' },
    })
    const more = shrinkLayerDrillUnfocusedPackageRect(
      { position: { x: 0, y: 0 }, width: 400, height: 300, style: { width: '400px', height: '300px' } },
      1,
    )
    /** Width still responds to pressure (peer narrows further). */
    expect(more.width).toBeLessThan(base.width)
    /** Height never compresses regardless of pressure — peers always render at preferred height. */
    expect(base.height).toBe(300)
    expect(more.height).toBe(300)
  })
})

describe('packageInnerLayoutPressure01ForOuterDrill', () => {
  it('returns zero for a single artefact and no relations', () => {
    expect(packageInnerLayoutPressure01ForOuterDrill([{ id: 'p::class:A' }], [])).toBe(0)
  })

  it('increases with inner columns and edges', () => {
    const arts = Array.from({ length: 8 }, (_, i) => ({ id: `p::class:C${i}` }))
    const chain = Array.from({ length: 7 }, (_, i) => ({
      from: `p::class:C${i}`,
      to: `p::class:C${i + 1}`,
    }))
    const p = packageInnerLayoutPressure01ForOuterDrill(arts, chain)
    expect(p).toBeGreaterThan(0.25)
  })

  it('does not treat cross-boundary relations as inner crowding', () => {
    const arts = [{ id: 'a' }, { id: 'b' }]
    const noise = Array.from({ length: 40 }, (_, i) => ({
      from: 'a',
      to: `other::pkg::Foreign${i}`,
    }))
    const member = [{ from: 'a', to: 'b' }]
    expect(packageInnerLayoutPressure01ForOuterDrill(arts, [...noise, ...member])).toBe(
      packageInnerLayoutPressure01ForOuterDrill(arts, member),
    )
  })
})

describe('scaleRelationLaneGuttersForInnerDrillPressure', () => {
  it('narrows gutters as pressure approaches 1', () => {
    const base = [128, 160, 192]
    const scaled = scaleRelationLaneGuttersForInnerDrillPressure(base, 1)
    expect(scaled.every((g, i) => g <= base[i]!)).toBe(true)
    expect(scaled[0]).toBeLessThan(base[0]!)
  })
})

describe('compressRelationLaneGuttersForBand', () => {
  it('keeps gutters unchanged when the band has room for the preferred lanes', () => {
    const gutters = [128, 128, 128]
    /** 4 cols × (44 + 6) = 200 px floor + 384 px lanes = 584 < 1280. */
    expect(compressRelationLaneGuttersForBand(gutters, 4, 1280)).toEqual(gutters)
  })

  it('shrinks lanes (not column tracks) when the long-chain band overshoots the viewport', () => {
    /** Mirrors `package-import-chain` with chain length 8: 7 lanes × 128 px = 896 px. */
    const gutters = Array.from({ length: 7 }, () => 128)
    const compressed = compressRelationLaneGuttersForBand(gutters, 8, 800)
    const sumBefore = gutters.reduce((a, b) => a + b, 0)
    const sumAfter = compressed.reduce((a, b) => a + b, 0)
    expect(sumAfter).toBeLessThan(sumBefore)
    expect(compressed.every((g) => g >= RELATION_LANE_MIN_PX)).toBe(true)
  })

  it('never expands gutters above their preferred values even when the band is huge', () => {
    const gutters = [64, 80, 96]
    expect(compressRelationLaneGuttersForBand(gutters, 4, 100000)).toEqual(gutters)
  })

  it('respects the lane minimum even under extreme pressure', () => {
    const gutters = Array.from({ length: 6 }, () => 192)
    const compressed = compressRelationLaneGuttersForBand(gutters, 7, 320)
    expect(compressed.every((g) => g >= RELATION_LANE_MIN_PX)).toBe(true)
  })

  it('returns an empty array for zero gutters (single-column layouts)', () => {
    expect(compressRelationLaneGuttersForBand([], 1, 1280)).toEqual([])
  })

  it('honours overrides for min lane and column floors', () => {
    const gutters = [128, 128]
    const compressed = compressRelationLaneGuttersForBand(gutters, 3, 400, {
      minLanePx: 80,
      minColumnInnerW: 60,
    })
    expect(compressed.every((g) => g >= 80)).toBe(true)
  })
})

describe('preferredPackageFocusWidth', () => {
  it('returns undefined for empty packages', () => {
    expect(preferredPackageFocusWidth({})).toBeUndefined()
    expect(preferredPackageFocusWidth({ innerArtefacts: [], innerPackages: [] })).toBeUndefined()
  })

  it('keeps a single-column class-stacking package compact (no relations between members)', () => {
    const innerArtefacts = Array.from({ length: 7 }, (_, i) => ({
      id: `p::class:C${i}`,
      name: `DemoObject${i + 1}`,
    }))
    const w = preferredPackageFocusWidth({ innerArtefacts })!
    expect(w).toBeDefined()
    expect(w).toBeLessThan(500)
  })

  it('chained inner artefacts (7-link inheritance) request a moderate, viewport-friendly width', () => {
    const innerArtefacts = Array.from({ length: 7 }, (_, i) => ({
      id: `p::class:C${i}`,
      name: `InheritLink${i + 1}`,
    }))
    const innerArtefactRelations = Array.from({ length: 6 }, (_, i) => ({
      from: `p::class:C${i}`,
      to: `p::class:C${i + 1}`,
      label: 'extends',
    }))
    const w = preferredPackageFocusWidth({ innerArtefacts, innerArtefactRelations })!
    expect(w).toBeGreaterThan(500)
    /** Was ~1334 with the previous formula (artefactCount * 170 + relationLaneWidth). */
    expect(w).toBeLessThan(1024)
  })

  it('does not include cross-package outer relations in the inner relation gap budget', () => {
    const innerArtefacts = Array.from({ length: 4 }, (_, i) => ({ id: `p::class:C${i}` }))
    const innerArtefactRelations = [
      { from: 'p::class:C0', to: 'p::class:C1' },
      { from: 'p::class:C1', to: 'p::class:C2' },
    ]
    const crossArtefactRelations = Array.from({ length: 30 }, (_, i) => ({
      from: 'p::class:C0',
      to: `other::pkg::Foreign${i}`,
    }))
    const wInnerOnly = preferredPackageFocusWidth({ innerArtefacts, innerArtefactRelations })!
    const wWithCross = preferredPackageFocusWidth({
      innerArtefacts,
      innerArtefactRelations,
      crossArtefactRelations,
    })!
    expect(wWithCross).toBe(wInnerOnly)
  })

  it('counts actual inner column count (chain) rather than raw artefact count for width', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `p::class:C${i}`)
    const innerArtefacts = ids.map((id) => ({ id }))
    /** Independent: all artefacts collapse into one inner column. */
    const wIndependent = preferredPackageFocusWidth({ innerArtefacts })!
    /** Linear extends chain: 8 inner columns. */
    const innerArtefactRelations = Array.from({ length: 7 }, (_, i) => ({
      from: ids[i]!,
      to: ids[i + 1]!,
    }))
    const wChain = preferredPackageFocusWidth({ innerArtefacts, innerArtefactRelations })!
    expect(wChain).toBeGreaterThan(wIndependent + 200)
  })

  it('caps width at the actual artefact count even when back-edges produce many empty layer buckets', () => {
    /**
     * `assignInnerArtefactLayers` can return many empty layers when an inner edge points
     * **backwards** in the chain (here `M2C4 → M2C1`). Those empty buckets must not balloon the
     * preferred focus width — width should follow the **occupied** column count.
     */
    const ids = Array.from({ length: 7 }, (_, i) => `p::class:M2C${i}`)
    const innerArtefacts = ids.map((id) => ({ id }))
    const innerArtefactRelations = [
      ...Array.from({ length: 6 }, (_, i) => ({ from: ids[i]!, to: ids[i + 1]! })),
      { from: ids[0]!, to: ids[3]! },
      /** Back-edge: pushes layer count to ~39 empty buckets internally. */
      { from: ids[4]!, to: ids[1]! },
    ]
    const w = preferredPackageFocusWidth({ innerArtefacts, innerArtefactRelations })!
    expect(w).toBeLessThan(900)
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

  it('reserves more sibling context width for content-heavy packages', () => {
    const base = [
      { id: 'focus', depth: 0, position: { x: 40, y: 60 }, width: 180, height: 72, contentWeight: 20 },
      { id: 'light', depth: 1, position: { x: 320, y: 60 }, width: 180, height: 72, contentWeight: 1 },
      { id: 'heavy', depth: 2, position: { x: 600, y: 60 }, width: 180, height: 72, contentWeight: 18 },
    ]
    const layout = computeLayerDrillColumnLayout({
      regionModules: base,
      focusId: 'focus',
      focusWidth: 1100,
      siblingWidthScale: 0.42,
      allowFocusTrackExpansion: true,
    })

    expect(layout.get('heavy')!.width).toBeGreaterThan(layout.get('light')!.width)
    expect(layout.get('focus')!.width).toBeGreaterThan(layout.get('heavy')!.width)
  })

  it('uses supplied relation lane gutters between drill columns', () => {
    const layout = computeLayerDrillColumnLayout({
      regionModules: [
        { id: 'left', depth: 0, position: { x: 40, y: 60 }, width: 180, height: 72 },
        { id: 'right', depth: 1, position: { x: 320, y: 60 }, width: 180, height: 72 },
      ],
      focusId: 'right',
      focusWidth: 180,
      siblingWidthScale: 0.42,
      depthGutters: [160],
    })

    const left = layout.get('left')!
    const right = layout.get('right')!
    const lane = right.position.x - (left.position.x + left.width)
    expect(lane).toBeGreaterThanOrEqual(150)
  })

  it('caps non-focus package width at non-focus depth when inner drill peer layout is active', () => {
    const layout = computeLayerDrillColumnLayout({
      regionModules: [
        { id: 'a', depth: 0, position: { x: 40, y: 60 }, width: 400, height: 120, nodeType: 'package' },
        { id: 'b', depth: 1, position: { x: 500, y: 60 }, width: 400, height: 120, nodeType: 'package' },
      ],
      focusId: 'a',
      focusWidth: 900,
      siblingWidthScale: 0.35,
      allowFocusTrackExpansion: true,
      innerDrillPressure01: 0.8,
    })
    const focus = layout.get('a')!
    const peer = layout.get('b')!
    expect(focus.width).toBeGreaterThan(peer.width)
    expect(peer.width).toBeLessThan(focus.width * 0.75)
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

  it('keeps a single root Scala artefact compact instead of full-viewport stretch', () => {
    const nodes = [{ id: 'demo', type: 'artefact', position: { x: 10, y: 10 }, data: {} }]
    const out = layoutDepthInViewport(nodes, [], { width: 900, height: 700 })
    expect(out).toHaveLength(1)
    expect(Number(out[0]?.width)).toBeLessThanOrEqual(200)
    expect(Number(out[0]?.height)).toBeLessThanOrEqual(130)
  })

  it('lets long package import chains shrink below slim breakpoints under pressure', () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({
      id: `p${i}`,
      type: 'package',
      position: { x: 0, y: 0 },
      data: {},
    }))
    const edges = Array.from({ length: 11 }, (_, i) => ({
      source: `p${i}`,
      target: `p${i + 1}`,
      label: 'imports',
    }))

    const out = layoutDepthInViewport(nodes, edges, { width: 1200, height: 1200 })
    const widths = out.map((n) => Number(n.width))
    expect(Math.max(...widths)).toBeLessThan(96)
  })

  it('reserves wider relation lanes between layers with many crossings', () => {
    const nodes = [
      { id: 'left', type: 'package', position: { x: 0, y: 0 }, data: {} },
      { id: 'right', type: 'package', position: { x: 0, y: 0 }, data: {} },
    ]
    const edges = Array.from({ length: 8 }, (_, i) => ({
      source: 'left',
      target: 'right',
      label: `imports-${i}`,
    }))

    const out = layoutDepthInViewport(nodes, edges, { width: 1200, height: 700 })
    const left = out.find((n) => n.id === 'left')!
    const right = out.find((n) => n.id === 'right')!
    const lane = Number(right.position.x) - (Number(left.position.x) + Number(left.width))

    expect(lane).toBeGreaterThan(100)
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
