import { describe, expect, it } from 'vitest'
import { resourceKey, splitRefs } from './refs'

describe('splitRefs', () => {
  it('returns empty for missing or blank input', () => {
    expect(splitRefs(undefined)).toEqual([])
    expect(splitRefs('')).toEqual([])
    expect(splitRefs('  ,  , ')).toEqual([])
  })

  it('splits on commas and trims segments', () => {
    expect(splitRefs('a, b ,c')).toEqual(['a', 'b', 'c'])
  })
})

describe('resourceKey', () => {
  it('prefers id over name when present', () => {
    expect(resourceKey({ id: 'id-1', name: 'Display' })).toBe('id-1')
  })

  it('falls back to name when id is absent', () => {
    expect(resourceKey({ name: '  OnlyName  ' })).toBe('OnlyName')
  })
})
