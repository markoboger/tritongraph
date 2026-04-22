<script setup lang="ts">
import { Position, type NodeTypesObject } from '@vue-flow/core'
import { computed, nextTick, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import FlowProjectNode from './components/diagram/FlowProjectNode.vue'
import FlowPackageNode from './components/diagram/FlowPackageNode.vue'
import GroupNode from './components/GroupNode.vue'
import GraphWorkspace from './components/GraphWorkspace.vue'
import DiagramTopBar from './components/common/DiagramTopBar.vue'
import YamlDiffEditor from './components/YamlDiffEditor.vue'
import { parseIlographYaml, stringifyIlographYaml } from './ilograph/parse'
import type { IlographDocument } from './ilograph/types'
import { dojoFixtures, getDojoFixture } from './dojo'
import sbtLogoUrl from './assets/language-icons/sbt.svg'
import cubeIconUrl from './assets/language-icons/cube.svg'
import stackedCubesIconUrl from './assets/language-icons/stacked-cubes.svg'
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
  normalizeRelationTypeKey,
  relationTypeKeysSignature,
  relationTypesFromSignature,
  shouldHideEdgeForRelationFilter,
} from './graph/relationVisibility'
import { drillNoteForModuleId } from './graph/sbtStyleDrillNotes'
import { listSbtExamples } from './sbt/sbtExampleBuilds'
import { parseBuildSbt } from './sbt/parseBuildSbt'
import { sbtProjectsToIlographDocument } from './sbt/sbtProjectsToIlographDocument'
import { getSbtTestLogFor } from './sbt/sbtTestLogLoader'
import { parseSbtTestLog } from './sbt/parseSbtTestLog'
import { getScoverageReportFor } from './sbt/scoverageReportLoader'
import { parseScoverageXml } from './sbt/parseScoverageXml'
import { listScalaSourcesIn } from './scala/scalaSourceLoader'
import {
  buildScalaPackageGraph,
  scalaPackageGraphToIlographDocument,
} from './scala/scalaPackagesToIlograph'
import { buildScalaWorkspacePayload } from '../../packages/triton-core/src/tritonWorkspacePayload'
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
const sourcePathLogoUrl = computed(() => {
  const src = sourcePath.value.trim()
  if (src.endsWith('/build.sbt') || src.endsWith('\\build.sbt')) return sbtLogoUrl
  return cubeIconUrl
})
const runtimeQuery = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
const requestedTabKey = runtimeQuery?.get('tab')?.trim() ?? ''
const requestedDojo = runtimeQuery?.get('dojo')?.trim() ?? ''
const initialRequestedPerspectiveName = runtimeQuery?.get('perspective')?.trim() ?? ''
const initialRequestedDojoDepth = Number.parseInt(runtimeQuery?.get('dojoDepth')?.trim() ?? '', 10)
const runtimeWorkspaceSession = computed(() => {
  const workspacePath = runtimeQuery?.get('workspaceFolder')?.trim() ?? ''
  const rawRuntimeUrl = runtimeQuery?.get('runtimeUrl')?.trim() ?? ''
  const runtimeUrl = rawRuntimeUrl.replace(/\/$/, '')
  if (!workspacePath || !runtimeUrl) return null
  const workspaceName =
    runtimeQuery?.get('workspaceName')?.trim() ||
    workspacePath.split(/[\\/]/).filter(Boolean).pop() ||
    'workspace'
  return {
    workspacePath,
    workspaceName,
    runtimeUrl,
  }
})
const ideSession = computed(() => {
  const ideOpenUrl = runtimeQuery?.get('ideOpenUrl')?.trim() ?? ''
  if (!ideOpenUrl) return null
  return {
    ideName: runtimeQuery?.get('ideName')?.trim() || 'IDE',
    workspaceName: runtimeQuery?.get('workspaceName')?.trim() || '',
    activeFile: runtimeQuery?.get('activeFile')?.trim() || '',
    ideOpenUrl,
  }
})

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
const metricTooltipsEnabled = ref(false)
const metricVisibility = ref<Record<'coverage' | 'debt' | 'issues', boolean>>({
  coverage: true,
  debt: false,
  issues: false,
})

function requestedPerspectiveFromUrl(): string {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('perspective')?.trim() ?? ''
}

function collectInnerRelationTypeKeys(nodeList: readonly any[]): string[] {
  const out = new Set<string>()
  for (const node of nodeList) {
    const raw = (node?.data as Record<string, unknown> | undefined)?.innerArtefactRelations
    if (!Array.isArray(raw)) continue
    for (const rel of raw) {
      const label = (rel as Record<string, unknown> | undefined)?.label
      out.add(normalizeRelationTypeKey(label))
    }
  }
  return [...out]
}

const relationTypesMenuSig = computed(() => {
  const keys = new Set(relationTypesFromSignature(relationTypeKeysSignature(edges.value)))
  for (const key of collectInnerRelationTypeKeys(nodes.value)) keys.add(key)
  return [...keys].sort().join('\n')
})

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
const sidePanelTab = ref<'yaml' | 'prompt' | 'templates' | 'dojo'>('yaml')

const PACKAGE_NESTING_DOJO_ID = 'package-nesting'
const PACKAGE_STACKING_DOJO_ID = 'package-stacking'
const PACKAGE_IMPORT_CHAIN_DOJO_ID = 'package-import-chain'

function clampDojoDepth(raw: number): number {
  if (!Number.isFinite(raw)) return 4
  return Math.min(20, Math.max(1, Math.round(raw)))
}

function clampDojoStackCount(raw: number): number {
  if (!Number.isFinite(raw)) return 8
  return Math.min(40, Math.max(1, Math.round(raw)))
}

const dojoNestingDepth = ref(clampDojoDepth(initialRequestedDojoDepth))
const dojoStackCount = ref(clampDojoStackCount(initialRequestedDojoDepth))
const dojoImportChainLength = ref(clampDojoStackCount(initialRequestedDojoDepth))

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
const dojoExamples = computed(() => [
  { id: PACKAGE_NESTING_DOJO_ID, title: 'Package nesting' },
  { id: PACKAGE_STACKING_DOJO_ID, title: 'Package stacking' },
  { id: PACKAGE_IMPORT_CHAIN_DOJO_ID, title: 'Package import chain' },
  ...dojoFixtures.map((fixture) => ({ id: fixture.id, title: fixture.title })),
])

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
  dojoDepth?: number
}

interface RuntimeWorkspaceBundle {
  ok: boolean
  workspacePath: string
  workspaceName: string
  buildSbt: { relPath: string; source: string } | null
  scalaFiles: Array<{ relPath: string; source: string }>
  testLog: { relPath: string; text: string } | null
  coverageReport: { relPath: string; xml: string } | null
}

interface RuntimeWorkspaceActionResult {
  ok: boolean
  action?: string
  stdout?: string
  stderr?: string
  note?: string
}

interface ProjectScope {
  id: string
  baseDir?: string
}

const tabs = ref<DiagramTab[]>([])
const activeTabId = ref<string | null>(null)

const activeTab = computed<DiagramTab | undefined>(() =>
  tabs.value.find((t) => t.id === activeTabId.value),
)

function stripExampleProjectSuffix(body: string): string {
  const hash = body.indexOf('#')
  return hash >= 0 ? body.slice(0, hash) : body
}

function parseRuntimeTabKey(
  key: string,
): { workspacePath: string; workspaceName: string; projectId?: string } | null {
  const prefixes = ['runtime-sbt:', 'runtime-packages:']
  for (const prefix of prefixes) {
    if (!key.startsWith(prefix)) continue
    const body = key.slice(prefix.length)
    const firstCut = body.indexOf('::')
    if (firstCut < 0) return { workspacePath: body, workspaceName: 'workspace' }
    const rest = body.slice(firstCut + 2)
    const secondCut = rest.indexOf('::')
    return {
      workspacePath: body.slice(0, firstCut),
      workspaceName: secondCut < 0 ? rest || 'workspace' : rest.slice(0, secondCut) || 'workspace',
      ...(secondCut < 0 ? {} : { projectId: rest.slice(secondCut + 2) || undefined }),
    }
  }
  return null
}

const activeRuntimeWorkspace = computed<{ workspacePath: string; workspaceName: string } | null>(() => {
  const parsed = parseRuntimeTabKey(activeTab.value?.key ?? '')
  return parsed ? { workspacePath: parsed.workspacePath, workspaceName: parsed.workspaceName } : null
})
const runtimeActionBusy = ref<string>('')
const runtimeEmptyStateMessage = computed(() => {
  if (!activeRuntimeWorkspace.value || nodes.value.length) return ''
  const text = status.value.trim()
  if (!text) return ''
  if (
    text.startsWith('Failed to load runtime') ||
    text.startsWith('No build.sbt found') ||
    text.startsWith('No .scala files found') ||
    text.startsWith('Loading ') ||
    text.startsWith('Refreshing workspace') ||
    text.startsWith('Running sbt test') ||
    text.startsWith('Running coverage')
  ) {
    return text
  }
  return ''
})

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
  if (k.startsWith('packages:')) return `sbt:${stripExampleProjectSuffix(k.slice('packages:'.length))}`
  return ''
})

/** `(root, dir)` of the example backing the active tab; `null` for builtin / file uploads. */
const activeExample = computed<{ root: string; dir: string } | null>(() => {
  const k = activeTab.value?.key ?? ''
  if (k.startsWith('runtime-sbt:') || k.startsWith('runtime-packages:')) {
    return { root: '', dir: '' }
  }
  let body = ''
  if (k.startsWith('sbt:')) body = k.slice('sbt:'.length)
  else if (k.startsWith('packages:')) body = stripExampleProjectSuffix(k.slice('packages:'.length))
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
provide('tritonRelationTypeVisibility', relationTypeVisibility)
provide('tritonMetricTooltipsEnabled', metricTooltipsEnabled)
provide('tritonMetricVisibility', metricVisibility)

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
  options: { moduleNodeType?: 'module' | 'package'; recenterStackShrink?: boolean } = {},
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
    preferredPerspectiveName: initialRequestedPerspectiveName || requestedPerspectiveFromUrl() || undefined,
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
  graphRef.value?.resetNavigationAfterDocReplace?.()
  await graphRef.value?.fitToViewport?.({
    duration: 0,
    ...(options.recenterStackShrink ? { recenterStackShrink: true } : {}),
  })
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

async function fetchRuntimeWorkspaceBundle(
  workspacePath: string,
  workspaceName: string,
): Promise<RuntimeWorkspaceBundle> {
  const session = runtimeWorkspaceSession.value
  if (!session?.runtimeUrl) {
    throw new Error('No runtime URL was supplied by the IDE session.')
  }
  const url = new URL(`${session.runtimeUrl}/api/workspace/bundle`)
  url.searchParams.set('workspacePath', workspacePath)
  const res = await fetch(url.toString(), { method: 'GET' })
  if (!res.ok) {
    throw new Error(`Runtime bundle request failed (${res.status}).`)
  }
  const body = (await res.json()) as Partial<RuntimeWorkspaceBundle>
  return {
    ok: body.ok === true,
    workspacePath: String(body.workspacePath ?? workspacePath),
    workspaceName: String(body.workspaceName ?? workspaceName),
    buildSbt:
      body.buildSbt && typeof body.buildSbt === 'object'
        ? {
            relPath: String(body.buildSbt.relPath ?? 'build.sbt'),
            source: String(body.buildSbt.source ?? ''),
          }
        : null,
    scalaFiles: Array.isArray(body.scalaFiles)
      ? body.scalaFiles.map((f) => ({
          relPath: String(f?.relPath ?? ''),
          source: String(f?.source ?? ''),
        }))
      : [],
    testLog:
      body.testLog && typeof body.testLog === 'object'
        ? {
            relPath: String(body.testLog.relPath ?? 'sbt-test.log'),
            text: String(body.testLog.text ?? ''),
          }
        : null,
    coverageReport:
      body.coverageReport && typeof body.coverageReport === 'object'
        ? {
            relPath: String(body.coverageReport.relPath ?? 'target/scoverage.xml'),
            xml: String(body.coverageReport.xml ?? ''),
          }
        : null,
  }
}

async function postRuntimeWorkspaceAction(
  workspacePath: string,
  action: 'refresh' | 'sbt-test' | 'sbt-coverage',
): Promise<RuntimeWorkspaceActionResult> {
  const session = runtimeWorkspaceSession.value
  if (!session?.runtimeUrl) {
    throw new Error('No runtime URL was supplied by the IDE session.')
  }
  const url = `${session.runtimeUrl}/api/workspace/action`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, workspacePath }),
  })
  const body = (await res.json().catch(() => ({}))) as Partial<RuntimeWorkspaceActionResult>
  if (!res.ok) {
    throw new Error(String(body.stderr || body.note || `Runtime action failed (${res.status}).`))
  }
  return {
    ok: body.ok === true,
    action: typeof body.action === 'string' ? body.action : action,
    stdout: typeof body.stdout === 'string' ? body.stdout : '',
    stderr: typeof body.stderr === 'string' ? body.stderr : '',
    note: typeof body.note === 'string' ? body.note : '',
  }
}

async function selectExample(id: string) {
  if (examplesMenu.value) examplesMenu.value.open = false
  if (id === '__builtin__') {
    await openBuiltinTab()
    return
  }
  if (id.startsWith('dojo:')) {
    await openDojoTab(id.slice('dojo:'.length))
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
    dojoDepth: undefined,
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

function buildPackageNestingDojoDocument(depth: number): IlographDocument {
  const normalizedDepth = clampDojoDepth(depth)

  function buildLevel(level: number): NonNullable<IlographDocument['resources']>[number] {
    return {
      id: `package-${level}`,
      name: `package-${level}`,
      subtitle: `depth ${level}`,
      'x-triton-package-scope': true,
      ...(level === 1 ? { 'x-triton-package-language': 'scala' } : {}),
      ...(level < normalizedDepth ? { children: [buildLevel(level + 1)] } : {}),
    }
  }

  return {
    description:
      'Dojo for nested package containers. Increase depth with the dojo slider to inspect how nested package scopes resize and reflow.',
    resources: [buildLevel(1)],
    perspectives: [
      {
        id: 'dependencies',
        name: 'dependencies',
        orientation: 'leftToRight',
        relations: [],
      },
    ],
  }
}

/**
 * Linear chain: `import-link-1` → … → `import-link-n` with `imports` edges (dependent on the left,
 * imported symbol on the right), matching {@link layoutDependencyLayers} classpath semantics.
 */
function buildPackageImportChainDojoDocument(chainLen: number): IlographDocument {
  const n = clampDojoStackCount(chainLen)
  const resources = Array.from({ length: n }, (_, index) => {
    const k = index + 1
    return {
      id: `import-link-${k}`,
      name: `import-link-${k}`,
      subtitle: `chain ${k} of ${n}`,
      'x-triton-package-scope': true,
      'x-triton-preferred-leaf-height': 52,
      ...(k === 1 ? { 'x-triton-package-language': 'scala' } : {}),
    }
  })
  const relations =
    n >= 2
      ? Array.from({ length: n - 1 }, (_, index) => {
          const i = index + 1
          return {
            from: `import-link-${i}`,
            to: `import-link-${i + 1}`,
            label: 'imports',
          }
        })
      : []
  return {
    description:
      'Dojo for a linear chain of Scala package-scope containers linked by `imports` (Scala package import) edges. Extend the chain to stress depth columns, edge routing, and viewport fit.',
    resources,
    perspectives: [
      {
        id: 'dependencies',
        name: 'dependencies',
        orientation: 'leftToRight',
        relations,
      },
    ],
  }
}

function buildPackageStackingDojoDocument(count: number): IlographDocument {
  const normalizedCount = clampDojoStackCount(count)
  return {
    description:
      'Dojo for independent package containers stacked in one diagram. Increase the count to inspect how package-scope containers stack and reflow without nesting.',
    resources: Array.from({ length: normalizedCount }, (_, index) => {
      const level = index + 1
      return {
        id: `stack-package-${level}`,
        name: `stack-package-${level}`,
        subtitle: `stack ${level}`,
        'x-triton-package-scope': true,
        'x-triton-preferred-leaf-height': 52,
        ...(level === 1 ? { 'x-triton-package-language': 'scala' } : {}),
      }
    }),
    perspectives: [
      {
        id: 'dependencies',
        name: 'dependencies',
        orientation: 'leftToRight',
        relations: [],
      },
    ],
  }
}

async function loadPackageNestingDojo(depth: number) {
  const normalizedDepth = clampDojoDepth(depth)
  dojoNestingDepth.value = normalizedDepth
  sourcePath.value = `dojo/${PACKAGE_NESTING_DOJO_ID}.ilograph.yaml`
  await applyDoc(
    stringifyIlographYaml(buildPackageNestingDojoDocument(normalizedDepth)),
    `${PACKAGE_NESTING_DOJO_ID}.ilograph.yaml`,
    false,
    { moduleNodeType: 'package' },
  )
  if (activeTab.value) activeTab.value.dojoDepth = normalizedDepth
  status.value = `Loaded dojo fixture ${PACKAGE_NESTING_DOJO_ID} at depth ${normalizedDepth}.`
}

async function loadPackageStackingDojo(count: number, prevCount?: number) {
  const normalizedCount = clampDojoStackCount(count)
  const stackShrunk = typeof prevCount === 'number' && normalizedCount < prevCount
  dojoStackCount.value = normalizedCount
  sourcePath.value = `dojo/${PACKAGE_STACKING_DOJO_ID}.ilograph.yaml`
  await applyDoc(
    stringifyIlographYaml(buildPackageStackingDojoDocument(normalizedCount)),
    `${PACKAGE_STACKING_DOJO_ID}.ilograph.yaml`,
    false,
    { moduleNodeType: 'package', ...(stackShrunk ? { recenterStackShrink: true } : {}) },
  )
  if (activeTab.value) activeTab.value.dojoDepth = normalizedCount
  status.value = `Loaded dojo fixture ${PACKAGE_STACKING_DOJO_ID} with ${normalizedCount} packages.`
}

async function loadPackageImportChainDojo(chainLen: number, prevLen?: number) {
  const n = clampDojoStackCount(chainLen)
  const chainShrunk = typeof prevLen === 'number' && n < prevLen
  dojoImportChainLength.value = n
  sourcePath.value = `dojo/${PACKAGE_IMPORT_CHAIN_DOJO_ID}.ilograph.yaml`
  await applyDoc(
    stringifyIlographYaml(buildPackageImportChainDojoDocument(n)),
    `${PACKAGE_IMPORT_CHAIN_DOJO_ID}.ilograph.yaml`,
    false,
    { moduleNodeType: 'package', ...(chainShrunk ? { recenterStackShrink: true } : {}) },
  )
  if (activeTab.value) activeTab.value.dojoDepth = n
  status.value = `Loaded dojo fixture ${PACKAGE_IMPORT_CHAIN_DOJO_ID} with chain length ${n}.`
}

async function loadDojoFixture(id: string) {
  if (id === PACKAGE_NESTING_DOJO_ID) {
    await loadPackageNestingDojo(dojoNestingDepth.value)
    return
  }
  if (id === PACKAGE_STACKING_DOJO_ID) {
    await loadPackageStackingDojo(dojoStackCount.value)
    return
  }
  if (id === PACKAGE_IMPORT_CHAIN_DOJO_ID) {
    await loadPackageImportChainDojo(dojoImportChainLength.value)
    return
  }
  const fixture = getDojoFixture(id)
  if (!fixture) {
    status.value = `Unknown dojo fixture: ${id}`
    await loadBuiltinExample()
    return
  }
  sourcePath.value = `dojo/${fixture.fileName}`
  await applyDoc(fixture.yaml, fixture.fileName, false)
  status.value = `Loaded dojo fixture ${fixture.id}.`
}

async function openDojoTab(id: string): Promise<void> {
  const fixture = getDojoFixture(id)
  const title =
    id === PACKAGE_NESTING_DOJO_ID
      ? `${PACKAGE_NESTING_DOJO_ID}.ilograph.yaml`
      : id === PACKAGE_STACKING_DOJO_ID
        ? `${PACKAGE_STACKING_DOJO_ID}.ilograph.yaml`
        : id === PACKAGE_IMPORT_CHAIN_DOJO_ID
          ? `${PACKAGE_IMPORT_CHAIN_DOJO_ID}.ilograph.yaml`
          : fixture?.fileName ?? `${id}.ilograph.yaml`
  await openOrActivateTab(
    { key: `dojo:${id}`, title, iconUrl: cubeIconUrl },
    () => loadDojoFixture(id),
  )
  if (
    id === PACKAGE_NESTING_DOJO_ID ||
    id === PACKAGE_STACKING_DOJO_ID ||
    id === PACKAGE_IMPORT_CHAIN_DOJO_ID
  ) {
    showYamlEditor.value = true
    sidePanelTab.value = 'dojo'
  }
}

function runtimeTabKey(prefix: 'runtime-sbt' | 'runtime-packages', workspacePath: string, workspaceName: string): string {
  return `${prefix}:${workspacePath}::${workspaceName}`
}

function isRestorableTabKey(key: string): boolean {
  return (
    key === 'builtin' ||
    key.startsWith('dojo:') ||
    key.startsWith('sbt:') ||
    key.startsWith('packages:') ||
    key.startsWith('runtime-sbt:') ||
    key.startsWith('runtime-packages:')
  )
}

function syncUrlFromState(): void {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  params.delete('dojo')
  params.delete('tab')
  params.delete('perspective')
  params.delete('dojoDepth')

  const key = activeTab.value?.key?.trim() ?? ''
  if (key && isRestorableTabKey(key)) params.set('tab', key)
  const perspective = perspectiveName.value?.trim() ?? ''
  if (perspective) params.set('perspective', perspective)
  if (key === `dojo:${PACKAGE_NESTING_DOJO_ID}`) {
    params.set('dojoDepth', String(clampDojoDepth(activeTab.value?.dojoDepth ?? dojoNestingDepth.value)))
  }
  if (key === `dojo:${PACKAGE_STACKING_DOJO_ID}`) {
    params.set('dojoDepth', String(clampDojoStackCount(activeTab.value?.dojoDepth ?? dojoStackCount.value)))
  }
  if (key === `dojo:${PACKAGE_IMPORT_CHAIN_DOJO_ID}`) {
    params.set('dojoDepth', String(clampDojoStackCount(activeTab.value?.dojoDepth ?? dojoImportChainLength.value)))
  }

  const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
  if (next !== current) {
    window.history.replaceState(null, '', next)
  }
}

async function openTabFromUrlKey(key: string): Promise<boolean> {
  const trimmed = key.trim()
  if (!trimmed) return false
  if (trimmed === 'builtin') {
    await openBuiltinTab()
    return true
  }
  if (trimmed.startsWith('dojo:')) {
    await openDojoTab(trimmed.slice('dojo:'.length))
    return true
  }
  if (trimmed.startsWith('sbt:')) {
    const body = trimmed.slice('sbt:'.length)
    const slash = body.indexOf('/')
    if (slash < 0) return false
    await openSbtExampleTab(body.slice(0, slash), body.slice(slash + 1))
    return true
  }
  if (trimmed.startsWith('packages:')) {
    const body = trimmed.slice('packages:'.length)
    const hash = body.indexOf('#')
    const scope = hash >= 0 ? body.slice(hash + 1) : ''
    const exampleBody = hash >= 0 ? body.slice(0, hash) : body
    const slash = exampleBody.indexOf('/')
    if (slash < 0) return false
    await openScalaPackagesTab(
      exampleBody.slice(0, slash),
      exampleBody.slice(slash + 1),
      scope || undefined,
    )
    return true
  }
  if (trimmed.startsWith('runtime-sbt:')) {
    const parsed = parseRuntimeTabKey(trimmed)
    if (!parsed) return false
    await openRuntimeSbtTab(parsed.workspacePath, parsed.workspaceName)
    return true
  }
  if (trimmed.startsWith('runtime-packages:')) {
    const parsed = parseRuntimeTabKey(trimmed)
    if (!parsed) return false
    await openRuntimePackagesTab(parsed.workspacePath, parsed.workspaceName, parsed.projectId)
    return true
  }
  return false
}

async function openSbtExampleTab(root: string, dir: string): Promise<void> {
  await openOrActivateTab(
    { key: `sbt:${root}/${dir}`, title: dir, iconUrl: stackedCubesIconUrl },
    () => loadSbtBuildForExample(root, dir),
  )
}

async function openScalaPackagesTab(root: string, dir: string, projectId?: string): Promise<void> {
  const scopeSuffix = projectId ? `#${projectId}` : ''
  await openOrActivateTab(
    {
      key: `packages:${root}/${dir}${scopeSuffix}`,
      title: projectId ? `${dir}:${projectId}` : dir,
      iconUrl: cubeIconUrl,
    },
    () => loadScalaPackagesForExample(root, dir, projectId),
  )
}

async function openRuntimeSbtTab(workspacePath: string, workspaceName: string): Promise<void> {
  await openOrActivateTab(
    {
      key: runtimeTabKey('runtime-sbt', workspacePath, workspaceName),
      title: workspaceName,
      iconUrl: stackedCubesIconUrl,
    },
    () => loadSbtBuildForRuntimeWorkspace(workspacePath, workspaceName),
  )
}

async function openRuntimePackagesTab(workspacePath: string, workspaceName: string, projectId?: string): Promise<void> {
  const scopeSuffix = projectId ? `::${projectId}` : ''
  await openOrActivateTab(
    {
      key: `${runtimeTabKey('runtime-packages', workspacePath, workspaceName)}${scopeSuffix}`,
      title: projectId ? `${workspaceName}:${projectId}` : workspaceName,
      iconUrl: cubeIconUrl,
    },
    () => loadScalaPackagesForRuntimeWorkspace(workspacePath, workspaceName, projectId),
  )
}

async function reloadActiveRuntimeTab(): Promise<void> {
  const runtimeWs = activeRuntimeWorkspace.value
  if (!runtimeWs || !activeTab.value) return
  const key = activeTab.value.key
  const parsed = parseRuntimeTabKey(key)
  if (key.startsWith('runtime-sbt:')) {
    await loadSbtBuildForRuntimeWorkspace(runtimeWs.workspacePath, runtimeWs.workspaceName)
  } else if (key.startsWith('runtime-packages:')) {
    await loadScalaPackagesForRuntimeWorkspace(runtimeWs.workspacePath, runtimeWs.workspaceName, parsed?.projectId)
  }
  snapshotActiveTab()
}

async function loadSbtBuildForExample(root: string, dir: string) {
  const hit = sbtExamplesAll.find((e) => e.root === root && e.dir === dir)
  if (!hit) {
    status.value = 'No sbt example selected (or examples failed to bundle).'
    return
  }
  const projects = parseBuildSbt(hit.source)
  const projectsWithScalaSources = computeProjectsWithScalaSources(hit.root, hit.dir, projects)
  const doc = sbtProjectsToIlographDocument(projects, {
    title: `sbt build: ${dir}`,
    sourcePath: `${hit.root}/${hit.dir}/build.sbt`,
    projectsWithScalaSources,
  })
  const allFiles = listScalaSourcesIn(hit.root, hit.dir)
  const rep = getScoverageReportFor(hit.root, hit.dir)
  if (allFiles.length && rep?.xml) {
    const graph = await buildScalaPackageGraph(allFiles)
    const parsedCoverage = parseScoverageXml(rep.xml)
    const payload = buildScalaWorkspacePayload({
      sourcePath: `${hit.root}/${hit.dir}/build.sbt`,
      title: `sbt build: ${dir}`,
      graph,
      ilographDocument: doc,
      parsedCoverage,
    })
    await whenOverlayStoreReady()
    const ws = activeWorkspaceKey.value
    if (ws) {
      clearScalaCoverageForWorkspace(ws)
      for (const entry of payload.coverage) setScalaCoverage(ws, entry.id, entry.stmtPct)
    }
  }
  const yaml = stringifyIlographYaml(doc)
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
  return computeProjectsWithScalaSourceFiles(files, projects)
}

function computeProjectsWithScalaSourceFiles(
  files: ReadonlyArray<{ relPath: string }>,
  projects: ReadonlyArray<{ id: string; baseDir?: string }>,
): Set<string> {
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

function normalizeProjectBaseDir(project: { id: string; baseDir?: string }): string {
  return (project.baseDir ?? project.id).replace(/^\/+|\/+$/g, '')
}

function projectScopeById(
  projects: ReadonlyArray<{ id: string; baseDir?: string }>,
  projectId?: string,
): ProjectScope | null {
  const id = String(projectId ?? '').trim()
  if (!id) return null
  const hit = projects.find((p) => p.id === id)
  return hit ? { id: hit.id, ...(hit.baseDir ? { baseDir: hit.baseDir } : {}) } : null
}

function filterScalaFilesForProject<T extends { relPath: string }>(
  files: readonly T[],
  project: { id: string; baseDir?: string } | null,
): T[] {
  if (!project) return [...files]
  const rawDir = normalizeProjectBaseDir(project)
  if (!rawDir || rawDir === '.') return [...files]
  const prefix = `${rawDir}/`
  return files.filter((f) => f.relPath === rawDir || f.relPath.startsWith(prefix))
}

async function loadScalaPackagesForExample(root: string, dir: string, projectId?: string) {
  const allFiles = listScalaSourcesIn(root, dir)
  const buildHit = sbtExamplesAll.find((e) => e.root === root && e.dir === dir)
  const projects = buildHit?.source ? parseBuildSbt(buildHit.source) : []
  const projectScope = projectScopeById(projects, projectId)
  const files = filterScalaFilesForProject(allFiles, projectScope)
  if (!files.length) {
    sourcePath.value = projectScope
      ? `${root}/${dir}/${normalizeProjectBaseDir(projectScope) || '.'}/`
      : `${root}/${dir}/`
    nodes.value = []
    edges.value = []
    yamlBaseline.value = yamlPreview.value
    status.value = projectScope
      ? `No .scala files found for sbt project ${projectScope.id} under ${root}/${dir}/.`
      : `No .scala files found under ${root}/${dir}/.`
    return
  }
  status.value = `Parsing ${files.length} Scala file${files.length === 1 ? '' : 's'} with tree-sitter…`
  try {
    const graph = await buildScalaPackageGraph(files)
    const sourceLabel = projectScope
      ? `${root}/${dir}/${normalizeProjectBaseDir(projectScope) || '.'}/`
      : `${root}/${dir}/`
    sourcePath.value = sourceLabel
    const log = getSbtTestLogFor(root, dir)
    const rep = getScoverageReportFor(root, dir)
    const parsedTestLog = log?.text ? parseSbtTestLog(log.text) : undefined
    const parsedCoverage = rep?.xml ? parseScoverageXml(rep.xml) : undefined
    const ilographDoc = scalaPackageGraphToIlographDocument(graph, {
      title: projectScope ? `Scala packages: ${dir}:${projectScope.id}` : `Scala packages: ${dir}`,
      sourcePath: sourceLabel,
    })
    const payload = buildScalaWorkspacePayload({
      sourcePath: sourceLabel,
      title: projectScope ? `Scala packages: ${dir}:${projectScope.id}` : `Scala packages: ${dir}`,
      graph,
      ilographDocument: ilographDoc,
      ...(parsedTestLog ? { parsedTestLog } : {}),
      ...(parsedCoverage ? { parsedCoverage } : {}),
    })
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
      for (const { id, doc } of payload.docs) {
        setScalaDoc(ws, id, doc)
      }
      for (const block of payload.testBlocks) {
        setScalaTestBlock(ws, block.id, {
          suite: block.suite,
          subject: block.subject,
          blockText: block.blockText,
        })
      }
      for (const entry of payload.specsByArtefact) {
        setScalaSpecs(ws, entry.id, entry.specs)
      }
      for (const entry of payload.coverage) {
        setScalaCoverage(ws, entry.id, entry.stmtPct)
      }
    }
    const yaml = stringifyIlographYaml(payload.ilographDocument ?? ilographDoc)
    await applyDoc(yaml, projectScope
      ? `${root}/${dir}/${projectScope.id}.packages.ilograph.yaml`
      : `${root}/${dir}/packages.ilograph.yaml`, false, {
      moduleNodeType: 'package',
    })
    status.value = projectScope
      ? `Parsed ${files.length} Scala file${files.length === 1 ? '' : 's'} for sbt project ${projectScope.id} → project-scoped package graph.`
      : `Parsed ${files.length} Scala file${files.length === 1 ? '' : 's'} → outer package group with sub-package nodes; package imports (wildcard and explicit) as LR edges.`
  } catch (err) {
    status.value = `Failed to parse Scala sources: ${(err as Error).message}`
  }
}

async function loadSbtBuildForRuntimeWorkspace(workspacePath: string, workspaceName: string) {
  status.value = `Loading sbt workspace from ${workspaceName} via Triton runtime…`
  try {
    const bundle = await fetchRuntimeWorkspaceBundle(workspacePath, workspaceName)
    if (!bundle.buildSbt?.source.trim()) {
      sourcePath.value = `${workspacePath}/`
      nodes.value = []
      edges.value = []
      yamlBaseline.value = yamlPreview.value
      status.value = `No build.sbt found under ${workspacePath}.`
      return
    }
    const projects = parseBuildSbt(bundle.buildSbt.source)
    const projectsWithScalaSources = computeProjectsWithScalaSourceFiles(bundle.scalaFiles, projects)
    const doc = sbtProjectsToIlographDocument(projects, {
      title: `sbt build: ${workspaceName}`,
      sourcePath: `${workspacePath}/build.sbt`,
      projectsWithScalaSources,
    })
    if (bundle.scalaFiles.length && bundle.coverageReport?.xml) {
      const graph = await buildScalaPackageGraph(bundle.scalaFiles.map((f) => ({
        root: '',
        exampleDir: '',
        relPath: f.relPath,
        source: f.source,
      })))
      const parsedCoverage = parseScoverageXml(bundle.coverageReport.xml)
      const payload = buildScalaWorkspacePayload({
        sourcePath: `${workspacePath}/build.sbt`,
        title: `sbt build: ${workspaceName}`,
        graph,
        ilographDocument: doc,
        parsedCoverage,
      })
      await whenOverlayStoreReady()
      const ws = activeWorkspaceKey.value
      if (ws) {
        clearScalaCoverageForWorkspace(ws)
        for (const entry of payload.coverage) setScalaCoverage(ws, entry.id, entry.stmtPct)
      }
    }
    sourcePath.value = `${workspacePath}/build.sbt`
    await applyDoc(stringifyIlographYaml(doc), `${workspaceName}.runtime.ilograph.yaml`, false)
    const linkable = projectsWithScalaSources.size
    status.value = `Loaded runtime sbt workspace \`${workspaceName}\` → ${projects.length} project(s)${
      linkable ? `, ${linkable} with Scala sources (click [packages] in subtitle to switch view)` : ''
    }.`
  } catch (err) {
    status.value = `Failed to load runtime sbt workspace: ${(err as Error).message}`
  }
}

async function loadScalaPackagesForRuntimeWorkspace(workspacePath: string, workspaceName: string, projectId?: string) {
  status.value = `Loading Scala workspace from ${workspaceName} via Triton runtime…`
  try {
    const bundle = await fetchRuntimeWorkspaceBundle(workspacePath, workspaceName)
    const projects = bundle.buildSbt?.source ? parseBuildSbt(bundle.buildSbt.source) : []
    const projectScope = projectScopeById(projects, projectId)
    const files = filterScalaFilesForProject(bundle.scalaFiles.map((f) => ({
      root: '',
      exampleDir: '',
      relPath: f.relPath,
      source: f.source,
    })), projectScope)
    if (!files.length) {
      sourcePath.value = projectScope
        ? `${workspacePath}/${normalizeProjectBaseDir(projectScope) || '.'}/`
        : `${workspacePath}/`
      nodes.value = []
      edges.value = []
      yamlBaseline.value = yamlPreview.value
      status.value = projectScope
        ? `No .scala files found for sbt project ${projectScope.id} under ${workspacePath}.`
        : `No .scala files found under ${workspacePath}.`
      return
    }
    status.value = `Parsing ${files.length} Scala file${files.length === 1 ? '' : 's'} from ${workspaceName}…`
    const graph = await buildScalaPackageGraph(files)
    const sourceLabel = projectScope
      ? `${workspacePath}/${normalizeProjectBaseDir(projectScope) || '.'}/`
      : `${workspacePath}/`
    sourcePath.value = sourceLabel
    const parsedTestLog = bundle.testLog?.text ? parseSbtTestLog(bundle.testLog.text) : undefined
    const parsedCoverage = bundle.coverageReport?.xml ? parseScoverageXml(bundle.coverageReport.xml) : undefined
    const ilographDoc = scalaPackageGraphToIlographDocument(graph, {
      title: projectScope ? `Scala packages: ${workspaceName}:${projectScope.id}` : `Scala packages: ${workspaceName}`,
      sourcePath: sourceLabel,
    })
    const payload = buildScalaWorkspacePayload({
      sourcePath: sourceLabel,
      title: projectScope ? `Scala packages: ${workspaceName}:${projectScope.id}` : `Scala packages: ${workspaceName}`,
      graph,
      ilographDocument: ilographDoc,
      ...(parsedTestLog ? { parsedTestLog } : {}),
      ...(parsedCoverage ? { parsedCoverage } : {}),
    })
    await whenOverlayStoreReady()
    const ws = activeWorkspaceKey.value
    if (ws) {
      clearScalaDocsForWorkspace(ws)
      clearScalaTestBlocksForWorkspace(ws)
      clearScalaCoverageForWorkspace(ws)
      clearScalaSpecsForWorkspace(ws)
      for (const { id, doc } of payload.docs) setScalaDoc(ws, id, doc)
      for (const block of payload.testBlocks) {
        setScalaTestBlock(ws, block.id, {
          suite: block.suite,
          subject: block.subject,
          blockText: block.blockText,
        })
      }
      for (const entry of payload.specsByArtefact) setScalaSpecs(ws, entry.id, entry.specs)
      for (const entry of payload.coverage) setScalaCoverage(ws, entry.id, entry.stmtPct)
    }
    const yaml = stringifyIlographYaml(payload.ilographDocument ?? ilographDoc)
    await applyDoc(yaml, projectScope
      ? `${workspaceName}.${projectScope.id}.packages.runtime.ilograph.yaml`
      : `${workspaceName}.packages.runtime.ilograph.yaml`, false, {
      moduleNodeType: 'package',
    })
    status.value = projectScope
      ? `Loaded ${files.length} Scala file${files.length === 1 ? '' : 's'} from runtime workspace ${workspaceName} for sbt project ${projectScope.id}.`
      : `Loaded ${files.length} Scala file${files.length === 1 ? '' : 's'} from runtime workspace ${workspaceName}.`
  } catch (err) {
    status.value = `Failed to load runtime Scala workspace: ${(err as Error).message}`
  }
}

async function runRuntimeWorkspaceAction(
  action: 'refresh' | 'sbt-test' | 'sbt-coverage',
  label: string,
): Promise<void> {
  const runtimeWs = activeRuntimeWorkspace.value
  if (!runtimeWs) {
    status.value = `Cannot ${label.toLowerCase()} — no runtime-backed workspace is active.`
    return
  }
  runtimeActionBusy.value = action
  status.value = `${label} for ${runtimeWs.workspaceName}…`
  try {
    const result = await postRuntimeWorkspaceAction(runtimeWs.workspacePath, action)
    if (!result.ok) {
      throw new Error(result.stderr || result.note || `${label} failed.`)
    }
    await reloadActiveRuntimeTab()
    status.value = result.note?.trim()
      ? `${label} completed — ${result.note.trim()}`
      : `${label} completed for ${runtimeWs.workspaceName}.`
  } catch (err) {
    status.value = `${label} failed: ${(err as Error).message}`
  } finally {
    runtimeActionBusy.value = ''
  }
}

/**
 * Internal `triton:` URL scheme used by markdown links inside project-box subtitles.
 * Examples: `triton:packages` or `triton://diagram/packages?project=App`
 * (open/activate the packages tab for the current example, optionally filtered to one sbt
 * project),
 * `triton:sbt` (open/activate the sbt build tab). Unknown links fall through to a normal
 * `window.open` so authors can also embed external docs links.
 */
function onNodeLinkAction(payload: { nodeId: string; href: string }) {
  const href = payload.href.trim()
  let tritonUrl: URL | null = null
  try {
    tritonUrl = href.startsWith('triton://') ? new URL(href) : null
  } catch {
    tritonUrl = null
  }
  const projectId = tritonUrl?.searchParams.get('project')?.trim() ?? ''
  if (href === 'triton:packages' || href === 'triton://diagram/packages' || tritonUrl?.pathname === '/packages') {
    const runtimeWs = activeRuntimeWorkspace.value
    if (runtimeWs) {
      void openRuntimePackagesTab(runtimeWs.workspacePath, runtimeWs.workspaceName, projectId || undefined)
      return
    }
    const ex = activeExample.value
    if (!ex) {
      status.value = 'Cannot open packages view — no sbt example loaded.'
      return
    }
    void openScalaPackagesTab(ex.root, ex.dir, projectId || undefined)
    return
  }
  if (href === 'triton:sbt' || href === 'triton://diagram/sbt') {
    const runtimeWs = activeRuntimeWorkspace.value
    if (runtimeWs) {
      void openRuntimeSbtTab(runtimeWs.workspacePath, runtimeWs.workspaceName)
      return
    }
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

const activeDojoId = computed(() => {
  const key = activeTab.value?.key ?? ''
  return key.startsWith('dojo:') ? key.slice('dojo:'.length) : ''
})

const showDojoPanel = computed(
  () =>
    activeDojoId.value === PACKAGE_NESTING_DOJO_ID ||
    activeDojoId.value === PACKAGE_STACKING_DOJO_ID ||
    activeDojoId.value === PACKAGE_IMPORT_CHAIN_DOJO_ID,
)

watch(activeTabId, () => {
  if (activeDojoId.value === PACKAGE_NESTING_DOJO_ID) {
    dojoNestingDepth.value = clampDojoDepth(activeTab.value?.dojoDepth ?? dojoNestingDepth.value)
  }
  if (activeDojoId.value === PACKAGE_STACKING_DOJO_ID) {
    dojoStackCount.value = clampDojoStackCount(activeTab.value?.dojoDepth ?? dojoStackCount.value)
  }
  if (activeDojoId.value === PACKAGE_IMPORT_CHAIN_DOJO_ID) {
    dojoImportChainLength.value = clampDojoStackCount(activeTab.value?.dojoDepth ?? dojoImportChainLength.value)
  }
})

watch(dojoNestingDepth, (depth, prev) => {
  const normalized = clampDojoDepth(depth)
  if (normalized !== depth) {
    dojoNestingDepth.value = normalized
    return
  }
  if (normalized === prev) return
  if (activeDojoId.value !== PACKAGE_NESTING_DOJO_ID) return
  void loadPackageNestingDojo(normalized).then(() => {
    snapshotActiveTab()
    syncUrlFromState()
  })
})

watch(dojoStackCount, (count, prev) => {
  const normalized = clampDojoStackCount(count)
  if (normalized !== count) {
    dojoStackCount.value = normalized
    return
  }
  if (normalized === prev) return
  if (activeDojoId.value !== PACKAGE_STACKING_DOJO_ID) return
  void loadPackageStackingDojo(normalized, prev).then(() => {
    snapshotActiveTab()
    syncUrlFromState()
  })
})

watch(dojoImportChainLength, (len, prev) => {
  const normalized = clampDojoStackCount(len)
  if (normalized !== len) {
    dojoImportChainLength.value = normalized
    return
  }
  if (normalized === prev) return
  if (activeDojoId.value !== PACKAGE_IMPORT_CHAIN_DOJO_ID) return
  void loadPackageImportChainDojo(normalized, prev).then(() => {
    snapshotActiveTab()
    syncUrlFromState()
  })
})

watch([activeTabId, perspectiveName], () => {
  syncUrlFromState()
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
  if (ideSession.value) {
    const workspaceLabel = ideSession.value.workspaceName ? ` (${ideSession.value.workspaceName})` : ''
    status.value = `Connected to ${ideSession.value.ideName}${workspaceLabel} for open-in-editor links.`
  }
  if (requestedTabKey) {
    void openTabFromUrlKey(requestedTabKey)
    return
  }
  const runtimeSession = runtimeWorkspaceSession.value
  if (runtimeSession) {
    void openRuntimeSbtTab(runtimeSession.workspacePath, runtimeSession.workspaceName)
    return
  }
  if (requestedDojo) {
    void openDojoTab(requestedDojo)
    return
  }
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
      <div v-if="ideSession" class="ide-session-chip" :title="ideSession.ideOpenUrl">
        <span class="ide-session-chip__label">Connected to {{ ideSession.ideName }}</span>
        <span v-if="ideSession.workspaceName" class="ide-session-chip__meta">{{ ideSession.workspaceName }}</span>
      </div>
      <div v-if="activeRuntimeWorkspace" class="runtime-actions">
        <button
          type="button"
          class="btn"
          :disabled="!!runtimeActionBusy"
          @click="void runRuntimeWorkspaceAction('refresh', 'Refreshing workspace')"
        >
          {{ runtimeActionBusy === 'refresh' ? 'Refreshing…' : 'Refresh' }}
        </button>
        <button
          type="button"
          class="btn"
          :disabled="!!runtimeActionBusy"
          @click="void runRuntimeWorkspaceAction('sbt-test', 'Running sbt test')"
        >
          {{ runtimeActionBusy === 'sbt-test' ? 'Running tests…' : 'Run sbt test' }}
        </button>
        <button
          type="button"
          class="btn"
          :disabled="!!runtimeActionBusy"
          @click="void runRuntimeWorkspaceAction('sbt-coverage', 'Running coverage')"
        >
          {{ runtimeActionBusy === 'sbt-coverage' ? 'Running coverage…' : 'Run coverage' }}
        </button>
      </div>
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
          <template v-if="dojoExamples.length">
            <div class="menu-sep" role="separator" />
            <div class="menu-heading" role="presentation">Dojo</div>
            <button
              v-for="dojo in dojoExamples"
              :key="dojo.id"
              type="button"
              class="menu-item"
              role="menuitem"
              :class="{ 'menu-item--active': activeTab?.key === `dojo:${dojo.id}` }"
              @click="selectExample(`dojo:${dojo.id}`)"
            >
              {{ dojo.title }}
            </button>
          </template>
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
        <DiagramTopBar
          :source-path="sourcePath"
          :source-path-logo-url="sourcePathLogoUrl"
          :relation-types="relationTypesList"
          :relation-type-visibility="relationTypeVisibility"
          :metric-tooltips-enabled="metricTooltipsEnabled"
          :metric-visibility="metricVisibility"
          @update:relation-type-visible="setRelationTypeVisible"
          @update:metric-tooltips-enabled="(v) => (metricTooltipsEnabled = v)"
          @update:metric-visible="
            (metricKey, visible) => (metricVisibility = { ...metricVisibility, [metricKey]: visible })
          "
        />
        <div
          v-if="ideSession"
          class="ide-session-overlay"
          :title="ideSession.activeFile ? `${ideSession.ideName} active file: ${ideSession.activeFile}` : `Opened from ${ideSession.ideName}`"
        >
          <span class="ide-session-overlay__title">IDE link active</span>
          <span class="ide-session-overlay__meta">
            {{ ideSession.ideName }}<template v-if="ideSession.activeFile"> · {{ ideSession.activeFile }}</template>
          </span>
        </div>
        <div v-if="runtimeEmptyStateMessage" class="runtime-empty-state" role="status" aria-live="polite">
          <div class="runtime-empty-state__title">Runtime Workspace Not Loaded</div>
          <div class="runtime-empty-state__body">{{ runtimeEmptyStateMessage }}</div>
          <div class="runtime-empty-state__hint">
            Check that `triton-runtime` is running for this workspace, then use `Refresh`.
          </div>
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
          <button
            v-if="showDojoPanel"
            type="button"
            class="side-tab"
            role="tab"
            :class="{ 'side-tab--active': sidePanelTab === 'dojo' }"
            :aria-selected="sidePanelTab === 'dojo'"
            @click="sidePanelTab = 'dojo'"
          >
            Dojo
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
          <div
            v-if="showDojoPanel"
            v-show="sidePanelTab === 'dojo'"
            class="side-panel-pane side-panel-pane--dojo"
            role="tabpanel"
          >
            <div v-if="activeDojoId === PACKAGE_NESTING_DOJO_ID" class="dojo-panel">
              <div class="dojo-panel__header">
                <div class="dojo-panel__title">Package Nesting</div>
                <div class="dojo-panel__meta">Depth {{ dojoNestingDepth }}</div>
              </div>
              <p class="dojo-panel__hint">
                Increase the nesting depth to inspect how package-scope containers resize and how much readable space remains at each level.
              </p>
              <label class="dojo-panel__control" for="dojo-package-depth">
                <span class="dojo-panel__label">Nesting depth</span>
                <input
                  id="dojo-package-depth"
                  v-model.number="dojoNestingDepth"
                  class="dojo-panel__slider"
                  type="range"
                  min="1"
                  max="20"
                  step="1"
                  aria-label="Package nesting depth"
                />
              </label>
              <div class="dojo-panel__scale">
                <span>1</span>
                <span>20</span>
              </div>
            </div>
            <div v-else-if="activeDojoId === PACKAGE_STACKING_DOJO_ID" class="dojo-panel">
              <div class="dojo-panel__header">
                <div class="dojo-panel__title">Package Stacking</div>
                <div class="dojo-panel__meta">Count {{ dojoStackCount }}</div>
              </div>
              <p class="dojo-panel__hint">
                Increase the package count to inspect how independent package-scope containers stack and reflow without nesting.
              </p>
              <label class="dojo-panel__control" for="dojo-package-stack-count">
                <span class="dojo-panel__label">Package count</span>
                <input
                  id="dojo-package-stack-count"
                  v-model.number="dojoStackCount"
                  class="dojo-panel__slider"
                  type="range"
                  min="1"
                  max="40"
                  step="1"
                  aria-label="Package stacking count"
                />
              </label>
              <div class="dojo-panel__scale">
                <span>1</span>
                <span>40</span>
              </div>
            </div>
            <div v-else-if="activeDojoId === PACKAGE_IMPORT_CHAIN_DOJO_ID" class="dojo-panel">
              <div class="dojo-panel__header">
                <div class="dojo-panel__title">Package import chain</div>
                <div class="dojo-panel__meta">Chain length {{ dojoImportChainLength }}</div>
              </div>
              <p class="dojo-panel__hint">
                Each step adds one package and one <code>imports</code> link so the chain grows as a linear Scala package import path (left → right).
              </p>
              <label class="dojo-panel__control" for="dojo-package-import-chain">
                <span class="dojo-panel__label">Chain length</span>
                <input
                  id="dojo-package-import-chain"
                  v-model.number="dojoImportChainLength"
                  class="dojo-panel__slider"
                  type="range"
                  min="1"
                  max="40"
                  step="1"
                  aria-label="Package import chain length"
                />
              </label>
              <div class="dojo-panel__scale">
                <span>1</span>
                <span>40</span>
              </div>
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
.ide-session-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border: 1px solid #bfdbfe;
  border-radius: 999px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 12px;
  line-height: 1;
}
.ide-session-chip__label {
  font-weight: 700;
}
.ide-session-chip__meta {
  color: #475569;
}
.runtime-actions {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-left: auto;
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
.btn:disabled {
  cursor: wait;
  opacity: 0.7;
  background: #f8fafc;
}
.runtime-empty-state {
  position: absolute;
  inset: 84px auto auto 50%;
  transform: translateX(-50%);
  z-index: 12;
  width: min(640px, calc(100% - 48px));
  padding: 16px 18px;
  border: 1px solid #fbcfe8;
  border-radius: 16px;
  background: rgba(255, 247, 250, 0.96);
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.12);
  color: #831843;
  backdrop-filter: blur(10px);
}
.runtime-empty-state__title {
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.01em;
}
.runtime-empty-state__body {
  margin-top: 6px;
  font-size: 13px;
  line-height: 1.5;
}
.runtime-empty-state__hint {
  margin-top: 8px;
  font-size: 12px;
  color: #9d174d;
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
.ide-session-overlay {
  position: absolute;
  top: 38px;
  left: 12px;
  z-index: 10;
  pointer-events: none;
  display: inline-flex;
  flex-direction: column;
  gap: 1px;
  max-width: calc(100% - 24px);
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid rgba(59, 130, 246, 0.2);
  background: rgba(239, 246, 255, 0.92);
  color: #1d4ed8;
}
.ide-session-overlay__title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.ide-session-overlay__meta {
  font-size: 11px;
  color: #475569;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
.side-panel-pane--dojo {
  flex: 0 1 auto;
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
.dojo-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border: 1px solid #dbe4f0;
  border-radius: 12px;
  background: linear-gradient(180deg, #f8fbff 0%, #eef6ff 100%);
}
.dojo-panel__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.dojo-panel__title {
  font-size: 14px;
  font-weight: 800;
  color: #0f172a;
}
.dojo-panel__meta {
  font-size: 12px;
  font-weight: 700;
  color: #1d4ed8;
}
.dojo-panel__hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: #475569;
}
.dojo-panel__control {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dojo-panel__label {
  font-size: 12px;
  font-weight: 700;
  color: #334155;
}
.dojo-panel__slider {
  width: 100%;
}
.dojo-panel__scale {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #64748b;
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
