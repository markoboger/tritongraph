import type { CSSProperties } from 'vue'
import { MarkerType } from '@vue-flow/core'
import type { EdgeMarker } from '@vue-flow/core'
import { SBT_DEPENDS_ON_STROKE } from './relationKinds'

/** Default stroke for new connections and edges without a stored kind. */
export const DEP_EDGE_STROKE = SBT_DEPENDS_ON_STROKE
/** Default edge thickness; use {@link DEP_EDGE_STROKE_WIDTH_EMPHASIS} when an endpoint is hovered. */
export const DEP_EDGE_STROKE_WIDTH = 1.35
export const DEP_EDGE_STROKE_WIDTH_EMPHASIS = 2.75

/** Closed arrow head for classpath / `depends on` edges (same marker for start or end). */
export function dependencyMarker(color: string = DEP_EDGE_STROKE): EdgeMarker {
  return {
    type: MarkerType.ArrowClosed,
    color,
    /** Slightly larger than handle dots so the arrow reads clearly at the target. */
    width: 14,
    height: 14,
    strokeWidth: 1.25,
  }
}

/** Stroke color only; width comes from global CSS (thin) + `.tg-edge-emph` when an endpoint is hovered. */
export function dependencyEdgeStyle(color: string = DEP_EDGE_STROKE) {
  return {
    stroke: color,
  }
}

/**
 * Lift the caption into the gap directly ABOVE its own edge track so the line runs just below the
 * text instead of through it. Must stay under half the relation track spacing
 * (`EDGE_TRACK_GAP_PX` = 18 in {@link layoutDependencyLayers}); otherwise the label reaches the
 * line on the track above — the bug the old fixed `-15px` caused once tracks were packed 18px
 * apart. 8px leaves ~3px of clearance to the track above and ~1.5px above its own line.
 */
const LABEL_ABOVE_TRACK_PX = 8

/** Legible caption above the path; {@link GraphWorkspace} bumps opacity further on hover emphasis. */
export function dependencyEdgeLabelStyle(
  color: string = '#334155',
  emphasized: boolean = false,
): CSSProperties {
  return {
    transform: `translateY(-${LABEL_ABOVE_TRACK_PX}px)`,
    opacity: emphasized ? 1 : 0.82,
    fill: color,
    fontSize: '11px',
    fontWeight: emphasized ? 600 : 500,
  }
}

/** Forward: arrow at target (depended-on module). Bidirectional: arrows on both ends. */
export function markersForRelation(bidirectional: boolean, color: string = DEP_EDGE_STROKE) {
  const m = dependencyMarker(color)
  if (bidirectional) {
    return { markerStart: m, markerEnd: m }
  }
  return { markerStart: undefined as undefined, markerEnd: m }
}

/** Aggregate parent → child: arrow at the **child** end (into the aggregated module). */
export function markersForAggregateEdge(color: string = DEP_EDGE_STROKE) {
  return {
    markerStart: undefined as undefined,
    markerEnd: dependencyMarker(color),
  }
}
