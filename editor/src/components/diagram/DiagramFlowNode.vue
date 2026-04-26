<script setup lang="ts">
import { NodeResizer } from '@vue-flow/node-resizer'
import { computed, inject, type ComputedRef } from 'vue'
import type { ModuleAnchorTops } from '../../graph/layoutDependencyLayers'
import DepthRelationHandles from '../common/DepthRelationHandles.vue'
import { DIAGRAM_LEAF_MIN_HEIGHT_PX, DIAGRAM_LEAF_MIN_WIDTH_PX } from './boxChromeLayout'
import DiagramSection from './DiagramSection.vue'
import { useAbstractionNodeResize } from './useAbstractionNodeResize'

type LayerFlipPayload = {
  tx: number
  ty: number
  sx: number
  sy: number
  transition?: string
}

const props = defineProps<{
  id: string
  variantClass: string
  layerFlip?: LayerFlipPayload
  anchorTops?: ModuleAnchorTops
  rootElRef?: (el: HTMLDivElement | null) => void
}>()

const { showResizer, onResize } = useAbstractionNodeResize(props.id)

const absentAbstractionDojo = computed(() => false)
const abstractionDojoActive = inject<ComputedRef<boolean>>('tritonAbstractionDojoActive', absentAbstractionDojo)

const layerFlipStyle = computed((): Record<string, string> => {
  const f = props.layerFlip
  if (!f) return {}
  return {
    transform: `translate(${f.tx}px, ${f.ty}px)`,
    transformOrigin: '0 0',
    transition: f.transition ?? 'none',
  }
})

function bindRootEl(el: unknown) {
  props.rootElRef?.(el instanceof HTMLDivElement ? el : null)
}
</script>

<template>
  <!-- FLIP transform only on inner shell so handle positions match Vue Flow edge math. -->
  <div
    :ref="bindRootEl"
    class="flow-graph-node"
    :class="[variantClass, { 'flow-graph-node--abstraction-debug-outline': abstractionDojoActive }]"
    :data-node-id="id"
    :data-testid="`diagram-node-${id}`"
  >
    <NodeResizer
      v-if="showResizer"
      :min-width="DIAGRAM_LEAF_MIN_WIDTH_PX"
      :min-height="DIAGRAM_LEAF_MIN_HEIGHT_PX"
      :is-visible="true"
      handle-class-name="nodrag nopan"
      line-class-name="nodrag nopan"
      @resize="onResize"
    />
    <div class="flow-graph-node__flip-outer" :style="layerFlipStyle">
      <div class="flow-graph-node__flip-counter">
        <DiagramSection>
          <slot />
        </DiagramSection>
      </div>
    </div>
    <DepthRelationHandles
      :node-id="id"
      :anchor-tops="anchorTops"
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

.flow-graph-node :deep(.vue-flow__resize-control) {
  z-index: 1000;
  pointer-events: all;
}

.flow-graph-node :deep(.vue-flow__resize-control.handle) {
  z-index: 1001;
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
