<script setup lang="ts">
import { useVueFlow } from '@vue-flow/core'
import { inject } from 'vue'
import type { ModuleAnchorTops } from '../../graph/layoutDependencyLayers'
import type { BoxCompartment } from '../../diagram/boxCompartments'
import DiagramFlowNode from './DiagramFlowNode.vue'
import ProjectBox from './ProjectBox.vue'
import { TRITON_WORKSPACE_FLOW_ID } from '../../graph/tritonVueFlowId'
import { useDiagramNodeActions } from './useDiagramNodeActions'
import { useDiagramNodePinTool } from './useDiagramNodePinTool'

type LayerFlipPayload = {
  tx: number
  ty: number
  sx: number
  sy: number
  transition?: string
}

/**
 * Graph node: Vue Flow node that hosts one {@link ProjectBox} inside a {@link DiagramSection}.
 * Handles stay on the graph node shell; the box is the project presentation.
 */
const props = defineProps<{
  id: string
  data: {
    label: string
    subtitle?: string
    /**
     * Source-derived description (file lists, fqn, …) emitted by the scanner. Round-trips
     * through YAML unchanged so structural diffs only reflect code changes; user-typed
     * notes go to {@link notes} (overlay-backed) and are NOT written back to YAML.
     */
    description?: string
    /**
     * Free-form user note (overlay-backed). When non-empty it replaces `description` in the
     * box body. Persisted in the runtime overlay store (TinyBase + localStorage) keyed by
     * `(workspaceKey, nodeId)` — see `applyOverlayToFlowNodes` in `App.vue`.
     */
    notes?: string
    layerDrillFocus?: boolean
    drillNote?: string
    layerFlip?: LayerFlipPayload
    pinned?: boolean
    boxColor?: string
    language?: string
    iconUrl?: string
    projectKind?: 'project' | 'module' | 'general'
    projectCompartments?: readonly BoxCompartment[]
    preferredFocusWidth?: number
    /** Set by layout: handle `top` % aligned to partner module centers. */
    anchorTops?: ModuleAnchorTops
  }
}>()

const { getNodes } = useVueFlow(TRITON_WORKSPACE_FLOW_ID)
/** Bubbles markdown-link clicks from {@link ProjectBox} subtitle up to App.vue (see GraphWorkspace). */
const emitLinkAction = inject<((nodeId: string, href: string) => void) | undefined>(
  'tritonEmitLinkAction',
  undefined,
)

function onLinkAction(href: string) {
  emitLinkAction?.(props.id, href)
}

const showPinTool = useDiagramNodePinTool({
  nodeId: props.id,
  nodes: getNodes,
  pinned: () => props.data.pinned,
  layerDrillFocus: () => props.data.layerDrillFocus,
})

const { cycleColor, onRename, onDescriptionChange, togglePin } = useDiagramNodeActions({
  nodeId: props.id,
  label: () => props.data.label,
  notes: () => props.data.notes,
  pinned: () => props.data.pinned,
  boxColor: () => props.data.boxColor,
})
</script>

<template>
  <DiagramFlowNode
    :id="id"
    variant-class="flow-graph-node--project"
    :layer-flip="data.layerFlip"
    :anchor-tops="data.anchorTops"
  >
    <ProjectBox
      :box-id="id"
      :label="data.label"
      :subtitle="data.subtitle"
      :description="(data.notes as string | undefined) || data.description"
      :notes="data.drillNote"
      :language="data.language"
      :icon-url="data.iconUrl"
      :kind="data.projectKind"
      :box-color="data.boxColor"
      :compartments="data.projectCompartments"
      :pinned="!!data.pinned"
      :focused="!!data.layerDrillFocus"
      :show-pin-tool="showPinTool"
      :show-color-tool="!!data.layerDrillFocus"
      @toggle-pin="togglePin"
      @cycle-color="cycleColor"
      @rename="onRename"
      @description-change="onDescriptionChange"
      @link-action="onLinkAction"
    />
  </DiagramFlowNode>
</template>
