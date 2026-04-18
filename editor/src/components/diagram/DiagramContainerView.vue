<script setup lang="ts">
import { computed, provide } from 'vue'
import type { DiagramRootModel } from '../../diagram/model/types'
import { diagramRootModelKey } from '../../diagram/inject'

/**
 * Root diagram container: fills the viewport region and provides the {@link DiagramRootModel}
 * to descendants. Vue Flow nodes remain the transport layer for geometry and edges.
 */
const props = defineProps<{
  model: DiagramRootModel
}>()

const modelRef = computed(() => props.model)
provide(diagramRootModelKey, modelRef)
</script>

<template>
  <div class="diagram-container-view">
    <slot />
  </div>
</template>

<style scoped>
.diagram-container-view {
  width: 100%;
  height: 100%;
  min-height: 0;
  position: relative;
}
</style>
