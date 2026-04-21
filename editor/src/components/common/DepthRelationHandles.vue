<script setup lang="ts">
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import { computed } from 'vue'
import {
  aggregateFanTopPctForUsedSlots,
  aggregateSourceHandleId,
  aggregateTargetHandleId,
} from '../../graph/handles'
import type { ModuleAnchorTops } from '../../graph/layoutDependencyLayers'
import { edgeContributesToClasspathDepth, strokeColorForFlowEdge } from '../../graph/relationKinds'
import { usedHandlesForNode } from '../../graph/usedFlowHandles'

const props = defineProps<{
  nodeId: string
  anchorTops?: ModuleAnchorTops
  targetClass: string
  sourceClass: string
}>()

const { getEdges } = useVueFlow()

const used = computed(() => usedHandlesForNode(props.nodeId, getEdges.value))

function edgeVisible(e: { hidden?: boolean }): boolean {
  return !(e as { hidden?: boolean }).hidden
}

const strokeAggInBySlot = computed(() => {
  const out: Record<number, string> = {}
  for (const slot of used.value.aggInSlots) {
    const hid = aggregateTargetHandleId(slot)
    const hit = getEdges.value.find(
      (e) =>
        edgeVisible(e) &&
        edgeContributesToClasspathDepth(e) &&
        String(e.target) === props.nodeId &&
        String(e.targetHandle ?? aggregateTargetHandleId(0)) === hid,
    )
    out[slot] = hit ? strokeColorForFlowEdge(hit) : '#64748b'
  }
  return out
})

const strokeAggOutBySlot = computed(() => {
  const out: Record<number, string> = {}
  for (const slot of used.value.aggOutSlots) {
    const hid = aggregateSourceHandleId(slot)
    const hit = getEdges.value.find(
      (e) =>
        edgeVisible(e) &&
        edgeContributesToClasspathDepth(e) &&
        String(e.source) === props.nodeId &&
        String(e.sourceHandle ?? aggregateSourceHandleId(0)) === hid,
    )
    out[slot] = hit ? strokeColorForFlowEdge(hit) : '#64748b'
  }
  return out
})

function anchorAggInTop(slot: number): string {
  const fb = aggregateFanTopPctForUsedSlots(slot, used.value.aggInSlots)
  const v = props.anchorTops?.aggIn?.[String(slot)]
  return `${v != null && Number.isFinite(v) ? v : fb}%`
}

function anchorAggOutTop(slot: number): string {
  const fb = aggregateFanTopPctForUsedSlots(slot, used.value.aggOutSlots)
  const v = props.anchorTops?.aggOut?.[String(slot)]
  return `${v != null && Number.isFinite(v) ? v : fb}%`
}
</script>

<template>
  <Handle
    v-for="slot in used.aggInSlots"
    :key="aggregateTargetHandleId(slot)"
    :id="aggregateTargetHandleId(slot)"
    :class="['handle', 'tg-handle-anchor', targetClass]"
    type="target"
    :position="Position.Left"
    :style="{
      top: anchorAggInTop(slot),
      '--tg-handle-stroke': strokeAggInBySlot[slot] ?? '#64748b',
    }"
  />
  <Handle
    v-for="slot in used.aggOutSlots"
    :key="aggregateSourceHandleId(slot)"
    :id="aggregateSourceHandleId(slot)"
    :class="['handle', 'tg-handle-anchor', sourceClass]"
    type="source"
    :position="Position.Right"
    :style="{
      top: anchorAggOutTop(slot),
      '--tg-handle-stroke': strokeAggOutBySlot[slot] ?? '#64748b',
    }"
  />
</template>

<style scoped>
.handle {
  position: absolute;
  z-index: 12;
}
</style>
