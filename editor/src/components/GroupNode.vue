<script setup lang="ts">
/**
 * Nested diagram container (group). The frame draws a rounded dashed rectangle and a small banner;
 * children are positioned by the depth layout. The frame participates in layer-drill animations the
 * same way leaf project boxes do — when the drill resizes a group it gets a `layerFlip` transform
 * (FLIP invert→play) so the box smoothly grows from its previous bounds to its new bounds, and the
 * inner counter-scale keeps the banner / nested boxes pixel-stable. See `applyLayerDrill` in
 * `GraphDrillIn.vue`. Without this, clicking a package container would change geometry but would
 * skip the animation, making "expand to fill the layer" feel like a discontinuous jump.
 */
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import { computed } from 'vue'
import folderIconUrl from '../assets/language-icons/folder.svg'
import {
  AGG_TARGET_HANDLE,
  aggregateFanTopPctForUsedSlots,
  aggregateSourceHandleId,
} from '../graph/handles'
import { edgeContributesToClasspathDepth, strokeColorForFlowEdge } from '../graph/relationKinds'
import { usedHandlesForNode } from '../graph/usedFlowHandles'

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
    layerFlip?: LayerFlipPayload
    layerDrillFocus?: boolean
    /** Scala outer package scope: show folder + titles like {@link PackageBox}. */
    packageScope?: boolean
  }
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

/**
 * Outer FLIP transform: at the start of the animation the focused group sits at its `first`
 * (pre-drill) rect via this translate+scale; `playLayerFlip` then sets sx/sy back to 1 with a
 * transition to the `last` (post-drill) rect. Mirrors the same machinery on FlowProjectNode.
 */
const layerFlipStyle = computed((): Record<string, string> => {
  const f = props.data.layerFlip
  if (!f) return {}
  return {
    transform: `translate(${f.tx}px, ${f.ty}px) scale(${f.sx}, ${f.sy})`,
    transformOrigin: '0 0',
    transition: f.transition ?? 'none',
  }
})

/**
 * Counter-scale the inner shell so banner text and child boxes don't squash/stretch with the
 * outer FLIP scale. Without this the banner/glyphs would wobble during the drill animation.
 */
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
</script>

<template>
  <div class="group-node" :class="{ 'group-node--focus': data.layerDrillFocus }">
    <div class="group-node__flip-outer" :style="layerFlipStyle">
      <div class="group-node__flip-counter" :style="layerFlipCounterStyle">
        <div
          class="group-node__frame"
          :class="{ 'group-node__frame--package-scope': data.packageScope }"
        >
          <template v-if="data.packageScope">
            <div class="group-node__pkg-header">
              <img
                class="group-node__folder-icon"
                :src="folderIconUrl"
                alt=""
                aria-hidden="true"
                decoding="async"
              />
              <div class="group-node__pkg-titles">
                <div class="banner">{{ data.label }}</div>
                <div v-if="data.subtitle" class="banner-sub">{{ data.subtitle }}</div>
              </div>
            </div>
          </template>
          <template v-else>
            <div class="banner">{{ data.label }}</div>
            <div v-if="data.subtitle" class="banner-sub">{{ data.subtitle }}</div>
          </template>
        </div>
      </div>
    </div>
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
  </div>
</template>

<style scoped>
.group-node {
  position: relative;
  width: 100%;
  height: 100%;
}
.group-node__flip-outer {
  position: absolute;
  inset: 0;
  transform-origin: 0 0;
  z-index: 0;
}
.group-node__flip-counter {
  position: absolute;
  inset: 0;
  transform-origin: 0 0;
}
.group-node__frame {
  width: 100%;
  height: 100%;
  border-radius: 12px;
  border: 1px dashed #94a3b8;
  /* ~10% transparent over opaque fill so routing behind stays visible */
  background: rgb(248 250 252 / 0.9);
  box-sizing: border-box;
  position: relative;
}
.group-node__frame--package-scope {
  border-color: rgb(30 41 59 / 0.72);
  border-style: solid;
  border-width: 1px;
  box-shadow:
    inset 6px 0 0 0 #64748b,
    0 1px 3px rgb(15 23 42 / 0.08);
  background: rgb(255 255 255 / 0.94);
}
.group-node__pkg-header {
  position: absolute;
  top: 8px;
  left: 12px;
  right: 12px;
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 10px;
  pointer-events: none;
}
.group-node__folder-icon {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  object-fit: contain;
  opacity: 0.95;
}
.group-node__pkg-titles {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.group-node--focus .group-node__frame {
  border-color: #2563eb;
  box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.45);
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
/**
 * Package-scope header: must come **after** `.banner` / `.banner-sub` so higher specificity wins.
 * Those rules use `position: absolute; left: 10px`, which would paint titles on top of the folder.
 */
.group-node__pkg-header .banner {
  position: static;
  top: auto;
  left: auto;
  right: auto;
  font-size: clamp(0.85rem, 1.4vmin, 1.05rem);
  font-weight: 700;
  color: #0f172a;
  line-height: 1.2;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.group-node__pkg-header .banner-sub {
  position: static;
  top: auto;
  left: auto;
  right: auto;
  font-size: clamp(0.72rem, 1.2vmin, 0.88rem);
  line-height: 1.35;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.gh {
  position: absolute;
  z-index: 12;
}
.gh-agg-in-target {
  top: 50%;
}
</style>
