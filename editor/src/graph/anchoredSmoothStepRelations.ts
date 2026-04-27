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
  if (slotEl.matches('.package-box__port')) {
    const r = slotEl.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }
  const anchor = slotEl.querySelector(selector)
  if (anchor instanceof HTMLElement) {
    const r = anchor.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }
  const r = slotEl.getBoundingClientRect()
  return { x: side === 'left' ? r.left : r.right, y: r.top + r.height / 2 }
}

function smoothHorizontalStepPath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  borderRadius: number,
): [path: string, labelX: number, labelY: number] {
  const dx = targetX - sourceX
  const dy = targetY - sourceY
  if (Math.abs(dy) < 0.5) {
    return [`M${sourceX},${sourceY}L${targetX},${targetY}`, (sourceX + targetX) / 2, sourceY]
  }

  const dirX = dx >= 0 ? 1 : -1
  const dirY = dy >= 0 ? 1 : -1
  const minLane = 14
  const midX = Math.abs(dx) >= minLane * 2
    ? sourceX + dx / 2
    : (dirX > 0
      ? Math.max(sourceX, targetX) + minLane
      : Math.min(sourceX, targetX) - minLane)
  const r = Math.max(
    0,
    Math.min(
      borderRadius,
      Math.abs(midX - sourceX) / 2,
      Math.abs(midX - targetX) / 2,
      Math.abs(dy) / 2,
    ),
  )
  if (r < 0.5) {
    return [
      `M${sourceX},${sourceY}L${midX},${sourceY}L${midX},${targetY}L${targetX},${targetY}`,
      midX,
      (sourceY + targetY) / 2,
    ]
  }

  return [
    [
      `M${sourceX},${sourceY}`,
      `L${midX - dirX * r},${sourceY}`,
      `Q${midX},${sourceY} ${midX},${sourceY + dirY * r}`,
      `L${midX},${targetY - dirY * r}`,
      `Q${midX},${targetY} ${midX + dirX * r},${targetY}`,
      `L${targetX},${targetY}`,
    ].join(''),
    midX,
    (sourceY + targetY) / 2,
  ]
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

    const sourceX = (srcPt.x - rootRect.left) * scale
    const sourceY = (srcPt.y - rootRect.top) * scale
    const targetX = (tgtPt.x - rootRect.left) * scale
    const targetY = (tgtPt.y - rootRect.top) * scale
    const [path, labelX, labelY] = smoothHorizontalStepPath(
      sourceX,
      sourceY,
      targetX,
      targetY,
      borderRadius,
    )

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
