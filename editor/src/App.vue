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
import { listTsExamples } from './ts/tsExampleDiagrams'
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
import {
  COMPACT_LAYOUT_MAX_WIDTH_PX,
  COMPACT_LAYOUT_MAX_HEIGHT_PX,
  COMPACT_LAYOUT_MIN_HEIGHT_PX,
  COMPACT_LAYOUT_MIN_WIDTH_PX,
  DEFAULT_LAYOUT_MIN_HEIGHT_PX,
  DEFAULT_LAYOUT_MIN_WIDTH_PX,
  DIAGRAM_LEAF_MIN_HEIGHT_PX,
  DIAGRAM_LEAF_MIN_WIDTH_PX,
  FLAT_LAYOUT_MAX_H_PX,
  FLAT_LAYOUT_MIN_WIDTH_PX,
  SLIM_LAYOUT_MIN_WIDTH_PX,
  SUPERFLAT_LAYOUT_MAX_H_PX,
  SUPERSLIM_LAYOUT_ENTER_PX,
  TIGHT_LAYOUT_MAX_WIDTH_PX,
  TIGHT_LAYOUT_MIN_WIDTH_PX,
} from './components/diagram/boxChromeLayout'
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
/** Checked node kinds are visible (`false` means hidden). Synced from current artefact kinds. */
const nodeTypeVisibility = ref<Record<string, boolean>>({})
/** Checked relation types are visible (`false` means hidden). Synced from current edges’ labels. */
const relationTypeVisibility = ref<Record<string, boolean>>({})
const metricTooltipsEnabled = ref(false)
const focusRelationDepth = ref(1)
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

function normalizeNodeTypeKey(kind: unknown): string {
  const s = String(kind ?? '').trim().toLowerCase()
  return s.length ? s : '(unknown)'
}

function collectNodeTypeKeys(nodeList: readonly any[]): string[] {
  const out = new Set<string>()
  for (const node of nodeList) {
    const data = node?.data as Record<string, unknown> | undefined
    if (String(node?.type ?? '') === 'artefact') out.add(normalizeNodeTypeKey(data?.subtitle))
    const raw = data?.innerArtefacts
    if (!Array.isArray(raw)) continue
    for (const artefact of raw) {
      out.add(normalizeNodeTypeKey((artefact as Record<string, unknown> | undefined)?.subtitle))
    }
  }
  return [...out]
}

function visibleInnerArtefactsForPreferredSize(
  data: Record<string, unknown>,
): readonly Record<string, unknown>[] {
  const raw = data.innerArtefacts
  if (!Array.isArray(raw)) return []
  const visibility = nodeTypeVisibility.value
  return raw.filter((artefact) => {
    const key = normalizeNodeTypeKey((artefact as Record<string, unknown> | undefined)?.subtitle)
    return visibility[key] !== false
  }) as readonly Record<string, unknown>[]
}

function preferredFocusWidthForVisibleInnerContent(data: Record<string, unknown>): number | undefined {
  const innerArtefactCount = visibleInnerArtefactsForPreferredSize(data).length
  const innerPackageCount = Array.isArray(data.innerPackages) ? data.innerPackages.length : 0
  if (!innerArtefactCount && !innerPackageCount) return undefined
  return Math.min(
    6400,
    Math.max(
      innerArtefactCount ? Math.max(720, innerArtefactCount * 170) : 0,
      innerPackageCount ? Math.max(760, innerPackageCount * 220) : 0,
    ),
  )
}

function applyNodeTypeVisibilityToNodes(nodeList: readonly any[]): any[] {
  return nodeList.map((node) => {
    const data = { ...((node?.data ?? {}) as Record<string, unknown>) }
    let changed = false
    const kindKey = normalizeNodeTypeKey(data.subtitle)
    const nodeKindHidden = String(node?.type ?? '') === 'artefact' && nodeTypeVisibility.value[kindKey] === false
    const hidden = nodeKindHidden || Boolean((node as { hidden?: boolean }).hidden && data.__nodeKindHidden !== true)

    if (String(node?.type ?? '') === 'package') {
      const nextPreferredFocusWidth = preferredFocusWidthForVisibleInnerContent(data)
      if (typeof nextPreferredFocusWidth === 'number') {
        if (data.preferredFocusWidth !== nextPreferredFocusWidth) {
          data.preferredFocusWidth = nextPreferredFocusWidth
          changed = true
        }
      } else if (data.preferredFocusWidth !== undefined) {
        delete data.preferredFocusWidth
        changed = true
      }
    }

    if ((node as { hidden?: boolean }).hidden !== hidden || data.__nodeKindHidden !== nodeKindHidden) {
      changed = true
      if (nodeKindHidden) data.__nodeKindHidden = true
      else delete data.__nodeKindHidden
    }

    return changed ? { ...node, hidden, data } : node
  })
}

const nodeTypesMenuSig = computed(() => collectNodeTypeKeys(nodes.value).sort().join('\n'))

watch(nodeTypesMenuSig, (sig) => {
  const keys = sig.length ? sig.split('\n') : []
  const prev = nodeTypeVisibility.value
  const next: Record<string, boolean> = {}
  for (const k of keys) {
    next[k] = prev[k] !== false
  }
  nodeTypeVisibility.value = next
  nodes.value = applyNodeTypeVisibilityToNodes(nodes.value)
})

const nodeTypesList = computed(() => (nodeTypesMenuSig.value.length ? nodeTypesMenuSig.value.split('\n') : []))

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

function setNodeTypeVisible(nodeKey: string, visible: boolean) {
  nodeTypeVisibility.value = { ...nodeTypeVisibility.value, [nodeKey]: visible }
  nodes.value = applyNodeTypeVisibilityToNodes(nodes.value)
  edges.value = mergeEdgesWithVisibility(edges.value)
  void nextTick(async () => {
    graphRef.value?.refreshEdgeEmphasis?.()
    await graphRef.value?.relayoutViewport?.()
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
const PACKAGE_TREE_DOJO_ID = 'package-tree'
const ARTEFACT_HIERARCHY_DOJO_ID = 'artefact-hierarchy'
const ABSTRACTION_LAYERS_DOJO_ID = 'abstraction-layers'
const BREAKPOINT_LAYOUTS_DOJO_ID = 'breakpoint-layouts'

const ABSTRACTION_RESIZE_NODE_IDS: readonly string[] = [
  'abstraction-general',
  'abstraction-project',
  'abstraction-module',
  'abstraction-package',
  'abstraction-artefact',
]

type BreakpointDojoKind = 'general' | 'project' | 'module' | 'package' | 'artefact'
type BreakpointDojoBand = 'min' | 'max'

type BreakpointLayoutSpec = {
  state: string
  title: string
  kinds: readonly BreakpointDojoKind[]
  sizes: Record<BreakpointDojoBand, { w: number; h: number }>
}

type BreakpointLayoutSample = BreakpointLayoutSpec & {
  kind: BreakpointDojoKind
  band: BreakpointDojoBand
  id: string
}

const BREAKPOINT_LAYOUT_KIND_LABELS: Record<BreakpointDojoKind, string> = {
  general: 'General box',
  project: 'Project',
  module: 'Module',
  package: 'Package',
  artefact: 'Scala artefact',
}

const BREAKPOINT_LAYOUT_SPECS: readonly BreakpointLayoutSpec[] = [
  {
    state: 'default',
    title: 'default layout state',
    kinds: ['general', 'project', 'module', 'package', 'artefact'],
    sizes: { min: { w: DEFAULT_LAYOUT_MIN_WIDTH_PX, h: DEFAULT_LAYOUT_MIN_HEIGHT_PX }, max: { w: 420, h: 220 } },
  },
  {
    state: 'compact-layout',
    title: 'compact-layout',
    kinds: ['general', 'project', 'module', 'package', 'artefact'],
    sizes: {
      min: { w: COMPACT_LAYOUT_MIN_WIDTH_PX, h: COMPACT_LAYOUT_MIN_HEIGHT_PX },
      max: { w: COMPACT_LAYOUT_MAX_WIDTH_PX, h: COMPACT_LAYOUT_MAX_HEIGHT_PX },
    },
  },
  {
    state: 'flat-layout',
    title: 'flat-layout',
    kinds: ['general', 'project', 'module', 'package', 'artefact'],
    sizes: { min: { w: FLAT_LAYOUT_MIN_WIDTH_PX, h: SUPERFLAT_LAYOUT_MAX_H_PX + 1 }, max: { w: 520, h: FLAT_LAYOUT_MAX_H_PX } },
  },
  {
    state: 'superflat-layout',
    title: 'superflat-layout',
    kinds: ['general', 'project', 'module', 'package', 'artefact'],
    sizes: { min: { w: FLAT_LAYOUT_MIN_WIDTH_PX, h: DIAGRAM_LEAF_MIN_HEIGHT_PX }, max: { w: 520, h: SUPERFLAT_LAYOUT_MAX_H_PX } },
  },
  {
    state: 'tight',
    title: 'tight layout state',
    kinds: ['general', 'project', 'module', 'package', 'artefact'],
    sizes: { min: { w: TIGHT_LAYOUT_MIN_WIDTH_PX, h: COMPACT_LAYOUT_MIN_HEIGHT_PX }, max: { w: TIGHT_LAYOUT_MAX_WIDTH_PX, h: 220 } },
  },
  {
    state: 'slim-layout',
    title: 'slim-layout',
    kinds: ['general', 'project', 'module', 'package', 'artefact'],
    sizes: { min: { w: SLIM_LAYOUT_MIN_WIDTH_PX, h: 206 }, max: { w: 240, h: 284 } },
  },
  {
    state: 'superslim-layout',
    title: 'superslim-layout',
    kinds: ['general', 'project', 'module', 'package', 'artefact'],
    sizes: { min: { w: DIAGRAM_LEAF_MIN_WIDTH_PX, h: 140 }, max: { w: SUPERSLIM_LAYOUT_ENTER_PX, h: 204 } },
  },
]

function breakpointLayoutNodeId(state: string, kind: BreakpointDojoKind, band: BreakpointDojoBand): string {
  return `breakpoint-${state}-${kind}-${band}`.replace(/[^a-zA-Z0-9_-]+/g, '-')
}

function buildBreakpointLayoutSamples(): BreakpointLayoutSample[] {
  return BREAKPOINT_LAYOUT_SPECS.flatMap((spec) =>
    spec.kinds.map((kind) => ({
      ...spec,
      kind,
      band: 'min' as const,
      id: breakpointLayoutNodeId(spec.state, kind, 'min'),
    })),
  )
}

const BREAKPOINT_LAYOUT_RESIZE_NODE_IDS: readonly string[] = buildBreakpointLayoutSamples().map((sample) => sample.id)

function pascalFromLayoutState(state: string): string {
  return state
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('')
}

function clampDojoDepth(raw: number): number {
  if (!Number.isFinite(raw)) return 4
  return Math.min(20, Math.max(1, Math.round(raw)))
}

function clampDojoStackCount(raw: number): number {
  if (!Number.isFinite(raw)) return 8
  return Math.min(40, Math.max(1, Math.round(raw)))
}

function clampDojoTreeCount(raw: number): number {
  if (!Number.isFinite(raw)) return 8
  return Math.min(128, Math.max(1, Math.round(raw)))
}

function clampDojoArtefactLayers(raw: number): number {
  if (!Number.isFinite(raw)) return 2
  return Math.min(5, Math.max(1, Math.round(raw)))
}

function clampDojoArtefactWidth(raw: number): number {
  if (!Number.isFinite(raw)) return 1
  return Math.min(20, Math.max(1, Math.round(raw)))
}

const dojoNestingDepth = ref(clampDojoDepth(initialRequestedDojoDepth))
const dojoStackCount = ref(clampDojoStackCount(initialRequestedDojoDepth))
const dojoImportChainLength = ref(clampDojoStackCount(initialRequestedDojoDepth))
const dojoTreeCount = ref(clampDojoTreeCount(initialRequestedDojoDepth))
const dojoArtefactLayers = ref(clampDojoArtefactLayers(initialRequestedDojoDepth))
const dojoArtefactWidth = ref(1)
/** Abstraction dojo: when true, resizing any one box applies the new size to every demo node. */
const dojoAbstractionLinkedResize = ref(false)

/** All bundled examples (`build.sbt` files) across every registered examples-root. */
const sbtExamplesAll = listSbtExamples()
const tsExamplesAll = listTsExamples()

/** Tutorial-style bundled examples: 01–12 numbered prefixes (the `sbt-examples` tutorial set). */
function isTutorialSbtFolder(dir: string): boolean {
  return /^0[1-9]-/.test(dir) || /^1[0-2]-/.test(dir)
}

/** Stable id for the dropdown option that targets one bundled `build.sbt`. */
function exampleSelectionId(root: string, dir: string): string {
  return `sbt:${root}/${dir}`
}

function tsExampleSelectionId(root: string, dir: string, file: string): string {
  return `ts:${root}/${dir}/${file}`
}

function tsPackagesTabKey(root: string, dir: string, file: string, moduleId: string): string {
  return `ts-packages:${root}/${dir}/${file}#${encodeURIComponent(moduleId)}`
}

function parseTsExampleTabBody(body: string): { root: string; dir: string; file: string; moduleId?: string } | null {
  const hash = body.indexOf('#')
  const main = hash >= 0 ? body.slice(0, hash) : body
  const moduleId = hash >= 0 ? decodeURIComponent(body.slice(hash + 1)) : ''
  const parts = main.split('/').filter(Boolean)
  if (parts.length < 3) return null
  const [root, dir, ...rest] = parts
  return {
    root: root!,
    dir: dir!,
    file: rest.join('/'),
    ...(moduleId ? { moduleId } : {}),
  }
}

const sbtExamplesTutorial = sbtExamplesAll.filter(
  (e) => e.root === 'sbt-examples' && isTutorialSbtFolder(e.dir),
)
const sbtExamplesLargeOss = sbtExamplesAll.filter(
  (e) => e.root === 'sbt-examples' && !isTutorialSbtFolder(e.dir),
)
const scalaExamples = sbtExamplesAll.filter((e) => e.root === 'scala-examples')
const tsExamples = tsExamplesAll.filter((e) => e.root === 'ts-examples')
const dojoExamples = computed(() => [
  { id: PACKAGE_NESTING_DOJO_ID, title: 'Package nesting' },
  { id: PACKAGE_STACKING_DOJO_ID, title: 'Package stacking' },
  { id: PACKAGE_IMPORT_CHAIN_DOJO_ID, title: 'Package import chain' },
  { id: PACKAGE_TREE_DOJO_ID, title: 'Package tree' },
  { id: ARTEFACT_HIERARCHY_DOJO_ID, title: 'Artefact hierarchy' },
  { id: ABSTRACTION_LAYERS_DOJO_ID, title: 'Abstraction layers' },
  { id: BREAKPOINT_LAYOUTS_DOJO_ID, title: 'Breakpoint layouts' },
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
  if (k.startsWith('ts:')) return k
  if (k.startsWith('ts-packages:')) {
    const parsed = parseTsExampleTabBody(k.slice('ts-packages:'.length))
    return parsed ? tsExampleSelectionId(parsed.root, parsed.dir, parsed.file) : ''
  }
  return ''
})

/** `(root, dir)` of the example backing the active tab; `null` for builtin / file uploads. */
const activeExample = computed<{ root: string; dir: string } | null>(() => {
  const k = activeTab.value?.key ?? ''
  if (k.startsWith('runtime-sbt:') || k.startsWith('runtime-packages:')) {
    return { root: '', dir: '' }
  }
  let body = ''
  if (k.startsWith('sbt:')) {
    body = k.slice('sbt:'.length)
    const slash = body.indexOf('/')
    if (slash < 0) return null
    return { root: body.slice(0, slash), dir: body.slice(slash + 1) }
  }
  if (k.startsWith('packages:')) {
    body = stripExampleProjectSuffix(k.slice('packages:'.length))
    const slash = body.indexOf('/')
    if (slash < 0) return null
    return { root: body.slice(0, slash), dir: body.slice(slash + 1) }
  }
  if (k.startsWith('ts:') || k.startsWith('ts-packages:')) {
    // TS tabs include the file name: `ts:<root>/<exampleDir>/<file>`. For open-in-editor we
    // need only `(root, exampleDir)`.
    const parsed = parseTsExampleTabBody(k.slice(k.startsWith('ts:') ? 'ts:'.length : 'ts-packages:'.length))
    return parsed ? { root: parsed.root, dir: parsed.dir } : null
  }
  return null
})

/**
 * Downstream consumers (e.g. the open-in-editor click handler on Scala artefact boxes) need
 * the active tab's `(root, exampleDir)` pair so they can combine it with a node's stored
 * `sourceFile` relPath to build an absolute disk path. Provided reactively so tab switches
 * (packages tab → sbt tab → packages tab) are picked up without component re-creation.
 */
provide('tritonActiveExample', activeExample)
provide('tritonNodeTypeVisibility', nodeTypeVisibility)
provide('tritonRelationTypeVisibility', relationTypeVisibility)
provide('tritonMetricTooltipsEnabled', metricTooltipsEnabled)
provide('tritonFocusRelationDepth', focusRelationDepth)
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
    // Skip layout while a drill click is pending or active — the drill owns both layout geometry
    // and camera; running layoutDepthInViewport here would overwrite drill positions, and
    // fitToViewport would snap singleton-scope diagrams (animal-fruit) to {x:0,y:0}.
    if (graphRef.value?.layerDrillBusy?.()) return
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
  options: { moduleNodeType?: 'module' | 'package'; initialLayerDrillId?: string } = {},
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
  const initialLayerDrillId = options.initialLayerDrillId?.trim()
  if (initialLayerDrillId) {
    await nextTick()
    const applied = await graphRef.value?.applyLayerDrill?.(initialLayerDrillId)
    if (!applied) {
      await graphRef.value?.fitToViewport?.({ duration: 0 })
    }
  } else {
    await graphRef.value?.fitToViewport?.({
      duration: 0,
    })
  }
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
    return
  }
  if (id.startsWith('ts:')) {
    const body = id.slice('ts:'.length)
    const parts = body.split('/')
    if (parts.length < 3) return
    const [root, dir, ...rest] = parts
    const file = rest.join('/')
    await openTsExampleTab(root, dir, file)
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

function buildAbstractionDojoDocument(): IlographDocument {
  const W = 248
  const H = 116
  /** Vertical gap between stacked rows — generous so resize handles are easy to grab. */
  const ROW_GAP = 52
  /** Horizontal gap between the two columns. */
  const COL_GAP = 88
  const LEFT = 56
  const TOP = 56
  const COL2 = LEFT + W + COL_GAP
  const gridMidX = LEFT + (2 * W + COL_GAP) / 2
  const artefactX = Math.round(gridMidX - W / 2)
  const positions: NonNullable<NonNullable<IlographDocument['x-triton-editor']>['positions']> = {
    'abstraction-general': { x: LEFT, y: TOP },
    'abstraction-project': { x: COL2, y: TOP },
    'abstraction-module': { x: LEFT, y: TOP + H + ROW_GAP },
    'abstraction-package': { x: COL2, y: TOP + H + ROW_GAP },
    'abstraction-artefact': { x: artefactX, y: TOP + 2 * (H + ROW_GAP) },
  }
  const sizes: NonNullable<NonNullable<IlographDocument['x-triton-editor']>['sizes']> = {
    'abstraction-general': { w: W, h: H },
    'abstraction-project': { w: W, h: H },
    'abstraction-module': { w: W, h: H },
    'abstraction-package': { w: W, h: H },
    'abstraction-artefact': { w: W, h: H },
  }
  return {
    description:
      'Dojo comparing Triton leaf chrome across abstraction layers (generic box, project, module, package, Scala artefact). Drag resize handles; toggle linked mode so one resize updates every box.',
    'x-triton-editor': { positions, sizes },
    resources: [
      {
        id: 'abstraction-general',
        name: 'General box',
        subtitle: 'Neutral leaf shell (`x-triton-project-kind: general`)',
        'x-triton-project-kind': 'general',
        'x-triton-layout-frozen': true,
      },
      {
        id: 'abstraction-project',
        name: 'Acme build',
        subtitle: 'Root aggregate (`x-triton-project-kind: project`)',
        'x-triton-project-kind': 'project',
        'x-triton-layout-frozen': true,
        'x-triton-project-compartments': [
          {
            id: 'scala',
            title: 'Scala',
            rows: [{ label: 'binary', value: '3.8.3' }],
          },
        ],
      },
      {
        id: 'abstraction-module',
        name: 'ingestion',
        subtitle: 'JVM module boundary (`x-triton-project-kind: module`)',
        'x-triton-project-kind': 'module',
        'x-triton-layout-frozen': true,
      },
      {
        id: 'abstraction-package',
        name: 'com.acme.core',
        subtitle: 'Scala package container (`x-triton-node-type: package`)',
        'x-triton-node-type': 'package',
        'x-triton-package-language': 'scala',
        'x-triton-layout-frozen': true,
        description: 'Holds domain model sources and public facades.',
      },
      {
        id: 'abstraction-artefact',
        name: 'TelemetryRouter',
        subtitle: 'Scala class',
        'x-triton-node-type': 'artefact',
        'x-triton-declaration': 'final class TelemetryRouter(config: RouterConfig)(using Telemetry)',
        'x-triton-method-signatures': [
          { signature: 'def route(batch: Batch): RoutePlan', startRow: 1 },
          { signature: 'def shutdown(): Unit', startRow: 2 },
        ],
        'x-triton-source-file': 'TelemetryRouter.scala',
        'x-triton-source-row': 4,
        'x-triton-layout-frozen': true,
      },
    ],
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

function buildBreakpointLayoutsDojoDocument(): IlographDocument {
  const samples = buildBreakpointLayoutSamples()
  const LEFT = 56
  const TOP = 56
  const COLUMN_GAP = 72
  const LAYOUT_ROW_GAP = 48
  const positions: NonNullable<NonNullable<IlographDocument['x-triton-editor']>['positions']> = {}
  const sizes: NonNullable<NonNullable<IlographDocument['x-triton-editor']>['sizes']> = {}
  const kinds = Object.keys(BREAKPOINT_LAYOUT_KIND_LABELS) as BreakpointDojoKind[]
  const columnWidths = new Map<BreakpointDojoKind, number>()
  const columnLefts = new Map<BreakpointDojoKind, number>()
  const rowTops = new Map<string, number>()

  for (const kind of kinds) {
    const maxWidth = Math.max(
      ...samples
        .filter((sample) => sample.kind === kind)
        .map((sample) => sample.sizes[sample.band].w),
    )
    columnWidths.set(kind, maxWidth)
  }

  let nextColumnLeft = LEFT
  for (const kind of kinds) {
    columnLefts.set(kind, nextColumnLeft)
    nextColumnLeft += (columnWidths.get(kind) ?? 0) + COLUMN_GAP
  }

  let nextRowTop = TOP
  for (const spec of BREAKPOINT_LAYOUT_SPECS) {
    rowTops.set(spec.state, nextRowTop)
    nextRowTop += spec.sizes.min.h + LAYOUT_ROW_GAP
  }

  function samplePosition(sample: BreakpointLayoutSample): { x: number; y: number } {
    const cellLeft = columnLefts.get(sample.kind) ?? LEFT
    const rowTop = rowTops.get(sample.state) ?? TOP
    return {
      x: cellLeft,
      y: rowTop,
    }
  }

  const resources = samples.map((sample) => {
    const pos = samplePosition(sample)
    const size = sample.sizes[sample.band]
    positions[sample.id] = pos
    sizes[sample.id] = size
    const kindLabel = BREAKPOINT_LAYOUT_KIND_LABELS[sample.kind]
    const subtitle = `${kindLabel} · minimum ${size.w}×${size.h}`
    const base = {
      id: sample.id,
      name: sample.title,
      subtitle,
      description: `${kindLabel} sample for the ${sample.state} layout state at the minimal representative size.`,
      'x-triton-layout-frozen': true,
    }
    if (sample.kind === 'package') {
      return {
        ...base,
        'x-triton-node-type': 'package',
        'x-triton-package-language': 'scala',
        'x-triton-inner-packages': [
          { id: `${sample.id}::api`, name: 'api', subtitle: 'inner package' },
        ],
      }
    }
    if (sample.kind === 'artefact') {
      return {
        ...base,
        'x-triton-node-type': 'artefact',
        'x-triton-declaration': `final class ${pascalFromLayoutState(sample.state)}Probe(config: ProbeConfig)`,
        'x-triton-method-signatures': [
          { signature: 'def inspectLayout(): LayoutReport', startRow: 1 },
          { signature: 'def resize(width: Int, height: Int): Unit', startRow: 2 },
        ],
        'x-triton-source-file': 'BreakpointLayoutProbe.scala',
        'x-triton-source-row': 1,
      }
    }
    return {
      ...base,
      'x-triton-project-kind': sample.kind,
      ...(sample.kind === 'project'
        ? {
            'x-triton-project-compartments': [
              { id: 'layout', title: 'Layout state', rows: [{ label: 'state', value: sample.state }] },
            ],
          }
        : {}),
    }
  })

  return {
    description:
      'Dojo for breakpoint layout states. Layout states are arranged vertically and box types horizontally; each matrix cell shows the minimal representative size for that box type and layout.',
    'x-triton-editor': { positions, sizes },
    resources,
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

function buildPackageTreeDojoDocument(count: number): IlographDocument {
  const n = clampDojoTreeCount(count)
  const resources = Array.from({ length: n }, (_, index) => {
    const level = index + 1
    const depth = Math.floor(Math.log2(level)) + 1
    return {
      id: `tree-package-${level}`,
      name: `tree-package-${level}`,
      subtitle: `depth ${depth}`,
      'x-triton-package-scope': true,
      ...(level === 1 ? { 'x-triton-package-language': 'scala' } : {}),
    }
  })
  const relations = Array.from({ length: n }, (_, index) => {
    const parent = index + 1
    const left = parent * 2
    const right = left + 1
    const edges: Array<{ from: string; to: string; label: string }> = []
    if (left <= n) edges.push({ from: `tree-package-${parent}`, to: `tree-package-${left}`, label: 'imports' })
    if (right <= n) edges.push({ from: `tree-package-${parent}`, to: `tree-package-${right}`, label: 'imports' })
    return edges
  }).flat()
  return {
    description:
      'Dojo for a breadth-first binary package tree. Increase the node count to inspect how package-scope containers scale across both depth columns and sibling stacks at once.',
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

/**
 * Artefact hierarchy dojo: 4 packages (lifecycle, animals, fruits, registry) connected by
 * `imports` edges; each package carries `x-triton-inner-artefacts` forming an inheritance tree.
 *
 * `layers` (1–5) — inheritance depth:
 *   1 → root traits + one abstract layer (Animal, Fruit)
 *   2 → adds Vertebrate / Invertebrate / SeedFruit / FleshedFruit
 *   3 → adds Mammal / Bird / Insect / PomeFruit / TropicalFruit
 *   4 → adds concrete leaf classes (Cat, Dog, Sparrow, Apple, Banana, …)
 *   5 → adds final specialisations (PersianCat, Labrador, GrannySmith, …)
 *
 * `width` (1–4) — sibling count at each active layer: each step adds more
 *   parallel artefacts per category so the inner diagram grows laterally.
 */
function buildArtefactHierarchyDojoDocument(layers: number, width: number): IlographDocument {
  const n = clampDojoArtefactLayers(layers)
  const w = clampDojoArtefactWidth(width)

  const LIFECYCLE = 'lifecycle'
  const ANIMALS = 'animals'
  const FRUITS = 'fruits'
  const REGISTRY = 'registry'

  const aid = (pkg: string, kind: string, name: string) =>
    `${pkg}::${kind.replace(/\s+/g, '-')}:${name}`

  // ── lifecycle ─────────────────────────────────────────────────────────────
  // Width adds extra shared traits visible across both animals and fruits.
  const lifecycleArts: any[] = [
    {
      id: aid(LIFECYCLE, 'trait', 'Lifeform'),
      name: 'Lifeform',
      subtitle: 'trait',
      declaration: 'trait Lifeform',
      methodSignatures: [
        { signature: 'def isAlive: Boolean', startRow: 1 },
        { signature: 'def lifespan: Int', startRow: 2 },
      ],
    },
    {
      id: aid(LIFECYCLE, 'trait', 'Nameable'),
      name: 'Nameable',
      subtitle: 'trait',
      declaration: 'trait Nameable',
      methodSignatures: [
        { signature: 'def name: String', startRow: 1 },
        { signature: 'def displayName: String', startRow: 2 },
      ],
    },
  ]
  // Extra lifecycle traits added by width >= 2 (shared by animals and fruits via cross-pkg).
  const extraLifecycleTraits: Array<{ name: string; sig: string }> = [
    { name: 'Measurable',   sig: 'def measure: Double' },
    { name: 'Observable',   sig: 'def observe(): Unit' },
    { name: 'Categorizable', sig: 'def category: String' },
    { name: 'Trackable',    sig: 'def track(): Unit' },
    { name: 'Serializable', sig: 'def serialize: String' },
    { name: 'Comparable',   sig: 'def compareTo(other: Lifeform): Int' },
    { name: 'Printable',    sig: 'def print(): Unit' },
    { name: 'Hashable',     sig: 'def hash: Long' },
    { name: 'Equatable',    sig: 'def equalTo(other: Lifeform): Boolean' },
    { name: 'Countable',    sig: 'def count: Int' },
    { name: 'Sortable',     sig: 'def sortKey: String' },
    { name: 'Filterable',   sig: 'def matches(query: String): Boolean' },
    { name: 'Mappable',     sig: 'def toMap: Map[String, Any]' },
    { name: 'Foldable',     sig: 'def fold[A](z: A)(f: (A, Lifeform) => A): A' },
    { name: 'Traversable',  sig: 'def traverse(): Iterator[Lifeform]' },
    { name: 'Reducible',    sig: 'def reduce[A](f: (A, A) => A): A' },
    { name: 'Groupable',    sig: 'def groupKey: String' },
    { name: 'Indexable',    sig: 'def index: Int' },
    { name: 'Loggable',     sig: 'def log(): Unit' },
  ]
  for (let i = 0; i < Math.min(w - 1, extraLifecycleTraits.length); i++) {
    const t = extraLifecycleTraits[i]!
    lifecycleArts.push({
      id: aid(LIFECYCLE, 'trait', t.name),
      name: t.name,
      subtitle: 'trait',
      declaration: `trait ${t.name}`,
      methodSignatures: [{ signature: t.sig, startRow: 1 }],
    })
  }

  // ── animals ───────────────────────────────────────────────────────────────
  const animalArts: any[] = [
    {
      id: aid(ANIMALS, 'abstract class', 'Animal'),
      name: 'Animal',
      subtitle: 'abstract class',
      declaration: 'abstract class Animal extends Lifeform with Nameable',
      methodSignatures: [
        { signature: 'def makeSound(): String', startRow: 1 },
        { signature: 'def move(): Unit', startRow: 2 },
      ],
    },
  ]
  const animalInnerRels: any[] = []
  const animalCrossRels: any[] = [
    { from: aid(ANIMALS, 'abstract class', 'Animal'), to: aid(LIFECYCLE, 'trait', 'Lifeform'), label: 'extends' },
    { from: aid(ANIMALS, 'abstract class', 'Animal'), to: aid(LIFECYCLE, 'trait', 'Nameable'), label: 'with' },
    // Extra lifecycle traits (width >= 2) wired as `with` mixins on Animal.
    ...extraLifecycleTraits.slice(0, Math.max(0, w - 1)).map((t) => ({
      from: aid(ANIMALS, 'abstract class', 'Animal'),
      to: aid(LIFECYCLE, 'trait', t.name),
      label: 'with' as const,
    })),
  ]

  // Width adds more sibling types at layer 2 (abstractions between Animal and concrete types).
  const extraAnimalLayer2: Array<{ name: string; parent: string; sig: string }> = [
    { name: 'Aquatic', parent: 'Animal', sig: 'def swimDepth: Double' },
    { name: 'Aerial', parent: 'Animal', sig: 'def flightAltitude: Double' },
  ]

  if (n >= 2) {
    animalArts.push(
      {
        id: aid(ANIMALS, 'abstract class', 'Vertebrate'),
        name: 'Vertebrate',
        subtitle: 'abstract class',
        declaration: 'abstract class Vertebrate extends Animal',
        methodSignatures: [{ signature: 'def spineCount: Int', startRow: 1 }],
      },
      {
        id: aid(ANIMALS, 'abstract class', 'Invertebrate'),
        name: 'Invertebrate',
        subtitle: 'abstract class',
        declaration: 'abstract class Invertebrate extends Animal',
        methodSignatures: [{ signature: 'def exoskeleton: Boolean', startRow: 1 }],
      },
    )
    animalInnerRels.push(
      { from: aid(ANIMALS, 'abstract class', 'Vertebrate'), to: aid(ANIMALS, 'abstract class', 'Animal'), label: 'extends' },
      { from: aid(ANIMALS, 'abstract class', 'Invertebrate'), to: aid(ANIMALS, 'abstract class', 'Animal'), label: 'extends' },
    )
    // Extra layer-2 siblings (width >= 3).
    for (let i = 0; i < Math.min(w - 2, extraAnimalLayer2.length); i++) {
      const e = extraAnimalLayer2[i]!
      animalArts.push({
        id: aid(ANIMALS, 'abstract class', e.name),
        name: e.name,
        subtitle: 'abstract class',
        declaration: `abstract class ${e.name} extends ${e.parent}`,
        methodSignatures: [{ signature: e.sig, startRow: 1 }],
      })
      animalInnerRels.push({
        from: aid(ANIMALS, 'abstract class', e.name),
        to: aid(ANIMALS, 'abstract class', e.parent),
        label: 'extends',
      })
    }
  }

  if (n >= 3) {
    animalArts.push(
      {
        id: aid(ANIMALS, 'abstract class', 'Mammal'),
        name: 'Mammal',
        subtitle: 'abstract class',
        declaration: 'abstract class Mammal extends Vertebrate',
        methodSignatures: [{ signature: 'def warmBlooded: Boolean', startRow: 1 }],
      },
      {
        id: aid(ANIMALS, 'abstract class', 'Bird'),
        name: 'Bird',
        subtitle: 'abstract class',
        declaration: 'abstract class Bird extends Vertebrate',
        methodSignatures: [
          { signature: 'def canFly: Boolean', startRow: 1 },
          { signature: 'def wingspan: Double', startRow: 2 },
        ],
      },
      {
        id: aid(ANIMALS, 'abstract class', 'Insect'),
        name: 'Insect',
        subtitle: 'abstract class',
        declaration: 'abstract class Insect extends Invertebrate',
        methodSignatures: [{ signature: 'def legs: Int', startRow: 1 }],
      },
    )
    animalInnerRels.push(
      { from: aid(ANIMALS, 'abstract class', 'Mammal'), to: aid(ANIMALS, 'abstract class', 'Vertebrate'), label: 'extends' },
      { from: aid(ANIMALS, 'abstract class', 'Bird'), to: aid(ANIMALS, 'abstract class', 'Vertebrate'), label: 'extends' },
      { from: aid(ANIMALS, 'abstract class', 'Insect'), to: aid(ANIMALS, 'abstract class', 'Invertebrate'), label: 'extends' },
    )
  }

  if (n >= 4) {
    // Pool of leaf mammals and birds; width controls how many are included.
    type LeafSpec = { name: string; parent: string; ctor: string; sigs: string[] }
    const mammalPool: LeafSpec[] = [
      { name: 'Cat',       parent: 'Mammal', ctor: '(name: String, indoor: Boolean)', sigs: ['def makeSound(): String'] },
      { name: 'Dog',       parent: 'Mammal', ctor: '(name: String, breed: String)',   sigs: ['def makeSound(): String', 'def fetch(): Unit'] },
      { name: 'Mouse',     parent: 'Mammal', ctor: '(name: String)',                  sigs: ['def makeSound(): String'] },
      { name: 'Whale',     parent: 'Mammal', ctor: '(name: String, length: Double)',  sigs: ['def dive(): Unit'] },
      { name: 'Bat',       parent: 'Mammal', ctor: '(name: String)',                  sigs: ['def echolocate(): Boolean'] },
      { name: 'Bear',      parent: 'Mammal', ctor: '(name: String, weight: Double)',  sigs: ['def hibernate(): Unit'] },
      { name: 'Wolf',      parent: 'Mammal', ctor: '(name: String)',                  sigs: ['def howl(): Unit'] },
      { name: 'Fox',       parent: 'Mammal', ctor: '(name: String)',                  sigs: ['def stalk(): Unit'] },
      { name: 'Deer',      parent: 'Mammal', ctor: '(name: String, antlers: Boolean)', sigs: ['def graze(): Unit'] },
      { name: 'Rabbit',    parent: 'Mammal', ctor: '(name: String)',                  sigs: ['def burrow(): Unit'] },
      { name: 'Horse',     parent: 'Mammal', ctor: '(name: String, breed: String)',   sigs: ['def gallop(): Unit'] },
      { name: 'Elephant',  parent: 'Mammal', ctor: '(name: String, tuskLen: Double)', sigs: ['def trumpet(): Unit'] },
      { name: 'Tiger',     parent: 'Mammal', ctor: '(name: String)',                  sigs: ['def stalk(): Unit'] },
      { name: 'Lion',      parent: 'Mammal', ctor: '(name: String)',                  sigs: ['def roar(): Unit'] },
      { name: 'Panda',     parent: 'Mammal', ctor: '(name: String)',                  sigs: ['def eat(): Unit'] },
      { name: 'Kangaroo',  parent: 'Mammal', ctor: '(name: String)',                  sigs: ['def leap(): Unit'] },
      { name: 'Dolphin',   parent: 'Mammal', ctor: '(name: String)',                  sigs: ['def sonar(): Double'] },
      { name: 'Seal',      parent: 'Mammal', ctor: '(name: String)',                  sigs: ['def flipper(): Unit'] },
      { name: 'Otter',     parent: 'Mammal', ctor: '(name: String)',                  sigs: ['def float(): Unit'] },
      { name: 'Hedgehog',  parent: 'Mammal', ctor: '(name: String)',                  sigs: ['def curl(): Unit'] },
    ]
    const birdPool: LeafSpec[] = [
      { name: 'Sparrow',     parent: 'Bird', ctor: '(name: String)',              sigs: ['def canFly: Boolean'] },
      { name: 'Eagle',       parent: 'Bird', ctor: '(name: String)',              sigs: ['def canFly: Boolean', 'def huntRange: Double'] },
      { name: 'Owl',         parent: 'Bird', ctor: '(name: String)',              sigs: ['def canFly: Boolean', 'def isNocturnal: Boolean'] },
      { name: 'Parrot',      parent: 'Bird', ctor: '(name: String, speaks: Boolean)', sigs: ['def mimic(): String'] },
      { name: 'Robin',       parent: 'Bird', ctor: '(name: String)',              sigs: ['def canFly: Boolean'] },
      { name: 'Falcon',      parent: 'Bird', ctor: '(name: String)',              sigs: ['def diveSpeed: Double'] },
      { name: 'Heron',       parent: 'Bird', ctor: '(name: String)',              sigs: ['def wade(): Unit'] },
      { name: 'Crane',       parent: 'Bird', ctor: '(name: String)',              sigs: ['def migrate(): Unit'] },
      { name: 'Penguin',     parent: 'Bird', ctor: '(name: String)',              sigs: ['def canFly: Boolean', 'def swim(): Unit'] },
      { name: 'Flamingo',    parent: 'Bird', ctor: '(name: String)',              sigs: ['def balance(): Unit'] },
      { name: 'Pelican',     parent: 'Bird', ctor: '(name: String)',              sigs: ['def scoop(): Unit'] },
      { name: 'Stork',       parent: 'Bird', ctor: '(name: String)',              sigs: ['def migrate(): Unit'] },
      { name: 'Toucan',      parent: 'Bird', ctor: '(name: String)',              sigs: ['def beakLength: Double'] },
      { name: 'Woodpecker',  parent: 'Bird', ctor: '(name: String)',              sigs: ['def drum(): Unit'] },
      { name: 'Kingfisher',  parent: 'Bird', ctor: '(name: String)',              sigs: ['def dive(): Unit'] },
      { name: 'Albatross',   parent: 'Bird', ctor: '(name: String)',              sigs: ['def glide(): Unit'] },
      { name: 'Condor',      parent: 'Bird', ctor: '(name: String)',              sigs: ['def soar(): Unit'] },
      { name: 'Hornbill',    parent: 'Bird', ctor: '(name: String)',              sigs: ['def casqueSize: Double'] },
      { name: 'Macaw',       parent: 'Bird', ctor: '(name: String)',              sigs: ['def squawk(): String'] },
      { name: 'Cockatoo',    parent: 'Bird', ctor: '(name: String)',              sigs: ['def crest(): Unit'] },
    ]
    const mammalCount = Math.min(w, mammalPool.length)
    const birdCount   = Math.min(w, birdPool.length)
    const pushLeaf = (spec: LeafSpec) => {
      animalArts.push({
        id: aid(ANIMALS, 'case class', spec.name),
        name: spec.name,
        subtitle: 'case class',
        declaration: `case class ${spec.name}${spec.ctor} extends ${spec.parent}`,
        constructorParams: spec.ctor,
        methodSignatures: spec.sigs.map((s, i) => ({ signature: s, startRow: i + 1 })),
      })
      animalInnerRels.push({
        from: aid(ANIMALS, 'case class', spec.name),
        to: aid(ANIMALS, 'abstract class', spec.parent),
        label: 'extends',
      })
    }
    for (let i = 0; i < mammalCount; i++) pushLeaf(mammalPool[i]!)
    for (let i = 0; i < birdCount; i++) pushLeaf(birdPool[i]!)
  }

  if (n >= 5) {
    // Specialisations — one per parent mammal that's included (capped by width).
    type SpecSpec = { name: string; parent: string }
    const specPool: SpecSpec[] = [
      { name: 'PersianCat',         parent: 'Cat' },
      { name: 'Labrador',           parent: 'Dog' },
      { name: 'FieldMouse',         parent: 'Mouse' },
      { name: 'BlueWhale',          parent: 'Whale' },
      { name: 'FruitBat',           parent: 'Bat' },
      { name: 'PolarBear',          parent: 'Bear' },
      { name: 'TimberWolf',         parent: 'Wolf' },
      { name: 'ArcticFox',          parent: 'Fox' },
      { name: 'RedDeer',            parent: 'Deer' },
      { name: 'Jackrabbit',         parent: 'Rabbit' },
      { name: 'Mustang',            parent: 'Horse' },
      { name: 'AfricanElephant',    parent: 'Elephant' },
      { name: 'BengalTiger',        parent: 'Tiger' },
      { name: 'AfricanLion',        parent: 'Lion' },
      { name: 'GiantPanda',         parent: 'Panda' },
      { name: 'RedKangaroo',        parent: 'Kangaroo' },
      { name: 'BottlenoseDolphin',  parent: 'Dolphin' },
      { name: 'GraySeal',           parent: 'Seal' },
      { name: 'SeaOtter',           parent: 'Otter' },
      { name: 'EuropeanHedgehog',   parent: 'Hedgehog' },
    ]
    // Only emit specialisations whose parent was included at layer 4.
    const includedMammals = new Set(
      ['Cat','Dog','Mouse','Whale','Bat','Bear','Wolf','Fox','Deer','Rabbit',
       'Horse','Elephant','Tiger','Lion','Panda','Kangaroo','Dolphin','Seal','Otter','Hedgehog']
        .slice(0, Math.min(w, 20))
    )
    for (const s of specPool) {
      if (!includedMammals.has(s.parent)) continue
      animalArts.push({
        id: aid(ANIMALS, 'case class', s.name),
        name: s.name,
        subtitle: 'case class',
        declaration: `case class ${s.name}(name: String) extends ${s.parent}`,
        constructorParams: '(name: String)',
        methodSignatures: [],
      })
      animalInnerRels.push({
        from: aid(ANIMALS, 'case class', s.name),
        to: aid(ANIMALS, 'case class', s.parent),
        label: 'extends',
      })
    }
  }

  // ── fruits ────────────────────────────────────────────────────────────────
  const fruitArts: any[] = [
    {
      id: aid(FRUITS, 'abstract class', 'Fruit'),
      name: 'Fruit',
      subtitle: 'abstract class',
      declaration: 'abstract class Fruit extends Lifeform with Nameable',
      methodSignatures: [
        { signature: 'def sweetness: Double', startRow: 1 },
        { signature: 'def ripeAt: java.time.LocalDate', startRow: 2 },
      ],
    },
  ]
  const fruitInnerRels: any[] = []
  const fruitCrossRels: any[] = [
    { from: aid(FRUITS, 'abstract class', 'Fruit'), to: aid(LIFECYCLE, 'trait', 'Lifeform'), label: 'extends' },
    { from: aid(FRUITS, 'abstract class', 'Fruit'), to: aid(LIFECYCLE, 'trait', 'Nameable'), label: 'with' },
  ]

  if (n >= 2) {
    fruitArts.push(
      {
        id: aid(FRUITS, 'abstract class', 'SeedFruit'),
        name: 'SeedFruit',
        subtitle: 'abstract class',
        declaration: 'abstract class SeedFruit extends Fruit',
        methodSignatures: [{ signature: 'def seedCount: Int', startRow: 1 }],
      },
      {
        id: aid(FRUITS, 'abstract class', 'FleshedFruit'),
        name: 'FleshedFruit',
        subtitle: 'abstract class',
        declaration: 'abstract class FleshedFruit extends Fruit',
        methodSignatures: [{ signature: 'def pulpThickness: Double', startRow: 1 }],
      },
    )
    fruitInnerRels.push(
      { from: aid(FRUITS, 'abstract class', 'SeedFruit'), to: aid(FRUITS, 'abstract class', 'Fruit'), label: 'extends' },
      { from: aid(FRUITS, 'abstract class', 'FleshedFruit'), to: aid(FRUITS, 'abstract class', 'Fruit'), label: 'extends' },
    )
  }

  if (n >= 3) {
    fruitArts.push(
      {
        id: aid(FRUITS, 'abstract class', 'PomeFruit'),
        name: 'PomeFruit',
        subtitle: 'abstract class',
        declaration: 'abstract class PomeFruit extends SeedFruit',
        methodSignatures: [{ signature: 'def coreSize: Double', startRow: 1 }],
      },
      {
        id: aid(FRUITS, 'abstract class', 'TropicalFruit'),
        name: 'TropicalFruit',
        subtitle: 'abstract class',
        declaration: 'abstract class TropicalFruit extends FleshedFruit',
        methodSignatures: [{ signature: 'def growthZone: String', startRow: 1 }],
      },
    )
    fruitInnerRels.push(
      { from: aid(FRUITS, 'abstract class', 'PomeFruit'), to: aid(FRUITS, 'abstract class', 'SeedFruit'), label: 'extends' },
      { from: aid(FRUITS, 'abstract class', 'TropicalFruit'), to: aid(FRUITS, 'abstract class', 'FleshedFruit'), label: 'extends' },
    )
  }

  if (n >= 4) {
    const pomeFruitPool = [
      { name: 'Apple',         parent: 'PomeFruit', params: '(name: String, colour: String)',  sig: 'def sweetness: Double' },
      { name: 'Pear',          parent: 'PomeFruit', params: '(name: String, texture: String)', sig: 'def grittiness: Double' },
      { name: 'Quince',        parent: 'PomeFruit', params: '(name: String)',                  sig: 'def tartness: Double' },
      { name: 'Crabapple',     parent: 'PomeFruit', params: '(name: String)',                  sig: 'def bitterness: Double' },
      { name: 'Medlar',        parent: 'PomeFruit', params: '(name: String)',                  sig: 'def bletting: Boolean' },
      { name: 'Loquat',        parent: 'PomeFruit', params: '(name: String)',                  sig: 'def juiciness: Double' },
      { name: 'Serviceberry',  parent: 'PomeFruit', params: '(name: String)',                  sig: 'def colour: String' },
      { name: 'Chokeberry',    parent: 'PomeFruit', params: '(name: String)',                  sig: 'def antioxidants: Double' },
      { name: 'Hawthorn',      parent: 'PomeFruit', params: '(name: String)',                  sig: 'def thornCount: Int' },
      { name: 'Rowan',         parent: 'PomeFruit', params: '(name: String)',                  sig: 'def brixLevel: Double' },
      { name: 'Mayhaw',        parent: 'PomeFruit', params: '(name: String)',                  sig: 'def jellySuitability: Boolean' },
      { name: 'Amelanchier',   parent: 'PomeFruit', params: '(name: String)',                  sig: 'def ripeness: Double' },
      { name: 'Aronia',        parent: 'PomeFruit', params: '(name: String)',                  sig: 'def polyphenols: Double' },
      { name: 'Firethorn',     parent: 'PomeFruit', params: '(name: String)',                  sig: 'def clusterSize: Int' },
      { name: 'Toyon',         parent: 'PomeFruit', params: '(name: String)',                  sig: 'def berryDiameter: Double' },
      { name: 'Buffaloberry',  parent: 'PomeFruit', params: '(name: String)',                  sig: 'def tartness: Double' },
      { name: 'Hackberry',     parent: 'PomeFruit', params: '(name: String)',                  sig: 'def stoniness: Boolean' },
      { name: 'Whitebeam',     parent: 'PomeFruit', params: '(name: String)',                  sig: 'def flouring: Boolean' },
      { name: 'Cotoneaster',   parent: 'PomeFruit', params: '(name: String)',                  sig: 'def ornamental: Boolean' },
      { name: 'Photinia',      parent: 'PomeFruit', params: '(name: String)',                  sig: 'def leafColour: String' },
    ]
    const tropicalFruitPool = [
      { name: 'Banana',        parent: 'TropicalFruit', params: '(name: String, curvature: Double)', sig: 'def ripeness: Double' },
      { name: 'Mango',         parent: 'TropicalFruit', params: '(name: String, variety: String)',   sig: 'def fibreContent: Double' },
      { name: 'Papaya',        parent: 'TropicalFruit', params: '(name: String)',                    sig: 'def enzymeLevel: Double' },
      { name: 'Pineapple',     parent: 'TropicalFruit', params: '(name: String, crownSize: Int)',    sig: 'def acidity: Double' },
      { name: 'Guava',         parent: 'TropicalFruit', params: '(name: String)',                    sig: 'def vitaminC: Double' },
      { name: 'Lychee',        parent: 'TropicalFruit', params: '(name: String)',                    sig: 'def shellThickness: Double' },
      { name: 'Coconut',       parent: 'TropicalFruit', params: '(name: String)',                    sig: 'def milkVolume: Double' },
      { name: 'Jackfruit',     parent: 'TropicalFruit', params: '(name: String, weight: Double)',    sig: 'def podCount: Int' },
      { name: 'Starfruit',     parent: 'TropicalFruit', params: '(name: String)',                    sig: 'def ridges: Int' },
      { name: 'Durian',        parent: 'TropicalFruit', params: '(name: String)',                    sig: 'def odourLevel: Double' },
      { name: 'Rambutan',      parent: 'TropicalFruit', params: '(name: String)',                    sig: 'def spineCount: Int' },
      { name: 'Dragonfruit',   parent: 'TropicalFruit', params: '(name: String)',                    sig: 'def scaleCount: Int' },
      { name: 'Passionfruit',  parent: 'TropicalFruit', params: '(name: String)',                    sig: 'def pulpRatio: Double' },
      { name: 'Tamarind',      parent: 'TropicalFruit', params: '(name: String)',                    sig: 'def sourness: Double' },
      { name: 'Persimmon',     parent: 'TropicalFruit', params: '(name: String)',                    sig: 'def tannins: Double' },
      { name: 'Longan',        parent: 'TropicalFruit', params: '(name: String)',                    sig: 'def shellColour: String' },
      { name: 'Soursop',       parent: 'TropicalFruit', params: '(name: String)',                    sig: 'def spineLength: Double' },
      { name: 'Langsat',       parent: 'TropicalFruit', params: '(name: String)',                    sig: 'def clusterSize: Int' },
      { name: 'Salak',         parent: 'TropicalFruit', params: '(name: String)',                    sig: 'def scaleTexture: String' },
      { name: 'Pomelo',        parent: 'TropicalFruit', params: '(name: String)',                    sig: 'def rindThickness: Double' },
    ]
    const pomeCount     = Math.min(w, pomeFruitPool.length)
    const tropicalCount = Math.min(w, tropicalFruitPool.length)
    for (let i = 0; i < pomeCount; i++) {
      const f = pomeFruitPool[i]
      fruitArts.push({ id: aid(FRUITS, 'case class', f.name), name: f.name, subtitle: 'case class',
        declaration: `case class ${f.name}${f.params} extends ${f.parent}`,
        constructorParams: f.params, methodSignatures: [{ signature: f.sig, startRow: 1 }] })
      fruitInnerRels.push({ from: aid(FRUITS, 'case class', f.name), to: aid(FRUITS, 'abstract class', f.parent), label: 'extends' })
    }
    for (let i = 0; i < tropicalCount; i++) {
      const f = tropicalFruitPool[i]
      fruitArts.push({ id: aid(FRUITS, 'case class', f.name), name: f.name, subtitle: 'case class',
        declaration: `case class ${f.name}${f.params} extends ${f.parent}`,
        constructorParams: f.params, methodSignatures: [{ signature: f.sig, startRow: 1 }] })
      fruitInnerRels.push({ from: aid(FRUITS, 'case class', f.name), to: aid(FRUITS, 'abstract class', f.parent), label: 'extends' })
    }
  }

  if (n >= 5) {
    const pomeNames = ['Apple','Pear','Quince','Crabapple','Medlar','Loquat','Serviceberry','Chokeberry',
      'Hawthorn','Rowan','Mayhaw','Amelanchier','Aronia','Firethorn','Toyon','Buffaloberry',
      'Hackberry','Whitebeam','Cotoneaster','Photinia'].slice(0, Math.min(w, 20))
    const tropNames = ['Banana','Mango','Papaya','Pineapple','Guava','Lychee','Coconut','Jackfruit',
      'Starfruit','Durian','Rambutan','Dragonfruit','Passionfruit','Tamarind','Persimmon',
      'Longan','Soursop','Langsat','Salak','Pomelo'].slice(0, Math.min(w, 20))
    const includedFruits = new Set<string>([...pomeNames, ...tropNames])
    const fruitSpecPool = [
      { name: 'GrannySmith',  parent: 'Apple',        params: '(name: String)', sig: 'def sourness: Double' },
      { name: 'Coxs',         parent: 'Pear',         params: '(name: String)', sig: 'def crunchiness: Double' },
      { name: 'Gala',         parent: 'Crabapple',    params: '(name: String)', sig: 'def wildness: Double' },
      { name: 'JapaneseLoquat', parent: 'Loquat',     params: '(name: String)', sig: 'def blush: String' },
      { name: 'AroniaElite',  parent: 'Aronia',       params: '(name: String)', sig: 'def yield: Double' },
      { name: 'Cavendish',    parent: 'Banana',        params: '(name: String)', sig: 'def uniformity: Double' },
      { name: 'Alphonso',     parent: 'Mango',         params: '(name: String)', sig: 'def fragrance: Double' },
      { name: 'Solo',         parent: 'Papaya',        params: '(name: String)', sig: 'def size: String' },
      { name: 'Smooth',       parent: 'Pineapple',     params: '(name: String)', sig: 'def eyeDepth: Double' },
      { name: 'RedGuava',     parent: 'Guava',         params: '(name: String)', sig: 'def pulpColour: String' },
      { name: 'Mauritius',    parent: 'Lychee',        params: '(name: String)', sig: 'def shellRedness: Double' },
      { name: 'TallPalm',     parent: 'Coconut',       params: '(name: String)', sig: 'def height: Double' },
      { name: 'ChempadasJack', parent: 'Jackfruit',   params: '(name: String)', sig: 'def podDensity: Int' },
      { name: 'GoldenStar',   parent: 'Starfruit',     params: '(name: String)', sig: 'def waxiness: Boolean' },
      { name: 'MusangKing',   parent: 'Durian',        params: '(name: String)', sig: 'def creaminess: Double' },
      { name: 'RedRambutan',  parent: 'Rambutan',      params: '(name: String)', sig: 'def spineSoftness: Double' },
      { name: 'PitayaRed',    parent: 'Dragonfruit',   params: '(name: String)', sig: 'def pulpColour: String' },
      { name: 'PurplePassion', parent: 'Passionfruit', params: '(name: String)', sig: 'def seedRatio: Double' },
      { name: 'TamarindSweet', parent: 'Tamarind',    params: '(name: String)', sig: 'def sugarContent: Double' },
      { name: 'HachiyaPersimmon', parent: 'Persimmon', params: '(name: String)', sig: 'def astringency: Double' },
    ]
    for (const s of fruitSpecPool) {
      if (!includedFruits.has(s.parent)) continue
      fruitArts.push({ id: aid(FRUITS, 'case class', s.name), name: s.name, subtitle: 'case class',
        declaration: `case class ${s.name}${s.params} extends ${s.parent}`,
        constructorParams: s.params, methodSignatures: [{ signature: s.sig, startRow: 1 }] })
      fruitInnerRels.push({ from: aid(FRUITS, 'case class', s.name), to: aid(FRUITS, 'case class', s.parent), label: 'extends' })
    }
  }

  // ── registry ──────────────────────────────────────────────────────────────
  const registryCrossRels: any[] = [
    { from: aid(REGISTRY, 'object', 'Registry'), to: aid(ANIMALS, 'abstract class', 'Animal'), label: 'gets' },
    { from: aid(REGISTRY, 'object', 'Registry'), to: aid(FRUITS, 'abstract class', 'Fruit'), label: 'gets' },
  ]

  function subtitleFor(arts: any[]): string {
    const count = (s: string) => arts.filter((a) => a.subtitle === s).length
    const parts: string[] = []
    const t = count('trait')
    const abs = count('abstract class')
    const cc = count('case class')
    const obj = count('object')
    if (t) parts.push(`${t} trait${t !== 1 ? 's' : ''}`)
    if (abs) parts.push(`${abs} abstract class${abs !== 1 ? 'es' : ''}`)
    if (cc) parts.push(`${cc} case class${cc !== 1 ? 'es' : ''}`)
    if (obj) parts.push(`${obj} object${obj !== 1 ? 's' : ''}`)
    return parts.join(', ')
  }

  return {
    description:
      'Dojo for Scala artefact hierarchies inside package nodes. Increase layers to grow the inheritance tree across lifecycle, animals, fruits, and registry packages.',
    resources: [
      {
        id: LIFECYCLE,
        name: 'lifecycle',
        subtitle: subtitleFor(lifecycleArts),
        'x-triton-node-type': 'package',
        'x-triton-inner-artefacts': lifecycleArts,
      },
      {
        id: ANIMALS,
        name: 'animals',
        subtitle: subtitleFor(animalArts),
        'x-triton-node-type': 'package',
        'x-triton-inner-artefacts': animalArts,
        ...(animalInnerRels.length ? { 'x-triton-inner-artefact-relations': animalInnerRels } : {}),
        'x-triton-cross-artefact-relations': animalCrossRels,
      },
      {
        id: FRUITS,
        name: 'fruits',
        subtitle: subtitleFor(fruitArts),
        'x-triton-node-type': 'package',
        'x-triton-inner-artefacts': fruitArts,
        ...(fruitInnerRels.length ? { 'x-triton-inner-artefact-relations': fruitInnerRels } : {}),
        'x-triton-cross-artefact-relations': fruitCrossRels,
      },
      {
        id: REGISTRY,
        name: 'registry',
        subtitle: '1 object',
        'x-triton-node-type': 'package',
        'x-triton-inner-artefacts': [
          {
            id: aid(REGISTRY, 'object', 'Registry'),
            name: 'Registry',
            subtitle: 'object',
            declaration: 'object Registry',
            methodSignatures: [
              { signature: 'def register(a: Animal): Unit', startRow: 1 },
              { signature: 'def register(f: Fruit): Unit', startRow: 2 },
              { signature: 'def all: List[Lifeform]', startRow: 3 },
            ],
          },
        ],
        'x-triton-cross-artefact-relations': registryCrossRels,
      },
    ],
    perspectives: [
      {
        id: 'dependencies',
        name: 'dependencies',
        orientation: 'leftToRight',
        relations: [
          { from: ANIMALS, to: LIFECYCLE, label: 'imports' },
          { from: FRUITS, to: LIFECYCLE, label: 'imports' },
          { from: REGISTRY, to: ANIMALS, label: 'imports' },
          { from: REGISTRY, to: FRUITS, label: 'imports' },
        ],
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

async function loadPackageStackingDojo(count: number) {
  const normalizedCount = clampDojoStackCount(count)
  dojoStackCount.value = normalizedCount
  sourcePath.value = `dojo/${PACKAGE_STACKING_DOJO_ID}.ilograph.yaml`
  await applyDoc(
    stringifyIlographYaml(buildPackageStackingDojoDocument(normalizedCount)),
    `${PACKAGE_STACKING_DOJO_ID}.ilograph.yaml`,
    false,
    { moduleNodeType: 'package' },
  )
  if (activeTab.value) activeTab.value.dojoDepth = normalizedCount
  status.value = `Loaded dojo fixture ${PACKAGE_STACKING_DOJO_ID} with ${normalizedCount} packages.`
}

async function loadPackageImportChainDojo(chainLen: number) {
  const n = clampDojoStackCount(chainLen)
  dojoImportChainLength.value = n
  sourcePath.value = `dojo/${PACKAGE_IMPORT_CHAIN_DOJO_ID}.ilograph.yaml`
  await applyDoc(
    stringifyIlographYaml(buildPackageImportChainDojoDocument(n)),
    `${PACKAGE_IMPORT_CHAIN_DOJO_ID}.ilograph.yaml`,
    false,
    { moduleNodeType: 'package' },
  )
  if (activeTab.value) activeTab.value.dojoDepth = n
  status.value = `Loaded dojo fixture ${PACKAGE_IMPORT_CHAIN_DOJO_ID} with chain length ${n}.`
}

async function loadPackageTreeDojo(nodeCount: number) {
  const n = clampDojoTreeCount(nodeCount)
  dojoTreeCount.value = n
  sourcePath.value = `dojo/${PACKAGE_TREE_DOJO_ID}.ilograph.yaml`
  await applyDoc(
    stringifyIlographYaml(buildPackageTreeDojoDocument(n)),
    `${PACKAGE_TREE_DOJO_ID}.ilograph.yaml`,
    false,
    { moduleNodeType: 'package' },
  )
  if (activeTab.value) activeTab.value.dojoDepth = n
  syncUrlFromState()
  status.value = `Loaded dojo fixture ${PACKAGE_TREE_DOJO_ID} with ${n} packages.`
}

async function loadArtefactHierarchyDojo(layers: number, width: number) {
  const n = clampDojoArtefactLayers(layers)
  const w = clampDojoArtefactWidth(width)
  dojoArtefactLayers.value = n
  dojoArtefactWidth.value = w
  sourcePath.value = `dojo/${ARTEFACT_HIERARCHY_DOJO_ID}.ilograph.yaml`
  await applyDoc(
    stringifyIlographYaml(buildArtefactHierarchyDojoDocument(n, w)),
    `${ARTEFACT_HIERARCHY_DOJO_ID}.ilograph.yaml`,
    false,
    { moduleNodeType: 'package' },
  )
  if (activeTab.value) activeTab.value.dojoDepth = n
  status.value = `Loaded dojo fixture ${ARTEFACT_HIERARCHY_DOJO_ID} at ${n} layer${n !== 1 ? 's' : ''}, width ${w}.`
}

async function loadAbstractionLayersDojo() {
  sourcePath.value = `dojo/${ABSTRACTION_LAYERS_DOJO_ID}.ilograph.yaml`
  await applyDoc(
    stringifyIlographYaml(buildAbstractionDojoDocument()),
    `${ABSTRACTION_LAYERS_DOJO_ID}.ilograph.yaml`,
    true,
    { moduleNodeType: 'module' },
  )
  status.value = `Loaded dojo fixture ${ABSTRACTION_LAYERS_DOJO_ID}.`
}

async function loadBreakpointLayoutsDojo() {
  sourcePath.value = `dojo/${BREAKPOINT_LAYOUTS_DOJO_ID}.ilograph.yaml`
  await applyDoc(
    stringifyIlographYaml(buildBreakpointLayoutsDojoDocument()),
    `${BREAKPOINT_LAYOUTS_DOJO_ID}.ilograph.yaml`,
    true,
    { moduleNodeType: 'module' },
  )
  status.value = `Loaded dojo fixture ${BREAKPOINT_LAYOUTS_DOJO_ID}.`
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
  if (id === PACKAGE_TREE_DOJO_ID) {
    await loadPackageTreeDojo(dojoTreeCount.value)
    return
  }
  if (id === ARTEFACT_HIERARCHY_DOJO_ID) {
    await loadArtefactHierarchyDojo(dojoArtefactLayers.value, dojoArtefactWidth.value)
    return
  }
  if (id === ABSTRACTION_LAYERS_DOJO_ID) {
    await loadAbstractionLayersDojo()
    return
  }
  if (id === BREAKPOINT_LAYOUTS_DOJO_ID) {
    await loadBreakpointLayoutsDojo()
    return
  }
  const fixture = getDojoFixture(id)
  if (!fixture) {
    status.value = `Unknown dojo fixture: ${id}`
    await loadBuiltinExample()
    return
  }
  sourcePath.value = `dojo/${fixture.fileName}`
  await applyDoc(fixture.yaml, fixture.fileName, false, { moduleNodeType: 'package' })
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
          : id === PACKAGE_TREE_DOJO_ID
            ? `${PACKAGE_TREE_DOJO_ID}.ilograph.yaml`
            : id === ARTEFACT_HIERARCHY_DOJO_ID
              ? `${ARTEFACT_HIERARCHY_DOJO_ID}.ilograph.yaml`
              : id === ABSTRACTION_LAYERS_DOJO_ID
                ? `${ABSTRACTION_LAYERS_DOJO_ID}.ilograph.yaml`
                : id === BREAKPOINT_LAYOUTS_DOJO_ID
                  ? `${BREAKPOINT_LAYOUTS_DOJO_ID}.ilograph.yaml`
                  : fixture?.fileName ?? `${id}.ilograph.yaml`
  await openOrActivateTab(
    { key: `dojo:${id}`, title, iconUrl: cubeIconUrl },
    () => loadDojoFixture(id),
  )
  if (
    id === PACKAGE_NESTING_DOJO_ID ||
    id === PACKAGE_STACKING_DOJO_ID ||
    id === PACKAGE_IMPORT_CHAIN_DOJO_ID ||
    id === PACKAGE_TREE_DOJO_ID ||
    id === ARTEFACT_HIERARCHY_DOJO_ID ||
    id === ABSTRACTION_LAYERS_DOJO_ID ||
    id === BREAKPOINT_LAYOUTS_DOJO_ID
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
    key.startsWith('ts:') ||
    key.startsWith('ts-packages:') ||
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
  if (key === `dojo:${PACKAGE_TREE_DOJO_ID}`) {
    params.set('dojoDepth', String(clampDojoTreeCount(activeTab.value?.dojoDepth ?? dojoTreeCount.value)))
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
  if (trimmed.startsWith('ts:')) {
    const parsed = parseTsExampleTabBody(trimmed.slice('ts:'.length))
    if (!parsed) return false
    await openTsExampleTab(parsed.root, parsed.dir, parsed.file)
    return true
  }
  if (trimmed.startsWith('ts-packages:')) {
    const parsed = parseTsExampleTabBody(trimmed.slice('ts-packages:'.length))
    if (!parsed?.moduleId) return false
    await openTsPackagesTab(parsed.root, parsed.dir, parsed.file, parsed.moduleId)
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

async function openTsExampleTab(root: string, dir: string, file: string): Promise<void> {
  const hit = tsExamplesAll.find((e) => e.root === root && e.dir === dir && e.file === file)
  if (!hit) {
    status.value = `Cannot open TS example — not found: ${root}/${dir}/${file}`
    return
  }
  await openOrActivateTab(
    { key: tsExampleSelectionId(root, dir, file), title: `TS: ${dir}`, iconUrl: cubeIconUrl },
    async () => {
      sourcePath.value = hit.path
      const [{ buildTypeScriptCodeModelFromFiles }, { codeModelToIlographDocument }] = await Promise.all([
        import('../../packages/triton-core/src/typeScriptCodeModel'),
        import('../../packages/triton-core/src/codeModelToIlograph'),
      ])
      const codeModel = buildTypeScriptCodeModelFromFiles(
        Object.entries(hit.files ?? {}).map(([relPath, source]) => ({
          relPath,
          source,
          ...(hit.sourceFiles?.[relPath] ? { sourceFile: hit.sourceFiles[relPath] } : {}),
        })),
        {
          id: dir,
          name: dir,
          sourceRoot: hit.scannerOptions?.sourceRoot ?? 'src',
          modulePaths: hit.scannerOptions?.modulePaths,
          ignoredPackageSegments: hit.scannerOptions?.ignoredPackageSegments,
        },
      )
      const projected = codeModelToIlographDocument(codeModel, {
        resourceId: dir,
        title: `TypeScript: ${dir}`,
        description: `TypeScript code model for ${root}/${dir}.`,
        projectionMode: 'nested-resources',
        rootResourceKind: hit.scannerOptions?.rootResourceKind,
      })
      await applyDoc(stringifyIlographYaml(projected), file, true, {
        moduleNodeType: hit.scannerOptions?.rootResourceKind === 'project' ? 'module' : 'package',
      })
    },
  )
}

async function openTsPackagesTab(root: string, dir: string, file: string, moduleId: string): Promise<void> {
  const hit = tsExamplesAll.find((e) => e.root === root && e.dir === dir && e.file === file)
  if (!hit) {
    status.value = `Cannot open TS packages — not found: ${root}/${dir}/${file}`
    return
  }
  await openOrActivateTab(
    {
      key: tsPackagesTabKey(root, dir, file, moduleId),
      title: `${dir}:${moduleId.split('/').pop() ?? moduleId}`,
      iconUrl: cubeIconUrl,
    },
    async () => {
      sourcePath.value = `${hit.path}#${moduleId}`
      const [{ buildTypeScriptCodeModelFromFiles }, { codeModelToIlographDocument }] = await Promise.all([
        import('../../packages/triton-core/src/typeScriptCodeModel'),
        import('../../packages/triton-core/src/codeModelToIlograph'),
      ])
      const codeModel = buildTypeScriptCodeModelFromFiles(
        Object.entries(hit.files ?? {}).map(([relPath, source]) => ({
          relPath,
          source,
          ...(hit.sourceFiles?.[relPath] ? { sourceFile: hit.sourceFiles[relPath] } : {}),
        })),
        {
          id: dir,
          name: dir,
          sourceRoot: hit.scannerOptions?.sourceRoot ?? 'src',
          modulePaths: hit.scannerOptions?.modulePaths,
          ignoredPackageSegments: hit.scannerOptions?.ignoredPackageSegments,
        },
      )
      const projected = codeModelToIlographDocument(codeModel, {
        resourceId: moduleId,
        title: `TypeScript packages: ${dir}:${moduleId}`,
        description: `TypeScript package model for ${root}/${dir}/${moduleId}.`,
        projectionMode: 'nested-resources',
        scopeContainerId: moduleId,
      })
      const alreadyOpenPackageScope = projected.resources?.some((resource) => {
        const extended = resource as { id?: string; 'x-triton-package-scope'?: boolean }
        return extended.id === moduleId && extended['x-triton-package-scope'] === true
      }) ?? false
      await applyDoc(stringifyIlographYaml(projected), file, true, {
        moduleNodeType: 'package',
        ...(alreadyOpenPackageScope ? {} : { initialLayerDrillId: moduleId }),
      })
    },
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
 * Examples: `triton:packages`, `triton://diagram/packages?project=App`,
 * or `triton://diagram/ts-packages?module=editor`
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
  const tsModuleId = tritonUrl?.searchParams.get('module')?.trim() ?? ''
  if (tritonUrl?.pathname === '/ts-packages') {
    const activeKey = activeTab.value?.key ?? ''
    const parsed = activeKey.startsWith('ts:')
      ? parseTsExampleTabBody(activeKey.slice('ts:'.length))
      : activeKey.startsWith('ts-packages:')
        ? parseTsExampleTabBody(activeKey.slice('ts-packages:'.length))
        : null
    if (!parsed) {
      status.value = 'Cannot open TypeScript packages view — no TypeScript example loaded.'
      return
    }
    if (!tsModuleId) {
      status.value = 'Cannot open TypeScript packages view — module id is missing.'
      return
    }
    void openTsPackagesTab(parsed.root, parsed.dir, parsed.file, tsModuleId)
    return
  }
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
    activeDojoId.value === PACKAGE_IMPORT_CHAIN_DOJO_ID ||
    activeDojoId.value === PACKAGE_TREE_DOJO_ID ||
    activeDojoId.value === ARTEFACT_HIERARCHY_DOJO_ID ||
    activeDojoId.value === ABSTRACTION_LAYERS_DOJO_ID ||
    activeDojoId.value === BREAKPOINT_LAYOUTS_DOJO_ID,
)

const abstractionDojoResizeForGraph = computed(() =>
  activeTab.value?.key === `dojo:${ABSTRACTION_LAYERS_DOJO_ID}`
    ? { linked: dojoAbstractionLinkedResize.value, nodeIds: ABSTRACTION_RESIZE_NODE_IDS }
    : activeTab.value?.key === `dojo:${BREAKPOINT_LAYOUTS_DOJO_ID}`
      ? { linked: dojoAbstractionLinkedResize.value, nodeIds: BREAKPOINT_LAYOUT_RESIZE_NODE_IDS }
    : null,
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
    return
  }
  if (activeDojoId.value === PACKAGE_TREE_DOJO_ID) {
    dojoTreeCount.value = clampDojoTreeCount(activeTab.value?.dojoDepth ?? dojoTreeCount.value)
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
  void loadPackageStackingDojo(normalized).then(() => {
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
  void loadPackageImportChainDojo(normalized).then(() => {
    snapshotActiveTab()
    syncUrlFromState()
  })
})

watch(dojoTreeCount, (count, prev) => {
  const normalized = clampDojoTreeCount(count)
  if (normalized !== count) {
    dojoTreeCount.value = normalized
    return
  }
  if (normalized === prev) return
  if (activeDojoId.value !== PACKAGE_TREE_DOJO_ID) return
  void loadPackageTreeDojo(normalized).then(() => {
    snapshotActiveTab()
    syncUrlFromState()
  })
})

watch(dojoArtefactLayers, (layers, prev) => {
  const normalized = clampDojoArtefactLayers(layers)
  if (normalized !== layers) {
    dojoArtefactLayers.value = normalized
    return
  }
  if (normalized === prev) return
  if (activeDojoId.value !== ARTEFACT_HIERARCHY_DOJO_ID) return
  void loadArtefactHierarchyDojo(normalized, dojoArtefactWidth.value).then(() => {
    snapshotActiveTab()
    syncUrlFromState()
  })
})

watch(dojoArtefactWidth, (width, prev) => {
  const normalized = clampDojoArtefactWidth(width)
  if (normalized !== width) {
    dojoArtefactWidth.value = normalized
    return
  }
  if (normalized === prev) return
  if (activeDojoId.value !== ARTEFACT_HIERARCHY_DOJO_ID) return
  void loadArtefactHierarchyDojo(dojoArtefactLayers.value, normalized).then(() => {
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
          <template v-if="tsExamples.length">
            <div class="menu-heading" role="presentation">TS examples</div>
            <button
              v-for="t in tsExamples"
              :key="t.root + '/' + t.dir + '/' + t.file"
              type="button"
              class="menu-item"
              role="menuitem"
              :class="{ 'menu-item--active': activeExampleSelectionKey === tsExampleSelectionId(t.root, t.dir, t.file) }"
              :title="t.path"
              @click="selectExample(tsExampleSelectionId(t.root, t.dir, t.file))"
            >
              {{ exampleOptionLabel(t.dir) }} — {{ (t.file ?? '').replace(/\.ilograph\.(ya?ml)$/i, '') }}
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
          :node-types="nodeTypesList"
          :node-type-visibility="nodeTypeVisibility"
          :relation-types="relationTypesList"
          :relation-type-visibility="relationTypeVisibility"
          :metric-tooltips-enabled="metricTooltipsEnabled"
          :focus-relation-depth="focusRelationDepth"
          :metric-visibility="metricVisibility"
          @update:node-type-visible="setNodeTypeVisible"
          @update:relation-type-visible="setRelationTypeVisible"
          @update:metric-tooltips-enabled="(v) => (metricTooltipsEnabled = v)"
          @update:focus-relation-depth="(v) => (focusRelationDepth = v)"
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
          :node-type-visibility="nodeTypeVisibility"
          :relation-type-visibility="relationTypeVisibility"
          :abstraction-dojo-resize="abstractionDojoResizeForGraph"
          :focus-relation-depth="focusRelationDepth"
          :nodes-draggable="
            activeTab?.key === `dojo:${ABSTRACTION_LAYERS_DOJO_ID}` ||
            activeTab?.key === `dojo:${BREAKPOINT_LAYOUTS_DOJO_ID}`
          "
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
            <div v-else-if="activeDojoId === PACKAGE_TREE_DOJO_ID" class="dojo-panel">
              <div class="dojo-panel__header">
                <div class="dojo-panel__title">Package tree</div>
                <div class="dojo-panel__meta">Node count {{ dojoTreeCount }}</div>
              </div>
              <p class="dojo-panel__hint">
                Each package imports up to two children in a breadth-first tree, so the diagram grows in both width and height at the same time.
              </p>
              <label class="dojo-panel__control" for="dojo-package-tree-count">
                <span class="dojo-panel__label">Node count</span>
                <input
                  id="dojo-package-tree-count"
                  v-model.number="dojoTreeCount"
                  class="dojo-panel__slider"
                  type="range"
                  min="1"
                  max="128"
                  step="1"
                  aria-label="Package tree node count"
                />
              </label>
              <div class="dojo-panel__scale">
                <span>1</span>
                <span>128</span>
              </div>
            </div>
            <div v-else-if="activeDojoId === ARTEFACT_HIERARCHY_DOJO_ID" class="dojo-panel">
              <div class="dojo-panel__header">
                <div class="dojo-panel__title">Artefact hierarchy</div>
                <div class="dojo-panel__meta">{{ dojoArtefactLayers }} layer{{ dojoArtefactLayers !== 1 ? 's' : '' }}, width {{ dojoArtefactWidth }}</div>
              </div>
              <p class="dojo-panel__hint">
                Each layer deepens the Scala inheritance tree inside the
                <strong>animals</strong> and <strong>fruits</strong> packages. Width adds more
                sibling artefacts at each level. Drill into any package to explore the inner diagram.
              </p>
              <label class="dojo-panel__control" for="dojo-artefact-layers">
                <span class="dojo-panel__label">Hierarchy layers</span>
                <input
                  id="dojo-artefact-layers"
                  v-model.number="dojoArtefactLayers"
                  class="dojo-panel__slider"
                  type="range"
                  min="1"
                  max="5"
                  step="1"
                  aria-label="Artefact hierarchy layers"
                />
              </label>
              <div class="dojo-panel__scale">
                <span>1</span>
                <span>5</span>
              </div>
              <label class="dojo-panel__control" for="dojo-artefact-width">
                <span class="dojo-panel__label">Width per layer</span>
                <input
                  id="dojo-artefact-width"
                  v-model.number="dojoArtefactWidth"
                  class="dojo-panel__slider"
                  type="range"
                  min="1"
                  max="20"
                  step="1"
                  aria-label="Artefact hierarchy width"
                />
              </label>
              <div class="dojo-panel__scale">
                <span>1</span>
                <span>20</span>
              </div>
            </div>
            <div v-else-if="activeDojoId === ABSTRACTION_LAYERS_DOJO_ID" class="dojo-panel">
              <div class="dojo-panel__header">
                <div class="dojo-panel__title">Abstraction layers</div>
                <div class="dojo-panel__meta">Resize + layout parity</div>
              </div>
              <p class="dojo-panel__hint">
                Each tile is a different Triton abstraction (general box, project, module, package, Scala artefact) with
                the same subtitle + metric strip affordances. Drag the blue handles to resize; compare how inner layout
                behaves at different sizes.
              </p>
              <label class="dojo-panel__control dojo-panel__control--switch" for="dojo-abstraction-linked-resize">
                <span class="dojo-panel__label">Linked resize</span>
                <input
                  id="dojo-abstraction-linked-resize"
                  v-model="dojoAbstractionLinkedResize"
                  class="dojo-panel__checkbox"
                  type="checkbox"
                  aria-label="When enabled, resizing one box updates every abstraction demo box to the same width and height"
                />
              </label>
              <p class="dojo-panel__hint dojo-panel__hint--compact">
                Off: each handle only resizes its own box. On: dragging any handle applies the new size to all five
                boxes (positions stay put).
              </p>
            </div>
            <div v-else-if="activeDojoId === BREAKPOINT_LAYOUTS_DOJO_ID" class="dojo-panel">
              <div class="dojo-panel__header">
                <div class="dojo-panel__title">Breakpoint layouts</div>
                <div class="dojo-panel__meta">Minimal size per layout state</div>
              </div>
              <p class="dojo-panel__hint">
                Layout states are arranged vertically and box types horizontally. Each matrix cell shows the minimal
                representative size for general, project, module, package, and Scala artefact boxes.
              </p>
              <label class="dojo-panel__control dojo-panel__control--switch" for="dojo-breakpoint-linked-resize">
                <span class="dojo-panel__label">Linked resize</span>
                <input
                  id="dojo-breakpoint-linked-resize"
                  v-model="dojoAbstractionLinkedResize"
                  class="dojo-panel__checkbox"
                  type="checkbox"
                  aria-label="When enabled, resizing one breakpoint demo box updates every breakpoint demo box to the same width and height"
                />
              </label>
              <p class="dojo-panel__hint dojo-panel__hint--compact">
                Uses the same resize handles as the abstraction dojo. Off: resize one sample. On: apply the dragged
                size to every breakpoint sample while positions stay fixed.
              </p>
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
.dojo-panel__hint--compact {
  margin: 0;
  font-size: 11px;
  line-height: 1.45;
  color: #64748b;
}
.dojo-panel__control {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dojo-panel__control--switch {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.dojo-panel__checkbox {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
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
