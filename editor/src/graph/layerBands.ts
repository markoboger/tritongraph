import type { TritonFlowNode, TritonFlowEdge } from './flowTypes'
import { dependencyDepthsInRegion } from './layoutDependencyLayers'

/**
 * Decorative "layer band" nodes: a faint coloured box behind each dependency-depth column of the
 * open (root) region. Purely visual — they make Triton's existing depth layout legible as
 * architecture layers. No conformance, no semantics, no Soll.
 *
 * Pure: takes already-laid-out nodes (final `position`/`width`/`height`) and returns one band node
 * per depth. Stripped before every relayout (see `graphNodesOnly`) so they never feed back into the
 * layout. v1 scope: root region only; nested regions are a follow-up.
 */

/** Horizontal breathing room so each band reads as a distinct column. */
const BAND_PAD_X = 18
/** Headroom above the topmost box so the "Layer N" label sits clear of every box. */
const BAND_TOP = 34
/** Small bottom margin. */
const BAND_BOTTOM = 12

/** A laid-out node carries its final dimension as a number or a `"123px"` string. */
function toPx(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const n = Number.parseFloat(value)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/** Drop layer-band nodes — used wherever the structural node set must stay band-free. */
export function graphNodesOnly<T extends { type?: string }>(nodes: readonly T[]): T[] {
  return nodes.filter((n) => n.type !== 'layer-band')
}

export function buildLayerBandNodes(
  nodes: readonly TritonFlowNode[],
  edges: readonly TritonFlowEdge[],
): TritonFlowNode[] {
  const rootNodes = nodes.filter((n) => !n.parentNode && n.type !== 'layer-band' && !n.hidden)
  const depths = dependencyDepthsInRegion(rootNodes, edges, undefined)

  type Box = { minX: number; maxX: number; minY: number; maxY: number }
  const byDepth = new Map<number, Box>()
  for (const n of rootNodes) {
    const d = depths.get(n.id)
    if (d === undefined) continue
    const dims = (n as { dimensions?: { width?: number; height?: number } }).dimensions
    const x = n.position?.x ?? 0
    const y = n.position?.y ?? 0
    const right = x + (toPx(n.width) || toPx(dims?.width))
    const bottom = y + (toPx(n.height) || toPx(dims?.height))
    const box = byDepth.get(d)
    if (!box) byDepth.set(d, { minX: x, maxX: right, minY: y, maxY: bottom })
    else {
      box.minX = Math.min(box.minX, x)
      box.maxX = Math.max(box.maxX, right)
      box.minY = Math.min(box.minY, y)
      box.maxY = Math.max(box.maxY, bottom)
    }
  }

  // Only meaningful when there is real layering (more than one column).
  if (byDepth.size <= 1) return []

  return [...byDepth.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([depth, box]) => {
      const width = box.maxX - box.minX + BAND_PAD_X * 2
      const height = box.maxY - box.minY + BAND_TOP + BAND_BOTTOM
      return {
        id: `layer-band:${depth}`,
        type: 'layer-band',
        position: { x: box.minX - BAND_PAD_X, y: box.minY - BAND_TOP },
        width,
        height,
        data: { label: `Layer ${depth}`, depth },
        style: { width: `${width}px`, height: `${height}px` },
        selectable: false,
        draggable: false,
        focusable: false,
        zIndex: 0,
      } as TritonFlowNode
    })
}
