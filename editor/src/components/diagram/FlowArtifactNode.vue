<script setup lang="ts">
import { computed, ref } from 'vue'
import type { NodeProps } from '@vue-flow/core'
import ScalaArtefactBox from './ScalaArtefactBox.vue'
import BoxMetricStrip from '../common/BoxMetricStrip.vue'

interface FlowArtifactNodeData {
  id: string
  name: string
  subtitle?: string
  accent: string
  pinned: boolean
  showPinTool: boolean
  showColorTool: boolean
  canOpenInEditor: boolean
  focused: boolean
  innerArtefactFocusActive: boolean
  coveragePercent?: number | null
  technicalDebtPercent: number
  issueCount: number
  issueLevel: string
  declaration?: string
  constructorParams?: string
  methodSignatures?: readonly { signature: string; startRow: number }[]
  notes?: string
}

const props = defineProps<NodeProps<FlowArtifactNodeData>>()

const emit = defineEmits<{
  'toggle-pin': [MouseEvent]
  'cycle-color': []
  'open-in-editor': [number | undefined]
}>()

const data = computed(() => props.data as FlowArtifactNodeData)
const accent = computed(() => data.value.accent)
const pinned = computed(() => data.value.pinned)
const showPinTool = computed(() => data.value.showPinTool)
const showColorTool = computed(() => data.value.showColorTool)
const canOpenInEditor = computed(() => data.value.canOpenInEditor)
const focused = computed(() => data.value.focused)
const innerArtefactFocusActive = computed(() => data.value.innerArtefactFocusActive)

const coveragePercent = computed(() => data.value.coveragePercent ?? null)
const technicalDebtPercent = computed(() => data.value.technicalDebtPercent)
const issueCount = computed(() => data.value.issueCount)
const issueLevel = computed(() => data.value.issueLevel)

const declaration = computed(() => data.value.declaration)
const constructorParams = computed(() => data.value.constructorParams)
const methodSignatures = computed(() => data.value.methodSignatures)
const notes = computed(() => data.value.notes)

const emphasized = ref(false)

function onMouseEnter() {
  emphasized.value = true
}

function onMouseLeave() {
  emphasized.value = false
}

function onClick() {
  // Handle artifact click - could trigger focus
}

function onTogglePin(ev: MouseEvent) {
  emit('toggle-pin', ev)
}

function onCycleColor() {
  emit('cycle-color')
}

function onOpenInEditor(line?: number) {
  emit('open-in-editor', line)
}
</script>

<template>
  <div
    class="flow-artefact-node"
    :class="{
      'flow-artefact-node--focused': innerArtefactFocusActive && focused,
      'flow-artefact-node--emphasized': emphasized,
    }"
    :style="{ '--box-accent': accent }"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
    @click="onClick"
  >
    <!-- Focused view: full-height ScalaArtefactBox card -->
    <template v-if="innerArtefactFocusActive && focused">
      <span class="flow-artefact-node__anchor flow-artefact-node__anchor--in" aria-hidden="true" />
      <span class="flow-artefact-node__anchor flow-artefact-node__anchor--out" aria-hidden="true" />
      <ScalaArtefactBox
        :box-id="data.id"
        :label="data.name"
        :subtitle="data.subtitle ?? ''"
        :declaration="declaration"
        :constructor-params="constructorParams"
        :method-signatures="methodSignatures"
        :notes="notes"
        :box-color="accent"
        :pinned="pinned"
        :show-pin-tool="showPinTool"
        :show-color-tool="showColorTool"
        :can-open-in-editor="canOpenInEditor"
        class="flow-artefact-node__focus-card"
        @toggle-pin="onTogglePin"
        @cycle-color="onCycleColor"
        @open-in-editor="onOpenInEditor"
      />
    </template>

    <!-- Normal view: compact row with metrics -->
    <template v-else>
      <div class="flow-artefact-node__row flow-artefact-node__row--has-metrics">
        <div class="flow-artefact-node__metrics">
          <BoxMetricStrip
            :coverage-percent="coveragePercent"
            :technical-debt-percent="technicalDebtPercent"
            :issue-count="issueCount"
            :issue-level="issueLevel as any"
          />
        </div>
        <span
          class="flow-artefact-node__anchor flow-artefact-node__anchor--in"
          :class="{ 'flow-artefact-node__anchor--emph': emphasized }"
          aria-hidden="true"
        />
        <span
          class="flow-artefact-node__anchor flow-artefact-node__anchor--out"
          :class="{ 'flow-artefact-node__anchor--emph': emphasized }"
          aria-hidden="true"
        />
        <div class="flow-artefact-node__text">
          <div class="flow-artefact-node__title">{{ data.name }}</div>
          <div v-if="data.subtitle" class="flow-artefact-node__subtitle">
            {{ data.subtitle }}
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.flow-artefact-node {
  position: relative;
  background: #fff;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  padding: 4px 8px;
  min-width: 120px;
  cursor: pointer;
  transition: box-shadow 0.2s ease;
}

.flow-artefact-node:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.flow-artefact-node__row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.flow-artefact-node__metrics {
  flex-shrink: 0;
}

.flow-artefact-node__anchor {
  position: absolute;
  width: 8px;
  height: 8px;
  background: var(--box-accent, #6366f1);
  border-radius: 50%;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.flow-artefact-node__anchor--in {
  left: -4px;
  top: 50%;
  transform: translateY(-50%);
}

.flow-artefact-node__anchor--out {
  right: -4px;
  top: 50%;
  transform: translateY(-50%);
}

.flow-artefact-node__anchor--emph {
  opacity: 1;
}

.lang-icon-slot {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
}

.lang-svg {
  width: 100%;
  height: 100%;
}

.flow-artefact-node__text {
  flex: 1;
  min-width: 0;
}

.flow-artefact-node__title {
  font-size: 12px;
  font-weight: 500;
  color: #1e293b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.flow-artefact-node__subtitle {
  font-size: 10px;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
