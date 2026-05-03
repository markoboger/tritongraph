import { describe, expect, it } from 'vitest'
import {
  FLAT_LAYOUT_MAX_H_PX,
  nextFlatLayout,
  nextMetricsBreakLayout,
} from './boxChromeLayout'

describe('nextFlatLayout', () => {
  it('uses flat row chrome for wide shallow packages (runtime host footprint)', () => {
    expect(nextFlatLayout(167, 101, false)).toBe(true)
    expect(nextFlatLayout(200, FLAT_LAYOUT_MAX_H_PX, false)).toBe(true)
  })

  it('leaves taller bands on the default stacked chrome', () => {
    expect(nextFlatLayout(167, FLAT_LAYOUT_MAX_H_PX + 1, false)).toBe(false)
  })
})

describe('nextMetricsBreakLayout', () => {
  it('enters shallow break for moderately wide shallow boxes (strip does not stack, stacked chrome would clip)', () => {
    expect(nextMetricsBreakLayout(160, 100, false)).toBe(true)
  })

  it('still uses narrow break below the strip stacking width', () => {
    expect(nextMetricsBreakLayout(148, 100, false)).toBe(true)
  })
})
