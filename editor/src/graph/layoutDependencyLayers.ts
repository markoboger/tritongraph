import { aggregateSourceHandleId, DEP_SOURCE_HANDLE } from './handles'
import { isLeafBoxNode } from './nodeKinds'
import { edgeContributesToClasspathDepth } from './relationKinds'

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
/**
 * Inset between a nested group's outer border and the leftmost / topmost child. Bumped beyond
 * the previous values (24 / 44) so nested package containers have visible margin on the LEFT
 * and TOP — the GROUP banner already lives in the top inset, so we keep more pixels there.
 */
const INNER_PAD_X = 32
const INNER_PAD_Y = 52
const COLUMN_GUTTER = 64
const STACK_GAP = 24
/**
 * Extra slack added on the RIGHT and BOTTOM when sizing a group container around its laid-out
 * children. Combined with `INNER_PAD_*` this gives roughly symmetric breathing room on all
 * four sides (top / left = `INNER_PAD_*`, right / bottom = `INNER_PAD_* + GROUP_WRAP`) plus
 * a little extra room for edge stubs leaving the rightmost children.
 */
const GROUP_WRAP = 28

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
    if (!isLeafBoxNode(n) || n.parentNode === undefined || n.parentNode === null || n.parentNode === '') continue
    keys.set(String(n.parentNode), true)
  }
  return [...keys.keys()]
}

function modulesInRegion(
  nodes: readonly any[],
  regionParent: string | undefined,
): any[] {
  return nodes.filter((n) => {
    if (!isLeafBoxNode(n)) return false
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
export type MergeEdgeHiddenOptions = {
  /** When true, edge is hidden in addition to endpoint-based hiding (e.g. relation-type filter). */
  hideEdgeForRelation?: (e: any) => boolean
}

export function mergeEdgeHiddenForInvisibleEndpoints(
  edges: readonly any[],
  nodes: readonly any[],
  opts?: MergeEdgeHiddenOptions,
): any[] {
  const hiddenIds = new Set(nodes.filter((n) => n.hidden).map((n) => String(n.id)))
  const relHide = opts?.hideEdgeForRelation
  return edges.map((e) => ({
    ...e,
    hidden:
      hiddenIds.has(String(e.source)) ||
      hiddenIds.has(String(e.target)) ||
      (relHide?.(e) ?? false),
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
 * Required size of a child during this parent's layout pass.
 *
 * For leaf boxes we always return the standard module footprint. For group containers we read
 * the dimensions written back by THIS child's own (deeper-first) `layoutOneParent` pass — that
 * pass measures the bounding box of its grand-children and stores the result on the group's
 * `style.width` / `style.height`. By the time the outer parent runs (deepest-first ordering
 * in `layoutDepthInViewport`), every group child therefore has up-to-date min-required
 * dimensions on its style. If for any reason no inner pass has run (no children in the
 * group), we fall back to `GROUP_MIN_*` to keep the container visually meaningful.
 *
 * This is what makes nested package containers (e.g. `animal` with 12+ artefacts) NOT get
 * crushed into their parent's equal-height cell allocation: the outer layout sees the actual
 * height the inner content needs and reserves it.
 */
function requiredChildSize(child: any): { w: number; h: number } {
  if (isLeafBoxNode(child)) return { w: MODULE_W, h: MODULE_H }
  const w = Number(child.style?.width)
  const h = Number(child.style?.height)
  return {
    w: Number.isFinite(w) && w > 0 ? w : GROUP_MIN_W,
    h: Number.isFinite(h) && h > 0 ? h : GROUP_MIN_H,
  }
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
 * Column layering depth (left → right):
 * - `depends on`: **from** = dependent (left), **to** = classpath dependency (right)
 * - `aggregate`: aggregator left of aggregated child (same as YAML from → to)
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

    // depends-on: source (dependent) left of target (depended-on)
    // aggregate: source (aggregator) left of target (aggregated)
    const earlier = e.source
    const later = e.target
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
  out: { id: string; parentNode?: string; type?: string; style?: Record<string, unknown>; data?: unknown; hidden?: boolean }[],
  edges: readonly { source: string; target: string; label?: unknown }[],
): ViewportSize {
  /**
   * Skip hidden children: they don't render and `layoutOneParent` already filters them out
   * before placing nodes. Counting their required size here would inflate the parent's
   * estimated viewport — which matters for the package expand affordance, where sibling
   * groups are temporarily hidden so the focused group can claim the full layer height.
   */
  const children = out.filter((n) => String(n.parentNode) === parentId && !n.hidden)
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
  /**
   * Per-column required size: WIDTH = max child width in the column (so groups that need a
   * wider footprint than a leaf module get the column track they need), HEIGHT = sum of child
   * heights + gaps (so a column of `n` children allocates space proportional to each child's
   * own needs rather than dividing a fixed band into `n` equal cells). This is what allows a
   * tall package container next to short artefacts to coexist without the tall one being
   * crushed.
   */
  let trackSum = 0
  let maxColH = 0
  for (let d = 0; d <= maxD; d++) {
    const arr = byDepth.get(d) ?? []
    let colW = MODULE_W
    let colH = 0
    for (const c of arr) {
      const sz = requiredChildSize(c)
      colW = Math.max(colW, sz.w)
      colH += sz.h
    }
    colH += Math.max(0, arr.length - 1) * STACK_GAP
    trackSum += colW + 2 * COL_INSET
    maxColH = Math.max(maxColH, colH)
  }
  trackSum += Math.max(0, cols - 1) * COLUMN_GUTTER
  const innerW = 2 * INNER_PAD_X + trackSum + 48
  const innerH = 2 * INNER_PAD_Y + Math.max(MODULE_H, maxColH) + 2 * CROSS_LAYER_LANE_MAX + 48
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

    /**
     * Two-pass cell sizing for mixed leaf+group columns:
     *   1. Group children KEEP the size their inner layout already determined (read via
     *      `requiredChildSize`). Crushing them would make their grand-children overflow.
     *   2. Leaf children share whatever vertical space remains in the stack band (or fall
     *      back to MODULE_H if nothing remains). They still get the column's full track
     *      width (`baseColW`).
     * Column width is the max of the layout-distributed track width and the widest group
     * child in the column — so a wide nested container forces its column wider rather than
     * being cropped.
     */
    const childSizes = visibleLayerNodes.map((c) => requiredChildSize(c))
    const sumGroupH = visibleLayerNodes.reduce(
      (s, c, i) => s + (isLeafBoxNode(c) ? 0 : childSizes[i]!.h),
      0,
    )
    const numLeaves = visibleLayerNodes.reduce((s, c) => s + (isLeafBoxNode(c) ? 1 : 0), 0)
    const remainingH = Math.max(0, stackBand - sumGroupH - totalGaps)
    const leafH = numLeaves > 0 ? Math.max(MODULE_H, remainingH / numLeaves) : Math.max(44, stackBand)
    const maxGroupChildW = visibleLayerNodes.reduce(
      (m, c, i) => (isLeafBoxNode(c) ? m : Math.max(m, childSizes[i]!.w)),
      0,
    )
    const baseColW = Math.max(64, columnInner[d] ?? 64)
    const boxW = Math.max(baseColW, maxGroupChildW)
    const colTrackW = boxW + 2 * COL_INSET

    let yCursor = stackTop
    for (let i = 0; i < n; i++) {
      const node = visibleLayerNodes[i]!
      const idx = out.findIndex((x) => x.id === node.id)
      if (idx === -1) {
        // Still advance cursor so subsequent siblings don't collapse onto missing slot.
        yCursor += (isLeafBoxNode(node) ? leafH : childSizes[i]!.h) + STACK_GAP
        continue
      }
      const x = xCursor + COL_INSET
      const y = yCursor
      const isLeaf = isLeafBoxNode(node)
      const childH = isLeaf ? leafH : childSizes[i]!.h
      const childW = isLeaf ? boxW : Math.max(boxW, childSizes[i]!.w)

      const prevStyle = out[idx].style && typeof out[idx].style === 'object' ? { ...out[idx].style } : {}
      out[idx] = {
        ...out[idx],
        position: { x, y },
        width: childW,
        height: childH,
        style: {
          ...prevStyle,
          width: `${childW}px`,
          height: `${childH}px`,
          opacity: 1,
          pointerEvents: 'auto',
        },
      }
      yCursor += childH + STACK_GAP
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
      /** Outer Scala package frame: match left inset on the right/bottom (no extra `GROUP_WRAP`). */
      const tight = isPackageScopeGroupNode(out, parentId)
      const padR = tight ? INNER_PAD_X : INNER_PAD_X + GROUP_WRAP
      const padB = tight ? INNER_PAD_Y : INNER_PAD_Y + GROUP_WRAP
      out[pidx] = {
        ...out[pidx],
        style: {
          ...prev,
          width: Math.max(GROUP_MIN_W, maxR + padR),
          height: Math.max(GROUP_MIN_H, maxB + padB),
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
 * Assign distinct **source** handles (`agg-out-0` …) for parallel depth relations from the same
 * module (classpath, aggregate, or any labeled relation) so Vue Flow gets distinct anchor points.
 */
export function annotateParallelAggregateEdgeOffsets(
  nodes: readonly any[],
  edges: readonly any[],
): any[] {
  const byId = new Map<string, any>(nodes.map((n) => [String(n.id), n]))
  const out = edges.map((e) => ({ ...e }))
  const byOutId = new Map(out.map((e) => [String(e.id), e]))

  for (const e of out) {
    if (!edgeContributesToClasspathDepth(e)) continue
    const sh = String((e as { sourceHandle?: string }).sourceHandle ?? '')
    if (sh === DEP_SOURCE_HANDLE || sh === 'dep-out') {
      e.sourceHandle = aggregateSourceHandleId(0)
    } else if (sh === 'agg-out') {
      e.sourceHandle = aggregateSourceHandleId(0)
    }
  }

  function centerYWorld(nodeId: string): number {
    const n = byId.get(nodeId)
    if (!n) return 0
    const top = worldTopLeft(nodeId, byId).y
    const h = typeof n.height === 'number' && Number.isFinite(n.height) ? n.height : MODULE_H
    return top + h / 2
  }

  const groups = new Map<string, string[]>()
  for (const e of out) {
    if ((e as { hidden?: boolean }).hidden) continue
    if (!edgeContributesToClasspathDepth(e)) continue
    const src = byId.get(String(e.source))
    const tgt = byId.get(String(e.target))
    if (!src || !tgt) continue
    if (parentKey(src) !== parentKey(tgt)) continue
    const region = parentKey(src) ?? '__root__'
    const key = `${region}|${e.source}`
    const ids = groups.get(key) ?? []
    ids.push(String(e.id))
    groups.set(key, ids)
  }

  for (const ids of groups.values()) {
    if (ids.length < 2) continue
    ids.sort((a, b) => {
      const ea = byOutId.get(a)!
      const eb = byOutId.get(b)!
      const dy = centerYWorld(String(ea.target)) - centerYWorld(String(eb.target))
      if (dy !== 0) return dy
      return String(ea.target).localeCompare(String(eb.target))
    })
    for (let i = 0; i < ids.length; i++) {
      const edge = byOutId.get(ids[i]!)!
      edge.sourceHandle = aggregateSourceHandleId(i)
    }
  }

  return out
}

const AGG_LANE_STAGGER_PX = 5

/**
 * Route depth-relation smoothstep edges through the region’s top/bottom padding lanes (outside the
 * module stack band) with a small stagger so parallel lines stay separated and off boxes.
 */
export function annotateAggregateVerticalPaths(
  nodes: readonly any[],
  edges: readonly any[],
  rootViewport: ViewportSize,
): any[] {
  const byId = new Map<string, any>(nodes.map((n) => [String(n.id), n]))

  type SlotEdge = { id: string; slot: number }
  const bySourceRegion = new Map<string, SlotEdge[]>()

  for (const e of edges) {
    if ((e as { hidden?: boolean }).hidden) continue
    if (!edgeContributesToClasspathDepth(e)) continue
    const src = byId.get(String(e.source))
    const tgt = byId.get(String(e.target))
    if (!src || !tgt) continue
    if (parentKey(src) !== parentKey(tgt)) continue
    const region = parentKey(src) ?? '__root__'
    const key = `${region}|${e.source}`
    const sh = String((e as { sourceHandle?: string }).sourceHandle ?? '')
    const m = sh.match(/^agg-out-(\d+)$/)
    const slot = m ? Number(m[1]) : 0
    const list = bySourceRegion.get(key) ?? []
    list.push({ id: String((e as { id: string }).id), slot })
    bySourceRegion.set(key, list)
  }

  const indexInFan = new Map<string, { idx: number; count: number }>()
  for (const list of bySourceRegion.values()) {
    list.sort((a, b) => a.slot - b.slot || a.id.localeCompare(b.id))
    const n = list.length
    for (let i = 0; i < n; i++) {
      indexInFan.set(list[i]!.id, { idx: i, count: n })
    }
  }

  const depthMemo = new Map<string | undefined, Map<string, number>>()
  function depthsIn(region: string | undefined): Map<string, number> {
    if (!depthMemo.has(region)) {
      depthMemo.set(region, dependencyDepthsInRegion(nodes, edges, region))
    }
    return depthMemo.get(region)!
  }

  return edges.map((edge) => {
    if (!edgeContributesToClasspathDepth(edge)) return { ...edge }
    const src = byId.get(String(edge.source))
    const tgt = byId.get(String(edge.target))
    if (!src || !tgt) return { ...edge }
    if (parentKey(src) !== parentKey(tgt)) return { ...edge }

    const regionParent = parentKey(src)
    const fan = indexInFan.get(String(edge.id))
    const parallelCount = Math.max(1, fan?.count ?? 1)
    const dmap = depthsIn(regionParent)
    const d1 = dmap.get(String(src.id))
    const d2 = dmap.get(String(tgt.id))
    const depthOk = d1 !== undefined && d2 !== undefined
    const depthDelta = depthOk ? Math.abs(d1 - d2) : 0
    /** Skip lane detour when a single shallow edge can run straight; use lanes when skipping columns or fanning parallels. */
    const needDetour = (depthOk && depthDelta >= 2) || parallelCount > 1
    if (!needDetour) {
      return stripRoutingFromEdge({ ...edge })
    }

    const regionH =
      regionParent === undefined
        ? rootViewport.height
        : Number(byId.get(regionParent)?.style?.height) || GROUP_MIN_H

    const geo = regionStackMetrics(regionH, regionParent)
    const originY = regionParent === undefined ? 0 : worldTopLeft(regionParent, byId).y

    const idx = fan?.idx ?? 0
    const count = parallelCount
    const useTop = idx % 2 === 0
    const baseLane = useTop ? geo.laneTopCenterY : geo.laneBottomCenterY
    const mid = (count - 1) / 2
    const staggerRaw = (idx - mid) * AGG_LANE_STAGGER_PX
    const maxSt = Math.max(6, geo.laneEach * 0.38 - 1)
    const stagger = Math.max(-maxSt, Math.min(maxSt, staggerRaw))
    const centerY = originY + baseLane + stagger

    const baseOpts = edge.pathOptions && typeof edge.pathOptions === 'object' ? { ...edge.pathOptions } : {}
    return {
      ...edge,
      pathOptions: { ...baseOpts, centerY },
    }
  })
}

/**
 * For edges whose endpoints differ by ≥2 depth columns within the same parent region,
 * set smoothstep `pathOptions.centerY` to the reserved top or bottom routing lane so
 * the path does not run through intermediate modules.
 */
export function annotateCrossLayerEdgePathOptions(
  nodes: readonly any[],
  edges: readonly any[],
  _rootViewport: ViewportSize,
): any[] {
  const byId = new Map<string, any>(nodes.map((n) => [String(n.id), n]))

  return edges.map((edge) => {
    const src = byId.get(String(edge.source))
    const tgt = byId.get(String(edge.target))
    if (!src || !tgt) return stripRoutingFromEdge({ ...edge })

    const pkS = parentKey(src)
    const pkT = parentKey(tgt)
    if (pkS !== pkT) return stripRoutingFromEdge({ ...edge })

    /** Cross-column banding used to live here; all labeled depth relations now use {@link annotateAggregateVerticalPaths}. */
    return stripRoutingFromEdge({ ...edge })
  })
}

/** Cross-layer classpath routing, aggregate handle fan-out, then aggregate vertical lanes. */
export function routeSmoothstepEdgesInViewport(
  nodes: readonly any[],
  edges: readonly any[],
  rootViewport: ViewportSize,
): any[] {
  const afterDepth = annotateCrossLayerEdgePathOptions(nodes, edges, rootViewport)
  const afterHandles = annotateParallelAggregateEdgeOffsets(nodes, afterDepth)
  return annotateAggregateVerticalPaths(nodes, afterHandles, rootViewport)
}

/** Per-module handle `top` % (0–100) derived from partner box centers — call after layout + routing. */
export type ModuleAnchorTops = {
  aggIn?: number
  aggOut?: Record<string, number>
}

type AnchorAcc = {
  /** Target world Y (flow space) for each incident edge on this handle — median → one shared Y → local %. */
  aggInY: number[]
  aggOutY: Map<number, number[]>
}

function moduleHeightPx(n: any): number {
  return typeof n?.height === 'number' && Number.isFinite(n.height) ? n.height : MODULE_H
}

function worldCenterYForNode(id: string, byId: Map<string, any>): number {
  const n = byId.get(id)
  if (!n) return 0
  const tl = worldTopLeft(id, byId)
  return tl.y + moduleHeightPx(n) / 2
}

function roundWorldY(y: number): number {
  return Math.round(y * 64) / 64
}

function worldYToLocalTopPct(nodeId: string, worldY: number, byId: Map<string, any>): number {
  const y = roundWorldY(worldY)
  const tl = worldTopLeft(nodeId, byId)
  const h = moduleHeightPx(byId.get(nodeId))
  if (h < 1) return 50
  const raw = ((y - tl.y) / h) * 100
  const clamped = Math.max(8, Math.min(92, raw))
  return Math.round(clamped * 1000) / 1000
}

function median(nums: number[]): number | undefined {
  if (!nums.length) return undefined
  const s = [...nums].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/** Aligns module handles so paired endpoints share one world Y (median when several edges share a handle), then local `top` %. */
export function applyHandleAnchorAlignment(nodes: readonly any[], edges: readonly any[]): any[] {
  const byId = new Map<string, any>(nodes.map((n) => [String(n.id), n]))
  const acc = new Map<string, AnchorAcc>()

  function accFor(id: string): AnchorAcc {
    let a = acc.get(id)
    if (!a) {
      a = { aggInY: [], aggOutY: new Map() }
      acc.set(id, a)
    }
    return a
  }

  for (const e of edges) {
    if ((e as { hidden?: boolean }).hidden) continue
    if (!edgeContributesToClasspathDepth(e)) continue
    const s = String(e.source)
    const t = String(e.target)
    const src = byId.get(s)
    const tgt = byId.get(t)
    if (!src || !tgt) continue
    if (!isLeafBoxNode(src) || !isLeafBoxNode(tgt)) continue
    if (parentKey(src) !== parentKey(tgt)) continue

    const midY = roundWorldY((worldCenterYForNode(s, byId) + worldCenterYForNode(t, byId)) / 2)

    const sh = String((e as { sourceHandle?: string }).sourceHandle ?? '')
    const m = sh.match(/^agg-out-(\d+)$/)
    const slot = m ? Number(m[1]) : 0
    const sa = accFor(s)
    const ta = accFor(t)
    let arr = sa.aggOutY.get(slot)
    if (!arr) {
      arr = []
      sa.aggOutY.set(slot, arr)
    }
    arr.push(midY)
    ta.aggInY.push(midY)
  }

  const anchorById = new Map<string, ModuleAnchorTops>()
  for (const [id, a] of acc) {
    const tops: ModuleAnchorTops = {}
    const gIy = median(a.aggInY)
    if (gIy !== undefined) tops.aggIn = worldYToLocalTopPct(id, gIy, byId)
    const aggOutRec: Record<string, number> = {}
    for (const [slot, ys] of a.aggOutY) {
      const y = median(ys)
      if (y !== undefined) aggOutRec[String(slot)] = worldYToLocalTopPct(id, y, byId)
    }
    if (Object.keys(aggOutRec).length) tops.aggOut = aggOutRec
    if (Object.keys(tops).length) anchorById.set(id, tops)
  }

  return nodes.map((n) => {
    if (!isLeafBoxNode(n)) return n
    const tops = anchorById.get(String(n.id))
    const prev =
      n.data && typeof n.data === 'object' ? { ...(n.data as Record<string, unknown>) } : {}
    if (tops && Object.keys(tops).length > 0) {
      prev.anchorTops = tops
    } else {
      delete prev.anchorTops
    }
    return { ...n, data: prev }
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
    if (isLeafBoxNode(n)) {
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

  const topLevel = out.filter((n) => !n.parentNode)
  /** Hidden nodes must not break singleton detection (e.g. stray invisible roots). */
  const topVisible = topLevel.filter((n) => !(n as { hidden?: boolean }).hidden)

  /**
   * Single top-level leaf (one `module` / `package` / `artefact` with no parent): stretch it to
   * the diagram viewport so it matches a full-canvas project card. Used by the simplified Scala
   * package view (one outermost package only) and keeps parity with how users expect one box to
   * read at a glance.
   */
  const singletonRootLeaf = topVisible.length === 1 && isLeafBoxNode(topVisible[0]!) ? topVisible[0]! : null
  if (singletonRootLeaf) {
    const innerW = Math.max(64, viewport.width - 2 * MARGIN_X)
    const innerH = Math.max(80, viewport.height - 2 * MARGIN_Y)
    const idx = out.findIndex((n) => n.id === singletonRootLeaf.id)
    if (idx !== -1) {
      const prevStyle = out[idx].style && typeof out[idx].style === 'object' ? { ...out[idx].style } : {}
      out[idx] = {
        ...out[idx],
        position: { x: MARGIN_X, y: MARGIN_Y },
        width: innerW,
        height: innerH,
        style: {
          ...prevStyle,
          width: `${innerW}px`,
          height: `${innerH}px`,
        },
      }
    }
    return out
  }

  /**
   * Outermost package container always claims the full canvas.
   *
   * When the diagram has a single top-level `group` node (e.g. the root package
   * `com.example.animalsfruit` in the package view), the user's mental model is that this
   * IS the viewport — clicking a nested package should let it fill the screen, and there's
   * no useful information conveyed by drawing whitespace around the outer container. So we
   * pin the singleton root group to the viewport bounds and re-run the depth layout for
   * its subtree into those bounds. This also gives `applyLayerDrill` a consistent ceiling:
   * `verticalBandForLayerDrill` reads the parent's `style.height`, which is now guaranteed
   * to be the diagram height, so a drilled child group fills the canvas vertically.
   *
   * Top-level leaf modules (sbt project view) and multi-root layouts are unaffected.
   */
  const singletonRootGroup = topVisible.length === 1 && topVisible[0]?.type === 'group' ? topVisible[0]! : null
  if (singletonRootGroup) {
    const innerW = Math.max(GROUP_MIN_W, viewport.width - 2 * MARGIN_X)
    const innerH = Math.max(GROUP_MIN_H, viewport.height - 2 * MARGIN_Y)
    singletonRootGroup.position = { x: MARGIN_X, y: MARGIN_Y }
    return relayoutSubtreeIntoBounds(
      singletonRootGroup.id,
      out,
      edges,
      { width: innerW, height: innerH },
    )
  }

  return out
}

function isPackageScopeGroupNode(out: readonly any[], groupId: string): boolean {
  const n = out.find((x) => x.id === groupId)
  const d = n?.data as Record<string, unknown> | undefined
  return d?.packageScope === true
}

function readNodePixelDim(styleVal: unknown, numVal: unknown, fallback: number): number {
  if (typeof numVal === 'number' && Number.isFinite(numVal) && numVal > 0) return numVal
  if (typeof styleVal === 'number' && Number.isFinite(styleVal) && styleVal > 0) return styleVal
  if (typeof styleVal === 'string') {
    const n = parseFloat(styleVal)
    if (Number.isFinite(n) && n > 0) return n
  }
  return fallback
}

/**
 * Scala outer package group (`data.packageScope`): after depth layout, the group is pinned to
 * the full viewport but column math can leave the child bounding box small — scale + translate
 * direct children so they **fill** the inner frame (same intent as a PackageBox body filling the
 * outer card).
 */
function stretchPackageScopeGroupChildrenToFillBounds(
  rootGroupId: string,
  out: any[],
  bounds: ViewportSize,
): void {
  const gidx = out.findIndex((n) => n.id === rootGroupId)
  if (gidx === -1) return
  const group = out[gidx] as { data?: Record<string, unknown> }
  if (group.data?.packageScope !== true) return

  const children = out.filter(
    (n) => String(n.parentNode) === rootGroupId && !(n as { hidden?: boolean }).hidden,
  )
  if (!children.length) return

  const geo = regionStackMetrics(bounds.height, rootGroupId)
  const innerLeft = INNER_PAD_X
  const innerTop = geo.stackTop
  /** Symmetric with left inset — avoid `GROUP_WRAP` slack on right/bottom for this outer card. */
  const innerW = Math.max(120, bounds.width - 2 * INNER_PAD_X)
  const innerH = Math.max(80, bounds.height - innerTop - INNER_PAD_Y)

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const c of children) {
    const n = out.find((x) => x.id === c.id) as any
    if (!n) continue
    const w = readNodePixelDim(n.style?.width, n.width, MODULE_W)
    const h = readNodePixelDim(n.style?.height, n.height, MODULE_H)
    minX = Math.min(minX, n.position.x)
    minY = Math.min(minY, n.position.y)
    maxX = Math.max(maxX, n.position.x + w)
    maxY = Math.max(maxY, n.position.y + h)
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return

  const bw = maxX - minX
  const bh = maxY - minY
  const sx = innerW / bw
  const sy = innerH / bh

  for (const c of children) {
    const idx = out.findIndex((x) => x.id === c.id)
    if (idx === -1) continue
    const n = out[idx] as any
    const w = readNodePixelDim(n.style?.width, n.width, MODULE_W)
    const h = readNodePixelDim(n.style?.height, n.height, MODULE_H)
    const nx = Math.round(innerLeft + (n.position.x - minX) * sx)
    const ny = Math.round(innerTop + (n.position.y - minY) * sy)
    const nw = Math.max(120, Math.round(w * sx))
    const nh = Math.max(72, Math.round(h * sy))
    const prevStyle = n.style && typeof n.style === 'object' ? { ...n.style } : {}
    out[idx] = {
      ...n,
      position: { x: nx, y: ny },
      width: nw,
      height: nh,
      style: {
        ...prevStyle,
        width: `${nw}px`,
        height: `${nh}px`,
      },
    }
  }
}

/**
 * Re-runs the depth layout for the subtree rooted at `rootGroupId` into the explicit
 * `bounds` viewport. Used by layer-drill when a group is the drill focus: after the drill
 * stretches the group to (approximately) the full diagram height, its children must be
 * re-laid-out inside the new bounds so the artefacts grow with the container instead of
 * sitting in the upper-left corner of an empty box.
 *
 * Only nodes whose parent chain leads back to `rootGroupId` (or `rootGroupId` itself) are
 * touched — the drill geometry for the root group's siblings stays put. After the inner
 * layout has finished, the root group's `style.{width,height}` is forcibly restored to
 * `bounds.{width,height}` so the auto-grow inside `layoutOneParent` (which sizes the parent
 * to its children's bounding box) doesn't shrink the focus column back.
 */
export function relayoutSubtreeIntoBounds(
  rootGroupId: string,
  nodes: readonly any[],
  edges: readonly { source: string; target: string; label?: unknown }[],
  bounds: ViewportSize,
): any[] {
  const out = nodes.map((n) => ({
    ...n,
    position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
    style: n.style ? { ...n.style } : undefined,
  }))
  const byId = new Map(out.map((n) => [n.id, n]))

  const inSubtree = new Set<string>([rootGroupId])
  let changed = true
  while (changed) {
    changed = false
    for (const n of out) {
      const pid = n.parentNode != null && n.parentNode !== '' ? String(n.parentNode) : undefined
      if (pid && inSubtree.has(pid) && !inSubtree.has(n.id)) {
        inSubtree.add(n.id)
        changed = true
      }
    }
  }

  const innerParentIds = [...new Set(
    out
      .filter((n) => n.parentNode && inSubtree.has(String(n.parentNode)) && String(n.parentNode) !== rootGroupId)
      .map((n) => String(n.parentNode)),
  )]
  innerParentIds.sort((a, b) => nestDepth(b, byId) - nestDepth(a, byId))

  for (const pid of innerParentIds) {
    const vp = estimateInnerViewport(pid, out, edges)
    layoutOneParent(pid, out, edges, vp)
  }

  layoutOneParent(rootGroupId, out, edges, bounds)

  stretchPackageScopeGroupChildrenToFillBounds(rootGroupId, out, bounds)

  const ridx = out.findIndex((n) => n.id === rootGroupId)
  if (ridx !== -1) {
    const prevStyle =
      out[ridx].style && typeof out[ridx].style === 'object' ? { ...out[ridx].style } : {}
    out[ridx] = {
      ...out[ridx],
      width: bounds.width,
      height: bounds.height,
      style: {
        ...prevStyle,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
      },
    }
  }

  return out
}
