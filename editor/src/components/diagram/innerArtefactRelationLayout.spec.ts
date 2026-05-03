import { describe, expect, it } from 'vitest'
import {
  INNER_RELATION_LANE_MIN_PX,
  innerArtefactColumnPressure01,
  innerArtefactEdgeDensityPressure01,
  innerArtefactRelationLaneGapPx,
  innerMemberMemberRelationDrawCountForLaneGap,
} from './innerArtefactRelationLayout'

describe('innerArtefactRelationLaneGapPx', () => {
  it('uses a wide preferred gap for a two-column inheritance chain', () => {
    const gap = innerArtefactRelationLaneGapPx(2, 1)
    expect(gap).toBeGreaterThanOrEqual(INNER_RELATION_LANE_MIN_PX)
    expect(gap).toBeGreaterThanOrEqual(100)
  })

  it('applies pressure when many columns share the host', () => {
    const narrow = innerArtefactRelationLaneGapPx(8, 7)
    const wide = innerArtefactRelationLaneGapPx(2, 1)
    expect(narrow).toBeLessThan(wide)
    expect(narrow).toBeGreaterThanOrEqual(INNER_RELATION_LANE_MIN_PX)
  })

  it('collapses relation gutters toward min under saturated column pressure', () => {
    expect(innerArtefactRelationLaneGapPx(12, 2)).toBe(INNER_RELATION_LANE_MIN_PX)
  })

  it('shrinks relations more than a mild linear scale at moderate column count', () => {
    const at5 = innerArtefactRelationLaneGapPx(5, 2)
    const at2 = innerArtefactRelationLaneGapPx(2, 2)
    const naiveLinear = INNER_RELATION_LANE_MIN_PX + (at2 - INNER_RELATION_LANE_MIN_PX) * (1 - 3 / 7)
    expect(at5).toBeLessThan(naiveLinear - 8)
  })
})

describe('innerMemberMemberRelationDrawCountForLaneGap', () => {
  const col = new Set(['a', 'b'])

  it('counts only non-overlay draws between two column artefact ids', () => {
    expect(
      innerMemberMemberRelationDrawCountForLaneGap(
        [
          { overlay: false, from: 'a', to: 'b' },
          { overlay: false, from: 'a', to: '__ext:left:a:x:imports:' },
        ],
        col,
      ),
    ).toBe(1)
  })

  it('ignores overlay draws and empty column sets', () => {
    expect(
      innerMemberMemberRelationDrawCountForLaneGap([{ overlay: true, from: 'a', to: 'b' }], col),
    ).toBe(0)
    expect(innerMemberMemberRelationDrawCountForLaneGap([{ overlay: false, from: 'a', to: 'b' }], new Set())).toBe(
      0,
    )
  })
})

describe('innerArtefactColumnPressure01', () => {
  it('is zero for one or two columns', () => {
    expect(innerArtefactColumnPressure01(1)).toBe(0)
    expect(innerArtefactColumnPressure01(2)).toBe(0)
  })

  it('ramps toward 1 as columns exceed the inner pressure full threshold', () => {
    expect(innerArtefactColumnPressure01(9)).toBeCloseTo(1, 5)
    expect(innerArtefactColumnPressure01(5)).toBeGreaterThan(0.35)
  })
})

describe('innerArtefactEdgeDensityPressure01', () => {
  it('is zero when there are no edges', () => {
    expect(innerArtefactEdgeDensityPressure01(0)).toBe(0)
  })

  it('saturates at many edges', () => {
    expect(innerArtefactEdgeDensityPressure01(100)).toBe(1)
  })
})
