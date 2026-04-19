<script setup lang="ts">
import { Position, type NodeTypesObject } from '@vue-flow/core'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import FlowProjectNode from './components/diagram/FlowProjectNode.vue'
import GroupNode from './components/GroupNode.vue'
import GraphWorkspace from './components/GraphWorkspace.vue'
import YamlDiffEditor from './components/YamlDiffEditor.vue'
import { parseIlographYaml, stringifyIlographYaml } from './ilograph/parse'
import type { IlographDocument } from './ilograph/types'
import sbtLogoUrl from './assets/language-icons/sbt.svg'
import { ilographDocumentToFlow } from './graph/ilographToFlow'
import { flowToIlographDocument } from './graph/flowToIlograph'
import { slimEdgesForExport, slimNodesForExport } from './graph/slimFlow'
import { boxColorForId } from './graph/boxColors'
import { languageIconForId } from './graph/languages'
import {
  applyHandleAnchorAlignment,
  layoutDepthInViewport,
  mergeEdgeHiddenForInvisibleEndpoints,
  routeSmoothstepEdgesInViewport,
} from './graph/layoutDependencyLayers'
import {
  relationTypeKeysSignature,
  relationTypesFromSignature,
  shouldHideEdgeForRelationFilter,
} from './graph/relationVisibility'
import { drillNoteForModuleId } from './graph/sbtStyleDrillNotes'
import { listSbtExamples, sbtExampleSourceToYaml } from './sbt/sbtExampleBuilds'
import { parseBuildSbt } from './sbt/parseBuildSbt'
const nodes = ref<any[]>([])
const edges = ref<any[]>([])
const perspectiveName = ref<string | undefined>('dependencies')
const fileName = ref('diagram.ilograph.yaml')
/** Repo-relative source path the diagram was generated from (sbt build, YAML file, …). Shown top-left on the canvas and embedded in the AI prompt for context. */
const sourcePath = ref('')

/** Project root for AI prompts (what to operate on): for sbt this is the directory containing build.sbt. */
const projectRoot = computed(() => {
  const p = sourcePath.value.trim()
  if (!p) return ''
  if (p.endsWith('/build.sbt') || p.endsWith('\\build.sbt')) {
    return p.slice(0, -'/build.sbt'.length)
  }
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i > 0 ? p.slice(0, i) : ''
})
const status = ref('')

const graphRef = ref<InstanceType<typeof GraphWorkspace> | null>(null)
const examplesMenu = ref<HTMLDetailsElement | null>(null)
/** Checked relation types are visible (`false` means hidden). Synced from current edges’ labels. */
const relationTypeVisibility = ref<Record<string, boolean>>({})

const relationTypesMenuSig = computed(() => relationTypeKeysSignature(edges.value))

watch(relationTypesMenuSig, (sig) => {
  const keys = relationTypesFromSignature(sig)
  const prev = relationTypeVisibility.value
  const next: Record<string, boolean> = {}
  for (const k of keys) {
    next[k] = prev[k] !== false
  }
  relationTypeVisibility.value = next
})

const relationTypesList = computed(() => relationTypesFromSignature(relationTypesMenuSig.value))

function mergeEdgesWithVisibility(es: any[]) {
  return mergeEdgeHiddenForInvisibleEndpoints(es, nodes.value, {
    hideEdgeForRelation: (e) => shouldHideEdgeForRelationFilter(e, relationTypeVisibility.value),
  })
}

function setRelationTypeVisible(relationKey: string, visible: boolean) {
  relationTypeVisibility.value = { ...relationTypeVisibility.value, [relationKey]: visible }
  edges.value = mergeEdgesWithVisibility(edges.value)
  void nextTick(() => graphRef.value?.refreshEdgeEmphasis?.())
}

const showYamlEditor = ref(true)

/** All bundled repo sbt-examples build.sbt files (Vite virtual module at dev or build time). */
const sbtExamplesAll = listSbtExamples()

/** Tutorial-style bundled examples: 01–12 under sbt-examples (same menu block). */
function isTutorialSbtFolder(dir: string): boolean {
  return /^0[1-9]-/.test(dir) || /^1[0-2]-/.test(dir)
}

const sbtExamplesTutorial = sbtExamplesAll.filter((e) => isTutorialSbtFolder(e.dir))
const sbtExamplesLargeOss = sbtExamplesAll.filter((e) => !isTutorialSbtFolder(e.dir))

/** __builtin__ loads public example YAML; sbt:dir parses that folder build.sbt in the repo bundle. */
const selectedExample = ref<string>('__builtin__')

const nodeTypes = {
  module: FlowProjectNode,
  group: GroupNode,
} as NodeTypesObject

function uid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(16).slice(2)}`
}

function readFlowViewport(): { width: number; height: number } {
  const el = document.querySelector('.flow-wrap')
  const r = el?.getBoundingClientRect()
  const w = r?.width ?? 0
  const h = r?.height ?? 0
  return {
    width: Math.max(200, w),
    height: Math.max(200, h),
  }
}

/** Wait for DOM + style/layout so `.flow-wrap` has its final size (e.g. after grid column change). */
function waitFrameLayout(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}

let resizeTimer: ReturnType<typeof setTimeout> | null = null
function scheduleRelayoutFromResize() {
  if (resizeTimer) clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    resizeTimer = null
    if (!nodes.value.length) return
    void (async () => {
      await waitFrameLayout()
      const vp = readFlowViewport()
      nodes.value = layoutDepthInViewport(nodes.value, edges.value, vp)
      edges.value = mergeEdgesWithVisibility(
        routeSmoothstepEdgesInViewport(nodes.value, edges.value, vp),
      )
      nodes.value = applyHandleAnchorAlignment(nodes.value, edges.value)
      await nextTick()
      graphRef.value?.refreshEdgeEmphasis?.()
      await graphRef.value?.fitToViewport()
    })()
  }, 160)
}

async function applyDoc(text: string, name: string, preferSaved: boolean) {
  const doc = parseIlographYaml(text)
  const { nodes: n, edges: e, perspectiveName: p } = ilographDocumentToFlow(doc, {
    preferSavedPositions: preferSaved,
  })
  await nextTick()
  await waitFrameLayout()
  const vp = readFlowViewport()
  const flowEdges = e.map((edge) => ({
    ...edge,
    type: edge.type ?? 'smoothstep',
  }))
  nodes.value = layoutDepthInViewport(n, flowEdges, vp)
  edges.value = mergeEdgesWithVisibility(
    routeSmoothstepEdgesInViewport(nodes.value, flowEdges, vp),
  )
  nodes.value = applyHandleAnchorAlignment(nodes.value, edges.value)
  perspectiveName.value = p ?? 'dependencies'
  fileName.value = name
  status.value = `Loaded ${n.length} modules, ${e.length} relations — depth columns, vertical fill (auto-fit).`
  await nextTick()
  graphRef.value?.refreshEdgeEmphasis?.()
  await graphRef.value?.resetView()
  await nextTick()
  yamlBaseline.value = yamlPreview.value
}

async function loadBuiltinExample() {
  const res = await fetch('/example.ilograph.yaml')
  sourcePath.value = 'editor/public/example.ilograph.yaml'
  await applyDoc(await res.text(), 'example.ilograph.yaml', true)
}

function exampleOptionLabel(dir: string): string {
  return dir.replace(/-/g, ' ')
}

async function selectExample(id: string) {
  selectedExample.value = id
  if (examplesMenu.value) examplesMenu.value.open = false
  await applyExampleSelection()
}

async function applyExampleSelection() {
  const v = selectedExample.value
  if (v === '__builtin__') {
    await loadBuiltinExample()
    return
  }
  if (!v.startsWith('sbt:')) return
  const dir = v.slice('sbt:'.length)
  const hit = sbtExamplesAll.find((e) => e.dir === dir)
  if (!hit) {
    status.value = 'No sbt example selected (or examples failed to bundle).'
    return
  }
  const yaml = sbtExampleSourceToYaml(hit.dir, hit.source)
  const projects = parseBuildSbt(hit.source)
  sourcePath.value = `sbt-examples/${hit.dir}/build.sbt`
  await applyDoc(yaml, `sbt-examples/${hit.dir}/diagram.ilograph.yaml`, false)
  status.value = `Parsed sbt \`sbt-examples/${hit.dir}/build.sbt\` → ${projects.length} project(s); loaded generated YAML.`
}

function onFilePick(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    sourcePath.value = file.name
    void applyDoc(String(reader.result), file.name, true)
    input.value = ''
  }
  reader.readAsText(file)
}

function downloadYaml() {
  const doc = flowToIlographDocument(
    slimNodesForExport(nodes.value),
    slimEdgesForExport(edges.value),
    {
      perspectiveName: perspectiveName.value,
    },
  )
  const text = stringifyIlographYaml(doc)
  const blob = new Blob([text], { type: 'text/yaml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName.value || 'diagram.ilograph.yaml'
  a.click()
  URL.revokeObjectURL(url)
  status.value = 'Exported Ilograph-compatible YAML (includes optional x-triton-editor positions).'
}

async function autoLayout() {
  await nextTick()
  await waitFrameLayout()
  const vp = readFlowViewport()
  nodes.value = layoutDepthInViewport(nodes.value, edges.value, vp)
  edges.value = mergeEdgesWithVisibility(routeSmoothstepEdgesInViewport(nodes.value, edges.value, vp))
  nodes.value = applyHandleAnchorAlignment(nodes.value, edges.value)
  status.value = 'Re-applied depth-layer layout (columns = dependency depth, vertical fill per column).'
  await nextTick()
  graphRef.value?.refreshEdgeEmphasis?.()
  await graphRef.value?.fitToViewport()
}

/**
 * Pointer “drag” from the project chip: finish on the graph pane via {@link GraphWorkspace.dropProjectTemplateAtScreen}
 * (same component path as Add module — no global bridge).
 */
function onPalettePointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  const pointerId = e.pointerId
  let finished = false
  const cleanup = () => {
    window.removeEventListener('pointerup', onPointerUp, true)
    window.removeEventListener('pointercancel', onPointerUp, true)
    document.removeEventListener('mouseup', onMouseUp, true)
  }
  const tryDrop = (clientX: number, clientY: number) => {
    if (finished) return
    finished = true
    cleanup()
    const hit = document.elementFromPoint(clientX, clientY)
    if (!(hit instanceof Element) || !hit.closest('.flow-wrap')) return
    graphRef.value?.dropProjectTemplateAtScreen(clientX, clientY)
  }
  const onPointerUp = (ev: PointerEvent) => {
    if (ev.pointerId !== pointerId) return
    tryDrop(ev.clientX, ev.clientY)
  }
  const onMouseUp = (ev: MouseEvent) => {
    if (ev.button !== 0) return
    tryDrop(ev.clientX, ev.clientY)
  }
  window.addEventListener('pointerup', onPointerUp, true)
  window.addEventListener('pointercancel', onPointerUp, true)
  document.addEventListener('mouseup', onMouseUp, true)
}

async function addRootModule() {
  const id = `module-${uid()}`
  await nextTick()
  await waitFrameLayout()
  const vp = readFlowViewport()
  nodes.value = layoutDepthInViewport(
    [
      ...nodes.value,
      {
        id,
        type: 'module',
        position: { x: 0, y: 0 },
        sourcePosition: Position.Left,
        targetPosition: Position.Right,
        data: {
          label: 'new-module',
          subtitle: 'sbt project id',
          boxColor: boxColorForId(id),
          language: languageIconForId(id),
          drillNote: drillNoteForModuleId(id),
        },
      },
    ],
    edges.value,
    vp,
  )
      edges.value = mergeEdgesWithVisibility(
        routeSmoothstepEdgesInViewport(nodes.value, edges.value, vp),
      )
      nodes.value = applyHandleAnchorAlignment(nodes.value, edges.value)
      status.value = `Added ${id} — double-click to rename.`
  await nextTick()
  graphRef.value?.refreshEdgeEmphasis?.()
  await graphRef.value?.fitToViewport()
}

const yamlPreview = ref('')
/** YAML snapshot for Monaco diff “original” pane; reset when loading a file/example; use Accept to clear highlights. */
const yamlBaseline = ref('')

function acceptYamlBaseline() {
  yamlBaseline.value = yamlPreview.value
}

/**
 * Structural diff of two Ilograph YAML documents → list of SBT-relevant changes.
 * Modules == top-level resources (matches sbtProjectsToIlographDocument output, where every
 * subproject is a flat resource). Relations live under perspectives[].relations.
 */
type SbtRelationKind = 'dependsOn' | 'aggregate' | 'other'
interface SbtRelation {
  from: string
  to: string
  label: string
  kind: SbtRelationKind
}
interface SbtDiff {
  addedModules: string[]
  removedModules: string[]
  addedRelations: SbtRelation[]
  removedRelations: SbtRelation[]
}

function relationKindFromLabel(label: string | undefined): SbtRelationKind {
  const l = (label ?? '').toLowerCase().trim()
  if (l === 'depends on' || l === 'dependson') return 'dependsOn'
  if (l === 'aggregates' || l === 'aggregate') return 'aggregate'
  return 'other'
}

function collectModuleNames(doc: { resources?: Array<{ name?: string }> } | null): string[] {
  if (!doc?.resources) return []
  return doc.resources.map((r) => (r?.name ?? '').trim()).filter(Boolean)
}

function collectRelations(
  doc: { perspectives?: Array<{ relations?: Array<{ from?: string; to?: string; label?: string }> }> } | null,
): SbtRelation[] {
  if (!doc?.perspectives) return []
  const out: SbtRelation[] = []
  for (const p of doc.perspectives) {
    for (const r of p.relations ?? []) {
      const from = (r.from ?? '').trim()
      const to = (r.to ?? '').trim()
      if (!from || !to) continue
      out.push({ from, to, label: (r.label ?? '').trim(), kind: relationKindFromLabel(r.label) })
    }
  }
  return out
}

function tryParse(text: string): IlographDocument | null {
  if (!text.trim()) return null
  try {
    return parseIlographYaml(text)
  } catch {
    return null
  }
}

function computeSbtDiff(original: string, modified: string): SbtDiff {
  const oDoc = tryParse(original)
  const mDoc = tryParse(modified)
  const oNames = new Set(collectModuleNames(oDoc))
  const mNames = new Set(collectModuleNames(mDoc))
  const oRels = collectRelations(oDoc)
  const mRels = collectRelations(mDoc)
  const relKey = (r: SbtRelation) => `${r.from}\u0001${r.to}\u0001${r.kind}`
  const oRelKeys = new Set(oRels.map(relKey))
  const mRelKeys = new Set(mRels.map(relKey))
  return {
    addedModules: [...mNames].filter((n) => !oNames.has(n)),
    removedModules: [...oNames].filter((n) => !mNames.has(n)),
    addedRelations: mRels.filter((r) => !oRelKeys.has(relKey(r))),
    removedRelations: oRels.filter((r) => !mRelKeys.has(relKey(r))),
  }
}

function descriptionForModuleName(name: string): string {
  const hit = nodes.value.find(
    (n) => n.type === 'module' && String((n.data as { label?: string })?.label ?? '') === name,
  )
  const d = (hit?.data as { description?: string } | undefined)?.description
  return typeof d === 'string' ? d.trim() : ''
}

function joinPath(base: string, child: string): string {
  if (!base) return `${child}/`
  return `${base.replace(/[/\\]+$/, '')}/${child}/`
}

function buildSbtPrompt(diff: SbtDiff): string {
  const lines: string[] = []
  const root = projectRoot.value
  const src = sourcePath.value

  if (src || root) {
    lines.push('Context:')
    if (src) lines.push(`- Source file: \`${src}\``)
    if (root) lines.push(`- Project root: \`${root}/\``)
    lines.push('')
  }

  lines.push('You are editing an sbt multi-module Scala project.')
  lines.push(
    root
      ? `Apply the following changes to \`${root}/build.sbt\` (and the project layout on disk under \`${root}/\`).`
      : 'Apply the following changes to `build.sbt` (and the project layout on disk).',
  )
  lines.push('Preserve existing settings such as `ThisBuild / scalaVersion`, organization, plugins, library dependencies, and any other modules/relations not mentioned below.')
  lines.push('')

  if (diff.addedModules.length) {
    lines.push(`Add ${diff.addedModules.length} new sbt subproject${diff.addedModules.length === 1 ? '' : 's'}:`)
    for (const name of diff.addedModules) {
      const incomingDeps = diff.addedRelations
        .filter((r) => r.kind === 'dependsOn' && r.from === name)
        .map((r) => r.to)
      const aggregatedBy = diff.addedRelations
        .filter((r) => r.kind === 'aggregate' && r.to === name)
        .map((r) => r.from)
      const dep = incomingDeps.length ? ` (depends on ${incomingDeps.map((d) => `\`${d}\``).join(', ')})` : ''
      const agg = aggregatedBy.length ? ` (aggregated by ${aggregatedBy.map((a) => `\`${a}\``).join(', ')})` : ''
      lines.push(`- \`${name}\` in directory \`${joinPath(root, name)}\`${dep}${agg}`)
      const desc = descriptionForModuleName(name)
      if (desc) {
        for (const dl of desc.split('\n')) lines.push(`    Purpose: ${dl}`)
      }
    }
    lines.push('')
    lines.push('For each new subproject `X`:')
    lines.push(
      root
        ? `1. Create directory \`${root}/X/src/main/scala/\` (and \`${root}/X/src/test/scala/\` if you also add tests).`
        : '1. Create directory `X/src/main/scala/` (and `X/src/test/scala/` if you also add tests).',
    )
    lines.push(
      root
        ? `2. Add a \`lazy val\` to \`${root}/build.sbt\`, for example:`
        : '2. Add a `lazy val` to `build.sbt`, for example:',
    )
    lines.push('   ```scala')
    lines.push('   lazy val X = (project in file("X"))')
    lines.push('     .settings(name := "X")')
    lines.push('   ```')
    lines.push('3. Append `.dependsOn(...)` for any modules X depends on (see relations below).')
    lines.push('4. If a root/aggregator project aggregates X, add `X` to its `.aggregate(...)` call.')
    lines.push('5. Implement the module so it fulfils the **Purpose** described above (if any).')
    lines.push('')
  }

  if (diff.removedModules.length) {
    lines.push(`Remove ${diff.removedModules.length} sbt subproject${diff.removedModules.length === 1 ? '' : 's'}:`)
    for (const name of diff.removedModules) lines.push(`- \`${name}\` (delete its \`lazy val\` block in \`build.sbt\` and its source directory)`)
    lines.push('')
    lines.push('Also remove these names from any `.dependsOn(...)` and `.aggregate(...)` calls in `build.sbt`.')
    lines.push('')
  }

  const dependsAdded = diff.addedRelations.filter(
    (r) => r.kind === 'dependsOn' && !diff.addedModules.includes(r.from),
  )
  if (dependsAdded.length) {
    lines.push('Add `dependsOn` relations to existing modules:')
    for (const r of dependsAdded) lines.push(`- In \`${r.from}\`, append \`.dependsOn(${r.to})\`.`)
    lines.push('')
  }

  const dependsRemoved = diff.removedRelations.filter(
    (r) => r.kind === 'dependsOn' && !diff.removedModules.includes(r.from),
  )
  if (dependsRemoved.length) {
    lines.push('Remove `dependsOn` relations:')
    for (const r of dependsRemoved) lines.push(`- In \`${r.from}\`, drop \`${r.to}\` from its \`.dependsOn(...)\`.`)
    lines.push('')
  }

  const aggregateAdded = diff.addedRelations.filter(
    (r) => r.kind === 'aggregate' && !diff.addedModules.includes(r.from),
  )
  if (aggregateAdded.length) {
    lines.push('Add `aggregate` relations:')
    for (const r of aggregateAdded) lines.push(`- In \`${r.from}\`, add \`${r.to}\` to its \`.aggregate(...)\`.`)
    lines.push('')
  }

  const aggregateRemoved = diff.removedRelations.filter(
    (r) => r.kind === 'aggregate' && !diff.removedModules.includes(r.from),
  )
  if (aggregateRemoved.length) {
    lines.push('Remove `aggregate` relations:')
    for (const r of aggregateRemoved) lines.push(`- In \`${r.from}\`, drop \`${r.to}\` from its \`.aggregate(...)\`.`)
    lines.push('')
  }

  lines.push(
    root
      ? `After editing, run \`sbt projects\` and \`sbt compile\` from \`${root}/\` to verify the build still loads and all listed modules are present with the correct dependencies.`
      : 'After editing, verify with `sbt projects` and `sbt compile` that the build still loads and all listed modules are present with the correct dependencies.',
  )
  return lines.join('\n')
}

const editPrompt = computed(() => {
  const diff = computeSbtDiff(yamlBaseline.value, yamlPreview.value)
  const empty =
    !diff.addedModules.length &&
    !diff.removedModules.length &&
    !diff.addedRelations.length &&
    !diff.removedRelations.length
  if (empty) {
    return 'No structural changes since the accepted baseline. Add or remove a module, or draw/delete a dependency edge to generate an sbt edit prompt here.'
  }
  return buildSbtPrompt(diff)
})

const promptCopyHint = ref('')
async function copyEditPrompt() {
  try {
    await navigator.clipboard.writeText(editPrompt.value)
    promptCopyHint.value = 'Copied to clipboard.'
  } catch {
    promptCopyHint.value = 'Copy failed — select the text and copy manually.'
  }
  window.setTimeout(() => {
    promptCopyHint.value = ''
  }, 2000)
}

watch(
  [nodes, edges, perspectiveName],
  () => {
    try {
      const doc = flowToIlographDocument(
        slimNodesForExport(nodes.value),
        slimEdgesForExport(edges.value),
        {
          perspectiveName: perspectiveName.value,
        },
      )
      yamlPreview.value = stringifyIlographYaml(doc)
    } catch {
      yamlPreview.value = ''
    }
  },
  { deep: true, immediate: true },
)

watch(showYamlEditor, () => {
  if (!nodes.value.length) return
  void autoLayout()
})

onMounted(() => {
  window.addEventListener('resize', scheduleRelayoutFromResize)
  void selectExample('__builtin__')
})

onUnmounted(() => {
  window.removeEventListener('resize', scheduleRelayoutFromResize)
  if (resizeTimer) clearTimeout(resizeTimer)
})
</script>

<template>
  <div class="shell">
    <header class="toolbar">
      <div class="brand">TritonGraph</div>
      <details ref="examplesMenu" class="examples-menu">
        <summary class="btn menu-summary">Examples</summary>
        <div class="menu-panel" role="menu" aria-label="Example diagrams">
          <button
            type="button"
            class="menu-item"
            role="menuitem"
            :class="{ 'menu-item--active': selectedExample === '__builtin__' }"
            @click="selectExample('__builtin__')"
          >
            Ilograph demo (five layers)
          </button>
          <template v-if="sbtExamplesTutorial.length">
            <div class="menu-sep" role="separator" />
            <div class="menu-heading" role="presentation">Bundled sbt (tutorial)</div>
            <button
              v-for="e in sbtExamplesTutorial"
              :key="e.dir"
              type="button"
              class="menu-item"
              role="menuitem"
              :class="{ 'menu-item--active': selectedExample === 'sbt:' + e.dir }"
              :title="e.dir"
              @click="selectExample('sbt:' + e.dir)"
            >
              {{ exampleOptionLabel(e.dir) }}
            </button>
          </template>
          <template v-if="sbtExamplesLargeOss.length">
            <div class="menu-sep" role="separator" />
            <div class="menu-heading" role="presentation">Bundled sbt (large OSS)</div>
            <button
              v-for="e in sbtExamplesLargeOss"
              :key="e.dir"
              type="button"
              class="menu-item"
              role="menuitem"
              :class="{ 'menu-item--active': selectedExample === 'sbt:' + e.dir }"
              :title="e.dir"
              @click="selectExample('sbt:' + e.dir)"
            >
              {{ exampleOptionLabel(e.dir) }}
            </button>
          </template>
        </div>
      </details>
      <details class="examples-menu relations-menu">
        <summary class="btn menu-summary">Relations</summary>
        <div class="menu-panel" role="menu" aria-label="Relation types visible in the diagram">
          <template v-if="relationTypesList.length">
            <label
              v-for="rel in relationTypesList"
              :key="rel"
              class="menu-check"
            >
              <input
                type="checkbox"
                :checked="relationTypeVisibility[rel] !== false"
                @change="
                  setRelationTypeVisible(rel, ($event.target as HTMLInputElement).checked)
                "
              />
              <span class="menu-check__text">{{ rel }}</span>
            </label>
          </template>
          <div v-else class="menu-empty">No relations in this diagram.</div>
        </div>
      </details>
      <label class="btn file">
        Open YAML
        <input type="file" accept=".yaml,.yml,text/yaml" hidden @change="onFilePick" />
      </label>
      <button type="button" class="btn" @click="downloadYaml">Download YAML</button>
      <button type="button" class="btn" @click="showYamlEditor = !showYamlEditor">
        {{ showYamlEditor ? 'Hide YAML' : 'Show YAML' }}
      </button>
      <button type="button" class="btn primary" @click="addRootModule">Add module</button>
      <div
        class="tg-drag-project"
        title="Drag onto the diagram canvas to add a project box"
        role="button"
        tabindex="0"
        aria-label="Project template: drag onto canvas"
        @pointerdown="onPalettePointerDown"
      >
        <span class="tg-drag-project__label">Project</span>
        <span class="tg-drag-project__hint">→ canvas</span>
      </div>
      <span class="status">{{ status }}</span>
    </header>

    <div class="main" :class="{ 'main--no-side': !showYamlEditor }">
      <div class="flow-wrap">
        <div v-if="sourcePath" class="source-path-overlay" :title="sourcePath">
          <img class="source-path-overlay__logo" :src="sbtLogoUrl" alt="sbt" aria-hidden="true" />
          <span class="source-path-overlay__text">{{ sourcePath }}</span>
        </div>
        <GraphWorkspace
          ref="graphRef"
          v-model:nodes="nodes"
          v-model:edges="edges"
          :node-types="nodeTypes"
          :relation-type-visibility="relationTypeVisibility"
          @status="(s) => (status = s)"
        />
      </div>
      <aside v-if="showYamlEditor" class="side">
        <div class="side-yaml-bar">
          <span class="side-yaml-bar__hint">
            Monaco diff: additions vs baseline (green). Load file/example resets baseline.
          </span>
          <button type="button" class="btn side-yaml-bar__btn" @click="acceptYamlBaseline">Accept baseline</button>
        </div>
        <YamlDiffEditor class="yaml-diff" :original="yamlBaseline" :modified="yamlPreview" />
        <div class="prompt-section">
          <div class="prompt-bar">
            <span class="prompt-bar__hint">
              Generated edit prompt — paste into an AI assistant to apply the same change to the YAML source.
            </span>
            <button type="button" class="btn prompt-bar__btn" @click="copyEditPrompt">Copy prompt</button>
            <span v-if="promptCopyHint" class="prompt-bar__copied">{{ promptCopyHint }}</span>
          </div>
          <textarea
            class="prompt-textarea"
            readonly
            spellcheck="false"
            :value="editPrompt"
            aria-label="Generated AI prompt describing the YAML diff"
          />
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.shell {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f8fafc;
  color: #0f172a;
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #e2e8f0;
  background: #fff;
}
.brand {
  font-weight: 700;
  margin-right: 8px;
  font-family: ui-sans-serif, system-ui, sans-serif;
}
.btn {
  border: 1px solid #cbd5e1;
  background: #fff;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 13px;
  cursor: pointer;
}
.btn:hover {
  background: #f1f5f9;
}
.btn.primary {
  border-color: #2563eb;
  background: #2563eb;
  color: #fff;
}
.btn.primary:hover {
  background: #1d4ed8;
}
.btn.file {
  display: inline-block;
}
.status {
  margin-left: auto;
  font-size: 12px;
  color: #64748b;
}

.tg-drag-project {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  min-width: 88px;
  padding: 6px 10px;
  border: 1px dashed #64748b;
  border-radius: 8px;
  background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
  cursor: grab;
  user-select: none;
  font-size: 11px;
  line-height: 1.2;
  color: #334155;
}
.tg-drag-project:active {
  cursor: grabbing;
}
.tg-drag-project__label {
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.02em;
}
.tg-drag-project__hint {
  font-size: 10px;
  color: #64748b;
}
.examples-menu {
  position: relative;
}
.examples-menu .menu-summary {
  list-style: none;
  user-select: none;
}
.examples-menu .menu-summary::-webkit-details-marker {
  display: none;
}
.menu-panel {
  position: absolute;
  z-index: 50;
  margin-top: 4px;
  min-width: min(100vw - 32px, 360px);
  max-height: min(70vh, 520px);
  overflow: auto;
  padding: 4px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #fff;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12);
}
.menu-sep {
  height: 1px;
  margin: 4px 6px;
  background: #e2e8f0;
}
.menu-heading {
  padding: 6px 10px 4px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: #64748b;
}
.menu-item {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
  color: #0f172a;
  background: transparent;
  cursor: pointer;
}
.menu-item:hover {
  background: #f1f5f9;
}
.menu-item--active {
  background: #eff6ff;
  font-weight: 600;
}
.menu-item:focus-visible {
  outline: 2px solid #93c5fd;
  outline-offset: 1px;
}
.menu-check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
  color: #0f172a;
  cursor: pointer;
  user-select: none;
}
.menu-check:hover {
  background: #f1f5f9;
}
.menu-check input {
  margin-top: 2px;
  flex-shrink: 0;
  cursor: pointer;
}
.menu-check__text {
  flex: 1;
  line-height: 1.35;
}
.menu-empty {
  padding: 10px 12px;
  font-size: 13px;
  color: #64748b;
}
.main {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr minmax(280px, 420px);
  grid-template-rows: minmax(0, 1fr);
}
.main.main--no-side {
  grid-template-columns: 1fr;
}
.flow-wrap {
  min-height: 0;
  min-width: 0;
  height: 100%;
  position: relative;
}
.source-path-overlay {
  position: absolute;
  top: 8px;
  left: 12px;
  z-index: 10;
  pointer-events: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: #475569;
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 4px;
  padding: 3px 8px 3px 6px;
  max-width: calc(100% - 24px);
  user-select: text;
}
.source-path-overlay__logo {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  display: block;
  object-fit: contain;
}
.source-path-overlay__text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.side {
  border-left: 1px solid #e2e8f0;
  background: #fff;
  padding: 12px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.side-yaml-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.side-yaml-bar__hint {
  font-size: 11px;
  color: #64748b;
  line-height: 1.35;
  flex: 1;
  min-width: 140px;
}
.side-yaml-bar__btn {
  flex-shrink: 0;
  font-size: 12px;
  padding: 5px 10px;
}
.yaml-diff {
  flex: 1;
  min-height: 0;
  min-width: 0;
}
.prompt-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 0 0 auto;
}
.prompt-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.prompt-bar__hint {
  font-size: 11px;
  color: #64748b;
  line-height: 1.35;
  flex: 1;
  min-width: 140px;
}
.prompt-bar__btn {
  flex-shrink: 0;
  font-size: 12px;
  padding: 5px 10px;
}
.prompt-bar__copied {
  font-size: 11px;
  color: #15803d;
}
.prompt-textarea {
  width: 100%;
  height: 200px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.45;
  padding: 8px 10px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #f8fafc;
  color: #0f172a;
  white-space: pre;
  overflow: auto;
  box-sizing: border-box;
}
.prompt-textarea:focus {
  outline: 2px solid #93c5fd;
  outline-offset: 0;
  border-color: #60a5fa;
}
</style>

<style>
html,
body {
  margin: 0;
  height: 100%;
}
#app {
  height: 100%;
}
</style>
