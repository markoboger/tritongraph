import { defineComponent, h, inject } from 'vue'
import { BaseEdge, Position, getSmoothStepPath } from '@vue-flow/core'
import { ADDED_EDGE_COLOR, gitDiffImportEdgeColor, gitDiffKey, isGhostEdge } from '../../graph/gitDiffOverlay'

/**
 * Drop-in replacement for Vue Flow's built-in `SmoothStepEdge` that honors the
 * `centerX` / `centerY` routing the layout computes (spread from `edge.pathOptions`
 * by Vue Flow's edge wrapper).
 *
 * Two gaps in the stock component make lane routing invisible:
 * - its props whitelist omits `centerX` / `centerY`, so `getSmoothStepPath({ ...props })`
 *   never sees them;
 * - even with them passed, `getSmoothStepPath` only uses `centerY` for *backward*
 *   left-to-right connections (forward ones take the vertical-split branch).
 *
 * So for horizontal connections with a `centerY` lane we build the five-segment
 * lane path (out of the source, vertical to the lane, along the lane, vertical to
 * the target, in) ourselves and put the label on the lane segment. Everything else
 * falls through to `getSmoothStepPath` with the center options included.
 */

type Pt = { x: number; y: number }

function finiteNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** Orthogonal polyline → SVG path with quadratic corner bends (same idea as Vue Flow's getBend). */
export function roundedOrthogonalPath(points: readonly Pt[], radius: number): string {
  const p = points.filter(
    (pt, i) => i === 0 || Math.abs(pt.x - points[i - 1]!.x) > 0.01 || Math.abs(pt.y - points[i - 1]!.y) > 0.01,
  )
  if (!p.length) return ''
  let d = `M${p[0]!.x} ${p[0]!.y}`
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1]!
    const b = p[i]!
    const c = p[i + 1]!
    const lenIn = Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
    const lenOut = Math.abs(c.x - b.x) + Math.abs(c.y - b.y)
    const r = Math.min(radius, lenIn / 2, lenOut / 2)
    const collinear = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)
    if (r < 0.5 || collinear) {
      d += `L${b.x} ${b.y}`
      continue
    }
    const inX = b.x + Math.sign(a.x - b.x) * r
    const inY = b.y + Math.sign(a.y - b.y) * r
    const outX = b.x + Math.sign(c.x - b.x) * r
    const outY = b.y + Math.sign(c.y - b.y) * r
    d += `L${inX} ${inY}Q${b.x} ${b.y} ${outX} ${outY}`
  }
  d += `L${p[p.length - 1]!.x} ${p[p.length - 1]!.y}`
  return d
}

/**
 * Endpoints this close to the lane count as "on" it: handle anchors are aligned to the lane by
 * the layout, but Vue Flow's measured handle positions can lag a few pixels behind (they refresh
 * on the next `updateNodeInternals`). Without the tolerance every stale measurement renders as a
 * tiny hand-drawn-looking jog at the edge ends.
 */
export const LANE_SNAP_TOLERANCE_PX = 10

export type HorizontalLanePathParams = {
  sourceX: number
  sourceY: number
  sourcePosition: Position
  targetX: number
  targetY: number
  targetPosition: Position
  laneY: number
  offset: number
  borderRadius: number
  /** Backward relations: y of the loop's long run (exit/entry stay at `laneY`). */
  loopRunY?: number
}

/**
 * Lane path for horizontal connections — strictly orthogonal, no sloped segments:
 * - endpoints within {@link LANE_SNAP_TOLERANCE_PX} of the lane snap ONTO it (stale handle
 *   measurements would otherwise render as crooked starts/ends);
 * - both endpoints on the lane → one straight horizontal line;
 * - an off-lane side gets a stub plus one vertical step, then the run continues perfectly
 *   horizontal on the lane.
 */
export function horizontalLanePath({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  laneY,
  offset,
  borderRadius,
  loopRunY,
}: HorizontalLanePathParams): [path: string, labelX: number, labelY: number] {
  const sourceOnLane = Math.abs(sourceY - laneY) <= LANE_SNAP_TOLERANCE_PX
  const targetOnLane = Math.abs(targetY - laneY) <= LANE_SNAP_TOLERANCE_PX
  const sOff = sourcePosition === Position.Right ? offset : -offset
  const tOff = targetPosition === Position.Left ? -offset : offset
  const sStubX = sourceX + sOff
  const tStubX = targetX + tOff
  if (sourceOnLane && targetOnLane) {
    if (loopRunY !== undefined && Math.abs(loopRunY - laneY) > 1) {
      /** Backward loop: stub out, vertical to the run track, back across, vertical down/up,
       *  and enter at the same height it left — a plain line would hide behind the boxes. */
      const p: Pt[] = [
        { x: sourceX, y: laneY },
        { x: sStubX, y: laneY },
        { x: sStubX, y: loopRunY },
        { x: tStubX, y: loopRunY },
        { x: tStubX, y: laneY },
        { x: targetX, y: laneY },
      ]
      return [roundedOrthogonalPath(p, borderRadius), (sStubX + tStubX) / 2, loopRunY]
    }
    return [`M${sourceX} ${laneY}L${targetX} ${laneY}`, (sourceX + targetX) / 2, laneY]
  }
  const p: Pt[] = [{ x: sourceX, y: sourceOnLane ? laneY : sourceY }]
  if (!sourceOnLane) p.push({ x: sStubX, y: sourceY })
  p.push({ x: sStubX, y: laneY }, { x: tStubX, y: laneY })
  if (!targetOnLane) p.push({ x: tStubX, y: targetY })
  p.push({ x: targetX, y: targetOnLane ? laneY : targetY })
  return [roundedOrthogonalPath(p, borderRadius), (sStubX + tStubX) / 2, laneY]
}

export default defineComponent({
  name: 'LaneSmoothStepEdge',
  props: [
    'sourcePosition',
    'targetPosition',
    'label',
    'labelStyle',
    'labelShowBg',
    'labelBgStyle',
    'labelBgPadding',
    'labelBgBorderRadius',
    'sourceY',
    'sourceX',
    'targetX',
    'targetY',
    'borderRadius',
    'markerEnd',
    'markerStart',
    'interactionWidth',
    'offset',
    'centerX',
    'centerY',
    'loopRunY',
  ],
  compatConfig: { MODE: 3 },
  /**
   * We forward `attrs` into `h(BaseEdge, ...)` ourselves. Without this, Vue *also*
   * auto-applies the component's raw `$attrs` onto that same root vnode after render,
   * re-merging the original (pre-diff) edge style on top of ours — silently reverting
   * any stroke color override — and dumping every unrelated fallthrough attribute
   * (`source`, `data`, `sourceNode`, ...) onto the rendered `<path>` element.
   */
  inheritAttrs: false,
  setup(props: Record<string, unknown>, { attrs }: { attrs: Record<string, unknown> }) {
    const gitDiff = inject(gitDiffKey, null)
    /** Tint the line, label, and (via CSS var) the endpoint handle dots to match the diff status. */
    function diffOverride(): Record<string, unknown> {
      if (isGhostEdge(attrs.id as string | undefined)) return {}
      const color = gitDiffImportEdgeColor(gitDiff, String(attrs.source ?? ''), String(attrs.target ?? ''))
      if (!color) return {}
      const added = color === ADDED_EDGE_COLOR
      return {
        style: {
          ...(attrs.style as object),
          stroke: color,
          strokeWidth: added ? 2 : undefined,
          opacity: added ? 1 : 0.5,
        },
        labelStyle: { ...(props.labelStyle as object), fill: color },
      }
    }
    return () => {
      const sourcePosition = (props.sourcePosition as Position | undefined) ?? Position.Bottom
      const targetPosition = (props.targetPosition as Position | undefined) ?? Position.Top
      const sourceX = finiteNumber(props.sourceX) ?? 0
      const sourceY = finiteNumber(props.sourceY) ?? 0
      const targetX = finiteNumber(props.targetX) ?? 0
      const targetY = finiteNumber(props.targetY) ?? 0
      const centerY = finiteNumber(props.centerY)
      const horizontal =
        (sourcePosition === Position.Left || sourcePosition === Position.Right) &&
        (targetPosition === Position.Left || targetPosition === Position.Right)
      let path: string
      let labelX: number
      let labelY: number
      if (centerY !== undefined && horizontal) {
        ;[path, labelX, labelY] = horizontalLanePath({
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
          laneY: centerY,
          offset: finiteNumber(props.offset) ?? 20,
          borderRadius: finiteNumber(props.borderRadius) ?? 5,
          loopRunY: finiteNumber(props.loopRunY),
        })
      } else {
        ;[path, labelX, labelY] = getSmoothStepPath({
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
          borderRadius: finiteNumber(props.borderRadius),
          offset: finiteNumber(props.offset),
          centerX: finiteNumber(props.centerX),
          centerY,
        } as Parameters<typeof getSmoothStepPath>[0])
      }
      return h(BaseEdge as never, { path, labelX, labelY, ...attrs, ...props, ...diffOverride() })
    }
  },
})
