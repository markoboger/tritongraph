<script setup lang="ts">
defineProps<{
  sourcePath?: string
  sourcePathLogoUrl?: string
  relationTypes: readonly string[]
  relationTypeVisibility: Record<string, boolean>
  metricTooltipsEnabled: boolean
  metricVisibility: Record<'coverage' | 'debt' | 'issues', boolean>
}>()

const emit = defineEmits<{
  'update:relation-type-visible': [relationKey: string, visible: boolean]
  'update:metric-tooltips-enabled': [visible: boolean]
  'update:metric-visible': [metricKey: 'coverage' | 'debt' | 'issues', visible: boolean]
}>()

function onToggle(relationKey: string, ev: Event) {
  const target = ev.target as HTMLInputElement | null
  emit('update:relation-type-visible', relationKey, !!target?.checked)
}

function onTooltipToggle(ev: Event) {
  const target = ev.target as HTMLInputElement | null
  emit('update:metric-tooltips-enabled', !!target?.checked)
}

function onMetricToggle(metricKey: 'coverage' | 'debt' | 'issues', ev: Event) {
  const target = ev.target as HTMLInputElement | null
  emit('update:metric-visible', metricKey, !!target?.checked)
}
</script>

<template>
  <div
    v-if="sourcePath || relationTypes.length"
    class="diagram-top-bar"
    :class="{ 'diagram-top-bar--with-relations': relationTypes.length > 0 }"
  >
    <div v-if="sourcePath" class="diagram-top-bar__path" :title="sourcePath">
      <img
        v-if="sourcePathLogoUrl"
        class="diagram-top-bar__logo"
        :src="sourcePathLogoUrl"
        alt=""
        aria-hidden="true"
      />
      <span class="diagram-top-bar__path-text">{{ sourcePath }}</span>
    </div>

    <div v-if="relationTypes.length || sourcePath" class="diagram-top-bar__relations" aria-label="Diagram controls">
      <label
        v-for="rel in relationTypes"
        :key="rel"
        class="diagram-top-bar__check"
        :title="`Show ${rel} relations`"
      >
        <input
          type="checkbox"
          :checked="relationTypeVisibility[rel] !== false"
          @change="onToggle(rel, $event)"
        />
        <span class="diagram-top-bar__check-text">{{ rel }}</span>
      </label>
      <span v-if="relationTypes.length" class="diagram-top-bar__sep" aria-hidden="true" />
      <label
        class="diagram-top-bar__check"
        title="Show code coverage metric"
      >
        <input
          type="checkbox"
          :checked="metricVisibility.coverage !== false"
          @change="onMetricToggle('coverage', $event)"
        />
        <span class="diagram-top-bar__check-text">Coverage</span>
      </label>
      <label
        class="diagram-top-bar__check"
        title="Show technical debt metric"
      >
        <input
          type="checkbox"
          :checked="metricVisibility.debt !== false"
          @change="onMetricToggle('debt', $event)"
        />
        <span class="diagram-top-bar__check-text">Debt</span>
      </label>
      <label
        class="diagram-top-bar__check"
        title="Show issue count metric"
      >
        <input
          type="checkbox"
          :checked="metricVisibility.issues !== false"
          @change="onMetricToggle('issues', $event)"
        />
        <span class="diagram-top-bar__check-text">Issues</span>
      </label>
      <span class="diagram-top-bar__sep" aria-hidden="true" />
      <label
        class="diagram-top-bar__check diagram-top-bar__check--tooltips"
        title="Show beginner-friendly metric tooltips"
      >
        <input
          type="checkbox"
          :checked="metricTooltipsEnabled"
          @change="onTooltipToggle"
        />
        <span class="diagram-top-bar__check-text">Tooltips</span>
      </label>
    </div>
  </div>
</template>

<style scoped>
.diagram-top-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  pointer-events: none;
  padding: 0 10px 2px 10px;
}

.diagram-top-bar__path,
.diagram-top-bar__relations {
  pointer-events: auto;
  background: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 0 0 4px 4px;
  min-height: 22px;
}

.diagram-top-bar__path {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  max-width: min(58%, 920px);
  padding: 1px 6px 2px 5px;
  user-select: text;
}

.diagram-top-bar__logo {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  display: block;
  object-fit: contain;
}

.diagram-top-bar__path-text {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: #475569;
}

.diagram-top-bar__relations {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 1px 8px 2px;
  max-width: min(42%, 700px);
}

.diagram-top-bar__check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  font-size: 11px;
  color: #334155;
}

.diagram-top-bar__check input {
  margin: 0;
}

.diagram-top-bar__check-text {
  line-height: 1.2;
}

.diagram-top-bar__sep {
  width: 1px;
  height: 12px;
  background: rgba(100, 116, 139, 0.35);
}

@media (max-width: 900px) {
  .diagram-top-bar {
    flex-direction: column;
    align-items: stretch;
    right: 0;
  }

  .diagram-top-bar__path,
  .diagram-top-bar__relations {
    max-width: 100%;
  }
}
</style>
