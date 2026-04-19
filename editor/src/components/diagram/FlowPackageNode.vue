<script setup lang="ts">
/**
 * Vue Flow node for the Scala-package diagram. Sibling of {@link FlowProjectNode} so each diagram
 * can grow features independently (richer package metadata: members, imports drilldown, coverage,
 * sonarqube etc.). Hosts {@link PackageBox} for packages and, for flow `type: 'artefact'`, the same
 * node shell with {@link PackageBox} (`leaf-visual="artefact"`) when unfocused and {@link ScalaArtefactBox}
 * when layer-drill focused. Does not relay subtitle link-action clicks (package boxes have no markdown
 * links yet — re-add the `tritonEmitLinkAction` injection here when that changes).
 */
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import { computed, inject, nextTick, watch } from 'vue'
import { boxColorForId, nextNamedBoxColor } from '../../graph/boxColors'
import {
  AGG_TARGET_HANDLE,
  aggregateFanTopPctForUsedSlots,
  aggregateSourceHandleId,
} from '../../graph/handles'
import type { ModuleAnchorTops } from '../../graph/layoutDependencyLayers'
import { edgeContributesToClasspathDepth, strokeColorForFlowEdge } from '../../graph/relationKinds'
import { usedHandlesForNode } from '../../graph/usedFlowHandles'
import DiagramSection from './DiagramSection.vue'
import PackageBox, {
  type InnerArtefactRelationSummary,
  type InnerArtefactSummary,
  type InnerPackageSummary,
} from './PackageBox.vue'
import ScalaArtefactBox from './ScalaArtefactBox.vue'

type LayerFlipPayload = {
  tx: number
  ty: number
  sx: number
  sy: number
  transition?: string
}

const props = defineProps<{
  id: string
  data: {
    label: string
    subtitle?: string
    description?: string
    layerDrillFocus?: boolean
    drillNote?: string
    layerFlip?: LayerFlipPayload
    pinned?: boolean
    boxColor?: string
    /** Set by layout: handle `top` % aligned to partner module centers. */
    anchorTops?: ModuleAnchorTops
    /** Child packages rendered inside the box when layer-drill focused (Scala package view). */
    innerPackages?: readonly InnerPackageSummary[]
    /** Scala members listed inside the focused box (no separate flow nodes). */
    innerArtefacts?: readonly InnerArtefactSummary[]
    innerArtefactRelations?: readonly InnerArtefactRelationSummary[]
    /** Nested inner drill: ids from first-tier `innerPackages` downward (flow-only UI state). */
    innerDrillPath?: readonly string[]
    /** Which inner Scala artefact row is focused (flow-only; does not change layer drill). */
    innerArtefactFocusId?: string
  }
}>()

const innerPackagesForBox = computed(() => {
  const raw = props.data.innerPackages
  return Array.isArray(raw) ? raw : []
})

const innerArtefactsForBox = computed(() => {
  const raw = props.data.innerArtefacts
  return Array.isArray(raw) ? raw : []
})

const innerArtefactRelationsForBox = computed(() => {
  const raw = props.data.innerArtefactRelations
  return Array.isArray(raw) ? raw : []
})

const innerDrillPathForBox = computed(() => {
  const raw = props.data.innerDrillPath
  return Array.isArray(raw) ? raw.map(String) : []
})

const { updateNodeData, getNodes, getEdges } = useVueFlow()

/** Same Vue node shell as packages so layout + chrome stay aligned (`type` from flow graph). */
const isScalaArtefactLeaf = computed(() => getNodes.value.find((n) => n.id === props.id)?.type === 'artefact')

const used = computed(() => usedHandlesForNode(props.id, getEdges.value))

function edgeVisible(e: { hidden?: boolean }): boolean {
  return !(e as { hidden?: boolean }).hidden
}

const strokeAggIn = computed(() => {
  const hit = getEdges.value.find(
    (e) =>
      edgeVisible(e) &&
      edgeContributesToClasspathDepth(e) &&
      String(e.target) === props.id &&
      String(e.targetHandle ?? AGG_TARGET_HANDLE) === AGG_TARGET_HANDLE,
  )
  return hit ? strokeColorForFlowEdge(hit) : '#64748b'
})

const strokeAggOutBySlot = computed(() => {
  const out: Record<number, string> = {}
  for (const slot of used.value.aggOutSlots) {
    const hid = aggregateSourceHandleId(slot)
    const hit = getEdges.value.find(
      (e) =>
        edgeVisible(e) &&
        edgeContributesToClasspathDepth(e) &&
        String(e.source) === props.id &&
        String(e.sourceHandle ?? '') === hid,
    )
    out[slot] = hit ? strokeColorForFlowEdge(hit) : '#64748b'
  }
  return out
})

function anchorTopAggIn(fallback: number): string {
  const v = props.data.anchorTops?.aggIn
  return `${v != null && Number.isFinite(v) ? v : fallback}%`
}

function anchorAggOutTop(slot: number): string {
  const fb = aggregateFanTopPctForUsedSlots(slot, used.value.aggOutSlots)
  const v = props.data.anchorTops?.aggOut?.[String(slot)]
  return `${v != null && Number.isFinite(v) ? v : fb}%`
}

const refreshDimming = inject<(() => void) | undefined>('tritonRefreshDimming', undefined)
const relayoutViewport = inject<(() => void | Promise<void>) | undefined>('tritonRelayoutViewport', undefined)
const graphFocusUi = inject<{ containerFocusId: string | null } | undefined>('tritonGraphFocusUi', undefined)
const patchNodeData = inject<((id: string, patch: Record<string, unknown>) => void) | undefined>(
  'tritonPatchNodeData',
  undefined,
)

function moduleInContainerFocusTree(focusId: string, moduleId: string): boolean {
  const nodes = getNodes.value
  if (focusId === moduleId) return true
  const desc = new Set<string>([focusId])
  let frontier = [focusId]
  while (frontier.length) {
    const next: string[] = []
    for (const id of frontier) {
      for (const n of nodes) {
        if (String(n.parentNode) === id && !desc.has(n.id)) {
          desc.add(n.id)
          next.push(n.id)
        }
      }
    }
    frontier = next
  }
  if (desc.has(moduleId)) return true
  let cur = nodes.find((n) => n.id === moduleId)
  while (cur?.parentNode) {
    const pid = String(cur.parentNode)
    if (pid === focusId) return true
    cur = nodes.find((n) => n.id === pid)
  }
  return false
}

const showPinTool = computed(() => {
  if (props.data.pinned) return true
  if (props.data.layerDrillFocus) return true
  const fid = graphFocusUi?.containerFocusId
  if (!fid) return false
  return moduleInContainerFocusTree(fid, props.id)
})

const layerFlipStyle = computed((): Record<string, string> => {
  const f = props.data.layerFlip
  if (!f) return {}
  return {
    transform: `translate(${f.tx}px, ${f.ty}px) scale(${f.sx}, ${f.sy})`,
    transformOrigin: '0 0',
    transition: f.transition ?? 'none',
  }
})

const layerFlipCounterStyle = computed((): Record<string, string> => {
  const f = props.data.layerFlip
  if (!f) return {}
  const { sx, sy } = f
  if (Math.abs(sx - 1) < 1e-5 && Math.abs(sy - 1) < 1e-5) return {}
  const safeSx = Math.abs(sx) < 1e-6 ? 1 : sx
  const safeSy = Math.abs(sy) < 1e-6 ? 1 : sy
  return {
    transform: `scale(${1 / safeSx}, ${1 / safeSy})`,
    transformOrigin: '0 0',
    transition: f.transition ?? 'none',
  }
})

function cycleColor() {
  const accent = (props.data.boxColor as string) || boxColorForId(props.id)
  updateNodeData(props.id, { boxColor: nextNamedBoxColor(accent) })
}

function onRename(newLabel: string) {
  if (!newLabel || newLabel === props.data.label) return
  patchNodeData?.(props.id, { label: newLabel })
  updateNodeData(props.id, { label: newLabel })
}

function onDescriptionChange(newDescription: string) {
  if (newDescription === (props.data.description ?? '')) return
  patchNodeData?.(props.id, { description: newDescription })
  updateNodeData(props.id, { description: newDescription })
}

function togglePin(ev: MouseEvent) {
  ev.stopPropagation()
  const next = !props.data.pinned
  updateNodeData(props.id, { pinned: next })
  void nextTick(async () => {
    refreshDimming?.()
    await relayoutViewport?.()
  })
}

function onUpdateInnerDrillPath(path: string[]) {
  const patch: Record<string, unknown> = { innerDrillPath: path }
  if (path.length > 0) patch.innerArtefactFocusId = undefined
  patchNodeData?.(props.id, patch)
  updateNodeData(props.id, patch)
}

function onInnerArtefactFocus(id: string | null) {
  if (id === null || id === '') {
    patchNodeData?.(props.id, { innerArtefactFocusId: undefined })
    updateNodeData(props.id, { innerArtefactFocusId: undefined })
    return
  }
  const cur = props.data.innerArtefactFocusId as string | undefined
  const next = cur === id ? undefined : id
  patchNodeData?.(props.id, { innerArtefactFocusId: next })
  updateNodeData(props.id, { innerArtefactFocusId: next })
}

watch(
  () => props.data.layerDrillFocus,
  () => {
    patchNodeData?.(props.id, { innerDrillPath: [], innerArtefactFocusId: undefined })
    updateNodeData(props.id, { innerDrillPath: [], innerArtefactFocusId: undefined })
  },
)
</script>

<template>
  <div class="flow-graph-node flow-graph-node--package">
    <div class="flow-graph-node__flip-outer" :style="layerFlipStyle">
      <div class="flow-graph-node__flip-counter" :style="layerFlipCounterStyle">
        <DiagramSection>
          <ScalaArtefactBox
            v-if="isScalaArtefactLeaf && data.layerDrillFocus"
            :box-id="id"
            :label="data.label"
            :subtitle="data.subtitle"
            :notes="data.drillNote"
            :box-color="data.boxColor"
            :pinned="!!data.pinned"
            :show-pin-tool="showPinTool"
            :show-color-tool="true"
            @toggle-pin="togglePin"
            @cycle-color="cycleColor"
          />
          <PackageBox
            v-else-if="isScalaArtefactLeaf"
            leaf-visual="artefact"
            :box-id="id"
            :label="data.label"
            :subtitle="data.subtitle ?? ''"
            description=""
            :notes="data.drillNote"
            :box-color="data.boxColor"
            :pinned="!!data.pinned"
            :focused="false"
            :show-pin-tool="showPinTool"
            :show-color-tool="false"
            @toggle-pin="togglePin"
            @cycle-color="cycleColor"
          />
          <PackageBox
            v-else
            :box-id="id"
            :label="data.label"
            :subtitle="data.subtitle"
            :description="data.description"
            :notes="data.drillNote"
            :box-color="data.boxColor"
            :pinned="!!data.pinned"
            :focused="!!data.layerDrillFocus"
            :show-pin-tool="showPinTool"
            :show-color-tool="!!data.layerDrillFocus"
            :inner-packages="innerPackagesForBox"
            :inner-artefacts="innerArtefactsForBox"
            :inner-artefact-relations="innerArtefactRelationsForBox"
            :inner-drill-path="innerDrillPathForBox"
            :focused-inner-artefact-id="data.innerArtefactFocusId"
            @toggle-pin="togglePin"
            @cycle-color="cycleColor"
            @rename="onRename"
            @description-change="onDescriptionChange"
            @update-inner-drill-path="onUpdateInnerDrillPath"
            @update-inner-artefact-focus="onInnerArtefactFocus"
          />
        </DiagramSection>
      </div>
    </div>

    <Handle
      :id="AGG_TARGET_HANDLE"
      class="handle handle-agg-in-target tg-handle-anchor"
      type="target"
      :position="Position.Left"
      :style="{ top: anchorTopAggIn(50), '--tg-handle-stroke': strokeAggIn }"
    />
    <Handle
      v-for="slot in used.aggOutSlots"
      :key="aggregateSourceHandleId(slot)"
      :id="aggregateSourceHandleId(slot)"
      class="handle handle-agg-fan-out tg-handle-anchor"
      type="source"
      :position="Position.Right"
      :style="{
        top: anchorAggOutTop(slot),
        '--tg-handle-stroke': strokeAggOutBySlot[slot] ?? '#64748b',
      }"
    />
  </div>
</template>

<style scoped>
.flow-graph-node {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
}
.flow-graph-node__flip-outer {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  transform-origin: 0 0;
  z-index: 0;
}
.flow-graph-node__flip-counter {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: stretch;
  width: 100%;
  height: 100%;
}
.handle {
  position: absolute;
  z-index: 12;
}
</style>
