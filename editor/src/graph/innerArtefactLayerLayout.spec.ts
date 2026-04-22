import { describe, expect, it } from 'vitest'
import { assignInnerArtefactLayers } from './innerArtefactLayerLayout'

describe('assignInnerArtefactLayers', () => {
  it('places parents left of children', () => {
    const layers = assignInnerArtefactLayers(
      ['Lifeform', 'AnimalBody', 'Vertebrate', 'Bear'],
      [
        { from: 'Lifeform', to: 'AnimalBody' },
        { from: 'AnimalBody', to: 'Vertebrate' },
        { from: 'Vertebrate', to: 'Bear' },
      ],
    )

    expect(layers).toEqual([['Lifeform'], ['AnimalBody'], ['Vertebrate'], ['Bear']])
  })

  it('keeps disconnected artefacts in the first layer', () => {
    const layers = assignInnerArtefactLayers(
      ['A', 'B', 'C'],
      [{ from: 'A', to: 'B' }],
    )

    expect(layers[0]).toEqual(['A', 'C'])
    expect(layers[1]).toEqual(['B'])
  })

  it('does not loop forever on cycles and still returns a bounded layout', () => {
    const layers = assignInnerArtefactLayers(
      ['A', 'B'],
      [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'A' },
      ],
    )

    expect(layers.flat().sort()).toEqual(['A', 'B'])
    expect(layers.length).toBeGreaterThan(0)
    expect(Number.isFinite(layers.length)).toBe(true)
  })
})
