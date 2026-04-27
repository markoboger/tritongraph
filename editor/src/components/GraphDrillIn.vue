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
  fullWidthFocusBoundsForLayerDrill,
  packageContentWeight,
  relationLaneGutters,
  relayoutSubtreeIntoBounds,
  verticalBandForLayerDrill,
} from '../graph/layoutDependencyLayers'
import { edgeContributesToClasspathDepth } from '../graph/relationKinds'
import {
  attachLayerFlipInvert,
  moduleLayoutRect,
  playLayerFlip,
  stripLayerFlipsFromNodes,
  type LayerFlipRect,
} from '../graph/layerDrillFlip'
import { isLayerDrillBoxNode, isLeafBoxNode } from '../graph/nodeKinds'

const {
  getNodes,
  setNodes,
  getEdges,
  setEdges,
  fitView,
  setViewport,
  onNodeClick,
  onNodeDoubleClick,
  onPaneClick,
  onMoveStart,
  onMoveEnd,
  updateNodeInternals,
} = useVueFlow()

const graphFocusUi = inject<{ containerFocusId: string | null } | undefined>('tritonGraphFocusUi', undefined)
const afterLayerDrillOut = inject<(() => void | Promise<void>) | undefined>('tritonAfterLayerDrillOut', undefined)
const shouldSuppressPaneClick =
  inject<(() => boolean) | undefined>('tritonShouldSuppressPaneClick', undefined)
const fitWorkspaceViewport = inject<
  | ((opts?: {
      duration?: number
    }) => Promise<void>)
  | undefined
>('tritonFitToViewport', undefined)

/** Container (group) zoom drill */
const focusedId = ref<string | null>(null)
let clickTimer: ReturnType<typeof setTimeout> | null = null
/** True from the moment a click-timer is set until it fires or is cancelled. Used by the parent
 * workspace to suppress viewport resets (e.g. resize-triggered relayout) that would race the
 * drill animation — without this guard the viewport snaps to {x:0,y:0} before applyLayerDrill. */
const layerDrillPending = ref(false)
let suppressPaneClickUntil = 0

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

/** Hide all relations while focus/camera animations run so stale geometry does not smear across the motion. */
function withAllEdgesHidden(es: GraphEdge[]): GraphEdge[] {
  return es.map((e) => ({
    ...e,
    hidden: true,
  }))
}

/**
 * Vue Flow often keeps stale edge geometry after animation + hidden toggles.
 * Drop all edges for one frame, then restore plain copies and refresh handle bounds.
 */
async function remountEdgesAfterAnimation(finalEdges: GraphEdge[]): Promise<void> {
  const plain = finalEdges.map((e) => ({ ...e })) as GraphEdge[]
  setEdges([])
  await nextTick()
  await doubleRaf()
  updateNodeInternals()
  await nextTick()
  setEdges(plain)
  await nextTick()
  await doubleRaf()
  updateNodeInternals()
}

async function waitForAnimationDuration(durationMs: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, durationMs))
}

function isFocusAnimatedElement(el: EventTarget | null): el is HTMLElement {
  return (
    el instanceof HTMLElement &&
    !!el.closest('.vue-flow__node, .flow-graph-node__flip-outer, .group-node__flip-outer')
  )
}

function isFocusAnimatedProperty(propertyName: string): boolean {
  return propertyName === 'transform' || propertyName === 'width' || propertyName === 'height'
}

async function waitForFocusAnimationEnd(durationMs: number): Promise<void> {
  const rootEl = flowRootEl()
  if (!rootEl) {
    await waitForAnimationDuration(durationMs + 80)
    return
  }
  const root = rootEl

  await new Promise<void>((resolve) => {
    let active = 0
    let finished = false
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null

    function clearTimers() {
      if (settleTimer) clearTimeout(settleTimer)
      if (fallbackTimer) clearTimeout(fallbackTimer)
      settleTimer = null
      fallbackTimer = null
    }

    function cleanup() {
      clearTimers()
      root.removeEventListener('transitionrun', onTransitionRun, true)
      root.removeEventListener('transitionstart', onTransitionRun, true)
      root.removeEventListener('transitionend', onTransitionDone, true)
      root.removeEventListener('transitioncancel', onTransitionDone, true)
    }

    function finish() {
      if (finished) return
      finished = true
      cleanup()
      resolve()
    }

    function scheduleSettle() {
      if (settleTimer) clearTimeout(settleTimer)
      settleTimer = setTimeout(() => {
        if (active <= 0) finish()
      }, 40)
    }

    function onTransitionRun(ev: Event) {
      const te = ev as TransitionEvent
      if (!isFocusAnimatedElement(te.target)) return
      if (!isFocusAnimatedProperty(te.propertyName)) return
      active += 1
      if (settleTimer) {
        clearTimeout(settleTimer)
        settleTimer = null
      }
    }

    function onTransitionDone(ev: Event) {
      const te = ev as TransitionEvent
      if (!isFocusAnimatedElement(te.target)) return
      if (!isFocusAnimatedProperty(te.propertyName)) return
      active = Math.max(0, active - 1)
      if (active === 0) scheduleSettle()
    }

    root.addEventListener('transitionrun', onTransitionRun, true)
    root.addEventListener('transitionstart', onTransitionRun, true)
    root.addEventListener('transitionend', onTransitionDone, true)
    root.addEventListener('transitioncancel', onTransitionDone, true)

    fallbackTimer = setTimeout(() => finish(), durationMs + 240)
    scheduleSettle()
  })
}

async function runWithEdgesHiddenDuringAnimation(
  finalEdges: GraphEdge[],
  durationMs: number,
  runAnimation: () => Promise<void>,
): Promise<void> {
  setEdges(withAllEdgesHidden(getEdges.value))
  await nextTick()
  await doubleRaf()
  await runAnimation()
  await waitForFocusAnimationEnd(durationMs)
  await remountEdgesAfterAnimation(finalEdges)
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
  const finalEdges = getEdges.value.map((e) => ({ ...e })) as GraphEdge[]
  await waitForGraphLayout()
  await runWithEdgesHiddenDuringAnimation(finalEdges, FIT_DURATION_MS, async () => {
    const topVisible = getNodes.value.filter((n) => !n.parentNode && !n.hidden)
    const singletonRootPackageScope =
      topVisible.length === 1 &&
      ((topVisible[0]?.type === 'group' &&
        ((topVisible[0]?.data as Record<string, unknown> | undefined)?.packageScope === true)) ||
        isLeafBoxNode(topVisible[0]!))
    if (singletonRootPackageScope) {
      await setViewport({ x: 0, y: 0, zoom: 1 }, { duration: FIT_DURATION_MS })
      return
    }
    if (fitWorkspaceViewport) {
      await fitWorkspaceViewport({ duration: FIT_DURATION_MS })
      return
    }
    await setViewport({ x: 0, y: 0, zoom: 1 }, { duration: FIT_DURATION_MS })
  })
}

/** After layer drill clears: return to prior container zoom if any, else full overview. */
async function fitCameraAfterLayerDrillClear(): Promise<void> {
  const returnTo = layerDrillReturnFocusId.value
  layerDrillReturnFocusId.value = null
  await waitForGraphLayout()
  if (returnTo && getNodes.value.some((n) => n.id === returnTo)) {
    applyDimming(returnTo)
    const finalEdges = getEdges.value.map((e) => ({ ...e })) as GraphEdge[]
    await runWithEdgesHiddenDuringAnimation(finalEdges, FIT_DURATION_MS, async () => {
      await nextTick()
      const ids = [...brightIdsFor(returnTo)]
      await fitView({
        nodes: ids,
        padding: 0.05,
        duration: FIT_DURATION_MS,
        maxZoom: 2.4,
        minZoom: 0.05,
      })
    })
    return
  }
  const finalEdges = getEdges.value.map((e) => ({ ...e })) as GraphEdge[]
  await runWithEdgesHiddenDuringAnimation(finalEdges, FIT_DURATION_MS, async () => {
    const topVisible = getNodes.value.filter((n) => !n.parentNode && !n.hidden)
    const singletonRootPackageScope =
      topVisible.length === 1 &&
      ((topVisible[0]?.type === 'group' &&
        ((topVisible[0]?.data as Record<string, unknown> | undefined)?.packageScope === true)) ||
        isLeafBoxNode(topVisible[0]!))
    if (singletonRootPackageScope) {
      await setViewport({ x: 0, y: 0, zoom: 1 }, { duration: FIT_DURATION_MS })
      return
    }
    if (fitWorkspaceViewport) {
      await fitWorkspaceViewport({ duration: FIT_DURATION_MS })
      return
    }
    await setViewport({ x: 0, y: 0, zoom: 1 }, { duration: FIT_DURATION_MS })
  })
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

function buildChildrenMap(nodes: { id: string; parentNode?: unknown }[]): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const n of nodes) {
    if (n.parentNode) {
      const pid = String(n.parentNode)
      let arr = m.get(pid)
      if (!arr) { arr = []; m.set(pid, arr) }
      arr.push(n.id)
    }
  }
  return m
}

function descendantIds(parentId: string, childrenMap?: Map<string, string[]>): string[] {
  const map = childrenMap ?? buildChildrenMap(getNodes.value)
  const out: string[] = [parentId]
  let frontier: string[] = [parentId]
  while (frontier.length) {
    const next: string[] = []
    for (const id of frontier) {
      const children = map.get(id)
      if (children) {
        for (const cid of children) { out.push(cid); next.push(cid) }
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
const DATA_KEYS_PERSISTED_ACROSS_LAYER_SNAPSHOT: (keyof Record<string, unknown>)[] = [
  'pinned',
  'boxColor',
  /**
   * Inner artefact pin / accent maps live on the parent flow node's `data`. The drill
   * machinery uses the pin map to decide whether to refuse a layer-drill switch
   * (see {@link isPinLockActive}), so it MUST survive snapshot/restore — otherwise the
   * pin would be silently wiped the moment the user drills out and back in.
   */
  'innerArtefactPinned',
  'innerArtefactColors',
  /** Inner artefact focus is also a user navigation choice; preserve it across restores. */
  'innerArtefactFocusId',
]

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

  const flowEl = flowRootEl()
  flowEl?.classList.add(FLIP_FLOW_CLASS)
  await runWithEdgesHiddenDuringAnimation(restoredEdges, FIT_DURATION_MS, async () => {
    setNodes(attachLayerFlipInvert(restoredNodes, firstById, 'none'))
    setEdges(withAllEdgesHidden(restoredEdges))
    await nextTick()
    await doubleRaf()
    setNodes(playLayerFlip(getNodes.value, FIT_DURATION_MS, FLIP_EASING))
  })
  setNodes(stripLayerFlipsFromNodes(getNodes.value))
  flowEl?.classList.remove(FLIP_FLOW_CLASS)
  await afterLayerDrillOut?.()
}

function isModulePinnedIn(nodes: GraphNode[], id: string): boolean {
  const n = nodes.find((x) => x.id === id)
  const d = n?.data && typeof n.data === 'object' ? (n.data as Record<string, unknown>) : null
  return d?.pinned === true
}

/**
 * True when the layer-drill focus on `id` should refuse to switch to a different box on
 * a normal node click. This guards two related cases the user expects from "pin":
 *
 *   1. Top-level pinned box (Scala leaf or package): the box itself is `data.pinned`.
 *   2. Pinned inner artefact: a focused Scala class inside this package is pinned via
 *      `data.innerArtefactPinned[*] === true`. Switching the drill would unmount the
 *      package, clear `innerArtefactFocusId`, and silently lose the pin — surprising.
 *
 * Explicit "leave focus" paths (re-click same box, parent-group drill-out, Esc, pane
 * click) bypass this guard because they all follow code paths other than a sibling
 * click into `applyLayerDrill`.
 */
function isPinLockActive(id: string): boolean {
  const nodes = getNodes.value
  if (isModulePinnedIn(nodes, id)) return true
  const n = nodes.find((x) => x.id === id)
  const d = n?.data && typeof n.data === 'object' ? (n.data as Record<string, unknown>) : null
  const pinnedMap = d?.innerArtefactPinned
  if (pinnedMap && typeof pinnedMap === 'object') {
    for (const v of Object.values(pinnedMap as Record<string, unknown>)) {
      if (v === true) return true
    }
  }
  return false
}

/**
 * Region-participant input shape for the drill column layout. A "participant" is any node
 * directly under the region parent — leaf boxes (modules / packages / artefacts) AND group
 * containers — so that, for example, three sibling package groups can each claim a column
 * within their parent diagram and one of them can be drilled into without losing animation.
 */
function numericDataValue(data: unknown, key: string): number | undefined {
  if (!data || typeof data !== 'object') return undefined
  const raw = (data as Record<string, unknown>)[key]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
}

function collectRegionParticipants(
  nodes: readonly GraphNode[],
  regionParent: string | undefined,
  depths: Map<string, number>,
): {
  id: string
  depth: number
  position: { x: number; y: number }
  width: number
  height: number
  style?: unknown
  contentWeight?: number
  preferredFocusWidth?: number
}[] {
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
      contentWeight: numericDataValue(n.data, 'contentWeight') ?? packageContentWeight(n.data as Record<string, unknown> | undefined),
      preferredFocusWidth: numericDataValue(n.data, 'preferredFocusWidth'),
    }))
}

function hasExternalRegionDependency(
  edges: readonly GraphEdge[],
  focusId: string,
  regionParticipantIds: ReadonlySet<string>,
): boolean {
  return edges.some((edge) => {
    const source = String(edge.source)
    const target = String(edge.target)
    if (source === focusId) return regionParticipantIds.has(target)
    if (target === focusId) return regionParticipantIds.has(source)
    return false
  })
}

async function applyLayerDrill(moduleId: string) {
  let nodes = getNodes.value
  let edges = getEdges.value
  let target = nodes.find((n) => n.id === moduleId)
  if (!target || !isLayerDrillBoxNode(target)) return

  /**
   * Pin lock: refuse to switch the layer drill away from a pinned focused box, OR a focused
   * package whose inner artefact is pinned. Same-id (drill-out) and explicit clear paths
   * (Esc, pane click, parent-group drill-out) do not call this branch, so the user can
   * always exit a pinned focus deliberately — only sibling-clicks become no-ops.
   */
  if (layerDrillId.value && layerDrillId.value !== moduleId && isPinLockActive(layerDrillId.value)) {
    return
  }
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
  // When panning is active the diagram exceeds the viewport; clamp the focused box so it
  // never grows beyond what the viewport can show (same 2×MARGIN_Y buffer as the top-level
  // verticalBandForLayerDrill path: 2 × 36 = 72).
  diagramH = Math.min(diagramH, Math.max(80, vp.height - 72))
  const baseW = typeof target.width === 'number' ? target.width : 200
  const preferredFocusWidth =
    target.data && typeof target.data === 'object' && typeof (target.data as Record<string, unknown>).preferredFocusWidth === 'number'
      ? ((target.data as Record<string, unknown>).preferredFocusWidth as number)
      : undefined

  const regionParticipants = collectRegionParticipants(nodes, regionParent, depths)
  const regionParticipantIds = new Set(regionParticipants.map((participant) => participant.id))
  const isolatedGroupFocus =
    targetIsGroup && !hasExternalRegionDependency(edges, moduleId, regionParticipantIds)
  const fullFocusBounds = isolatedGroupFocus
    ? fullWidthFocusBoundsForLayerDrill(vp, regionParent, nodes)
    : null
  const focusW = fullFocusBounds?.width ?? focusedModuleWidthForDrill(vp, numCols, baseW, regionParent, nodes, preferredFocusWidth)

  const fd = depths.get(moduleId) ?? 0

  // Build pinned set once — isModulePinnedIn does nodes.find() per call, so O(n × k) without this.
  const pinnedIds = new Set<string>()
  for (const n of nodes) {
    const d = n.data && typeof n.data === 'object' ? (n.data as Record<string, unknown>) : null
    if (d?.pinned === true) pinnedIds.add(String(n.id))
  }

  /** Pin semantics only apply to leaf modules today; groups are never pinned. */
  const depthsWithPinned = new Set<number>()
  for (const m of regionParticipants) {
    if (pinnedIds.has(m.id)) depthsWithPinned.add(m.depth)
  }

  // Single pass: derive hiddenSiblingIds, wideAtFocusDepthIds, layoutParticipants, and the
  // anyHiddenSibling flag (replaces the separate .some() scan).
  const hiddenSiblingIds = new Set<string>()
  const wideAtFocusDepthIds = new Set<string>()
  const layoutParticipants: typeof regionParticipants = []
  let anyHiddenSibling = false
  for (const m of regionParticipants) {
    if (isolatedGroupFocus && m.id !== moduleId) {
      hiddenSiblingIds.add(m.id)
      anyHiddenSibling = true
    } else if (m.id !== moduleId &&
        ((m.depth === fd || depthsWithPinned.has(m.depth)) && !pinnedIds.has(m.id))) {
      hiddenSiblingIds.add(m.id)
      anyHiddenSibling = true
    } else {
      layoutParticipants.push(m)
      if (m.depth === fd && pinnedIds.has(m.id)) wideAtFocusDepthIds.add(m.id)
    }
  }

  /**
   * Hiding a group also hides every node nested inside it; otherwise the descendants would
   * remain rendered in flow space and overlap the focused box.
   */
  if (targetIsGroup || anyHiddenSibling) {
    const childrenMap = buildChildrenMap(nodes)
    const expand = new Set(hiddenSiblingIds)
    for (const id of expand) {
      for (const desc of descendantIds(id, childrenMap)) {
        if (desc !== id) hiddenSiblingIds.add(desc)
      }
    }
  }

  const geoMap = computeLayerDrillColumnLayout({
    regionModules: layoutParticipants,
    focusId: moduleId,
    focusWidth: focusW,
    siblingWidthScale: 0.42,
    wideAtFocusDepthIds,
    allowFocusTrackExpansion: typeof preferredFocusWidth === 'number',
    depthGutters: relationLaneGutters(
      maxD,
      depths,
      edges
        .filter((edge) => {
          const source = String(edge.source)
          const target = String(edge.target)
          return regionParticipantIds.has(source) &&
            regionParticipantIds.has(target) &&
            !hiddenSiblingIds.has(source) &&
            !hiddenSiblingIds.has(target) &&
            edgeContributesToClasspathDepth(edge)
        })
        .map((edge) => ({
          source: String(edge.source),
          target: String(edge.target),
          label: edge.label,
        })),
    ),
  })
  if (fullFocusBounds) {
    const geo = geoMap.get(moduleId)
    const prevStyle =
      geo?.style && typeof geo.style === 'object'
        ? { ...(geo.style as Record<string, string | number>) }
        : {}
    geoMap.set(moduleId, {
      position: { x: fullFocusBounds.x, y: target.position.y },
      width: fullFocusBounds.width,
      height: typeof target.height === 'number' ? target.height : 72,
      style: {
        ...prevStyle,
        width: `${fullFocusBounds.width}px`,
        height: `${typeof target.height === 'number' ? target.height : 72}px`,
      },
    })
  }

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
    if (pinnedIds.has(String(n.id))) {
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

  const flowEl = flowRootEl()
  flowEl?.classList.add(FLIP_FLOW_CLASS)
  await runWithEdgesHiddenDuringAnimation(finalEdgesForDrill, FIT_DURATION_MS, async () => {
    setNodes(attachLayerFlipInvert(nextNodes, firstRects, 'none'))
    setEdges(withAllEdgesHidden(finalEdgesForDrill))
    await nextTick()
    await doubleRaf()
    setNodes(playLayerFlip(getNodes.value, FIT_DURATION_MS, FLIP_EASING))
  })
  setNodes(stripLayerFlipsFromNodes(getNodes.value))
  flowEl?.classList.remove(FLIP_FLOW_CLASS)
}

async function zoomIntoContainer(id: string) {
  applyDimming(id)
  const finalEdges = getEdges.value.map((e) => ({ ...e })) as GraphEdge[]
  await runWithEdgesHiddenDuringAnimation(finalEdges, FIT_DURATION_MS, async () => {
    const ids = [...brightIdsFor(id)]
    await nextTick()
    await fitView({
      nodes: ids,
      padding: 0.05,
      duration: FIT_DURATION_MS,
      maxZoom: 2.4,
      minZoom: 0.05,
    })
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

/**
 * After the parent replaces the entire node/edge graph (new YAML / dojo count), drop drill
 * snapshot and focus state without running `fitOverviewCamera` — the workspace applies a
 * single `fitToViewport` so the camera never “zooms out to everything” and then corrects.
 */
function resetNavigationAfterDocReplace() {
  cancelClickTimer()
  layerSnapshot.value = null
  layerDrillId.value = null
  layerDrillReturnFocusId.value = null
  focusedId.value = null
  if (graphFocusUi) {
    graphFocusUi.containerFocusId = null
  }
  applyDimming(null)
}

function containerHasChildren(nodeId: string): boolean {
  return getNodes.value.some((n) => String(n.parentNode) === nodeId)
}

const MODULE_CLICK_DELAY_MS = 280

function startClickTimer(fn: () => void, delay = MODULE_CLICK_DELAY_MS): void {
  cancelClickTimer()
  layerDrillPending.value = true
  clickTimer = setTimeout(() => {
    clickTimer = null
    layerDrillPending.value = false
    fn()
  }, delay)
}

function cancelClickTimer(): void {
  if (clickTimer) {
    clearTimeout(clickTimer)
    clickTimer = null
    layerDrillPending.value = false
  }
}

/**
 * Click semantics share the same "scale this box to its layer" intent across leaf project
 * boxes and group package containers. Both go through `applyLayerDrill`: clicking a box
 * grows it to fill its column / layer (with FLIP animation), clicking the same box again
 * — or the parent group frame — drills back out. Clicking the empty pane cancels a pending
 * single-click drill timer only; camera / pan rails are synced by `GraphWorkspace` without
 * clearing layer drill or inner focus. Full overview: Escape or `resetView` / `showFullGraph`.
 * The fallback `zoomIntoContainer` is only for groups that aren't part of a depth-layered
 * region (e.g. legacy ilograph documents without dependency edges).
 */
onNodeClick(({ node }) => {
  cancelClickTimer()

  if (isLeafBoxNode(node)) {
    if (layerDrillId.value === node.id) {
      void applyLayerDrill(node.id)
      return
    }
    if (layerDrillId.value && layerDrillId.value !== node.id) {
      void applyLayerDrill(node.id)
      return
    }
    startClickTimer(() => void applyLayerDrill(node.id))
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
    startClickTimer(() => void applyLayerDrill(node.id))
    return
  }

  startClickTimer(() => void zoomIntoContainer(node.id), 320)
})

onNodeDoubleClick(() => {
  cancelClickTimer()
})

onMoveStart(() => {
  suppressPaneClickUntil = Date.now() + 220
})

onMoveEnd(() => {
  suppressPaneClickUntil = Date.now() + 220
})

onPaneClick(() => {
  if (shouldSuppressPaneClick?.()) return
  if (Date.now() < suppressPaneClickUntil) return
  cancelClickTimer()
})

function onKeydown(ev: KeyboardEvent) {
  if (ev.key === 'Escape') {
    ev.preventDefault()
    cancelClickTimer()
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
  layerDrillPending,
  showFullGraph,
  resetNavigationAfterDocReplace,
  zoomIntoContainer,
  clearLayerDrill,
  applyLayerDrill,
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
