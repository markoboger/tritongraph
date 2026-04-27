<script setup lang="ts">
/**
 * Layer-drill **focused** body for a Scala declaration (class / object / trait / enum / def …).
 *
 * Reuses the focused **box chrome** from {@link PackageBox} (accent strip, focus outline, padding,
 * tools cluster, tight layout, transitions). This component is intentionally thin: it only supplies
 * the artefact-specific bits via PackageBox slots:
 *   - `focused-header-icon`  — kind badge (`C`, `T`, `O`, …) instead of the folder icon
 *   - `focused-body`         — Scaladoc / coverage / signatures / sonar collapsible sections
 *
 * Two render contexts:
 *   1. **Top-level focused leaf** (from {@link FlowPackageNode} when flow `type === 'artefact'`).
 *   2. **Inner expanded artefact** inside another {@link PackageBox} when an artefact row is opened.
 *
 * The compact (unfocused) chrome on the canvas is rendered directly by `PackageBox` with
 * `leaf-visual="artefact"` — no duplication needed.
 */
import { computed } from 'vue'
import { boxColorForId, type NamedBoxColor } from '../../graph/boxColors'
import PackageBox from './PackageBox.vue'
import ScalaArtefactPanels from './ScalaArtefactPanels.vue'

const props = defineProps<{
  boxId: string
  label: string
  /** The Scala kind keyword — `class`, `case class`, `object`, `trait`, `enum`, `def`, … */
  subtitle?: string
  /**
   * Full one-line declaration (`"object Demo extends App"`, `"trait Animal extends Lifeform"`).
   * Forwarded to {@link PackageBox}, which renders it as the focused header subtitle in place of
   * the bare kind keyword. `subtitle` remains the kind so the inline unfocused chrome / badge
   * selection stays compact — only the header line swaps to the richer text.
   */
  declaration?: string
  /**
   * Primary constructor parameter source text (with parens, whitespace collapsed) —
   * e.g. `"(variety: String, ripeness: Ripeness.Value)"`. Rendered in the focused
   * "Arguments" panel as a Shiki-highlighted Scala snippet (prefixed with
   * `class <Name>` at render time so the highlighter has a valid anchor; bare tuples
   * aren't valid Scala).
   *
   * Empty or missing — for traits / objects / classes without a parameter clause —
   * causes the panel to show a short "no arguments" placeholder so the compartment
   * still renders its header and keeps the panel count stable.
   */
  constructorParams?: string
  /**
   * One-line signatures of `def` members for this artefact (source order, body stripped),
   * paired with the 0-indexed source row of each declaration. The Methods panel renders
   * them as a Shiki-highlighted code block and uses the rows to wire per-line
   * click-to-open-at-line actions. An empty or missing list shows a short "no methods"
   * placeholder so the panel still has chrome.
   */
  methodSignatures?: ReadonlyArray<{ signature: string; startRow: number }>
  /** Shown when the box is focused (layer drill). */
  notes?: string
  boxColor?: NamedBoxColor | string
  pinned: boolean
  showPinTool: boolean
  /** Layer-drill focused box only: show accent color picker. */
  showColorTool: boolean
  /**
   * Show the "open in editor" tool button when the caller has a resolvable `(sourceFile, sourceRow)`
   * for this artefact AND knows which `(root, exampleDir)` to anchor the relative path to.
   * See {@link FlowPackageNode.triggerOpenInEditor} for the resolution side.
   */
  canOpenInEditor?: boolean
  /**
   * When true, this focused artefact lives inside a package inner diagram — use the same
   * horizontal compact header as the hosting package (not the wide centered stacked header).
   */
  innerDiagramDescendant?: boolean
}>()

const emit = defineEmits<{
  'toggle-pin': [MouseEvent]
  'cycle-color': []
  /**
   * Fired when any open-in-editor trigger inside the focused body is activated — the tool
   * button, the clickable declaration header, an Arguments-panel click, or a per-line click
   * in the Methods panel.
   *
   * The optional `line` argument is a 0-indexed source row: the tool button, the header
   * declaration, and the Arguments panel all resolve to the class's own declaration and
   * therefore pass `undefined` (the parent falls back to `data.sourceRow`). Per-method
   * clicks from the Methods panel pass the method's `startRow`. The parent
   * ({@link FlowPackageNode.triggerOpenInEditor}) is responsible for composing the final
   * editor URL, so this component never needs to know the file path.
   */
  'open-in-editor': [line?: number]
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
</script>

<template>
  <PackageBox
    leaf-visual="artefact"
    :box-id="boxId"
    :label="label"
    :subtitle="subtitle"
    :declaration="declaration"
    :notes="notes"
    :box-color="boxColor"
    :pinned="pinned"
    :focused="true"
    :inner-diagram-descendant="innerDiagramDescendant"
    :show-pin-tool="showPinTool"
    :show-color-tool="showColorTool"
    @toggle-pin="(ev: MouseEvent) => emit('toggle-pin', ev)"
    @cycle-color="emit('cycle-color')"
    @declaration-click="emit('open-in-editor')"
  >
    <template #focused-header-icon>
      <div class="kind-badge-slot kind-badge-slot--header">
        <span
          class="kind-badge kind-badge--header"
          :title="subtitle ?? ''"
          :style="{ '--box-accent': accent }"
        >{{ kindBadge }}</span>
      </div>
    </template>

    <template #focused-body>
      <ScalaArtefactPanels
        :box-id="boxId"
        :constructor-params="constructorParams"
        :method-signatures="methodSignatures"
        @open-in-editor="(line?: number) => emit('open-in-editor', line)"
      />
    </template>
  </PackageBox>
</template>

<style scoped>
/*
 * Slot content only — chrome (accent strip, padding, focus outline, tools cluster, tight layout)
 * lives in PackageBox so packages and Scala leaves stay in lock-step. Vue scoped styles still apply
 * to slotted content because they carry the parent-component scope attribute.
 */

.kind-badge-slot {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-shrink: 0;
  pointer-events: none;
}
.kind-badge-slot--header {
  width: 40px;
  height: 40px;
  margin: 0;
  align-self: flex-start;
}
.kind-badge {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  border-radius: 50%;
  background: var(--box-accent, steelblue);
  color: #fff;
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  letter-spacing: 0.02em;
  box-shadow: inset 0 0 0 2px rgb(255 255 255 / 0.18), 0 1px 2px rgb(15 23 42 / 0.18);
}
.kind-badge--header {
  width: 36px;
  height: 36px;
  font-size: clamp(0.72rem, 11cqw, 1rem);
}
</style>
