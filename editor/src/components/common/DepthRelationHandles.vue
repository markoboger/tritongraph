<script setup lang="ts">
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import { computed, inject, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { REMOVED_EDGE_COLOR, gitDiffImportEdgeColor, gitDiffKey, isGhostEdge } from '../../graph/gitDiffOverlay'
import {
  aggregateFanTopPctForUsedSlots,
  aggregateSourceHandleId,
  aggregateTargetHandleId,
} from '../../graph/handles'
import type { ModuleAnchorTops } from '../../graph/layoutDependencyLayers'
import { edgeContributesToClasspathDepth, strokeColorForFlowEdge } from '../../graph/relationKinds'
import { tileAccessLines, type TileAccessAnchor, type TileAccessHandle } from '../../graph/tileAccessLines'
import { usedHandlesForNode } from '../../graph/usedFlowHandles'

const props = defineProps<{
  nodeId: string
  anchorTops?: ModuleAnchorTops
  targetClass: string
  sourceClass: string
}>()

const { getEdges } = useVueFlow()
const gitDiff = inject(gitDiffKey, null)
const measureVersion = ref(0)
let measureRaf = 0
let ro: ResizeObserver | null = null

const used = computed(() => usedHandlesForNode(props.nodeId, getEdges.value))

function edgeVisible(e: { hidden?: boolean }): boolean {
  return !(e as { hidden?: boolean }).hidden
}

/** Match the edge renderer's diff tint so a handle dot never disagrees with the line it anchors. */
function strokeForHit(hit: { id?: string; source?: unknown; target?: unknown; label?: unknown; style?: unknown } | undefined): string {
  if (!hit) return '#64748b'
  if (!isGhostEdge(hit.id)) {
    const diffColor = gitDiffImportEdgeColor(gitDiff, String(hit.source ?? ''), String(hit.target ?? ''))
    if (diffColor) return diffColor
  }
  return strokeColorForFlowEdge(hit)
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
    out[slot] = strokeForHit(hit)
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
    out[slot] = strokeForHit(hit)
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

/**
 * Where inside this box the edge to/from `otherPackageId` lands, as % of the box height: the median of
 * the matching inner endpoints. Left endpoints receive incoming edges, right ones send outgoing — so a
 * cycle's two directions never pull each other's handle.
 */
function endpointPortTopForOtherPackage(otherPackageId: string, side: 'left' | 'right'): number | null {
  measureVersion.value
  const root = ownNodeEl()
  if (!root) return null

  // Tile anchors are reached by the inner tile-access lines instead; the handle keeps its slot.
  const endpoints = Array.from(
    root.querySelectorAll<HTMLElement>('.package-box__external-endpoint:not(.tile-entry-anchor)'),
  )
  const ports = endpoints
    .filter((el) => el.dataset.tritonForeignPackageId === otherPackageId)
    .filter((el) => el.classList.contains('package-box__external-endpoint--right') === (side === 'right'))
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

function edgesForAggInSlot(slot: number) {
  const hid = aggregateTargetHandleId(slot)
  return getEdges.value.filter(
    (e) =>
      edgeVisible(e) &&
      edgeContributesToClasspathDepth(e) &&
      String(e.target) === props.nodeId &&
      String(e.targetHandle ?? aggregateTargetHandleId(0)) === hid,
  )
}

function edgeForAggInSlot(slot: number) {
  return edgesForAggInSlot(slot)[0]
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

function anchorAggInTopPct(slot: number): number {
  const fb = aggregateFanTopPctForUsedSlots(slot, used.value.aggInSlots)
  const e = edgeForAggInSlot(slot)
  if (e) {
    const portTop = endpointPortTopForOtherPackage(String(e.source), 'left')
    if (portTop !== null) return portTop
  }
  const v = props.anchorTops?.aggIn?.[String(slot)]
  return v != null && Number.isFinite(v) ? v : fb
}

function anchorAggInTop(slot: number): string {
  return `${anchorAggInTopPct(slot)}%`
}

/** Box-local layout px of a tile entry point: the left edge, vertically centred, of `el`. */
function tileEntryPoint(el: HTMLElement, rootRect: DOMRect, scale: number): { x: number; y: number } {
  const r = el.getBoundingClientRect()
  return { x: (r.left - rootRect.left) * scale, y: (r.top + r.height / 2 - rootRect.top) * scale }
}

/** Removed imports end in their own lane, so they never merge with a live import from the same box. */
function removedImportSourceKey(sourceId: string): string {
  return `removed:${sourceId}`
}

/**
 * Where incoming edges enter the shown tiles: the tile anchors (see TileEntryAnchors) of live imports,
 * plus — in the git diff — every tile a box imported into at the base but no longer does.
 */
function measureTileAnchors(root: HTMLElement, removedSources: readonly string[]): TileAccessAnchor[] {
  const rootRect = root.getBoundingClientRect()
  const scale = rootRect.width > 0 ? root.offsetWidth / rootRect.width : 1
  const live = Array.from(root.querySelectorAll<HTMLElement>('.tile-entry-anchor')).map((el) => ({
    sourceId: el.dataset.tritonForeignPackageId ?? '',
    ...tileEntryPoint(el, rootRect, scale),
  }))
  const tiles = Array.from(root.querySelectorAll<HTMLElement>('[data-triton-tile-id]'))
  const removed = removedSources.flatMap((sourceId) =>
    tiles
      .filter((tile) => gitDiff?.isRemovedImportInto?.(sourceId, tile.dataset.tritonTileId ?? ''))
      .map((tile) => ({ sourceId: removedImportSourceKey(sourceId), ...tileEntryPoint(tile, rootRect, scale) })),
  )
  return [...live, ...removed]
}

function isEmphasized(e: { class?: unknown }): boolean {
  return String(e.class ?? '').split(/\s+/).includes('tg-edge-emph')
}

/** Incoming edges continue inside a focused box of tiles: from their handle to each tile they reach. */
const tileLines = computed(() => {
  measureVersion.value
  const root = ownNodeEl()
  if (!root || !root.querySelector('[data-triton-tile-id]')) return null
  const height = root.offsetHeight
  const handles: TileAccessHandle[] = used.value.aggInSlots.flatMap((slot) => {
    const y = (anchorAggInTopPct(slot) / 100) * height
    return edgesForAggInSlot(slot).map((e) =>
      isGhostEdge(e.id)
        ? { sourceId: removedImportSourceKey(String(e.source)), y, color: REMOVED_EDGE_COLOR, dashed: true, emphasized: isEmphasized(e) }
        : { sourceId: String(e.source), y, color: strokeForHit(e), emphasized: isEmphasized(e) },
    )
  })
  const removedSources = used.value.aggInSlots.flatMap((slot) =>
    edgesForAggInSlot(slot).filter((e) => isGhostEdge(e.id)).map((e) => String(e.source)),
  )
  const anchors = measureTileAnchors(root, removedSources)
  if (!anchors.length) return null
  return { width: root.offsetWidth, height, lines: tileAccessLines(handles, anchors) }
})

function arrowTip([x, y]: [number, number]): string {
  return `${x},${y} ${x - 7},${y - 4} ${x - 7},${y + 4}`
}

function anchorAggOutTop(slot: number): string {
  const fb = aggregateFanTopPctForUsedSlots(slot, used.value.aggOutSlots)
  const e = edgeForAggOutSlot(slot)
  if (e) {
    const portTop = endpointPortTopForOtherPackage(String(e.target), 'right')
    if (portTop !== null) return `${portTop}%`
  }
  const v = props.anchorTops?.aggOut?.[String(slot)]
  return `${v != null && Number.isFinite(v) ? v : fb}%`
}

onMounted(() => {
  void nextTick(() => {
    const root = ownNodeEl()
    if (root) {
      // Tiles scroll inside a crowded box; their lines must follow.
      root.addEventListener('scroll', scheduleMeasureRefresh, { capture: true, passive: true })
      ro = new ResizeObserver(scheduleMeasureRefresh)
      ro.observe(root)
      for (const endpoint of root.querySelectorAll('.package-box__external-endpoint, .package-box__inner-package-row')) {
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
  ownNodeEl()?.removeEventListener('scroll', scheduleMeasureRefresh, { capture: true })
})

/** Structural signature, not `deep`: Vue Flow writes `sourceX`/`targetY` into every edge on each
 *  render, and a deep watch per node instance turns that into an O(nodes × edges) storm. */
watch(
  () => getEdges.value.map((e) => `${e.id}|${e.source}|${e.target}|${e.sourceHandle}|${e.targetHandle}|${e.hidden}`).join(','),
  () => void nextTick(scheduleMeasureRefresh),
)
</script>

<template>
  <svg
    v-if="tileLines?.lines.length"
    class="tile-access-lines"
    :viewBox="`0 0 ${tileLines.width} ${tileLines.height}`"
    aria-hidden="true"
  >
    <g v-for="(line, i) in tileLines.lines" :key="i" :stroke="line.color" :fill="line.color">
      <polyline
        :points="line.points.map((p) => p.join(',')).join(' ')"
        fill="none"
        :stroke-width="line.emphasized ? 3 : 1.5"
        :stroke-dasharray="line.dashed ? '6 4' : undefined"
      />
      <polygon :points="arrowTip(line.points[line.points.length - 1]!)" stroke="none" />
    </g>
  </svg>
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
.tile-access-lines {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  /* Lines to tiles scrolled out of view end at the box edge instead of running past it. */
  overflow: hidden;
  pointer-events: none;
  z-index: 11;
}
.handle {
  position: absolute;
  z-index: 12;
}
</style>
