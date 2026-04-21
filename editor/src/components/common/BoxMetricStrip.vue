<script setup lang="ts">
import { computed, inject, ref, type Ref } from 'vue'

export type BoxIssueLevel = 'none' | 'minor' | 'major' | 'blocking'

const props = defineProps<{
  coveragePercent?: number | null
  technicalDebtPercent?: number | null
  issueCount?: number | null
  issueLevel?: BoxIssueLevel | null
}>()

function clampPct(value: number | null | undefined, max = 100): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(max, value))
}

const coverageValue = computed(() => clampPct(props.coveragePercent, 100))
const debtRawValue = computed(() => clampPct(props.technicalDebtPercent, 10))
const debtFillPct = computed(() => (debtRawValue.value / 10) * 100)
const issueLevelClass = computed(() =>
  props.issueLevel === 'blocking'
    ? 'blocking'
    : props.issueLevel === 'major'
      ? 'major'
      : props.issueLevel === 'minor'
        ? 'minor'
        : 'none',
)

const showCoverage = computed(
  () => typeof props.coveragePercent === 'number' && Number.isFinite(props.coveragePercent),
)
const showDebt = computed(
  () => typeof props.technicalDebtPercent === 'number' && Number.isFinite(props.technicalDebtPercent),
)
const showIssues = computed(
  () => typeof props.issueCount === 'number' && Number.isFinite(props.issueCount) && props.issueCount >= 0,
)
const metricTooltipsEnabledRef = inject<Ref<boolean>>('tritonMetricTooltipsEnabled', ref(true))
const metricVisibilityRef = inject<Ref<Record<'coverage' | 'debt' | 'issues', boolean>>>(
  'tritonMetricVisibility',
  ref({ coverage: true, debt: true, issues: true }),
)
const showCoverageVisible = computed(() => showCoverage.value && metricVisibilityRef.value.coverage !== false)
const showDebtVisible = computed(() => showDebt.value && metricVisibilityRef.value.debt !== false)
const showIssuesVisible = computed(() => showIssues.value && metricVisibilityRef.value.issues !== false)

const activeTooltip = ref<string | null>(null)

const issuesTooltip = computed(
  () => `Issues: ${props.issueCount ?? 0} open issue${props.issueCount === 1 ? '' : 's'}`,
)
const debtTooltip = computed(() => `Technical debt: ${debtRawValue.value}%`)
const coverageTooltip = computed(
  () => `Code coverage: ${coverageValue.value}% of statements covered by tests`,
)

function showTooltip(text: string) {
  if (!metricTooltipsEnabledRef.value) return
  activeTooltip.value = text
}

function hideTooltip() {
  activeTooltip.value = null
}
</script>

<template>
  <div
    v-if="showCoverageVisible || showDebtVisible || showIssuesVisible"
    class="box-metric-strip"
    :class="{ 'box-metric-strip--tooltips-on': metricTooltipsEnabledRef }"
    role="group"
    aria-label="Box metrics"
  >
    <span
      v-if="showIssuesVisible"
      class="box-metric box-metric--bar box-metric--issue-bar box-metric--issues"
      role="img"
      :aria-label="`Issues ${issueCount}`"
      :data-level="issueLevelClass"
      @mouseenter="showTooltip(issuesTooltip)"
      @mouseleave="hideTooltip"
      @focus="showTooltip(issuesTooltip)"
      @blur="hideTooltip"
    >
      <svg viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true" class="box-metric__svg">
        <rect x="0" y="0" width="100" height="20" class="box-metric__issue-shell" />
        <path
          class="box-metric__issue-fill"
          d="M2 2h80l14 8-14 8H2z"
        />
        <path
          class="box-metric__issue-stroke"
          d="M2 2h80l14 8-14 8H2z"
        />
      </svg>
      <span class="box-metric__issue-count">{{ issueCount }}</span>
    </span>

    <span
      v-if="showDebtVisible"
      class="box-metric box-metric--bar box-metric--debt"
      role="img"
      :aria-label="`Technical debt ${debtRawValue} percent`"
      @mouseenter="showTooltip(debtTooltip)"
      @mouseleave="hideTooltip"
      @focus="showTooltip(debtTooltip)"
      @blur="hideTooltip"
    >
      <svg viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true" class="box-metric__svg">
        <rect x="0" y="0" width="100" height="20" class="box-metric__debt-rest" />
        <rect x="0" y="0" :width="debtFillPct" height="20" class="box-metric__debt-fill" />
      </svg>
    </span>

    <span
      v-if="showCoverageVisible"
      class="box-metric box-metric--bar box-metric--coverage"
      role="img"
      :aria-label="`Code coverage ${coverageValue} percent`"
      @mouseenter="showTooltip(coverageTooltip)"
      @mouseleave="hideTooltip"
      @focus="showTooltip(coverageTooltip)"
      @blur="hideTooltip"
    >
      <svg viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true" class="box-metric__svg">
        <rect x="0" y="0" :width="coverageValue" height="20" class="box-metric__coverage-covered" />
        <rect :x="coverageValue" y="0" :width="100 - coverageValue" height="20" class="box-metric__coverage-uncovered" />
      </svg>
    </span>

    <div
      v-if="metricTooltipsEnabledRef && activeTooltip"
      class="box-metric-strip__tooltip"
      role="status"
      aria-live="polite"
    >
      {{ activeTooltip }}
    </div>
  </div>
</template>

<style scoped>
.box-metric-strip {
  position: relative;
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: max-content;
  justify-content: end;
  align-content: start;
  justify-items: end;
  gap: 4px;
  width: 100%;
  max-width: 124px;
  pointer-events: auto;
}

.box-metric {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: default;
}

.box-metric-strip--tooltips-on .box-metric {
  cursor: help;
}

.box-metric--bar {
  width: 36px;
  height: 10px;
  border-radius: 3px;
  border: 1px solid rgb(15 23 42 / 0.22);
  background: rgb(255 255 255 / 0.85);
  overflow: hidden;
}

.box-metric__svg {
  width: 100%;
  height: 100%;
  display: block;
}

.box-metric__coverage-covered {
  fill: #22c55e;
}

.box-metric__coverage-uncovered {
  fill: #ef4444;
}

.box-metric__debt-fill {
  fill: #2563eb;
}

.box-metric__debt-rest {
  fill: #facc15;
}

.box-metric--issue-bar {
  position: relative;
}

.box-metric__issue-shell {
  fill: #ffffff;
}

.box-metric__issue-fill {
  fill: #ffffff;
}

.box-metric__issue-stroke {
  fill: none;
  stroke: #475569;
  stroke-width: 1.5;
  stroke-linejoin: round;
}

.box-metric--issue-bar[data-level='minor'] .box-metric__issue-fill {
  fill: #fde047;
}

.box-metric--issue-bar[data-level='major'] .box-metric__issue-fill {
  fill: #fb923c;
}

.box-metric--issue-bar[data-level='blocking'] .box-metric__issue-fill {
  fill: #ef4444;
}

.box-metric__issue-count {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 8px;
  line-height: 1;
  font-weight: 800;
  color: #0f172a;
}

.box-metric-strip__tooltip {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 12;
  max-width: 180px;
  padding: 5px 7px;
  border-radius: 6px;
  background: rgb(15 23 42 / 0.94);
  color: #f8fafc;
  font-size: 10px;
  line-height: 1.35;
  white-space: normal;
  text-align: left;
  box-shadow: 0 4px 14px rgb(15 23 42 / 0.22);
}

@container (max-width: 150px) {
  .box-metric-strip {
    grid-auto-flow: row;
  }

  .box-metric--coverage {
    order: 1;
  }

  .box-metric--debt {
    order: 2;
  }

  .box-metric--issues {
    order: 3;
  }
}
</style>
