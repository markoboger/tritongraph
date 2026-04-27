import { describe, expect, it } from 'vitest'
import { NAMED_BOX_COLORS, boxColorForId, isNamedBoxColor, nextNamedBoxColor } from './boxColors'

describe('isNamedBoxColor', () => {
  it('accepts palette members only', () => {
    expect(isNamedBoxColor('steelblue')).toBe(true)
    expect(isNamedBoxColor('not-a-palette-color')).toBe(false)
    expect(isNamedBoxColor(12)).toBe(false)
  })
})

describe('boxColorForId', () => {
  it('returns a stable named color for the same id', () => {
    const c = boxColorForId('my-module-id')
    expect(NAMED_BOX_COLORS.includes(c)).toBe(true)
    expect(boxColorForId('my-module-id')).toBe(c)
  })
})

describe('nextNamedBoxColor', () => {
  it('advances within the palette', () => {
    const first = NAMED_BOX_COLORS[0]!
    const second = NAMED_BOX_COLORS[1]!
    expect(nextNamedBoxColor(first)).toBe(second)
  })

  it('wraps from the last color to the first', () => {
    const last = NAMED_BOX_COLORS[NAMED_BOX_COLORS.length - 1]!
    expect(nextNamedBoxColor(last)).toBe(NAMED_BOX_COLORS[0])
  })

  it('uses index 0 when the current name is not in the palette', () => {
    expect(nextNamedBoxColor('unknown')).toBe(NAMED_BOX_COLORS[0])
  })
})
