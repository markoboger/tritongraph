<script setup lang="ts">
/**
 * One vertical section within a {@link DiagramLayerModel}.
 * Today each section holds at most one box; later multiple boxes can share a section.
 */
</script>

<template>
  <section class="diagram-section">
    <slot />
  </section>
</template>

<style scoped>
.diagram-section {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  flex: 1;
  min-height: 0;
  width: 100%;
}
</style>
