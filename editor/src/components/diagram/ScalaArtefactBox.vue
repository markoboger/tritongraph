<script setup lang="ts">
/**
 * Scala-artefact node body for the package diagram. Sibling of {@link PackageBox}: nests *inside*
 * a package container as a leaf box and represents one top-level Scala declaration (class, object,
 * trait, enum, top-level def, …). Kept separate so artefact UI can grow independently — future
 * work: open source on click, show coverage/sonar metrics, link to specs, list members.
 *
 * Initial divergences from {@link PackageBox}:
 *   - Kind badge (one-letter circle) instead of a folder icon — there is no canonical artefact icon.
 *   - Subtitle is the kind keyword (`class` / `case class` / `object` / `trait` / `enum` / `def`).
 *   - No description editor (artefacts are derived from source — the YAML-side editor would not
 *     round-trip back to `.scala`). The pin / accent tools and tight-layout behaviour mirror
 *     {@link PackageBox} so the visual rhythm in a package container stays consistent.
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { boxColorForId, type NamedBoxColor } from '../../graph/boxColors'

const props = defineProps<{
  boxId: string
  label: string
  /** The Scala kind keyword — `class`, `case class`, `object`, `trait`, `enum`, `def`, … */
  subtitle?: string
  /** Shown when the box is focused (layer drill). */
  notes?: string
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

/**
 * Map a Scala kind keyword to a single-letter badge. The mapping is intentionally short and
 * lossy — the full kind keyword is shown as the subtitle, the badge is a quick eyeball cue. We
 * fall back to the first uppercased letter so future kinds (e.g. `given`) still render something
 * meaningful without requiring a code change here.
 */
const kindBadge = computed(() => {
  const k = (props.subtitle ?? '').trim().toLowerCase()
  if (!k) return '?'
  if (k === 'case class' || k === 'class') return 'C'
  if (k === 'case object' || k === 'object') return 'O'
  if (k === 'trait') return 'T'
  if (k === 'enum') return 'E'
  if (k === 'def') return 'ƒ'
  if (k === 'val') return 'v'
  if (k === 'var') return 'V'
  if (k === 'type') return 'τ'
  if (k === 'given') return 'G'
  return k.charAt(0).toUpperCase()
})

const rootEl = ref<HTMLElement | null>(null)
const titleEl = ref<HTMLElement | null>(null)
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
  if (props.focused) {
    tightLayout.value = false
    return
  }
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
    props.showPinTool,
    props.showColorTool,
  ],
  () => void nextTick(measure),
)
</script>

<template>
  <!-- Default: compact badge + title (click the node on the canvas to layer-drill focus). -->
  <div
    v-if="!focused"
    ref="rootEl"
    class="artefact-box"
    :class="{
      'artefact-box--tight': tightLayout,
      'artefact-box--pinned': pinned,
      'artefact-box--tools-wide': showColorTool,
      'artefact-box--pin-only': showPinTool && !showColorTool,
    }"
    :style="{ '--box-accent': accent }"
  >
    <div v-if="showPinTool || showColorTool" class="artefact-box__tools" @pointerdown.stop>
      <button
        v-if="showPinTool"
        type="button"
        class="tool-btn tool-btn--pin"
        :class="{ 'tool-btn--active': pinned }"
        title="Pin — keep this artefact highlighted when another box is zoomed"
        :aria-pressed="pinned ? 'true' : 'false'"
        aria-label="Pin artefact (stays focused when zooming elsewhere)"
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

    <div class="kind-badge-slot">
      <span class="kind-badge" :title="subtitle ?? ''">{{ kindBadge }}</span>
    </div>

    <div class="artefact-box__body">
      <div ref="titleEl" class="title">{{ label }}</div>
      <div v-if="subtitle && !tightLayout" class="subtitle">{{ subtitle }}</div>
    </div>
  </div>

  <!-- Layer-drill focused: metrics in the top-right cluster, foldable detail sections (placeholders). -->
  <div
    v-else
    ref="rootEl"
    class="artefact-box artefact-box--focused artefact-box--focused-layout"
    :class="{
      'artefact-box--pinned': pinned,
      'artefact-box--tools-wide': showColorTool,
      'artefact-box--pin-only': showPinTool && !showColorTool,
    }"
    :style="{ '--box-accent': accent }"
  >
    <div class="artefact-box__tools artefact-box__tools--with-metrics" @pointerdown.stop>
      <span
        class="metric-icon metric-icon--coverage"
        title="Code coverage (placeholder — connect to reports later)"
        role="img"
        aria-label="Code coverage"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" class="metric-icon__svg">
          <path
            fill="currentColor"
            d="M12 3a9 9 0 1 0 9 9h-2a7 7 0 1 1-7-7V3zm0 4a5 5 0 1 0 5 5h-2a3 3 0 1 1-3-3V7zm0 4a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"
          />
        </svg>
      </span>
      <span
        class="metric-icon metric-icon--issues"
        title="SonarQube issues (placeholder)"
        role="img"
        aria-label="Issues reported for this artefact"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" class="metric-icon__svg">
          <path
            fill="currentColor"
            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
          />
        </svg>
      </span>
      <button
        v-if="showPinTool"
        type="button"
        class="tool-btn tool-btn--pin"
        :class="{ 'tool-btn--active': pinned }"
        title="Pin — keep this artefact highlighted when another box is zoomed"
        :aria-pressed="pinned ? 'true' : 'false'"
        aria-label="Pin artefact (stays focused when zooming elsewhere)"
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

    <div class="artefact-box__focused-shell">
      <div class="artefact-box__focused-header">
        <div class="kind-badge-slot kind-badge-slot--header">
          <span class="kind-badge kind-badge--header" :title="subtitle ?? ''">{{ kindBadge }}</span>
        </div>
        <div class="artefact-box__focused-head-text">
          <div ref="titleEl" class="title title--header">{{ label }}</div>
          <div v-if="subtitle" class="subtitle subtitle--header">{{ subtitle }}</div>
        </div>
      </div>

      <div class="artefact-box__focused-sections nodrag nopan" @pointerdown.stop @wheel.stop @click.stop>
        <details class="artefact-box__details">
          <summary class="artefact-box__summary">Documentation</summary>
          <div class="artefact-box__details-body">
            <p class="artefact-box__placeholder">
              Placeholder: Scaladoc / KDoc-style comment text for this declaration would appear here once
              wired to the parser or language server.
            </p>
          </div>
        </details>
        <details class="artefact-box__details">
          <summary class="artefact-box__summary">Tests &amp; specs (coverage)</summary>
          <div class="artefact-box__details-body">
            <p class="artefact-box__placeholder">
              Placeholder: e.g. <code>AnimalSpec</code>, <code>FoodWebIntegrationTest</code> — classes that
              exercise this artefact for coverage reporting.
            </p>
          </div>
        </details>
        <details class="artefact-box__details">
          <summary class="artefact-box__summary">Test run checklist</summary>
          <div class="artefact-box__details-body">
            <ul class="artefact-box__checklist">
              <li class="artefact-box__checklist-item">Placeholder: compile OK</li>
              <li class="artefact-box__checklist-item">Placeholder: unit tests — pending CI hook</li>
              <li class="artefact-box__checklist-item">Placeholder: property tests — not run</li>
            </ul>
          </div>
        </details>
        <details class="artefact-box__details">
          <summary class="artefact-box__summary">Methods (signatures)</summary>
          <div class="artefact-box__details-body artefact-box__details-body--mono">
            <pre class="artefact-box__signatures">def apply(name: String): Animal
def unapply(a: Animal): Option[(String)]
override def toString: String</pre>
            <p class="artefact-box__placeholder artefact-box__placeholder--small">
              Placeholder signatures — replace with tree-sitter member list.
            </p>
          </div>
        </details>
        <details class="artefact-box__details">
          <summary class="artefact-box__summary">SonarQube issues</summary>
          <div class="artefact-box__details-body">
            <p class="artefact-box__placeholder">
              Placeholder: issue keys, severities, and messages from SonarQube for this file / symbol would
              list here after integration.
            </p>
          </div>
        </details>
        <div v-if="notes" class="drill-note drill-note--focused">{{ notes }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * Mirrors PackageBox dimensions / paddings so artefacts stack cleanly inside their package
 * container. Class names are namespaced (`artefact-box*`) so the components can drift freely.
 */
.artefact-box {
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
  background: rgb(255 255 255 / 0.9);
  box-shadow: inset 5px 0 0 0 var(--box-accent), 0 1px 2px rgb(15 23 42 / 0.08);
  font-family: ui-sans-serif, system-ui, sans-serif;
  overflow: hidden;
  transition:
    padding 0.45s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.45s ease,
    outline 0.45s ease;
}
.artefact-box--pin-only {
  padding-right: clamp(34px, 6.5cqw, 44px);
}
.artefact-box--tools-wide {
  padding-right: clamp(72px, 12cqw, 108px);
}
/** Focused shell: symmetric padding; tool cluster is absolutely positioned (see PackageBox). */
.artefact-box--focused-layout.artefact-box--tools-wide,
.artefact-box--focused-layout.artefact-box--pin-only {
  padding-right: clamp(6px, 1.35vmin, 14px);
}
.artefact-box--focused-layout {
  justify-content: flex-start;
}
.kind-badge-slot {
  display: flex;
  justify-content: center;
  align-items: center;
  align-self: center;
  flex-shrink: 0;
  width: 100%;
  height: clamp(32px, min(26cqw, 24cqh), 96px);
  margin-bottom: clamp(4px, 1.2cqh, 12px);
  pointer-events: none;
}
.kind-badge {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  width: clamp(28px, 22cqw, 64px);
  height: clamp(28px, 22cqw, 64px);
  border-radius: 50%;
  background: var(--box-accent);
  color: #fff;
  font-weight: 700;
  font-size: clamp(0.85rem, 14cqw, 1.6rem);
  letter-spacing: 0.02em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  box-shadow: inset 0 0 0 2px rgb(255 255 255 / 0.18), 0 1px 2px rgb(15 23 42 / 0.18);
}
.artefact-box__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: stretch;
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
.artefact-box__tools {
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
.metric-icon {
  width: 26px;
  height: 26px;
  border-radius: 999px;
  border: 1px solid rgb(15 23 42 / 0.2);
  background: rgb(255 255 255 / 0.95);
  display: grid;
  place-items: center;
  flex-shrink: 0;
  color: #475569;
  box-shadow: 0 1px 2px rgb(15 23 42 / 0.06);
}
.metric-icon--coverage {
  color: #059669;
  border-color: rgb(5 150 105 / 0.4);
}
.metric-icon--issues {
  color: #b45309;
  border-color: rgb(180 83 9 / 0.4);
}
.metric-icon__svg {
  width: 14px;
  height: 14px;
  display: block;
}
.artefact-box__focused-shell {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding-top: 2px;
}
.artefact-box__focused-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  margin-bottom: 8px;
  padding-right: clamp(118px, 26cqw, 172px);
}
.kind-badge-slot--header {
  width: 40px;
  height: 40px;
  margin: 0;
  flex-shrink: 0;
  align-self: flex-start;
  pointer-events: none;
}
.kind-badge--header {
  width: 36px;
  height: 36px;
  font-size: clamp(0.72rem, 11cqw, 1rem);
}
.artefact-box__focused-head-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
}
.title--header {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  text-align: left;
  writing-mode: horizontal-tb;
  transform: none;
  align-self: stretch;
  font-size: clamp(0.82rem, min(2.4vmin, 3.8cqh), 1.45rem);
}
.subtitle--header {
  margin-top: 0;
  font-size: clamp(0.65rem, min(1.45vmin, 2.2cqh), 0.85rem);
  text-align: left;
  opacity: 1;
  max-height: none;
  line-height: 1.25;
  color: #475569;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.artefact-box__focused-sections {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  padding: 2px 0 6px;
}
.artefact-box__details {
  border: 1px solid rgb(148 163 184 / 0.85);
  border-radius: 8px;
  background: rgb(248 250 252 / 0.95);
  margin-bottom: 8px;
}
.artefact-box__details:last-of-type {
  margin-bottom: 0;
}
.artefact-box__summary {
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-weight: 600;
  font-size: clamp(0.68rem, min(1.5vmin, 2cqh), 0.82rem);
  padding: 8px 10px;
  list-style: none;
  color: #0f172a;
}
.artefact-box__summary::-webkit-details-marker {
  display: none;
}
.artefact-box__summary::after {
  content: '';
  width: 0.45em;
  height: 0.45em;
  margin-right: 2px;
  border-right: 2px solid #64748b;
  border-bottom: 2px solid #64748b;
  transform: rotate(45deg);
  flex-shrink: 0;
  transition: transform 0.2s ease;
}
.artefact-box__details[open] > .artefact-box__summary::after {
  transform: rotate(225deg);
}
.artefact-box__details-body {
  padding: 0 10px 10px;
  font-size: clamp(0.62rem, min(1.35vmin, 2cqh), 0.8rem);
  line-height: 1.45;
  color: #475569;
}
.artefact-box__details-body--mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.artefact-box__placeholder {
  margin: 0;
}
.artefact-box__placeholder--small {
  margin-top: 8px;
  font-style: italic;
  font-size: 0.92em;
}
.artefact-box__placeholder code {
  font-size: 0.95em;
  padding: 0 0.2em;
  border-radius: 4px;
  background: rgb(241 245 249 / 0.95);
}
.artefact-box__checklist {
  margin: 0;
  padding-left: 1.1rem;
}
.artefact-box__checklist-item {
  margin-bottom: 4px;
}
.artefact-box__signatures {
  margin: 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgb(15 23 42 / 0.04);
  border: 1px solid rgb(148 163 184 / 0.45);
  font-size: clamp(0.58rem, min(1.25vmin, 1.85cqh), 0.72rem);
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-x: auto;
}
.drill-note--focused {
  flex: 0 0 auto;
  margin-top: 10px;
}
.artefact-box--pinned:not(.artefact-box--focused) {
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
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  opacity: 1;
  max-height: 80px;
  overflow: hidden;
  transition:
    opacity 0.4s ease,
    margin-top 0.45s cubic-bezier(0.4, 0, 0.2, 1),
    max-height 0.45s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.4s ease;
}
.artefact-box--focused {
  box-shadow:
    inset 8px 0 0 0 var(--box-accent),
    0 4px 22px rgb(15 23 42 / 0.14);
  outline: 2px solid var(--box-accent);
  outline-offset: 0;
}
.artefact-box--focused .title {
  font-size: clamp(0.82rem, min(2.4vmin, 3.8cqh), 1.45rem);
}
.artefact-box--tight .title {
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
.artefact-box--tight .subtitle {
  opacity: 0;
  margin-top: 0;
  max-height: 0;
  transform: translateY(4px);
  pointer-events: none;
}
</style>
