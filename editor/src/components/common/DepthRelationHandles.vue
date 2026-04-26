<script setup lang="ts">
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
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
const measureVersion = ref(0)
let measureRaf = 0
let ro: ResizeObserver | null = null

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

function scheduleMeasureRefresh() {
  if (measureRaf) return
  measureRaf = requestAnimationFrame(() => {
    measureRaf = 0
    measureVersion.value++
  })
}

function ownNodeEl(): HTMLElement | null {
  return document.querySelector(`[data-node-id="${props.nodeId}"]`)
}

function endpointPortTopForOtherPackage(otherPackageId: string): number | null {
  measureVersion.value
  const root = ownNodeEl()
  if (!root) return null

  const endpoints = Array.from(root.querySelectorAll<HTMLElement>('.package-box__external-endpoint'))
  const ports = endpoints
    .filter((el) => el.dataset.tritonForeignPackageId === otherPackageId)
    .map((el) => el.querySelector<HTMLElement>('.package-box__port'))
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
  if (!ports.length) return null

  const rootRect = root.getBoundingClientRect()
  const rootScaleY = rootRect.height > 0 ? root.offsetHeight / rootRect.height : 1
  const rootLayoutH = root.offsetHeight || root.clientHeight
  if (rootLayoutH <= 0) return null

  const ys = ports.map((port) => {
    const r = port.getBoundingClientRect()
    return (r.top + r.height / 2 - rootRect.top) * rootScaleY
  })
  ys.sort((a, b) => a - b)
  const mid = Math.floor(ys.length / 2)
  const y = ys.length % 2 === 1 ? ys[mid]! : (ys[mid - 1]! + ys[mid]!) / 2
  return Math.max(0, Math.min(100, (y / rootLayoutH) * 100))
}

function edgeForAggInSlot(slot: number) {
  const hid = aggregateTargetHandleId(slot)
  return getEdges.value.find(
    (e) =>
      edgeVisible(e) &&
      edgeContributesToClasspathDepth(e) &&
      String(e.target) === props.nodeId &&
      String(e.targetHandle ?? aggregateTargetHandleId(0)) === hid,
  )
}

function edgeForAggOutSlot(slot: number) {
  const hid = aggregateSourceHandleId(slot)
  return getEdges.value.find(
    (e) =>
      edgeVisible(e) &&
      edgeContributesToClasspathDepth(e) &&
      String(e.source) === props.nodeId &&
      String(e.sourceHandle ?? aggregateSourceHandleId(0)) === hid,
  )
}

function anchorAggInTop(slot: number): string {
  const fb = aggregateFanTopPctForUsedSlots(slot, used.value.aggInSlots)
  const e = edgeForAggInSlot(slot)
  if (e) {
    const portTop = endpointPortTopForOtherPackage(String(e.source))
    if (portTop !== null) return `${portTop}%`
  }
  const v = props.anchorTops?.aggIn?.[String(slot)]
  return `${v != null && Number.isFinite(v) ? v : fb}%`
}

function anchorAggOutTop(slot: number): string {
  const fb = aggregateFanTopPctForUsedSlots(slot, used.value.aggOutSlots)
  const e = edgeForAggOutSlot(slot)
  if (e) {
    const portTop = endpointPortTopForOtherPackage(String(e.target))
    if (portTop !== null) return `${portTop}%`
  }
  const v = props.anchorTops?.aggOut?.[String(slot)]
  return `${v != null && Number.isFinite(v) ? v : fb}%`
}

onMounted(() => {
  void nextTick(() => {
    const root = ownNodeEl()
    if (root) {
      ro = new ResizeObserver(scheduleMeasureRefresh)
      ro.observe(root)
      for (const endpoint of root.querySelectorAll('.package-box__external-endpoint')) {
        ro.observe(endpoint)
      }
    }
    scheduleMeasureRefresh()
  })
})

onUnmounted(() => {
  if (measureRaf) cancelAnimationFrame(measureRaf)
  measureRaf = 0
  ro?.disconnect()
  ro = null
})

watch(getEdges, () => void nextTick(scheduleMeasureRefresh), { deep: true })
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
