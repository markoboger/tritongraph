<script setup lang="ts">
import { computed } from 'vue'
import { innerEdgeMarkerSuffix, type InnerEdgeDraw } from './innerArtefactGraphHelpers'

const props = withDefaults(
  defineProps<{
    edgeMarkerId: string
    draws: readonly InnerEdgeDraw[]
    bridgeDraws?: readonly InnerEdgeDraw[]
    overlay?: boolean
    edgeEmphasized: (draw: InnerEdgeDraw) => boolean
    edgeLabelStyleFor: (draw: InnerEdgeDraw) => Record<string, string>
    onEdgeEnter: (draw: InnerEdgeDraw) => void
    onEdgeLeave: (draw: InnerEdgeDraw) => void
  }>(),
  {
    bridgeDraws: () => [],
    overlay: false,
  },
)

const markerPrefix = computed(() => `${props.edgeMarkerId}${props.overlay ? '-overlay' : ''}`)
const hasEdges = computed(() => props.draws.length > 0 || props.bridgeDraws.length > 0)
</script>

<template>
  <svg
    v-if="hasEdges"
    class="package-box__inner-artefact-edges"
    :class="{ 'package-box__inner-artefact-edges--overlay': overlay }"
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <marker :id="`${markerPrefix}-extends`" class="package-box__inner-edge-marker" markerWidth="14" markerHeight="14" refX="12" refY="6" orient="auto" markerUnits="userSpaceOnUse">
        <path d="M 0 0 L 12 6 L 0 12 z" class="package-box__inner-edge-marker-shape--extends" />
      </marker>
      <marker :id="`${markerPrefix}-hastrait`" class="package-box__inner-edge-marker" markerWidth="14" markerHeight="14" refX="12" refY="6" orient="auto" markerUnits="userSpaceOnUse">
        <path d="M 0 0 L 12 6 L 0 12 z" class="package-box__inner-edge-marker-shape--hastrait" />
      </marker>
      <marker :id="`${markerPrefix}-gets`" class="package-box__inner-edge-marker" markerWidth="14" markerHeight="14" refX="12" refY="6" orient="auto" markerUnits="userSpaceOnUse">
        <path d="M 0 0 L 12 6 L 0 12 z" class="package-box__inner-edge-marker-shape--gets" />
      </marker>
      <marker :id="`${markerPrefix}-creates`" class="package-box__inner-edge-marker" markerWidth="14" markerHeight="14" refX="12" refY="6" orient="auto" markerUnits="userSpaceOnUse">
        <path d="M 0 0 L 12 6 L 0 12 z" class="package-box__inner-edge-marker-shape--creates" />
      </marker>
    </defs>

    <g v-for="bridge in bridgeDraws" :key="bridge.id" class="package-box__inner-edge-group">
      <path
        :d="bridge.path"
        class="package-box__inner-edge-hit"
        fill="none"
        @mouseenter="onEdgeEnter(bridge)"
        @mouseleave="onEdgeLeave(bridge)"
      />
      <path
        :d="bridge.path"
        :class="[
          'package-box__inner-edge-path',
          'package-box__inner-edge-path--bridge',
          { 'package-box__inner-edge-path--emph': edgeEmphasized(bridge) },
          bridge.kind === 'gets' ? 'package-box__inner-edge-path--gets' : null,
          bridge.kind === 'creates' ? 'package-box__inner-edge-path--creates' : null,
        ]"
        fill="none"
        :style="{ stroke: bridge.stroke }"
        :marker-end="`url(#${markerPrefix}-${innerEdgeMarkerSuffix(bridge.kind)})`"
      />
      <text
        v-if="bridge.displayLabel"
        :x="bridge.labelX"
        :y="bridge.labelY - 15"
        class="package-box__inner-edge-label package-box__inner-edge-label--bridge"
        :class="{ 'package-box__inner-edge-label--emph': edgeEmphasized(bridge) }"
        :style="edgeLabelStyleFor(bridge)"
        text-anchor="middle"
        dominant-baseline="middle"
      >
        {{ bridge.displayLabel }}
      </text>
    </g>

    <g v-for="e in draws" :key="e.id" class="package-box__inner-edge-group">
      <path
        :d="e.path"
        class="package-box__inner-edge-hit"
        fill="none"
        @mouseenter="onEdgeEnter(e)"
        @mouseleave="onEdgeLeave(e)"
      />
      <path
        :d="e.path"
        :class="[
          'package-box__inner-edge-path',
          { 'package-box__inner-edge-path--emph': edgeEmphasized(e) },
          e.kind === 'gets' ? 'package-box__inner-edge-path--gets' : null,
          e.kind === 'creates' ? 'package-box__inner-edge-path--creates' : null,
        ]"
        fill="none"
        :style="{ stroke: e.stroke }"
        :marker-end="`url(#${markerPrefix}-${innerEdgeMarkerSuffix(e.kind)})`"
      />
      <text
        v-if="e.displayLabel"
        :x="e.labelX"
        :y="e.labelY - 15"
        class="package-box__inner-edge-label"
        :class="{ 'package-box__inner-edge-label--emph': edgeEmphasized(e) }"
        :style="edgeLabelStyleFor(e)"
        text-anchor="middle"
        dominant-baseline="middle"
      >
        {{ e.displayLabel }}
      </text>
    </g>
  </svg>
</template>

<style scoped>
.package-box__inner-artefact-edges {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
  overflow: visible;
}
.package-box__inner-artefact-edges--overlay {
  z-index: 1;
}
.package-box__inner-edge-hit {
  stroke: transparent;
  stroke-width: 18;
  pointer-events: stroke;
  cursor: default;
}
.package-box__inner-edge-path {
  stroke: var(--box-accent, #64748b);
  stroke-width: 1.35;
  opacity: 0.72;
  vector-effect: non-scaling-stroke;
  stroke-linecap: butt;
  stroke-linejoin: miter;
  pointer-events: none;
  transition:
    stroke-width 0.15s ease,
    opacity 0.15s ease;
}
.package-box__inner-edge-path--emph {
  stroke-width: 2.75;
  opacity: 1;
}
.package-box__inner-edge-path--bridge {
  stroke-width: 2.15;
  opacity: 0.96;
}
.package-box__inner-edge-marker-shape--extends {
  fill: #1d4ed8;
}
.package-box__inner-edge-marker-shape--hastrait {
  fill: #9333ea;
}
.package-box__inner-edge-marker-shape--gets {
  fill: #d97706;
}
.package-box__inner-edge-marker-shape--creates {
  fill: #059669;
}
.package-box__inner-edge-path--gets {
  stroke-dasharray: 5 3;
}
.package-box__inner-edge-path--creates {
  stroke-dasharray: 2 2;
}
.package-box__inner-edge-label {
  paint-order: stroke fill;
  stroke: rgb(248 250 252);
  stroke-width: 3px;
  pointer-events: none;
  transition: opacity 0.15s ease;
}
.package-box__inner-edge-label--emph {
  opacity: 1 !important;
  font-weight: 600 !important;
}
.package-box__inner-edge-label--bridge {
  opacity: 0.98;
}
</style>
