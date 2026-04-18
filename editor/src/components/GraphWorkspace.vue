<script setup lang="ts">
import {
  ConnectionMode,
  VueFlow,
  type Connection,
  type NodeTypesObject,
  useVueFlow,
} from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { computed, nextTick, provide, reactive, ref } from 'vue'
import DiagramContainerView from './diagram/DiagramContainerView.vue'
import GraphDrillIn from './GraphDrillIn.vue'
import { buildDiagramRootModel } from '../diagram/model/buildRootDiagram'
import {
  dependencyEdgeLabelOffsetStyle,
  dependencyEdgeStyle,
  dependencyMarker,
  DEP_EDGE_STROKE,
} from '../graph/edgeTheme'
import {
  annotateCrossLayerEdgePathOptions,
  layoutDepthInViewport,
  mergeEdgeHiddenForInvisibleEndpoints,
} from '../graph/layoutDependencyLayers'
import { DEP_SOURCE_HANDLE, DEP_TARGET_HANDLE } from '../graph/handles'

const nodes = defineModel<any[]>('nodes', { required: true })
const edges = defineModel<any[]>('edges', { required: true })

defineProps<{
  nodeTypes: NodeTypesObject
}>()

const { fitView } = useVueFlow()
const drillRef = ref<InstanceType<typeof GraphDrillIn> | null>(null)

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
    annotateCrossLayerEdgePathOptions(nodes.value, edges.value, vp),
    nodes.value,
  )
}

provide('tritonRelayoutViewport', relayoutViewport)

/** Re-run depth layout after layer drill-out so snapshot geometry does not shrink pinned modules. */
provide('tritonAfterLayerDrillOut', relayoutViewport)

const defaultEdgeOptions = {
  type: 'smoothstep' as const,
  style: dependencyEdgeStyle(DEP_EDGE_STROKE),
  markerStart: dependencyMarker(DEP_EDGE_STROKE),
  markerEnd: undefined,
  sourceHandle: DEP_SOURCE_HANDLE,
  targetHandle: DEP_TARGET_HANDLE,
  labelStyle: dependencyEdgeLabelOffsetStyle(),
  labelBgStyle: dependencyEdgeLabelOffsetStyle(),
}

function uid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(16).slice(2)}`
}

function handleConnect(conn: Connection) {
  if (!conn.source || !conn.target) return
  edges.value = [
    ...edges.value,
    {
      id: `e-${uid()}`,
      source: conn.source,
      target: conn.target,
      sourceHandle: conn.sourceHandle ?? DEP_SOURCE_HANDLE,
      targetHandle: conn.targetHandle ?? DEP_TARGET_HANDLE,
      label: 'depends on',
      labelStyle: dependencyEdgeLabelOffsetStyle(),
      labelBgStyle: dependencyEdgeLabelOffsetStyle(),
      markerStart: dependencyMarker(DEP_EDGE_STROKE),
      markerEnd: undefined,
      style: dependencyEdgeStyle(DEP_EDGE_STROKE),
    },
  ]
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

defineExpose({ resetView, fitToViewport })
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
  transition: opacity 0.35s ease;
}

.vue-flow__node.tg-dimmed {
  opacity: 0.4;
  pointer-events: none;
}
.vue-flow__edge.tg-dimmed path {
  opacity: 0.35 !important;
}
.vue-flow__edge.tg-dimmed .vue-flow__edge-text {
  opacity: 0.45;
}
</style>
