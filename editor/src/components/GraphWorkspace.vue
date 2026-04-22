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
import { computed, nextTick, provide, reactive, ref, unref, watch } from 'vue'
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

/** Root-level stacked package-scope groups beyond this use width-fit zoom + vertical pan rail. */
const VERTICAL_SCROLL_PACKAGE_STACK_MIN = 18
/** Also enable vertical pan when fitting height would force zoom below this (width still allows more zoom). */
const VERTICAL_SCROLL_MAX_ZOOM_HEIGHT_FIT = 0.88

const MODULE_LAYOUT_W = 200
const MODULE_LAYOUT_H = 72

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
} = useVueFlow(WORKSPACE_FLOW_ID)

/** Default: pan is unconstrained (see Vue Flow store initial `translateExtent`). */
const UNBOUNDED_TRANSLATE_EXTENT: CoordinateExtent = [
  [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
]
const drillRef = ref<InstanceType<typeof GraphDrillIn> | null>(null)

const verticalScrollChrome = ref(false)
/** 0 = show top of graph, 1000 = show bottom — only meaningful when {@link verticalScrollChrome}. */
const verticalScrollSlider = ref(0)
let vPan: { x: number; yMin: number; yMax: number; zoom: number } = { x: 0, yMin: 0, yMax: 0, zoom: 1 }
let verticalSliderSync = false

function countTopLevelPackageScopeGroups(arr: readonly any[]): number {
  let c = 0
  for (const n of arr) {
    if (n.parentNode) continue
    if ((n as { hidden?: boolean }).hidden) continue
    if (String(n.type ?? '') !== 'group') continue
    const d = n.data as Record<string, unknown> | undefined
    if (d?.packageScope === true) c++
  }
  return c
}

function layerDrillActive(): boolean {
  const raw = (drillRef.value as { layerDrillId?: unknown } | null)?.layerDrillId
  return !!unref(raw)
}

function resetVerticalScrollChrome(): void {
  verticalScrollChrome.value = false
  verticalScrollSlider.value = 0
  setTranslateExtent(UNBOUNDED_TRANSLATE_EXTENT)
}

/**
 * Limit viewport pan so the user cannot scroll past the padded diagram bounds (Vue Flow
 * `translateExtent` clamps `setViewport` / wheel-pan the same way `transformViewport` does).
 */
function translateExtentForVerticalPan(x: number, yMin: number, yMax: number): CoordinateExtent {
  return [
    [-x, -yMax],
    [-x, -yMin],
  ]
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

function edgeVisualSignature(arr: typeof edges.value): string {
  return arr
    .map(
      (e) =>
        `${String(e.id)}:${(e as { hidden?: boolean }).hidden === true ? 1 : 0}:${(e as { class?: string }).class ?? ''}`,
    )
    .join('\n')
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
      return {
        ...n,
        hidden: baseHidden,
        data,
      }
    }

    const shouldHide = !visibleIds.has(String(n.id))
    return {
      ...n,
      hidden: baseHidden || shouldHide,
      data: {
        ...data,
        __packageRelationFocusManaged: true,
        __packageRelationFocusBaseHidden: baseHidden,
      },
    }
  })

  const prevSig = nodes.value.map((n) => `${String(n.id)}:${Boolean(n.hidden) ? 1 : 0}`).join('|')
  const nextSig = nextNodes.map((n) => `${String(n.id)}:${Boolean(n.hidden) ? 1 : 0}`).join('|')
  if (prevSig === nextSig) return false
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
    return { ...e, class: newClass, hidden: newHidden, zIndex: newZIndex, labelStyle: newLabelStyle }
  })
  if (edgeVisualSignature(next) === edgeVisualSignature(edges.value)) return
  edges.value = next
}

watch([hoveredNodeId, hoveredEdgeId], () => void nextTick(() => syncEdgeVisualState()))

watch(
  () => props.relationTypeVisibility,
  () => void nextTick(() => syncEdgeVisualState()),
  { deep: true },
)

watch(
  () =>
    nodes.value
      .map((n) => `${String((n as { id: string }).id)}:${(n as { hidden?: boolean }).hidden === true ? 1 : 0}`)
      .join('|'),
  () => void nextTick(() => syncEdgeVisualState()),
)

watch(
  () =>
    nodes.value
      .map((n) => {
        const d = (n.data ?? {}) as Record<string, unknown>
        const focus = typeof d.innerArtefactFocusId === 'string' ? d.innerArtefactFocusId : ''
        const innerArts = Array.isArray(d.innerArtefacts) ? d.innerArtefacts.length : 0
        const cross = Array.isArray(d.crossArtefactRelations) ? d.crossArtefactRelations.length : 0
        const inner = Array.isArray(d.innerArtefactRelations) ? d.innerArtefactRelations.length : 0
        return `${String(n.id)}:${focus}:${innerArts}:${cross}:${inner}`
      })
      .join('|'),
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

provide('tritonRefreshDimming', () => {
  drillRef.value?.refreshDimming?.()
})

function readFlowViewport(): { width: number; height: number } {
  const el = document.querySelector('.flow-wrap')
  const r = el?.getBoundingClientRect()
  return {
    width: Math.max(200, r?.width ?? 960),
    height: Math.max(200, r?.height ?? 720),
  }
}

const diagramModel = computed(() => {
  const vp = readFlowViewport()
  return buildDiagramRootModel(nodes.value, edges.value, { x: 0, y: 0, width: vp.width, height: vp.height })
})

async function relayoutViewport(opts?: { skipDrillReapply?: boolean }) {
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
  /** Keep the full graph in view after geometry changes; skip while layer drill owns the camera. */
  const layerDrill = drillRef.value && 'layerDrillId' in drillRef.value ? (drillRef.value as any).layerDrillId : null
  if (!unref(layerDrill)) {
    if (hasSingletonRootPackageScopeOverview()) {
      await fitOverviewSingletonPackageScope(0)
    } else {
      await fitToViewport({ duration: 0 })
    }
  }
}

provide('tritonRelayoutViewport', relayoutViewport)

/** Re-run depth layout after layer drill-out so snapshot geometry does not shrink pinned modules. */
provide('tritonAfterLayerDrillOut', relayoutViewport)

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
 * Stacking dojo: when {@link opts.recenterStackShrink} is set (fewer top-level packages than
 * before), re-center the camera — vertical-rail mode uses the middle of the allowed y-range;
 * non-rail mode uses a slightly roomier `fitView` padding so the graph is not left offset.
 */
async function fitToViewport(opts?: { duration?: number; recenterStackShrink?: boolean }) {
  await nextTick()
  await doubleRaf()
  const duration = opts?.duration ?? 220
  if (hasSingletonRootPackageScopeOverview()) {
    await fitOverviewSingletonPackageScope(duration)
    return
  }
  if (layerDrillActive()) {
    resetVerticalScrollChrome()
    await fitView({ padding: 0.05, duration, maxZoom: 2.2, minZoom: 0.05 })
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

  const vp = readFlowViewport()
  const pad = 0.05
  const px = vp.width * pad * 2
  const py = vp.height * pad * 2
  const usableW = Math.max(80, vp.width - px)
  const usableH = Math.max(80, vp.height - py)
  const zoomW = usableW / rect.width
  const zoomH = usableH / rect.height
  const manyPk = countTopLevelPackageScopeGroups(nodes.value)
  const heightBound = zoomH < zoomW - 1e-6
  const wouldSquashZoom = zoomH < VERTICAL_SCROLL_MAX_ZOOM_HEIGHT_FIT
  const useVerticalPanRail =
    (heightBound && wouldSquashZoom) || manyPk >= VERTICAL_SCROLL_PACKAGE_STACK_MIN

  if (!useVerticalPanRail) {
    resetVerticalScrollChrome()
    /**
     * After packages are removed from the stacking dojo, re-fit from defaults so the camera
     * does not inherit a stale pan offset from the wider/taller graph.
     */
    await fitView({
      padding: opts?.recenterStackShrink ? 0.08 : 0.05,
      duration,
      maxZoom: 2.2,
      minZoom: 0.05,
    })
    return
  }

  const zoom = Math.min(2.2, Math.max(0.05, zoomW))
  const cx = rect.x + rect.width / 2
  const x = vp.width / 2 - cx * zoom
  const tyTop = vp.height * pad - rect.y * zoom
  const tyBot = vp.height * (1 - pad) - (rect.y + rect.height) * zoom
  const yMax = Math.max(tyTop, tyBot)
  const yMin = Math.min(tyTop, tyBot)
  /** Fewer stacked packages → re-center vertically in the pan band (mid-scroll), not top-pinned. */
  const yStart = opts?.recenterStackShrink ? (yMin + yMax) / 2 : yMax

  vPan = { x, yMin, yMax, zoom }
  verticalScrollChrome.value = true
  verticalScrollSlider.value = opts?.recenterStackShrink ? 500 : 0

  setTranslateExtent(translateExtentForVerticalPan(x, yMin, yMax))
  await setViewport({ x, y: yStart, zoom }, { duration })
}

function onVerticalScrollSliderInput(ev: Event) {
  if (!verticalScrollChrome.value) return
  const el = ev.target as HTMLInputElement | null
  if (!el) return
  const v = Number(el.value)
  verticalScrollSlider.value = Number.isFinite(v) ? Math.round(v) : 0
  const span = vPan.yMin - vPan.yMax
  if (!Number.isFinite(span) || Math.abs(span) < 1e-4) return
  const t = verticalScrollSlider.value / 1000
  const y = Math.min(vPan.yMax, Math.max(vPan.yMin, vPan.yMax + t * span))
  verticalSliderSync = true
  void setViewport({ x: vPan.x, y, zoom: vPan.zoom }, { duration: 0 }).finally(() => {
    verticalSliderSync = false
  })
}

function onFlowMoveEnd(ev: unknown) {
  if (!verticalScrollChrome.value || verticalSliderSync) return
  const ft = (ev as { flowTransform?: { x: number; y: number; zoom: number } } | null)?.flowTransform
  if (!ft) return
  const { x, y, zoom } = ft
  if (Math.abs(zoom - vPan.zoom) > 0.02) return
  vPan.x = x
  const span = vPan.yMin - vPan.yMax
  if (!Number.isFinite(span) || Math.abs(span) < 1e-4) return
  const t = (y - vPan.yMax) / span
  verticalScrollSlider.value = Math.round(Math.max(0, Math.min(1000, t * 1000)))
}

defineExpose({
  resetView,
  resetNavigationAfterDocReplace,
  fitToViewport,
  relayoutViewport,
  refreshEdgeEmphasis: syncEdgeVisualState,
})
</script>

<template>
  <DiagramContainerView :model="diagramModel" class="diagram-root-wrap">
    <div class="flow-wrap-shell" :class="{ 'flow-wrap-shell--vscroll': verticalScrollChrome }">
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
        :pan-on-scroll="verticalScrollChrome"
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
  direction: rtl;
}
.flow-v-scroll-rail__slider::-webkit-slider-runnable-track {
  width: 5px;
  margin-inline: auto;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.2);
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.28);
}
.flow-v-scroll-rail__slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 13px;
  height: 13px;
  margin-inline-start: -4px;
  border-radius: 50%;
  cursor: grab;
  background: rgba(59, 130, 246, 0.32);
  border: 2px solid rgba(59, 130, 246, 0.55);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.12);
}
.flow-v-scroll-rail__slider::-moz-range-track {
  width: 5px;
  height: 100%;
  margin-inline: auto;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.2);
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.28);
}
.flow-v-scroll-rail__slider::-moz-range-thumb {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  cursor: grab;
  border: 2px solid rgba(59, 130, 246, 0.55);
  background: rgba(59, 130, 246, 0.32);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.12);
}
</style>

<style>
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
