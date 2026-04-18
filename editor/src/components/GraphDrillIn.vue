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
} from '../graph/layoutDependencyLayers'
import {
  attachLayerFlipInvert,
  moduleLayoutRect,
  playLayerFlip,
  stripLayerFlipsFromNodes,
  type LayerFlipRect,
} from '../graph/layerDrillFlip'
import { DEP_SOURCE_HANDLE, DEP_TARGET_HANDLE } from '../graph/handles'

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

function isDependencyEdge(e: GraphEdge): boolean {
  const sh = String(e.sourceHandle ?? DEP_SOURCE_HANDLE)
  const th = String(e.targetHandle ?? DEP_TARGET_HANDLE)
  return sh === DEP_SOURCE_HANDLE && th === DEP_TARGET_HANDLE
}

/** Hide classpath “depends on” edges while module FLIP runs; aggregate edges stay visible. */
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

/** Module layout rects (pre-drill) for FLIP — same region, excluding hidden same-depth peers. */
function collectVisibleModuleRectsBeforeDrill(
  preNodes: GraphNode[],
  regionParent: string | undefined,
  hiddenSiblingIds: Set<string>,
): Map<string, LayerFlipRect> {
  const map = new Map<string, LayerFlipRect>()
  for (const n of preNodes) {
    if (n.type !== 'module') continue
    const nParent = n.parentNode ? String(n.parentNode) : undefined
    const sameRegion =
      (regionParent === undefined && nParent === undefined) ||
      (regionParent !== undefined && nParent === regionParent)
    if (!sameRegion || hiddenSiblingIds.has(n.id)) continue
    map.set(n.id, moduleLayoutRect(n))
  }
  return map
}

/** Top + height spanning all module boxes in this layout region (flow coordinates). */
function diagramModuleVerticalSpan(
  modNodes: GraphNode[],
  regionParent: string | undefined,
): { top: number; height: number } {
  let top = Infinity
  let bot = -Infinity
  for (const n of modNodes) {
    if (n.type !== 'module') continue
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
    if (n.type !== 'module') continue
    const d = n.data && typeof n.data === 'object' ? (n.data as Record<string, unknown>) : null
    if (d?.pinned === true) s.add(n.id)
  }
  return s
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
        class: lit ? undefined : 'tg-dimmed',
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
    if (n.type !== 'module') continue
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

async function applyLayerDrill(moduleId: string) {
  let nodes = getNodes.value
  let edges = getEdges.value
  let target = nodes.find((n) => n.id === moduleId)
  if (!target || target.type !== 'module') return

  if (layerDrillId.value && layerDrillId.value !== moduleId) {
    clearLayerDrill()
    nodes = getNodes.value
    edges = getEdges.value
    target = nodes.find((n) => n.id === moduleId)
    if (!target || target.type !== 'module') return
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

  const regionParent = target.parentNode ? String(target.parentNode) : undefined
  const depths = dependencyDepthsInRegion(nodes, edges, regionParent)

  const maxD = depths.size ? Math.max(0, ...depths.values()) : 0
  const numCols = maxD + 1
  const vp = readFlowViewport()
  const { top: diagramTop, height: diagramH } = diagramModuleVerticalSpan(nodes, regionParent)
  const baseW = typeof target.width === 'number' ? target.width : 200
  const focusW = focusedModuleWidthForDrill(vp, numCols, baseW, regionParent, nodes)

  const regionModuleInputs = nodes
    .filter((n) => {
      const nParent = n.parentNode ? String(n.parentNode) : undefined
      const sr =
        (regionParent === undefined && nParent === undefined) ||
        (regionParent !== undefined && nParent === regionParent)
      return sr && n.type === 'module'
    })
    .map((n) => ({
      id: n.id,
      depth: depths.get(n.id) ?? 0,
      position: { ...n.position },
      width: typeof n.width === 'number' ? n.width : 200,
      height: typeof n.height === 'number' ? n.height : 72,
      style: n.style,
    }))

  const fd = depths.get(moduleId) ?? 0
  const depthsWithPinned = new Set<number>()
  for (const m of regionModuleInputs) {
    if (isModulePinnedIn(nodes, m.id)) depthsWithPinned.add(m.depth)
  }

  const hiddenSiblingIds = new Set<string>()
  for (const m of regionModuleInputs) {
    if (m.id === moduleId) continue
    if (m.depth === fd && !isModulePinnedIn(nodes, m.id)) {
      hiddenSiblingIds.add(m.id)
    }
    if (depthsWithPinned.has(m.depth) && !isModulePinnedIn(nodes, m.id)) {
      hiddenSiblingIds.add(m.id)
    }
  }

  const wideAtFocusDepthIds = new Set(
    regionModuleInputs.filter((m) => m.depth === fd && isModulePinnedIn(nodes, m.id)).map((m) => m.id),
  )

  /** Same-layer peers are hidden — omit them from width conservation so the focus column can grow. */
  const layoutModules = regionModuleInputs.filter((m) => !hiddenSiblingIds.has(m.id))

  const geoMap = computeLayerDrillColumnLayout({
    regionModules: layoutModules,
    focusId: moduleId,
    focusWidth: focusW,
    siblingWidthScale: 0.42,
    wideAtFocusDepthIds,
  })

  const nextNodes = nodes.map((n) => {
    const nParent = n.parentNode ? String(n.parentNode) : undefined
    const sameRegion =
      (regionParent === undefined && nParent === undefined) ||
      (regionParent !== undefined && nParent === regionParent)

    if (!sameRegion) {
      return { ...n, hidden: false } as GraphNode
    }

    if (n.type !== 'module') {
      return { ...n, hidden: false } as GraphNode
    }

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

    const geo = geoMap.get(n.id)
    if (!geo) {
      return { ...n, hidden: false } as GraphNode
    }

    const prevData =
      n.data && typeof n.data === 'object' ? { ...(n.data as Record<string, unknown>) } : {}
    if (n.id === moduleId) {
      prevData.layerDrillFocus = true
      /** Match the diagram’s vertical extent (all modules in this region) so zoom does not refit the camera. */
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
  })

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

onNodeClick(({ node }) => {
  if (clickTimer) {
    clearTimeout(clickTimer)
    clickTimer = null
  }

  if (node.type === 'module') {
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

  /** Click the parent group frame (zoomed box) to drill out of layer focus. */
  if (node.type === 'group' && layerDrillId.value && containerHasChildren(node.id)) {
    const drilled = getNodes.value.find((n) => n.id === layerDrillId.value)
    const parentId = drilled?.parentNode != null ? String(drilled.parentNode) : undefined
    if (parentId === node.id) {
      void applyLayerDrill(layerDrillId.value)
      return
    }
  }

  if (!containerHasChildren(node.id)) return
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

defineExpose({
  focusedId,
  layerDrillId,
  showFullGraph,
  zoomIntoContainer,
  clearLayerDrill,
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
