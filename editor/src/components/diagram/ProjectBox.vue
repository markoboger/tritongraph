<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { boxColorForId, type NamedBoxColor } from '../../graph/boxColors'
import cubeIconUrl from '../../assets/language-icons/cube.svg'
import genericIconUrl from '../../assets/language-icons/generic.svg'
import stackedCubesIconUrl from '../../assets/language-icons/stacked-cubes.svg'
import type { BoxCompartment } from '../../diagram/boxCompartments'
import BoxCompartments from '../common/BoxCompartments.vue'
import BoxEditDialog from '../common/BoxEditDialog.vue'
import GeneralFocusedBox from '../common/GeneralFocusedBox.vue'
import BoxMetricStrip from '../common/BoxMetricStrip.vue'
import BoxToolbar from '../common/BoxToolbar.vue'
import MarkdownActionSubtitle from '../common/MarkdownActionSubtitle.vue'
import { buildFocusedBoxCompartments } from '../common/focusedBoxCompartments'
import { useEditableBox } from '../common/useEditableBox'
import { useBoxMetrics } from '../common/useBoxMetrics'
import { nextCompactLayout, nextFlatLayout, nextMetricsBreakLayout, nextSuperflatLayout, nextSuperslimLayout } from './boxChromeLayout'

const props = defineProps<{
  boxId: string
  label: string
  subtitle?: string
  /** Shown when the box is focused (layer drill). */
  notes?: string
  /** Free-text "what does this module do" — surfaced in the AI prompt. */
  description?: string
  kind?: 'project' | 'module' | 'general'
  /** Kept for YAML round-trip; not used for the icon (all project boxes show the cube). */
  language?: string
  compartments?: readonly BoxCompartment[]
  boxColor?: NamedBoxColor | string
  pinned: boolean
  focused: boolean
  showPinTool: boolean
  /** Layer-drill focused box only: show accent color picker. */
  showColorTool: boolean
}>()

const emit = defineEmits<{
  'toggle-pin': [MouseEvent]
  'cycle-color': []
  rename: [string]
  'description-change': [string]
  /** Markdown link in subtitle was clicked. Argument is the raw href (e.g. `triton:packages`). */
  'link-action': [string]
}>()

const accent = computed(() => (props.boxColor as string) || boxColorForId(props.boxId))
const { hasCoverage, coveragePercentValue, simulatedMetrics } = useBoxMetrics(() => props.boxId)
const projectKind = computed<'project' | 'module' | 'general'>(() =>
  props.kind === 'project' ? 'project' : props.kind === 'general' ? 'general' : 'module',
)
const projectIconUrl = computed(() =>
  projectKind.value === 'project'
    ? stackedCubesIconUrl
    : projectKind.value === 'general'
      ? genericIconUrl
      : cubeIconUrl,
)
const displayNoun = computed(() =>
  projectKind.value === 'project' ? 'project' : projectKind.value === 'general' ? 'box' : 'module',
)

const focusedCompartments = computed<readonly BoxCompartment[]>(() =>
  buildFocusedBoxCompartments({
    description: props.description,
    notes: props.notes,
    extraCompartments: props.compartments,
  }),
)

const rootEl = ref<HTMLElement | null>(null)
const bodyEl = ref<HTMLElement | null>(null)
const titleEl = ref<HTMLElement | null>(null)
/** Title too wide for one line or title+subtitle overflow → vertical title; subtitle only when horizontal. */
const tightLayout = ref(false)
const flatLayout = ref(false)
const superflatLayout = ref(false)
const compactLayout = ref(false)
/** When the metric strip stacks (narrow width), pin the logo top-left and keep metrics top-right. */
const metricsBreakLayout = ref(false)
const superslimLayout = ref(false)
/** Vertical title in slim strip mode (non-superslim); matches {@link PackageBox} / {@link GeneralFocusedBox}. */
const slimLayout = ref(false)

function syncMetricsBreakChrome(root: HTMLElement | null) {
  if (!root || !metricsBreakLayout.value) {
    superslimLayout.value = false
    slimLayout.value = false
    return
  }
  const w = root.clientWidth
  superslimLayout.value = nextSuperslimLayout(w, superslimLayout.value)
  if (superslimLayout.value) {
    slimLayout.value = false
    return
  }
  slimLayout.value = true
}

const showUnfocusedSubtitle = computed(() => {
  if (compactLayout.value) return false
  if (superflatLayout.value) return false
  if (superslimLayout.value) return false
  if (metricsBreakLayout.value && slimLayout.value) return !!props.subtitle?.trim()
  return !!props.subtitle?.trim() && !tightLayout.value
})

let measureCanvas: CanvasRenderingContext2D | null = null

function measureTitleWidth(label: string, title: HTMLElement): number {
  if (!measureCanvas) {
    measureCanvas = title.ownerDocument.createElement('canvas').getContext('2d')
  }
  const ctx = measureCanvas
  if (!ctx) return 0
  const cs = getComputedStyle(title)
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
  return ctx.measureText(label).width
}

function measure() {
  const root = rootEl.value
  const title = titleEl.value
  if (!root) {
    flatLayout.value = false
    superflatLayout.value = false
    compactLayout.value = false
    metricsBreakLayout.value = false
    superslimLayout.value = false
    slimLayout.value = false
    return
  }
  const hasMetricsChrome = hasCoverage.value || simulatedMetrics.value.issueCount >= 0
  const borderBox = root.getBoundingClientRect()
  const borderBoxWidth = Math.round(borderBox.width)
  const borderBoxHeight = Math.round(borderBox.height)
  superflatLayout.value = nextSuperflatLayout(borderBoxWidth, borderBoxHeight, superflatLayout.value)
  flatLayout.value = superflatLayout.value || nextFlatLayout(borderBoxWidth, borderBoxHeight, flatLayout.value)
  compactLayout.value = !flatLayout.value && nextCompactLayout(borderBoxWidth, borderBoxHeight)
  if (flatLayout.value) {
    metricsBreakLayout.value = false
    superslimLayout.value = false
    slimLayout.value = false
    tightLayout.value = false
    return
  }
  if (compactLayout.value) {
    metricsBreakLayout.value = false
    superslimLayout.value = false
    slimLayout.value = false
    tightLayout.value = false
    return
  }
  metricsBreakLayout.value = hasMetricsChrome
    ? nextMetricsBreakLayout(root.clientWidth, root.clientHeight, metricsBreakLayout.value)
    : false
  syncMetricsBreakChrome(root)
  if (!title) return
  if (metricsBreakLayout.value) {
    flatLayout.value = false
    superflatLayout.value = false
    tightLayout.value = false
    return
  }
  const label = String(props.label ?? '')
  const hasSubtitle = !!(props.subtitle && String(props.subtitle).trim())
  const padX =
    parseFloat(getComputedStyle(root).paddingLeft) + parseFloat(getComputedStyle(root).paddingRight)
  const availW = Math.max(0, root.clientWidth - padX - 14)
  const tw = measureTitleWidth(label, title)
  const titleTooWide = tw > availW + 2
  const blockOverflow = hasSubtitle && root.scrollHeight > root.clientHeight + 2
  tightLayout.value = titleTooWide || blockOverflow
}

let ro: ResizeObserver | null = null

/**
 * `ref="rootEl"` only exists on the unfocused branch (`v-else`). Re-bind ResizeObserver whenever
 * that element appears — otherwise after layer-drill unfocus the observer stays on a detached
 * node and {@link metricsBreakLayout} / superslim / vertical-body never update (packages already
 * do this in {@link PackageBox}).
 */
watch(
  rootEl,
  (el) => {
    ro?.disconnect()
    ro = null
    if (el) {
      const observer = new ResizeObserver(() => measure())
      ro = observer
      observer.observe(el)
      void nextTick(() => {
        if (titleEl.value) observer.observe(titleEl.value)
        if (bodyEl.value) observer.observe(bodyEl.value)
        measure()
      })
    }
  },
  { flush: 'post' },
)

watch(titleEl, (el) => {
  if (!el || !rootEl.value) return
  const r = ro
  if (r) r.observe(el)
})

watch(bodyEl, (el) => {
  if (!el || !rootEl.value) return
  const r = ro
  if (r) r.observe(el)
})

onMounted(() => {
  void nextTick(() => measure())
})

onUnmounted(() => {
  ro?.disconnect()
  ro = null
})

watch(
  () => [
    props.label,
    props.subtitle,
    props.focused,
    props.notes,
    props.pinned,
    props.boxColor,
    props.language,
    props.showPinTool,
    props.showColorTool,
    props.boxId,
    props.description,
    hasCoverage.value,
    simulatedMetrics.value.issueCount,
  ],
  () => void nextTick(measure),
)

const { editing, draftLabel, draftDescription, startEditing, commitEdit, cancelEdit } = useEditableBox({
  label: () => props.label,
  description: () => props.description,
  onRename: (label) => emit('rename', label),
  onDescriptionChange: (description) => emit('description-change', description),
})
</script>

<template>
  <div class="project-box-host">
    <GeneralFocusedBox
      v-if="focused"
      :accent="accent"
      :title="label"
      :subtitle="subtitle"
      :pinned="pinned"
      :show-pin-tool="showPinTool"
      :show-color-tool="showColorTool"
      :has-coverage="hasCoverage"
      :coverage-percent="coveragePercentValue"
      :technical-debt-percent="simulatedMetrics.technicalDebtPercent"
      :issue-count="simulatedMetrics.issueCount"
      :issue-level="simulatedMetrics.issueLevel"
      :pin-title="`Pin — keep this ${displayNoun} highlighted when another box is zoomed`"
      :pin-aria-label="`Pin ${displayNoun} (stays focused when zooming elsewhere)`"
      :title-tooltip="`Double-click to rename / edit ${displayNoun} description`"
      @toggle-pin="emit('toggle-pin', $event)"
      @cycle-color="emit('cycle-color')"
      @header-dblclick="startEditing"
    >
      <template #header-icon>
        <div class="lang-icon-slot lang-icon-slot--header">
          <img class="lang-svg cube-icon" :src="projectIconUrl" alt="" aria-hidden="true" decoding="async" />
        </div>
      </template>
      <template #subtitle>
        <MarkdownActionSubtitle :text="subtitle" @link-action="emit('link-action', $event)" />
      </template>
      <div class="project-box__focus-body">
        <BoxCompartments :compartments="focusedCompartments" variant="dense" />
      </div>
    </GeneralFocusedBox>

    <div
      v-else
      ref="rootEl"
      class="project-box"
      :class="{
        'project-box--flat-layout': flatLayout,
        'project-box--superflat-layout': superflatLayout,
        'project-box--compact-layout': compactLayout,
        'project-box--tight': tightLayout,
        'project-box--pinned': pinned,
        'project-box--tools-wide': showColorTool,
        'project-box--pin-only': showPinTool && !showColorTool,
        'project-box--editing': editing,
        'project-box--has-metrics': hasCoverage || simulatedMetrics.issueCount >= 0,
        'project-box--metrics-break': metricsBreakLayout,
      'project-box--superslim-layout': superslimLayout,
      'project-box--slim-layout': metricsBreakLayout && !superslimLayout && slimLayout,
      }"
      :style="{ '--box-accent': accent }"
    >
      <div class="project-box__metrics">
        <BoxMetricStrip
          :coverage-percent="hasCoverage ? coveragePercentValue : null"
          :technical-debt-percent="simulatedMetrics.technicalDebtPercent"
          :issue-count="simulatedMetrics.issueCount"
          :issue-level="simulatedMetrics.issueLevel"
        />
      </div>
      <BoxToolbar
        class="project-box__tools"
        :accent="accent"
        :pinned="pinned"
        :show-pin-tool="showPinTool"
        :show-color-tool="showColorTool"
        :pin-title="`Pin — keep this ${displayNoun} highlighted when another box is zoomed`"
        :pin-aria-label="`Pin ${displayNoun} (stays focused when zooming elsewhere)`"
        @toggle-pin="emit('toggle-pin', $event)"
        @cycle-color="emit('cycle-color')"
      />

      <div class="lang-icon-slot">
        <img class="lang-svg cube-icon" :src="projectIconUrl" alt="" aria-hidden="true" decoding="async" />
      </div>

      <div
        ref="bodyEl"
        class="project-box__body"
        @dblclick.stop="startEditing"
      >
        <div
          class="project-box__header"
          :class="{ 'triton-vertical-rail-container': superslimLayout || (metricsBreakLayout && slimLayout) }"
        >
          <div
            ref="titleEl"
            class="title"
            :class="{
              'title--metrics-break-vertical':
                metricsBreakLayout && !superslimLayout && slimLayout,
              'triton-vertical-rail-text triton-vertical-title-rail':
                superslimLayout || (metricsBreakLayout && slimLayout),
            }"
            :title="
              superslimLayout || (metricsBreakLayout && slimLayout)
                ? undefined
                : `Double-click to rename / edit ${displayNoun} description`
            "
          >{{ label }}</div>
          <div
            v-if="showUnfocusedSubtitle"
            class="subtitle"
            :class="{
              'triton-vertical-rail-text triton-vertical-subtitle-rail':
                superslimLayout || (metricsBreakLayout && slimLayout),
            }"
          >
            <MarkdownActionSubtitle :text="subtitle" @link-action="emit('link-action', $event)" />
          </div>
        </div>
        <div
          v-if="
            description &&
            !tightLayout &&
            !flatLayout &&
            !compactLayout &&
            !superslimLayout &&
            !(metricsBreakLayout && slimLayout)
          "
          class="description-preview"
          :title="description"
        >
          {{ description }}
        </div>
      </div>
    </div>

    <BoxEditDialog
      v-if="editing"
      class="project-box__editor nodrag nopan"
      :dialog-label="`Edit ${displayNoun}`"
      :description-placeholder="`Describe what this ${displayNoun} should do (included in the generated AI prompt)…`"
      v-model:model-value-label="draftLabel"
      v-model:model-value-description="draftDescription"
      @save="commitEdit"
      @cancel="cancelEdit"
    />
  </div>
</template>

<style scoped>
.project-box-host {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.project-box {
  --box-accent: steelblue;
  /**
   * Body fill is a faint wash of the accent strip — same recipe as `.package-box` so
   * project boxes, package boxes, Scala leaves, and inner artefact rows all share the
   * same family-color identity (not just the left strip). The 90% alpha keeps the box
   * slightly translucent so dependency edges routed under it stay faintly visible.
   */
  --box-fill: color-mix(in srgb, var(--box-accent) 8%, #ffffff);
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  container-type: size;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: stretch;
  padding: clamp(6px, 1.2vmin, 14px) clamp(6px, 1.35vmin, 14px);
  padding-right: clamp(6px, 1.35vmin, 14px);
  border-radius: 8px;
  border: 1px solid rgb(30 41 59 / 0.88);
  background: color-mix(in srgb, var(--box-fill) 90%, transparent);
  box-shadow: inset 5px 0 0 0 var(--box-accent), 0 1px 2px rgb(15 23 42 / 0.08);
  font-family: ui-sans-serif, system-ui, sans-serif;
  overflow: hidden;
  transition:
    padding 0.45s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.45s ease,
    outline 0.45s ease;
}

/** Pin alone: one control, normal column width. */
.project-box--pin-only {
  padding-right: clamp(34px, 6.5cqw, 44px);
}

/** Focused (layer drill): pin + color. */
.project-box--tools-wide {
  padding-right: clamp(72px, 12cqw, 108px);
}

/* Metrics + tools float top-right; keep horizontal padding symmetric (base `.project-box` rule). */
.project-box--has-metrics {
  padding-top: clamp(16px, 3.8vmin, 24px);
}

.project-box--has-metrics.project-box--metrics-break {
  padding-top: clamp(36px, 7.5vmin, 52px);
}

.project-box__metrics {
  position: absolute;
  top: 1px;
  right: 1px;
  z-index: 4;
  width: min(124px, calc(100% - 2px));
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  box-sizing: border-box;
}

.lang-icon-slot {
  display: flex;
  justify-content: center;
  align-items: center;
  align-self: stretch;
  flex-shrink: 0;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  height: clamp(40px, min(30cqw, 28cqh), 160px);
  min-height: 36px;
  margin-bottom: clamp(6px, 1.5cqh, 16px);
  transform: none;
  pointer-events: none;
}
.lang-icon-slot :deep(svg),
.lang-icon-slot :deep(.lang-svg) {
  display: block;
  height: min(100%, 36cqw);
  width: auto;
  max-height: 100%;
  max-width: min(92cqw, 240px);
}

.lang-icon-slot--header {
  width: 40px;
  height: 40px;
  margin: 0;
  flex-shrink: 0;
  align-self: flex-start;
}
.lang-icon-slot--header :deep(.lang-svg) {
  max-height: 34px;
  height: auto;
  max-width: 34px;
}
.project-box--tight .lang-icon-slot {
  transform: none;
}
.project-box__body {
  flex: 1;
  min-height: 0;
  min-width: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: stretch;
}
.project-box__header {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  width: 100%;
  align-items: stretch;
}

.project-box:not(.project-box--tight) .project-box__header .title,
.project-box:not(.project-box--tight) .project-box__header .subtitle,
.project-box:not(.project-box--tight) .project-box__body > .description-preview {
  text-align: center;
  align-self: stretch;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.project-box--flat-layout {
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: 0;
  padding-top: 2px;
  padding-bottom: 2px;
}

.project-box--has-metrics.project-box--flat-layout {
  padding-top: 12px;
  padding-bottom: 2px;
}

.project-box--flat-layout .lang-icon-slot {
  width: auto;
  min-width: 0;
  flex: 0 0 auto;
  align-self: center;
  height: 40px;
  min-height: 40px;
  max-height: 40px;
  margin-bottom: 0;
  margin-right: 8px;
  justify-content: center;
}

.project-box--flat-layout .lang-icon-slot :deep(.lang-svg),
.project-box--flat-layout .lang-icon-slot :deep(svg) {
  height: 40px;
  max-height: 40px;
  max-width: 40px;
  width: auto;
}

.project-box--flat-layout .project-box__body {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  align-items: flex-start;
  justify-content: center;
  text-align: left;
}

.project-box--flat-layout .project-box__header {
  align-items: flex-start;
  gap: 0;
}

.project-box--flat-layout .title,
.project-box--flat-layout .subtitle {
  text-align: left;
  align-self: stretch;
  line-height: 1.05;
}

.project-box--superflat-layout {
  padding: 0;
}

.project-box--has-metrics.project-box--superflat-layout {
  padding: 0;
}

.project-box--superflat-layout .lang-icon-slot {
  width: 40px;
  min-width: 40px;
  height: 40px;
  min-height: 40px;
  max-height: 40px;
  align-self: stretch;
  align-items: stretch;
  justify-content: flex-start;
  margin: 0;
}

.project-box--superflat-layout .lang-icon-slot :deep(.lang-svg),
.project-box--superflat-layout .lang-icon-slot :deep(svg) {
  height: 40px;
  width: 40px;
  max-height: 40px;
  max-width: 40px;
}

.project-box--superflat-layout .project-box__header {
  gap: 0;
}

.project-box--superflat-layout .title,
.project-box--superflat-layout .subtitle {
  line-height: 1.05;
}

.project-box--compact-layout {
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  padding-top: 12px;
  padding-bottom: 8px;
}

.project-box--has-metrics.project-box--compact-layout {
  padding-top: 20px;
}

.project-box--compact-layout .lang-icon-slot {
  width: auto;
  min-width: 0;
  align-self: center;
  height: 44px;
  min-height: 40px;
  max-height: 48px;
  margin-bottom: 2px;
}

.project-box--compact-layout .lang-icon-slot :deep(.lang-svg),
.project-box--compact-layout .lang-icon-slot :deep(svg) {
  height: 40px;
  max-height: 40px;
  width: auto;
}

.project-box--compact-layout .project-box__body {
  flex: 1 1 auto;
  min-height: 0;
  justify-content: flex-start;
  text-align: center;
}

.project-box--compact-layout .project-box__header {
  align-items: center;
  gap: 0;
  min-height: 0;
}

.project-box--compact-layout .title {
  text-align: center;
  align-self: center;
  max-width: 100%;
  line-height: 1.1;
}

/**
 * Narrow metrics-break only: pin logo top-left (same contract as {@link PackageBox} unfocused).
 * Wide boxes keep the centered column — do not apply to every `has-metrics` card.
 */
.project-box--has-metrics.project-box--metrics-break .lang-icon-slot {
  position: absolute;
  top: 1px;
  left: 1px;
  z-index: 3;
  align-self: flex-start;
  justify-content: flex-start;
  align-items: flex-start;
  width: auto;
  min-height: 40px;
  height: 44px;
  max-height: 48px;
  margin: 0;
}

.project-box--has-metrics.project-box--metrics-break .project-box__body {
  justify-content: flex-start;
}

.project-box--has-metrics.project-box--metrics-break .lang-icon-slot :deep(.lang-svg),
.project-box--has-metrics.project-box--metrics-break .lang-icon-slot :deep(svg) {
  height: 40px;
  max-height: 40px;
  width: auto;
}

.project-box--has-metrics.project-box--metrics-break .project-box__header {
  padding-left: clamp(40px, 12cqw, 52px);
}

.project-box--slim-layout .project-box__header,
.project-box--superslim-layout .project-box__header {
  padding-left: 0;
}

.project-box--has-metrics.project-box--metrics-break .project-box__header .title,
.project-box--has-metrics.project-box--metrics-break .project-box__header .subtitle,
.project-box--has-metrics.project-box--metrics-break .project-box__body > .description-preview {
  text-align: left;
}

/** Superslim: keep metric strip + tools in the top-right corner; reserve the same top band as non-superslim break. */
.project-box--has-metrics.project-box--metrics-break.project-box--superslim-layout {
  padding-top: clamp(36px, 7.5vmin, 52px);
}

.project-box--slim-layout:not(.project-box--superslim-layout) .project-box__header {
  --triton-vertical-title-rail-shift-y: -4px;
  width: 100%;
}

.project-box--slim-layout .project-box__header,
.project-box--superslim-layout .project-box__header {
  height: auto;
  max-height: 100%;
  align-items: flex-start !important;
}

.project-box--slim-layout .project-box__header .triton-vertical-title-rail,
.project-box--superslim-layout .project-box__header .triton-vertical-title-rail {
  height: auto !important;
  align-self: flex-start !important;
}

.project-box__focus-body {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow: hidden;
}
.project-box__focus-panel {
  border: 1px solid rgb(15 23 42 / 0.12);
  border-radius: 8px;
  background: rgb(255 255 255 / 0.55);
  overflow: hidden;
}
.project-box__focus-panel-label {
  padding: 6px 9px;
  background: rgb(248 250 252 / 0.95);
  color: #475569;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.drill-note {
  padding: 8px 9px 9px;
  font-size: 10px;
  line-height: 1.45;
  color: #334155;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  white-space: pre-wrap;
  overflow: auto;
  text-align: left;
}
.project-box__tools {
  position: absolute;
  top: 1px;
  right: 1px;
  z-index: 4;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 5px;
  max-width: calc(100% - 2px);
}
.project-box--has-metrics .project-box__tools {
  top: 17px;
}
.project-box--has-metrics.project-box--metrics-break .project-box__tools {
  top: 40px;
}
.project-box--pinned:not(.project-box--focused) {
  box-shadow:
    inset 5px 0 0 0 var(--box-accent),
    0 1px 2px rgb(15 23 42 / 0.08),
    0 0 0 1px rgb(30 41 59 / 0.1);
}
.tool-btn {
  width: 26px;
  height: 26px;
  border-radius: 999px;
  border: 1px solid rgb(15 23 42 / 0.22);
  background: rgb(255 255 255 / 0.92);
  display: grid;
  place-items: center;
  cursor: pointer;
  padding: 0;
  color: rgb(51 65 85);
  box-shadow: 0 1px 2px rgb(15 23 42 / 0.06);
  transition: border-color 0.2s ease, background 0.2s ease, transform 0.15s ease, color 0.2s ease;
}
.tool-btn:hover {
  border-color: var(--box-accent);
  background: rgb(255 255 255 / 1);
  transform: scale(1.06);
}
.tool-btn:active {
  transform: scale(0.96);
}
.tool-btn--active {
  border-color: var(--box-accent);
  color: var(--box-accent);
  background: rgb(255 255 255 / 1);
}
.tool-btn__icon {
  width: 14px;
  height: 14px;
  display: block;
}
.tool-btn__icon--color {
  fill: var(--box-accent);
}
.tool-btn__icon--pin {
  fill: currentColor;
}
.title {
  font-weight: 600;
  font-size: clamp(0.78rem, min(2.2vmin, 3.5cqh), 1.35rem);
  color: #0f172a;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  transition: none;
}
.subtitle {
  margin-top: clamp(2px, 0.6vmin, 8px);
  font-size: clamp(0.65rem, min(1.6vmin, 2.5cqh), 0.95rem);
  color: #475569;
  line-height: 1.25;
  opacity: 1;
  max-height: 80px;
  overflow: hidden;
  transition: none;
}
.project-box--tight .title {
  white-space: nowrap;
  overflow: visible;
  text-overflow: clip;
  max-width: none;
  max-height: 100%;
  align-self: center;
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  text-orientation: mixed;
  line-height: 1.15;
}
.project-box--tight .subtitle {
  opacity: 0;
  margin-top: 0;
  max-height: 0;
  transform: translateY(4px);
  pointer-events: none;
}
.subtitle-link {
  display: inline;
  font: inherit;
  color: var(--box-accent);
  background: none;
  border: 0;
  padding: 0;
  margin: 0;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.subtitle-link:hover {
  filter: brightness(0.85);
}
.description-preview {
  margin-top: clamp(2px, 0.5vmin, 6px);
  font-size: clamp(0.6rem, min(1.4vmin, 2.2cqh), 0.8rem);
  color: #64748b;
  line-height: 1.3;
  font-style: italic;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  max-height: 2.6em;
}

.project-box--superslim-layout .project-box__header {
  width: 100%;
  height: fit-content;
  align-self: flex-start;
  align-items: flex-start !important;
}

.project-box--superslim-layout .project-box__header .title {
  order: 0;
  align-self: flex-start !important;
}

.project-box--superslim-layout .project-box__header .subtitle {
  order: 1;
}

.project-box--superslim-layout .project-box__body > .description-preview {
  display: block;
  font-style: italic;
}
.description-full {
  padding: 8px 9px 9px;
  font-size: 10.5px;
  line-height: 1.45;
  color: #334155;
  white-space: pre-wrap;
  overflow: auto;
  text-align: left;
  font-style: italic;
}
.project-box__compartments {
  margin-top: 0;
}
/* Allow the floating editor to render above/around the small (200×72) box without being clipped. */
.project-box--editing {
  overflow: visible;
}
.project-box__editor {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 50;
  width: max(280px, 100%);
  max-width: 360px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  background: #ffffff;
  border: 1px solid var(--box-accent);
  border-radius: 8px;
  box-shadow: 0 12px 32px rgb(15 23 42 / 0.18), 0 2px 6px rgb(15 23 42 / 0.08);
  font-family: ui-sans-serif, system-ui, sans-serif;
  cursor: auto;
  text-align: left;
}
.editor-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.editor-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #64748b;
  font-weight: 600;
}
.title-input {
  font-family: inherit;
  font-weight: 600;
  font-size: 14px;
  color: #0f172a;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  padding: 5px 8px;
  background: #fff;
  outline: none;
  width: 100%;
  box-sizing: border-box;
}
.description-input {
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-size: 12px;
  line-height: 1.45;
  color: #0f172a;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  padding: 6px 8px;
  background: #fff;
  outline: none;
  resize: vertical;
  min-height: 80px;
  max-height: 240px;
  width: 100%;
  box-sizing: border-box;
}
.description-input:focus,
.title-input:focus {
  border-color: var(--box-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--box-accent) 20%, transparent);
}
.editor-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
}
.edit-hint {
  font-size: 10px;
  color: #94a3b8;
  font-style: italic;
  margin-right: auto;
}
.editor-btn {
  font-family: inherit;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid #cbd5e1;
  background: #f1f5f9;
  color: #0f172a;
  cursor: pointer;
}
.editor-btn:hover {
  background: #e2e8f0;
}
.editor-btn--primary {
  background: var(--box-accent);
  border-color: var(--box-accent);
  color: #fff;
}
.editor-btn--primary:hover {
  filter: brightness(0.95);
}
</style>
