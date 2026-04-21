<script setup lang="ts">
import { useVueFlow } from '@vue-flow/core'
import { computed, inject, nextTick } from 'vue'
import { boxColorForId, nextNamedBoxColor } from '../../graph/boxColors'
import type { ModuleAnchorTops } from '../../graph/layoutDependencyLayers'
import { setNodeColor, setNodeNotes, setNodePinned } from '../../store/overlayStore'
import type { BoxCompartment } from '../../diagram/boxCompartments'
import DepthRelationHandles from '../common/DepthRelationHandles.vue'
import DiagramSection from './DiagramSection.vue'
import ProjectBox from './ProjectBox.vue'

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
    projectKind?: 'project' | 'module'
    projectCompartments?: readonly BoxCompartment[]
    preferredFocusWidth?: number
    /** Set by layout: handle `top` % aligned to partner module centers. */
    anchorTops?: ModuleAnchorTops
  }
}>()

const { updateNodeData, getNodes } = useVueFlow()

/**
 * Workspace key supplied by `App.vue` so overlay-store writes target the active tab. Empty
 * string when nothing is open yet (boot path) — overlay setters are no-ops in that case.
 */
const workspaceKey = inject<{ value: string } | undefined>('tritonWorkspaceKey', undefined)
function ws(): string {
  return workspaceKey?.value ?? ''
}

const refreshDimming = inject<(() => void) | undefined>('tritonRefreshDimming', undefined)
const relayoutViewport = inject<(() => void | Promise<void>) | undefined>('tritonRelayoutViewport', undefined)
const graphFocusUi = inject<{ containerFocusId: string | null } | undefined>('tritonGraphFocusUi', undefined)
/** Direct v-model patch (see GraphWorkspace) — `updateNodeData` alone does not propagate reliably. */
const patchNodeData = inject<((id: string, patch: Record<string, unknown>) => void) | undefined>(
  'tritonPatchNodeData',
  undefined,
)
/** Bubbles markdown-link clicks from {@link ProjectBox} subtitle up to App.vue (see GraphWorkspace). */
const emitLinkAction = inject<((nodeId: string, href: string) => void) | undefined>(
  'tritonEmitLinkAction',
  undefined,
)

function onLinkAction(href: string) {
  emitLinkAction?.(props.id, href)
}

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
    transform: `translate(${f.tx}px, ${f.ty}px)`,
    transformOrigin: '0 0',
    transition: f.transition ?? 'none',
  }
})

const layerFlipCounterStyle = computed((): Record<string, string> => {
  return {}
})

function cycleColor() {
  const accent = (props.data.boxColor as string) || boxColorForId(props.id)
  const next = nextNamedBoxColor(accent)
  updateNodeData(props.id, { boxColor: next })
  patchNodeData?.(props.id, { boxColor: next })
  setNodeColor(ws(), props.id, next)
}

function onRename(newLabel: string) {
  if (!newLabel || newLabel === props.data.label) return
  patchNodeData?.(props.id, { label: newLabel })
  updateNodeData(props.id, { label: newLabel })
}

/**
 * The "description editor" is the user-note editor: writes go to the overlay store
 * (persisted, kept out of YAML round-trip) and into `data.notes`. The scanner-emitted
 * description (`data.scannerDescription`) is left untouched so the YAML output keeps
 * showing source-derived metadata even after a user typed a personal note.
 */
function onDescriptionChange(newDescription: string) {
  const cur = (props.data.notes as string | undefined) ?? ''
  if (newDescription === cur) return
  patchNodeData?.(props.id, { notes: newDescription })
  updateNodeData(props.id, { notes: newDescription })
  setNodeNotes(ws(), props.id, newDescription)
}

function togglePin(ev: MouseEvent) {
  ev.stopPropagation()
  const next = !props.data.pinned
  updateNodeData(props.id, { pinned: next })
  patchNodeData?.(props.id, { pinned: next })
  setNodePinned(ws(), props.id, next)
  void nextTick(async () => {
    refreshDimming?.()
    await relayoutViewport?.()
  })
}
</script>

<template>
  <!-- FLIP transform only on inner shell so handle positions match Vue Flow edge math (tall pinned boxes). -->
  <div class="flow-graph-node flow-graph-node--project">
    <div class="flow-graph-node__flip-outer" :style="layerFlipStyle">
      <div class="flow-graph-node__flip-counter" :style="layerFlipCounterStyle">
        <DiagramSection>
          <ProjectBox
            :box-id="id"
            :label="data.label"
            :subtitle="data.subtitle"
            :description="(data.notes as string | undefined) || data.description"
            :notes="data.drillNote"
            :language="data.language"
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
        </DiagramSection>
      </div>
    </div>
    <DepthRelationHandles
      :node-id="id"
      :anchor-tops="data.anchorTops"
      target-class="handle-agg-in-target"
      source-class="handle-agg-fan-out"
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
  /* Above edge SVG so anchors sit on the visible box border */
  z-index: 12;
}
</style>
