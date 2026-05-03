<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, useSlots, watch } from 'vue'
import BoxMetricStrip from './BoxMetricStrip.vue'
import {
  DIAGRAM_LOGO_BOX_PX,
  nextCompactLayout,
  nextFlatLayout,
  nextMetricsBreakLayout,
  nextSuperflatLayout,
  nextSuperslimLayout,
} from '../diagram/boxChromeLayout'

const props = defineProps<{
  accent: string
  title: string
  subtitle?: string
  titleTooltip?: string
  pinned: boolean
  showPinTool: boolean
  showColorTool: boolean
  hasCoverage?: boolean
  coveragePercent?: number
  technicalDebtPercent?: number
  issueCount?: number
  issueLevel?: 'none' | 'minor' | 'major' | 'blocking'
  pinTitle: string
  pinAriaLabel: string
  allowOverflow?: boolean
  /**
   * When true, keep the **horizontal** compact header (icon | title | subtitle) at any width.
   * Otherwise wide cards use a centered stacked header — fine for standalone project boxes, but
   * wrong for package inner diagrams where the body is a second canvas (packages / artefacts).
   */
  innerDiagramHost?: boolean
}>()

const emit = defineEmits<{
  'toggle-pin': [MouseEvent]
  'cycle-color': []
  'header-dblclick': [MouseEvent]
}>()

const slots = useSlots()

const rootEl = ref<HTMLElement | null>(null)
const shellEl = ref<HTMLElement | null>(null)
const titleEl = ref<HTMLElement | null>(null)
const metricsBreakLayout = ref(false)
const superslimLayout = ref(false)
const slimLayout = ref(false)
const flatLayout = ref(false)
const superflatLayout = ref(false)
const compactLayout = ref(false)

const hasMetricsChrome = computed(() => {
  if (props.hasCoverage) return true
  if (typeof props.issueCount === 'number' && props.issueCount >= 0) return true
  if (props.technicalDebtPercent != null && Number.isFinite(props.technicalDebtPercent)) return true
  return false
})

function syncMetricsBreakChrome(root: HTMLElement) {
  if (!metricsBreakLayout.value) {
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
  /**
   * In slim (metrics-break, non-superslim) chrome, always use vertical title rails — the same
   * headline treatment as long Scala declaration subtitles; short subtitles rarely make the
   * body column taller than it is wide, so aspect-ratio heuristics never tripped for projects.
   */
  slimLayout.value = true
}

function measure() {
  const root = rootEl.value
  if (!root) {
    metricsBreakLayout.value = false
    superslimLayout.value = false
    slimLayout.value = false
    flatLayout.value = false
    superflatLayout.value = false
    compactLayout.value = false
    return
  }
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
    return
  }
  if (compactLayout.value) {
    metricsBreakLayout.value = false
    superslimLayout.value = false
    slimLayout.value = false
    return
  }
  if (!hasMetricsChrome.value) {
    metricsBreakLayout.value = false
    superslimLayout.value = false
    slimLayout.value = false
  } else {
    metricsBreakLayout.value = nextMetricsBreakLayout(
      root.clientWidth,
      root.clientHeight,
      metricsBreakLayout.value,
    )
    syncMetricsBreakChrome(root)
  }
  if (metricsBreakLayout.value) {
    flatLayout.value = false
    superflatLayout.value = false
    compactLayout.value = false
    return
  }
}

const showFocusedSubtitle = computed(() => {
  const hasSub = !!(String(props.subtitle ?? '').trim() || slots.subtitle)
  if (!hasSub) return false
  if (compactLayout.value) return false
  if (superflatLayout.value) return false
  if (superslimLayout.value) return false
  if (metricsBreakLayout.value && slimLayout.value) return true
  return hasSub
})

let ro: ResizeObserver | null = null

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
        if (shellEl.value) observer.observe(shellEl.value)
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

watch(shellEl, (el) => {
  if (!el || !rootEl.value) return
  const r = ro
  if (r) r.observe(el)
})

watch(
  () => [
    props.title,
    props.subtitle,
    props.hasCoverage,
    props.issueCount,
    props.technicalDebtPercent,
    props.showPinTool,
    props.showColorTool,
    props.innerDiagramHost,
  ],
  () => void nextTick(measure),
)

onUnmounted(() => {
  ro?.disconnect()
  ro = null
})
</script>

<template>
  <div
    ref="rootEl"
    class="general-focused-box"
    :class="{
      'general-focused-box--pinned': pinned,
      'general-focused-box--tools-wide': showColorTool,
      'general-focused-box--pin-only': showPinTool && !showColorTool,
      'general-focused-box--has-metrics':
        hasCoverage || technicalDebtPercent != null || issueCount != null,
      'general-focused-box--allow-overflow': allowOverflow,
      'general-focused-box--flat-layout': flatLayout,
      'general-focused-box--superflat-layout': superflatLayout,
      'general-focused-box--compact-layout': compactLayout,
      'general-focused-box--metrics-break': metricsBreakLayout,
      'general-focused-box--superslim-layout': superslimLayout,
      'general-focused-box--slim-layout': metricsBreakLayout && !superslimLayout && slimLayout,
      'general-focused-box--inner-diagram-host': innerDiagramHost,
    }"
    :style="{ '--box-accent': accent, '--triton-diagram-logo-box': `${DIAGRAM_LOGO_BOX_PX}px` }"
  >
    <div class="general-focused-box__tools" @pointerdown.stop>
      <BoxMetricStrip
        class="general-focused-box__metric-strip"
        :coverage-percent="hasCoverage ? coveragePercent ?? 0 : null"
        :technical-debt-percent="technicalDebtPercent"
        :issue-count="issueCount"
        :issue-level="issueLevel"
      />
      <div v-if="showPinTool || showColorTool || $slots['tools-prefix']" class="general-focused-box__tool-row">
        <slot name="tools-prefix" />
        <button
          v-if="showPinTool"
          type="button"
          class="tool-btn tool-btn--pin"
          :class="{ 'tool-btn--active': pinned }"
          :title="pinTitle"
          :aria-pressed="pinned ? 'true' : 'false'"
          :aria-label="pinAriaLabel"
          @click.stop="emit('toggle-pin', $event)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" class="tool-btn__icon tool-btn__icon--pin">
            <path
              fill="currentColor"
              d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"
            />
          </svg>
        </button>
        <button
          v-if="showColorTool"
          type="button"
          class="tool-btn tool-btn--color"
          :title="`Accent: ${accent}. Click for next color.`"
          aria-label="Change box accent color"
          @click.stop="emit('cycle-color')"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" class="tool-btn__icon tool-btn__icon--color">
            <circle cx="6" cy="8" r="4.25" />
            <circle cx="11" cy="8" r="3" opacity="0.45" />
          </svg>
        </button>
      </div>
    </div>

    <div ref="shellEl" class="general-focused-box__shell">
      <div class="general-focused-box__header" @dblclick.stop="emit('header-dblclick', $event)">
        <div class="general-focused-box__header-icon">
          <slot name="header-icon" />
        </div>
        <div
          class="general-focused-box__head-text"
        >
          <div
            ref="titleEl"
            class="title title--header"
            :title="titleTooltip || undefined"
          >
            {{ title }}
          </div>
          <div
            v-if="showFocusedSubtitle"
            class="subtitle subtitle--header"
          >
            <slot name="subtitle">{{ subtitle }}</slot>
          </div>
        </div>
      </div>

      <div class="general-focused-box__body">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.general-focused-box {
  --box-accent: steelblue;
  --triton-diagram-logo-box: 40px;
  --box-fill: color-mix(in srgb, var(--box-accent) 8%, #ffffff);
  --triton-focused-box-pad-x: clamp(6px, 1.35vmin, 14px);
  --triton-focused-box-pad-y: clamp(6px, 1.2vmin, 14px);
  --triton-focused-box-pad-bottom: clamp(2px, 0.35vmin, 6px);
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
  padding: var(--triton-focused-box-pad-y) var(--triton-focused-box-pad-x);
  padding-bottom: var(--triton-focused-box-pad-bottom);
  border-radius: 8px;
  border: 1px solid rgb(30 41 59 / 0.88);
  background: color-mix(in srgb, var(--box-fill) 90%, transparent);
  box-shadow:
    inset 8px 0 0 0 var(--box-accent),
    0 4px 22px rgb(15 23 42 / 0.14);
  outline: 2px solid var(--box-accent);
  outline-offset: 0;
  font-family: ui-sans-serif, system-ui, sans-serif;
  overflow: hidden;
  transition:
    padding 0.45s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.45s ease,
    outline 0.45s ease;
}

.general-focused-box--has-metrics:not(.general-focused-box--metrics-break) {
  padding-top: clamp(16px, 3.8vmin, 24px);
}

.general-focused-box--has-metrics.general-focused-box--metrics-break {
  padding-top: clamp(28px, 6vmin, 44px);
}

.general-focused-box--has-metrics.general-focused-box--metrics-break.general-focused-box--superslim-layout {
  padding-top: clamp(28px, 6vmin, 44px);
}

.general-focused-box--allow-overflow {
  overflow: visible;
}

.general-focused-box__shell {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding-top: 2px;
}

.general-focused-box__header {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  margin-bottom: 8px;
  /**
   * Only the header needs to clear the absolute tool / metric cluster in the top-right corner.
   * The body below should span to the same inset on both sides so compartment dividers feel
   * visually balanced against the left edge.
   */
  padding-right: clamp(44px, 10cqw, 104px);
}

.general-focused-box--metrics-break:not(.general-focused-box--superslim-layout) .general-focused-box__header {
  padding-top: clamp(2px, 0.5vmin, 6px);
}

.general-focused-box__header-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.general-focused-box--flat-layout .general-focused-box__shell {
  justify-content: center;
  padding-top: 0;
}

.general-focused-box--has-metrics.general-focused-box--flat-layout {
  padding-top: 12px;
  padding-bottom: 2px;
}

.general-focused-box--flat-layout .general-focused-box__header {
  align-items: center;
  margin-bottom: 0;
  gap: 8px;
}

.general-focused-box--flat-layout .general-focused-box__header-icon {
  align-self: center;
  height: var(--triton-diagram-logo-box);
  min-height: var(--triton-diagram-logo-box);
  max-height: var(--triton-diagram-logo-box);
}

.general-focused-box--flat-layout .general-focused-box__head-text {
  justify-content: center;
  text-align: left;
  gap: 0;
}

.general-focused-box--flat-layout .title--header,
.general-focused-box--flat-layout .subtitle--header {
  text-align: left;
  line-height: 1.05;
}

.general-focused-box--superflat-layout {
  padding: 0;
}

.general-focused-box--has-metrics.general-focused-box--superflat-layout {
  padding: 0;
}

.general-focused-box--superflat-layout .general-focused-box__shell {
  padding-top: 0;
}

.general-focused-box--superflat-layout .general-focused-box__header {
  margin-bottom: 0;
  padding-right: 0;
  gap: 0;
}

.general-focused-box--superflat-layout .general-focused-box__header-icon {
  width: var(--triton-diagram-logo-box);
  min-width: var(--triton-diagram-logo-box);
  height: var(--triton-diagram-logo-box);
  min-height: var(--triton-diagram-logo-box);
  max-height: var(--triton-diagram-logo-box);
  align-self: stretch;
  align-items: stretch;
  justify-content: flex-start;
}

.general-focused-box--superflat-layout .general-focused-box__header-icon :deep(.lang-svg),
.general-focused-box--superflat-layout .general-focused-box__header-icon :deep(svg) {
  width: var(--triton-diagram-logo-box);
  height: var(--triton-diagram-logo-box);
  max-width: var(--triton-diagram-logo-box);
  max-height: var(--triton-diagram-logo-box);
}

.general-focused-box--superflat-layout .general-focused-box__head-text {
  gap: 0;
}

.general-focused-box--superflat-layout .title--header,
.general-focused-box--superflat-layout .subtitle--header {
  line-height: 1.05;
}

.general-focused-box--superflat-layout .general-focused-box__body {
  display: none;
}

.general-focused-box--compact-layout .general-focused-box__shell {
  justify-content: flex-start;
  padding-top: 8px;
}

.general-focused-box--has-metrics.general-focused-box--compact-layout {
  padding-top: 20px;
}

.general-focused-box--compact-layout .general-focused-box__header {
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  margin-bottom: 0;
}

.general-focused-box--compact-layout .general-focused-box__header-icon {
  justify-content: center;
  align-self: center;
  width: 100%;
  height: 44px;
  min-height: var(--triton-diagram-logo-box);
  max-height: 48px;
}

.general-focused-box--compact-layout .general-focused-box__header-icon :deep(.lang-svg),
.general-focused-box--compact-layout .general-focused-box__header-icon :deep(svg) {
  height: var(--triton-diagram-logo-box);
  max-height: var(--triton-diagram-logo-box);
  width: auto;
}

.general-focused-box--compact-layout .general-focused-box__head-text {
  align-items: stretch;
  text-align: center;
  gap: 0;
}

.general-focused-box--compact-layout .title--header {
  text-align: center;
  line-height: 1.1;
}

.general-focused-box--compact-layout .general-focused-box__body {
  display: none;
}

.general-focused-box--metrics-break:not(.general-focused-box--superslim-layout) .general-focused-box__header-icon,
.general-focused-box--metrics-break.general-focused-box--superslim-layout .general-focused-box__header-icon {
  position: absolute;
  top: 1px;
  left: 1px;
  z-index: 3;
  width: auto;
  height: 44px;
  min-height: var(--triton-diagram-logo-box);
  max-height: 48px;
  align-items: flex-start;
  justify-content: flex-start;
}

.general-focused-box__head-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
}

.general-focused-box--metrics-break:not(.general-focused-box--superslim-layout) .general-focused-box__head-text,
.general-focused-box--metrics-break.general-focused-box--superslim-layout .general-focused-box__head-text {
  padding-left: clamp(var(--triton-diagram-logo-box), 12cqw, 52px);
}

.general-focused-box--slim-layout .general-focused-box__head-text,
.general-focused-box--superslim-layout .general-focused-box__head-text {
  padding-left: 0;
}

.general-focused-box__body {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.general-focused-box--allow-overflow .general-focused-box__body {
  overflow: visible;
}

.general-focused-box__tools {
  position: absolute;
  top: 1px;
  right: 1px;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: flex-end;
  gap: 4px;
  max-width: calc(100% - 2px);
}

.general-focused-box__metric-strip {
  width: min(124px, calc(100% - 2px));
  max-width: min(124px, calc(100% - 2px));
}

.general-focused-box__tool-row {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
  flex-wrap: wrap;
  max-width: 100%;
}

.general-focused-box--slim-layout:not(.general-focused-box--superslim-layout)
  .general-focused-box__head-text {
  --triton-vertical-title-rail-shift-y: -4px;
  width: 100%;
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
  font-size: clamp(0.82rem, min(2.4vmin, 3.8cqh), 1.45rem);
  color: #0f172a;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.title--header:not(.triton-vertical-rail-text) {
  text-align: left;
  writing-mode: horizontal-tb;
  transform: none;
  align-self: stretch;
}

.subtitle {
  font-size: clamp(0.65rem, min(1.45vmin, 2.2cqh), 0.85rem);
  line-height: 1.25;
  color: #475569;
}

.subtitle--header {
  margin-top: 0;
  opacity: 1;
  max-height: none;
  text-align: left;
}

.general-focused-box--superslim-layout .general-focused-box__head-text {
  width: 100%;
}

.general-focused-box--superslim-layout .title.title--header {
  order: 0;
}

.general-focused-box--superslim-layout .subtitle.subtitle--header {
  order: 1;
}

.general-focused-box--superslim-layout .general-focused-box__body {
  display: none;
}

/**
 * Wide focused cards: stack icon above title so the logo is centered in the full box width;
 * title/subtitle span the header and use centered text. Skip when metrics strip stacks — that
 * chrome uses its own corner / vertical-title rules (parity with {@link ProjectBox}).
 */
@container (min-width: 168px) {
  .general-focused-box:not(.general-focused-box--metrics-break):not(.general-focused-box--superslim-layout):not(.general-focused-box--flat-layout):not(.general-focused-box--compact-layout):not(
      .general-focused-box--inner-diagram-host
    )
    .general-focused-box__header {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .general-focused-box:not(.general-focused-box--metrics-break):not(.general-focused-box--superslim-layout):not(.general-focused-box--flat-layout):not(.general-focused-box--compact-layout):not(
      .general-focused-box--inner-diagram-host
    )
    .general-focused-box__header-icon {
    justify-content: center;
    width: 100%;
  }

  .general-focused-box:not(.general-focused-box--metrics-break):not(.general-focused-box--superslim-layout):not(.general-focused-box--flat-layout):not(.general-focused-box--compact-layout):not(
      .general-focused-box--inner-diagram-host
    )
    .general-focused-box__head-text {
    flex: 0 1 auto;
    align-items: stretch;
    width: 100%;
    text-align: center;
  }

  .general-focused-box:not(.general-focused-box--metrics-break):not(.general-focused-box--superslim-layout):not(.general-focused-box--flat-layout):not(.general-focused-box--compact-layout):not(
      .general-focused-box--inner-diagram-host
    )
    .title--header,
  .general-focused-box:not(.general-focused-box--metrics-break):not(.general-focused-box--superslim-layout):not(.general-focused-box--flat-layout):not(.general-focused-box--compact-layout):not(
      .general-focused-box--inner-diagram-host
    )
    .subtitle--header {
    text-align: center;
  }
}
</style>
