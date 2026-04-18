import { edgeContributesToClasspathDepth, isAggregateEdge } from './relationKinds'

/** Top + bottom gutter inside each layout region for smoothstep edges that skip ≥1 depth column. */
const CROSS_LAYER_LANE_MAX = 28
const MIN_STACK_BAND = 44

/**
 * Layout: columns = dependency depth. Each column gets an equal share of viewport width;
 * each node in a column gets an equal share of viewport height (minus margins & gaps).
 * Node `width` / `height` (and style) are set so boxes physically scale with the pane.
 */

const MODULE_W = 200
const MODULE_H = 72
const GROUP_MIN_W = 360
const GROUP_MIN_H = 280

const MARGIN_X = 28
const MARGIN_Y = 36
const INNER_PAD_X = 24
const INNER_PAD_Y = 44
const COLUMN_GUTTER = 64
const STACK_GAP = 18
const GROUP_WRAP = 24

/** Small inset so handles are not flush with column boundary */
const COL_INSET = 3

export type ViewportSize = { width: number; height: number }

function modulePinned(n: { data?: unknown }): boolean {
  const d = n.data
  return !!(d && typeof d === 'object' && (d as Record<string, unknown>).pinned === true)
}

function moduleLayerDrillFocus(n: { data?: unknown }): boolean {
  const d = n.data
  return !!(d && typeof d === 'object' && (d as Record<string, unknown>).layerDrillFocus === true)
}

function collectRegionParents(nodes: readonly { type?: string; parentNode?: unknown }[]): (string | undefined)[] {
  const keys = new Map<string | undefined, true>()
  keys.set(undefined, true)
  for (const n of nodes) {
    if (n.type !== 'module' || n.parentNode === undefined || n.parentNode === null || n.parentNode === '') continue
    keys.set(String(n.parentNode), true)
  }
  return [...keys.keys()]
}

function modulesInRegion(
  nodes: readonly any[],
  regionParent: string | undefined,
): any[] {
  return nodes.filter((n) => {
    if (n.type !== 'module') return false
    const p = n.parentNode
    const pk = p === undefined || p === null || p === '' ? undefined : String(p)
    return pk === regionParent
  })
}

/**
 * Same visibility rules as layer drill: depths that contain a pin hide all non-pinned boxes in that depth;
 * while a box has layer drill focus, same-depth non-pinned peers are also hidden.
 * Applies per container region (root + each group that holds modules).
 */
export function computeModuleHiddenForDependencyLayout(
  nodes: readonly any[],
  edges: readonly { source: string; target: string; label?: unknown }[],
): Map<string, boolean> {
  const out = new Map<string, boolean>()
  for (const region of collectRegionParents(nodes)) {
    const mods = modulesInRegion(nodes, region)
    if (!mods.length) continue

    const childIds = new Set(mods.map((c: { id: string }) => c.id))
    const internal = edges.filter(
      (e) => childIds.has(e.source) && childIds.has(e.target) && edgeContributesToClasspathDepth(e),
    )
    const depths = computeLayerDepths(childIds, internal)
    for (const c of mods) {
      if (!internal.some((e) => e.source === c.id || e.target === c.id)) {
        depths.set(c.id, 0)
      }
    }
    const maxD = depths.size ? Math.max(0, ...depths.values()) : 0

    const depthsWithPinned = new Set<number>()
    for (const m of mods) {
      const d = Math.min(maxD, Math.max(0, depths.get(m.id) ?? 0))
      if (modulePinned(m)) depthsWithPinned.add(d)
    }

    const focusMod = mods.find((m) => moduleLayerDrillFocus(m))
    const fd =
      focusMod != null ? Math.min(maxD, Math.max(0, depths.get(focusMod.id) ?? 0)) : null

    for (const m of mods) {
      const d = Math.min(maxD, Math.max(0, depths.get(m.id) ?? 0))
      if (focusMod && m.id === focusMod.id) {
        out.set(m.id, false)
        continue
      }
      let hide = false
      if (focusMod && fd !== null) {
        if (d === fd && !modulePinned(m)) hide = true
        if (depthsWithPinned.has(d) && !modulePinned(m)) hide = true
      } else if (depthsWithPinned.has(d) && !modulePinned(m)) {
        hide = true
      }
      out.set(m.id, hide)
    }
  }
  return out
}

/**
 * Set edge `hidden` only from current node visibility.
 * Do not OR with the previous `e.hidden`: after unpinning, endpoints become visible and edges must
 * show again; stale `hidden: true` from the collapsed layout would otherwise never clear.
 */
export function mergeEdgeHiddenForInvisibleEndpoints(edges: readonly any[], nodes: readonly any[]): any[] {
  const hiddenIds = new Set(nodes.filter((n) => n.hidden).map((n) => String(n.id)))
  return edges.map((e) => ({
    ...e,
    hidden: hiddenIds.has(String(e.source)) || hiddenIds.has(String(e.target)),
  }))
}

function sizeOf(n: {
  type?: string
  width?: number
  height?: number
  data?: unknown
  style?: { width?: number | string; height?: number | string }
}): { w: number; h: number } {
  if (typeof n.width === 'number' && typeof n.height === 'number') {
    return { w: n.width, h: n.height }
  }
  if (n.type === 'group') {
    return {
      w: Number(n.style?.width) || GROUP_MIN_W,
      h: Number(n.style?.height) || GROUP_MIN_H,
    }
  }
  return { w: MODULE_W, h: MODULE_H }
}

/**
 * Per-depth inner box width (layout uses `inner + 2*COL_INSET` as column track).
 */
function distributeColumnInners(maxD: number, usableW: number): number[] {
  const numCols = maxD + 1
  const gutter = Math.max(0, numCols - 1) * COLUMN_GUTTER
  const spaceForTracks = Math.max(numCols * 64, usableW - gutter)
  const equalColW = spaceForTracks / numCols
  const baseInner = Math.max(64, equalColW - 2 * COL_INSET)
  const inner: number[] = []
  for (let d = 0; d <= maxD; d++) {
    inner[d] = baseInner
  }
  const sumTracks = () => inner.reduce((s, inn) => s + inn + 2 * COL_INSET, 0)
  let st = sumTracks()
  if (st <= spaceForTracks + 0.5) return inner

  const floorInner = 64
  while (st > spaceForTracks + 0.5) {
    let pick = -1
    let best = -1
    for (let d = 0; d <= maxD; d++) {
      if (inner[d] <= floorInner + 0.5) continue
      if (inner[d] > best) {
        best = inner[d]
        pick = d
      }
    }
    if (pick === -1) break
    const step = Math.min(12, Math.max(1, Math.floor(inner[pick] - floorInner)))
    inner[pick] -= step
    st -= step
  }
  return inner
}

/**
 * Column layering depth:
 * - `depends on`: dependency must appear earlier (left) than dependent
 * - `aggregate`: aggregator appears earlier (left) than aggregated project
 */
function computeLayerDepths(
  participating: Set<string>,
  edges: readonly { source: string; target: string; label?: unknown }[],
): Map<string, number> {
  // Build “earlier → later” ordering edges for depth.
  const preds = new Map<string, string[]>()
  for (const id of participating) preds.set(id, [])
  for (const e of edges) {
    if (!participating.has(e.source) || !participating.has(e.target)) continue

    // depends-on: target (dependency) must be left of source (dependent)
    // aggregate: source (aggregator) must be left of target (aggregated)
    const earlier = isAggregateEdge(e) ? e.source : e.target
    const later = isAggregateEdge(e) ? e.target : e.source
    if (earlier === later) continue
    preds.get(later)!.push(earlier)
  }

  const memo = new Map<string, number>()
  const visiting = new Set<string>()

  function dfs(n: string): number {
    if (memo.has(n)) return memo.get(n)!
    if (visiting.has(n)) return 0
    visiting.add(n)
    let d = 0
    for (const p of preds.get(n)!) d = Math.max(d, 1 + dfs(p))
    visiting.delete(n)
    memo.set(n, d)
    return d
  }

  for (const id of participating) dfs(id)
  return memo
}

function nestDepth(id: string, byId: Map<string, { parentNode?: string }>): number {
  let d = 0
  let cur = byId.get(id)
  while (cur?.parentNode) {
    d++
    cur = byId.get(String(cur.parentNode))
  }
  return d
}

function estimateInnerViewport(
  parentId: string,
  out: { id: string; parentNode?: string; type?: string; style?: Record<string, unknown>; data?: unknown }[],
  edges: readonly { source: string; target: string; label?: unknown }[],
): ViewportSize {
  const children = out.filter((n) => String(n.parentNode) === parentId)
  const childIds = new Set(children.map((c) => c.id))
  const internal = edges.filter(
    (e) => childIds.has(e.source) && childIds.has(e.target) && edgeContributesToClasspathDepth(e),
  )
  const depths = computeLayerDepths(childIds, internal)
  for (const c of children) {
    if (!internal.some((e) => e.source === c.id || e.target === c.id)) {
      depths.set(c.id, 0)
    }
  }
  const maxD = depths.size ? Math.max(0, ...depths.values()) : 0
  const cols = maxD + 1
  const byDepth = new Map<number, typeof children>()
  for (let d = 0; d <= maxD; d++) byDepth.set(d, [])
  for (const c of children) {
    const d = Math.min(maxD, Math.max(0, depths.get(c.id) ?? 0))
    byDepth.get(d)!.push(c)
  }
  for (const arr of byDepth.values()) {
    arr.sort((a, b) => String(a.id).localeCompare(String(b.id)))
  }
  const byLayer = new Map<number, number>()
  for (const c of children) {
    const d = depths.get(c.id) ?? 0
    byLayer.set(d, (byLayer.get(d) ?? 0) + 1)
  }
  const maxStack = Math.max(1, ...byLayer.values())
  let trackSum = 0
  for (let d = 0; d <= maxD; d++) {
    trackSum += MODULE_W + 2 * COL_INSET
  }
  trackSum += Math.max(0, cols - 1) * COLUMN_GUTTER
  const innerW = 2 * INNER_PAD_X + trackSum + 48
  const innerH =
    2 * INNER_PAD_Y +
    maxStack * Math.max(MODULE_H, 120) +
    Math.max(0, maxStack - 1) * STACK_GAP +
    2 * CROSS_LAYER_LANE_MAX +
    48
  return { width: Math.max(340, innerW), height: Math.max(260, innerH) }
}

export type RegionStackMetrics = {
  padTop: number
  padBottom: number
  usableBand: number
  laneEach: number
  stackTop: number
  stackBand: number
  laneTopCenterY: number
  laneBottomCenterY: number
}

/** Vertical padding + inner stack band + routing lane centers (region-local Y, origin = parent top). */
export function regionStackMetrics(regionHeight: number, parentId: string | undefined): RegionStackMetrics {
  const padTop = parentId ? INNER_PAD_Y : MARGIN_Y
  const padBottom = parentId ? INNER_PAD_Y : MARGIN_Y
  const usableBand = Math.max(80, regionHeight - padTop - padBottom)
  const laneEach = Math.max(
    0,
    Math.min(CROSS_LAYER_LANE_MAX, Math.floor(Math.max(0, usableBand - MIN_STACK_BAND) / 2)),
  )
  const stackBand = Math.max(MIN_STACK_BAND, usableBand - 2 * laneEach)
  const stackTop = padTop + laneEach
  const laneTopCenterY = padTop + laneEach / 2
  const laneBottomCenterY = stackTop + stackBand + laneEach / 2
  return { padTop, padBottom, usableBand, laneEach, stackTop, stackBand, laneTopCenterY, laneBottomCenterY }
}

function layoutOneParent(
  parentId: string | undefined,
  out: any[],
  edges: readonly { source: string; target: string; label?: unknown }[],
  viewport: ViewportSize,
): void {
  const children = out.filter((n) => (parentId ? String(n.parentNode) === parentId : !n.parentNode))
  if (!children.length) return

  const childIds = new Set(children.map((c) => c.id))
  const internal = edges.filter(
    (e) => childIds.has(e.source) && childIds.has(e.target) && edgeContributesToClasspathDepth(e),
  )
  const depths = computeLayerDepths(childIds, internal)

  for (const c of children) {
    if (!internal.some((e) => e.source === c.id || e.target === c.id)) {
      depths.set(c.id, 0)
    }
  }

  const maxD = depths.size ? Math.max(0, ...depths.values()) : 0
  const byDepth = new Map<number, typeof children>()
  for (let d = 0; d <= maxD; d++) byDepth.set(d, [])
  for (const c of children) {
    const d = Math.min(maxD, Math.max(0, depths.get(c.id) ?? 0))
    byDepth.get(d)!.push(c)
  }
  for (const arr of byDepth.values()) {
    arr.sort((a, b) => String(a.id).localeCompare(String(b.id)))
  }

  const stackGeo = regionStackMetrics(viewport.height, parentId)
  const { stackTop, stackBand } = stackGeo

  const originX = parentId ? INNER_PAD_X : MARGIN_X
  const numCols = maxD + 1
  const usableW = Math.max(numCols * 96, viewport.width - originX - MARGIN_X)
  const columnInner = distributeColumnInners(maxD, usableW)

  let xCursor = originX
  for (let d = 0; d <= maxD; d++) {
    const layerNodes = byDepth.get(d) ?? []
    const visibleLayerNodes = layerNodes.filter((c) => !(c as { hidden?: boolean }).hidden)
    const n = visibleLayerNodes.length
    const totalGaps = Math.max(0, n - 1) * STACK_GAP
    const cellH = n > 0 ? (stackBand - totalGaps) / n : stackBand
    const boxW = Math.max(64, columnInner[d] ?? 64)
    const boxH = Math.max(44, cellH)
    const colTrackW = boxW + 2 * COL_INSET

    for (let i = 0; i < n; i++) {
      const node = visibleLayerNodes[i]!
      const idx = out.findIndex((x) => x.id === node.id)
      if (idx === -1) continue
      const x = xCursor + COL_INSET
      const y = stackTop + i * (cellH + STACK_GAP)

      const prevStyle = out[idx].style && typeof out[idx].style === 'object' ? { ...out[idx].style } : {}
      out[idx] = {
        ...out[idx],
        position: { x, y },
        width: boxW,
        height: boxH,
        style: {
          ...prevStyle,
          width: `${boxW}px`,
          height: `${boxH}px`,
          opacity: 1,
          pointerEvents: 'auto',
        },
      }
    }

    for (const node of layerNodes) {
      if (!(node as { hidden?: boolean }).hidden) continue
      const idx = out.findIndex((x) => x.id === node.id)
      if (idx === -1) continue
      const prevStyle = out[idx].style && typeof out[idx].style === 'object' ? { ...out[idx].style } : {}
      out[idx] = {
        ...out[idx],
        position: { x: xCursor + COL_INSET, y: stackTop },
        width: 1,
        height: 1,
        style: {
          ...prevStyle,
          width: '1px',
          height: '1px',
          opacity: 0,
          pointerEvents: 'none',
        },
      }
    }
    xCursor += colTrackW + COLUMN_GUTTER
  }

  if (parentId) {
    let maxR = 0
    let maxB = 0
    for (const c of children) {
      const n = out.find((x) => x.id === c.id)
      if (!n) continue
      const { w, h } = sizeOf(n)
      maxR = Math.max(maxR, n.position.x + w)
      maxB = Math.max(maxB, n.position.y + h)
    }
    const pidx = out.findIndex((n) => n.id === parentId)
    if (pidx !== -1) {
      const prev = out[pidx].style ?? {}
      out[pidx] = {
        ...out[pidx],
        style: {
          ...prev,
          width: Math.max(GROUP_MIN_W, maxR + INNER_PAD_X + GROUP_WRAP),
          height: Math.max(GROUP_MIN_H, maxB + INNER_PAD_Y + GROUP_WRAP),
        },
      }
    }
  }
}

/** Dependency depth within one parent region (same rules as layout). */
export function dependencyDepthsInRegion(
  allNodes: readonly { id: string; parentNode?: string }[],
  edges: readonly { source: string; target: string; label?: unknown }[],
  parentId: string | undefined,
): Map<string, number> {
  const children = allNodes.filter((n) =>
    parentId === undefined ? !n.parentNode : String(n.parentNode) === parentId,
  )
  const childIds = new Set(children.map((c) => c.id))
  const internal = edges.filter(
    (e) => childIds.has(e.source) && childIds.has(e.target) && edgeContributesToClasspathDepth(e),
  )
  const depths = computeLayerDepths(childIds, internal)
  for (const c of children) {
    if (!internal.some((e) => e.source === c.id || e.target === c.id)) {
      depths.set(c.id, 0)
    }
  }
  return depths
}

/** Match `layoutOneParent` horizontal spacing (box sits inside track with COL_INSET padding). */
const DRILL_COL_INSET = COL_INSET
const DRILL_COLUMN_GUTTER = COLUMN_GUTTER
const DRILL_MIN_BOX_W = 40

export type LayerDrillLayoutRect = {
  position: { x: number; y: number }
  width: number
  height: number
  style?: Record<string, string | number>
}

/**
 * Layer drill: widen the focused column while shrinking other columns so the overall
 * horizontal span (track + gutters) matches the pre-drill layout — no overlap into
 * neighboring depth columns.
 */
export function computeLayerDrillColumnLayout(input: {
  regionModules: ReadonlyArray<{
    id: string
    depth: number
    position: { x: number; y: number }
    width: number
    height: number
    style?: unknown
  }>
  focusId: string
  focusWidth: number
  siblingWidthScale: number
  /** Same-depth peers in this set keep full column inner width (e.g. pinned modules). */
  wideAtFocusDepthIds?: ReadonlySet<string>
}): Map<string, LayerDrillLayoutRect> {
  const { regionModules, focusId, focusWidth: focusWReq, siblingWidthScale, wideAtFocusDepthIds } = input
  const out = new Map<string, LayerDrillLayoutRect>()
  if (!regionModules.length) return out

  const focus = regionModules.find((m) => m.id === focusId)
  if (!focus) return out

  const fd = Math.max(0, focus.depth)
  let maxD = 0
  for (const m of regionModules) maxD = Math.max(maxD, m.depth)
  const numCols = maxD + 1

  type Mod = (typeof regionModules)[number]
  const byDepth = new Map<number, Mod[]>()
  for (let d = 0; d <= maxD; d++) byDepth.set(d, [])
  for (const m of regionModules) {
    const d = Math.min(maxD, Math.max(0, m.depth))
    byDepth.get(d)!.push(m)
  }

  let minL = Infinity
  let maxR = -Infinity
  for (const m of regionModules) {
    minL = Math.min(minL, m.position.x)
    maxR = Math.max(maxR, m.position.x + m.width)
  }

  const S_tracks =
    maxR - minL + 2 * DRILL_COL_INSET - Math.max(0, numCols - 1) * DRILL_COLUMN_GUTTER

  const minTrack = DRILL_MIN_BOX_W + 2 * DRILL_COL_INSET

  const colModsFd = byDepth.get(fd) ?? []
  const baseWFocusCol = colModsFd.length ? Math.max(...colModsFd.map((n) => n.width)) : focus.width
  const wSib = Math.max(DRILL_MIN_BOX_W, Math.round(baseWFocusCol * siblingWidthScale))

  const track0 = new Map<number, number>()
  for (let d = 0; d <= maxD; d++) {
    const ms = byDepth.get(d) ?? []
    const boxW = ms.length ? Math.max(...ms.map((n) => n.width)) : DRILL_MIN_BOX_W
    track0.set(d, boxW + 2 * DRILL_COL_INSET)
  }

  /**
   * Other columns can shrink to `minTrack`; everything left is available for the focus column.
   * (Previously we used S_tracks − sum(original other tracks), which capped the focus at ~1 column
   * and erased the intended widening.)
   */
  const numOther = Math.max(0, numCols - 1)
  const minOtherTracksTotal = numOther * minTrack
  const maxFocusTrack = Math.max(minTrack, S_tracks - minOtherTracksTotal)
  const maxFocusInner = maxFocusTrack - 2 * DRILL_COL_INSET

  /** Target inner width: much wider than base, at least caller hint, capped by conserved span. */
  const focusInnerTarget = Math.min(
    maxFocusInner,
    Math.max(DRILL_MIN_BOX_W, focusWReq, wSib, Math.round(baseWFocusCol * 2.55)),
  )

  let trackFd = Math.min(maxFocusTrack, Math.max(minTrack, focusInnerTarget + 2 * DRILL_COL_INSET))

  const budgetOther = Math.max(0, S_tracks - trackFd)
  const trackNext = new Map<number, number>()
  trackNext.set(fd, trackFd)

  let sumOtherTracks = 0
  for (let d = 0; d <= maxD; d++) {
    if (d !== fd) sumOtherTracks += track0.get(d)!
  }

  for (let d = 0; d <= maxD; d++) {
    if (d === fd) continue
    const t0 = track0.get(d)!
    const t1 = sumOtherTracks > 0 ? (budgetOther * t0) / sumOtherTracks : t0
    trackNext.set(d, Math.max(minTrack, Math.round(t1)))
  }

  let sumT = 0
  for (let d = 0; d <= maxD; d++) sumT += trackNext.get(d)!
  if (sumT < S_tracks - 0.5) {
    trackNext.set(fd, trackNext.get(fd)! + Math.floor(S_tracks - sumT))
    sumT = 0
    for (let d = 0; d <= maxD; d++) sumT += trackNext.get(d)!
  }
  if (sumT > S_tracks + 0.5) {
    const scale = S_tracks / sumT
    for (let d = 0; d <= maxD; d++) {
      trackNext.set(d, Math.max(minTrack, Math.floor(trackNext.get(d)! * scale)))
    }
    sumT = 0
    for (let d = 0; d <= maxD; d++) sumT += trackNext.get(d)!
    let guard = 0
    while (sumT > S_tracks && guard++ < 5000) {
      let pick = -1
      let best = -1
      for (let d = 0; d <= maxD; d++) {
        const t = trackNext.get(d)!
        if (t > minTrack && d !== fd && t > best) {
          best = t
          pick = d
        }
      }
      if (pick === -1) {
        const tfd = trackNext.get(fd)!
        if (tfd > minTrack) trackNext.set(fd, tfd - 1)
        else break
      } else {
        trackNext.set(pick, trackNext.get(pick)! - 1)
      }
      sumT--
    }
  }

  let trackLeft = minL - DRILL_COL_INSET
  for (let d = 0; d <= maxD; d++) {
    const tw = trackNext.get(d)!
    const inner = Math.max(DRILL_MIN_BOX_W, tw - 2 * DRILL_COL_INSET)
    const ms = [...(byDepth.get(d) ?? [])].sort((a, b) => a.position.y - b.position.y)
    for (const m of ms) {
      const nh = m.height
      const ny = m.position.y
      let nw: number
      if (m.id === focusId) nw = inner
      else if (m.depth === fd && m.id !== focusId) {
        nw = wideAtFocusDepthIds?.has(m.id) ? inner : Math.min(wSib, inner)
      } else nw = inner
      nw = Math.max(DRILL_MIN_BOX_W, Math.min(nw, inner))
      const nx = trackLeft + DRILL_COL_INSET + (inner - nw) / 2
      const prevStyle = m.style && typeof m.style === 'object' ? { ...(m.style as Record<string, string | number>) } : {}
      out.set(m.id, {
        position: { x: nx, y: ny },
        width: nw,
        height: nh,
        style: { ...prevStyle, width: `${nw}px`, height: `${nh}px` },
      })
    }
    trackLeft += tw + DRILL_COLUMN_GUTTER
  }

  return out
}

function parentKey(n: { parentNode?: unknown }): string | undefined {
  const p = n.parentNode
  if (p === undefined || p === null || p === '') return undefined
  return String(p)
}

function worldTopLeft(nodeId: string, byId: Map<string, any>): { x: number; y: number } {
  const chain: any[] = []
  let cur: any | undefined = byId.get(nodeId)
  while (cur) {
    chain.push(cur)
    const p = cur.parentNode
    cur = p !== undefined && p !== null && p !== '' ? byId.get(String(p)) : undefined
  }
  let x = 0
  let y = 0
  for (let i = chain.length - 1; i >= 0; i--) {
    x += Number(chain[i].position?.x ?? 0)
    y += Number(chain[i].position?.y ?? 0)
  }
  return { x, y }
}

function stripRoutingFromEdge(edge: any): any {
  const po = edge.pathOptions
  if (!po || typeof po !== 'object') return { ...edge }
  const { centerX: _cx, centerY: _cy, ...rest } = po
  const keys = Object.keys(rest)
  if (!keys.length) {
    const { pathOptions: _p, ...e2 } = edge
    return { ...e2 }
  }
  return { ...edge, pathOptions: rest }
}

/**
 * For edges whose endpoints differ by ≥2 depth columns within the same parent region,
 * set smoothstep `pathOptions.centerY` to the reserved top or bottom routing lane so
 * the path does not run through intermediate modules.
 */
export function annotateCrossLayerEdgePathOptions(
  nodes: readonly any[],
  edges: readonly any[],
  rootViewport: ViewportSize,
): any[] {
  const byId = new Map<string, any>(nodes.map((n) => [String(n.id), n]))
  let stripe = 0

  return edges.map((edge) => {
    const src = byId.get(String(edge.source))
    const tgt = byId.get(String(edge.target))
    if (!src || !tgt) return stripRoutingFromEdge({ ...edge })

    const pkS = parentKey(src)
    const pkT = parentKey(tgt)
    if (pkS !== pkT) return stripRoutingFromEdge({ ...edge })

    if (!edgeContributesToClasspathDepth(edge)) return stripRoutingFromEdge({ ...edge })

    const regionParent = pkS
    const depths = dependencyDepthsInRegion(nodes, edges, regionParent)
    const d1 = depths.get(String(src.id))
    const d2 = depths.get(String(tgt.id))
    if (d1 === undefined || d2 === undefined) return stripRoutingFromEdge({ ...edge })
    if (Math.abs(d1 - d2) < 2) return stripRoutingFromEdge({ ...edge })

    const regionH =
      regionParent === undefined
        ? rootViewport.height
        : Number(byId.get(regionParent)?.style?.height) || GROUP_MIN_H

    const geo = regionStackMetrics(regionH, regionParent)
    const originY = regionParent === undefined ? 0 : worldTopLeft(regionParent, byId).y
    const useTop = (stripe++ & 1) === 0
    const laneCenterY = originY + (useTop ? geo.laneTopCenterY : geo.laneBottomCenterY)

    const baseOpts = edge.pathOptions && typeof edge.pathOptions === 'object' ? { ...edge.pathOptions } : {}
    return {
      ...edge,
      pathOptions: { ...baseOpts, centerY: laneCenterY },
    }
  })
}

/**
 * Wider module width during layer drill: matches column math from layout, spans ~2–3 columns
 * so labels have room without resizing the outer pane.
 */
export function focusedModuleWidthForDrill(
  viewportRoot: ViewportSize,
  numCols: number,
  baseW: number,
  parentNode: string | undefined,
  allNodes: readonly any[],
): number {
  let innerW = viewportRoot.width
  if (parentNode) {
    const p = allNodes.find((n) => n.id === parentNode)
    const raw = p?.style?.width
    const pw = typeof raw === 'number' ? raw : Number(raw) || GROUP_MIN_W
    innerW = Math.max(200, pw - 2 * INNER_PAD_X - 24)
  }
  const originX = parentNode ? INNER_PAD_X : MARGIN_X
  const marginX = parentNode ? INNER_PAD_X : MARGIN_X
  const vp: ViewportSize = { width: innerW, height: viewportRoot.height }
  const usableW = Math.max(numCols * 96, vp.width - originX - marginX)
  const colW = (usableW - Math.max(0, numCols - 1) * COLUMN_GUTTER) / numCols
  const colInnerW = Math.max(64, colW - 2 * COL_INSET)
  const span = Math.min(vp.width - originX - marginX - 8, colInnerW * 3.15 + COLUMN_GUTTER)
  return Math.round(Math.max(baseW, span))
}

/** Vertical band height for maximizing a node in a layer drill (root vs nested group). */
export function verticalBandForLayerDrill(
  allNodes: readonly any[],
  parentId: string | undefined,
  viewportHeight: number,
): { padTop: number; usable: number } {
  if (parentId === undefined) {
    const padBottom = MARGIN_Y
    return { padTop: MARGIN_Y, usable: Math.max(80, viewportHeight - MARGIN_Y - padBottom) }
  }
  const p = allNodes.find((n) => n.id === parentId)
  const ph = Number(p?.style?.height) || GROUP_MIN_H
  return { padTop: INNER_PAD_Y, usable: Math.max(80, ph - INNER_PAD_Y - INNER_PAD_Y) }
}

/**
 * Positions all nodes: nested regions first (deepest parent), then root region using `viewport`.
 */
export function layoutDepthInViewport(
  nodes: readonly any[],
  edges: readonly { source: string; target: string; label?: unknown }[],
  viewport: ViewportSize,
): any[] {
  const hiddenById = computeModuleHiddenForDependencyLayout(nodes, edges)
  const out = nodes.map((n) => {
    const base = {
      ...n,
      position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
      style: n.style ? { ...n.style } : undefined,
    }
    if (n.type === 'module') {
      return { ...base, hidden: hiddenById.get(n.id) ?? false }
    }
    return base
  })
  const byId = new Map(out.map((n) => [n.id, n]))

  const parentIds = [...new Set(out.filter((n) => n.parentNode).map((n) => String(n.parentNode)))]
  parentIds.sort((a, b) => nestDepth(b, byId) - nestDepth(a, byId))

  for (const pid of parentIds) {
    const vp = estimateInnerViewport(pid, out, edges)
    layoutOneParent(pid, out, edges, vp)
  }

  layoutOneParent(undefined, out, edges, viewport)

  return out
}
