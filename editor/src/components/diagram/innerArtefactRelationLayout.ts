/**
 * Horizontal spacing between inner-artefact columns when inheritance / inner relations are drawn.
 * {@link PackageInnerDiagram} sets `--triton-inner-relation-lane` from {@link innerArtefactRelationLaneGapPx}.
 */

/** Never shrink the flex gap below this — keeps smoothstep edges and labels readable. */
export const INNER_RELATION_LANE_MIN_PX = 56

/** Target gap when pressure allows (two-column chains, few edges). */
export const INNER_RELATION_LANE_PREFERRED_PX = 112

export const INNER_RELATION_LANE_MAX_PX = 176

/** Extra preferred width per non-overlay inner edge (label density), capped. */
export const INNER_RELATION_LANE_PER_EDGE_PX = 6
export const INNER_RELATION_LANE_EDGES_CAP = 8

/**
 * After this many extra columns beyond the first pair, horizontal pressure is treated as saturated
 * (relation gutters sit at {@link INNER_RELATION_LANE_MIN_PX}).
 */
export const INNER_RELATION_PRESSURE_FULL_AT_EXTRA_COLUMNS = 7

/**
 * Relations yield to pressure more easily than artefact columns (which keep stronger min widths in CSS).
 * Exponent > 1: a given pressure removes more of the “room” above {@link INNER_RELATION_LANE_MIN_PX}
 * than a linear ramp — gutters shrink faster as columns accumulate.
 */
export const INNER_RELATION_YIELD_EXPONENT = 2.35

function clamp01(x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  return x
}

/**
 * Preferred horizontal flex `gap` between adjacent inner-artefact columns (pixels).
 *
 * - **Roomy**: gap approaches preferred width (preferred + capped edge boost, capped at max).
 * - **Pressure** (many columns): gap lerps toward {@link INNER_RELATION_LANE_MIN_PX} with a convex
 *   yield curve so **relations compress more readily** than artefact bodies (low “spring” vs. columns).
 */
/**
 * Non-overlay inner SVG draws whose **both** endpoints are inner-column artefact ids.
 * Used for relation-lane `gap` only: excludes cross-package stubs (`__ext:`), port hops
 * (`__port:`), and package-folder bridges so outer / port plumbing does not widen gutters.
 */
export function innerMemberMemberRelationDrawCountForLaneGap(
  draws: readonly { overlay: boolean; from: string; to: string }[],
  columnArtefactIdSet: ReadonlySet<string>,
): number {
  if (!columnArtefactIdSet.size) return 0
  let n = 0
  for (const d of draws) {
    if (d.overlay) continue
    if (columnArtefactIdSet.has(d.from) && columnArtefactIdSet.has(d.to)) n += 1
  }
  return n
}

export function innerArtefactRelationLaneGapPx(columnCount: number, nonOverlayEdgeCount: number): number {
  const gutters = Math.max(0, columnCount - 1)
  if (gutters === 0) return INNER_RELATION_LANE_MIN_PX

  const edgeBoost =
    Math.min(INNER_RELATION_LANE_EDGES_CAP, Math.max(0, nonOverlayEdgeCount)) * INNER_RELATION_LANE_PER_EDGE_PX
  let preferredTop = INNER_RELATION_LANE_PREFERRED_PX + edgeBoost
  preferredTop = Math.min(INNER_RELATION_LANE_MAX_PX, preferredTop)

  const extraCols = Math.max(0, columnCount - 2)
  const pressure = clamp01(extraCols / INNER_RELATION_PRESSURE_FULL_AT_EXTRA_COLUMNS)
  const relationYield = Math.pow(1 - pressure, INNER_RELATION_YIELD_EXPONENT)

  const room = preferredTop - INNER_RELATION_LANE_MIN_PX
  const lane = INNER_RELATION_LANE_MIN_PX + room * relationYield

  return Math.round(Math.max(INNER_RELATION_LANE_MIN_PX, Math.min(INNER_RELATION_LANE_MAX_PX, lane)))
}

/**
 * Normalized horizontal **pressure** from inner-artefact **column count** alone (same curve as
 * {@link innerArtefactRelationLaneGapPx}, without edge boost). Used by outer layer drill to mirror
 * inner-diagram crowding on sibling columns and relation gutters.
 */
export function innerArtefactColumnPressure01(columnCount: number): number {
  if (!Number.isFinite(columnCount) || columnCount < 1) return 0
  const n = Math.round(columnCount)
  const extraCols = Math.max(0, n - 2)
  return clamp01(extraCols / INNER_RELATION_PRESSURE_FULL_AT_EXTRA_COLUMNS)
}

/**
 * Secondary pressure from **edge count** (label density), capped like {@link INNER_RELATION_LANE_EDGES_CAP}.
 */
export function innerArtefactEdgeDensityPressure01(nonOverlayEdgeCount: number): number {
  if (!Number.isFinite(nonOverlayEdgeCount) || nonOverlayEdgeCount <= 0) return 0
  const cap = INNER_RELATION_LANE_EDGES_CAP * 2
  return clamp01(nonOverlayEdgeCount / Math.max(1, cap))
}
