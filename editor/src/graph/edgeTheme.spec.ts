import { describe, expect, it } from 'vitest'
import {
  DEP_EDGE_STROKE,
  dependencyEdgeLabelStyle,
  dependencyEdgeStyle,
  dependencyMarker,
  markersForAggregateEdge,
  markersForRelation,
} from './edgeTheme'

describe('dependencyMarker', () => {
  it('builds a closed arrow marker with color', () => {
    const m = dependencyMarker('#abcdef')
    expect(m.type).toBe('arrowclosed')
    expect(m.color).toBe('#abcdef')
    expect(m.width).toBeGreaterThan(0)
  })
})

describe('dependencyEdgeStyle', () => {
  it('returns stroke css fields', () => {
    expect(dependencyEdgeStyle('#111')).toEqual({ stroke: '#111' })
    expect(dependencyEdgeStyle()).toEqual({ stroke: DEP_EDGE_STROKE })
  })
})

describe('dependencyEdgeLabelStyle', () => {
  it('toggles emphasis weight and opacity', () => {
    const base = dependencyEdgeLabelStyle('#000', false)
    const emph = dependencyEdgeLabelStyle('#000', true)
    expect(base.opacity).toBeLessThan(1)
    expect(emph.opacity).toBe(1)
    expect(emph.fontWeight).toBeGreaterThan(Number(base.fontWeight))
  })
})

describe('markersForRelation', () => {
  it('adds both markers when bidirectional', () => {
    const b = markersForRelation(true, '#222')
    expect(b.markerStart).toBeDefined()
    expect(b.markerEnd).toBeDefined()
  })

  it('uses only markerEnd for forward relations', () => {
    const f = markersForRelation(false, '#333')
    expect(f.markerStart).toBeUndefined()
    expect(f.markerEnd).toBeDefined()
  })
})

describe('markersForAggregateEdge', () => {
  it('places the arrow on the child end only', () => {
    const a = markersForAggregateEdge('#444')
    expect(a.markerStart).toBeUndefined()
    expect(a.markerEnd).toBeDefined()
  })
})
