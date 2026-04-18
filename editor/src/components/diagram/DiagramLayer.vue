<script setup lang="ts">
import type { DiagramLayerModel } from '../../diagram/model/types'

/**
 * Represents one dependency column (layer) inside a diagram container.
 * Column positions still come from Vue Flow + depth layout; this component is for composition
 * and future nested rendering (e.g. group-local columns).
 */
defineProps<{
  model: DiagramLayerModel
}>()
</script>

<template>
  <div class="diagram-layer" :data-depth="model.depth" role="presentation">
    <slot />
  </div>
</template>

<style scoped>
.diagram-layer {
  display: contents;
}
</style>
