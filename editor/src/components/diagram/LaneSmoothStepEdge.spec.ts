import { describe, expect, it } from 'vitest'
import { Position } from '@vue-flow/core'
import { horizontalLanePath, roundedOrthogonalPath } from './LaneSmoothStepEdge'

describe('roundedOrthogonalPath', () => {
  it('emits straight segments for collinear points and bends at corners', () => {
    const d = roundedOrthogonalPath(
      [
        { x: 0, y: 10 },
        { x: 20, y: 10 },
        { x: 20, y: 50 },
        { x: 80, y: 50 },
      ],
      5,
    )
    expect(d.startsWith('M0 10')).toBe(true)
    expect(d).toContain('Q20 10')
    expect(d).toContain('Q20 50')
    expect(d.endsWith('L80 50')).toBe(true)
  })

  it('drops zero-length segments instead of emitting degenerate bends', () => {
    const d = roundedOrthogonalPath(
      [
        { x: 0, y: 10 },
        { x: 0, y: 10 },
        { x: 40, y: 10 },
      ],
      5,
    )
    expect(d).toBe('M0 10L40 10')
  })
})

describe('horizontalLanePath', () => {
  it('routes through the lane Y between the source and target stubs', () => {
    const [d, labelX, labelY] = horizontalLanePath({
      sourceX: 100,
      sourceY: 200,
      sourcePosition: Position.Right,
      targetX: 500,
      targetY: 220,
      targetPosition: Position.Left,
      laneY: 40,
      offset: 20,
      borderRadius: 5,
    })
    expect(labelY).toBe(40)
    expect(labelX).toBe((120 + 480) / 2)
    /** The long horizontal run sits on the lane, not between the endpoint rows. */
    expect(d).toContain(' 40L')
    expect(d.startsWith('M100 200')).toBe(true)
    expect(d.endsWith('L500 220')).toBe(true)
  })

  it('snaps an endpoint within tolerance onto the lane — no slanted or jogged stub', () => {
    const [d] = horizontalLanePath({
      sourceX: 100,
      sourceY: 204,
      sourcePosition: Position.Right,
      targetX: 500,
      targetY: 300,
      targetPosition: Position.Left,
      laneY: 200,
      offset: 20,
      borderRadius: 0,
    })
    /** Source is 4px off the lane (≤ tolerance) → drawn flat at the lane; one vertical step at
     *  the target side only. */
    expect(d).toBe('M100 200L120 200L480 200L480 300L500 300')
  })

  it('loops backward relations: stub out, over the run track, back, and in at the exit height', () => {
    const [d, labelX, labelY] = horizontalLanePath({
      sourceX: 500,
      sourceY: 200,
      sourcePosition: Position.Right,
      targetX: 100,
      targetY: 200,
      targetPosition: Position.Left,
      laneY: 200,
      offset: 20,
      borderRadius: 0,
      loopRunY: 218,
    })
    expect(d).toBe('M500 200L520 200L520 218L80 218L80 200L100 200')
    expect(labelY).toBe(218)
    expect(labelX).toBe((520 + 80) / 2)
  })

  it('renders one straight horizontal line when both endpoints are within tolerance of the lane', () => {
    const [d, labelX, labelY] = horizontalLanePath({
      sourceX: 100,
      sourceY: 195,
      sourcePosition: Position.Right,
      targetX: 500,
      targetY: 206,
      targetPosition: Position.Left,
      laneY: 200,
      offset: 20,
      borderRadius: 5,
    })
    expect(d).toBe('M100 200L500 200')
    expect(labelX).toBe(300)
    expect(labelY).toBe(200)
  })
})
