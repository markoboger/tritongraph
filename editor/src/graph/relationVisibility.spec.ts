import { describe, expect, it } from 'vitest'
import {
  normalizeRelationTypeKey,
  relationTypeKeysSignature,
  relationTypesFromSignature,
  shouldHideEdgeForRelationFilter,
} from './relationVisibility'

describe('relationVisibility', () => {
  it('normalizes blank labels to a stable placeholder', () => {
    expect(normalizeRelationTypeKey('')).toBe('(no label)')
    expect(normalizeRelationTypeKey(undefined)).toBe('(no label)')
  })

  it('hides only relations explicitly disabled in the visibility map', () => {
    const visibility = { with: false, gets: true }
    expect(shouldHideEdgeForRelationFilter({ label: 'with' }, visibility)).toBe(true)
    expect(shouldHideEdgeForRelationFilter({ label: 'gets' }, visibility)).toBe(false)
    expect(shouldHideEdgeForRelationFilter({ label: 'creates' }, visibility)).toBe(false)
  })

  it('builds a stable sorted relation signature', () => {
    const sig = relationTypeKeysSignature([
      { label: 'gets' },
      { label: 'with' },
      { label: 'gets' },
      { label: undefined },
    ])
    expect(sig).toBe(['(no label)', 'gets', 'with'].join('\n'))
    expect(relationTypesFromSignature(sig)).toEqual(['(no label)', 'gets', 'with'])
  })
})
