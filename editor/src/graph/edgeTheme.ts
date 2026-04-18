import type { CSSProperties } from 'vue'
import { MarkerType } from '@vue-flow/core'
import type { EdgeMarker } from '@vue-flow/core'
import { SBT_DEPENDS_ON_STROKE } from './relationKinds'

/** Default stroke for new connections and edges without a stored kind. */
export const DEP_EDGE_STROKE = SBT_DEPENDS_ON_STROKE
export const DEP_EDGE_STROKE_WIDTH = 2.75

/** Closed arrow head for classpath / `depends on` edges (same marker for start or end). */
export function dependencyMarker(color: string = DEP_EDGE_STROKE): EdgeMarker {
  return {
    type: MarkerType.ArrowClosed,
    color,
    width: 14,
    height: 14,
    strokeWidth: 1.5,
  }
}

export function dependencyEdgeStyle(color: string = DEP_EDGE_STROKE) {
  return {
    stroke: color,
    strokeWidth: DEP_EDGE_STROKE_WIDTH,
  }
}

/** Move label + background above the edge path (SVG y grows downward). */
export function dependencyEdgeLabelOffsetStyle(): CSSProperties {
  return { transform: 'translateY(-15px)' }
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
