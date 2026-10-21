<script setup lang="ts">
/**
 * Invisible landing points for the outer edges of a focused box: one per box that imports into this
 * tile, at the tile's left edge and vertical middle. {@link DepthRelationHandles} measures them and
 * draws a line from the incoming edge's handle to each, so the edge visibly continues to its tiles.
 */
defineProps<{ accessedFrom: readonly string[] }>()
</script>

<template>
  <span
    v-for="boxId in accessedFrom"
    :key="boxId"
    class="package-box__external-endpoint tile-entry-anchor"
    :data-triton-foreign-package-id="boxId"
    aria-hidden="true"
  >
    <span class="package-box__port tile-entry-anchor__port" />
  </span>
</template>

<style scoped>
.tile-entry-anchor {
  position: absolute;
  top: 50%;
  left: 0;
  width: 0;
  height: 0;
  pointer-events: none;
}
.tile-entry-anchor__port {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
}
</style>
