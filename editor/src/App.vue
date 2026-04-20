<script setup lang="ts">
import { Position, type NodeTypesObject } from '@vue-flow/core'
import { computed, nextTick, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import FlowProjectNode from './components/diagram/FlowProjectNode.vue'
import FlowPackageNode from './components/diagram/FlowPackageNode.vue'
import GroupNode from './components/GroupNode.vue'
import GraphWorkspace from './components/GraphWorkspace.vue'
import YamlDiffEditor from './components/YamlDiffEditor.vue'
import { parseIlographYaml, stringifyIlographYaml } from './ilograph/parse'
import type { IlographDocument } from './ilograph/types'
import sbtLogoUrl from './assets/language-icons/sbt.svg'
import cubeIconUrl from './assets/language-icons/cube.svg'
import folderIconUrl from './assets/language-icons/folder.svg'
import { ilographDocumentToFlow } from './graph/ilographToFlow'
import { flowToIlographDocument } from './graph/flowToIlograph'
import { slimEdgesForExport, slimNodesForExport } from './graph/slimFlow'
import { boxColorForId } from './graph/boxColors'
import { isLeafBoxNode } from './graph/nodeKinds'
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
import { getSbtTestLogFor } from './sbt/sbtTestLogLoader'
import { parseSbtTestLog } from './sbt/parseSbtTestLog'
import { getScoverageReportFor } from './sbt/scoverageReportLoader'
import { parseScoverageXml } from './sbt/parseScoverageXml'
import { listScalaSourcesIn } from './scala/scalaSourceLoader'
import {
  buildScalaPackageGraph,
  collectScalaArtefactDocs,
  scalaPackageGraphToIlographDocument,
} from './scala/scalaPackagesToIlograph'
import {
  clearScalaDocsForWorkspace,
  clearScalaCoverageForWorkspace,
  clearScalaTestBlocksForWorkspace,
  clearScalaSpecsForWorkspace,
  getInnerArtefactOverlays,
  getNodeOverlay,
  importLegacyEditorOverlay,
  setScalaCoverage,
  setScalaDoc,
  setScalaSpecs,
  setScalaTestBlock,
  whenOverlayStoreReady,
} from './store/overlayStore'
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

const showYamlEditor = ref(false)

/** Which sub-panel is visible in the right column (YAML diff, AI prompt, or canvas templates). */
const sidePanelTab = ref<'yaml' | 'prompt' | 'templates'>('yaml')

/** All bundled examples (`build.sbt` files) across every registered examples-root. */
const sbtExamplesAll = listSbtExamples()

/** Tutorial-style bundled examples: 01–12 numbered prefixes (the `sbt-examples` tutorial set). */
function isTutorialSbtFolder(dir: string): boolean {
  return /^0[1-9]-/.test(dir) || /^1[0-2]-/.test(dir)
}

/** Stable id for the dropdown option that targets one bundled `build.sbt`. */
function exampleSelectionId(root: string, dir: string): string {
  return `sbt:${root}/${dir}`
}

const sbtExamplesTutorial = sbtExamplesAll.filter(
  (e) => e.root === 'sbt-examples' && isTutorialSbtFolder(e.dir),
)
const sbtExamplesLargeOss = sbtExamplesAll.filter(
  (e) => e.root === 'sbt-examples' && !isTutorialSbtFolder(e.dir),
)
const scalaExamples = sbtExamplesAll.filter((e) => e.root === 'scala-examples')

/**
 * One opened diagram = one entry here. The active tab's payload is held in the top-level
 * `nodes` / `edges` / `sourcePath` / `yamlBaseline` / … refs (so all existing logic and the
 * GraphWorkspace v-model continue to work unchanged); on switch we snapshot the outgoing tab and
 * restore the incoming one.
 *
 * `key` is a stable identity used to dedupe re-opens (e.g. clicking the same example twice
 * activates the existing tab instead of opening a second one). Format:
 *   - `builtin`                          — the bundled Ilograph YAML demo
 *   - `sbt:<root>/<dir>`                 — sbt build view of `<root>/<dir>/build.sbt`
 *   - `packages:<root>/<dir>`            — Scala package graph for the same `(root, dir)` example
 *   - `file:<name>#<uuid>`               — local YAML upload (always fresh, never deduped)
 *
 * `root` and `dir` are split on `/` so a single example can be opened in both an sbt tab and a
 * package tab simultaneously (different `key`, different snapshots).
 */
interface DiagramTab {
  id: string
  key: string
  title: string
  iconUrl?: string
  /** Tooltip on the tab + value used by the source-path overlay when this tab is active. */
  sourcePath: string
  fileName: string
  perspectiveName: string | undefined
  yamlBaseline: string
  nodes: any[]
  edges: any[]
}

const tabs = ref<DiagramTab[]>([])
const activeTabId = ref<string | null>(null)

const activeTab = computed<DiagramTab | undefined>(() =>
  tabs.value.find((t) => t.id === activeTabId.value),
)

/**
 * Workspace key drives every overlay-store row id. Mirrors the active tab's `key` (so
 * `"sbt:scala-examples/animal-fruit"` and `"packages:scala-examples/animal-fruit"` keep
 * their own user state even though they're the same example). Empty string when no tab
 * is active — overlay reads/writes are no-ops in that case.
 *
 * Provided downward so leaf node components (`FlowProjectNode`, `FlowPackageNode`, …) can
 * persist user edits without prop-drilling the key through every layer.
 */
const activeWorkspaceKey = computed<string>(() => activeTab.value?.key ?? '')
provide('tritonWorkspaceKey', activeWorkspaceKey)

/**
 * Which dropdown row should look "active". The packages view of an example highlights the same
 * sbt menu entry — a packages tab is conceptually a sub-view of that example, not its own pick.
 */
const activeExampleSelectionKey = computed<string>(() => {
  const k = activeTab.value?.key ?? ''
  if (k === 'builtin') return '__builtin__'
  if (k.startsWith('sbt:')) return k
  if (k.startsWith('packages:')) return `sbt:${k.slice('packages:'.length)}`
  return ''
})

/** `(root, dir)` of the example backing the active tab; `null` for builtin / file uploads. */
const activeExample = computed<{ root: string; dir: string } | null>(() => {
  const k = activeTab.value?.key ?? ''
  let body = ''
  if (k.startsWith('sbt:')) body = k.slice('sbt:'.length)
  else if (k.startsWith('packages:')) body = k.slice('packages:'.length)
  else return null
  const slash = body.indexOf('/')
  if (slash < 0) return null
  return { root: body.slice(0, slash), dir: body.slice(slash + 1) }
})

/**
 * Downstream consumers (e.g. the open-in-editor click handler on Scala artefact boxes) need
 * the active tab's `(root, exampleDir)` pair so they can combine it with a node's stored
 * `sourceFile` relPath to build an absolute disk path. Provided reactively so tab switches
 * (packages tab → sbt tab → packages tab) are picked up without component re-creation.
 */
provide('tritonActiveExample', activeExample)

const nodeTypes = {
  module: FlowProjectNode,
  package: FlowPackageNode,
  artefact: FlowPackageNode,
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

/**
 * Merge the active workspace's overlay rows onto a freshly built node list. Mutates the
 * supplied nodes in place: each node gets a `data.scannerDescription` (snapshot of the
 * scanner-emitted `description` so YAML round-trip never confuses scanner text with a
 * user note), and any of `boxColor` / `pinned` / `notes` / position / inner-artefact
 * pinned-and-color maps that the overlay store carries are stamped on top of the
 * scanner defaults.
 *
 * Skipped when no workspace is active (boot path: tab not yet selected).
 */
function applyOverlayToFlowNodes(nodeList: any[]): void {
  const ws = activeWorkspaceKey.value
  for (const node of nodeList) {
    const data = (node.data ??= {})
    if (typeof data.description === 'string' && data.scannerDescription === undefined) {
      data.scannerDescription = data.description
    }
    if (!ws) continue
    const ov = getNodeOverlay(ws, String(node.id))
    if (ov.color) data.boxColor = ov.color
    if (ov.pinned === true) data.pinned = true
    if (typeof ov.notes === 'string' && ov.notes) data.notes = ov.notes
    if (typeof ov.posX === 'number' && typeof ov.posY === 'number') {
      node.position = { x: ov.posX, y: ov.posY }
    }
    /** Inner-artefact maps are merged whole because `PackageBox.vue` consumes the full map. */
    const inner = getInnerArtefactOverlays(ws, String(node.id))
    if (Object.keys(inner.pinned).length) data.innerArtefactPinned = inner.pinned
    if (Object.keys(inner.colors).length) data.innerArtefactColors = inner.colors
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

async function applyDoc(
  text: string,
  name: string,
  preferSaved: boolean,
  options: { moduleNodeType?: 'module' | 'package' } = {},
) {
  await whenOverlayStoreReady()
  const doc = parseIlographYaml(text)
  /**
   * One-time migration of any legacy `x-triton-editor` block (positions, moduleColors,
   * pinnedModuleIds) into the overlay store. We keep parsing the block so existing YAML
   * files don't lose user state; we just stop emitting it on save (see
   * `flowToIlograph.ts`). `import` is a no-op for ids that already have stronger overlay
   * state, so re-loading the same YAML many times never clobbers fresh edits.
   */
  const legacy = doc['x-triton-editor']
  if (legacy && activeWorkspaceKey.value) {
    importLegacyEditorOverlay(activeWorkspaceKey.value, legacy)
  }
  const { nodes: n, edges: e, perspectiveName: p } = ilographDocumentToFlow(doc, {
    preferSavedPositions: preferSaved,
    moduleNodeType: options.moduleNodeType ?? 'module',
  })
  applyOverlayToFlowNodes(n)
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
  if (examplesMenu.value) examplesMenu.value.open = false
  if (id === '__builtin__') {
    await openBuiltinTab()
    return
  }
  if (id.startsWith('sbt:')) {
    /** Body shape: `<root>/<dir>` (see `exampleSelectionId`). */
    const body = id.slice('sbt:'.length)
    const slash = body.indexOf('/')
    if (slash < 0) return
    await openSbtExampleTab(body.slice(0, slash), body.slice(slash + 1))
  }
}

/* ------------------------------------------------------------------------------------------------
 * Tab management
 *
 * Active tab's payload lives in the top-level refs (`nodes`, `edges`, …) so the GraphWorkspace
 * v-model and every existing helper continue to work unchanged. On switch-away we snapshot the
 * refs into the outgoing tab; on switch-to we restore the saved snapshot. Loaders just write to
 * the refs as before — `openOrActivateTab` activates the tab first, then snapshots after the load
 * resolves.
 * ---------------------------------------------------------------------------------------------- */

function snapshotActiveTab(): void {
  const t = activeTab.value
  if (!t) return
  t.nodes = nodes.value
  t.edges = edges.value
  t.perspectiveName = perspectiveName.value
  t.sourcePath = sourcePath.value
  t.fileName = fileName.value
  t.yamlBaseline = yamlBaseline.value
}

async function activateTabById(id: string): Promise<void> {
  if (activeTabId.value === id) return
  snapshotActiveTab()
  const target = tabs.value.find((t) => t.id === id)
  if (!target) return
  activeTabId.value = id
  /** Assign whole arrays so Vue Flow re-syncs from the saved snapshot (object identities differ
   *  per tab, which is fine — it gives a clean rebuild rather than mixing previous-tab state). */
  nodes.value = target.nodes
  edges.value = target.edges
  perspectiveName.value = target.perspectiveName ?? 'dependencies'
  sourcePath.value = target.sourcePath
  fileName.value = target.fileName
  yamlBaseline.value = target.yamlBaseline
  await nextTick()
  graphRef.value?.refreshEdgeEmphasis?.()
  await graphRef.value?.fitToViewport()
}

async function closeTab(id: string): Promise<void> {
  const idx = tabs.value.findIndex((t) => t.id === id)
  if (idx < 0) return
  const wasActive = activeTabId.value === id
  tabs.value = tabs.value.filter((t) => t.id !== id)
  if (!wasActive) return
  if (!tabs.value.length) {
    activeTabId.value = null
    nodes.value = []
    edges.value = []
    perspectiveName.value = 'dependencies'
    sourcePath.value = ''
    fileName.value = 'diagram.ilograph.yaml'
    yamlBaseline.value = ''
    status.value = 'No diagram open. Pick an example or open a YAML file.'
    return
  }
  /** Activate the neighbor that "took the closed tab's slot" (next to the right; or the new last). */
  const next = tabs.value[Math.min(idx, tabs.value.length - 1)]
  await activateTabById(next.id)
}

async function openOrActivateTab(
  spec: { key: string; title: string; iconUrl?: string },
  loader: () => Promise<void>,
): Promise<void> {
  const existing = tabs.value.find((t) => t.key === spec.key)
  if (existing) {
    await activateTabById(existing.id)
    return
  }
  snapshotActiveTab()
  const tab: DiagramTab = {
    id: uid(),
    key: spec.key,
    title: spec.title,
    iconUrl: spec.iconUrl,
    sourcePath: '',
    fileName: '',
    perspectiveName: 'dependencies',
    yamlBaseline: '',
    nodes: [],
    edges: [],
  }
  tabs.value = [...tabs.value, tab]
  activeTabId.value = tab.id
  /** Reset the refs so the loader starts from a clean slate; otherwise the previous tab's
   *  nodes/edges briefly flash through the GraphWorkspace before the loader assigns the new ones. */
  nodes.value = []
  edges.value = []
  perspectiveName.value = 'dependencies'
  sourcePath.value = ''
  fileName.value = ''
  yamlBaseline.value = ''
  await loader()
  /** Capture loader-produced state so re-activation via `activateTabById` later restores it. */
  snapshotActiveTab()
}

async function openBuiltinTab(): Promise<void> {
  await openOrActivateTab(
    { key: 'builtin', title: 'example.ilograph.yaml' },
    () => loadBuiltinExample(),
  )
}

async function openSbtExampleTab(root: string, dir: string): Promise<void> {
  await openOrActivateTab(
    { key: `sbt:${root}/${dir}`, title: dir, iconUrl: sbtLogoUrl },
    () => loadSbtBuildForExample(root, dir),
  )
}

async function openScalaPackagesTab(root: string, dir: string): Promise<void> {
  await openOrActivateTab(
    { key: `packages:${root}/${dir}`, title: dir, iconUrl: cubeIconUrl },
    () => loadScalaPackagesForExample(root, dir),
  )
}

async function loadSbtBuildForExample(root: string, dir: string) {
  const hit = sbtExamplesAll.find((e) => e.root === root && e.dir === dir)
  if (!hit) {
    status.value = 'No sbt example selected (or examples failed to bundle).'
    return
  }
  const projects = parseBuildSbt(hit.source)
  const projectsWithScalaSources = computeProjectsWithScalaSources(hit.root, hit.dir, projects)
  const yaml = sbtExampleSourceToYaml(hit.root, hit.dir, hit.source, { projectsWithScalaSources })
  sourcePath.value = `${hit.root}/${hit.dir}/build.sbt`
  await applyDoc(yaml, `${hit.root}/${hit.dir}/diagram.ilograph.yaml`, false)
  const linkable = projectsWithScalaSources.size
  status.value = `Parsed sbt \`${hit.root}/${hit.dir}/build.sbt\` → ${projects.length} project(s)${
    linkable ? `, ${linkable} with .scala sources (click [packages] in subtitle to switch view)` : ''
  }.`
}

/**
 * Decide which sbt subprojects expose Scala sources we can render in the package view.
 * A subproject's `baseDir` is matched against the bundled `.scala` files' relative paths under
 * the `(root, dir)` example (e.g. baseDir `core` → matches `core/src/main/scala/...`). If a
 * subproject has no explicit `baseDir`, we fall back to the project id as the directory name
 * (sbt's own default). The single-project case (`baseDir = '.'`) is special-cased: the whole
 * example dir counts, so any `.scala` file at all means the project has Scala sources.
 */
function computeProjectsWithScalaSources(
  root: string,
  exampleDir: string,
  projects: ReadonlyArray<{ id: string; baseDir?: string }>,
): Set<string> {
  const files = listScalaSourcesIn(root, exampleDir)
  if (!files.length) return new Set()
  const out = new Set<string>()
  for (const p of projects) {
    const rawDir = (p.baseDir ?? p.id).replace(/^\/+|\/+$/g, '')
    if (rawDir === '' || rawDir === '.') {
      /** `project in file(".")`: the project's base IS the example root, so any source counts. */
      out.add(p.id)
      continue
    }
    const prefix = `${rawDir}/`
    if (files.some((f) => f.relPath === rawDir || f.relPath.startsWith(prefix))) {
      out.add(p.id)
    }
  }
  return out
}

async function loadScalaPackagesForExample(root: string, dir: string) {
  const files = listScalaSourcesIn(root, dir)
  if (!files.length) {
    sourcePath.value = `${root}/${dir}/`
    nodes.value = []
    edges.value = []
    yamlBaseline.value = yamlPreview.value
    status.value = `No .scala files found under ${root}/${dir}/.`
    return
  }
  status.value = `Parsing ${files.length} Scala file${files.length === 1 ? '' : 's'} with tree-sitter…`
  try {
    const graph = await buildScalaPackageGraph(files)
    const sourceLabel = `${root}/${dir}/`
    sourcePath.value = sourceLabel
    /**
     * Seed the TinyBase `scalaDocs` table with the freshly scanned Scaladoc text, keyed by
     * the same resource id the flow node uses. We do this before `applyDoc` so the focused
     * box's `useScalaDoc` composable sees a populated ref on the very first render — there
     * is no "flashing placeholder" window between flow-node mount and doc arrival.
     *
     * The clear-before-write pattern matches the workspace invariant: a single scan is the
     * full source of truth for that workspace. Rows for artefacts that have been renamed or
     * deleted vanish in the same pass. `await whenOverlayStoreReady()` happens inside
     * `applyDoc`; we call it here as well so a very first load can't race the LocalPersister's
     * auto-load (which would otherwise overwrite our fresh docs with stale persisted ones).
     */
    await whenOverlayStoreReady()
    const ws = activeWorkspaceKey.value
    if (ws) {
      clearScalaDocsForWorkspace(ws)
      clearScalaTestBlocksForWorkspace(ws)
      clearScalaCoverageForWorkspace(ws)
      clearScalaSpecsForWorkspace(ws)
      for (const { id, doc } of collectScalaArtefactDocs(graph)) {
        setScalaDoc(ws, id, doc)
      }
      /**
       * If the example folder contains a captured `sbt-test.log`, parse it and store one
       * console-like checklist block per resolved artefact id.
       */
      const log = getSbtTestLogFor(root, dir)
      if (log?.text) {
        const blocks = parseSbtTestLog(log.text)
        // Build a simple-name index of known artefact ids so `Fruit.Banana` → `Banana` resolves.
        const byName = new Map<string, string[]>()
        for (const p of graph.packages) {
          for (const a of p.artefacts) {
            const id = `${a.packageName || '<root>'}::${a.kind.replace(/\s+/g, '-')}:${a.name}`
            const bucket = byName.get(a.name) ?? []
            bucket.push(id)
            byName.set(a.name, bucket)
          }
        }
        for (const b of blocks) {
          const raw = String(b.subject ?? '').trim()
          if (!raw) continue
          const simple = raw.includes('.') ? raw.slice(raw.lastIndexOf('.') + 1) : raw
          const ids = byName.get(simple) ?? []
          if (ids.length !== 1) continue
          setScalaTestBlock(ws, ids[0]!, { suite: b.suite, subject: b.subject, blockText: b.blockText })
        }

        // Spec source locations live under `src/test/scala`, which we omit from the diagram/YAML.
        // We still scan them so we can link "Tests and Specs" lines back to their source.
        const specNameCounts = new Map<string, number>()
        const specByName = new Map<string, { name: string; declaration: string; file: string; startRow: number }>()
        for (const a of graph.testArtefacts ?? []) {
          if (!a?.name || !a?.file) continue
          specNameCounts.set(a.name, (specNameCounts.get(a.name) ?? 0) + 1)
          specByName.set(a.name, {
            name: a.name,
            declaration: a.declaration || `${a.kind} ${a.name}`,
            file: a.file,
            startRow: Number.isFinite(a.startRow) ? a.startRow : 0,
          })
        }
        // Only keep unambiguous spec names (simple-name lookup only).
        for (const [name, count] of specNameCounts.entries()) {
          if (count !== 1) specByName.delete(name)
        }

        const specsByArtefactId = new Map<string, Array<{ name: string; declaration: string; file: string; startRow: number }>>()
        for (const b of blocks) {
          const rawSubject = String(b.subject ?? '').trim()
          if (!rawSubject) continue
          const simple = rawSubject.includes('.') ? rawSubject.slice(rawSubject.lastIndexOf('.') + 1) : rawSubject
          const ids = byName.get(simple) ?? []
          if (ids.length !== 1) continue
          const artId = ids[0]!
          const suiteLine = String(b.suite ?? '').trim()
          if (!suiteLine) continue
          const suiteName = suiteLine.endsWith(':') ? suiteLine.slice(0, -1) : suiteLine
          const spec = specByName.get(suiteName)
          if (!spec) continue
          const bucket = specsByArtefactId.get(artId) ?? []
          if (!bucket.some((x) => x.name === spec.name)) bucket.push(spec)
          specsByArtefactId.set(artId, bucket)
        }
        for (const [artId, specs] of specsByArtefactId.entries()) {
          setScalaSpecs(ws, artId, specs)
        }
      }

      // Parse scoverage XML if present and store statement coverage per artefact.
      const rep = getScoverageReportFor(root, dir)
      if (rep?.xml) {
        const rates = parseScoverageXml(rep.xml)
        // Index graph artefacts by (packageFqn, name) → ids by kind.
        const idx = new Map<string, { classIds: string[]; objectIds: string[]; traitIds: string[] }>()
        for (const p of graph.packages) {
          for (const a of p.artefacts) {
            const id = `${a.packageName || '<root>'}::${a.kind.replace(/\s+/g, '-')}:${a.name}`
            const key = `${a.packageName || '<root>'}\u0001${a.name}`
            const bucket = idx.get(key) ?? { classIds: [], objectIds: [], traitIds: [] }
            const k = a.kind.toLowerCase()
            if (k.includes('trait')) bucket.traitIds.push(id)
            else if (k.includes('object')) bucket.objectIds.push(id)
            else if (k.includes('class')) bucket.classIds.push(id)
            idx.set(key, bucket)
          }
        }
        for (const r of rates) {
          const dot = r.fullName.lastIndexOf('.')
          if (dot <= 0) continue
          const pkg = r.fullName.slice(0, dot)
          const rawSimple = r.fullName.slice(dot + 1)
          /**
           * Scala/JVM artifacts often show up in scoverage with `$` suffixes:
           * - objects / companions: `Foo$`
           * - inner / synthetic: `Foo$Bar`, `Foo$package$`, etc.
           *
           * Our scanner artefacts are source-level names (`Foo`, `Bar`), so attempt matching:
           *   1) exact simple name
           *   2) strip a single trailing `$`
           *   3) take the prefix before the first `$`
           */
          const simpleCandidates = Array.from(
            new Set([
              rawSimple,
              rawSimple.endsWith('$') ? rawSimple.slice(0, -1) : rawSimple,
              rawSimple.includes('$') ? rawSimple.slice(0, rawSimple.indexOf('$')) : rawSimple,
            ].filter(Boolean)),
          )

          let hit: { classIds: string[]; objectIds: string[]; traitIds: string[] } | undefined
          for (const s of simpleCandidates) {
            hit = idx.get(`${pkg}\u0001${s}`)
            if (hit) break
          }
          if (!hit) continue

          const t = (r.classType || '').toLowerCase()
          const candidates =
            t === 'object' ? hit.objectIds : t === 'trait' ? hit.traitIds : hit.classIds
          // Be permissive: if several artefacts share the same (pkg, name) bucket, apply the
          // same class-level statement rate to each candidate. This avoids dropping coverage
          // entirely due to ambiguity (e.g. case class vs class, or compiler-emitted companions).
          for (const id of candidates) {
            setScalaCoverage(ws, id, r.statementRate)
          }
        }
      }
    }
    const doc = scalaPackageGraphToIlographDocument(graph, {
      title: `Scala packages: ${dir}`,
      sourcePath: sourceLabel,
    })
    const yaml = stringifyIlographYaml(doc)
    await applyDoc(yaml, `${root}/${dir}/packages.ilograph.yaml`, false, {
      moduleNodeType: 'package',
    })
    status.value = `Parsed ${files.length} Scala file${files.length === 1 ? '' : 's'} → outer package group with sub-package nodes; package imports (wildcard and explicit) as LR edges.`
  } catch (err) {
    status.value = `Failed to parse Scala sources: ${(err as Error).message}`
  }
}

/**
 * Internal `triton:` URL scheme used by markdown links inside project-box subtitles.
 * Examples: `triton:packages` (open/activate the packages tab for the current example),
 * `triton:sbt` (open/activate the sbt build tab). Unknown links fall through to a normal
 * `window.open` so authors can also embed external docs links.
 */
function onNodeLinkAction(payload: { nodeId: string; href: string }) {
  const href = payload.href.trim()
  if (href === 'triton:packages' || href === 'triton://diagram/packages') {
    const ex = activeExample.value
    if (!ex) {
      status.value = 'Cannot open packages view — no sbt example loaded.'
      return
    }
    void openScalaPackagesTab(ex.root, ex.dir)
    return
  }
  if (href === 'triton:sbt' || href === 'triton://diagram/sbt') {
    const ex = activeExample.value
    if (!ex) {
      status.value = 'Cannot open sbt view — no sbt example loaded.'
      return
    }
    void openSbtExampleTab(ex.root, ex.dir)
    return
  }
  if (/^https?:/i.test(href)) {
    window.open(href, '_blank', 'noopener,noreferrer')
    return
  }
  status.value = `Ignored link with unrecognized target: ${href}`
}

function onFilePick(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    const text = String(reader.result)
    const name = file.name
    /** Each upload gets a unique key so re-picking the same file opens a fresh tab. */
    void openOrActivateTab(
      { key: `file:${name}#${uid()}`, title: name },
      async () => {
        sourcePath.value = name
        await applyDoc(text, name, true)
      },
    )
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

async function addRootPackage() {
  const id = `package-${uid()}`
  await nextTick()
  await waitFrameLayout()
  const vp = readFlowViewport()
  nodes.value = layoutDepthInViewport(
    [
      ...nodes.value,
      {
        id,
        type: 'package',
        position: { x: 0, y: 0 },
        sourcePosition: Position.Left,
        targetPosition: Position.Right,
        data: {
          label: 'new-package',
          subtitle: 'Scala package',
          description: '',
          boxColor: boxColorForId(id),
          drillNote: drillNoteForModuleId(id),
        },
      },
    ],
    edges.value,
    vp,
  )
  edges.value = mergeEdgesWithVisibility(routeSmoothstepEdgesInViewport(nodes.value, edges.value, vp))
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
  /** Persist into the tab so a switch-away/-back doesn't drop the freshly accepted baseline. */
  if (activeTab.value) activeTab.value.yamlBaseline = yamlBaseline.value
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
    (n) => isLeafBoxNode(n) && String((n.data as { label?: string })?.label ?? '') === name,
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
  void relayoutAfterPanelToggle()
})

/**
 * Toggling the YAML side panel changes `.flow-wrap` width without a window resize event,
 * so Vue Flow's pane / viewport metrics can be stale by the time we re-layout. Nudge the
 * resize path Vue Flow already listens for, then run the standard relayout — which re-runs
 * the depth layout AND re-applies any active layer drill against the new viewport so a
 * focused container does not stay sized for the old (wider) viewport.
 */
async function relayoutAfterPanelToggle() {
  await nextTick()
  await waitFrameLayout()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('resize'))
    await waitFrameLayout()
  }
  await graphRef.value?.relayoutViewport?.()
}

onMounted(() => {
  window.addEventListener('resize', scheduleRelayoutFromResize)
  /**
   * Boot into the first bundled Scala example (currently `scala-examples/animal-fruit`)
   * because the Scala package + artefact diagram is the showcase view we iterate on most.
   * Fall back to the Ilograph reference demo if the Scala bundle is empty so the editor
   * still has *something* to show on first load.
   */
  const scalaDefault = scalaExamples[0]
  if (scalaDefault) {
    void openSbtExampleTab(scalaDefault.root, scalaDefault.dir)
  } else {
    void openBuiltinTab()
  }
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
          <template v-if="scalaExamples.length">
            <div class="menu-heading" role="presentation">Scala examples</div>
            <button
              v-for="e in scalaExamples"
              :key="e.root + '/' + e.dir"
              type="button"
              class="menu-item"
              role="menuitem"
              :class="{ 'menu-item--active': activeExampleSelectionKey === exampleSelectionId(e.root, e.dir) }"
              :title="e.path"
              @click="selectExample(exampleSelectionId(e.root, e.dir))"
            >
              {{ exampleOptionLabel(e.dir) }}
            </button>
            <div class="menu-sep" role="separator" />
          </template>
          <button
            type="button"
            class="menu-item"
            role="menuitem"
            :class="{ 'menu-item--active': activeExampleSelectionKey === '__builtin__' }"
            @click="selectExample('__builtin__')"
          >
            Ilograph demo (five layers)
          </button>
          <template v-if="sbtExamplesTutorial.length">
            <div class="menu-sep" role="separator" />
            <div class="menu-heading" role="presentation">Bundled sbt (tutorial)</div>
            <button
              v-for="e in sbtExamplesTutorial"
              :key="e.root + '/' + e.dir"
              type="button"
              class="menu-item"
              role="menuitem"
              :class="{ 'menu-item--active': activeExampleSelectionKey === exampleSelectionId(e.root, e.dir) }"
              :title="e.path"
              @click="selectExample(exampleSelectionId(e.root, e.dir))"
            >
              {{ exampleOptionLabel(e.dir) }}
            </button>
          </template>
          <template v-if="sbtExamplesLargeOss.length">
            <div class="menu-sep" role="separator" />
            <div class="menu-heading" role="presentation">Bundled sbt (large OSS)</div>
            <button
              v-for="e in sbtExamplesLargeOss"
              :key="e.root + '/' + e.dir"
              type="button"
              class="menu-item"
              role="menuitem"
              :class="{ 'menu-item--active': activeExampleSelectionKey === exampleSelectionId(e.root, e.dir) }"
              :title="e.path"
              @click="selectExample(exampleSelectionId(e.root, e.dir))"
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
        {{ showYamlEditor ? 'Hide Panel' : 'Show Panel' }}
      </button>
      <span class="status">{{ status }}</span>
    </header>

    <div
      v-if="tabs.length"
      class="tab-strip"
      role="tablist"
      aria-label="Open diagrams"
    >
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="tab"
        role="tab"
        :class="{ 'tab--active': tab.id === activeTabId }"
        :aria-selected="tab.id === activeTabId"
        :title="tab.sourcePath || tab.title"
        @click="activateTabById(tab.id)"
      >
        <img v-if="tab.iconUrl" class="tab__icon" :src="tab.iconUrl" alt="" aria-hidden="true" />
        <span class="tab__title">{{ tab.title }}</span>
        <span
          class="tab__close"
          role="button"
          tabindex="0"
          aria-label="Close tab"
          @click.stop="closeTab(tab.id)"
          @keydown.enter.stop.prevent="closeTab(tab.id)"
          @keydown.space.stop.prevent="closeTab(tab.id)"
        >×</span>
      </button>
    </div>

    <div class="main" :class="{ 'main--no-side': !showYamlEditor }">
      <div class="flow-wrap">
        <div v-if="sourcePath" class="source-path-overlay" :title="sourcePath">
          <img class="source-path-overlay__logo" :src="cubeIconUrl" alt="" aria-hidden="true" />
          <span class="source-path-overlay__text">{{ sourcePath }}</span>
        </div>
        <GraphWorkspace
          ref="graphRef"
          v-model:nodes="nodes"
          v-model:edges="edges"
          :node-types="nodeTypes"
          :relation-type-visibility="relationTypeVisibility"
          @status="(s) => (status = s)"
          @link-action="onNodeLinkAction"
        />
      </div>
      <aside v-if="showYamlEditor" class="side">
        <div class="side-panel-tabs" role="tablist" aria-label="YAML and tools">
          <button
            type="button"
            class="side-tab"
            role="tab"
            :class="{ 'side-tab--active': sidePanelTab === 'yaml' }"
            :aria-selected="sidePanelTab === 'yaml'"
            @click="sidePanelTab = 'yaml'"
          >
            YAML editor
          </button>
          <button
            type="button"
            class="side-tab"
            role="tab"
            :class="{ 'side-tab--active': sidePanelTab === 'prompt' }"
            :aria-selected="sidePanelTab === 'prompt'"
            @click="sidePanelTab = 'prompt'"
          >
            Prompt
          </button>
          <button
            type="button"
            class="side-tab"
            role="tab"
            :class="{ 'side-tab--active': sidePanelTab === 'templates' }"
            :aria-selected="sidePanelTab === 'templates'"
            @click="sidePanelTab = 'templates'"
          >
            Templates
          </button>
        </div>
        <div class="side-panel-body">
          <div
            v-show="sidePanelTab === 'yaml'"
            class="side-panel-pane side-panel-pane--yaml"
            role="tabpanel"
          >
            <div class="side-yaml-bar">
              <span class="side-yaml-bar__hint">
                Monaco diff: additions vs baseline (green). Load file/example resets baseline.
              </span>
              <button type="button" class="btn side-yaml-bar__btn" @click="acceptYamlBaseline">
                Accept baseline
              </button>
            </div>
            <YamlDiffEditor class="yaml-diff" :original="yamlBaseline" :modified="yamlPreview" />
          </div>
          <div
            v-show="sidePanelTab === 'prompt'"
            class="side-panel-pane side-panel-pane--prompt"
            role="tabpanel"
          >
            <div class="prompt-section prompt-section--tab">
              <div class="prompt-bar">
                <span class="prompt-bar__hint">
                  Generated edit prompt — paste into an AI assistant to apply the same change to the
                  YAML source.
                </span>
                <button type="button" class="btn prompt-bar__btn" @click="copyEditPrompt">
                  Copy prompt
                </button>
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
          </div>
          <div
            v-show="sidePanelTab === 'templates'"
            class="side-panel-pane side-panel-pane--templates"
            role="tabpanel"
          >
            <p class="side-templates-hint">Add a standalone project or Scala package box to the graph.</p>
            <div class="side-templates-actions">
              <button type="button" class="btn primary side-template-btn" @click="addRootModule">
                <img class="side-template-btn__icon" :src="cubeIconUrl" alt="" aria-hidden="true" />
                <span>Add Project</span>
              </button>
              <button type="button" class="btn side-template-btn" @click="addRootPackage">
                <img class="side-template-btn__icon" :src="folderIconUrl" alt="" aria-hidden="true" />
                <span>Add Package</span>
              </button>
            </div>
          </div>
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
/*
 * Browser-like tab strip — one tab per opened diagram. The active tab's payload lives in the
 * top-level Vue refs (see `DiagramTab` in the script); inactive tabs hold a snapshot until they
 * become active again. Close buttons are spans (not nested <button>) because nesting interactive
 * elements inside a <button class="tab"> is invalid HTML.
 */
.tab-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 4px;
  padding: 6px 12px 0;
  background: #f1f5f9;
  border-bottom: 1px solid #e2e8f0;
}
.tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 260px;
  padding: 6px 8px 6px 10px;
  border: 1px solid #cbd5e1;
  border-bottom-color: transparent;
  border-radius: 6px 6px 0 0;
  background: #e2e8f0;
  color: #475569;
  font-family: inherit;
  font-size: 13px;
  cursor: pointer;
  /* Sit on top of the bottom border so the active tab visually merges with the canvas below. */
  margin-bottom: -1px;
}
.tab:hover {
  background: #f8fafc;
  color: #0f172a;
}
.tab--active {
  background: #fff;
  color: #0f172a;
  border-color: #cbd5e1;
  border-bottom-color: #fff;
  font-weight: 600;
}
.tab__icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  display: block;
  object-fit: contain;
}
.tab__title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.tab__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  font-size: 14px;
  line-height: 1;
  color: #64748b;
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
}
.tab__close:hover {
  background: rgba(15, 23, 42, 0.1);
  color: #0f172a;
}
.tab__close:focus-visible {
  outline: 2px solid #93c5fd;
  outline-offset: 1px;
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
  padding: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.side-panel-tabs {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 0;
  flex-shrink: 0;
  padding: 0 4px;
  background: #f1f5f9;
  border-bottom: 1px solid #e2e8f0;
}
.side-tab {
  border: 0;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  padding: 10px 14px;
  font-family: inherit;
  font-size: 13px;
  color: #64748b;
  background: transparent;
  cursor: pointer;
  border-radius: 6px 6px 0 0;
}
.side-tab:hover {
  color: #0f172a;
  background: rgba(255, 255, 255, 0.6);
}
.side-tab--active {
  color: #0f172a;
  font-weight: 600;
  background: #fff;
  border-bottom-color: #2563eb;
}
.side-panel-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px;
  gap: 8px;
}
.side-panel-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.side-panel-pane--templates {
  flex: 0 1 auto;
  align-items: flex-start;
}
.side-templates-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: #64748b;
  max-width: 36em;
}
.side-templates-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
  margin-top: 4px;
}
.side-template-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.side-template-btn__icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  object-fit: contain;
}
.btn.primary .side-template-btn__icon {
  filter: brightness(0) invert(1);
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
.prompt-section--tab {
  flex: 1;
  min-height: 0;
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
  flex: 1;
  min-height: 160px;
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
