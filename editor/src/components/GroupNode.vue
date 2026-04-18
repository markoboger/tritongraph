<script setup lang="ts">
/** Nested diagram container (group): frame only for now; child modules still use root layout. */
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import { computed } from 'vue'
import {
  AGG_TARGET_HANDLE,
  aggregateFanTopPctForUsedSlots,
  aggregateSourceHandleId,
} from '../graph/handles'
import { edgeContributesToClasspathDepth, strokeColorForFlowEdge } from '../graph/relationKinds'
import { usedHandlesForNode } from '../graph/usedFlowHandles'

const props = defineProps<{
  id: string
  data: { label: string; subtitle?: string }
}>()

const { getEdges } = useVueFlow()
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
</script>

<template>
  <div class="group-node">
    <Handle
      :id="AGG_TARGET_HANDLE"
      class="gh gh-agg-in-target tg-handle-anchor"
      type="target"
      :position="Position.Left"
      :style="{ '--tg-handle-stroke': strokeAggIn }"
    />
    <Handle
      v-for="slot in used.aggOutSlots"
      :key="aggregateSourceHandleId(slot)"
      :id="aggregateSourceHandleId(slot)"
      class="gh gh-agg-fan-out tg-handle-anchor"
      type="source"
      :position="Position.Right"
      :style="{
        top: `${aggregateFanTopPctForUsedSlots(slot, used.aggOutSlots)}%`,
        '--tg-handle-stroke': strokeAggOutBySlot[slot] ?? '#64748b',
      }"
    />
    <div class="banner">{{ data.label }}</div>
    <div v-if="data.subtitle" class="banner-sub">{{ data.subtitle }}</div>
  </div>
</template>

<style scoped>
.group-node {
  width: 100%;
  height: 100%;
  border-radius: 12px;
  border: 1px dashed #94a3b8;
  /* ~10% transparent over opaque fill so routing behind stays visible */
  background: rgb(248 250 252 / 0.9);
  box-sizing: border-box;
  position: relative;
}
.banner {
  position: absolute;
  top: 6px;
  left: 10px;
  font-size: 12px;
  font-weight: 600;
  color: #334155;
  font-family: ui-sans-serif, system-ui, sans-serif;
}
.banner-sub {
  position: absolute;
  top: 22px;
  left: 10px;
  font-size: 11px;
  color: #64748b;
  font-family: ui-sans-serif, system-ui, sans-serif;
}
.gh {
  position: absolute;
  z-index: 12;
}
.gh-agg-in-target {
  top: 50%;
}
</style>
