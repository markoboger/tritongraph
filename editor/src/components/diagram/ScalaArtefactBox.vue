<script setup lang="ts">
/**
 * Layer-drill **focused** body for a Scala declaration (class / object / trait / enum / def …).
 *
 * Reuses the focused **box chrome** from {@link PackageBox} (accent strip, focus outline, padding,
 * tools cluster, tight layout, transitions). This component is intentionally thin: it only supplies
 * the artefact-specific bits via PackageBox slots:
 *   - `focused-tools-prefix` — coverage / sonar metric icons next to the pin/color tools
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

const props = defineProps<{
  boxId: string
  label: string
  /** The Scala kind keyword — `class`, `case class`, `object`, `trait`, `enum`, `def`, … */
  subtitle?: string
  /** Shown when the box is focused (layer drill). */
  notes?: string
  boxColor?: NamedBoxColor | string
  pinned: boolean
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
</script>

<template>
  <PackageBox
    leaf-visual="artefact"
    :box-id="boxId"
    :label="label"
    :subtitle="subtitle"
    :notes="notes"
    :box-color="boxColor"
    :pinned="pinned"
    :focused="true"
    :show-pin-tool="showPinTool"
    :show-color-tool="showColorTool"
    @toggle-pin="(ev: MouseEvent) => emit('toggle-pin', ev)"
    @cycle-color="emit('cycle-color')"
  >
    <template #focused-tools-prefix>
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
    </template>

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
      <div class="artefact-body nodrag nopan" @pointerdown.stop @wheel.stop @click.stop>
        <details class="artefact-body__details">
          <summary class="artefact-body__summary">Documentation</summary>
          <div class="artefact-body__details-body">
            <p class="artefact-body__placeholder">
              Placeholder: Scaladoc / KDoc-style comment text for this declaration would appear here once
              wired to the parser or language server.
            </p>
          </div>
        </details>
        <details class="artefact-body__details">
          <summary class="artefact-body__summary">Tests &amp; specs (coverage)</summary>
          <div class="artefact-body__details-body">
            <p class="artefact-body__placeholder">
              Placeholder: e.g. <code>AnimalSpec</code>, <code>FoodWebIntegrationTest</code> — classes that
              exercise this artefact for coverage reporting.
            </p>
          </div>
        </details>
        <details class="artefact-body__details">
          <summary class="artefact-body__summary">Test run checklist</summary>
          <div class="artefact-body__details-body">
            <ul class="artefact-body__checklist">
              <li class="artefact-body__checklist-item">Placeholder: compile OK</li>
              <li class="artefact-body__checklist-item">Placeholder: unit tests — pending CI hook</li>
              <li class="artefact-body__checklist-item">Placeholder: property tests — not run</li>
            </ul>
          </div>
        </details>
        <details class="artefact-body__details">
          <summary class="artefact-body__summary">Methods (signatures)</summary>
          <div class="artefact-body__details-body artefact-body__details-body--mono">
            <pre class="artefact-body__signatures">def apply(name: String): Animal
def unapply(a: Animal): Option[(String)]
override def toString: String</pre>
            <p class="artefact-body__placeholder artefact-body__placeholder--small">
              Placeholder signatures — replace with tree-sitter member list.
            </p>
          </div>
        </details>
        <details class="artefact-body__details">
          <summary class="artefact-body__summary">SonarQube issues</summary>
          <div class="artefact-body__details-body">
            <p class="artefact-body__placeholder">
              Placeholder: issue keys, severities, and messages from SonarQube for this file / symbol would
              list here after integration.
            </p>
          </div>
        </details>
        <div v-if="notes" class="artefact-body__drill-note">{{ notes }}</div>
      </div>
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

.artefact-body {
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  padding: 2px 0 6px;
  display: flex;
  flex-direction: column;
}
.artefact-body__details {
  border: 1px solid rgb(148 163 184 / 0.85);
  border-radius: 8px;
  background: rgb(248 250 252 / 0.95);
  margin-bottom: 8px;
}
.artefact-body__details:last-of-type {
  margin-bottom: 0;
}
.artefact-body__summary {
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
.artefact-body__summary::-webkit-details-marker {
  display: none;
}
.artefact-body__summary::after {
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
.artefact-body__details[open] > .artefact-body__summary::after {
  transform: rotate(225deg);
}
.artefact-body__details-body {
  padding: 0 10px 10px;
  font-size: clamp(0.62rem, min(1.35vmin, 2cqh), 0.8rem);
  line-height: 1.45;
  color: #475569;
}
.artefact-body__details-body--mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.artefact-body__placeholder {
  margin: 0;
}
.artefact-body__placeholder--small {
  margin-top: 8px;
  font-style: italic;
  font-size: 0.92em;
}
.artefact-body__placeholder code {
  font-size: 0.95em;
  padding: 0 0.2em;
  border-radius: 4px;
  background: rgb(241 245 249 / 0.95);
}
.artefact-body__checklist {
  margin: 0;
  padding-left: 1.1rem;
}
.artefact-body__checklist-item {
  margin-bottom: 4px;
}
.artefact-body__signatures {
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
.artefact-body__drill-note {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid rgb(15 23 42 / 0.12);
  font-size: 10px;
  line-height: 1.45;
  color: #334155;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  white-space: pre-wrap;
  overflow: auto;
  text-align: left;
  flex: 0 0 auto;
}
</style>
