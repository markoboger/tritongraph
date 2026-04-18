<script setup lang="ts">
import { Position, type NodeTypesObject } from '@vue-flow/core'
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import FlowProjectNode from './components/diagram/FlowProjectNode.vue'
import GroupNode from './components/GroupNode.vue'
import GraphWorkspace from './components/GraphWorkspace.vue'
import { parseIlographYaml, stringifyIlographYaml } from './ilograph/parse'
import { ilographDocumentToFlow } from './graph/ilographToFlow'
import { flowToIlographDocument } from './graph/flowToIlograph'
import { slimEdgesForExport, slimNodesForExport } from './graph/slimFlow'
import { boxColorForId } from './graph/boxColors'
import { languageIconForId } from './graph/languages'
import {
  annotateCrossLayerEdgePathOptions,
  layoutDepthInViewport,
  mergeEdgeHiddenForInvisibleEndpoints,
} from './graph/layoutDependencyLayers'
import { drillNoteForModuleId } from './graph/sbtStyleDrillNotes'
import { listSbtExamples, sbtExampleSourceToYaml } from './sbt/sbtExampleBuilds'
import { parseBuildSbt } from './sbt/parseBuildSbt'

const nodes = ref<any[]>([])
const edges = ref<any[]>([])
const perspectiveName = ref<string | undefined>('dependencies')
const fileName = ref('diagram.ilograph.yaml')
const status = ref('')

const graphRef = ref<InstanceType<typeof GraphWorkspace> | null>(null)
const examplesMenu = ref<HTMLDetailsElement | null>(null)

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
      edges.value = mergeEdgeHiddenForInvisibleEndpoints(
        annotateCrossLayerEdgePathOptions(nodes.value, edges.value, vp),
        nodes.value,
      )
      await nextTick()
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
  edges.value = mergeEdgeHiddenForInvisibleEndpoints(
    annotateCrossLayerEdgePathOptions(nodes.value, flowEdges, vp),
    nodes.value,
  )
  perspectiveName.value = p ?? 'dependencies'
  fileName.value = name
  status.value = `Loaded ${n.length} modules, ${e.length} relations — depth columns, vertical fill (auto-fit).`
  await nextTick()
  await graphRef.value?.resetView()
}

async function loadBuiltinExample() {
  const res = await fetch('/example.ilograph.yaml')
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
  await applyDoc(yaml, `sbt-examples/${hit.dir}/diagram.ilograph.yaml`, false)
  status.value = `Parsed sbt \`sbt-examples/${hit.dir}/build.sbt\` → ${projects.length} project(s); loaded generated YAML.`
}

function onFilePick(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
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
  edges.value = mergeEdgeHiddenForInvisibleEndpoints(
    annotateCrossLayerEdgePathOptions(nodes.value, edges.value, vp),
    nodes.value,
  )
  status.value = 'Re-applied depth-layer layout (columns = dependency depth, vertical fill per column).'
  await nextTick()
  await graphRef.value?.fitToViewport()
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
  edges.value = mergeEdgeHiddenForInvisibleEndpoints(
    annotateCrossLayerEdgePathOptions(nodes.value, edges.value, vp),
    nodes.value,
  )
  status.value = `Added ${id} — double-click to rename.`
  await nextTick()
  await graphRef.value?.fitToViewport()
}

const yamlPreview = ref('')

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
      <label class="btn file">
        Open YAML
        <input type="file" accept=".yaml,.yml,text/yaml" hidden @change="onFilePick" />
      </label>
      <button type="button" class="btn" @click="downloadYaml">Download YAML</button>
      <button type="button" class="btn" @click="showYamlEditor = !showYamlEditor">
        {{ showYamlEditor ? 'Hide YAML' : 'Show YAML' }}
      </button>
      <button type="button" class="btn primary" @click="addRootModule">Add module</button>
      <span class="status">{{ status }}</span>
    </header>

    <div class="main" :class="{ 'main--no-side': !showYamlEditor }">
      <div class="flow-wrap">
        <GraphWorkspace ref="graphRef" v-model:nodes="nodes" v-model:edges="edges" :node-types="nodeTypes" />
      </div>
      <aside v-if="showYamlEditor" class="side">
        <pre class="yaml">{{ yamlPreview }}</pre>
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
.side {
  border-left: 1px solid #e2e8f0;
  background: #fff;
  padding: 12px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}
.yaml {
  flex: 1;
  margin: 0;
  min-height: 0;
  overflow: auto;
  font-size: 11px;
  line-height: 1.35;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid #e2e8f0;
  background: #0b1020;
  color: #e2e8f0;
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
