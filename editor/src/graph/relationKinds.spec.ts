import { describe, expect, it } from 'vitest'
import {
  SBT_AGGREGATE_STROKE,
  SBT_DEPENDS_ON_STROKE,
  edgeContributesToClasspathDepth,
  isAggregateEdge,
  strokeColorForFlowEdge,
  strokeForIlographRelation,
} from './relationKinds'

describe('isAggregateEdge', () => {
  it('detects containment-style labels case-insensitively', () => {
    expect(isAggregateEdge({ label: 'aggregate' })).toBe(true)
    expect(isAggregateEdge({ label: 'Aggregates' })).toBe(true)
    expect(isAggregateEdge({ label: 'Contains' })).toBe(true)
    expect(isAggregateEdge({ label: 'depends on' })).toBe(false)
  })

  it('treats blank labels as non-aggregate', () => {
    expect(isAggregateEdge({})).toBe(false)
    expect(isAggregateEdge({ label: '   ' })).toBe(false)
  })
})

describe('edgeContributesToClasspathDepth', () => {
  it('requires a non-empty trimmed label', () => {
    expect(edgeContributesToClasspathDepth({ label: 'x' })).toBe(true)
    expect(edgeContributesToClasspathDepth({ label: '  y  ' })).toBe(true)
    expect(edgeContributesToClasspathDepth({})).toBe(false)
    expect(edgeContributesToClasspathDepth({ label: '' })).toBe(false)
  })
})

describe('strokeForIlographRelation', () => {
  it('prefers an explicit color string', () => {
    expect(strokeForIlographRelation({ label: 'aggregate', color: '#ff00aa' })).toBe('#ff00aa')
    expect(strokeForIlographRelation({ label: 'x', color: '  #abc  ' })).toBe('  #abc  ')
  })

  it('falls back to aggregate vs dependency palette', () => {
    expect(strokeForIlographRelation({ label: 'aggregate' })).toBe(SBT_AGGREGATE_STROKE)
    expect(strokeForIlographRelation({ label: 'contains' })).toBe(SBT_AGGREGATE_STROKE)
    expect(strokeForIlographRelation({ label: 'depends on' })).toBe(SBT_DEPENDS_ON_STROKE)
  })
})

describe('strokeColorForFlowEdge', () => {
  it('reads stroke from style when present', () => {
    expect(
      strokeColorForFlowEdge({
        label: 'aggregate',
        style: { stroke: '  #112233  ' },
      }),
    ).toBe('#112233')
  })

  it('delegates to strokeForIlographRelation when style stroke is missing', () => {
    expect(strokeColorForFlowEdge({ label: 'aggregate', style: {} })).toBe(SBT_AGGREGATE_STROKE)
  })
})
