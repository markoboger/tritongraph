import { describe, expect, it } from 'vitest'
import { innerArtefactSlotPreferredHeightPx } from './innerArtefactSlotMetrics'

describe('innerArtefactSlotPreferredHeightPx', () => {
  it('returns a bounded height that grows with title length', () => {
    expect(innerArtefactSlotPreferredHeightPx('A')).toBe(132)
    expect(innerArtefactSlotPreferredHeightPx('DemoObject12')).toBeGreaterThan(132)
    expect(innerArtefactSlotPreferredHeightPx('x'.repeat(80))).toBeLessThanOrEqual(280)
  })
})
