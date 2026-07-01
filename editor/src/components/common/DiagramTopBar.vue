<script setup lang="ts">
defineProps<{
  sourcePath?: string
  sourcePathLogoUrl?: string
  nodeTypes: readonly string[]
  nodeTypeVisibility: Record<string, boolean>
  relationTypes: readonly string[]
  relationTypeVisibility: Record<string, boolean>
  metricTooltipsEnabled: boolean
  focusRelationDepth: number
  metricVisibility: Record<'coverage' | 'debt' | 'issues', boolean>
  /** Draw a faint coloured box behind each dependency-layer column (visual only). */
  layersVisible: boolean
  /** Show the git-diff toggle: only on runtime-workspace tabs with a code model. */
  gitDiffAvailable?: boolean
  /** Grey every box, colouring the ones changed since the diff base. */
  gitDiffVisible?: boolean
  /** Projection mode for CodeModel-backed (Python) tabs; null hides the toggle for other tabs. */
  viewMode?: 'package-graph' | 'flat-modules' | null
}>()

const emit = defineEmits<{
  'update:node-type-visible': [nodeKey: string, visible: boolean]
  'update:relation-type-visible': [relationKey: string, visible: boolean]
  'update:metric-tooltips-enabled': [visible: boolean]
  'update:focus-relation-depth': [depth: number]
  'update:metric-visible': [metricKey: 'coverage' | 'debt' | 'issues', visible: boolean]
  'update:layers-visible': [visible: boolean]
  'update:git-diff-visible': [visible: boolean]
  'update:view-mode': [mode: 'package-graph' | 'flat-modules']
}>()

function displayNodeLabel(nodeKey: string): string {
  return nodeKey.charAt(0).toUpperCase() + nodeKey.slice(1)
}

function displayRelationLabel(relationKey: string): string {
  return relationKey === 'with' ? 'has trait' : relationKey
}

function onNodeToggle(nodeKey: string, ev: Event) {
  const target = ev.target as HTMLInputElement | null
  emit('update:node-type-visible', nodeKey, !!target?.checked)
}

function onRelationToggle(relationKey: string, ev: Event) {
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

function onLayersToggle(ev: Event) {
  const target = ev.target as HTMLInputElement | null
  emit('update:layers-visible', !!target?.checked)
}

function onFocusDepthInput(ev: Event) {
  const target = ev.target as HTMLInputElement | null
  const raw = Number(target?.value ?? 1)
  const depth = Number.isFinite(raw) ? Math.max(1, Math.min(3, Math.round(raw))) : 1
  emit('update:focus-relation-depth', depth)
}
</script>

<template>
  <div
    v-if="sourcePath || relationTypes.length || nodeTypes.length"
    class="diagram-top-bar"
    :class="{ 'diagram-top-bar--with-relations': relationTypes.length > 0 || nodeTypes.length > 0 }"
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

    <div
      v-if="relationTypes.length || nodeTypes.length || sourcePath"
      class="diagram-top-bar__relations"
      aria-label="Diagram controls"
    >
      <template v-if="viewMode">
        <span class="diagram-top-bar__group-label">View</span>
        <div class="diagram-top-bar__viewmode" role="group" aria-label="Diagram view mode">
          <button
            type="button"
            class="diagram-top-bar__viewmode-btn"
            :class="{ 'diagram-top-bar__viewmode-btn--active': viewMode === 'package-graph' }"
            :aria-pressed="viewMode === 'package-graph'"
            title="Top-level packages with rolled-up dependencies; click a package to drill in"
            @click="emit('update:view-mode', 'package-graph')"
          >
            Package graph
          </button>
          <button
            type="button"
            class="diagram-top-bar__viewmode-btn"
            :class="{ 'diagram-top-bar__viewmode-btn--active': viewMode === 'flat-modules' }"
            :aria-pressed="viewMode === 'flat-modules'"
            title="Every module in the current scope, flat (no rollup)"
            @click="emit('update:view-mode', 'flat-modules')"
          >
            Flat modules
          </button>
        </div>
        <span class="diagram-top-bar__sep" aria-hidden="true" />
      </template>
      <template v-if="nodeTypes.length">
        <span class="diagram-top-bar__group-label">Nodes</span>
        <label
          v-for="nodeType in nodeTypes"
          :key="'node-' + nodeType"
          class="diagram-top-bar__check"
          :title="`Show ${displayNodeLabel(nodeType)} nodes`"
        >
          <input
            type="checkbox"
            :aria-label="`Show ${displayNodeLabel(nodeType)} nodes`"
            :checked="nodeTypeVisibility[nodeType] !== false"
            @change="onNodeToggle(nodeType, $event)"
          />
          <span class="diagram-top-bar__check-text">{{ displayNodeLabel(nodeType) }}</span>
        </label>
        <span class="diagram-top-bar__sep" aria-hidden="true" />
      </template>
      <span v-if="relationTypes.length" class="diagram-top-bar__group-label">Relations</span>
      <label
        v-for="rel in relationTypes"
        :key="rel"
        class="diagram-top-bar__check"
        :title="`Show ${displayRelationLabel(rel)} relations`"
      >
        <input
          type="checkbox"
          :aria-label="`Show ${displayRelationLabel(rel)} relations`"
          :checked="relationTypeVisibility[rel] !== false"
          @change="onRelationToggle(rel, $event)"
        />
        <span class="diagram-top-bar__check-text">{{ displayRelationLabel(rel) }}</span>
      </label>
      <span v-if="relationTypes.length" class="diagram-top-bar__sep" aria-hidden="true" />
      <label
        class="diagram-top-bar__check"
        title="Show code coverage metric"
      >
        <input
          type="checkbox"
          aria-label="Show coverage metric"
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
          aria-label="Show debt metric"
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
          aria-label="Show issues metric"
          :checked="metricVisibility.issues !== false"
          @change="onMetricToggle('issues', $event)"
        />
        <span class="diagram-top-bar__check-text">Issues</span>
      </label>
      <span class="diagram-top-bar__sep" aria-hidden="true" />
      <label
        class="diagram-top-bar__check"
        title="Shade each dependency-layer column"
      >
        <input
          type="checkbox"
          aria-label="Show dependency layers"
          :checked="layersVisible"
          @change="onLayersToggle"
        />
        <span class="diagram-top-bar__check-text">Layers</span>
      </label>
      <template v-if="gitDiffAvailable">
        <span class="diagram-top-bar__group-label">Mode</span>
        <div class="diagram-top-bar__viewmode" role="group" aria-label="Diagram colour mode">
          <button
            type="button"
            class="diagram-top-bar__viewmode-btn"
            :class="{ 'diagram-top-bar__viewmode-btn--active': !gitDiffVisible }"
            :aria-pressed="!gitDiffVisible"
            title="Normal box colours"
            @click="emit('update:git-diff-visible', false)"
          >
            Normal
          </button>
          <button
            type="button"
            class="diagram-top-bar__viewmode-btn"
            :class="{ 'diagram-top-bar__viewmode-btn--active': gitDiffVisible }"
            :aria-pressed="!!gitDiffVisible"
            title="Grey the boxes; colour those changed since the last commit"
            @click="emit('update:git-diff-visible', true)"
          >
            Diff
          </button>
        </div>
      </template>
      <span class="diagram-top-bar__sep" aria-hidden="true" />
      <label
        class="diagram-top-bar__check diagram-top-bar__check--tooltips"
        title="Show beginner-friendly metric tooltips"
      >
        <input
          type="checkbox"
          aria-label="Show metric tooltips"
          :checked="metricTooltipsEnabled"
          @change="onTooltipToggle"
        />
        <span class="diagram-top-bar__check-text">Tooltips</span>
      </label>
      <label
        class="diagram-top-bar__focus-depth"
        title="Relation distance shown around a focused Scala artefact"
      >
        <span class="diagram-top-bar__check-text">Focus depth {{ focusRelationDepth }}</span>
        <input
          type="range"
          min="1"
          max="3"
          step="1"
          :value="focusRelationDepth"
          aria-label="Focus relation depth"
          @input="onFocusDepthInput"
        />
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
  /* Stay content-sized and only wrap internally when the row genuinely overflows. The path
     (left) shrinks via ellipsis first, so a hard width cap here is what forced a second row even
     with empty space to the right. */
  max-width: 100%;
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

.diagram-top-bar__group-label {
  font-size: 10px;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  line-height: 1.2;
}

.diagram-top-bar__focus-depth {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  user-select: none;
  white-space: nowrap;
  font-size: 11px;
  color: #334155;
}

.diagram-top-bar__focus-depth input {
  width: 54px;
  margin: 0;
}

.diagram-top-bar__sep {
  width: 1px;
  height: 12px;
  background: rgba(100, 116, 139, 0.35);
}

.diagram-top-bar__viewmode {
  display: inline-flex;
  border: 1px solid rgba(100, 116, 139, 0.4);
  border-radius: 6px;
  overflow: hidden;
}
.diagram-top-bar__viewmode-btn {
  border: none;
  background: transparent;
  padding: 2px 8px;
  font-size: 12px;
  cursor: pointer;
  color: inherit;
}
.diagram-top-bar__viewmode-btn--active {
  background: #2563eb;
  color: #fff;
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
