<script setup lang="ts">
/**
 * Focus vs pin orchestration for project boxes (see `src/diagram/model/types.ts`: DiagramContainer,
 * DiagramLayerModel, ProjectBoxModel). Geometry still lives on Vue Flow nodes.
 */
import { useVueFlow, type GraphEdge, type GraphNode, type Styles } from '@vue-flow/core'
import { inject, nextTick, onMounted, onUnmounted, ref } from 'vue'
import {
  computeLayerDrillColumnLayout,
  dependencyDepthsInRegion,
  focusedModuleWidthForDrill,
  relayoutSubtreeIntoBounds,
  verticalBandForLayerDrill,
} from '../graph/layoutDependencyLayers'
import {
  attachLayerFlipInvert,
  moduleLayoutRect,
  playLayerFlip,
  stripLayerFlipsFromNodes,
  type LayerFlipRect,
} from '../graph/layerDrillFlip'
import { isLayerDrillBoxNode, isLeafBoxNode } from '../graph/nodeKinds'
import { edgeContributesToClasspathDepth, isAggregateEdge } from '../graph/relationKinds'

const {
  getNodes,
  setNodes,
  getEdges,
  setEdges,
  fitView,
  onNodeClick,
  onNodeDoubleClick,
  onPaneClick,
  updateNodeInternals,
} = useVueFlow()

const graphFocusUi = inject<{ containerFocusId: string | null } | undefined>('tritonGraphFocusUi', undefined)
const afterLayerDrillOut = inject<(() => void | Promise<void>) | undefined>('tritonAfterLayerDrillOut', undefined)

/** Container (group) zoom drill */
const focusedId = ref<string | null>(null)
let clickTimer: ReturnType<typeof setTimeout> | null = null

/** Module layer drill: one depth column focus */
const layerDrillId = ref<string | null>(null)
type LayerSnap = {
  nodes: Record<
    string,
    {
      position: { x: number; y: number }
      width?: number
      height?: number
      hidden: boolean
      style?: Styles
      class?: string
      data?: Record<string, unknown>
    }
  >
  edges: Record<
    string,
    {
      hidden: boolean
      style?: Styles
      class?: string
    }
  >
}
const layerSnapshot = ref<LayerSnap | null>(null)

/**
 * When layer drill starts while zoomed into a container, drill-out refits that subgraph
 * instead of jumping to full overview (see applyLayerDrill / fitCameraAfterLayerDrillClear).
 */
const layerDrillReturnFocusId = ref<string | null>(null)

/** Camera + node chrome animation length (matches CSS on nodes) */
const FIT_DURATION_MS = 480

const FLIP_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)'
const FLIP_FLOW_CLASS = 'tg-layer-flip-animate'

/** Hide non-aggregate depth edges while module FLIP runs; aggregate-style relations stay visible. */
function isDependencyEdge(e: GraphEdge): boolean {
  return edgeContributesToClasspathDepth(e) && !isAggregateEdge(e)
}

/** Hide classpath-style depth edges while module FLIP runs; aggregate edges stay visible. */
function withDependencyEdgesHiddenDuringFlip(es: GraphEdge[]): GraphEdge[] {
  return es.map((e) => ({
    ...e,
    hidden: !!(e as { hidden?: boolean }).hidden || isDependencyEdge(e),
  }))
}

/**
 * Vue Flow often keeps stale edge geometry after `hidden` toggles + node FLIP.
 * Drop dependency edges for one frame, then restore plain copies and refresh handle bounds.
 */
async function remountDependencyEdgesAfterFlip(finalEdges: GraphEdge[]): Promise<void> {
  const plain = finalEdges.map((e) => ({ ...e })) as GraphEdge[]
  const dep = plain.filter((e) => isDependencyEdge(e))
  const keep = plain.filter((e) => !isDependencyEdge(e))

  if (!dep.length) {
    setEdges(plain)
    await nextTick()
    await doubleRaf()
    updateNodeInternals()
    return
  }

  if (!keep.length) {
    setEdges(plain)
    await nextTick()
    await doubleRaf()
    updateNodeInternals()
    return
  }

  setEdges(keep)
  await nextTick()
  await doubleRaf()
  updateNodeInternals()
  await nextTick()
  setEdges(plain)
  await nextTick()
  await doubleRaf()
  updateNodeInternals()
}

function flowRootEl(): HTMLElement | null {
  return document.querySelector('.flow') as HTMLElement | null
}

async function doubleRaf(): Promise<void> {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )
}

/** Let Vue Flow measure restored node sizes before fitView (drill-out / overview). */
async function waitForGraphLayout(): Promise<void> {
  await nextTick()
  await doubleRaf()
}

async function fitOverviewCamera(): Promise<void> {
  await waitForGraphLayout()
  await fitView({ padding: 0.05, duration: FIT_DURATION_MS, maxZoom: 1.8, minZoom: 0.05 })
}

/** After layer drill clears: return to prior container zoom if any, else full overview. */
async function fitCameraAfterLayerDrillClear(): Promise<void> {
  const returnTo = layerDrillReturnFocusId.value
  layerDrillReturnFocusId.value = null
  await waitForGraphLayout()
  if (returnTo && getNodes.value.some((n) => n.id === returnTo)) {
    applyDimming(returnTo)
    await nextTick()
    const ids = [...brightIdsFor(returnTo)]
    await fitView({
      nodes: ids,
      padding: 0.05,
      duration: FIT_DURATION_MS,
      maxZoom: 2.4,
      minZoom: 0.05,
    })
    return
  }
  await fitView({ padding: 0.05, duration: FIT_DURATION_MS, maxZoom: 1.8, minZoom: 0.05 })
}

function readFlowViewport(): { width: number; height: number } {
  const el = document.querySelector('.flow-wrap')
  const r = el?.getBoundingClientRect()
  return {
    width: Math.max(480, r?.width ?? 960),
    height: Math.max(420, r?.height ?? 720),
  }
}

/**
 * Pre-drill layout rects of every box (leaf or group) that participates in the drilled
 * region's depth column layout, excluding the same-depth peers that the drill is about to hide.
 * Used as the FLIP "first" geometry so groups animate from their old bounds to their new ones,
 * not just leaf project boxes.
 */
function collectVisibleModuleRectsBeforeDrill(
  preNodes: GraphNode[],
  regionParent: string | undefined,
  hiddenSiblingIds: Set<string>,
): Map<string, LayerFlipRect> {
  const map = new Map<string, LayerFlipRect>()
  for (const n of preNodes) {
    if (!isLayerDrillBoxNode(n)) continue
    const nParent = n.parentNode ? String(n.parentNode) : undefined
    const sameRegion =
      (regionParent === undefined && nParent === undefined) ||
      (regionParent !== undefined && nParent === regionParent)
    if (!sameRegion || hiddenSiblingIds.has(n.id)) continue
    map.set(n.id, moduleLayoutRect(n))
  }
  return map
}

/**
 * Top + height spanning all drill-participating boxes in this region (flow coordinates). Includes
 * groups so that drilling a single package container in a layer with no leaf siblings still maps
 * to the layer's full vertical band.
 */
function diagramModuleVerticalSpan(
  modNodes: GraphNode[],
  regionParent: string | undefined,
): { top: number; height: number } {
  let top = Infinity
  let bot = -Infinity
  for (const n of modNodes) {
    if (!isLayerDrillBoxNode(n)) continue
    const nParent = n.parentNode ? String(n.parentNode) : undefined
    const same =
      (regionParent === undefined && nParent === undefined) ||
      (regionParent !== undefined && nParent === regionParent)
    if (!same) continue
    const h = typeof n.height === 'number' ? n.height : 72
    top = Math.min(top, n.position.y)
    bot = Math.max(bot, n.position.y + h)
  }
  if (!Number.isFinite(top) || !Number.isFinite(bot)) {
    return { top: 0, height: 400 }
  }
  return { top, height: Math.max(44, bot - top) }
}

function mergeNodeClass(existing: string | undefined, add: string): string | undefined {
  const parts = new Set(String(existing ?? '').split(/\s+/).filter(Boolean))
  parts.add(add)
  const s = [...parts].join(' ')
  return s || undefined
}

function descendantIds(parentId: string): string[] {
  const nodes = getNodes.value
  const out: string[] = [parentId]
  let frontier: string[] = [parentId]
  while (frontier.length) {
    const next: string[] = []
    for (const id of frontier) {
      for (const n of nodes) {
        if (String(n.parentNode) === id) {
          out.push(n.id)
          next.push(n.id)
        }
      }
    }
    frontier = next
  }
  return out
}

function ancestorIds(childId: string): string[] {
  const nodes = getNodes.value
  const out: string[] = []
  let cur = nodes.find((n) => n.id === childId)
  while (cur?.parentNode) {
    const pid = String(cur.parentNode)
    out.push(pid)
    cur = nodes.find((n) => n.id === pid)
  }
  return out
}

function brightIdsFor(focusId: string | null): Set<string> {
  const all = getNodes.value.map((n) => n.id)
  if (!focusId) return new Set(all)
  const s = new Set(descendantIds(focusId))
  for (const a of ancestorIds(focusId)) {
    s.add(a)
  }
  return s
}

function pinnedModuleIdSet(): Set<string> {
  const s = new Set<string>()
  for (const n of getNodes.value) {
    if (!isLeafBoxNode(n)) continue
    const d = n.data && typeof n.data === 'object' ? (n.data as Record<string, unknown>) : null
    if (d?.pinned === true) s.add(n.id)
  }
  return s
}

/** Preserve stroke-emphasis class from {@link GraphWorkspace.syncEdgeVisualState} while toggling dimming. */
function mergeEdgeDimClass(existing: string | undefined, dimmed: boolean): string | undefined {
  const parts = new Set(String(existing ?? '').split(/\s+/).filter(Boolean))
  parts.delete('tg-dimmed')
  if (dimmed) parts.add('tg-dimmed')
  const out = [...parts].join(' ')
  return out || undefined
}

function applyDimming(focusId: string | null) {
  focusedId.value = focusId
  if (graphFocusUi) {
    graphFocusUi.containerFocusId = focusId
  }
  const bright = brightIdsFor(focusId)
  for (const id of pinnedModuleIdSet()) {
    bright.add(id)
  }
  setNodes(
    getNodes.value.map((n) => ({
      ...n,
      class: bright.has(n.id) ? undefined : 'tg-dimmed',
    })),
  )
  setEdges(
    getEdges.value.map((e) => {
      const lit = bright.has(e.source) && bright.has(e.target)
      const base = (typeof e.style === 'object' && e.style) || {}
      return {
        ...e,
        class: mergeEdgeDimClass(e.class as string | undefined, !lit),
        style: { ...base, opacity: lit ? 1 : 0.32 },
      }
    }),
  )
}

function captureLayerSnapshot() {
  layerSnapshot.value = {
    nodes: Object.fromEntries(
      getNodes.value.map((n) => [
        n.id,
        {
          position: { ...n.position },
          width: typeof n.width === 'number' ? n.width : undefined,
          height: typeof n.height === 'number' ? n.height : undefined,
          hidden: !!(n as { hidden?: boolean }).hidden,
          style: n.style && typeof n.style === 'object' ? { ...(n.style as Styles) } : undefined,
          class: n.class as string | undefined,
          data:
            n.data && typeof n.data === 'object' ? { ...(n.data as Record<string, unknown>) } : undefined,
        },
      ]),
    ),
    edges: Object.fromEntries(
      getEdges.value.map((e) => [
        e.id,
        {
          hidden: !!(e as { hidden?: boolean }).hidden,
          style: e.style && typeof e.style === 'object' ? { ...(e.style as Styles) } : undefined,
          class: e.class as string | undefined,
        },
      ]),
    ),
  }
}

/**
 * Layer snapshot is taken when drill *starts*; user may pin / recolor after that.
 * Restore geometry from the snap but keep these fields from the live node.
 */
const DATA_KEYS_PERSISTED_ACROSS_LAYER_SNAPSHOT: (keyof Record<string, unknown>)[] = ['pinned', 'boxColor']

function mergeDataForLayerRestore(
  snapData: Record<string, unknown> | undefined,
  current: unknown,
): Record<string, unknown> | undefined {
  const out =
    snapData && typeof snapData === 'object' ? { ...(snapData as Record<string, unknown>) } : {}
  const cur = current && typeof current === 'object' ? (current as Record<string, unknown>) : {}
  for (const k of DATA_KEYS_PERSISTED_ACROSS_LAYER_SNAPSHOT) {
    if (k in cur) out[k] = cur[k]
  }
  return Object.keys(out).length ? out : undefined
}

function buildRestoredNodesFromSnapshot(snap: LayerSnap): GraphNode[] {
  return getNodes.value.map((n) => {
    const s = snap.nodes[n.id]
    if (!s) return { ...n, hidden: false } as GraphNode
    return {
      ...n,
      position: { ...s.position },
      width: s.width,
      height: s.height,
      hidden: s.hidden,
      style: s.style ? { ...s.style } : undefined,
      class: s.class,
      data: mergeDataForLayerRestore(
        s.data as Record<string, unknown> | undefined,
        n.data,
      ) as GraphNode['data'],
    } as GraphNode
  })
}

function buildRestoredEdgesFromSnapshot(snap: LayerSnap): GraphEdge[] {
  return getEdges.value.map((e) => {
    const s = snap.edges[e.id]
    if (!s) return { ...e, hidden: false } as GraphEdge
    return {
      ...e,
      hidden: s.hidden,
      style: s.style ? { ...s.style } : undefined,
      class: s.class,
    } as GraphEdge
  })
}

function clearLayerDrill() {
  const snap = layerSnapshot.value
  if (!snap) {
    layerDrillId.value = null
    return
  }
  setNodes(buildRestoredNodesFromSnapshot(snap))
  setEdges(buildRestoredEdgesFromSnapshot(snap))
  layerSnapshot.value = null
  layerDrillId.value = null
}

/** FLIP drill-out / Esc: smooth return to snapshot layout. */
async function clearLayerDrillWithFlip(): Promise<void> {
  const snap = layerSnapshot.value
  if (!snap) {
    layerDrillId.value = null
    return
  }
  const firstById = new Map<string, LayerFlipRect>()
  for (const n of getNodes.value) {
    if (!isLayerDrillBoxNode(n)) continue
    if (n.hidden) continue
    firstById.set(n.id, moduleLayoutRect(n))
  }
  const restoredNodes = buildRestoredNodesFromSnapshot(snap)
  const restoredEdges = buildRestoredEdgesFromSnapshot(snap)
  layerSnapshot.value = null
  layerDrillId.value = null

  setEdges(withDependencyEdgesHiddenDuringFlip(getEdges.value))
  await nextTick()
  await doubleRaf()

  const flowEl = flowRootEl()
  flowEl?.classList.add(FLIP_FLOW_CLASS)
  setNodes(attachLayerFlipInvert(restoredNodes, firstById, 'none'))
  setEdges(withDependencyEdgesHiddenDuringFlip(restoredEdges))
  await nextTick()
  await doubleRaf()
  setNodes(playLayerFlip(getNodes.value, FIT_DURATION_MS, FLIP_EASING))
  await new Promise<void>((r) => setTimeout(r, FIT_DURATION_MS))
  setNodes(stripLayerFlipsFromNodes(getNodes.value))
  await remountDependencyEdgesAfterFlip(restoredEdges)
  flowEl?.classList.remove(FLIP_FLOW_CLASS)
  await afterLayerDrillOut?.()
}

function isModulePinnedIn(nodes: GraphNode[], id: string): boolean {
  const n = nodes.find((x) => x.id === id)
  const d = n?.data && typeof n.data === 'object' ? (n.data as Record<string, unknown>) : null
  return d?.pinned === true
}

/**
 * Region-participant input shape for the drill column layout. A "participant" is any node
 * directly under the region parent — leaf boxes (modules / packages / artefacts) AND group
 * containers — so that, for example, three sibling package groups can each claim a column
 * within their parent diagram and one of them can be drilled into without losing animation.
 */
function collectRegionParticipants(
  nodes: readonly GraphNode[],
  regionParent: string | undefined,
  depths: Map<string, number>,
): { id: string; depth: number; position: { x: number; y: number }; width: number; height: number; style?: unknown }[] {
  return nodes
    .filter((n) => {
      const nParent = n.parentNode ? String(n.parentNode) : undefined
      const sr =
        (regionParent === undefined && nParent === undefined) ||
        (regionParent !== undefined && nParent === regionParent)
      return sr && isLayerDrillBoxNode(n)
    })
    .map((n) => ({
      id: n.id,
      depth: depths.get(n.id) ?? 0,
      position: { ...n.position },
      width: typeof n.width === 'number' ? n.width : 200,
      height: typeof n.height === 'number' ? n.height : 72,
      style: n.style,
    }))
}

async function applyLayerDrill(moduleId: string) {
  let nodes = getNodes.value
  let edges = getEdges.value
  let target = nodes.find((n) => n.id === moduleId)
  if (!target || !isLayerDrillBoxNode(target)) return

  if (layerDrillId.value && layerDrillId.value !== moduleId) {
    clearLayerDrill()
    nodes = getNodes.value
    edges = getEdges.value
    target = nodes.find((n) => n.id === moduleId)
    if (!target || !isLayerDrillBoxNode(target)) return
  }
  if (layerDrillId.value === moduleId) {
    await clearLayerDrillWithFlip()
    await fitCameraAfterLayerDrillClear()
    return
  }

  if (!layerDrillId.value && focusedId.value) {
    layerDrillReturnFocusId.value = focusedId.value
  }

  if (focusedId.value) {
    applyDimming(null)
  }

  captureLayerSnapshot()
  layerDrillId.value = moduleId

  const targetIsGroup = target.type === 'group'
  const targetIsArtefact = target.type === 'artefact'
  const regionParent = target.parentNode ? String(target.parentNode) : undefined
  const depths = dependencyDepthsInRegion(nodes, edges, regionParent)

  const maxD = depths.size ? Math.max(0, ...depths.values()) : 0
  const numCols = maxD + 1
  const vp = readFlowViewport()
  /**
   * Group focus claims the full band of its parent (which, for the outermost package, is the
   * diagram viewport — the layout pins the singleton root group to the canvas).
   *
   * Scala **artefact** focus uses the same vertical band: same-depth artefact peers are hidden,
   * dependency columns stay visible in other layers, and the focused box should grow tall + wide
   * for text-heavy detail (like a drilled package / project), not stay clipped to the pre-stack Y span.
   *
   * Other leaves (sbt `module`, `package`) keep `diagramModuleVerticalSpan` so pinned-row drills
   * do not stretch every sibling to the full parent height.
   */
  let diagramTop: number
  let diagramH: number
  if (targetIsGroup) {
    const band = verticalBandForLayerDrill(nodes, regionParent, vp.height)
    diagramTop = band.padTop
    diagramH = band.usable
  } else if (targetIsArtefact) {
    const band = verticalBandForLayerDrill(nodes, regionParent, vp.height)
    diagramTop = band.padTop
    diagramH = band.usable
  } else {
    ;({ top: diagramTop, height: diagramH } = diagramModuleVerticalSpan(nodes, regionParent))
  }
  const baseW = typeof target.width === 'number' ? target.width : 200
  const focusW = focusedModuleWidthForDrill(vp, numCols, baseW, regionParent, nodes)

  const regionParticipants = collectRegionParticipants(nodes, regionParent, depths)

  const fd = depths.get(moduleId) ?? 0
  /** Pin semantics only apply to leaf modules today; groups are never pinned. */
  const depthsWithPinned = new Set<number>()
  for (const m of regionParticipants) {
    if (isModulePinnedIn(nodes, m.id)) depthsWithPinned.add(m.depth)
  }

  const hiddenSiblingIds = new Set<string>()
  for (const m of regionParticipants) {
    if (m.id === moduleId) continue
    if (m.depth === fd && !isModulePinnedIn(nodes, m.id)) {
      hiddenSiblingIds.add(m.id)
    }
    if (depthsWithPinned.has(m.depth) && !isModulePinnedIn(nodes, m.id)) {
      hiddenSiblingIds.add(m.id)
    }
  }

  /**
   * Hiding a group also hides every node nested inside it; otherwise the descendants would
   * remain rendered in flow space and overlap the focused box.
   */
  if (targetIsGroup || regionParticipants.some((m) => hiddenSiblingIds.has(m.id))) {
    const expand = new Set(hiddenSiblingIds)
    for (const id of expand) {
      for (const desc of descendantIds(id)) {
        if (desc !== id) hiddenSiblingIds.add(desc)
      }
    }
  }

  const wideAtFocusDepthIds = new Set(
    regionParticipants.filter((m) => m.depth === fd && isModulePinnedIn(nodes, m.id)).map((m) => m.id),
  )

  /** Same-layer peers are hidden — omit them from width conservation so the focus column can grow. */
  const layoutParticipants = regionParticipants.filter((m) => !hiddenSiblingIds.has(m.id))

  const geoMap = computeLayerDrillColumnLayout({
    regionModules: layoutParticipants,
    focusId: moduleId,
    focusWidth: focusW,
    siblingWidthScale: 0.42,
    wideAtFocusDepthIds,
  })

  let nextNodes = nodes.map((n) => {
    const nParent = n.parentNode ? String(n.parentNode) : undefined
    const sameRegion =
      (regionParent === undefined && nParent === undefined) ||
      (regionParent !== undefined && nParent === regionParent)

    /** Hidden via a hidden ancestor (group sibling subtree). */
    if (hiddenSiblingIds.has(n.id)) {
      const prevData =
        n.data && typeof n.data === 'object' ? { ...(n.data as Record<string, unknown>) } : {}
      delete prevData.layerDrillFocus
      return {
        ...n,
        hidden: true,
        class: undefined,
        data: prevData,
      } as GraphNode
    }

    if (!sameRegion || !isLayerDrillBoxNode(n)) {
      return { ...n, hidden: false } as GraphNode
    }

    const geo = geoMap.get(n.id)
    if (!geo) {
      return { ...n, hidden: false } as GraphNode
    }

    const prevData =
      n.data && typeof n.data === 'object' ? { ...(n.data as Record<string, unknown>) } : {}
    if (n.id === moduleId) {
      prevData.layerDrillFocus = true
      /** Match the diagram's vertical extent (all participants in this region) so the focus claims the layer's full height. */
      const h = diagramH
      const prevStyle = geo.style && typeof geo.style === 'object' ? { ...(geo.style as Styles) } : {}
      return {
        ...n,
        hidden: false,
        position: { x: geo.position.x, y: diagramTop },
        width: geo.width,
        height: h,
        class: mergeNodeClass(n.class as string | undefined, 'tg-layer-focus'),
        data: prevData,
        style: {
          ...prevStyle,
          width: `${geo.width}px`,
          height: `${h}px`,
        } as Styles,
      } as GraphNode
    }

    /** Pinned modules in other layers stay full diagram height alongside the current drill focus. */
    if (isModulePinnedIn(nodes, n.id)) {
      delete prevData.layerDrillFocus
      const prevStyle = geo.style && typeof geo.style === 'object' ? { ...(geo.style as Styles) } : {}
      return {
        ...n,
        hidden: false,
        position: { x: geo.position.x, y: diagramTop },
        width: geo.width,
        height: diagramH,
        class: mergeNodeClass(n.class as string | undefined, 'tg-layer-focus'),
        data: prevData,
        style: {
          ...prevStyle,
          width: `${geo.width}px`,
          height: `${diagramH}px`,
        } as Styles,
      } as GraphNode
    }

    delete prevData.layerDrillFocus

    return {
      ...n,
      hidden: false,
      position: geo.position,
      width: geo.width,
      height: geo.height,
      class: n.class as string | undefined,
      data: prevData,
      style: geo.style as Styles,
    } as GraphNode
  }) as GraphNode[]

  /**
   * Group target: re-run depth layout for the focused container's subtree so its children
   * (Scala artefacts in the package case) stretch to fill the new bounds. Restricted to the
   * subtree so the drill geometry computed for the region peers stays intact.
   */
  if (targetIsGroup) {
    nextNodes = relayoutSubtreeIntoBounds(
      moduleId,
      nextNodes,
      edges,
      { width: focusW, height: diagramH },
    ) as GraphNode[]
  }

  const firstRects = collectVisibleModuleRectsBeforeDrill(nodes, regionParent, hiddenSiblingIds)
  const finalEdgesForDrill = getEdges.value.map((e) => ({
    ...e,
    hidden: hiddenSiblingIds.has(e.source) || hiddenSiblingIds.has(e.target),
  })) as GraphEdge[]

  setEdges(withDependencyEdgesHiddenDuringFlip(getEdges.value))
  await nextTick()
  await doubleRaf()

  const flowEl = flowRootEl()
  flowEl?.classList.add(FLIP_FLOW_CLASS)
  setNodes(attachLayerFlipInvert(nextNodes, firstRects, 'none'))
  setEdges(withDependencyEdgesHiddenDuringFlip(finalEdgesForDrill))
  await nextTick()
  await doubleRaf()
  setNodes(playLayerFlip(getNodes.value, FIT_DURATION_MS, FLIP_EASING))
  await new Promise<void>((r) => setTimeout(r, FIT_DURATION_MS))
  setNodes(stripLayerFlipsFromNodes(getNodes.value))
  await remountDependencyEdgesAfterFlip(finalEdgesForDrill)
  flowEl?.classList.remove(FLIP_FLOW_CLASS)
}

async function zoomIntoContainer(id: string) {
  applyDimming(id)
  const ids = [...brightIdsFor(id)]
  await nextTick()
  await fitView({
    nodes: ids,
    padding: 0.05,
    duration: FIT_DURATION_MS,
    maxZoom: 2.4,
    minZoom: 0.05,
  })
}

async function showFullGraph() {
  if (layerDrillId.value) {
    layerDrillReturnFocusId.value = null
    await clearLayerDrillWithFlip()
  }
  applyDimming(null)
  await fitOverviewCamera()
}

function containerHasChildren(nodeId: string): boolean {
  return getNodes.value.some((n) => String(n.parentNode) === nodeId)
}

const MODULE_CLICK_DELAY_MS = 280

/**
 * Click semantics share the same "scale this box to its layer" intent across leaf project
 * boxes and group package containers. Both go through `applyLayerDrill`: clicking a box
 * grows it to fill its column / layer (with FLIP animation), clicking the same box again
 * — or the parent group frame — drills back out. Clicking on the empty pane returns to the
 * overview. The fallback `zoomIntoContainer` is only for groups that aren't part of a
 * depth-layered region (e.g. legacy ilograph documents without dependency edges).
 */
onNodeClick(({ node }) => {
  if (clickTimer) {
    clearTimeout(clickTimer)
    clickTimer = null
  }

  if (isLeafBoxNode(node)) {
    if (layerDrillId.value === node.id) {
      void applyLayerDrill(node.id)
      return
    }
    if (layerDrillId.value && layerDrillId.value !== node.id) {
      void applyLayerDrill(node.id)
      return
    }
    clickTimer = setTimeout(() => {
      clickTimer = null
      void applyLayerDrill(node.id)
    }, MODULE_CLICK_DELAY_MS)
    return
  }

  /** Click the parent group frame (drill-out): exit current focus. */
  if (node.type === 'group' && layerDrillId.value && containerHasChildren(node.id)) {
    const drilled = getNodes.value.find((n) => n.id === layerDrillId.value)
    const parentId = drilled?.parentNode != null ? String(drilled.parentNode) : undefined
    if (parentId === node.id) {
      void applyLayerDrill(layerDrillId.value)
      return
    }
  }

  if (!containerHasChildren(node.id)) return

  /**
   * Group containers go through the same drill machinery as leaf boxes: the focus group is
   * stretched to fill its layer band, sibling groups in the same region are hidden, and the
   * focused group's interior is re-laid-out into the new bounds. This keeps PackageBox
   * scaling identical to ProjectBox scaling.
   */
  if (node.type === 'group') {
    clickTimer = setTimeout(() => {
      clickTimer = null
      void applyLayerDrill(node.id)
    }, MODULE_CLICK_DELAY_MS)
    return
  }

  clickTimer = setTimeout(() => {
    clickTimer = null
    void zoomIntoContainer(node.id)
  }, 320)
})

onNodeDoubleClick(() => {
  if (clickTimer) {
    clearTimeout(clickTimer)
    clickTimer = null
  }
})

onPaneClick(() => {
  if (clickTimer) {
    clearTimeout(clickTimer)
    clickTimer = null
  }
  void showFullGraph()
})

function onKeydown(ev: KeyboardEvent) {
  if (ev.key === 'Escape') {
    ev.preventDefault()
    if (clickTimer) {
      clearTimeout(clickTimer)
      clickTimer = null
    }
    void showFullGraph()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  if (clickTimer) clearTimeout(clickTimer)
})

function refreshDimming() {
  applyDimming(focusedId.value)
}

/**
 * Re-run the active layer drill against the current viewport.
 *
 * Layer-drill geometry (focused module width, sibling column scale, vertical band) is computed
 * once in {@link applyLayerDrill} from the viewport size at drill time. When the viewport
 * width changes later (e.g. the user toggles the YAML side panel via the Hide / Show button),
 * the previously computed widths are stale: the drilled module + its parent group can end up
 * far wider than the new viewport, with the camera unable to fit them. We restore the pre-drill
 * snapshot synchronously and then re-apply the drill so the new geometry uses the fresh
 * viewport. Returns `true` when a re-apply happened so the caller can skip the usual
 * post-relayout `fitView` (the drill animation handles the camera).
 */
async function reapplyLayerDrill(): Promise<boolean> {
  const id = layerDrillId.value
  if (!id) return false
  clearLayerDrill()
  await nextTick()
  await applyLayerDrill(id)
  return true
}

defineExpose({
  focusedId,
  layerDrillId,
  showFullGraph,
  zoomIntoContainer,
  clearLayerDrill,
  reapplyLayerDrill,
  refreshDimming,
})
</script>

<template>
  <span class="sr-only" aria-live="polite">
    {{
      layerDrillId
        ? `Layer focus ${layerDrillId}. Click again or Esc to reset.`
        : focusedId
          ? `Focused ${focusedId}. Press Escape for overview.`
          : 'Overview'
    }}
  </span>
</template>

<style scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
