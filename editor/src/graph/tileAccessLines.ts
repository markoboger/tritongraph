/**
 * Lines inside a focused box from each incoming edge's handle (left border) to the tiles that edge's
 * source box imports into. All coordinates are box-local layout pixels.
 */

/** Where an incoming edge meets the box border. */
export interface TileAccessHandle {
  sourceId: string
  y: number
  color: string
  /** A removed import (git diff): drawn dashed like its ghost edge. */
  dashed?: boolean
  /** The edge is hovered (or one of its boxes is): drawn thick like the edge. */
  emphasized?: boolean
}

/** Left-middle of a tile that `sourceId` imports into. */
export interface TileAccessAnchor {
  sourceId: string
  x: number
  y: number
}

export interface TileAccessLine {
  sourceId: string
  color: string
  dashed?: boolean
  emphasized?: boolean
  points: [number, number][]
}

/** Vertical spread of the line ends when several boxes enter the same tile. */
const TILE_ENTRY_SPREAD_PX = 8

/**
 * Orthogonal routes: border → own vertical lane in the gutter left of the tiles → tile. Every source
 * box gets its own lane (top handle = leftmost) and its own entry height, so lines never overlap.
 */
export function tileAccessLines(handles: readonly TileAccessHandle[], anchors: readonly TileAccessAnchor[]): TileAccessLine[] {
  const routed = [...handles]
    .filter((h) => anchors.some((a) => a.sourceId === h.sourceId))
    .sort((a, b) => a.y - b.y)
  if (!routed.length) return []
  const gutterRight = Math.min(...anchors.map((a) => a.x))
  return routed.flatMap((handle, i) => {
    const laneX = (gutterRight * (i + 1)) / (routed.length + 1)
    const entryOffset = (i - (routed.length - 1) / 2) * TILE_ENTRY_SPREAD_PX
    return anchors
      .filter((a) => a.sourceId === handle.sourceId)
      .map((a) => ({
        sourceId: handle.sourceId,
        color: handle.color,
        dashed: handle.dashed,
        emphasized: handle.emphasized,
        points: [
          [0, handle.y],
          [laneX, handle.y],
          [laneX, a.y + entryOffset],
          [a.x, a.y + entryOffset],
        ] as [number, number][],
      }))
  })
}
