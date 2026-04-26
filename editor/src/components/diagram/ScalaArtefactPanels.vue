<script setup lang="ts">
import { computed, inject, ref, watch, type Ref } from 'vue'
import { openInEditor } from '../../openInEditor'
import { useScalaDoc, useScalaSpecs, useScalaTestBlock } from '../../store/useOverlay'
import ShikiCodeBlock from '../ShikiCodeBlock.vue'
import TestChecklistBlock from '../TestChecklistBlock.vue'

const props = defineProps<{
  boxId: string
  constructorParams?: string
  methodSignatures?: ReadonlyArray<{ signature: string; startRow: number }>
}>()

const emit = defineEmits<{
  'open-in-editor': [line?: number]
}>()

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

const methodSignaturesText = computed(() => {
  const sigs = props.methodSignatures
  if (!Array.isArray(sigs)) return ''
  return sigs.map((s) => s.signature).join('\n')
})

function splitConstructorArgs(raw: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < raw.length) {
    if (raw[i] !== '(') {
      i++
      continue
    }
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

const argumentsSnippet = computed(() => {
  const raw = (props.constructorParams ?? '').trim()
  if (!raw) return ''
  const parts = splitConstructorArgs(raw)
  if (!parts.length) return ''
  return parts.join(',\n')
})

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
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((x) => ({
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

const defaultPanelGrow = computed(() => {
  const docLines = lineCount(String(scalaDocRef.value ?? ''))
  const argsLines = lineCount(argumentsSnippet.value)
  const methodsLines = lineCount(methodSignaturesText.value)
  const specLines = lineCount(specsText.value)
  const checklistLines = lineCount(String(testBlockRef.value?.block ?? ''))
  const cap = (n: number, max: number) => Math.max(0, Math.min(max, n))
  const min = { doc: 0.9, arguments: 1.0, methods: 1.0, coverage: 0.9, checklist: 1.0, issues: 0.8 }
  const score = {
    doc: cap(docLines, 10),
    arguments: cap(argsLines, 14),
    methods: cap(methodsLines, 16),
    coverage: cap(specLines, 10),
    checklist: cap(checklistLines, 18),
    issues: 0,
  }
  const prio = { doc: 1.12, arguments: 1.1, methods: 1.06, coverage: 1.02, checklist: 1.0, issues: 0.95 }
  const totalScore =
    score.doc + score.arguments + score.methods + score.coverage + score.checklist + score.issues
  if (totalScore <= 6) return { doc: 1, arguments: 1, methods: 1, coverage: 1, checklist: 1, issues: 1 }
  return {
    doc: (min.doc + score.doc * 0.14) * prio.doc,
    arguments: (min.arguments + score.arguments * 0.12) * prio.arguments,
    methods: (min.methods + score.methods * 0.11) * prio.methods,
    coverage: (min.coverage + score.coverage * 0.12) * prio.coverage,
    checklist: (min.checklist + score.checklist * 0.1) * prio.checklist,
    issues: min.issues * prio.issues,
  }
})

function panelGrowFor(id: PanelId): number {
  if (expandedPanel.value) return 1
  return defaultPanelGrow.value[id] ?? 1
}

function onMethodLineClick(ev: { index: number }): void {
  const sigs = props.methodSignatures ?? []
  const entry = sigs[ev.index]
  if (entry && Number.isFinite(entry.startRow)) {
    emit('open-in-editor', entry.startRow)
    return
  }
  emit('open-in-editor')
}

function onArgumentsLineClick(): void {
  emit('open-in-editor')
}

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
</script>

<template>
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
          <p v-if="scalaDocRef" class="artefact-body__doc">{{ scalaDocRef }}</p>
          <p v-else class="artefact-body__placeholder artefact-body__placeholder--small">
            No Scaladoc comment precedes this declaration.
          </p>
        </template>
        <template v-else-if="panel.id === 'arguments'">
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
            Placeholder: issue keys, severities, and messages from static analysis for this file or symbol
            would list here after integration.
          </p>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.artefact-body {
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
  border: 0;
  border-top: 1px solid rgb(148 163 184 / 0.45);
  border-radius: 0;
  background: transparent;
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1 1 0;
  overflow: hidden;
  transition: flex-grow 220ms ease;
}

.artefact-body__panel:first-child {
  border-top: 0;
}

.artefact-body__panel--expanded {
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
</style>
