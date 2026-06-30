<script setup lang="ts">
/**
 * Decorative dependency-layer band: a faint coloured box rendered behind a depth column. Inert —
 * no handles, no pointer events — so it never interferes with boxes or edges. Tint cycles per depth.
 */
import { computed } from 'vue'

const props = defineProps<{ data: { label: string; depth?: number } }>()

// Faint, cycling tints per depth (rgb triples; alpha applied below).
const TINTS = ['59,130,246', '139,92,246', '16,185,129', '245,158,11', '236,72,153']
const rgb = computed(() => TINTS[(props.data.depth ?? 0) % TINTS.length])
</script>

<template>
  <div
    class="layer-band"
    :style="{ background: `rgba(${rgb},0.08)`, borderColor: `rgba(${rgb},0.4)` }"
  >
    <span class="layer-band__label" :style="{ color: `rgba(${rgb},0.95)` }">{{ data.label }}</span>
  </div>
</template>

<style scoped>
.layer-band {
  width: 100%;
  height: 100%;
  border: 1px solid;
  border-radius: 14px;
  pointer-events: none;
  box-sizing: border-box;
}
.layer-band__label {
  position: absolute;
  top: 9px;
  left: 0;
  right: 0;
  text-align: center;
  font: 700 13px ui-sans-serif, system-ui, sans-serif;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
</style>
