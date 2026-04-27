import { describe, expect, it } from 'vitest'
import {
  AGG_FAN_SOURCE_COUNT,
  aggregateFanTopPctForUsedSlots,
  aggregateSourceHandleId,
  aggregateTargetHandleId,
} from './handles'

describe('aggregate handle ids', () => {
  it('maps slot 0 to the first fan indices', () => {
    expect(aggregateSourceHandleId(0)).toBe('agg-out-0')
    expect(aggregateTargetHandleId(0)).toBe('agg-in-0')
  })

  it('clamps negative slots to 0', () => {
    expect(aggregateSourceHandleId(-99)).toBe('agg-out-0')
    expect(aggregateTargetHandleId(-1)).toBe('agg-in-0')
  })

  it('clamps oversized slots to the last fan index', () => {
    const last = AGG_FAN_SOURCE_COUNT - 1
    expect(aggregateSourceHandleId(999)).toBe(`agg-out-${last}`)
    expect(aggregateTargetHandleId(1_000_000)).toBe(`agg-in-${last}`)
  })
})

describe('aggregateFanTopPctForUsedSlots', () => {
  it('returns 50 when no slots are used', () => {
    expect(aggregateFanTopPctForUsedSlots(0, [])).toBe(50)
  })

  it('returns 50 for a single used slot', () => {
    expect(aggregateFanTopPctForUsedSlots(2, [2])).toBe(50)
  })

  it('spreads indices across the vertical band for multiple slots', () => {
    const used = [0, 1, 2]
    expect(aggregateFanTopPctForUsedSlots(0, used)).toBe(18)
    expect(aggregateFanTopPctForUsedSlots(2, used)).toBe(82)
    expect(aggregateFanTopPctForUsedSlots(1, used)).toBe(50)
  })

  it('returns 50 when the slot is not in the used list', () => {
    expect(aggregateFanTopPctForUsedSlots(5, [0, 1])).toBe(50)
  })
})
