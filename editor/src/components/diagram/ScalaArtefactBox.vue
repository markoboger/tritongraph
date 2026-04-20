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
import { computed, inject, ref, watch, type Ref } from 'vue'
import { boxColorForId, type NamedBoxColor } from '../../graph/boxColors'
import { openInEditor } from '../../openInEditor'
import { useScalaDoc, useScalaTestBlock } from '../../store/useOverlay'
import ShikiCodeBlock from '../ShikiCodeBlock.vue'
import TestChecklistBlock from '../TestChecklistBlock.vue'
import PackageBox from './PackageBox.vue'
import { useScalaSpecs } from '../../store/useOverlay'

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
/**
 * Compartment layout: all subsections are visible at once, each rendered as a collapsible panel
 * that splits the focused body evenly (`flex: 1 1 0`). Clicking a panel header promotes it as
 * the *expanded* one — it grows (`flex-grow: 6`) while peers stay at `flex-grow: 1`, so the
 * user reveals content without a second click and without navigating an accordion. Clicking the
 * expanded panel again (or switching boxes) resets to the even split.
 *
 * The id list below is the source of truth: reorder / add entries here and the template picks
 * them up (each panel id renders its dedicated content template in {@link panelBody}).
 */
/**
 * Compartment ids — ordered deliberately so the focused body reads top-to-bottom in the
 * same narrative a reviewer would follow when looking at the class in source:
 *
 *   Documentation → what does it claim to do?
 *   Arguments     → what does it take?
 *   Methods       → what does it offer?
 *   Tests & Specs → how is it covered?
 *   Checklist     → what's the state of that coverage?
 *   Issues        → what does static analysis complain about?
 *
 * Reorder / add entries here and the template picks them up automatically (each id has
 * its own `v-if` branch inside `#focused-body`).
 */
type PanelId = 'doc' | 'arguments' | 'methods' | 'coverage' | 'checklist' | 'issues'
const PANEL_DEFS: ReadonlyArray<{ id: PanelId; label: string }> = [
  { id: 'doc', label: 'Documentation' },
  { id: 'arguments', label: 'Arguments' },
  { id: 'methods', label: 'Methods' },
  { id: 'coverage', label: 'Tests and Specs' },
  { id: 'checklist', label: 'Test run checklist' },
  { id: 'issues', label: 'Issues' },
] as const

const expandedPanel = ref<PanelId | null>(null)

/** Reset the expansion whenever the user drills a different artefact so each box opens neutral. */
watch(
  () => props.boxId,
  () => {
    expandedPanel.value = null
  },
)

function togglePanel(id: PanelId): void {
  expandedPanel.value = expandedPanel.value === id ? null : id
}

function lineCount(s: string): number {
  if (!s) return 0
  return s.split('\n').filter((l) => l.trim().length > 0).length
}

const defaultPanelGrow = computed(() => {
  const docLines = lineCount(String(scalaDocRef.value ?? ''))
  const argsLines = lineCount(argumentsSnippet.value)
  const methodsLines = lineCount(methodSignaturesText.value)
  const specLines = lineCount(specsText.value)
  const checklistLines = lineCount(String(testBlockRef.value?.block ?? ''))

  /**
   * Content-driven sizing: each panel gets a minimum so it's always readable, then
   * gains height in proportion to its content line count (capped so very long logs
   * don't starve other panels).
   */
  const cap = (n: number, max: number) => Math.max(0, Math.min(max, n))
  const min = {
    doc: 0.9,
    arguments: 1.0,
    methods: 1.0,
    coverage: 0.9,
    checklist: 1.0,
    issues: 0.8,
  } satisfies Record<PanelId, number>
  const score = {
    doc: cap(docLines, 10),
    arguments: cap(argsLines, 14),
    methods: cap(methodsLines, 16),
    coverage: cap(specLines, 10),
    checklist: cap(checklistLines, 18),
    issues: 0,
  } satisfies Record<PanelId, number>

  /**
   * Priority bias (top-to-bottom, but fair): higher panels get a slight multiplier so in
   * cramped layouts they tend to remain more readable, while still giving every panel
   * enough room (scroll handles the rest).
   */
  const prio = {
    doc: 1.12,
    arguments: 1.1,
    methods: 1.06,
    coverage: 1.02,
    checklist: 1.0,
    issues: 0.95,
  } satisfies Record<PanelId, number>

  const desired: Record<PanelId, number> = {
    doc: (min.doc + score.doc * 0.14) * prio.doc,
    arguments: (min.arguments + score.arguments * 0.12) * prio.arguments,
    methods: (min.methods + score.methods * 0.11) * prio.methods,
    coverage: (min.coverage + score.coverage * 0.12) * prio.coverage,
    checklist: (min.checklist + score.checklist * 0.1) * prio.checklist,
    issues: min.issues * prio.issues,
  }

  // If there's very little content overall, keep an even split (avoids awkward whitespace).
  const totalScore =
    score.doc + score.arguments + score.methods + score.coverage + score.checklist + score.issues
  if (totalScore <= 6) {
    return {
      doc: 1,
      arguments: 1,
      methods: 1,
      coverage: 1,
      checklist: 1,
      issues: 1,
    } satisfies Record<PanelId, number>
  }
  return desired satisfies Record<PanelId, number>
})

function panelGrowFor(id: PanelId): number {
  if (expandedPanel.value) return 1
  return defaultPanelGrow.value[id] ?? 1
}

/** Source-ordered signatures, joined with newlines so Shiki renders each as its own line. */
const methodSignaturesText = computed(() => {
  const sigs = props.methodSignatures
  if (!Array.isArray(sigs)) return ''
  return sigs.map((s) => s.signature).join('\n')
})

/**
 * Dispatch per-method click-to-open at line. `ShikiCodeBlock` emits the 0-indexed position of
 * the clicked `.line` inside the highlighted HTML; we look up the matching `methodSignatures`
 * entry's `startRow` and forward it to the parent.
 *
 * Defensive fallbacks: if the index is somehow out of range (stale click during a props swap,
 * or a highlighter change that alters line counts) we still emit `open-in-editor` with no line
 * so the user at least lands inside the correct file.
 */
function onMethodLineClick(ev: { index: number }): void {
  const sigs = props.methodSignatures ?? []
  const entry = sigs[ev.index]
  if (entry && Number.isFinite(entry.startRow)) {
    emit('open-in-editor', entry.startRow)
    return
  }
  emit('open-in-editor')
}

/**
 * Clicking any line of the Arguments panel always resolves to the enclosing class's own
 * declaration — constructor params don't have distinct source rows. We emit with no line so
 * the parent falls back to `data.sourceRow`, keeping this component independent of file-layout
 * knowledge.
 */
function onArgumentsLineClick(): void {
  emit('open-in-editor')
}

/**
 * Split the scanner's parameter-clause source into one entry per argument, with generics and
 * nested calls counted as a single bracket depth — so `xs: List[A, B]` stays on one line even
 * though it contains a comma. Multi-clause signatures (`(a: A)(implicit b: B)`) are flattened:
 * each clause contributes its own args into the same flat list so the Arguments panel reads as
 * a straight vertical list.
 *
 * Leading / trailing whitespace and empty splits (trailing commas, degenerate input) are
 * dropped. The caller is responsible for joining with whatever separator the panel wants.
 */
function splitConstructorArgs(raw: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < raw.length) {
    if (raw[i] !== '(') {
      i++
      continue
    }
    // Walk to the matching close-paren, tracking nested brackets so generics don't prematurely
    // close the clause.
    let depth = 1
    let j = i + 1
    while (j < raw.length && depth > 0) {
      const c = raw[j]
      if (c === '(' || c === '[' || c === '{') depth++
      else if (c === ')' || c === ']' || c === '}') {
        depth--
        if (depth === 0) break
      }
      j++
    }
    const inner = raw.slice(i + 1, j)
    // Split the clause body at top-level commas only.
    let bufStart = 0
    let d = 0
    for (let k = 0; k < inner.length; k++) {
      const c = inner[k]
      if (c === '(' || c === '[' || c === '{') d++
      else if (c === ')' || c === ']' || c === '}') d--
      else if (c === ',' && d === 0) {
        const piece = inner.slice(bufStart, k).trim()
        if (piece) out.push(piece)
        bufStart = k + 1
      }
    }
    const tail = inner.slice(bufStart).trim()
    if (tail) out.push(tail)
    i = j + 1
  }
  return out
}

/**
 * Shiki-ready snippet for the Arguments panel — one argument per line, no surrounding
 * parentheses, no re-declaration of the class. Returns `""` when the scanner captured no
 * parameter clause (traits, objects, classes without `(…)`) so the template can fall back
 * to a short placeholder.
 *
 * We stick with `lang="scala"` on the Shiki block: the individual lines (`name: Type`) are
 * valid Scala named parameters and get type-highlighted correctly. The comma at the end of
 * each non-last line keeps the appearance of a parameter list so a reader who's familiar with
 * Scala reads it as args without our re-introducing the parens and class keyword.
 */
const argumentsSnippet = computed(() => {
  const raw = (props.constructorParams ?? '').trim()
  if (!raw) return ''
  const parts = splitConstructorArgs(raw)
  if (!parts.length) return ''
  return parts.join(',\n')
})

/**
 * Scaladoc for this artefact, pulled reactively from the TinyBase `scalaDocs` table.
 *
 * The workspace key comes from {@link App.activeWorkspaceKey}, provided as a `Ref<string>` at
 * the root of the app. We read `.value` once at setup — ScalaArtefactBox is remounted when
 * the user switches tabs, so the key is stable for the life of this instance. Missing
 * injection (component rendered in a test harness without the provide) falls back to an
 * empty key, which is handled gracefully by `useScalaDoc` (always resolves to `''`).
 *
 * `boxId` is the same `artefactResourceId` the scanner uses when it seeds the table in
 * `App.loadScalaPackagesForExample`, so the lookup is a direct primary-key read.
 */
const workspaceKeyRef = inject<Ref<string>>('tritonWorkspaceKey')
const scalaDocRef = useScalaDoc(workspaceKeyRef?.value ?? '', props.boxId)
const testBlockRef = useScalaTestBlock(workspaceKeyRef?.value ?? '', props.boxId)
const specsRowRef = useScalaSpecs(workspaceKeyRef?.value ?? '', props.boxId)

const activeExampleRef = inject<Ref<{ root: string; dir: string } | null> | undefined>(
  'tritonActiveExample',
  undefined,
)

type SpecLink = { name: string; declaration: string; file: string; startRow: number }

const specLinks = computed<SpecLink[]>(() => {
  const raw = specsRowRef.value?.specsJson
  if (!raw || typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((x): x is SpecLink => !!x && typeof x === 'object')
      .map((x: any) => ({
        name: String(x.name ?? ''),
        declaration: String(x.declaration ?? ''),
        file: String(x.file ?? ''),
        startRow: Number.isFinite(Number(x.startRow)) ? Number(x.startRow) : 0,
      }))
      .filter((x) => x.name && x.file)
  } catch {
    return []
  }
})

const specsText = computed(() => specLinks.value.map((s) => s.declaration || `class ${s.name}`).join('\n'))

function onSpecLineClick(ev: { index: number }): void {
  const ex = activeExampleRef?.value
  const spec = specLinks.value[ev.index]
  if (!ex || !spec) return
  openInEditor({
    root: ex.root,
    exampleDir: ex.dir,
    relPath: spec.file,
    line: (spec.startRow ?? 0) + 1,
  })
}

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
    :show-pin-tool="showPinTool"
    :show-color-tool="showColorTool"
    @toggle-pin="(ev: MouseEvent) => emit('toggle-pin', ev)"
    @cycle-color="emit('cycle-color')"
    @declaration-click="emit('open-in-editor')"
  >
    <template #focused-tools-prefix>
      <!--
        Coverage indicator is now rendered by the parent `PackageBox` for *every* box
        (packages + Scala leaves, focused or not) as a slim horizontal split bar — see
        `.package-box__coverage` there. We only inject the issues placeholder here, since
        Sonar issues remain a Scala-artefact-specific signal for now.
      -->
      <span
        class="metric-icon metric-icon--issues"
        title="Issues (placeholder)"
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
        <div
          v-for="panel in PANEL_DEFS"
          :key="panel.id"
          class="artefact-body__panel"
          :class="{
            'artefact-body__panel--expanded': expandedPanel === panel.id,
            'artefact-body__panel--compact': expandedPanel !== null && expandedPanel !== panel.id,
          }"
          :style="expandedPanel === null ? { flexGrow: String(panelGrowFor(panel.id)) } : undefined"
        >
          <button
            type="button"
            class="artefact-body__panel-head"
            :aria-expanded="expandedPanel === panel.id"
            :title="expandedPanel === panel.id ? 'Click to restore even split' : 'Click to expand this section'"
            @click.stop="togglePanel(panel.id)"
          >
            <span class="artefact-body__panel-label">{{ panel.label }}</span>
            <span class="artefact-body__panel-chevron" aria-hidden="true" />
          </button>
          <div class="artefact-body__panel-body">
            <template v-if="panel.id === 'doc'">
              <!--
                Scaladoc captured by the tree-sitter parser at scan time, with `/**`, per-line
                `*` gutters, and the closing `*/` stripped. Rendered as pre-wrap so paragraph
                breaks from the source survive without markdown processing (we can upgrade to
                a markdown renderer later if Scaladoc link / tag handling becomes useful).
              -->
              <p v-if="scalaDocRef" class="artefact-body__doc">{{ scalaDocRef }}</p>
              <p v-else class="artefact-body__placeholder artefact-body__placeholder--small">
                No Scaladoc comment precedes this declaration.
              </p>
            </template>
            <template v-else-if="panel.id === 'arguments'">
              <!--
                Primary constructor parameter clauses, rendered via Shiki so colons, type
                names, and default values pick up Scala highlighting. We prepend
                `class <Name>` at computed time so Shiki has a valid syntactic anchor —
                bare tuple snippets like `(a: A)` are not a Scala statement and get
                highlighted as pattern expressions.
              -->
              <ShikiCodeBlock
                v-if="argumentsSnippet"
                :code="argumentsSnippet"
                lang="scala"
                clickable
                @line-click="onArgumentsLineClick"
              />
              <p v-else class="artefact-body__placeholder artefact-body__placeholder--small">
                No constructor arguments.
              </p>
            </template>
            <template v-else-if="panel.id === 'methods'">
              <ShikiCodeBlock
                v-if="methodSignaturesText"
                :code="methodSignaturesText"
                lang="scala"
                clickable
                @line-click="onMethodLineClick"
              />
              <p v-else class="artefact-body__placeholder artefact-body__placeholder--small">
                No <code>def</code> members found in this declaration.
              </p>
            </template>
            <template v-else-if="panel.id === 'coverage'">
              <ShikiCodeBlock
                v-if="specsText"
                :code="specsText"
                lang="scala"
                clickable
                @line-click="onSpecLineClick"
              />
              <p v-else class="artefact-body__placeholder artefact-body__placeholder--small">
                No specs detected for this artefact from captured <code>sbt test</code> output.
              </p>
            </template>
            <template v-else-if="panel.id === 'checklist'">
              <TestChecklistBlock v-if="testBlockRef.block" :text="testBlockRef.block" />
              <p v-else class="artefact-body__placeholder artefact-body__placeholder--small">
                No captured <code>sbt test</code> output for this artefact in this workspace.
              </p>
            </template>
            <template v-else-if="panel.id === 'issues'">
              <p class="artefact-body__placeholder">
                Placeholder: issue keys, severities, and messages from static analysis for this
                file or symbol would list here after integration.
              </p>
            </template>
          </div>
        </div>
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
  /**
   * The panels distribute the available height via flex-grow (see `.artefact-body__panel`). The
   * whole strip is the flex container, so `overflow: hidden` prevents the outer box from
   * scrolling — overflow belongs to each panel's body (`.artefact-body__panel-body`) instead,
   * so long content inside one compartment doesn't push siblings out of view.
   *
   * Zero padding/gap so each panel extends flush to its neighbour and to the outer focused
   * box — the only separator between compartments is a 1px top border on the panel head.
   * Keeps the focused card visually calm; the accent strip on the outer box already frames
   * the whole thing, panels don't need their own chrome.
   */
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.artefact-body__panel {
  /**
   * Panels inherit the focused card background (`--box-fill` set on the outer box) instead
   * of painting their own tint — "use the same background color as the surrounding box".
   * A single 1px top border on every panel except the first demarcates compartments; no
   * border-radius so panels meet flush on all four sides.
   */
  border: 0;
  border-top: 1px solid rgb(148 163 184 / 0.45);
  border-radius: 0;
  background: transparent;
  display: flex;
  flex-direction: column;
  min-height: 0;
  /**
   * Even split by default — all panels claim `flex-grow: 1` with `flex-basis: 0`, so the five
   * compartments carve up the focused body equally regardless of their intrinsic content size.
   * `transition: flex-grow` animates the promote/demote swap.
   */
  flex: 1 1 0;
  overflow: hidden;
  transition: flex-grow 220ms ease;
}
.artefact-body__panel:first-child {
  border-top: 0;
}
.artefact-body__panel--expanded {
  /**
   * Promoted panel: takes 6x the space of any peer. With five peers at `flex-grow: 1`, that is
   * roughly 6/11 ≈ 55% of the body — enough to actually read the content without collapsing
   * peers completely (important, since the whole point of the layout is that every section
   * stays reachable with a single click).
   */
  flex-grow: 6;
}
.artefact-body__panel-head {
  all: unset;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-weight: 600;
  font-size: clamp(0.68rem, min(1.5vmin, 2cqh), 0.82rem);
  padding: 6px 10px;
  color: #0f172a;
  flex-shrink: 0;
}
.artefact-body__panel-head:focus-visible {
  outline: 2px solid var(--box-accent, #3b82f6);
  outline-offset: -2px;
  border-radius: 6px;
}
.artefact-body__panel-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.artefact-body__panel-chevron {
  width: 0.45em;
  height: 0.45em;
  margin-right: 2px;
  border-right: 2px solid #64748b;
  border-bottom: 2px solid #64748b;
  transform: rotate(45deg);
  flex-shrink: 0;
  transition: transform 220ms ease;
}
.artefact-body__panel--expanded .artefact-body__panel-chevron {
  transform: rotate(225deg);
}
.artefact-body__panel-body {
  /**
   * Flush inside the panel: zero outer padding matches the scrolled content to the panel's
   * edge on all four sides, keeping the focused card's chrome entirely on the outer box
   * (accent strip, coverage bar) rather than re-declaring it per compartment.
   */
  flex: 1 1 0;
  min-height: 0;
  padding: 0;
  font-size: clamp(0.62rem, min(1.35vmin, 2cqh), 0.8rem);
  line-height: 1.45;
  color: #475569;
  overflow: auto;
}
.artefact-body__placeholder {
  margin: 0;
}
.artefact-body__doc {
  /**
   * Preserve the author's newlines so Scaladoc paragraphs / bullet lists stay visually
   * grouped without forcing a markdown renderer in the loop. Long lines still wrap on
   * whitespace thanks to `pre-wrap`. Slightly smaller leading than the placeholder so
   * denser comments still fit the compartment without always expanding it.
   */
  margin: 0;
  padding: 0 10px 8px;
  white-space: pre-wrap;
  line-height: 1.45;
  color: #334155;
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
</style>
