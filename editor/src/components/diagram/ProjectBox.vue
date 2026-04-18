<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { boxColorForId, type NamedBoxColor } from '../../graph/boxColors'
import { isLanguageIconId, languageIconForId, type LanguageIconId } from '../../graph/languages'
import LanguageIcon from '../LanguageIcon.vue'

const props = defineProps<{
  boxId: string
  label: string
  subtitle?: string
  /** Shown when the box is focused (layer drill). */
  notes?: string
  language?: string
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
}>()

const accent = computed(() => (props.boxColor as string) || boxColorForId(props.boxId))

const iconLang = computed((): LanguageIconId => {
  const d = props.language
  if (isLanguageIconId(d)) return d
  return languageIconForId(props.boxId)
})

const rootEl = ref<HTMLElement | null>(null)
const titleEl = ref<HTMLElement | null>(null)
/** Title too wide for one line or title+subtitle overflow → vertical title; subtitle only when horizontal. */
const tightLayout = ref(false)

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
  if (!root || !title) return
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

onMounted(() => {
  void nextTick(() => {
    measure()
    ro = new ResizeObserver(() => measure())
    if (rootEl.value) ro.observe(rootEl.value)
    if (titleEl.value) ro.observe(titleEl.value)
  })
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
  ],
  () => void nextTick(measure),
)
</script>

<template>
  <div
    ref="rootEl"
    class="project-box"
    :class="{
      'project-box--tight': tightLayout,
      'project-box--focused': focused,
      'project-box--pinned': pinned,
      'project-box--tools-wide': showColorTool,
      'project-box--pin-only': showPinTool && !showColorTool,
    }"
    :style="{ '--box-accent': accent }"
  >
    <div v-if="showPinTool || showColorTool" class="project-box__tools" @pointerdown.stop>
      <button
        v-if="showPinTool"
        type="button"
        class="tool-btn tool-btn--pin"
        :class="{ 'tool-btn--active': pinned }"
        title="Pin — keep this module highlighted when another box is zoomed"
        :aria-pressed="pinned ? 'true' : 'false'"
        aria-label="Pin module (stays focused when zooming elsewhere)"
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

    <div class="lang-icon-slot">
      <LanguageIcon :name="iconLang" />
    </div>

    <div class="project-box__body">
      <div ref="titleEl" class="title">{{ label }}</div>
      <div v-if="subtitle && !tightLayout" class="subtitle">{{ subtitle }}</div>
      <div v-if="focused && notes" class="drill-note">{{ notes }}</div>
    </div>
  </div>
</template>

<style scoped>
.project-box {
  --box-accent: steelblue;
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
  /* 10% transparent fill so edges behind the box remain visible */
  background: rgb(255 255 255 / 0.9);
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

.lang-icon-slot {
  display: flex;
  justify-content: center;
  align-items: center;
  align-self: center;
  flex-shrink: 0;
  width: 100%;
  height: clamp(40px, min(30cqw, 28cqh), 160px);
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
.project-box--focused .lang-icon-slot {
  height: clamp(44px, min(34cqw, 30cqh), 180px);
}
.project-box--tight .lang-icon-slot {
  transform: none;
}
.project-box__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: stretch;
}
.project-box--focused .project-box__body {
  justify-content: flex-start;
}
.drill-note {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgb(15 23 42 / 0.12);
  font-size: 10px;
  line-height: 1.45;
  color: #334155;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  white-space: pre-wrap;
  overflow: auto;
  flex: 1;
  min-height: 0;
  text-align: left;
}
.project-box__tools {
  position: absolute;
  top: 5px;
  right: 5px;
  z-index: 4;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 5px;
  max-width: calc(100% - 10px);
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
  transition:
    font-size 0.45s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.45s cubic-bezier(0.4, 0, 0.2, 1);
}
.subtitle {
  margin-top: clamp(2px, 0.6vmin, 8px);
  font-size: clamp(0.65rem, min(1.6vmin, 2.5cqh), 0.95rem);
  color: #475569;
  line-height: 1.25;
  opacity: 1;
  max-height: 80px;
  overflow: hidden;
  transition:
    opacity 0.4s ease,
    margin-top 0.45s cubic-bezier(0.4, 0, 0.2, 1),
    max-height 0.45s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.4s ease;
}
.project-box--focused {
  box-shadow:
    inset 8px 0 0 0 var(--box-accent),
    0 4px 22px rgb(15 23 42 / 0.14);
  outline: 2px solid var(--box-accent);
  outline-offset: 0;
}
.project-box--focused .title {
  font-size: clamp(0.82rem, min(2.4vmin, 3.8cqh), 1.45rem);
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
</style>
