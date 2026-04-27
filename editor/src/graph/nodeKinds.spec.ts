import { describe, expect, it } from 'vitest'
import { isLayerDrillBoxNode, isLeafBoxNode } from './nodeKinds'

describe('isLeafBoxNode', () => {
  it('matches module, package, and artefact', () => {
    expect(isLeafBoxNode({ type: 'module' })).toBe(true)
    expect(isLeafBoxNode({ type: 'package' })).toBe(true)
    expect(isLeafBoxNode({ type: 'artefact' })).toBe(true)
  })

  it('rejects groups and unknown types', () => {
    expect(isLeafBoxNode({ type: 'group' })).toBe(false)
    expect(isLeafBoxNode({ type: 'service' })).toBe(false)
    expect(isLeafBoxNode(null)).toBe(false)
  })
})

describe('isLayerDrillBoxNode', () => {
  it('includes leaf types and groups', () => {
    expect(isLayerDrillBoxNode({ type: 'module' })).toBe(true)
    expect(isLayerDrillBoxNode({ type: 'group' })).toBe(true)
  })

  it('rejects unrelated types', () => {
    expect(isLayerDrillBoxNode({ type: 'background' })).toBe(false)
  })
})
