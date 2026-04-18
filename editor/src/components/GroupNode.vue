<script setup lang="ts">
/** Nested diagram container (group): frame only for now; child modules still use root layout. */
import { Handle, Position } from '@vue-flow/core'
import { AGG_SOURCE_HANDLE, AGG_TARGET_HANDLE, DEP_SOURCE_HANDLE, DEP_TARGET_HANDLE } from '../graph/handles'

defineProps<{
  data: { label: string; subtitle?: string }
}>()
</script>

<template>
  <div class="group-node">
    <Handle :id="DEP_TARGET_HANDLE" class="gh gh-side-left gh-use-dep" type="target" :position="Position.Left" />
    <Handle :id="AGG_TARGET_HANDLE" class="gh gh-side-left gh-use-agg" type="target" :position="Position.Left" />
    <Handle :id="DEP_SOURCE_HANDLE" class="gh gh-side-right gh-use-dep" type="source" :position="Position.Right" />
    <Handle :id="AGG_SOURCE_HANDLE" class="gh gh-side-right gh-use-agg" type="source" :position="Position.Right" />
    <div class="banner">{{ data.label }}</div>
    <div v-if="data.subtitle" class="banner-sub">{{ data.subtitle }}</div>
  </div>
</template>

<style scoped>
.group-node {
  width: 100%;
  height: 100%;
  border-radius: 12px;
  border: 1px dashed #94a3b8;
  background: rgb(248 250 252 / 0.6);
  box-sizing: border-box;
  position: relative;
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
.gh {
  width: 8px;
  height: 8px;
  background: #94a3b8;
  border: 1px solid #64748b;
  position: absolute;
  transform: translateY(-50%);
  z-index: 2;
}
.gh-side-left {
  left: -6px;
}
.gh-side-right {
  right: -6px;
}
.gh-use-dep {
  top: 42%;
}
.gh-use-agg {
  top: 58%;
}
</style>
