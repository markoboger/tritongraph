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

  it('compacts empty intermediate layers from bounded-relaxation cycles (no hidden flex columns)', () => {
    /**
     * Same shape as `member-matrix-pkg-2` with 6 members: linear chain plus a back-edge `4→1`.
     * Without compaction the bounded relaxation produces ~12 layers with 9 empty buckets in the
     * middle — those would render as wasted flex columns in {@link PackageInnerDiagram}.
     */
    const ids = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6']
    const edges = [
      { from: 'M1', to: 'M2' },
      { from: 'M2', to: 'M3' },
      { from: 'M3', to: 'M4' },
      { from: 'M4', to: 'M5' },
      { from: 'M5', to: 'M6' },
      { from: 'M1', to: 'M4' },
      { from: 'M5', to: 'M2' },
    ]
    const layers = assignInnerArtefactLayers(ids, edges)
    expect(layers.length).toBeLessThanOrEqual(ids.length)
    for (const layer of layers) expect(layer.length).toBeGreaterThan(0)
    expect(layers.flat().sort()).toEqual(['M1', 'M2', 'M3', 'M4', 'M5', 'M6'])
  })
})
