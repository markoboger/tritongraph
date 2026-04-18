import type { GraphNode } from '@vue-flow/core'

export type LayerFlipRect = { x: number; y: number; w: number; h: number }

export type LayerFlipState = {
  tx: number
  ty: number
  sx: number
  sy: number
  transition?: string
}

export function moduleLayoutRect(n: GraphNode): LayerFlipRect {
  return {
    x: n.position.x,
    y: n.position.y,
    w: Math.max(1, typeof n.width === 'number' ? n.width : 200),
    h: Math.max(1, typeof n.height === 'number' ? n.height : 72),
  }
}

/** Map “last” layout box to the visual of “first” (FLIP invert), origin top-left in parent flow space. */
export function flipDeltaFromFirstLast(first: LayerFlipRect, last: LayerFlipRect): Omit<LayerFlipState, 'transition'> {
  const lw = Math.max(1, last.w)
  const lh = Math.max(1, last.h)
  return {
    tx: first.x - last.x,
    ty: first.y - last.y,
    sx: first.w / lw,
    sy: first.h / lh,
  }
}

function stripLayerFlipFromNode(n: GraphNode): GraphNode {
  const raw = n.data
  if (!raw || typeof raw !== 'object' || !('layerFlip' in raw)) return n
  const { layerFlip: _lf, ...rest } = raw as Record<string, unknown>
  return { ...n, data: rest } as GraphNode
}

function mergeLayerFlip(
  n: GraphNode,
  flip: LayerFlipState,
): GraphNode {
  const prevData = n.data && typeof n.data === 'object' ? { ...(n.data as Record<string, unknown>) } : {}
  prevData.layerFlip = flip
  return { ...n, data: prevData } as GraphNode
}

/** Apply invert transform so nodes at `last` geometry appear at `first`. */
export function attachLayerFlipInvert(
  ns: GraphNode[],
  firstById: Map<string, LayerFlipRect>,
  transition: string,
): GraphNode[] {
  return ns.map((n) => {
    if (n.type !== 'module') return n
    if (n.hidden) return stripLayerFlipFromNode(n)
    const first = firstById.get(n.id)
    if (!first) return stripLayerFlipFromNode(n)
    const last = moduleLayoutRect(n)
    const { tx, ty, sx, sy } = flipDeltaFromFirstLast(first, last)
    return mergeLayerFlip(n, { tx, ty, sx, sy, transition })
  })
}

export function playLayerFlip(ns: GraphNode[], durationMs: number, easing: string): GraphNode[] {
  const tr = `transform ${durationMs}ms ${easing}`
  return ns.map((n) => {
    const raw = n.data as Record<string, unknown> | undefined
    if (n.type !== 'module' || !raw?.layerFlip) return n
    return mergeLayerFlip(n, { tx: 0, ty: 0, sx: 1, sy: 1, transition: tr })
  })
}

export function stripLayerFlipsFromNodes(ns: GraphNode[]): GraphNode[] {
  return ns.map((n) => stripLayerFlipFromNode(n))
}
