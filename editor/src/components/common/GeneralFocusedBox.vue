<script setup lang="ts">
import BoxMetricStrip from './BoxMetricStrip.vue'

defineProps<{
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
}>()

const emit = defineEmits<{
  'toggle-pin': [MouseEvent]
  'cycle-color': []
  'header-dblclick': [MouseEvent]
}>()
</script>

<template>
  <div
    class="general-focused-box"
    :class="{
      'general-focused-box--pinned': pinned,
      'general-focused-box--tools-wide': showColorTool,
      'general-focused-box--pin-only': showPinTool && !showColorTool,
      'general-focused-box--has-metrics':
        hasCoverage || technicalDebtPercent != null || issueCount != null,
      'general-focused-box--allow-overflow': allowOverflow,
    }"
    :style="{ '--box-accent': accent }"
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

    <div class="general-focused-box__shell">
      <div class="general-focused-box__header" @dblclick.stop="emit('header-dblclick', $event)">
        <slot name="header-icon" />
        <div class="general-focused-box__head-text">
          <div class="title title--header" :title="titleTooltip || undefined">
            {{ title }}
          </div>
          <div v-if="$slots.subtitle || subtitle" class="subtitle subtitle--header">
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
  padding-bottom: clamp(2px, 0.35vmin, 6px);
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

.general-focused-box__head-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
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
  top: 5px;
  right: 5px;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: flex-end;
  gap: 4px;
  max-width: calc(100% - 10px);
}

.general-focused-box__metric-strip {
  width: auto;
  max-width: 100%;
}

.general-focused-box__tool-row {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
  flex-wrap: wrap;
  max-width: 100%;
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

.title--header {
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
</style>
