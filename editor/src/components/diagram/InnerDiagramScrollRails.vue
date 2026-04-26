<script setup lang="ts">
import type { CSSProperties } from 'vue'

defineProps<{
  horizontalNeeded: boolean
  verticalNeeded: boolean
  horizontalRatio: number
  verticalRatio: number
  horizontalThumbStyle: CSSProperties
  verticalThumbStyle: CSSProperties
  onHorizontalInput: (ev: Event) => void
  onVerticalInput: (ev: Event) => void
}>()
</script>

<template>
  <aside
    v-if="verticalNeeded"
    class="inner-v-rail"
    aria-label="Scroll inner diagram vertically"
    @pointerdown.stop
    @wheel.stop
  >
    <input
      class="inner-v-rail__slider"
      type="range"
      min="0"
      max="1000"
      :value="verticalRatio"
      aria-orientation="vertical"
      title="Scroll inner diagram vertically"
      @input="onVerticalInput"
    />
    <div class="inner-v-rail__thumb" :style="verticalThumbStyle" aria-hidden="true" />
  </aside>
  <aside
    v-if="horizontalNeeded"
    class="inner-h-rail"
    aria-label="Scroll inner diagram horizontally"
    @pointerdown.stop
    @wheel.stop
  >
    <input
      class="inner-h-rail__slider"
      type="range"
      min="0"
      max="1000"
      :value="horizontalRatio"
      title="Scroll inner diagram horizontally"
      @input="onHorizontalInput"
    />
    <div class="inner-h-rail__thumb" :style="horizontalThumbStyle" aria-hidden="true" />
  </aside>
</template>

<style scoped>
.inner-v-rail {
  position: absolute;
  top: 4px;
  right: 2px;
  bottom: 20px;
  width: 20px;
  z-index: 8;
  display: flex;
  align-items: stretch;
  justify-content: center;
  pointer-events: auto;
}
.inner-v-rail::before {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  width: 3px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.06);
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.08);
}
.inner-v-rail__slider {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  min-height: 60px;
  margin: 0;
  cursor: grab;
  background: transparent;
  accent-color: transparent;
  writing-mode: vertical-lr;
  position: relative;
  z-index: 2;
  opacity: 0;
}
.inner-v-rail__slider::-webkit-slider-runnable-track {
  background: transparent;
}
.inner-v-rail__slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  background: transparent;
  border: 0;
  box-shadow: none;
}
.inner-v-rail__slider::-moz-range-track {
  background: transparent;
}
.inner-v-rail__slider::-moz-range-thumb {
  width: 12px;
  height: 12px;
  background: transparent;
  border: 0;
  box-shadow: none;
}
.inner-v-rail__thumb {
  position: absolute;
  left: 50%;
  width: 5px;
  min-height: 16px;
  margin-left: -2.5px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.12);
  border: 1px solid rgba(59, 130, 246, 0.22);
  pointer-events: none;
  z-index: 1;
  box-sizing: border-box;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.inner-h-rail {
  position: absolute;
  left: 4px;
  right: 20px;
  bottom: 2px;
  height: 18px;
  z-index: 8;
  display: flex;
  align-items: center;
  justify-content: stretch;
  pointer-events: auto;
}
.inner-h-rail::before {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  height: 3px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.06);
  box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.08);
}
.inner-h-rail__slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 16px;
  min-width: 60px;
  margin: 0;
  cursor: grab;
  background: transparent;
  accent-color: transparent;
  position: relative;
  z-index: 2;
  opacity: 0;
}
.inner-h-rail__slider::-webkit-slider-runnable-track {
  background: transparent;
}
.inner-h-rail__slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  background: transparent;
  border: 0;
  box-shadow: none;
}
.inner-h-rail__slider::-moz-range-track {
  background: transparent;
}
.inner-h-rail__slider::-moz-range-thumb {
  width: 12px;
  height: 12px;
  background: transparent;
  border: 0;
  box-shadow: none;
}
.inner-h-rail__thumb {
  position: absolute;
  top: 50%;
  min-width: 16px;
  height: 5px;
  margin-top: -2.5px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.12);
  border: 1px solid rgba(59, 130, 246, 0.22);
  pointer-events: none;
  z-index: 1;
  box-sizing: border-box;
  transition: background 0.15s ease, border-color 0.15s ease;
}
</style>
