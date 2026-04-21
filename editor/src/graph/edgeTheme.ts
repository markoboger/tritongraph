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

/** Nudge label above the path (SVG y grows downward). */
function edgeLabelVerticalNudge(): Pick<CSSProperties, 'transform'> {
  return { transform: 'translateY(-15px)' }
}

/** Legible caption above the path; {@link GraphWorkspace} bumps opacity further on hover emphasis. */
export function dependencyEdgeLabelStyle(
  color: string = '#334155',
  emphasized: boolean = false,
): CSSProperties {
  return {
    ...edgeLabelVerticalNudge(),
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
