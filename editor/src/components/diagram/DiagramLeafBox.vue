<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import BoxMetricStrip, { type BoxIssueLevel } from '../common/BoxMetricStrip.vue'
import KindBadge from './KindBadge.vue'
import {
  DIAGRAM_LOGO_BOX_PX,
  nextCompactLayout,
  nextFlatLayout,
  nextMetricsBreakLayout,
  nextSuperflatLayout,
  nextSuperslimLayout,
  nextTightLayout,
} from './boxChromeLayout'

const props = defineProps<{
  label: string
  subtitle?: string
  iconUrl?: string
  iconAlt?: string
  kindBadge?: string
  accent: string
  coveragePercent?: number | null
  technicalDebtPercent?: number | null
  issueCount?: number | null
  issueLevel?: BoxIssueLevel | null
}>()

const rootEl = ref<HTMLElement | null>(null)
const superflatLayout = ref(false)
const flatLayout = ref(false)
const compactLayout = ref(false)
const tightLayout = ref(false)
const metricsBreakLayout = ref(false)
const superslimLayout = ref(false)
const slimLayout = ref(false)

const hasMetricsChrome = computed(() => {
  if (typeof props.coveragePercent === 'number' && Number.isFinite(props.coveragePercent)) return true
  if (typeof props.technicalDebtPercent === 'number' && Number.isFinite(props.technicalDebtPercent)) return true
  if (typeof props.issueCount === 'number' && Number.isFinite(props.issueCount) && props.issueCount >= 0) return true
  return false
})

const showSubtitle = computed(() => {
  if (!props.subtitle?.trim()) return false
  if (compactLayout.value || superflatLayout.value || superslimLayout.value) return false
  return true
})

function measure() {
  const root = rootEl.value
  if (!root) {
    superflatLayout.value = false
    flatLayout.value = false
    compactLayout.value = false
    tightLayout.value = false
    metricsBreakLayout.value = false
    superslimLayout.value = false
    slimLayout.value = false
    return
  }
  const rect = root.getBoundingClientRect()
  const w = Math.round(rect.width)
  const h = Math.round(rect.height)

  superflatLayout.value = nextSuperflatLayout(w, h, superflatLayout.value)
  flatLayout.value = superflatLayout.value || nextFlatLayout(w, h, flatLayout.value)
  compactLayout.value = !flatLayout.value && nextCompactLayout(w, h)
  if (flatLayout.value || compactLayout.value) {
    tightLayout.value = false
    metricsBreakLayout.value = false
    superslimLayout.value = false
    slimLayout.value = false
    return
  }

  tightLayout.value = nextTightLayout(w, h)
  metricsBreakLayout.value = hasMetricsChrome.value
    ? nextMetricsBreakLayout(w, h, metricsBreakLayout.value)
    : false
  superslimLayout.value = metricsBreakLayout.value
    ? nextSuperslimLayout(w, superslimLayout.value)
    : false
  slimLayout.value = metricsBreakLayout.value && !superslimLayout.value
}

let ro: ResizeObserver | null = null

watch(
  rootEl,
  (el) => {
    ro?.disconnect()
    ro = null
    if (!el) {
      measure()
      return
    }
    ro = new ResizeObserver(() => measure())
    ro.observe(el)
    void nextTick(measure)
  },
  { flush: 'post' },
)

watch(
  () => [props.label, props.subtitle, hasMetricsChrome.value],
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
    class="diagram-leaf-box"
    :class="{
      'diagram-leaf-box--has-metrics': hasMetricsChrome,
      'diagram-leaf-box--compact-layout': compactLayout,
      'diagram-leaf-box--tight': tightLayout,
      'diagram-leaf-box--flat-layout': flatLayout,
      'diagram-leaf-box--superflat-layout': superflatLayout,
      'diagram-leaf-box--metrics-break': metricsBreakLayout,
      'diagram-leaf-box--slim-layout': metricsBreakLayout && slimLayout,
      'diagram-leaf-box--superslim-layout': superslimLayout,
    }"
    :style="{ '--box-accent': accent, '--triton-diagram-logo-box': `${DIAGRAM_LOGO_BOX_PX}px` }"
  >
    <div class="diagram-leaf-box__metrics">
      <BoxMetricStrip
        :coverage-percent="coveragePercent"
        :technical-debt-percent="technicalDebtPercent"
        :issue-count="issueCount"
        :issue-level="issueLevel"
      />
    </div>
    <slot name="overlay" />
    <div class="diagram-leaf-box__icon">
      <img
        v-if="iconUrl"
        class="diagram-leaf-box__icon-img"
        :src="iconUrl"
        :alt="iconAlt ?? ''"
        aria-hidden="true"
        decoding="async"
      />
      <KindBadge v-else-if="kindBadge" :text="kindBadge" :title="subtitle ?? ''" :accent="accent" />
    </div>
    <div
      class="diagram-leaf-box__text"
      :class="{ 'triton-vertical-rail-container': superslimLayout || (metricsBreakLayout && slimLayout) }"
    >
      <div
        class="diagram-leaf-box__title"
        :class="{
          'triton-vertical-rail-text triton-vertical-title-rail':
            superslimLayout || (metricsBreakLayout && slimLayout),
        }"
        :title="superslimLayout || (metricsBreakLayout && slimLayout) ? undefined : label"
      >
        {{ label }}
      </div>
      <div
        v-if="showSubtitle"
        class="diagram-leaf-box__subtitle"
        :class="{
          'triton-vertical-rail-text triton-vertical-subtitle-rail':
            superslimLayout || (metricsBreakLayout && slimLayout),
        }"
      >
        {{ subtitle }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.diagram-leaf-box {
  --triton-diagram-logo-box: 40px;
  position: relative;
  flex: 1 1 0;
  min-width: var(--triton-diagram-logo-box);
  min-height: 0;
  width: 100%;
  box-sizing: border-box;
  padding: 8px 8px 6px 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  border-radius: 8px;
  border: 1px solid rgb(30 41 59 / 0.88);
  background: color-mix(
    in srgb,
    color-mix(in srgb, var(--box-accent, steelblue) 8%, #ffffff) 90%,
    transparent
  );
  box-shadow:
    inset 5px 0 0 0 var(--box-accent, steelblue),
    0 1px 2px rgb(15 23 42 / 0.08);
  overflow: hidden;
}

.diagram-leaf-box--has-metrics {
  padding-top: 20px;
}

.diagram-leaf-box__metrics {
  position: absolute;
  top: 1px;
  right: 1px;
  z-index: 2;
  max-width: calc(100% - 2px);
  pointer-events: none;
}

.diagram-leaf-box__icon {
  display: flex;
  justify-content: center;
  align-items: center;
  align-self: stretch;
  width: 100%;
  min-height: var(--triton-diagram-logo-box);
  max-height: 48px;
  margin: 0;
  flex-shrink: 0;
  pointer-events: none;
}

.diagram-leaf-box__icon-img {
  height: var(--triton-diagram-logo-box);
  max-height: var(--triton-diagram-logo-box);
  width: auto;
}

.diagram-leaf-box__text {
  flex: 0 1 auto;
  min-width: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: stretch;
  text-align: center;
}

.diagram-leaf-box__title {
  font-weight: 600;
  font-size: clamp(0.72rem, min(1.6vmin, 2.4cqh), 0.95rem);
  color: #0f172a;
  line-height: 1.25;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
  align-self: stretch;
  width: 100%;
}

.diagram-leaf-box__subtitle {
  font-size: clamp(0.62rem, min(1.35vmin, 2cqh), 0.8rem);
  color: #64748b;
  line-height: 1.3;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
  align-self: stretch;
  width: 100%;
}

.diagram-leaf-box--compact-layout {
  justify-content: flex-start;
  gap: 6px;
}

.diagram-leaf-box--flat-layout,
.diagram-leaf-box--superflat-layout {
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: 0;
  padding: 2px 6px 2px 8px;
}

.diagram-leaf-box--has-metrics.diagram-leaf-box--flat-layout {
  padding-top: 12px;
}

/* Superflat drops default padding; keep left inset so the 5px accent strip does not paint over the logo. */
.diagram-leaf-box--superflat-layout,
.diagram-leaf-box--has-metrics.diagram-leaf-box--superflat-layout {
  padding: 2px 6px 2px 8px;
}

.diagram-leaf-box--flat-layout .diagram-leaf-box__icon {
  flex: 0 0 auto;
  align-self: center;
  width: auto;
  min-width: var(--triton-diagram-logo-box);
  height: var(--triton-diagram-logo-box);
  min-height: var(--triton-diagram-logo-box);
  max-height: var(--triton-diagram-logo-box);
  margin-right: 8px;
}

.diagram-leaf-box--superflat-layout .diagram-leaf-box__icon {
  flex: 0 0 auto;
  align-self: stretch;
  width: var(--triton-diagram-logo-box);
  min-width: var(--triton-diagram-logo-box);
  height: var(--triton-diagram-logo-box);
  min-height: var(--triton-diagram-logo-box);
  max-height: var(--triton-diagram-logo-box);
  margin: 0;
  justify-content: flex-start;
}

.diagram-leaf-box--flat-layout .diagram-leaf-box__icon-img {
  max-width: var(--triton-diagram-logo-box);
}

.diagram-leaf-box--superflat-layout .diagram-leaf-box__icon-img {
  width: var(--triton-diagram-logo-box);
  height: var(--triton-diagram-logo-box);
  max-width: var(--triton-diagram-logo-box);
  max-height: var(--triton-diagram-logo-box);
}

.diagram-leaf-box--flat-layout .diagram-leaf-box__text,
.diagram-leaf-box--superflat-layout .diagram-leaf-box__text {
  flex: 1 1 0;
  justify-content: center;
  text-align: left;
  gap: 0;
}

.diagram-leaf-box--flat-layout .diagram-leaf-box__title,
.diagram-leaf-box--flat-layout .diagram-leaf-box__subtitle,
.diagram-leaf-box--superflat-layout .diagram-leaf-box__title {
  text-align: left;
  line-height: 1.05;
}

.diagram-leaf-box--metrics-break:not(.diagram-leaf-box--flat-layout):not(.diagram-leaf-box--compact-layout) {
  align-items: flex-start;
  justify-content: flex-start;
}

.diagram-leaf-box--metrics-break:not(.diagram-leaf-box--flat-layout):not(.diagram-leaf-box--compact-layout)
  .diagram-leaf-box__metrics {
  max-width: var(--triton-diagram-logo-box);
}

.diagram-leaf-box--slim-layout,
.diagram-leaf-box--superslim-layout {
  overflow: visible;
}

.diagram-leaf-box--slim-layout .diagram-leaf-box__icon,
.diagram-leaf-box--superslim-layout .diagram-leaf-box__icon {
  align-self: center;
  min-height: var(--triton-diagram-logo-box);
  max-height: 48px;
}

.diagram-leaf-box--slim-layout .diagram-leaf-box__text,
.diagram-leaf-box--superslim-layout .diagram-leaf-box__text {
  align-items: center;
  justify-content: flex-start;
  overflow: visible;
  min-height: 0;
}

.diagram-leaf-box--slim-layout .diagram-leaf-box__title,
.diagram-leaf-box--superslim-layout .diagram-leaf-box__title {
  font-size: clamp(0.62rem, min(1.45vmin, 2.2cqh), 0.88rem);
  line-height: 1.15;
}
</style>
