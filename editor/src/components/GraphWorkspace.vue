<script setup lang="ts">
import {
  ConnectionMode,
  PanOnScrollMode,
  Position,
  VueFlow,
  getRectOfNodes,
  type Connection,
  type CoordinateExtent,
  type NodeTypesObject,
  useVueFlow,
} from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { computed, nextTick, onMounted, onUnmounted, provide, reactive, ref, unref, watch } from 'vue'
import DiagramContainerView from './diagram/DiagramContainerView.vue'
import GraphDrillIn from './GraphDrillIn.vue'
import { buildDiagramRootModel } from '../diagram/model/buildRootDiagram'
import { dependencyEdgeLabelStyle, dependencyEdgeStyle, dependencyMarker, DEP_EDGE_STROKE } from '../graph/edgeTheme'
import { shouldHideEdgeForRelationFilter } from '../graph/relationVisibility'
import {
  applyHandleAnchorAlignment,
  layoutDepthInViewport,
  mergeEdgeHiddenForInvisibleEndpoints,
  routeSmoothstepEdgesInViewport,
} from '../graph/layoutDependencyLayers'
import { AGG_SOURCE_HANDLE, AGG_TARGET_HANDLE } from '../graph/handles'
import { boxColorForId } from '../graph/boxColors'
import { isLeafBoxNode } from '../graph/nodeKinds'
import { languageIconForId } from '../graph/languages'
import { strokeColorForFlowEdge } from '../graph/relationKinds'
import { drillNoteForModuleId } from '../graph/sbtStyleDrillNotes'

const MODULE_LAYOUT_W = 200
const MODULE_LAYOUT_H = 72
const PACKAGE_SCOPE_GROUP_MIN_LAYOUT_H = 40
const OTHER_GROUP_MIN_LAYOUT_H = 76

/** Subpixel / border slack so a graph that visually fits does not enable pan rails. */
const PAN_RAIL_FIT_SLACK_PX = 8

const nodes = defineModel<any[]>('nodes', { required: true })
const edges = defineModel<any[]>('edges', { required: true })

const props = defineProps<{
  nodeTypes: NodeTypesObject
  /** When a key is `false`, edges with that relation label are hidden (merged into `hidden`). */
  relationTypeVisibility?: Record<string, boolean>
}>()

const emit = defineEmits<{
  /** User-facing status line updates (e.g. new module from pane connect). */
  status: [message: string]
  /** Markdown-link click on a project box subtitle. `href` is the raw link target (e.g. `triton:packages`). */
  'link-action': [payload: { nodeId: string; href: string }]
}>()

/**
 * `useVueFlow()` must target the same store as `<VueFlow>`. This component’s `<script setup>`
 * runs as the **parent** of `<VueFlow>`, so a bare `useVueFlow()` creates an orphan store:
 * `vueFlowRef` stays null and `screenToFlowCoordinate` always returns (0,0) — pane-drop would
 * “do nothing” visually. A stable id links parent composables to the mounted pane.
 */
const WORKSPACE_FLOW_ID = 'triton-workspace'
const {
  fitView,
  screenToFlowCoordinate,
  setNodes,
  setEdges,
  updateNodeInternals,
  setViewport,
  setTranslateExtent,
  viewport,
} = useVueFlow(WORKSPACE_FLOW_ID)

/** Default: pan is unconstrained (see Vue Flow store initial `translateExtent`). */
const UNBOUNDED_TRANSLATE_EXTENT: CoordinateExtent = [
  [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
]
const drillRef = ref<InstanceType<typeof GraphDrillIn> | null>(null)

const verticalScrollChrome = ref(false)
const horizontalScrollChrome = ref(false)
/** 0 = show top of graph, 1000 = show bottom — only meaningful when {@link verticalScrollChrome}. */
const verticalScrollSlider = ref(0)
/** 0 = show left of graph, 1000 = show right — only meaningful when {@link horizontalScrollChrome}. */
const horizontalScrollSlider = ref(0)
let panBounds: { xMin: number; xMax: number; yMin: number; yMax: number; zoom: number } = {
  xMin: 0,
  xMax: 0,
  yMin: 0,
  yMax: 0,
  zoom: 1,
}
let verticalSliderSync = false
let horizontalSliderSync = false
/**
 * Fraction of the rail that the thumb occupies = fraction of the diagram visible at once.
 * 1 means the entire diagram fits in the viewport (no scrolling needed).
 * Clamped to [0.06, 1] so there is always a grabbable handle.
 */
const verticalThumbFraction = ref(1)
const horizontalThumbFraction = ref(1)
const panePanSuppressUntil = ref(0)
let panePanDrag:
  | {
      startClientX: number
      startClientY: number
      startViewportX: number
      startViewportY: number
      moved: boolean
    }
  | null = null

const verticalScrollThumbStyle = computed(() => {
  const t = Math.max(0, Math.min(1, verticalScrollSlider.value / 1000))
  const frac = Math.max(0.06, Math.min(1, verticalThumbFraction.value))
  return {
    top: `${(t * (1 - frac) * 100).toFixed(3)}%`,
    height: `${(frac * 100).toFixed(3)}%`,
  }
})

const horizontalScrollThumbStyle = computed(() => {
  const t = Math.max(0, Math.min(1, horizontalScrollSlider.value / 1000))
  const frac = Math.max(0.06, Math.min(1, horizontalThumbFraction.value))
  return {
    left: `${(t * (1 - frac) * 100).toFixed(3)}%`,
    width: `${(frac * 100).toFixed(3)}%`,
  }
})

function layerDrillActive(): boolean {
  const raw = (drillRef.value as { layerDrillId?: unknown } | null)?.layerDrillId
  return !!unref(raw)
}

/** True when a drill is active OR a click-timer is pending (i.e. the drill is about to fire).
 * Used to suppress viewport resets (resize-relayout, singleton-scope snap) that would race the
 * drill animation — without this guard the viewport jumps to {x:0,y:0} before applyLayerDrill. */
function layerDrillBusy(): boolean {
  if (layerDrillActive()) return true
  const pending = (drillRef.value as { layerDrillPending?: unknown } | null)?.layerDrillPending
  return !!unref(pending)
}

function resetVerticalScrollChrome(): void {
  verticalScrollChrome.value = false
  horizontalScrollChrome.value = false
  verticalScrollSlider.value = 0
  horizontalScrollSlider.value = 0
  setTranslateExtent(UNBOUNDED_TRANSLATE_EXTENT)
}

/**
 * Limit viewport pan so the user cannot scroll past the padded diagram bounds (Vue Flow
 * `translateExtent` clamps `setViewport` / wheel-pan the same way `transformViewport` does).
 */
function translateExtentForPan(xMin: number, xMax: number, yMin: number, yMax: number): CoordinateExtent {
  return [
    [-xMax, -yMax],
    [-xMin, -yMin],
  ]
}

function nodePixelHeight(node: any): number {
  const styleHeight = Number(node?.style?.height)
  if (Number.isFinite(styleHeight) && styleHeight > 0) return styleHeight
  if (typeof node?.height === 'number' && Number.isFinite(node.height) && node.height > 0) return node.height
  return isLeafBoxNode(node) ? MODULE_LAYOUT_H : OTHER_GROUP_MIN_LAYOUT_H
}

function nodeMinHeight(node: any): number {
  if (isLeafBoxNode(node)) {
    const raw =
      node?.data && typeof node.data === 'object'
        ? (node.data as Record<string, unknown>).preferredLeafHeight
        : undefined
    return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : MODULE_LAYOUT_H
  }
  const data = node?.data
  return data && typeof data === 'object' && (data as Record<string, unknown>).packageScope === true
    ? PACKAGE_SCOPE_GROUP_MIN_LAYOUT_H
    : OTHER_GROUP_MIN_LAYOUT_H
}

const hoveredNodeId = ref<string | null>(null)
/** When set, only this edge is stroke-emphasized (takes precedence over node-hover). */
const hoveredEdgeId = ref<string | null>(null)
const packageFocusRelayoutQueued = ref(false)

function hasSingletonRootPackageScopeOverview(): boolean {
  const topVisible = nodes.value.filter((n) => !n.parentNode && !n.hidden)
  if (topVisible.length !== 1) return false
  const root = topVisible[0]
  if (root?.type === 'group') {
    const data = (root.data ?? {}) as Record<string, unknown>
    return data.packageScope === true
  }
  return isLeafBoxNode(root)
}

async function fitOverviewSingletonPackageScope(duration = 0): Promise<void> {
  resetVerticalScrollChrome()
  await nextTick()
  await doubleRaf()
  await setViewport({ x: 0, y: 0, zoom: 1 }, { duration })
}

/** After connect-start from a **source** handle: if pointer up does not complete @connect, create a module on the pane. */
const pendingPaneConnect = ref<{ nodeId: string; handleId: string | null } | null>(null)
let connectGestureFinishedOnTarget = false

/** True while depth columns reflow after a new dependency edge so node `transform` animates. */
const depthLayoutAnimate = ref(false)

async function doubleRaf(): Promise<void> {
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
}

function mergeEdgeEmphClass(existing: string | undefined, emph: boolean): string | undefined {
  const parts = new Set(String(existing ?? '').split(/\s+/).filter(Boolean))
  parts.delete('tg-edge-emph')
  if (emph) parts.add('tg-edge-emph')
  const out = [...parts].join(' ')
  return out || undefined
}

function packageFocusState() {
  for (const n of nodes.value) {
    const data = (n.data ?? {}) as Record<string, unknown>
    const focusedInnerArtefactId = typeof data.innerArtefactFocusId === 'string' ? data.innerArtefactFocusId : ''
    if (!focusedInnerArtefactId) continue
    const innerArtefacts = Array.isArray(data.innerArtefacts) ? data.innerArtefacts : []
    const containerArtefactIds = new Set<string>()
    for (const art of innerArtefacts) {
      const id = art && typeof art === 'object' ? (art as Record<string, unknown>).id : undefined
      if (typeof id === 'string' && id) containerArtefactIds.add(id)
    }
    if (!containerArtefactIds.size) containerArtefactIds.add(focusedInnerArtefactId)
    return {
      focusedNodeId: String(n.id),
      focusedInnerArtefactId,
      containerArtefactIds,
    }
  }
  return null
}

function computePackageRelationVisibleNodeIds(): Set<string> | null {
  const state = packageFocusState()
  if (!state) return null

  const visible = new Set<string>([state.focusedNodeId])
  for (const n of nodes.value) {
    const data = (n.data ?? {}) as Record<string, unknown>
    const cross = Array.isArray(data.crossArtefactRelations) ? data.crossArtefactRelations : []
    const inner = Array.isArray(data.innerArtefactRelations) ? data.innerArtefactRelations : []
    const rels = [...cross, ...inner]
    const touchesFocusedContainer = rels.some((rel) => {
      if (!rel || typeof rel !== 'object') return false
      const from = typeof (rel as Record<string, unknown>).from === 'string' ? String((rel as Record<string, unknown>).from) : ''
      const to = typeof (rel as Record<string, unknown>).to === 'string' ? String((rel as Record<string, unknown>).to) : ''
      return state.containerArtefactIds.has(from) || state.containerArtefactIds.has(to)
    })
    if (touchesFocusedContainer) visible.add(String(n.id))
  }

  let changed = true
  while (changed) {
    changed = false
    for (const n of nodes.value) {
      const id = String(n.id)
      const parentId = n.parentNode != null ? String(n.parentNode) : ''
      if (visible.has(id) && parentId && !visible.has(parentId)) {
        visible.add(parentId)
        changed = true
      }
    }
  }
  return visible
}

function applyPackageRelationFocusVisibility(): boolean {
  const visibleIds = computePackageRelationVisibleNodeIds()
  let changed = false
  const nextNodes = nodes.value.map((n) => {
    const data = { ...((n.data ?? {}) as Record<string, unknown>) }
    const managed = data.__packageRelationFocusManaged === true
    const baseHidden =
      managed && typeof data.__packageRelationFocusBaseHidden === 'boolean'
        ? Boolean(data.__packageRelationFocusBaseHidden)
        : Boolean((n as { hidden?: boolean }).hidden)

    if (!visibleIds) {
      if (!managed) return n
      delete data.__packageRelationFocusManaged
      delete data.__packageRelationFocusBaseHidden
      changed = true
      return { ...n, hidden: baseHidden, data }
    }

    const shouldHide = !visibleIds.has(String(n.id))
    const newHidden = baseHidden || shouldHide
    if (
      (n as { hidden?: boolean }).hidden === newHidden &&
      managed &&
      data.__packageRelationFocusBaseHidden === baseHidden
    ) return n
    changed = true
    return {
      ...n,
      hidden: newHidden,
      data: { ...data, __packageRelationFocusManaged: true, __packageRelationFocusBaseHidden: baseHidden },
    }
  })

  if (!changed) return false
  nodes.value = nextNodes
  return true
}

async function applyPackageRelationFocusVisibilityAndRelayout() {
  const changed = applyPackageRelationFocusVisibility()
  if (!changed || packageFocusRelayoutQueued.value) return
  packageFocusRelayoutQueued.value = true
  try {
    await nextTick()
    /** Same camera rules as other relayouts — never a standalone zoom-out-to-whole-graph fit. */
    await fitToViewport({ duration: 0 })
  } finally {
    packageFocusRelayoutQueued.value = false
  }
}

/**
 * Sets stroke emphasis (`tg-edge-emph`) and `hidden` from endpoints + relation filter, with a
 * peek-through: relation-filtered edges stay visible while an endpoint box is hovered.
 */
function syncEdgeVisualState() {
  const hid = hoveredNodeId.value
  const heid = hoveredEdgeId.value
  const hiddenIds = new Set(nodes.value.filter((n) => n.hidden).map((n) => String(n.id)))

  let changed = false
  const next = edges.value.map((e) => {
    const id = String(e.id)
    const emph = heid ? id === heid : !!(hid && (e.source === hid || e.target === hid))
    const newClass = mergeEdgeEmphClass((e as { class?: string }).class, emph)
    const stroke = strokeColorForFlowEdge(e)
    const newLabelStyle = dependencyEdgeLabelStyle(stroke, emph)
    const newZIndex = emph ? 1200 : 0

    const endHidden = hiddenIds.has(String(e.source)) || hiddenIds.has(String(e.target))
    const relHidden = shouldHideEdgeForRelationFilter(e, props.relationTypeVisibility)
    const incident = !!(hid && (String(e.source) === hid || String(e.target) === hid))
    const newHidden = endHidden || (relHidden && !incident)

    const prevH = (e as { hidden?: boolean }).hidden === true
    const prevC = (e as { class?: string }).class
    const prevZ = typeof (e as { zIndex?: unknown }).zIndex === 'number' ? (e as { zIndex: number }).zIndex : 0
    const prevLabelStyle =
      (e as { labelStyle?: Record<string, unknown> | undefined }).labelStyle ?? {}
    const sameLabelStyle =
      prevLabelStyle.fill === newLabelStyle.fill &&
      prevLabelStyle.opacity === newLabelStyle.opacity &&
      prevLabelStyle.fontWeight === newLabelStyle.fontWeight &&
      prevLabelStyle.fontSize === newLabelStyle.fontSize &&
      prevLabelStyle.transform === newLabelStyle.transform
    if (newClass === prevC && newHidden === prevH && prevZ === newZIndex && sameLabelStyle) return e
    changed = true
    return { ...e, class: newClass, hidden: newHidden, zIndex: newZIndex, labelStyle: newLabelStyle }
  })
  if (!changed) return
  edges.value = next
}

watch([hoveredNodeId, hoveredEdgeId], () => void nextTick(() => syncEdgeVisualState()))

watch(
  () => props.relationTypeVisibility,
  () => void nextTick(() => syncEdgeVisualState()),
  { deep: true },
)

watch(
  () => {
    // Only serialize hidden nodes — produces a much shorter string than serializing all N nodes,
    // and the string comparison Vue does is proportionally faster.
    let sig = ''
    for (const n of nodes.value) {
      if ((n as { hidden?: boolean }).hidden === true) sig += ',' + String(n.id)
    }
    return sig
  },
  () => void nextTick(() => syncEdgeVisualState()),
)

watch(
  () => {
    // Only include nodes that carry inner-artefact data — skips the majority of nodes on each tick.
    let sig = ''
    for (const n of nodes.value) {
      const d = (n.data ?? {}) as Record<string, unknown>
      const focus = typeof d.innerArtefactFocusId === 'string' ? d.innerArtefactFocusId : ''
      const innerArts = Array.isArray(d.innerArtefacts) ? d.innerArtefacts.length : 0
      const cross = Array.isArray(d.crossArtefactRelations) ? d.crossArtefactRelations.length : 0
      const inner = Array.isArray(d.innerArtefactRelations) ? d.innerArtefactRelations.length : 0
      if (focus || innerArts || cross || inner)
        sig += `${String(n.id)}:${focus}:${innerArts}:${cross}:${inner}|`
    }
    return sig
  },
  () => void nextTick(() => applyPackageRelationFocusVisibilityAndRelayout()),
)

watch(
  () => edges.value,
  () => void nextTick(() => syncEdgeVisualState()),
  { flush: 'post' },
)

/** Synced from GraphDrillIn so module chrome can show the pin only in zoom/layer-focus context. */
const graphFocusUi = reactive({ containerFocusId: null as string | null })
provide('tritonGraphFocusUi', graphFocusUi)
provide('tritonFitToViewport', fitToViewport)
provide('tritonShouldSuppressPaneClick', () => Date.now() < panePanSuppressUntil.value)

provide('tritonRefreshDimming', () => {
  drillRef.value?.refreshDimming?.()
})

function readFlowViewport(): { width: number; height: number } {
  if (typeof document === 'undefined') return { width: 960, height: 720 }
  const pane =
    (document.querySelector('.flow-wrap-shell .flow') as HTMLElement | null) ??
    (document.querySelector('.flow-wrap-shell') as HTMLElement | null) ??
    (document.querySelector('.flow-wrap') as HTMLElement | null)
  if (!pane) return { width: 960, height: 720 }
  const w =
    pane instanceof HTMLElement && pane.clientWidth > 0
      ? pane.clientWidth
      : pane.getBoundingClientRect().width
  const h =
    pane instanceof HTMLElement && pane.clientHeight > 0
      ? pane.clientHeight
      : pane.getBoundingClientRect().height
  return {
    width: Math.max(200, w),
    height: Math.max(200, h),
  }
}

const diagramModel = computed(() => {
  const vp = readFlowViewport()
  return buildDiagramRootModel(nodes.value, edges.value, { x: 0, y: 0, width: vp.width, height: vp.height })
})

async function relayoutViewport(opts?: { skipDrillReapply?: boolean; preserveFitToViewport?: boolean }) {
  if (!nodes.value.length) return
  await nextTick()
  await doubleRaf()
  const vp = readFlowViewport()
  nodes.value = layoutDepthInViewport(nodes.value, edges.value, vp)
  edges.value = mergeEdgeHiddenForInvisibleEndpoints(
    routeSmoothstepEdgesInViewport(nodes.value, edges.value, vp),
    nodes.value,
    {
      hideEdgeForRelation: (e) => shouldHideEdgeForRelationFilter(e, props.relationTypeVisibility),
    },
  )
  nodes.value = applyHandleAnchorAlignment(nodes.value, edges.value)
  void nextTick(() => syncEdgeVisualState())
  /**
   * Re-apply an active layer drill against the new viewport. Without this, the drill geometry
   * stays sized for the previous viewport (e.g. wider when the YAML side panel was visible),
   * so toggling the panel leaves the focused container overflowing the canvas. The drill itself
   * runs its FLIP animation and fits the camera to the new bounds.
   */
  const reapplied = opts?.skipDrillReapply ? false : ((await drillRef.value?.reapplyLayerDrill?.()) ?? false)
  if (reapplied) return
  /** Keep the full graph in view after geometry changes; skip while drill is active or pending. */
  if (!layerDrillBusy()) {
    if (hasSingletonRootPackageScopeOverview()) {
      await fitOverviewSingletonPackageScope(0)
    } else {
      await fitToViewport({
        duration: 0,
        preserveViewportPosition: opts?.preserveFitToViewport === true,
      })
    }
  }
}

provide('tritonRelayoutViewport', relayoutViewport)

/** Re-run depth layout after layer drill-out so snapshot geometry does not shrink pinned modules. */
provide('tritonAfterLayerDrillOut', () => relayoutViewport({ preserveFitToViewport: true }))

/**
 * Update a node's `data` directly on the v-model array. `useVueFlow().updateNodeData(...)`
 * mutates Vue Flow's internal store but does not always propagate back to the parent ref bound
 * via v-model — the next layout pass that re-reads `nodes.value` then overwrites the change.
 * Patching the v-model source array fixes that and triggers a normal reactive re-render.
 */
function tritonPatchNodeData(id: string, patch: Record<string, unknown>) {
  nodes.value = nodes.value.map((n) =>
    n.id === id ? { ...n, data: { ...(n.data ?? {}), ...patch } } : n,
  )
}
provide('tritonPatchNodeData', tritonPatchNodeData)

/** Surface link-action clicks from FlowProjectNode → ProjectBox subtitle to the App-level handler. */
function tritonEmitLinkAction(nodeId: string, href: string) {
  emit('link-action', { nodeId, href })
}
provide('tritonEmitLinkAction', tritonEmitLinkAction)

const defaultEdgeOptions = {
  type: 'smoothstep' as const,
  /**
   * Keep default relations below node chrome; hover/focus emphasis lifts the active edge above
   * boxes in `syncEdgeVisualState()` so the important relation reads clearly without keeping the
   * full wiring layer on top all the time.
   */
  zIndex: 0,
  style: dependencyEdgeStyle(DEP_EDGE_STROKE),
  markerStart: undefined,
  markerEnd: dependencyMarker(DEP_EDGE_STROKE),
  sourceHandle: AGG_SOURCE_HANDLE,
  targetHandle: AGG_TARGET_HANDLE,
  labelStyle: dependencyEdgeLabelStyle(DEP_EDGE_STROKE),
}

function uid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(16).slice(2)}`
}

function onConnectStart(ev: unknown) {
  connectGestureFinishedOnTarget = false
  const p = ev && typeof ev === 'object' ? (ev as Record<string, unknown>) : {}
  const nodeId = typeof p.nodeId === 'string' ? p.nodeId : undefined
  const handleType = p.handleType
  const rawHid = p.handleId
  const handleId = rawHid == null || rawHid === '' ? null : String(rawHid)
  if (handleType === 'source' && nodeId) {
    pendingPaneConnect.value = { nodeId, handleId }
  } else {
    pendingPaneConnect.value = null
  }
}

/** Pointer position for connect-end / hit-testing (native or wrapped events). */
function clientPointFromPointerLike(ev: unknown): { x: number; y: number } | null {
  if (!ev || typeof ev !== 'object') return null
  if ('changedTouches' in ev) {
    const te = ev as TouchEvent
    const t = te.changedTouches?.[0]
    if (t) return { x: t.clientX, y: t.clientY }
  }
  if ('clientX' in ev && typeof (ev as { clientX: unknown }).clientX === 'number') {
    const o = ev as { clientX: number; clientY: number }
    return { x: o.clientX, y: o.clientY }
  }
  if ('event' in ev) return clientPointFromPointerLike((ev as { event: unknown }).event)
  return null
}

function connectEndEventTarget(ev: unknown): EventTarget | null {
  if (!ev || typeof ev !== 'object') return null
  if ('target' in ev && (ev as { target?: EventTarget | null }).target != null) {
    return (ev as { target: EventTarget | null }).target
  }
  if ('event' in ev) return connectEndEventTarget((ev as { event: unknown }).event)
  return null
}

/**
 * True when the pointer is over “empty” graph chrome (not a node, handle, or committed edge).
 * Uses {@link Document.elementsFromPoint} so a transient connection preview SVG above the pane
 * does not block pane drops; still rejects when the topmost meaningful hit is a node/handle/edge.
 */
function isPaneEmptyConnectDrop(client: { x: number; y: number }, fallbackTarget: EventTarget | null): boolean {
  if (typeof document === 'undefined') return false
  const wrap = document.querySelector('.flow-wrap')
  const doc = document as Document & { elementsFromPoint?: (x: number, y: number) => Element[] }
  const stack: Element[] = doc.elementsFromPoint
    ? doc.elementsFromPoint(client.x, client.y)
    : (() => {
        const top = doc.elementFromPoint(client.x, client.y)
        return top instanceof Element ? [top] : []
      })()
  const consider = stack.length
    ? stack
    : fallbackTarget instanceof Element
      ? [fallbackTarget]
      : []
  for (const raw of consider) {
    if (!(raw instanceof Element)) continue
    const el = raw
    const inFlow = el.closest('.vue-flow')
    if (!inFlow) continue
    if (wrap && !wrap.contains(el)) continue
    if (el.closest('.vue-flow__handle')) return false
    if (el.closest('.vue-flow__node')) return false
    if (el.closest('.vue-flow__edge')) return false
    if (el.closest('.vue-flow__connectionline') || el.classList.contains('vue-flow__connection-path')) continue
    return true
  }
  return false
}

/** Vue Flow `@connect-end` (and internal helpers): project with the same `useVueFlow(id)` store as this pane. */
function handleFlowConnectEnd(
  ev: unknown,
  screenToFlow: (p: { x: number; y: number }) => { x: number; y: number },
) {
  if (connectGestureFinishedOnTarget) {
    pendingPaneConnect.value = null
    return
  }
  const pending = pendingPaneConnect.value
  if (!pending) return
  const pt = clientPointFromPointerLike(ev)
  if (!pt) {
    pendingPaneConnect.value = null
    return
  }
  if (!isPaneEmptyConnectDrop(pt, connectEndEventTarget(ev))) {
    pendingPaneConnect.value = null
    return
  }

  const src = nodes.value.find((n) => String(n.id) === pending.nodeId)
  if (!src || (!isLeafBoxNode(src) && src.type !== 'group')) {
    pendingPaneConnect.value = null
    return
  }

  pendingPaneConnect.value = null
  const flowPos = screenToFlow(pt)
  void createModuleFromSourceHandle(pending.nodeId, pending.handleId, flowPos)
}

function onVueFlowConnectEnd(ev: MouseEvent | TouchEvent | undefined) {
  handleFlowConnectEnd(ev, screenToFlowCoordinate)
}

async function createModuleFromSourceHandle(
  sourceNodeId: string,
  sourceHandleId: string | null,
  flowPos: { x: number; y: number },
) {
  const src = nodes.value.find((n) => String(n.id) === sourceNodeId)
  if (!src || (!isLeafBoxNode(src) && src.type !== 'group')) return

  const id = `module-${uid()}`
  const parentRaw = (src as { parentNode?: string }).parentNode
  /** New module sits inside a group when the drag started from that group; otherwise inherit the source module’s parent. */
  const parentNode =
    src.type === 'group'
      ? String(sourceNodeId)
      : parentRaw !== undefined && parentRaw !== null && parentRaw !== ''
        ? String(parentRaw)
        : undefined

  const sh = sourceHandleId ?? AGG_SOURCE_HANDLE

  const newNode: Record<string, unknown> = {
    id,
    type: 'module',
    position: {
      x: flowPos.x - MODULE_LAYOUT_W / 2,
      y: flowPos.y - MODULE_LAYOUT_H / 2,
    },
    sourcePosition: Position.Left,
    targetPosition: Position.Right,
    data: {
      label: 'new-module',
      subtitle: 'sbt project id',
      boxColor: boxColorForId(id),
      language: languageIconForId(id),
      drillNote: drillNoteForModuleId(id),
    },
  }
  if (parentNode) {
    newNode.parentNode = parentNode
    newNode.extent = 'parent'
    newNode.expandParent = true
  }

  const newEdge = {
    id: `e-${uid()}`,
    source: sourceNodeId,
    target: id,
    sourceHandle: sh,
    targetHandle: AGG_TARGET_HANDLE,
    label: 'depends on',
    labelStyle: dependencyEdgeLabelStyle(DEP_EDGE_STROKE),
    markerStart: undefined,
    markerEnd: dependencyMarker(DEP_EDGE_STROKE),
    style: dependencyEdgeStyle(DEP_EDGE_STROKE),
  }

  await nextTick()
  await doubleRaf()
  const vp = readFlowViewport()
  const withEdge = [...edges.value, newEdge]
  nodes.value = layoutDepthInViewport([...nodes.value, newNode as any], withEdge, vp)
  edges.value = mergeEdgeHiddenForInvisibleEndpoints(
    routeSmoothstepEdgesInViewport(nodes.value, withEdge, vp),
    nodes.value,
    {
      hideEdgeForRelation: (e) => shouldHideEdgeForRelationFilter(e, props.relationTypeVisibility),
    },
  )
  nodes.value = applyHandleAnchorAlignment(nodes.value, edges.value)
  void nextTick(() => syncEdgeVisualState())
  emit(
    'status',
    `Added ${id} and a depends-on link from ${sourceNodeId} — double-click the box to rename; YAML diff highlights new lines until you accept the baseline.`,
  )
}

function onNodeMouseEnter(ev: { node: { id: string } }) {
  hoveredNodeId.value = ev.node.id
}

function onNodeMouseLeave(ev: { node: { id: string } }) {
  if (hoveredNodeId.value === ev.node.id) hoveredNodeId.value = null
}

function onPaneClickClearHover() {
  hoveredNodeId.value = null
  hoveredEdgeId.value = null
}

function paneBackgroundCanStartPan(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.closest('.flow-v-scroll-rail, .flow-h-scroll-rail')) return false
  return !!target.closest('.vue-flow__pane, .vue-flow__viewport, .vue-flow')
}

function clampViewportAxis(value: number, axis: 'x' | 'y'): number {
  if (axis === 'x') {
    if (!horizontalScrollChrome.value) return value
    return Math.min(panBounds.xMax, Math.max(panBounds.xMin, value))
  }
  if (!verticalScrollChrome.value) return value
  return Math.min(panBounds.yMax, Math.max(panBounds.yMin, value))
}

function syncPanRailsFromViewportTransform(ft: { x: number; y: number; zoom: number }) {
  if ((!verticalScrollChrome.value && !horizontalScrollChrome.value) || (verticalSliderSync || horizontalSliderSync)) return
  const { x, y, zoom } = ft
  if (Math.abs(zoom - panBounds.zoom) > 0.02) return
  if (horizontalScrollChrome.value) {
    const spanX = panBounds.xMin - panBounds.xMax
    if (Number.isFinite(spanX) && Math.abs(spanX) >= 1e-4) {
      const tX = (x - panBounds.xMax) / spanX
      horizontalScrollSlider.value = Math.round(Math.max(0, Math.min(1000, tX * 1000)))
    }
  }
  if (verticalScrollChrome.value) {
    const spanY = panBounds.yMin - panBounds.yMax
    if (Number.isFinite(spanY) && Math.abs(spanY) >= 1e-4) {
      const tY = (y - panBounds.yMax) / spanY
      verticalScrollSlider.value = Math.round(Math.max(0, Math.min(1000, tY * 1000)))
    }
  }
}

function finishPanePanDrag() {
  if (panePanDrag?.moved) panePanSuppressUntil.value = Date.now() + 260
  if (typeof window !== 'undefined') {
    window.removeEventListener('pointermove', onWindowPanePanPointerMove, true)
    window.removeEventListener('pointerup', onWindowPanePanPointerUp, true)
    window.removeEventListener('pointercancel', onWindowPanePanPointerCancel, true)
    window.removeEventListener('mousemove', onWindowPanePanMouseMove, true)
    window.removeEventListener('mouseup', onWindowPanePanMouseUp, true)
  }
  panePanDrag = null
}

function onPanePanPointerDown(ev: PointerEvent) {
  beginPanePanDrag(ev.button, ev.clientX, ev.clientY, ev.target)
}

function beginPanePanDrag(button: number, clientX: number, clientY: number, target: EventTarget | null) {
  if (button !== 0) return
  if (!verticalScrollChrome.value && !horizontalScrollChrome.value) return
  if (!paneBackgroundCanStartPan(target)) return
  const current = viewport.value ?? { x: 0, y: 0, zoom: 1 }
  panePanDrag = {
    startClientX: clientX,
    startClientY: clientY,
    startViewportX: current.x,
    startViewportY: current.y,
    moved: false,
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pointermove', onWindowPanePanPointerMove, true)
    window.addEventListener('pointerup', onWindowPanePanPointerUp, true)
    window.addEventListener('pointercancel', onWindowPanePanPointerCancel, true)
    window.addEventListener('mousemove', onWindowPanePanMouseMove, true)
    window.addEventListener('mouseup', onWindowPanePanMouseUp, true)
  }
}

function applyPanePanDrag(clientX: number, clientY: number) {
  if (!panePanDrag) return
  const dx = clientX - panePanDrag.startClientX
  const dy = clientY - panePanDrag.startClientY
  if (!panePanDrag.moved && Math.hypot(dx, dy) >= 4) {
    panePanDrag.moved = true
    panePanSuppressUntil.value = Date.now() + 260
  }
  if (!panePanDrag.moved) return
  const x = clampViewportAxis(panePanDrag.startViewportX + dx, 'x')
  const y = clampViewportAxis(panePanDrag.startViewportY + dy, 'y')
  void setViewport({ x, y, zoom: panBounds.zoom }, { duration: 0 })
  syncPanRailsFromViewportTransform({ x, y, zoom: panBounds.zoom })
}

function onPanePanPointerMove(ev: PointerEvent) {
  applyPanePanDrag(ev.clientX, ev.clientY)
  ev.preventDefault()
}

function onPanePanPointerUp(_ev: PointerEvent) {
  finishPanePanDrag()
}

function onPanePanPointerCancel(_ev: PointerEvent) {
  finishPanePanDrag()
}

function onWindowPanePanPointerMove(ev: PointerEvent) {
  onPanePanPointerMove(ev)
}

function onWindowPanePanPointerUp(ev: PointerEvent) {
  onPanePanPointerUp(ev)
}

function onWindowPanePanPointerCancel(ev: PointerEvent) {
  onPanePanPointerCancel(ev)
}

function onPanePanMouseDown(ev: MouseEvent) {
  beginPanePanDrag(ev.button, ev.clientX, ev.clientY, ev.target)
}

function onWindowPanePanMouseMove(ev: MouseEvent) {
  applyPanePanDrag(ev.clientX, ev.clientY)
}

function onWindowPanePanMouseUp() {
  finishPanePanDrag()
}

function onGlobalPanePanMouseDown(ev: MouseEvent) {
  onPanePanMouseDown(ev)
}

function onGlobalWheel(ev: WheelEvent) {
  if (!verticalScrollChrome.value && !horizontalScrollChrome.value) return
  // Don't intercept wheel inside the rail controls themselves (they already .stop it).
  if (ev.target instanceof Element && ev.target.closest('.flow-v-scroll-rail, .flow-h-scroll-rail')) return
  // Only act on events that land on the flow canvas area.
  if (!(ev.target instanceof Element) || !ev.target.closest('.vue-flow__pane, .vue-flow__viewport, .vue-flow, .flow-wrap-shell')) return

  // Convert wheel delta to pixels (DOM deltaMode: 0=px, 1=line≈20px, 2=page≈300px).
  const lineSize = 20
  const pageSize = 300
  const factor = ev.deltaMode === 2 ? pageSize : ev.deltaMode === 1 ? lineSize : 1
  const dx = ev.deltaX * factor
  const dy = ev.deltaY * factor

  const current = viewport.value ?? { x: 0, y: 0, zoom: 1 }
  const x = clampViewportAxis(current.x - dx, 'x')
  const y = clampViewportAxis(current.y - dy, 'y')

  ev.preventDefault()
  void setViewport({ x, y, zoom: panBounds.zoom }, { duration: 0 })
  syncPanRailsFromViewportTransform({ x, y, zoom: panBounds.zoom })
}

onMounted(() => {
  if (typeof window === 'undefined') return
  window.addEventListener('mousedown', onGlobalPanePanMouseDown, true)
  window.addEventListener('wheel', onGlobalWheel, { capture: true, passive: false })
})

onUnmounted(() => {
  if (typeof window === 'undefined') return
  window.removeEventListener('mousedown', onGlobalPanePanMouseDown, true)
  window.removeEventListener('wheel', onGlobalWheel, true)
  finishPanePanDrag()
})

function onEdgeMouseEnter(ev: { edge: { id: string } }) {
  hoveredEdgeId.value = String(ev.edge.id)
}

function onEdgeMouseLeave(ev: { edge: { id: string } }) {
  if (hoveredEdgeId.value === String(ev.edge.id)) hoveredEdgeId.value = null
}

async function handleConnect(conn: Connection) {
  connectGestureFinishedOnTarget = true
  if (!conn.source || !conn.target) return

  const newEdge = {
    id: `e-${uid()}`,
    source: conn.source,
    target: conn.target,
    sourceHandle: conn.sourceHandle ?? AGG_SOURCE_HANDLE,
    targetHandle: conn.targetHandle ?? AGG_TARGET_HANDLE,
    label: 'depends on',
    labelStyle: dependencyEdgeLabelStyle(DEP_EDGE_STROKE),
    markerStart: undefined,
    markerEnd: dependencyMarker(DEP_EDGE_STROKE),
    style: dependencyEdgeStyle(DEP_EDGE_STROKE),
  }
  const combinedEdges = [...edges.value, newEdge]

  depthLayoutAnimate.value = true
  await nextTick()
  await doubleRaf()

  const vp = readFlowViewport()
  const laidOut = layoutDepthInViewport(nodes.value, combinedEdges, vp)
  const routedEdges = mergeEdgeHiddenForInvisibleEndpoints(
    routeSmoothstepEdgesInViewport(laidOut, combinedEdges, vp),
    laidOut,
    {
      hideEdgeForRelation: (e) => shouldHideEdgeForRelationFilter(e, props.relationTypeVisibility),
    },
  )
  const aligned = applyHandleAnchorAlignment(laidOut, routedEdges)

  /**
   * `nodes.value = …` (defineModel → parent ref → child v-model) does not always re-sync Vue Flow’s
   * internal node store when only positions change. `setNodes` writes directly to the store and
   * emits `update:nodes`, then `updateNodeInternals` recomputes handle bounds for the new geometry.
   */
  setNodes(aligned)
  setEdges(routedEdges)
  nodes.value = aligned
  edges.value = routedEdges
  await nextTick()
  updateNodeInternals()
  void nextTick(() => syncEdgeVisualState())

  window.setTimeout(() => {
    depthLayoutAnimate.value = false
  }, 520)

  emit(
    'status',
    `Linked ${conn.source} → ${conn.target} (depends on). Depth layout and edge routing updated.`,
  )
  await fitToViewport({ duration: 400 })
}

async function resetView() {
  await drillRef.value?.showFullGraph()
}

/** Clear drill/focus snapshot after structural doc replace; parent should call `fitToViewport` next. */
function resetNavigationAfterDocReplace() {
  resetVerticalScrollChrome()
  drillRef.value?.resetNavigationAfterDocReplace?.()
}

/**
 * Fit graph to the current pane after layout (does not clear layer drill).
 *
 * Camera rule: after a full document replace, use {@link resetNavigationAfterDocReplace} plus
 * one `fitToViewport` — do not chain `fitView` / `fitOverviewCamera` first (avoids a visible
 * zoom-out-then-correct). Vue Flow’s MiniMap uses a translucent viewport mask (`maskColor`);
 * the vertical rail slider follows that same transparent aesthetic.
 *
 * Stacking dojo: when {@link opts.recenterStackShrink} is **strictly** `true` (fewer top-level
 * packages than before), align the camera to the **top** of the laid-out bounds (`tyTop`) so the
 * first column stays pinned under the chrome; vertical-rail slider is set to `0` (top). Uses
 * `=== true` so incidental truthy values never trigger this path (breaks nesting dojo layout tests).
 */
async function fitToViewport(opts?: {
  duration?: number
  recenterStackShrink?: boolean
  /** When true, keep the current pan position inside updated pan rails (used after layer-drill-out). */
  preserveViewportPosition?: boolean
}) {
  await nextTick()
  await doubleRaf()
  const duration = opts?.duration ?? 220
  const vp = readFlowViewport()
  // Layer drill always takes priority — even a singleton package-scope root must not snap
  // the viewport to origin while a drill is active or pending (that causes the jump-to-right-bottom
  // bug in diagrams like animal-fruit that have one root group with packageScope: true).
  if (layerDrillBusy()) {
    // When only pending (click timer started, drill not yet active), hold the camera steady.
    if (!layerDrillActive()) return
    resetVerticalScrollChrome()
    const visibleRoots = nodes.value.filter((n) => !n.parentNode && !(n as { hidden?: boolean }).hidden)
    if (!visibleRoots.length) {
      await setViewport({ x: 0, y: 0, zoom: 1 }, { duration })
      return
    }
    const rect = getRectOfNodes(visibleRoots as any)
    if (
      !Number.isFinite(rect.width) ||
      rect.width <= 2 ||
      !Number.isFinite(rect.height) ||
      rect.height <= 2 ||
      !Number.isFinite(rect.x) ||
      !Number.isFinite(rect.y)
    ) {
      await setViewport({ x: 0, y: 0, zoom: 1 }, { duration })
      return
    }
    const x = vp.width / 2 - (rect.x + rect.width / 2)
    const y = vp.height / 2 - (rect.y + rect.height / 2)
    await setViewport({ x, y, zoom: 1 }, { duration })
    return
  }

  if (hasSingletonRootPackageScopeOverview()) {
    await fitOverviewSingletonPackageScope(duration)
    return
  }

  const roots = nodes.value.filter((n) => !n.parentNode && !(n as { hidden?: boolean }).hidden)
  if (!roots.length) {
    resetVerticalScrollChrome()
    await fitView({ padding: 0.05, duration, maxZoom: 2.2, minZoom: 0.05 })
    return
  }

  const rect = getRectOfNodes(roots as any)
  if (
    !Number.isFinite(rect.width) ||
    rect.width <= 2 ||
    !Number.isFinite(rect.height) ||
    rect.height <= 2 ||
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y)
  ) {
    resetVerticalScrollChrome()
    await fitView({ padding: 0.05, duration, maxZoom: 2.2, minZoom: 0.05 })
    return
  }

  const pad = 0.05
  const px = vp.width * pad * 2
  const py = vp.height * pad * 2
  const usableW = Math.max(80, vp.width - px)
  const usableH = Math.max(80, vp.height - py)
  const widthOverflow = rect.width > usableW + PAN_RAIL_FIT_SLACK_PX
  const heightOverflow = rect.height > usableH + PAN_RAIL_FIT_SLACK_PX
  const visibleNodes = nodes.value.filter((n) => !(n as { hidden?: boolean }).hidden)
  const heightMinReached = visibleNodes.some((node) => nodePixelHeight(node) <= nodeMinHeight(node) + 1)
  const useHorizontalPanRail = widthOverflow
  const useVerticalPanRail = heightOverflow && heightMinReached

  const zoom = 1
  const txLeft = vp.width * pad - rect.x * zoom
  const txRight = vp.width * (1 - pad) - (rect.x + rect.width) * zoom
  const tyTop = vp.height * pad - rect.y * zoom
  const tyBot = vp.height * (1 - pad) - (rect.y + rect.height) * zoom
  const xMax = Math.max(txLeft, txRight)
  const xMin = Math.min(txLeft, txRight)
  const yMax = Math.max(tyTop, tyBot)
  const yMin = Math.min(tyTop, tyBot)
  // (xMin+xMax)/2 == txCenter and (yMin+yMax)/2 == tyCenter — always, regardless of overflow.
  const txCenter = (xMin + xMax) / 2
  const tyCenter = (yMin + yMax) / 2
  const stackShrinkRecenter = opts?.recenterStackShrink === true

  const preserveViewportPosition = opts?.preserveViewportPosition === true

  if (!useHorizontalPanRail && !useVerticalPanRail) {
    resetVerticalScrollChrome()
    if (preserveViewportPosition) {
      const cur = viewport.value ?? { x: 0, y: 0, zoom: 1 }
      await setViewport({ x: cur.x, y: cur.y, zoom: cur.zoom }, { duration })
      return
    }
    await setViewport({ x: txCenter, y: tyCenter, zoom: 1 }, { duration })
    return
  }

  // Clamp the current viewport position to the new pan bounds so panning activating does not
  // cause a visible slip: when the diagram was centered, its position is already inside the
  // pan range, so the clamped value equals the centered position → no jump.
  const curVp = viewport.value ?? { x: 0, y: 0, zoom: 1 }
  const startX = Math.min(xMax, Math.max(xMin, curVp.x))
  const startY = Math.min(yMax, Math.max(yMin, curVp.y))
  const hSpan = xMax - xMin
  const vSpan = yMax - yMin
  const hSlider = hSpan > 0.5 ? Math.round(1000 * (xMax - startX) / hSpan) : 0
  const vSlider = vSpan > 0.5 ? Math.round(1000 * (yMax - startY) / vSpan) : 0

  panBounds = { xMin, xMax, yMin, yMax, zoom }
  horizontalScrollChrome.value = useHorizontalPanRail
  verticalScrollChrome.value = useVerticalPanRail
  horizontalScrollSlider.value = preserveViewportPosition ? hSlider : stackShrinkRecenter ? 500 : hSlider
  verticalScrollSlider.value = preserveViewportPosition ? vSlider : stackShrinkRecenter ? 0 : vSlider
  // Thumb size = fraction of diagram visible at once in each axis.
  verticalThumbFraction.value = vSpan > 0 ? vp.height / (vp.height + vSpan) : 1
  horizontalThumbFraction.value = hSpan > 0 ? vp.width / (vp.width + hSpan) : 1

  setTranslateExtent(translateExtentForPan(xMin, xMax, yMin, yMax))
  const finalX = stackShrinkRecenter ? txCenter : startX
  const finalY = stackShrinkRecenter ? tyTop : startY
  // Non-panning axis always centers; panning axis uses preserved (or recentered) position.
  const xViewport = preserveViewportPosition
    ? useHorizontalPanRail
      ? startX
      : txCenter
    : useHorizontalPanRail
      ? finalX
      : txCenter
  const yViewport = preserveViewportPosition
    ? useVerticalPanRail
      ? startY
      : tyCenter
    : stackShrinkRecenter
      ? tyTop
      : useVerticalPanRail
        ? finalY
        : tyCenter
  await setViewport({ x: xViewport, y: yViewport, zoom }, { duration })
}

function onVerticalScrollSliderInput(ev: Event) {
  if (!verticalScrollChrome.value) return
  const el = ev.target as HTMLInputElement | null
  if (!el) return
  const v = Number(el.value)
  verticalScrollSlider.value = Number.isFinite(v) ? Math.round(v) : 0
  const span = panBounds.yMin - panBounds.yMax
  if (!Number.isFinite(span) || Math.abs(span) < 1e-4) return
  const t = verticalScrollSlider.value / 1000
  const y = Math.min(panBounds.yMax, Math.max(panBounds.yMin, panBounds.yMax + t * span))
  verticalSliderSync = true
  void setViewport({ x: panBounds.xMax + (horizontalScrollSlider.value / 1000) * (panBounds.xMin - panBounds.xMax), y, zoom: panBounds.zoom }, { duration: 0 }).finally(() => {
    verticalSliderSync = false
  })
}

function onHorizontalScrollSliderInput(ev: Event) {
  if (!horizontalScrollChrome.value) return
  const el = ev.target as HTMLInputElement | null
  if (!el) return
  const v = Number(el.value)
  horizontalScrollSlider.value = Number.isFinite(v) ? Math.round(v) : 0
  const span = panBounds.xMin - panBounds.xMax
  if (!Number.isFinite(span) || Math.abs(span) < 1e-4) return
  const t = horizontalScrollSlider.value / 1000
  const x = Math.min(panBounds.xMax, Math.max(panBounds.xMin, panBounds.xMax + t * span))
  horizontalSliderSync = true
  void setViewport({ x, y: panBounds.yMax + (verticalScrollSlider.value / 1000) * (panBounds.yMin - panBounds.yMax), zoom: panBounds.zoom }, { duration: 0 }).finally(() => {
    horizontalSliderSync = false
  })
}

function onFlowMoveEnd(ev: unknown) {
  const ft = (ev as { flowTransform?: { x: number; y: number; zoom: number } } | null)?.flowTransform
  if (!ft) return
  syncPanRailsFromViewportTransform(ft)
}

defineExpose({
  resetView,
  resetNavigationAfterDocReplace,
  fitToViewport,
  relayoutViewport,
  refreshEdgeEmphasis: syncEdgeVisualState,
  layerDrillBusy,
})
</script>

<template>
  <DiagramContainerView :model="diagramModel" class="diagram-root-wrap">
    <div
      class="flow-wrap-shell"
      :class="{
        'flow-wrap-shell--vscroll': verticalScrollChrome,
        'flow-wrap-shell--hscroll': horizontalScrollChrome,
      }"
      @mousedown.capture="onPanePanMouseDown"
      @pointerdown.capture="onPanePanPointerDown"
      @pointermove.capture="onPanePanPointerMove"
      @pointerup.capture="onPanePanPointerUp"
      @pointercancel.capture="onPanePanPointerCancel"
    >
      <VueFlow
        :id="WORKSPACE_FLOW_ID"
        v-model:nodes="nodes"
        v-model:edges="edges"
        :class="['flow', { 'tg-depth-layout-animate': depthLayoutAnimate }]"
        :node-types="nodeTypes"
        :default-edge-options="defaultEdgeOptions"
        :connection-mode="ConnectionMode.Strict"
        :nodes-draggable="false"
        :nodes-connectable="true"
        :edges-updatable="false"
        :edges-focusable="true"
        :snap-to-grid="true"
        :snap-grid="[12, 12]"
        :min-zoom="0.05"
        :max-zoom="2.2"
        :zoom-on-scroll="false"
        :zoom-on-pinch="false"
        :zoom-on-double-click="false"
        :pan-on-drag="false"
        :pan-on-scroll="false"
        :pan-on-scroll-mode="PanOnScrollMode.Vertical"
        delete-key-code="Delete"
        @connect="handleConnect"
        @connect-start="onConnectStart"
        @connect-end="onVueFlowConnectEnd"
        @node-mouse-enter="onNodeMouseEnter"
        @node-mouse-leave="onNodeMouseLeave"
        @edge-mouse-enter="onEdgeMouseEnter"
        @edge-mouse-leave="onEdgeMouseLeave"
        @pane-click="onPaneClickClearHover"
        @move="onFlowMoveEnd"
        @move-end="onFlowMoveEnd"
      >
        <GraphDrillIn ref="drillRef" />
        <Background pattern-color="#e2e8f0" :gap="18" />
      </VueFlow>
      <aside
        v-if="verticalScrollChrome"
        class="flow-v-scroll-rail"
        aria-label="Vertical diagram scroll"
        @pointerdown.stop
        @wheel.stop
      >
        <input
          class="flow-v-scroll-rail__slider"
          type="range"
          min="0"
          max="1000"
          :value="verticalScrollSlider"
          aria-valuemin="0"
          aria-valuemax="1000"
          :aria-valuenow="verticalScrollSlider"
          aria-orientation="vertical"
          title="Scroll vertically"
          @input="onVerticalScrollSliderInput"
        />
        <div class="flow-v-scroll-rail__thumb" :style="verticalScrollThumbStyle" aria-hidden="true" />
      </aside>
      <aside
        v-if="horizontalScrollChrome"
        class="flow-h-scroll-rail"
        aria-label="Horizontal diagram scroll"
        @pointerdown.stop
        @wheel.stop
      >
        <input
          class="flow-h-scroll-rail__slider"
          type="range"
          min="0"
          max="1000"
          :value="horizontalScrollSlider"
          aria-valuemin="0"
          aria-valuemax="1000"
          :aria-valuenow="horizontalScrollSlider"
          title="Scroll horizontally"
          @input="onHorizontalScrollSliderInput"
        />
        <div class="flow-h-scroll-rail__thumb" :style="horizontalScrollThumbStyle" aria-hidden="true" />
      </aside>
    </div>
  </DiagramContainerView>
</template>

<style scoped>
.diagram-root-wrap {
  width: 100%;
  height: 100%;
}
.flow-wrap-shell {
  position: relative;
  width: 100%;
  height: 100%;
}
.flow-wrap-shell--vscroll .flow {
  width: calc(100% - 32px);
  height: 100%;
}
.flow-wrap-shell--hscroll .flow {
  width: 100%;
  height: calc(100% - 32px);
}
.flow-wrap-shell--vscroll.flow-wrap-shell--hscroll .flow {
  width: calc(100% - 32px);
  height: calc(100% - 32px);
}
.flow {
  width: 100%;
  height: 100%;
}
.flow-v-scroll-rail {
  position: absolute;
  top: 40px;
  right: 4px;
  bottom: 12px;
  width: 28px;
  z-index: 24;
  display: flex;
  align-items: stretch;
  justify-content: center;
  pointer-events: auto;
}
.flow-v-scroll-rail::before {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  width: 4px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.06);
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.08);
}
.flow-v-scroll-rail:hover::before {
  background: rgba(148, 163, 184, 0.12);
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.16);
}
.flow-wrap-shell--hscroll .flow-v-scroll-rail {
  bottom: 36px;
}
/**
 * Translucent rail in the spirit of Vue Flow MiniMap `maskColor` / `maskStrokeColor`
 * (see https://vueflow.dev/guide/components/minimap.html).
 */
.flow-v-scroll-rail__slider {
  -webkit-appearance: none;
  appearance: none;
  width: 24px;
  min-height: 120px;
  margin: 0;
  cursor: grab;
  background: transparent;
  accent-color: transparent;
  writing-mode: vertical-lr;
  position: relative;
  z-index: 2;
  opacity: 0;
}
.flow-v-scroll-rail__slider::-webkit-slider-runnable-track {
  background: transparent;
}
.flow-v-scroll-rail__slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  background: transparent;
  border: 0;
  box-shadow: none;
}
.flow-v-scroll-rail__slider::-moz-range-track {
  background: transparent;
}
.flow-v-scroll-rail__slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  background: transparent;
  border: 0;
  box-shadow: none;
}
.flow-v-scroll-rail__thumb {
  position: absolute;
  left: 50%;
  width: 6px;
  /* height is set via inline style as a % of the rail to reflect visible fraction */
  min-height: 20px;
  margin-left: -3px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.12);
  border: 1px solid rgba(59, 130, 246, 0.22);
  box-shadow: none;
  pointer-events: none;
  z-index: 1;
  box-sizing: border-box;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.flow-v-scroll-rail:hover .flow-v-scroll-rail__thumb {
  background: rgba(59, 130, 246, 0.22);
  border-color: rgba(59, 130, 246, 0.40);
}
.flow-h-scroll-rail {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 4px;
  height: 28px;
  z-index: 24;
  display: flex;
  align-items: center;
  justify-content: stretch;
  pointer-events: auto;
}
.flow-h-scroll-rail::before {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  height: 4px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.06);
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.08);
}
.flow-h-scroll-rail:hover::before {
  background: rgba(148, 163, 184, 0.12);
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.16);
}
.flow-wrap-shell--vscroll .flow-h-scroll-rail {
  right: 36px;
}
.flow-h-scroll-rail__slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 24px;
  min-width: 120px;
  margin: 0;
  cursor: grab;
  background: transparent;
  accent-color: transparent;
  position: relative;
  z-index: 2;
  opacity: 0;
}
.flow-h-scroll-rail__slider::-webkit-slider-runnable-track {
  background: transparent;
}
.flow-h-scroll-rail__slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  background: transparent;
  border: 0;
  box-shadow: none;
}
.flow-h-scroll-rail__slider::-moz-range-track {
  background: transparent;
}
.flow-h-scroll-rail__slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  background: transparent;
  border: 0;
  box-shadow: none;
}
.flow-h-scroll-rail__thumb {
  position: absolute;
  top: 50%;
  /* width is set via inline style as a % of the rail to reflect visible fraction */
  min-width: 20px;
  height: 6px;
  margin-top: -3px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.12);
  border: 1px solid rgba(59, 130, 246, 0.22);
  box-shadow: none;
  pointer-events: none;
  z-index: 1;
  box-sizing: border-box;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.flow-h-scroll-rail:hover .flow-h-scroll-rail__thumb {
  background: rgba(59, 130, 246, 0.22);
  border-color: rgba(59, 130, 246, 0.40);
}
</style>

<style>
/* Promote the pan/zoom pane to its own compositor layer — avoids repaints on every frame. */
.vue-flow__transformationpane {
  will-change: transform;
}

/* Promote individual nodes only while they are being animated (layout or FLIP).
   Unconditional will-change on all nodes would waste GPU memory at rest. */
.flow.tg-depth-layout-animate .vue-flow__node,
.flow.tg-layer-flip-animate .vue-flow__node {
  will-change: transform;
}

/* Smooth node bounds (layer drill + layout) and dimming */
.vue-flow__node {
  transition:
    width 0.45s cubic-bezier(0.4, 0, 0.2, 1),
    height 0.45s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.35s ease;
}

/* During FLIP, inner shell owns translation; outer node still animates width/height for real reflow. */
.flow.tg-layer-flip-animate .vue-flow__node {
  transition:
    width 0.48s cubic-bezier(0.4, 0, 0.2, 1),
    height 0.48s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.35s ease;
}

/* New dependency edge: animate nodes into updated depth columns (transform is viewport space in Vue Flow). */
.flow.tg-depth-layout-animate:not(.tg-layer-flip-animate) .vue-flow__node {
  transition:
    transform 0.48s cubic-bezier(0.4, 0, 0.2, 1),
    width 0.48s cubic-bezier(0.4, 0, 0.2, 1),
    height 0.48s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.35s ease;
}
.vue-flow__edge path,
.vue-flow__edge .vue-flow__edge-text {
  transition:
    opacity 0.35s ease,
    stroke-width 0.15s ease;
}

/* Edge path: square caps (no round “dots” at terminals); weight + emphasis below. */
.flow.vue-flow .vue-flow__edge .vue-flow__edge-path {
  stroke-linecap: butt !important;
  stroke-linejoin: miter !important;
  stroke-width: 1.35 !important;
}

.flow.vue-flow .vue-flow__edge.tg-edge-emph .vue-flow__edge-path {
  stroke-width: 2.75 !important;
}

.flow.vue-flow .vue-flow__edge.tg-edge-emph .vue-flow__edge-text {
  opacity: 1;
  font-weight: 600;
}

/* Core marks edges `.inactive` unless selectable or @edge-click; re-enable hits so @edge-mouse-* runs (pan is off). */
.flow.vue-flow .vue-flow__edge.inactive {
  pointer-events: all;
}

/* @vue-flow/core always renders a label rect with theme fill; hide it for caption-only labels. */
.flow.vue-flow .vue-flow__edge-textbg {
  display: none;
}

.vue-flow__node.tg-dimmed {
  opacity: 0.4;
  pointer-events: none;
}

/* Relation-colored circular anchors on the module/group outline (not edge geometry). */
.flow.vue-flow .vue-flow__handle.tg-handle-anchor {
  pointer-events: all !important;
  z-index: 30 !important;
  border-radius: 50% !important;
  width: 10px !important;
  min-width: 10px !important;
  height: 10px !important;
  min-height: 10px !important;
  background: var(--tg-handle-stroke, #64748b) !important;
  border: 1.5px solid color-mix(in srgb, var(--tg-handle-stroke, #64748b) 72%, #0f172a) !important;
  box-sizing: border-box !important;
  transition:
    box-shadow 0.15s ease,
    filter 0.15s ease;
}

.flow.vue-flow .vue-flow__handle.tg-handle-anchor:hover {
  filter: brightness(1.08);
  box-shadow:
    0 0 0 2px rgba(255, 255, 255, 0.96),
    0 0 0 5px color-mix(in srgb, var(--tg-handle-stroke, #64748b) 48%, transparent);
}

.vue-flow__node.tg-dimmed .vue-flow__handle.tg-handle-anchor {
  opacity: 0.42;
  box-shadow: none !important;
  filter: none !important;
}

.vue-flow__edge.tg-dimmed path {
  opacity: 0.35 !important;
}
.vue-flow__edge.tg-dimmed .vue-flow__edge-text {
  opacity: 0.45;
}
</style>
