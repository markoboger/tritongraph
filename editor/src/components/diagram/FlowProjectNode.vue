<script setup lang="ts">
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import { computed, inject, nextTick } from 'vue'
import { boxColorForId, nextNamedBoxColor } from '../../graph/boxColors'
import { AGG_SOURCE_HANDLE, AGG_TARGET_HANDLE, DEP_SOURCE_HANDLE, DEP_TARGET_HANDLE } from '../../graph/handles'
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
    description?: string
    layerDrillFocus?: boolean
    drillNote?: string
    layerFlip?: LayerFlipPayload
    pinned?: boolean
    boxColor?: string
    language?: string
  }
}>()

const { updateNodeData, getNodes } = useVueFlow()
const refreshDimming = inject<(() => void) | undefined>('tritonRefreshDimming', undefined)
const relayoutViewport = inject<(() => void | Promise<void>) | undefined>('tritonRelayoutViewport', undefined)
const graphFocusUi = inject<{ containerFocusId: string | null } | undefined>('tritonGraphFocusUi', undefined)

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

function togglePin(ev: MouseEvent) {
  ev.stopPropagation()
  const next = !props.data.pinned
  updateNodeData(props.id, { pinned: next })
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
            :notes="data.drillNote"
            :language="data.language"
            :box-color="data.boxColor"
            :pinned="!!data.pinned"
            :focused="!!data.layerDrillFocus"
            :show-pin-tool="showPinTool"
            :show-color-tool="!!data.layerDrillFocus"
            @toggle-pin="togglePin"
            @cycle-color="cycleColor"
          />
        </DiagramSection>
      </div>
    </div>

    <Handle
      :id="DEP_TARGET_HANDLE"
      class="handle handle-side-left handle-use-dep"
      type="target"
      :position="Position.Left"
    />
    <Handle
      :id="AGG_TARGET_HANDLE"
      class="handle handle-side-left handle-use-agg"
      type="target"
      :position="Position.Left"
    />
    <Handle
      :id="DEP_SOURCE_HANDLE"
      class="handle handle-side-right handle-use-dep"
      type="source"
      :position="Position.Right"
    />
    <Handle
      :id="AGG_SOURCE_HANDLE"
      class="handle handle-side-right handle-use-agg"
      type="source"
      :position="Position.Right"
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
  width: 8px;
  height: 8px;
  background: #64748b;
  border: 1px solid #334155;
  z-index: 5;
  transform: translateY(-50%);
}
.handle-side-left {
  left: -6px;
}
.handle-side-right {
  right: -6px;
}
.handle-use-dep {
  top: 42%;
}
.handle-use-agg {
  top: 58%;
}
</style>
