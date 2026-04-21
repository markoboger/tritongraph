import { getSmoothStepPath, Position } from '@vue-flow/core'

export type AnchoredRelationSpec = {
  id: string
  from: string
  to: string
}

export type AnchoredRelationDraw = {
  id: string
  from: string
  to: string
  path: string
  labelX: number
  labelY: number
}

type AnchoredRelationBuildOptions = {
  rootEl: HTMLElement | null | undefined
  relations: readonly AnchoredRelationSpec[]
  slotEls: ReadonlyMap<string, HTMLElement>
  inAnchorSelector?: string
  outAnchorSelector?: string
  borderRadius?: number
}

function anchoredSlotCenter(
  slotEl: HTMLElement,
  selector: string,
  side: 'left' | 'right',
): { x: number; y: number } {
  const anchor = slotEl.querySelector(selector)
  if (anchor instanceof HTMLElement) {
    const r = anchor.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }
  const r = slotEl.getBoundingClientRect()
  return { x: side === 'left' ? r.left : r.right, y: r.top + r.height / 2 }
}

export function buildAnchoredSmoothStepRelationDraws(
  opts: AnchoredRelationBuildOptions,
): AnchoredRelationDraw[] {
  const root = opts.rootEl
  if (!root || !opts.relations.length) return []
  const rootRect = root.getBoundingClientRect()
  if (rootRect.width <= 0 || rootRect.height <= 0) return []

  const inAnchorSelector = opts.inAnchorSelector ?? '.package-box__artefact-anchor--in'
  const outAnchorSelector = opts.outAnchorSelector ?? '.package-box__artefact-anchor--out'
  const borderRadius = opts.borderRadius ?? 8

  /**
   * Vue Flow applies a CSS transform (scale) to the canvas for zoom. `getBoundingClientRect()`
   * returns visual/screen pixels (after scale), but the SVG coordinate system uses CSS layout
   * pixels (before scale). We derive the scale factor from the ratio of the root element's
   * clientWidth (layout px) to its screen width (getBoundingClientRect px) and apply it to all
   * coordinate deltas so edge paths land exactly on the anchor dots at any zoom level.
   */
  const scale = rootRect.width > 0 ? root.clientWidth / rootRect.width : 1

  const draws: AnchoredRelationDraw[] = []
  for (const rel of opts.relations) {
    const fromEl = opts.slotEls.get(rel.from)
    const toEl = opts.slotEls.get(rel.to)
    if (!fromEl || !toEl) continue

    const srcPt = anchoredSlotCenter(fromEl, outAnchorSelector, 'right')
    const tgtPt = anchoredSlotCenter(toEl, inAnchorSelector, 'left')

    const fwd = srcPt.x <= tgtPt.x
    const sourceX = ((fwd ? srcPt.x : tgtPt.x) - rootRect.left) * scale
    const sourceY = ((fwd ? srcPt.y : tgtPt.y) - rootRect.top) * scale
    const targetX = ((fwd ? tgtPt.x : srcPt.x) - rootRect.left) * scale
    const targetY = ((fwd ? tgtPt.y : srcPt.y) - rootRect.top) * scale

    const [path, labelX, labelY] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition: Position.Right,
      targetX,
      targetY,
      targetPosition: Position.Left,
      borderRadius,
    })

    draws.push({
      id: rel.id,
      from: rel.from,
      to: rel.to,
      path,
      labelX,
      labelY,
    })
  }
  return draws
}
