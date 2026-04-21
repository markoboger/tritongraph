<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import { boxColorForId, type NamedBoxColor } from '../../graph/boxColors'
import cubeIconUrl from '../../assets/language-icons/cube.svg'
import stackedCubesIconUrl from '../../assets/language-icons/stacked-cubes.svg'
import type { BoxCompartment } from '../../diagram/boxCompartments'
import BoxCompartments from '../common/BoxCompartments.vue'
import GeneralFocusedBox from '../common/GeneralFocusedBox.vue'
import BoxMetricStrip from '../common/BoxMetricStrip.vue'
import { simulatedMetricsForBox } from '../common/boxMetricDemo'
import { useScalaCoverageKeyed } from '../../store/useOverlay'

const props = defineProps<{
  boxId: string
  label: string
  subtitle?: string
  /** Shown when the box is focused (layer drill). */
  notes?: string
  /** Free-text "what does this module do" — surfaced in the AI prompt. */
  description?: string
  kind?: 'project' | 'module'
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

/**
 * Subtitle markdown: only `[label](href)` is recognized — enough for our internal `triton:` action
 * links. Anything else renders verbatim. Anchors are rendered as buttons (no real navigation; we
 * emit `link-action` and let the host decide what to do).
 */
interface SubtitleSegment {
  kind: 'text' | 'link'
  value: string
  href?: string
}

const SUBTITLE_LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g

const subtitleSegments = computed<SubtitleSegment[]>(() => {
  const text = String(props.subtitle ?? '')
  if (!text) return []
  const out: SubtitleSegment[] = []
  let last = 0
  SUBTITLE_LINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = SUBTITLE_LINK_RE.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: 'text', value: text.slice(last, m.index) })
    out.push({ kind: 'link', value: m[1] ?? '', href: m[2] ?? '' })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ kind: 'text', value: text.slice(last) })
  return out
})

function onSubtitleLinkClick(href: string | undefined) {
  if (!href) return
  emit('link-action', href)
}

const accent = computed(() => (props.boxColor as string) || boxColorForId(props.boxId))
const workspaceKeyRef = inject<Ref<string>>('tritonWorkspaceKey', ref(''))
const scalaCoverageRef = useScalaCoverageKeyed(workspaceKeyRef, String(props.boxId ?? ''))
const coveragePercent = computed((): number | null => {
  const v = scalaCoverageRef.value?.stmtPct
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null
})
const hasCoverage = computed(() => coveragePercent.value !== null)
const coveragePercentValue = computed(() => coveragePercent.value ?? 0)
const simulatedMetrics = computed(() => simulatedMetricsForBox(props.boxId))
const projectKind = computed<'project' | 'module'>(() => (props.kind === 'project' ? 'project' : 'module'))
const projectIconUrl = computed(() => (projectKind.value === 'project' ? stackedCubesIconUrl : cubeIconUrl))
const displayNoun = computed(() => (projectKind.value === 'project' ? 'project' : 'module'))

const focusedCompartments = computed<readonly BoxCompartment[]>(() => {
  const out: BoxCompartment[] = []
  if ((props.description ?? '').trim()) {
    out.push({
      id: 'purpose',
      title: 'Purpose',
      rows: [{ value: String(props.description ?? '') }],
    })
  }
  if ((props.notes ?? '').trim()) {
    out.push({
      id: 'notes',
      title: 'Notes',
      rows: [{ value: String(props.notes ?? '') }],
    })
  }
  for (const compartment of props.compartments ?? []) out.push(compartment)
  return out
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

const editing = ref(false)
const draftLabel = ref('')
const draftDescription = ref('')
const labelInput = ref<HTMLInputElement | null>(null)

function startEditing() {
  if (editing.value) return
  draftLabel.value = String(props.label ?? '')
  draftDescription.value = String(props.description ?? '')
  editing.value = true
  void nextTick(() => {
    const el = labelInput.value
    if (el) {
      el.focus()
      el.select()
    }
  })
}

function commitEdit() {
  if (!editing.value) return
  const newLabel = draftLabel.value.trim()
  if (newLabel && newLabel !== String(props.label ?? '')) {
    emit('rename', newLabel)
  }
  const newDesc = draftDescription.value
  if (newDesc !== String(props.description ?? '')) {
    emit('description-change', newDesc)
  }
  editing.value = false
}

function cancelEdit() {
  editing.value = false
}

function onLabelKeydown(ev: KeyboardEvent) {
  if (ev.key === 'Enter') {
    ev.preventDefault()
    commitEdit()
  } else if (ev.key === 'Escape') {
    ev.preventDefault()
    cancelEdit()
  }
}

function onDescriptionKeydown(ev: KeyboardEvent) {
  if (ev.key === 'Escape') {
    ev.preventDefault()
    cancelEdit()
  }
}
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
        <template v-for="(seg, i) in subtitleSegments" :key="i">
          <button
            v-if="seg.kind === 'link'"
            type="button"
            class="subtitle-link nodrag nopan"
            :title="seg.href"
            @click.stop="onSubtitleLinkClick(seg.href)"
            @pointerdown.stop
            @mousedown.stop
            @dblclick.stop
          >{{ seg.value }}</button>
          <span v-else>{{ seg.value }}</span>
        </template>
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
        'project-box--tight': tightLayout,
        'project-box--pinned': pinned,
        'project-box--tools-wide': showColorTool,
        'project-box--pin-only': showPinTool && !showColorTool,
        'project-box--editing': editing,
        'project-box--has-metrics': hasCoverage || simulatedMetrics.issueCount >= 0,
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
      <div v-if="showPinTool || showColorTool" class="project-box__tools" @pointerdown.stop>
        <button
          v-if="showPinTool"
          type="button"
          class="tool-btn tool-btn--pin"
          :class="{ 'tool-btn--active': pinned }"
          :title="`Pin — keep this ${displayNoun} highlighted when another box is zoomed`"
          :aria-pressed="pinned ? 'true' : 'false'"
          :aria-label="`Pin ${displayNoun} (stays focused when zooming elsewhere)`"
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
        <img class="lang-svg cube-icon" :src="projectIconUrl" alt="" aria-hidden="true" decoding="async" />
      </div>

      <div
        class="project-box__body"
        @dblclick.stop="startEditing"
      >
        <div class="project-box__header">
          <div
            ref="titleEl"
            class="title"
            :title="`Double-click to rename / edit ${displayNoun} description`"
          >{{ label }}</div>
          <div v-if="subtitle && !tightLayout" class="subtitle">
            <template v-for="(seg, i) in subtitleSegments" :key="i">
              <button
                v-if="seg.kind === 'link'"
                type="button"
                class="subtitle-link nodrag nopan"
                :title="seg.href"
                @click.stop="onSubtitleLinkClick(seg.href)"
                @pointerdown.stop
                @mousedown.stop
                @dblclick.stop
              >{{ seg.value }}</button>
              <span v-else>{{ seg.value }}</span>
            </template>
          </div>
        </div>
        <div v-if="description && !tightLayout" class="description-preview" :title="description">
          {{ description }}
        </div>
      </div>
    </div>

    <div
      v-if="editing"
      class="project-box__editor nodrag nopan"
      role="dialog"
      :aria-label="`Edit ${displayNoun}`"
      @pointerdown.stop
      @mousedown.stop
      @click.stop
      @dblclick.stop
      @keydown.stop
    >
      <label class="editor-field">
        <span class="editor-label">Name</span>
        <input
          ref="labelInput"
          v-model="draftLabel"
          class="title-input"
          spellcheck="false"
          @keydown="onLabelKeydown"
        />
      </label>
      <label class="editor-field">
        <span class="editor-label">Description / AI prompt purpose</span>
        <textarea
          v-model="draftDescription"
          class="description-input"
          rows="5"
          spellcheck="false"
          :placeholder="`Describe what this ${displayNoun} should do (included in the generated AI prompt)…`"
          @keydown="onDescriptionKeydown"
        />
      </label>
      <div class="editor-actions">
        <span class="edit-hint">Enter in name to save · Esc to cancel</span>
        <button type="button" class="editor-btn" @click="cancelEdit">Cancel</button>
        <button type="button" class="editor-btn editor-btn--primary" @click="commitEdit">Save</button>
      </div>
    </div>
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

.project-box--has-metrics {
  padding-top: clamp(20px, 4vmin, 26px);
  padding-right: clamp(46px, 8cqw, 56px);
}

@container (max-width: 150px) {
  .project-box--has-metrics {
    padding-top: clamp(38px, 8vmin, 54px);
  }
}

.project-box__metrics {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 4;
  width: min(124px, calc(100% - 12px));
}

.lang-icon-slot {
  display: flex;
  justify-content: center;
  align-items: center;
  align-self: center;
  flex-shrink: 0;
  width: 100%;
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
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: stretch;
}
.project-box__header {
  display: flex;
  flex-direction: column;
  min-height: 0;
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
.project-box--has-metrics .project-box__tools {
  top: 22px;
}
@container (max-width: 150px) {
  .project-box--has-metrics .project-box__tools {
    top: 42px;
  }
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
