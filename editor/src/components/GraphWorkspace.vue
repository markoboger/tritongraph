<script setup lang="ts">
import {
  ConnectionMode,
  VueFlow,
  type Connection,
  type NodeTypesObject,
  useVueFlow,
} from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { computed, nextTick, provide, reactive, ref, watch } from 'vue'
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

const nodes = defineModel<any[]>('nodes', { required: true })
const edges = defineModel<any[]>('edges', { required: true })

const props = defineProps<{
  nodeTypes: NodeTypesObject
  /** When a key is `false`, edges with that relation label are hidden (merged into `hidden`). */
  relationTypeVisibility?: Record<string, boolean>
}>()

const { fitView } = useVueFlow()
const drillRef = ref<InstanceType<typeof GraphDrillIn> | null>(null)

const hoveredNodeId = ref<string | null>(null)
/** When set, only this edge is stroke-emphasized (takes precedence over node-hover). */
const hoveredEdgeId = ref<string | null>(null)

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

    const endHidden = hiddenIds.has(String(e.source)) || hiddenIds.has(String(e.target))
    const relHidden = shouldHideEdgeForRelationFilter(e, props.relationTypeVisibility)
    const incident = !!(hid && (String(e.source) === hid || String(e.target) === hid))
    const newHidden = endHidden || (relHidden && !incident)

    const prevH = (e as { hidden?: boolean }).hidden === true
    const prevC = (e as { class?: string }).class
    if (newClass === prevC && newHidden === prevH) return e
    return { ...e, class: newClass, hidden: newHidden }
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

async function relayoutViewport() {
  if (!nodes.value.length) return
  await nextTick()
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
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
}

provide('tritonRelayoutViewport', relayoutViewport)

/** Re-run depth layout after layer drill-out so snapshot geometry does not shrink pinned modules. */
provide('tritonAfterLayerDrillOut', relayoutViewport)

const defaultEdgeOptions = {
  type: 'smoothstep' as const,
  style: dependencyEdgeStyle(DEP_EDGE_STROKE),
  markerStart: undefined,
  markerEnd: dependencyMarker(DEP_EDGE_STROKE),
  sourceHandle: AGG_SOURCE_HANDLE,
  targetHandle: AGG_TARGET_HANDLE,
  labelStyle: dependencyEdgeLabelStyle(),
}

function uid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(16).slice(2)}`
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

function handleConnect(conn: Connection) {
  if (!conn.source || !conn.target) return
  const next = [
    ...edges.value,
    {
      id: `e-${uid()}`,
      source: conn.source,
      target: conn.target,
      sourceHandle: conn.sourceHandle ?? AGG_SOURCE_HANDLE,
      targetHandle: conn.targetHandle ?? AGG_TARGET_HANDLE,
      label: 'depends on',
      labelStyle: dependencyEdgeLabelStyle(),
      markerStart: undefined,
      markerEnd: dependencyMarker(DEP_EDGE_STROKE),
      style: dependencyEdgeStyle(DEP_EDGE_STROKE),
    },
  ]
  edges.value = mergeEdgeHiddenForInvisibleEndpoints(next, nodes.value, {
    hideEdgeForRelation: (e) => shouldHideEdgeForRelationFilter(e, props.relationTypeVisibility),
  })
  nodes.value = applyHandleAnchorAlignment(nodes.value, edges.value)
  void nextTick(() => syncEdgeVisualState())
  void fitToViewport()
}

function onNodeDoubleClick(ev: { node: { id: string; data?: Record<string, unknown> } }) {
  const n = ev.node
  if (n.data?.label === undefined && n.data?.subtitle === undefined) return
  const label = window.prompt('Module name (resource `name` in Ilograph)', String(n.data?.label ?? ''))
  if (label === null) return
  const subtitle = window.prompt('Subtitle (e.g. sbt project id)', String(n.data?.subtitle ?? ''))
  if (subtitle === null) return
  nodes.value = nodes.value.map((x) =>
    x.id === n.id ? { ...x, data: { ...x.data, label, subtitle } } : x,
  )
}

async function resetView() {
  await drillRef.value?.showFullGraph()
}

/** Fit graph to the current pane after layout (does not clear layer drill). */
async function fitToViewport() {
  await nextTick()
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
  await fitView({ padding: 0.05, duration: 220, maxZoom: 2.2, minZoom: 0.05 })
}

defineExpose({ resetView, fitToViewport, refreshEdgeEmphasis: syncEdgeVisualState })
</script>

<template>
  <DiagramContainerView :model="diagramModel" class="diagram-root-wrap">
    <VueFlow
      v-model:nodes="nodes"
      v-model:edges="edges"
      class="flow"
      :node-types="nodeTypes"
    :default-edge-options="defaultEdgeOptions"
    :connection-mode="ConnectionMode.Strict"
    :nodes-draggable="false"
    :nodes-connectable="true"
    :edges-updatable="false"
    :edges-focusable="false"
    :snap-to-grid="true"
    :snap-grid="[12, 12]"
    :min-zoom="0.05"
    :max-zoom="2.2"
    :zoom-on-scroll="false"
    :zoom-on-pinch="false"
    :zoom-on-double-click="false"
    :pan-on-drag="false"
    :pan-on-scroll="false"
    delete-key-code="Delete"
    @connect="handleConnect"
    @node-double-click="onNodeDoubleClick"
    @node-mouse-enter="onNodeMouseEnter"
    @node-mouse-leave="onNodeMouseLeave"
    @edge-mouse-enter="onEdgeMouseEnter"
    @edge-mouse-leave="onEdgeMouseLeave"
    @pane-click="onPaneClickClearHover"
  >
      <GraphDrillIn ref="drillRef" />
      <Background pattern-color="#e2e8f0" :gap="18" />
    </VueFlow>
  </DiagramContainerView>
</template>

<style scoped>
.diagram-root-wrap {
  width: 100%;
  height: 100%;
}
.flow {
  width: 100%;
  height: 100%;
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

/* During FLIP, inner graph node owns transform; suppress outer w/h tween to avoid double motion. */
.flow.tg-layer-flip-animate .vue-flow__node {
  transition: opacity 0.35s ease;
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
  opacity: 0.85;
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
