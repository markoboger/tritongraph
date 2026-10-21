import { describe, expect, it } from 'vitest'
import { tileAccessLines } from './tileAccessLines'

describe('tileAccessLines', () => {
  it('routes each source to every tile it imports into, on its own lane and entry height', () => {
    const lines = tileAccessLines(
      [
        { sourceId: 'b', y: 300, color: 'green' },
        { sourceId: 'a', y: 100, color: 'grey' },
      ],
      [
        { sourceId: 'a', x: 60, y: 200 },
        { sourceId: 'a', x: 60, y: 400 },
        { sourceId: 'b', x: 60, y: 200 },
      ],
    )
    expect(lines).toEqual([
      { sourceId: 'a', color: 'grey', points: [[0, 100], [20, 100], [20, 196], [60, 196]] },
      { sourceId: 'a', color: 'grey', points: [[0, 100], [20, 100], [20, 396], [60, 396]] },
      { sourceId: 'b', color: 'green', points: [[0, 300], [40, 300], [40, 204], [60, 204]] },
    ])
  })

  it('skips handles whose source reaches no tile', () => {
    expect(tileAccessLines([{ sourceId: 'x', y: 10, color: 'grey' }], [{ sourceId: 'a', x: 60, y: 20 }])).toEqual([])
  })
})
