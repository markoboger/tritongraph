<script setup lang="ts">
defineOptions({ name: 'PackageBox' })

/**
 * Package node body for the Scala-package diagram.
 *
 * Sibling of {@link ProjectBox} (sbt build view): both fit into the same Vue Flow node shell and
 * use the same accent / pin / focus / editing affordances, but they are intentionally separate
 * components so each can grow features that only make sense in its own diagram (package box will
 * surface things like file/member lists, test coverage, sonar metrics, link-out to specs etc.;
 * the project box stays focused on sbt module ergonomics).
 *
 * Initial divergences from {@link ProjectBox}:
 *   - Folder icon (hardcoded — packages are always folder-shaped).
 *   - Plain-text subtitle (no markdown link parsing; package boxes don't have outbound diagram links yet).
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { TritonInnerArtefactSpec, TritonInnerPackageSpec } from '../../ilograph/types'
import { boxColorForId, type NamedBoxColor } from '../../graph/boxColors'
import folderIconUrl from '../../assets/language-icons/folder.svg'
import scalaIconUrl from '../../assets/language-icons/scala.svg'
import ScalaArtefactBox from './ScalaArtefactBox.vue'

export type InnerPackageSummary = TritonInnerPackageSpec
export type InnerArtefactSummary = TritonInnerArtefactSpec

function findSpecAtPath(
  roots: readonly TritonInnerPackageSpec[],
  path: readonly string[],
): TritonInnerPackageSpec | null {
  let level: readonly TritonInnerPackageSpec[] = roots
  let found: TritonInnerPackageSpec | null = null
  for (const segment of path) {
    const hit = level.find((x) => x.id === segment)
    if (!hit) return null
    found = hit
    level = hit.innerPackages ?? []
  }
  return found
}

const props = withDefaults(
  defineProps<{
    boxId: string
    label: string
    subtitle?: string
    /** Shown when the box is focused (layer drill). */
    notes?: string
    /** Free-text "what does this package contains" — surfaced in the AI prompt. */
    description?: string
    boxColor?: NamedBoxColor | string
    pinned: boolean
    focused: boolean
    showPinTool: boolean
    /** Layer-drill focused box only: show accent color picker. */
    showColorTool: boolean
    /** Child packages drawn inside the focused root (stacked); not used on embedded rows. */
    innerPackages?: readonly InnerPackageSummary[]
    /**
     * Top-level Scala members for this package, shown only when layer-drill focused and not
     * drilling into an inner package row (same dashed inner panel as `innerPackages`).
     */
    innerArtefacts?: readonly InnerArtefactSummary[]
    /**
     * Path of inner package ids from the first tier under this node (`innerPackages`) downward.
     * Scoped UI state: outer `layerDrillFocus` stays unchanged while this drills inside the box.
     */
    innerDrillPath?: readonly string[]
    /** Flow-only: which inner artefact row is selected (same scope as `innerDrillPath` — does not affect layer drill). */
    focusedInnerArtefactId?: string
    /** Compact card used only as a child inside another package box (no tools / no drill UI). */
    embedded?: boolean
  }>(),
  {
    innerPackages: () => [],
    innerArtefacts: () => [],
    innerDrillPath: () => [],
    embedded: false,
  },
)

const emit = defineEmits<{
  'toggle-pin': [MouseEvent]
  'cycle-color': []
  rename: [string]
  'description-change': [string]
  'update-inner-drill-path': [string[]]
  /** Toggle or clear inner artefact focus (`null` = clear only). */
  'update-inner-artefact-focus': [id: string | null]
}>()

const accent = computed(() => (props.boxColor as string) || boxColorForId(props.boxId))

const innerDrillPathArr = computed(() => [...props.innerDrillPath])

const activeInnerSpec = computed((): TritonInnerPackageSpec | null => {
  const path = innerDrillPathArr.value
  if (!path.length) return null
  return findSpecAtPath(props.innerPackages, path)
})

const focusedInnerArtefact = computed((): InnerArtefactSummary | null => {
  const id = props.focusedInnerArtefactId
  if (!id) return null
  return props.innerArtefacts.find((a) => a.id === id) ?? null
})

/** Inner-diagram panel: child packages and/or Scala artefacts (artefacts only at top-level inner view). */
const hasInnerDiagram = computed(
  () =>
    props.innerPackages.length > 0 ||
    (props.innerArtefacts.length > 0 && !innerDrillPathArr.value.length) ||
    (!!props.focusedInnerArtefactId && !innerDrillPathArr.value.length),
)

function onInnerCardClick(id: string) {
  const p = innerDrillPathArr.value
  if (p.length && p[p.length - 1] === id) {
    emit('update-inner-drill-path', p.slice(0, -1))
    return
  }
  emit('update-inner-drill-path', [...p, id])
}

function clearInnerDrill() {
  emit('update-inner-drill-path', [])
  emit('update-inner-artefact-focus', null)
}

function onArtefactRowClick(id: string) {
  emit('update-inner-artefact-focus', id)
}

function innerDrillBackOne() {
  const p = innerDrillPathArr.value
  if (p.length) emit('update-inner-drill-path', p.slice(0, -1))
}

const rootEl = ref<HTMLElement | null>(null)
const titleEl = ref<HTMLElement | null>(null)
/** Title too wide for one line or title+subtitle overflow → vertical title; subtitle only when horizontal. */
const tightLayout = ref(false)
/** Short, wide unfocused box: folder icon left, title + subtitle to the right (no stacked column). */
const wideShortRow = ref(false)

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
  if (props.embedded) {
    tightLayout.value = false
    wideShortRow.value = false
    return
  }
  if (props.focused) {
    tightLayout.value = false
    wideShortRow.value = false
    return
  }
  const root = rootEl.value
  const title = titleEl.value
  if (!root || !title) return
  const w = root.clientWidth
  const h = root.clientHeight
  const aspect = w / Math.max(1, h)
  /** Low, wide chrome typical of LR-layout package nodes — prefer icon | text row over tall centered icon. */
  if (h <= 148 && aspect >= 1.85) {
    wideShortRow.value = true
    tightLayout.value = false
    return
  }
  wideShortRow.value = false
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
    props.innerPackages,
    props.innerArtefacts,
    props.innerDrillPath,
    props.focusedInnerArtefactId,
    props.embedded,
  ],
  () => void nextTick(measure),
)

const editing = ref(false)
const draftLabel = ref('')
const draftDescription = ref('')
const labelInput = ref<HTMLInputElement | null>(null)

function startEditing() {
  if (props.embedded) return
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
  <!-- Stacked inner card: same visual language as the default (unfocused) top-level box, scaled down. -->
  <div
    v-if="embedded"
    ref="rootEl"
    class="package-box package-box--embedded"
    :class="{ 'package-box--pinned': pinned }"
    :style="{ '--box-accent': accent }"
  >
    <div class="lang-icon-slot lang-icon-slot--embedded">
      <img class="lang-svg folder-icon" :src="folderIconUrl" alt="" aria-hidden="true" decoding="async" />
    </div>
    <div class="package-box__body package-box__body--embedded">
      <div ref="titleEl" class="title">{{ label }}</div>
      <div v-if="subtitle" class="subtitle">{{ subtitle }}</div>
    </div>
  </div>

  <!-- Layer-drill focused root: icon + name in a top row; inner “diagram” stacks child packages. -->
  <div
    v-else-if="focused"
    ref="rootEl"
    class="package-box package-box--focused package-box--focused-layout"
    :class="{
      'package-box--pinned': pinned,
      'package-box--tools-wide': showColorTool,
      'package-box--pin-only': showPinTool && !showColorTool,
      'package-box--editing': editing,
    }"
    :style="{ '--box-accent': accent }"
  >
    <div v-if="showPinTool || showColorTool" class="package-box__tools" @pointerdown.stop>
      <button
        v-if="showPinTool"
        type="button"
        class="tool-btn tool-btn--pin"
        :class="{ 'tool-btn--active': pinned }"
        title="Pin — keep this package highlighted when another box is zoomed"
        :aria-pressed="pinned ? 'true' : 'false'"
        aria-label="Pin package (stays focused when zooming elsewhere)"
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

    <div class="package-box__focused-shell">
      <div class="package-box__focused-header" @dblclick.stop="startEditing">
        <div class="lang-icon-slot lang-icon-slot--header">
          <img class="lang-svg folder-icon" :src="folderIconUrl" alt="" aria-hidden="true" decoding="async" />
        </div>
        <div class="package-box__focused-head-text">
          <div ref="titleEl" class="title title--header" :title="'Double-click to rename / edit description'">
            {{ label }}
          </div>
          <div v-if="subtitle" class="subtitle subtitle--header">{{ subtitle }}</div>
        </div>
      </div>

      <div
        v-if="hasInnerDiagram"
        class="package-box__inner-diagram nodrag nopan"
        @pointerdown.stop
        @wheel.stop
        @click.self="clearInnerDrill"
      >
        <div
          v-if="innerDrillPathArr.length"
          class="package-box__inner-drill-toolbar"
          @pointerdown.stop
          @click.stop
        >
          <button type="button" class="inner-drill-btn" @click.stop="clearInnerDrill">All packages</button>
          <button
            v-if="innerDrillPathArr.length > 1"
            type="button"
            class="inner-drill-btn"
            @click.stop="innerDrillBackOne"
          >
            Back
          </button>
        </div>

        <div
          v-else-if="focusedInnerArtefact"
          class="package-box__inner-drill-toolbar"
          @pointerdown.stop
          @click.stop
        >
          <button type="button" class="inner-drill-btn" @click.stop="emit('update-inner-artefact-focus', null)">
            All members
          </button>
        </div>

        <div
          v-if="focusedInnerArtefact && !innerDrillPathArr.length"
          class="package-box__inner-slot package-box__inner-slot--artefact-panel"
          @pointerdown.stop
          @click.stop
        >
          <ScalaArtefactBox
            :box-id="focusedInnerArtefact.id"
            :label="focusedInnerArtefact.name"
            :subtitle="focusedInnerArtefact.subtitle ?? ''"
            :notes="notes"
            :box-color="boxColor"
            :pinned="false"
            :focused="true"
            :show-pin-tool="false"
            :show-color-tool="false"
            class="package-box__embedded-artefact-box"
          />
        </div>

        <template v-else-if="!innerDrillPathArr.length">
          <div
            v-for="child in innerPackages"
            :key="child.id"
            class="package-box__inner-slot package-box__inner-slot--clickable"
            @click.stop="onInnerCardClick(child.id)"
          >
            <PackageBox
              embedded
              :box-id="child.id"
              :label="child.name"
              :subtitle="child.subtitle ?? ''"
              :focused="false"
              :pinned="false"
              :show-pin-tool="false"
              :show-color-tool="false"
            />
          </div>
          <div
            v-for="art in innerArtefacts"
            :key="art.id"
            class="package-box__inner-slot package-box__inner-slot--artefact package-box__inner-slot--clickable"
            :class="{ 'package-box__inner-slot--artefact-focused': focusedInnerArtefactId === art.id }"
            @click.stop="onArtefactRowClick(art.id)"
          >
            <div class="package-box__artefact-row">
              <div class="lang-icon-slot lang-icon-slot--artefact">
                <img class="lang-svg" :src="scalaIconUrl" alt="" aria-hidden="true" decoding="async" />
              </div>
              <div class="package-box__artefact-text">
                <div class="package-box__artefact-title">{{ art.name }}</div>
                <div v-if="art.subtitle" class="package-box__artefact-subtitle">{{ art.subtitle }}</div>
              </div>
            </div>
          </div>
        </template>

        <template v-else-if="activeInnerSpec">
          <div
            class="package-box__inner-slot package-box__inner-slot--solo package-box__inner-slot--clickable"
            @click.stop="onInnerCardClick(activeInnerSpec.id)"
          >
            <PackageBox
              embedded
              :box-id="activeInnerSpec.id"
              :label="activeInnerSpec.name"
              :subtitle="activeInnerSpec.subtitle ?? ''"
              :focused="false"
              :pinned="false"
              :show-pin-tool="false"
              :show-color-tool="false"
            />
          </div>
          <div
            v-for="child in activeInnerSpec.innerPackages ?? []"
            :key="child.id"
            class="package-box__inner-slot package-box__inner-slot--clickable"
            @click.stop="onInnerCardClick(child.id)"
          >
            <PackageBox
              embedded
              :box-id="child.id"
              :label="child.name"
              :subtitle="child.subtitle ?? ''"
              :focused="false"
              :pinned="false"
              :show-pin-tool="false"
              :show-color-tool="false"
            />
          </div>
        </template>

        <div v-else class="package-box__inner-drill-fallback">
          <span class="inner-drill-fallback-text">Inner path no longer matches this tree.</span>
          <button type="button" class="inner-drill-btn" @click.stop="clearInnerDrill">All packages</button>
        </div>
      </div>

      <div v-else class="package-box__focused-legacy">
        <div v-if="notes" class="drill-note">{{ notes }}</div>
        <div v-if="description" class="description-full" :title="description">{{ description }}</div>
      </div>
    </div>

    <div
      v-if="editing"
      class="package-box__editor nodrag nopan"
      role="dialog"
      aria-label="Edit package"
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
          placeholder="Describe what this package contains (included in the generated AI prompt)…"
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

  <!-- Default (unfocused top-level): centered folder icon + title block. -->
  <div
    v-else
    ref="rootEl"
    class="package-box"
    :class="{
      'package-box--wide-short-row': wideShortRow,
      'package-box--tight': tightLayout,
      'package-box--pinned': pinned,
      'package-box--tools-wide': showColorTool,
      'package-box--pin-only': showPinTool && !showColorTool,
      'package-box--editing': editing,
    }"
    :style="{ '--box-accent': accent }"
  >
    <div v-if="showPinTool || showColorTool" class="package-box__tools" @pointerdown.stop>
      <button
        v-if="showPinTool"
        type="button"
        class="tool-btn tool-btn--pin"
        :class="{ 'tool-btn--active': pinned }"
        title="Pin — keep this package highlighted when another box is zoomed"
        :aria-pressed="pinned ? 'true' : 'false'"
        aria-label="Pin package (stays focused when zooming elsewhere)"
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
      <img class="lang-svg folder-icon" :src="folderIconUrl" alt="" aria-hidden="true" decoding="async" />
    </div>

    <div class="package-box__body" @dblclick.stop="startEditing">
      <div ref="titleEl" class="title" :title="'Double-click to rename / edit description'">{{ label }}</div>
      <div v-if="subtitle && !tightLayout" class="subtitle">{{ subtitle }}</div>
      <div
        v-if="description && !tightLayout && !wideShortRow"
        class="description-preview"
        :title="description"
      >
        {{ description }}
      </div>
    </div>

    <div
      v-if="editing"
      class="package-box__editor nodrag nopan"
      role="dialog"
      aria-label="Edit package"
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
          placeholder="Describe what this package contains (included in the generated AI prompt)…"
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
/*
 * Styles parallel ProjectBox; class names are namespaced (`package-box*`) so the two components
 * can drift independently without leaking selectors. If common styling between the two starts to
 * feel duplicated, lift the shared parts into a `_box.scss` partial — but only after we know what
 * actually wants to diverge.
 */
.package-box {
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

.package-box--pin-only {
  padding-right: clamp(34px, 6.5cqw, 44px);
}

.package-box--tools-wide {
  padding-right: clamp(72px, 12cqw, 108px);
}

/**
 * Focused package + inner diagram: pin/color tools are `position: absolute` in the top-right.
 * The global `--tools-wide` / `--pin-only` padding-right shrinks the whole content column, so
 * embedded cards stop short of the node edge (gap vs. Vue Flow’s blue selection outline). Keep
 * symmetric padding on the root and reserve horizontal space only on the header row so the title
 * clears the floating buttons while `package-box__inner-diagram` spans the full usable width.
 */
.package-box--focused-layout.package-box--tools-wide,
.package-box--focused-layout.package-box--pin-only {
  padding-right: clamp(6px, 1.35vmin, 14px);
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
/**
 * Tight = narrow column: keep folder readable via `cqh` (not `cqw`), stack **icon on top centered**
 * and **vertical title below**; title may draw upward over the icon for a compact footprint.
 */
.package-box--tight {
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 0;
  padding-top: clamp(4px, 1vmin, 10px);
  padding-bottom: clamp(4px, 1vmin, 10px);
}
.package-box--tight .lang-icon-slot {
  transform: none;
  align-self: center;
  width: 100%;
  flex: 0 0 auto;
  flex-shrink: 0;
  height: auto;
  min-height: clamp(28px, 26cqh, 44px);
  max-height: min(44cqh, 52px);
  margin-bottom: 0;
  margin-right: 0;
  justify-content: center;
  z-index: 0;
}
.package-box--tight .lang-icon-slot :deep(.lang-svg) {
  height: clamp(26px, min(34px, 34cqh), 42px);
  width: auto;
  max-height: min(100%, 40cqh);
  max-width: min(100%, 56px);
}
.package-box--tight .package-box__body {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  width: 100%;
  justify-content: center;
  align-items: center;
  margin-top: clamp(-16px, -4cqh, -6px);
  position: relative;
  z-index: 1;
}

/** Unfocused: wide + shallow node — icon column left, title/subtitle stack right (LR layout). */
.package-box--wide-short-row {
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: 0;
  padding-top: clamp(4px, 1vmin, 10px);
  padding-bottom: clamp(4px, 1vmin, 10px);
}
.package-box--wide-short-row .lang-icon-slot {
  width: auto;
  min-width: 0;
  flex: 0 0 auto;
  align-self: center;
  height: clamp(28px, min(18cqh, 72px), 64px);
  max-height: min(100%, 72px);
  margin-bottom: 0;
  margin-right: clamp(8px, 2.2cqw, 14px);
  justify-content: center;
}
.package-box--wide-short-row .lang-icon-slot :deep(.lang-svg) {
  max-height: min(100%, 52px);
  height: auto;
  width: auto;
}
.package-box--wide-short-row .package-box__body {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  align-items: flex-start;
  justify-content: center;
  text-align: left;
}
.package-box--wide-short-row .title {
  text-align: left;
  align-self: stretch;
}
.package-box--wide-short-row .subtitle {
  text-align: left;
  align-self: stretch;
  max-height: 2.8em;
}

.package-box__body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: stretch;
}

/** Layer-drill focused root: header row + inner diagram (child packages). */
.package-box--focused-layout {
  justify-content: flex-start;
}
/** Tighter bottom than generic `.package-box` padding — inner diagram + embedded cards sit closer to the frame. */
.package-box.package-box--focused-layout {
  padding-bottom: clamp(2px, 0.35vmin, 6px);
}
.package-box__focused-shell {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding-top: 2px;
}
.package-box__focused-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  margin-bottom: 8px;
  /** Clears absolutely positioned tool cluster (see `.package-box--focused-layout` padding note). */
  padding-right: clamp(44px, 10cqw, 104px);
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
}
.package-box__focused-head-text {
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
}
.subtitle--header {
  margin-top: 0;
  font-size: clamp(0.65rem, min(1.45vmin, 2.2cqh), 0.85rem);
  text-align: left;
  opacity: 1;
  max-height: none;
  line-height: 1.25;
  color: #475569;
}
.package-box__inner-diagram {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  padding: 10px;
  border-radius: 10px;
  border: 1px dashed rgb(148 163 184 / 0.95);
  background: rgb(248 250 252 / 0.92);
  overflow: auto;
}
.package-box--focused-layout .package-box__inner-diagram {
  padding-bottom: 4px;
}
.package-box__inner-slot {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  width: 100%;
  max-width: 100%;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}
.package-box__inner-slot > .package-box {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  width: 100%;
  max-width: 100%;
  align-self: stretch;
}
.package-box__inner-slot--clickable {
  cursor: pointer;
}
.package-box__inner-slot--solo {
  flex: 3 1 0;
}
.package-box__inner-slot--artefact-panel {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  width: 100%;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  cursor: default;
}
.package-box__embedded-artefact-box {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  width: 100%;
}
.package-box__inner-slot--artefact {
  cursor: pointer;
}
.package-box__inner-slot--artefact-focused .package-box__artefact-row {
  border-color: var(--box-accent, #64748b);
  box-shadow:
    0 0 0 1px rgb(255 255 255 / 0.85),
    0 0 0 2px var(--box-accent, #64748b),
    0 2px 8px rgb(15 23 42 / 0.08);
  background: rgb(255 255 255 / 0.98);
}
.package-box__artefact-row {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px 6px;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  border-radius: 8px;
  border: 1px solid rgb(148 163 184 / 0.55);
  background: rgb(255 255 255 / 0.88);
}
.lang-icon-slot--artefact {
  width: 36px;
  height: 36px;
  margin: 0;
  flex-shrink: 0;
}
.lang-icon-slot--artefact :deep(.lang-svg) {
  max-height: 30px;
}
.package-box__artefact-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
}
.package-box__artefact-title {
  font-weight: 600;
  font-size: clamp(0.72rem, min(1.6vmin, 2.4cqh), 0.95rem);
  color: #0f172a;
  line-height: 1.25;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.package-box__artefact-subtitle {
  font-size: clamp(0.62rem, min(1.35vmin, 2cqh), 0.8rem);
  color: #64748b;
  line-height: 1.3;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.package-box__inner-drill-toolbar {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-shrink: 0;
}
.inner-drill-btn {
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid rgb(148 163 184 / 0.9);
  background: rgb(255 255 255 / 0.95);
  color: #334155;
  cursor: pointer;
}
.inner-drill-btn:hover {
  border-color: var(--box-accent, #64748b);
  color: #0f172a;
}
.package-box__inner-drill-fallback {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 0;
  font-size: 12px;
  color: #64748b;
}
.inner-drill-fallback-text {
  line-height: 1.4;
}
.package-box__focused-legacy {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/** Inner stack row: same chrome as default top-level, slightly tighter. */
.package-box--embedded {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  padding: 8px 10px 3px;
  justify-content: flex-start;
}
/**
 * Default `.lang-icon-slot` uses `align-self: center`, which shrink-wraps the slot to the icon
 * width in a column flex — inner cards then stay narrow with empty space on the right. Stretch
 * the icon row to the full inner-diagram width so each embedded package reads as a full-width tile.
 */
.package-box--embedded > .lang-icon-slot.lang-icon-slot--embedded {
  align-self: stretch;
  width: 100%;
  max-width: none;
  height: clamp(26px, min(22cqw, 16cqh), 56px);
  margin-bottom: 6px;
}
.package-box__body--embedded {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  width: 100%;
  align-self: stretch;
  justify-content: center;
}
.package-box--embedded .title {
  text-align: center;
}
.package-box--embedded .subtitle {
  text-align: center;
  margin-top: 4px;
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
.package-box__tools {
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
.package-box--pinned:not(.package-box--focused) {
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
.package-box--focused {
  box-shadow:
    inset 8px 0 0 0 var(--box-accent),
    0 4px 22px rgb(15 23 42 / 0.14);
  outline: 2px solid var(--box-accent);
  outline-offset: 0;
}
.package-box--focused .title {
  font-size: clamp(0.82rem, min(2.4vmin, 3.8cqh), 1.45rem);
}
.package-box--tight .title {
  white-space: nowrap;
  overflow: visible;
  text-overflow: clip;
  max-width: none;
  max-height: none;
  align-self: center;
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  text-orientation: mixed;
  line-height: 1.15;
  position: relative;
  z-index: 1;
  pointer-events: none;
}
.package-box--tight .subtitle {
  opacity: 0;
  margin-top: 0;
  max-height: 0;
  transform: translateY(4px);
  pointer-events: none;
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
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgb(15 23 42 / 0.12);
  font-size: 11px;
  line-height: 1.45;
  color: #334155;
  white-space: pre-wrap;
  overflow: auto;
  flex: 0 1 auto;
  min-height: 0;
  text-align: left;
  font-style: italic;
}
.package-box--editing {
  overflow: visible;
}
.package-box__editor {
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
